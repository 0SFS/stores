import { CreateBox, Matrix, NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStoreVisuals, type StoreVisualOptions } from "../src/createStoreVisuals";
import { emptyLoad } from "../src/storeCatalog";
import { bodyMetersFromStructural, stationDefinition, STORE_MESH_FITS } from "../src/stationTable";
import type { StoreMirror } from "../src/storeAttachment";

const engines: NullEngine[] = [];
afterEach(() => { for (const engine of engines.splice(0)) engine.dispose(); });

function mirror(load: (string | null)[], bayPos: [number, number] = [0, 0], bayCmd: [number, number] = bayPos): StoreMirror {
  return { load, bayPos, bayCmd, gunRounds: 0, masterArm: false };
}

// Scene east/up/south at latitude 0, longitude 0, the origin on the surface.
const EARTH_RADIUS_M = 6378137;
const FRAME = { m: [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, -EARTH_RADIUS_M, 0, 1] };

function fixture(overrides: Partial<StoreVisualOptions> = {}) {
  const engine = new NullEngine();
  engines.push(engine);
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const parent = new TransformNode("aircraft", scene);
  parent.position.set(0, 1000, 0);
  const getWorldFromEcef = vi.fn(() => FRAME);
  const requestRender = vi.fn();
  const visuals = createStoreVisuals(scene, parent, {
    getWorldFromEcef, requestRender, lifetimeSeconds: 15, maxDetachedStores: 2, ...overrides,
  });
  return { scene, visuals, getWorldFromEcef, requestRender };
}

function named(scene: Scene, name: string): number {
  return scene.meshes.filter(mesh => mesh.name === name).length;
}

function worldPosition(scene: Scene, node: string): Vector3 {
  return scene.getTransformNodeByName(node)!.computeWorldMatrix(true).getTranslation();
}

describe("store visuals", () => {
  it("places station 3 on the right tank's body position and builds no door before an airframe", () => {
    const { scene, visuals } = fixture();
    const station = stationDefinition(3)!;
    const expected = bodyMetersFromStructural(station.locationIn);
    const root = scene.getTransformNodeByName("store-station-3")!;
    expect(root.position.x).toBeCloseTo(expected.x, 6);
    expect(root.position.x).toBeCloseTo(-3.25, 4);
    expect(root.position.y).toBeCloseTo(0, 6);
    expect(visuals.poseDoors([1, 0], [1, 0])).toBe(true);
    expect(visuals.poseDoors([0.5, 0], [1, 0])).toBe(false);
    expect(visuals.poseDoors([0.9995, 0], [1, 0])).toBe(false);
    expect(scene.meshes.filter(mesh => mesh.name.startsWith("bay-"))).toEqual([]);
  });

  it("refuses a fuselage that is not AF267 and leaves it uncut", () => {
    const { scene, visuals } = fixture();
    const frame = new TransformNode("frame", scene);
    const fuselage = CreateBox("fuselage_primitive0", { width: 10, height: 2, depth: 14 }, scene);
    const before = fuselage.getTotalVertices();
    expect(() => visuals.fitAirframe({ meshes: [fuselage], frame, frameFromMesh: () => Matrix.Identity() }))
      .toThrow(/not the AF267 mesh/);
    expect(() => visuals.fitAirframe({ meshes: [], frame, frameFromMesh: () => Matrix.Identity() }))
      .toThrow(/no fuselage/);
    expect(fuselage.getTotalVertices()).toBe(before);
    expect(scene.meshes.filter(mesh => mesh.name.startsWith("bay-"))).toEqual([]);
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

  it("hangs each store's meshes on its station's mesh fit, pitched about the store centre", () => {
    const { scene, visuals } = fixture();
    const load = emptyLoad();
    load[11] = "aim-9x";
    load[4] = "gbu-32";
    load[6] = "gau-22-pod";
    visuals.sync(mirror(load, [1, 1]));
    const tip = scene.getMeshByName("store-11-body")!;
    expect(tip.parent?.name).toBe("store-station-11");
    expect(tip.position.x).toBeCloseTo(-0.244, 6);
    expect(tip.position.y).toBeCloseTo(STORE_MESH_FITS.wingtip["aim-9x"]!.upM, 6);
    expect(tip.rotation.x).toBeCloseTo(Math.PI / 2, 9);

    const pitch = STORE_MESH_FITS["bay-heavy"]["gbu-32"]!.noseDownRad;
    expect(pitch).toBeGreaterThan(0);
    const body = scene.getMeshByName("store-4-body")!, fins = scene.getMeshByName("store-4-fins")!;
    expect(body.position.asArray()).toEqual([0, 0, 0]);
    expect(body.rotation.x).toBeCloseTo(Math.PI / 2 + pitch, 9);
    expect(fins.rotation.x).toBeCloseTo(pitch, 9);
    // The fins ride the tail: aft and, nose-down, above the centre.
    const tail = 3.0353 / 2 - 0.1;
    expect(fins.position.y).toBeCloseTo(tail * Math.sin(pitch), 9);
    expect(fins.position.z).toBeCloseTo(-tail * Math.cos(pitch), 9);

    const pod = scene.getMeshByName("store-6-body")!;
    expect(pod.position.y).toBeCloseTo(0.21, 9);
    expect(pod.rotation.x).toBeCloseTo(4 * Math.PI / 180, 9);
  });

  it("flags every store out of shadow casting and the exhaust depth pass, as the exhaust is", () => {
    const { scene, visuals } = fixture();
    const load = emptyLoad();
    load[1] = "aim-9x";
    load[4] = "gbu-32";
    load[6] = "gau-22-pod";
    visuals.sync(mirror(load));
    expect(scene.meshes.map(mesh => mesh.name).sort()).toEqual(
      ["store-1-body", "store-1-fins", "store-4-body", "store-4-fins", "store-6-body"]);
    for (const mesh of scene.meshes) expect(mesh.metadata).toEqual({ aircraftVisualOnly: true, castsShadows: false });
  });

  it("drops a jettisoned store with the aircraft's ground velocity, then the station is empty", () => {
    const { scene, visuals, requestRender } = fixture();
    const load = emptyLoad();
    load[3] = "paveway-iv";
    visuals.sync(mirror(load));
    const hung = worldPosition(scene, "store-station-3");
    const body = scene.getMeshByName("store-3-body")!;
    const mesh = body.computeWorldMatrix(true).getTranslation();
    visuals.jettison(3, { x: 10, y: 0, z: -100 });
    expect(requestRender).toHaveBeenCalled();
    expect(body.parent?.name).toBe("store-station-3-detached");
    expect(body.isEnabled()).toBe(true);
    const released = worldPosition(scene, "store-station-3-detached");
    expect(released.subtract(hung).length()).toBeLessThan(1e-4);
    // It leaves from where it was drawn, its mesh fit and all.
    expect(body.computeWorldMatrix(true).getTranslation().subtract(mesh).length()).toBeLessThan(1e-4);

    visuals.sync(mirror(emptyLoad()));
    expect(body.isDisposed()).toBe(false);
    visuals.update(1);
    const fallen = worldPosition(scene, "store-station-3-detached");
    expect(fallen.x - hung.x).toBeCloseTo(10, 3);
    expect(fallen.z - hung.z).toBeCloseTo(-100, 3);
    expect(fallen.y - hung.y).toBeCloseTo(-9.80665 / 2, 2);
    // Pause passes zero time: nothing moves.
    visuals.update(0);
    expect(worldPosition(scene, "store-station-3-detached").subtract(fallen).length()).toBeLessThan(1e-9);
    expect(named(scene, "store-3-body")).toBe(1);
  });

  it("keeps one falling store per station under the tank budget", () => {
    const { scene, visuals } = fixture();
    const load = emptyLoad();
    load[1] = "aim-9x";
    load[11] = "aim-9x";
    load[6] = "gau-22-pod";
    visuals.sync(mirror(load));
    const ground = { x: 0, y: 0, z: -100 };
    visuals.jettison(1, ground);
    visuals.jettison(11, ground);
    visuals.jettison(6, ground);
    expect(named(scene, "store-1-body")).toBe(0);
    expect(named(scene, "store-11-body")).toBe(1);
    expect(named(scene, "store-6-body")).toBe(1);

    for (let i = 0; i < 5; i++) {
      const again = emptyLoad();
      again[6] = "gau-22-pod";
      visuals.sync(mirror(again));
      visuals.jettison(6, ground);
      visuals.sync(mirror(emptyLoad()));
    }
    // Repeating one station reuses its holder and leaves the other within budget.
    expect(named(scene, "store-6-body")).toBe(1);
    expect(named(scene, "store-11-body")).toBe(1);

    visuals.update(15);
    expect(scene.meshes.filter(mesh => mesh.name.startsWith("store-"))).toEqual([]);

    visuals.sync(mirror(load));
    visuals.jettison(1, ground);
    visuals.setMaxDetachedStores(0);
    expect(named(scene, "store-1-body")).toBe(0);
    visuals.setMaxDetachedStores(2);
    visuals.jettison(11, ground);
    visuals.setLifetimeSeconds(0);
    expect(named(scene, "store-11-body")).toBe(0);
    visuals.setLifetimeSeconds(15);
    visuals.jettison(6, ground);
    visuals.resetDetached();
    expect(scene.meshes.filter(mesh => mesh.name.startsWith("store-"))).toEqual([]);
  });

  it("lets a store in a shut bay simply leave, and reads nothing while nothing falls", () => {
    const { scene, visuals, getWorldFromEcef } = fixture();
    const load = emptyLoad();
    load[1] = "aim-9x";
    load[4] = "aim-120";
    load[8] = "aim-120";
    visuals.sync(mirror(load));
    visuals.poseDoors([0, 1], [0, 1]);
    for (let frame = 0; frame < 3; frame++) visuals.update(0.016);
    expect(getWorldFromEcef).not.toHaveBeenCalled();
    visuals.jettison(4, { x: 0, y: 0, z: -100 });
    expect(getWorldFromEcef).not.toHaveBeenCalled();
    expect(named(scene, "store-4-body")).toBe(0);
    visuals.jettison(8, { x: 0, y: 0, z: -100 });
    expect(scene.getMeshByName("store-8-body")?.parent?.name).toBe("store-station-8-detached");
    expect(scene.getMeshByName("store-1-body")?.parent?.name).toBe("store-station-1");
    visuals.jettison(1, { x: Number.NaN, y: 0, z: 0 });
    expect(named(scene, "store-1-body")).toBe(0);
  });
});
