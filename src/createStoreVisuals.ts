import {
  Color3, CreateBox, CreateCylinder, Material, Matrix, Mesh, Quaternion, StandardMaterial, TransformNode,
  Vector3, VertexBuffer, VertexData,
  type AbstractMesh, type Scene,
} from "@babylonjs/core";
import { fitBayDoors, type BayDoorFit, type MeshArrays, type SkinPrimitive } from "./bayDoorGeometry";
import {
  BAYS, DOOR_OPEN_RAD, INTERNAL_STORE_VISIBLE_AT, STATIONS,
  bodyMetersFromStructural, storeMeshPlacement, type StationDefinition,
} from "./stationTable";
import { storeByKey, type StoreCard } from "./storeCatalog";
import type { StoreMirror } from "./storeAttachment";
import {
  projectReleasedStore, releaseStore, releasedPastBudget, stepReleasedStore, type ReleasedStore,
} from "./releasedStore";

export interface StoreVisualOptions {
  requestRender?(): void;
  /** Double-precision ECEF -> scene east/up/south frame from the floating origin. */
  getWorldFromEcef(): { readonly m: ArrayLike<number> } | null;
  lifetimeSeconds: number;
  maxDetachedStores: number;
}

/** The loaded AF267 airframe before it is shown, from the aircraft model's prepareModel. */
export interface StoreAirframe {
  meshes: readonly AbstractMesh[];
  /** Sits on the stores' `parent` frame once the airframe is placed. */
  frame: TransformNode;
  frameFromMesh(mesh: AbstractMesh): Matrix;
}

export interface StoreAirframeFit {
  meshes: readonly AbstractMesh[];
  reveal(): void;
  dispose(): void;
}

export interface StoreVisualHandle {
  sync(mirror: StoreMirror): void;
  /**
   * Cut the four bay-door footprints out of the loaded lower skin and hang
   * the clipped skin on the hinges, over a stand-in lining. Built once per
   * airframe load. Throws, before changing anything, when the airframe is not
   * the AF267 mesh the fit was made on.
   */
  fitAirframe(airframe: StoreAirframe): StoreAirframeFit;
  /**
   * Swing both leaves of each bay to its one door position and reveal
   * internal stores. Returns true when both doors have reached their
   * commands, so the caller can stop reading properties.
   */
  poseDoors(pos: readonly [number, number], cmd: readonly [number, number]): boolean;
  /**
   * Drop the hung store with the aircraft's scene east/up/south ground
   * velocity, metres per second. Call before the station is cleared. A store
   * that was not drawn, in a shut bay, simply leaves.
   */
  jettison(station: number, worldVelocity: { readonly x: number; readonly y: number; readonly z: number }): void;
  /** Accepted simulation time only; zero rebases falling stores without advancing them. */
  update(dtSeconds: number): void;
  setLifetimeSeconds(seconds: number): void;
  setMaxDetachedStores(count: number): void;
  resetDetached(): void;
  dispose(): void;
}

interface Slot {
  station: StationDefinition;
  root: TransformNode;
  key: string | null;
  meshes: Mesh[];
  /** The station's one reusable falling holder and what it carries. */
  detached: TransformNode;
  falling: Mesh[];
  released: ReleasedStore | null;
}

interface HungLeaf {
  bay: 0 | 1;
  hinge: TransformNode;
  axis: Vector3;
  openSign: number;
}

interface ActiveFit {
  leaves: HungLeaf[];
  nodes: TransformNode[];
}

const STORE_COLOR = new Color3(0.22, 0.24, 0.26);
/** The leaves' inner faces and edges. */
const DOOR_COLOR = new Color3(0.45, 0.47, 0.46);
/** The stand-in recess, dark so the center seam reads open. */
const LINING_COLOR = new Color3(0.1, 0.105, 0.11);

/**
 * The AF267 `fuselage` node's body-frame vertex bounds in the door spec. A
 * different mesh is refused rather than cut where the fit does not belong.
 */
const AF267_FUSELAGE_BOUNDS = { min: [-5.333999, -0.241070, -4.668902], max: [5.334000, 2.198743, 9.360408] } as const;
const FINGERPRINT_TOLERANCE_M = 1e-4;
const FUSELAGE_PRIMITIVE = /^fuselage(_primitive\d+)?$/;

/**
 * Procedural stores, and the bay doors cut from the airframe's own skin.
 * Store meshes are built when the hung store changes, then left disabled
 * until a door or a station needs them. One shared material. No per-frame
 * allocation. The doors are fitted once per airframe load and move only
 * while a door position is still changing.
 *
 * A jettisoned store falls as the external tanks do: visual-only ballistic
 * motion from the aircraft's ground velocity, no collision. Each station has
 * one reusable falling holder, under the same lifetime and count budget.
 */
export function createStoreVisuals(scene: Scene, parent: TransformNode, options: StoreVisualOptions): StoreVisualHandle {
  const stores = dressMaterial(new StandardMaterial("f35b-stores", scene), STORE_COLOR);
  const doors = dressMaterial(new StandardMaterial("f35b-bay-doors", scene), DOOR_COLOR);
  const lining = dressMaterial(new StandardMaterial("f35b-bay-lining", scene), LINING_COLOR);
  let lifetime = Math.max(0, options.lifetimeSeconds);
  let maximum = Math.max(0, Math.min(STATIONS.length, Math.floor(options.maxDetachedStores)));
  let serial = 0, falling = 0;
  const slots: Slot[] = STATIONS.map(station => {
    const root = new TransformNode(`store-station-${station.station}`, scene);
    root.parent = parent;
    const body = bodyMetersFromStructural(station.locationIn);
    root.position.set(body.x, body.y, body.z);
    const detached = new TransformNode(`store-station-${station.station}-detached`, scene);
    detached.rotationQuaternion = Quaternion.Identity();
    detached.setEnabled(false);
    return { station, root, key: null, meshes: [], detached, falling: [], released: null };
  });
  const shown: [number, number] = [-1, -1];
  const internalOpen: [boolean, boolean] = [false, false];
  let active: ActiveFit | null = null;

  const poseBay = (bay: 0 | 1): void => {
    if (!active) return;
    const angle = Math.min(1, Math.max(0, shown[bay])) * DOOR_OPEN_RAD;
    for (const leaf of active.leaves) {
      if (leaf.bay === bay) Quaternion.RotationAxisToRef(leaf.axis, leaf.openSign * angle, leaf.hinge.rotationQuaternion!);
    }
  };

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
  const requestRender = (): void => options.requestRender?.();
  const hideReleased = (slot: Slot): boolean => {
    const visible = slot.detached.isEnabled();
    if (slot.released) falling--;
    slot.released = null;
    slot.detached.setEnabled(false);
    for (const mesh of slot.falling) mesh.dispose();
    slot.falling = [];
    return visible;
  };
  const enforceBudget = (): boolean => {
    let changed = false;
    for (const slot of releasedPastBudget(slots, maximum, lifetime)) changed = hideReleased(slot) || changed;
    return changed;
  };
  const build = (slot: Slot, card: StoreCard): void => {
    clearSlot(slot);
    const name = `store-${slot.station.station}`;
    const placement = storeMeshPlacement(slot.station, card.key);
    if (card.boxM) {
      const box = CreateBox(`${name}-body`, {
        width: card.boxM.width, height: card.boxM.height, depth: card.boxM.length,
      }, scene);
      seat(box, slot.root, placement, 0, 0);
      slot.meshes.push(dress(box, stores));
    } else if (card.lengthM !== null && card.diameterM !== null) {
      const body = CreateCylinder(`${name}-body`, {
        height: card.lengthM, diameter: card.diameterM, tessellation: 6,
      }, scene);
      // The cylinder is built along Y; a quarter turn lays it nose forward.
      seat(body, slot.root, placement, 0, Math.PI / 2);
      slot.meshes.push(dress(body, stores));
      if (card.spanM !== null) {
        const fin = CreateBox(`${name}-fins`, { width: card.spanM, height: 0.02, depth: 0.2 }, scene);
        seat(fin, slot.root, placement, -card.lengthM / 2 + 0.1, 0);
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
    fitAirframe(airframe) {
      const fit = hangDoors(scene, airframe, doors, lining);
      const own: ActiveFit = { leaves: fit.leaves, nodes: fit.nodes };
      const dispose = (): void => {
        if (active === own) active = null;
        for (const node of own.nodes) node.dispose();
        own.nodes = [];
      };
      return {
        meshes: fit.meshes,
        reveal() {
          if (!own.nodes.length) return;
          active = own;
          poseBay(0);
          poseBay(1);
        },
        dispose,
      };
    },
    poseDoors(pos, cmd) {
      let settled = true;
      for (const bay of BAYS) {
        const position = Number.isFinite(pos[bay.bay]) ? pos[bay.bay] : 0;
        const command = Number.isFinite(cmd[bay.bay]) ? cmd[bay.bay] : 0;
        if (position !== shown[bay.bay]) {
          shown[bay.bay] = position;
          poseBay(bay.bay);
          const open = position > INTERNAL_STORE_VISIBLE_AT;
          if (open !== internalOpen[bay.bay]) {
            internalOpen[bay.bay] = open;
            for (const slot of slots) if (slot.station.bay === bay.bay) showSlot(slot);
          }
        }
        // JSBSim's kinematic lands exactly on its command, so a door short of it is still moving.
        if (position !== command) settled = false;
      }
      return settled;
    },
    jettison(station, worldVelocity) {
      const slot = slots.find(slot => slot.station.station === station);
      if (!slot || slot.key === null) return;
      const drawn = slot.meshes.some(mesh => mesh.isEnabled());
      const frame = drawn && maximum > 0 && lifetime > 0 ? options.getWorldFromEcef() : null;
      const released = frame ? releaseStore(slot.root, worldVelocity, frame.m, serial + 1) : null;
      if (released && frame) {
        hideReleased(slot);
        serial = released.serial;
        for (const mesh of slot.meshes) mesh.parent = slot.detached;
        slot.falling = slot.meshes;
        slot.meshes = [];
        slot.released = released;
        falling++;
        projectReleasedStore(released, frame.m, slot.detached);
        slot.detached.setEnabled(true);
      }
      clearSlot(slot);
      const budgetChanged = enforceBudget();
      if (drawn || budgetChanged) requestRender();
    },
    update(dtSeconds) {
      // Nothing falling: no frame read, no work beside a hung load.
      if (falling === 0) return;
      const frame = options.getWorldFromEcef();
      if (!frame) return;
      const dt = Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : 0;
      let changed = false;
      for (const slot of slots) {
        const release = slot.released;
        if (!release) continue;
        // No visual time advances during pause; zero time only rebases.
        stepReleasedStore(release, dt);
        if (release.age >= lifetime) { changed = hideReleased(slot) || changed; continue; }
        changed = projectReleasedStore(release, frame.m, slot.detached) || changed;
      }
      if (changed) requestRender();
    },
    setLifetimeSeconds(seconds) {
      if (!Number.isFinite(seconds)) return;
      lifetime = Math.max(0, seconds);
      if (enforceBudget()) requestRender();
    },
    setMaxDetachedStores(count) {
      if (!Number.isFinite(count)) return;
      maximum = Math.max(0, Math.min(slots.length, Math.floor(count)));
      if (enforceBudget()) requestRender();
    },
    resetDetached() {
      let changed = false;
      for (const slot of slots) changed = hideReleased(slot) || changed;
      if (changed) requestRender();
    },
    dispose() {
      for (const slot of slots) {
        clearSlot(slot);
        hideReleased(slot);
        slot.root.dispose();
        slot.detached.dispose();
      }
      if (active) for (const node of active.nodes) node.dispose();
      active = null;
      stores.dispose();
      doors.dispose();
      lining.dispose();
    },
  };
}

function dressMaterial(material: StandardMaterial, color: Color3): StandardMaterial {
  material.diffuseColor = color;
  material.specularColor = new Color3(0.04, 0.04, 0.04);
  material.freeze();
  return material;
}

/**
 * Fit the airframe and build its door meshes: every check and the whole fit
 * run before the first loaded mesh is changed.
 */
function hangDoors(scene: Scene, airframe: StoreAirframe, inner: Material, lining: Material): {
  leaves: HungLeaf[]; nodes: TransformNode[]; meshes: Mesh[];
} {
  const sources = airframe.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && FUSELAGE_PRIMITIVE.test(mesh.name));
  if (!sources.length) throw new Error("The airframe has no fuselage mesh to cut the bay doors from.");
  const toFrame = sources.map(mesh => airframe.frameFromMesh(mesh));
  const primitives = sources.map((mesh, i) => bodyPrimitive(mesh, toFrame[i]!));
  checkFingerprint(primitives);
  const fit: BayDoorFit = fitBayDoors(primitives);

  fit.skins.forEach((skin, i) => { if (skin) applySkin(sources[i]!, toFrame[i]!, skin); });
  const nodes: TransformNode[] = [], meshes: Mesh[] = [], leaves: HungLeaf[] = [];
  for (const shell of fit.leaves) {
    const name = `bay-${shell.bay}-${shell.leaf}`;
    const hinge = new TransformNode(`${name}-hinge`, scene);
    hinge.parent = airframe.frame;
    hinge.position.set(shell.pivot[0], shell.pivot[1], shell.pivot[2]);
    hinge.rotationQuaternion = Quaternion.Identity();
    nodes.push(hinge);
    shell.exterior.forEach(({ source, mesh: arrays }, k) => {
      const from = sources[source]!;
      const mesh = buildMesh(scene, k ? `${name}-door-${k}` : `${name}-door`, arrays, hinge);
      // The skin's own material and facing: the leaf is the livery it was cut from.
      mesh.overrideMaterialSideOrientation = from.overrideMaterialSideOrientation;
      meshes.push(dress(mesh, from.material ?? inner));
    });
    meshes.push(dress(buildMesh(scene, `${name}-door-inner`, shell.interior, hinge), inner));
    leaves.push({
      bay: shell.bay, hinge, openSign: shell.openSign,
      axis: new Vector3(shell.axis[0], shell.axis[1], shell.axis[2]),
    });
  }
  const recess = buildMesh(scene, "bay-lining", fit.lining, airframe.frame);
  meshes.push(dress(recess, lining));
  nodes.push(recess);
  return { leaves, nodes, meshes };
}

/** One loaded primitive on the frame, as the fit reads it. */
function bodyPrimitive(mesh: Mesh, toFrame: Matrix): SkinPrimitive {
  const kinds = mesh.getVerticesDataKinds();
  const extra = kinds.filter(kind => kind !== VertexBuffer.PositionKind && kind !== VertexBuffer.NormalKind && kind !== VertexBuffer.UVKind);
  if (extra.length || mesh.skeleton || mesh.morphTargetManager || mesh.subMeshes.length > 1) {
    throw new Error(`${mesh.name} carries data the bay-door cut does not rebuild.`);
  }
  const p = mesh.getVerticesData(VertexBuffer.PositionKind), n = mesh.getVerticesData(VertexBuffer.NormalKind);
  const indices = mesh.getIndices();
  if (!p || !n || !indices) throw new Error(`${mesh.name} has no indexed positions and normals.`);
  const normalMatrix = Matrix.Invert(toFrame).transpose();
  const positions = new Float64Array(p.length), normals = new Float64Array(n.length);
  const v = new Vector3();
  for (let i = 0; i < p.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(p[i]!, p[i + 1]!, p[i + 2]!, toFrame, v);
    positions[i] = v.x; positions[i + 1] = v.y; positions[i + 2] = v.z;
    Vector3.TransformNormalFromFloatsToRef(n[i]!, n[i + 1]!, n[i + 2]!, normalMatrix, v);
    v.normalize();
    normals[i] = v.x; normals[i + 1] = v.y; normals[i + 2] = v.z;
  }
  return { positions, normals, uvs: mesh.getVerticesData(VertexBuffer.UVKind), indices };
}

function checkFingerprint(primitives: readonly SkinPrimitive[]): void {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of primitives) {
    for (let i = 0; i < positions.length; i++) {
      const axis = i % 3, value = positions[i]!;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }
  }
  const off = [0, 1, 2].some(axis => Math.abs(min[axis]! - AF267_FUSELAGE_BOUNDS.min[axis]!) > FINGERPRINT_TOLERANCE_M
    || Math.abs(max[axis]! - AF267_FUSELAGE_BOUNDS.max[axis]!) > FINGERPRINT_TOLERANCE_M);
  if (off) throw new Error("The fuselage is not the AF267 mesh the bay-door fit was made on.");
}

/**
 * The cut skin back on its own mesh, in its own coordinates. The fit keeps
 * every source vertex first and in order, so those are the loaded data
 * unchanged; only the vertices the cut added are carried back from the frame.
 */
function applySkin(mesh: Mesh, toFrame: Matrix, skin: MeshArrays): void {
  const p = mesh.getVerticesData(VertexBuffer.PositionKind)!, n = mesh.getVerticesData(VertexBuffer.NormalKind)!;
  const uv = mesh.getVerticesData(VertexBuffer.UVKind);
  const kept = p.length;
  const positions = new Float32Array(skin.positions.length), normals = new Float32Array(skin.normals.length);
  positions.set(p);
  normals.set(n);
  const fromFrame = Matrix.Invert(toFrame), normalMatrix = toFrame.clone().transpose();
  const v = new Vector3();
  for (let i = kept; i < positions.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(skin.positions[i]!, skin.positions[i + 1]!, skin.positions[i + 2]!, fromFrame, v);
    positions[i] = v.x; positions[i + 1] = v.y; positions[i + 2] = v.z;
    Vector3.TransformNormalFromFloatsToRef(skin.normals[i]!, skin.normals[i + 1]!, skin.normals[i + 2]!, normalMatrix, v);
    v.normalize();
    normals[i] = v.x; normals[i + 1] = v.y; normals[i + 2] = v.z;
  }
  let uvs: Float32Array | null = null;
  if (uv && skin.uvs) {
    uvs = new Float32Array(skin.uvs);
    uvs.set(uv);
  }
  if ((mesh.geometry?.meshes.length ?? 0) > 1) mesh.makeGeometryUnique();
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  if (uvs) data.uvs = uvs;
  data.indices = skin.indices;
  data.applyToMesh(mesh, false);
}

function buildMesh(scene: Scene, name: string, arrays: MeshArrays, parent: TransformNode): Mesh {
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = arrays.positions;
  data.normals = arrays.normals;
  if (arrays.uvs) data.uvs = arrays.uvs;
  data.indices = arrays.indices;
  data.applyToMesh(mesh, false);
  mesh.parent = parent;
  // Built counter-clockwise toward each face's outside, as the airframe's own primitives.
  mesh.overrideMaterialSideOrientation = Material.CounterClockWiseSideOrientation;
  return mesh;
}

/**
 * Hang a store piece on its station root: `alongM` forward of the store
 * centre on the store's axis, the whole store pitched about that centre.
 */
function seat(mesh: Mesh, root: TransformNode, placement: ReturnType<typeof storeMeshPlacement>, alongM: number, rotationX: number): void {
  const pitch = placement.noseDownRad;
  mesh.parent = root;
  mesh.rotationQuaternion = null;
  mesh.rotation.x = rotationX + pitch;
  mesh.position.set(placement.x, placement.y - alongM * Math.sin(pitch), placement.z + alongM * Math.cos(pitch));
}

function dress(mesh: Mesh, material: Material): Mesh {
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  // As the exhaust and smoke: out of shadow casting and the exhaust's depth pass.
  mesh.metadata = { aircraftVisualOnly: true, castsShadows: false };
  return mesh;
}
