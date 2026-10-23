import { describe, expect, it } from "vitest";
import { isPersistedStoreProperty, isWeaponStoreProperty } from "../src/persistedStores";
import { STATIONS, stationDefinition, stationForFuelTank } from "../src/stationTable";
import {
  STORE_CARDS, assessPieces, emptyLoad, loadFromPreset, loadRefusal, rearmRefusal,
  storeByKey, weaponMassLbs, withStation, type RearmContext,
} from "../src/storeCatalog";

const GROUND: RearmContext = { onGround: true, masterArm: false };

describe("F-35B station table", () => {
  it("keeps the tanks on pointmasses 0 and 1 and mirrors the wing", () => {
    expect(STATIONS.map(station => station.pointmassIndex)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(stationForFuelTank(2)).toBe(3);
    expect(stationForFuelTank(3)).toBe(9);
    expect(stationDefinition(3)?.locationIn).toEqual({ x: 368.52, y: 127.952756, z: -15.36 });
    for (const station of [1, 2, 3, 4, 5]) {
      const left = stationDefinition(12 - station);
      const right = stationDefinition(station)!;
      expect(left?.locationIn.x).toBe(right.locationIn.x);
      expect(left?.locationIn.z).toBe(right.locationIn.z);
      expect(left?.locationIn.y).toBe(-right.locationIn.y);
      expect(left?.ratingLbs).toBe(right.ratingLbs);
    }
    expect(stationDefinition(5)?.ratingLbs).toBe(350);
    expect(stationDefinition(6)?.ratingLbs).toBe(1000);
  });
});

describe("F-35B store catalog", () => {
  it("names the 350 lb cell and the 356 lb AIM-120 card, and hangs it on 5 and 7", () => {
    const card = storeByKey("aim-120")!;
    expect(card.massLbs).toBe(356);
    expect(card.massNote).toContain("358");
    expect(card.ratingException).toEqual({ stations: [5, 7], cellLbs: 350 });
    expect(stationDefinition(5)?.ratingLbs).toBe(350);
    expect(stationDefinition(7)?.ratingLbs).toBe(350);
    expect(rearmRefusal(withStation(emptyLoad(), 5, "aim-120"), GROUND)).toBeNull();
    expect(rearmRefusal(withStation(emptyLoad(), 7, "aim-120"), GROUND)).toBeNull();
    expect(card.dragAreaFt2).toBeCloseTo(0.267, 3);
  });

  it("allows the 1,017 lb gun pod on the 1,000 lb centerline", () => {
    const card = storeByKey("gau-22-pod")!;
    expect(card.massLbs).toBe(1017);
    expect(card.rounds).toBe(220);
    expect(card.ratingException).toEqual({ stations: [6], cellLbs: 1000 });
    expect(stationDefinition(6)?.ratingLbs).toBe(1000);
    expect(card.dragAreaFt2).toBe(6);
    expect(rearmRefusal(withStation(emptyLoad(), 6, "gau-22-pod"), GROUND)).toBeNull();
  });

  it("refuses stores the B does not hang, an AIM-120 on a wingtip, and a weapon under a tank", () => {
    for (const key of ["gbu-31", "jsm", "sidekick", "b61-12", "aim-260", "meteor", "spear-3", "stormbreaker"]) {
      const card = storeByKey(key)!;
      expect(card.selectable, key).toBe(false);
      expect(rearmRefusal(withStation(emptyLoad(), 4, key), GROUND), key).toBe(card.refusal);
    }
    expect(rearmRefusal(withStation(emptyLoad(), 1, "aim-120"), GROUND)).toBe("AIM-120 is not hung on a wingtip.");
    expect(rearmRefusal(withStation(emptyLoad(), 11, "aim-120"), GROUND)).toBe("AIM-120 is not hung on a wingtip.");
    const tank = Array<boolean>(12).fill(false);
    tank[3] = true;
    expect(loadRefusal(withStation(emptyLoad(), 3, "paveway-iv"), { tankOnStation: tank }))
      .toBe("Station 3 is carrying the external tank.");
    expect(rearmRefusal(withStation(emptyLoad(), 3, "paveway-iv"), GROUND)).toBeNull();
  });

  it("refuses a constructed load past 15,000 lb when every piece is inside its station rating", () => {
    expect(assessPieces([
      { station: 2, massLbs: 1500 }, { station: 3, massLbs: 5000 }, { station: 4, massLbs: 1500 },
      { station: 8, massLbs: 1500 }, { station: 9, massLbs: 5000 }, { station: 10, massLbs: 1500 },
    ])).toBe("Weapon payload is past 15,000 lb.");
    expect(assessPieces([{ station: 3, massLbs: 5000 }, { station: 9, massLbs: 5000 }])).toBeNull();
  });

  it("builds the published presets and refuses rearm in the air or with the arm set", () => {
    const strike = loadFromPreset("usmc-strike")!;
    expect(weaponMassLbs(strike)).toBe(2 * 1013 + 2 * 356);
    expect(rearmRefusal(strike, GROUND)).toBeNull();
    expect(rearmRefusal(loadFromPreset("usmc-air-to-air")!, GROUND)).toBeNull();
    expect(rearmRefusal(loadFromPreset("uk")!, GROUND)).toBeNull();
    expect(rearmRefusal(loadFromPreset("clean")!, GROUND)).toBeNull();
    expect(rearmRefusal(withStation(emptyLoad(), 1, "aim-9x"), { onGround: false, masterArm: false }))
      .toBe("Rearm waits for weight on the wheels.");
    expect(rearmRefusal(withStation(emptyLoad(), 1, "aim-9x"), { onGround: true, masterArm: true }))
      .toBe("Safe the master arm before changing the load.");
    expect(storeByKey("aim-9x")?.dragAreaFt2).toBeCloseTo(0.136, 3);
    expect(storeByKey("asraam")?.dragAreaFt2).toBeCloseTo(0.233, 3);
    expect(storeByKey("gbu-32")?.dragAreaFt2).toBe(1);
    expect(STORE_CARDS.filter(card => card.selectable).map(card => card.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("persisted store properties", () => {
  it("keeps station inputs, doors, rounds and the master arm, and drops derived drag", () => {
    expect(isPersistedStoreProperty("stores/external-tank[0]/attached")).toBe(true);
    expect(isPersistedStoreProperty("stores/station[11]/mass-lbs")).toBe(true);
    expect(isPersistedStoreProperty("stores/station[4]/drag-area-ft2")).toBe(true);
    expect(isPersistedStoreProperty("stores/station[4]/drag-lbs")).toBe(false);
    expect(isPersistedStoreProperty("stores/bay[0]/door-cmd-norm")).toBe(true);
    expect(isPersistedStoreProperty("stores/bay[1]/door-pos-norm")).toBe(true);
    expect(isPersistedStoreProperty("stores/gun/rounds")).toBe(true);
    expect(isPersistedStoreProperty("stores/master-arm")).toBe(true);
    expect(isWeaponStoreProperty("stores/external-tank[1]/attached")).toBe(false);
    expect(isWeaponStoreProperty("stores/master-arm")).toBe(true);
  });
});
