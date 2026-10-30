import { describe, expect, it } from "vitest";
import { initialWeapon, weaponCount, weaponStation, weaponTypes } from "../src/armamentControls";
import { emptyLoad } from "../src/storeCatalog";

describe("armament selection", () => {
  it("groups supported stores in station order and prefers a missile on initialization", () => {
    const load = emptyLoad();
    load[1] = "aim-9x";
    load[4] = "gbu-32";
    load[5] = "aim-120";
    load[6] = "gau-22-pod";
    load[8] = "aim-120";
    load[11] = "aim-9x";
    expect(weaponTypes(load, 220)).toEqual(["aim-9x", "aim-120", "gau-22-pod"]);
    expect(initialWeapon(load, 220)).toBe("aim-9x");
    expect(weaponCount(load, "aim-120", 220)).toBe(2);
    expect(weaponStation(load, "aim-120")).toBe(5);
    load[5] = null;
    expect(weaponStation(load, "aim-120")).toBe(8);
    expect(weaponCount(load, "aim-120", 220)).toBe(1);
  });

  it("omits exhausted gun from cycling and reports zero when its pod is absent", () => {
    const load = emptyLoad();
    load[6] = "gau-22-pod";
    expect(initialWeapon(load, 5)).toBe("gau-22-pod");
    expect(weaponCount(load, "gau-22-pod", 5)).toBe(5);
    expect(weaponTypes(load, 0)).toEqual([]);
    expect(initialWeapon(load, 0)).toBeNull();
    load[6] = null;
    expect(weaponCount(load, "gau-22-pod", 220)).toBe(0);
    expect(weaponStation(load, "gbu-32")).toBeNull();
    expect(weaponStation(load, null)).toBeNull();
  });
});
