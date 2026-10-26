import { describe, expect, it } from "vitest";
import { createBayGearInterlock } from "../src/bayGearInterlock";
import type { StorePropertyAccess } from "../src/storeAttachment";

const DT = 1 / 120;

/** The plant's two kinematics: doors 1.5 s and gear 5 s end to end. */
function plant(initial: Record<string, number> = {}) {
  const values: Record<string, number> = {
    "gear/gear-cmd-norm": 1, "gear/gear-pos-norm": 1,
    "stores/bay[0]/door-cmd-norm": 0, "stores/bay[0]/door-pos-norm": 0,
    "stores/bay[1]/door-cmd-norm": 0, "stores/bay[1]/door-pos-norm": 0,
    ...initial,
  };
  let reads = 0;
  const sdk: StorePropertyAccess = {
    getPropertyValue(path) { reads++; return values[path] ?? NaN; },
    setPropertyValue(path, value) { values[path] = value; },
  };
  const toward = (pos: string, cmd: string, seconds: number) => {
    const step = DT / seconds, from = values[pos]!, to = values[cmd]!;
    values[pos] = Math.abs(to - from) <= step ? to : from + Math.sign(to - from) * step;
  };
  return {
    sdk, values,
    reads: () => reads,
    step() {
      toward("gear/gear-pos-norm", "gear/gear-cmd-norm", 5);
      toward("stores/bay[0]/door-pos-norm", "stores/bay[0]/door-cmd-norm", 1.5);
      toward("stores/bay[1]/door-pos-norm", "stores/bay[1]/door-cmd-norm", 1.5);
    },
  };
}

describe("bay and gear interlock", () => {
  it("reads nothing while nothing waits", () => {
    const jet = plant();
    const interlock = createBayGearInterlock(jet.sdk, () => {});
    const before = jet.reads();
    for (let i = 0; i < 240; i++) expect(interlock.gearCommand(1)).toBe(1);
    expect(jet.reads()).toBe(before);
  });

  it("shuts an open bay and holds the gear until both doors are shut", () => {
    const jet = plant({ "stores/bay[1]/door-cmd-norm": 1, "stores/bay[1]/door-pos-norm": 1 });
    const commands: [number, number][] = [];
    const interlock = createBayGearInterlock(jet.sdk, (bay, cmd) => commands.push([bay, cmd]));
    let held = 0;
    for (let i = 0; i < 1200; i++) {
      const gear = interlock.gearCommand(0);
      jet.values["gear/gear-cmd-norm"] = gear;
      if (gear === 1) {
        held++;
        // The gear has not left down while the door is anywhere but shut.
        expect(jet.values["gear/gear-pos-norm"]).toBe(1);
      } else {
        expect(jet.values["stores/bay[1]/door-pos-norm"]).toBeLessThanOrEqual(0.001);
        expect(jet.values["stores/bay[1]/door-cmd-norm"]).toBe(0);
      }
      jet.step();
    }
    expect(commands).toEqual([[1, 0]]);
    expect(held / 120).toBeCloseTo(1.5, 1);
    expect(jet.values["gear/gear-pos-norm"]).toBe(0);
  });

  it("queues an open asked for in gear transit and opens once the gear is up", () => {
    const jet = plant();
    const interlock = createBayGearInterlock(jet.sdk, () => {});
    jet.values["gear/gear-cmd-norm"] = interlock.gearCommand(0);
    jet.step();
    interlock.requestBay(0, true);
    expect(interlock.queued(0)).toBe(true);
    let opened = -1;
    for (let i = 0; i < 1200 && opened < 0; i++) {
      jet.values["gear/gear-cmd-norm"] = interlock.gearCommand(0);
      if (jet.values["stores/bay[0]/door-cmd-norm"] === 1) opened = jet.values["gear/gear-pos-norm"]!;
      jet.step();
    }
    expect(opened).toBe(0);
    expect(interlock.queued(0)).toBe(false);
  });

  it("opens at once with the gear at rest, and a shut request cancels a queued open", () => {
    const jet = plant();
    const interlock = createBayGearInterlock(jet.sdk, () => {});
    interlock.requestBay(1, true);
    expect(jet.values["stores/bay[1]/door-cmd-norm"]).toBe(1);
    jet.values["gear/gear-pos-norm"] = 0.5;
    interlock.requestBay(0, true);
    expect(interlock.queued(0)).toBe(true);
    interlock.requestBay(0, false);
    expect(interlock.queued(0)).toBe(false);
    expect(jet.values["stores/bay[0]/door-cmd-norm"]).toBe(0);
  });

  it("lets the pilot take back a gear request without moving the gear", () => {
    const jet = plant({ "stores/bay[0]/door-cmd-norm": 1, "stores/bay[0]/door-pos-norm": 1 });
    const interlock = createBayGearInterlock(jet.sdk, () => {});
    for (let i = 0; i < 30; i++) { jet.values["gear/gear-cmd-norm"] = interlock.gearCommand(0); jet.step(); }
    expect(interlock.gearCommand(1)).toBe(1);
    for (let i = 0; i < 240; i++) { jet.values["gear/gear-cmd-norm"] = interlock.gearCommand(1); jet.step(); }
    expect(jet.values["gear/gear-pos-norm"]).toBe(1);
    // No reopen: the shut stays the pilot's to undo.
    expect(jet.values["stores/bay[0]/door-cmd-norm"]).toBe(0);
  });

  it("resync takes the plant's gear command and drops a queued open", () => {
    const jet = plant({ "gear/gear-pos-norm": 0.4 });
    const interlock = createBayGearInterlock(jet.sdk, () => {});
    interlock.requestBay(1, true);
    expect(interlock.queued(1)).toBe(true);
    jet.values["gear/gear-cmd-norm"] = 0;
    interlock.resync();
    expect(interlock.queued(1)).toBe(false);
    expect(interlock.gearCommand(0)).toBe(0);
  });
});
