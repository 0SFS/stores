import {
  Color3, CreateBox, CreateCylinder, StandardMaterial, TransformNode,
  type Mesh, type Scene,
} from "@babylonjs/core";
import {
  BAYS, DOOR_OPEN_RAD, DOOR_PANEL_M, INTERNAL_STORE_VISIBLE_AT, STATIONS,
  bodyMetersFromStructural, type StationDefinition,
} from "./stationTable";
import { storeByKey, type StoreCard } from "./storeCatalog";
import type { StoreMirror } from "./storeAttachment";

export interface StoreVisualHandle {
  sync(mirror: StoreMirror): void;
  /**
   * Move the doors and reveal internal stores. Returns true when both doors
   * have reached their commands, so the caller can stop reading properties.
   */
  poseDoors(pos: readonly [number, number], cmd: readonly [number, number]): boolean;
  dispose(): void;
}

interface Slot {
  station: StationDefinition;
  root: TransformNode;
  key: string | null;
  meshes: Mesh[];
}

const STORE_COLOR = new Color3(0.22, 0.24, 0.26);
const DOOR_COLOR = new Color3(0.45, 0.47, 0.46);

/**
 * Procedural stores and bay doors. Meshes are built when the hung store
 * changes, then left disabled until a door or a station needs them. One
 * shared material. No per-frame allocation.
 */
export function createStoreVisuals(scene: Scene, parent: TransformNode): StoreVisualHandle {
  const stores = dressMaterial(new StandardMaterial("f35b-stores", scene), STORE_COLOR);
  const doors = dressMaterial(new StandardMaterial("f35b-bay-doors", scene), DOOR_COLOR);
  const slots: Slot[] = STATIONS.map(station => {
    const root = new TransformNode(`store-station-${station.station}`, scene);
    root.parent = parent;
    const body = bodyMetersFromStructural(station.locationIn);
    root.position.set(body.x, body.y, body.z);
    return { station, root, key: null, meshes: [] };
  });
  const hinges = BAYS.map(bay => {
    const hinge = new TransformNode(`bay-${bay.bay}-hinge`, scene);
    hinge.parent = parent;
    hinge.position.set(bay.hingeMeters.x, bay.hingeMeters.y, bay.hingeMeters.z);
    hinge.rotationQuaternion = null;
    const door = CreateBox(`bay-${bay.bay}-door`, {
      width: DOOR_PANEL_M.width, height: DOOR_PANEL_M.thickness, depth: DOOR_PANEL_M.length,
    }, scene);
    door.parent = hinge;
    door.position.x = -Math.sign(bay.hingeMeters.x) * DOOR_PANEL_M.width / 2;
    dress(door, doors);
    return hinge;
  });
  const shown: [number, number] = [-1, -1];
  const internalOpen: [boolean, boolean] = [false, false];

  const showSlot = (slot: Slot): void => {
    const bay = slot.station.bay;
    const visible = slot.key !== null && (bay === null || internalOpen[bay]);
    for (const mesh of slot.meshes) {
      if (mesh.isEnabled() !== visible) mesh.setEnabled(visible);
    }
  };
  const clearSlot = (slot: Slot): void => {
    for (const mesh of slot.meshes) mesh.dispose();
    slot.meshes = [];
    slot.key = null;
  };
  const build = (slot: Slot, card: StoreCard): void => {
    clearSlot(slot);
    const name = `store-${slot.station.station}`;
    if (card.boxM) {
      const box = CreateBox(`${name}-body`, {
        width: card.boxM.width, height: card.boxM.height, depth: card.boxM.length,
      }, scene);
      box.parent = slot.root;
      slot.meshes.push(dress(box, stores));
    } else if (card.lengthM !== null && card.diameterM !== null) {
      const body = CreateCylinder(`${name}-body`, {
        height: card.lengthM, diameter: card.diameterM, tessellation: 6,
      }, scene);
      body.parent = slot.root;
      body.rotationQuaternion = null;
      body.rotation.x = Math.PI / 2;
      slot.meshes.push(dress(body, stores));
      if (card.spanM !== null) {
        const fin = CreateBox(`${name}-fins`, { width: card.spanM, height: 0.02, depth: 0.2 }, scene);
        fin.parent = slot.root;
        fin.position.z = -card.lengthM / 2 + 0.1;
        slot.meshes.push(dress(fin, stores));
      }
    }
    slot.key = card.key;
    showSlot(slot);
  };

  return {
    sync(mirror) {
      for (const slot of slots) {
        const key = mirror.load[slot.station.station] ?? null;
        if (key === slot.key) {
          showSlot(slot);
          continue;
        }
        const card = key ? storeByKey(key) : undefined;
        if (!card) clearSlot(slot);
        else build(slot, card);
      }
    },
    poseDoors(pos, cmd) {
      let settled = true;
      for (const bay of BAYS) {
        const position = Number.isFinite(pos[bay.bay]) ? pos[bay.bay] : 0;
        const command = Number.isFinite(cmd[bay.bay]) ? cmd[bay.bay] : 0;
        if (Math.abs(position - shown[bay.bay]) > 1e-4) {
          const hinge = hinges[bay.bay];
          if (hinge) hinge.rotation.z = bay.openSign * position * DOOR_OPEN_RAD;
          shown[bay.bay] = position;
          const open = position > INTERNAL_STORE_VISIBLE_AT;
          if (open !== internalOpen[bay.bay]) {
            internalOpen[bay.bay] = open;
            for (const slot of slots) if (slot.station.bay === bay.bay) showSlot(slot);
          }
        }
        if (Math.abs(position - command) > 1e-3) settled = false;
      }
      return settled;
    },
    dispose() {
      for (const slot of slots) {
        clearSlot(slot);
        slot.root.dispose();
      }
      for (const hinge of hinges) hinge.dispose();
      stores.dispose();
      doors.dispose();
    },
  };
}

function dressMaterial(material: StandardMaterial, color: Color3): StandardMaterial {
  material.diffuseColor = color;
  material.specularColor = new Color3(0.04, 0.04, 0.04);
  material.freeze();
  return material;
}

function dress(mesh: Mesh, material: StandardMaterial): Mesh {
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  // As the exhaust and smoke: out of shadow casting and the exhaust's depth pass.
  mesh.metadata = { aircraftVisualOnly: true, castsShadows: false };
  return mesh;
}
