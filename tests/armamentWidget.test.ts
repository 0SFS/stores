// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createArmamentWidget, type ArmamentWidgetHandle } from "../src/armamentWidget";
import type { ArmamentControlsState } from "../src/armamentControls";
import { emptyLoad } from "../src/storeCatalog";

const handles: ArmamentWidgetHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.replaceChildren();
});

function setup(patch: Partial<ArmamentControlsState> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const load = emptyLoad();
  load[1] = load[11] = "aim-9x";
  load[4] = "gbu-32";
  load[5] = load[8] = "aim-120";
  load[6] = "gau-22-pod";
  const state: ArmamentControlsState = {
    load, tankOnStation: Array<boolean>(12).fill(false), selectedWeaponKey: "aim-9x", selectedStation: 1,
    gunRounds: 220, masterArm: true, firing: false, pendingStation: null, status: "ready", canFire: true,
    ...patch,
  };
  const options = {
    onSelectWeapon: vi.fn(), onCycle: vi.fn(), onTrigger: vi.fn(), onCancel: vi.fn(), onMasterArm: vi.fn(), onOpen: vi.fn(),
  };
  const handle = createArmamentWidget(host, options);
  handles.push(handle);
  handle.update(state);
  const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  return { host, handle, state, options, button };
}

function pointer(target: Element, type: string, patch: Record<string, unknown> = {}) {
  target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    pointerId: 1, isPrimary: true, button: 0, ...patch,
  }));
}

describe("armament widget", () => {
  it("selects types from the diagram and distinguishes next, carried and unsupported stores", () => {
    const { host, options, button } = setup();
    const station = (number: number) => host.querySelector<HTMLButtonElement>(`[data-station="${number}"]`)!;
    expect(station(1).getAttribute("aria-pressed")).toBe("true");
    expect(station(11).getAttribute("aria-pressed")).toBe("true");
    expect(station(1).dataset.next).toBe("true");
    expect(station(11).dataset.next).toBe("false");
    expect(station(4).getAttribute("aria-label")).toContain("Release unavailable");
    station(5).click();
    expect(options.onSelectWeapon).toHaveBeenCalledWith("aim-120");
    station(4).click();
    expect(options.onSelectWeapon).toHaveBeenCalledTimes(1);
    button("Previous weapon type").click();
    button("Next weapon type").click();
    expect(options.onCycle.mock.calls).toEqual([[-1], [1]]);
    button("Master arm safe").click();
    expect(options.onMasterArm).toHaveBeenCalledWith(false);
    button("Open Armament tab").click();
    expect(options.onOpen).toHaveBeenCalledOnce();
  });

  it("keeps the Fire DOM control across updates and releases held input on cancel and blur", () => {
    const { host, handle, state, options } = setup({ selectedWeaponKey: "gau-22-pod", selectedStation: 6 });
    const fire = host.querySelector<HTMLButtonElement>(".flight-armament-widget__fire")!;
    pointer(fire, "pointerdown");
    expect(options.onTrigger.mock.calls).toEqual([[true]]);
    handle.update({ ...state, gunRounds: 219, status: "firing", firing: true });
    expect(host.querySelector(".flight-armament-widget__fire")).toBe(fire);
    expect(host.textContent).toContain("219 rounds");
    pointer(fire, "pointercancel");
    expect(options.onTrigger.mock.calls).toEqual([[true], [false]]);
    expect(options.onCancel).toHaveBeenCalledOnce();
    pointer(fire, "pointerdown");
    window.dispatchEvent(new Event("blur"));
    expect(options.onTrigger.mock.calls).toEqual([[true], [false], [true], [false]]);
    handle.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it("supports short pointer presses and keyboard holds without repeated keydown firing", () => {
    const { host, options } = setup();
    const fire = host.querySelector<HTMLButtonElement>(".flight-armament-widget__fire")!;
    pointer(fire, "pointerdown");
    pointer(fire, "pointerup");
    expect(options.onTrigger.mock.calls).toEqual([[true], [false]]);
    options.onTrigger.mockClear();
    fire.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    fire.dispatchEvent(new KeyboardEvent("keydown", { key: " ", repeat: true, bubbles: true, cancelable: true }));
    fire.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true }));
    expect(options.onTrigger.mock.calls).toEqual([[true], [false]]);
  });

  it("does not duplicate pointer or held-key activation and accepts a standalone accessibility click", () => {
    const { host, options } = setup();
    const fire = host.querySelector<HTMLButtonElement>(".flight-armament-widget__fire")!;
    pointer(fire, "pointerdown");
    pointer(fire, "pointerup");
    fire.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true }));
    expect(options.onTrigger.mock.calls).toEqual([[true], [false]]);
    options.onTrigger.mockClear();
    const down = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    fire.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    fire.dispatchEvent(new MouseEvent("click", { detail: 0, bubbles: true }));
    expect(options.onTrigger.mock.calls).toEqual([[true]]);
    fire.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true }));
    expect(options.onTrigger.mock.calls).toEqual([[true], [false]]);
    options.onTrigger.mockClear();
    fire.click();
    expect(options.onTrigger.mock.calls).toEqual([[true], [false]]);
  });

  it("releases a held trigger and moves focus to Cancel while a launch is queued", () => {
    const { host, handle, state, options, button } = setup({ selectedWeaponKey: "aim-120", selectedStation: 5 });
    const fire = host.querySelector<HTMLButtonElement>(".flight-armament-widget__fire")!;
    fire.focus();
    fire.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    handle.update({ ...state, pendingStation: 5, status: "opening-bay", canFire: false });
    expect(options.onTrigger.mock.calls).toEqual([[true], [false]]);
    expect(document.activeElement).toBe(button("Cancel queued launch"));
    handle.update(state);
    expect(document.activeElement).toBe(fire);
    expect(options.onTrigger.mock.calls).toEqual([[true], [false]]);
  });

  it("shows Cancel while the bay launch waits, retains an empty type and opens shared help", () => {
    const { host, handle, state, options, button } = setup({
      selectedWeaponKey: "aim-120", selectedStation: 5, pendingStation: 5, status: "waiting-for-gear", canFire: false,
    });
    expect(host.textContent).toContain("Waiting for gear");
    expect(host.querySelector<HTMLButtonElement>(".flight-armament-widget__fire")!.hidden).toBe(true);
    const repeat = new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true });
    button("Cancel queued launch").dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(true);
    expect(options.onCancel).not.toHaveBeenCalled();
    button("Cancel queued launch").click();
    expect(options.onCancel).toHaveBeenCalledOnce();
    const load = state.load.slice();
    load[5] = load[8] = null;
    handle.update({ ...state, load, pendingStation: null, selectedStation: null, status: "empty" });
    expect(host.querySelector(".flight-armament-widget__name")!.textContent).toBe("AIM-120");
    expect(host.textContent).toContain("0 remaining");
    expect(host.querySelector<HTMLButtonElement>(".flight-armament-widget__fire")!.disabled).toBe(true);
    const help = button("Explain armament controls and stations");
    help.click();
    expect(help.getAttribute("aria-expanded")).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(help.getAttribute("aria-expanded")).toBe("false");
  });
});
