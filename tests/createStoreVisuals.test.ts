import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import { afterEach, describe, expect, it } from "vitest";
import { createStoreVisuals } from "../src/createStoreVisuals";
import { emptyLoad } from "../src/storeCatalog";
import { bodyMetersFromStructural, stationDefinition } from "../src/stationTable";
import type { StoreMirror } from "../src/storeAttachment";

const engines: NullEngine[] = [];
afterEach(() => { for (const engine of engines.splice(0)) engine.dispose(); });

function mirror(load: (string | null)[], bayPos: [number, number] = [0, 0], bayCmd: [number, number] = bayPos): StoreMirror {
  return { load, bayPos, bayCmd, gunRounds: 0, masterArm: false };
}

function fixture() {
  const engine = new NullEngine();
  engines.push(engine);
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const parent = new TransformNode("aircraft", scene);
  const visuals = createStoreVisuals(scene, parent);
  return { scene, visuals };
}

describe("store visuals", () => {
  it("places station 3 on the right tank's body position and swings a door downward", () => {
    const { scene, visuals } = fixture();
    const station = stationDefinition(3)!;
    const expected = bodyMetersFromStructural(station.locationIn);
    const root = scene.getTransformNodeByName("store-station-3")!;
    expect(root.position.x).toBeCloseTo(expected.x, 6);
    expect(root.position.x).toBeCloseTo(-3.25, 4);
    expect(root.position.y).toBeCloseTo(0, 6);
    const door = scene.getMeshByName("bay-0-door")!;
    visuals.poseDoors([0, 0], [0, 0]);
    door.computeWorldMatrix(true);
    const shut = door.getBoundingInfo().boundingBox.minimumWorld.y;
    expect(visuals.poseDoors([1, 0], [1, 0])).toBe(true);
    door.computeWorldMatrix(true);
    expect(door.getBoundingInfo().boundingBox.minimumWorld.y).toBeLessThan(shut - 0.4);
    const left = scene.getMeshByName("bay-1-door")!;
    visuals.poseDoors([1, 1], [1, 1]);
    left.computeWorldMatrix(true);
    expect(left.getBoundingInfo().boundingBox.minimumWorld.y).toBeLessThan(shut - 0.4);
    expect(door.isPickable).toBe(false);
    expect(door.metadata.aircraftVisualOnly).toBe(true);
  });

  it("hides an internal store until its bay door opens", () => {
    const { scene, visuals } = fixture();
    const load = emptyLoad();
    load[1] = "aim-9x";
    load[4] = "aim-120";
    visuals.sync(mirror(load));
    visuals.poseDoors([0, 0], [0, 0]);
    const wingtip = scene.getMeshByName("store-1-body")!;
    const bay = scene.getMeshByName("store-4-body")!;
    expect(wingtip.isEnabled()).toBe(true);
    expect(bay.isEnabled()).toBe(false);
    expect(wingtip.isPickable).toBe(false);
    expect(wingtip.metadata.aircraftVisualOnly).toBe(true);
    visuals.poseDoors([1, 0], [1, 0]);
    expect(bay.isEnabled()).toBe(true);
    visuals.poseDoors([0, 0], [0, 0]);
    expect(bay.isEnabled()).toBe(false);
    const aim = stationDefinition(1)!;
    expect(scene.getMeshByName("store-1-fins")).toBeTruthy();
    expect(bodyMetersFromStructural(aim.locationIn).x).toBeCloseTo(-210 * 0.0254, 6);
  });

  it("flags every store and door out of shadow casting and the exhaust depth pass, as the exhaust is", () => {
    const { scene, visuals } = fixture();
    const load = emptyLoad();
    load[1] = "aim-9x";
    load[4] = "gbu-32";
    load[6] = "gau-22-pod";
    visuals.sync(mirror(load));
    expect(scene.meshes.map(mesh => mesh.name).sort()).toEqual(
      ["bay-0-door", "bay-1-door", "store-1-body", "store-1-fins", "store-4-body", "store-4-fins", "store-6-body"]);
    for (const mesh of scene.meshes) expect(mesh.metadata).toEqual({ aircraftVisualOnly: true, castsShadows: false });
  });
});
