// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArmamentPanel, type ArmamentPanelState } from "../src/ArmamentPanel";
import { emptyLoad, loadFromPreset } from "../src/storeCatalog";

const roots: Root[] = [];
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount(); });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function state(patch: Partial<ArmamentPanelState> = {}): ArmamentPanelState {
  return {
    load: emptyLoad(), onGround: true, masterArm: false,
    bayCmd: [0, 0], bayPos: [0, 0], tankOnStation: Array<boolean>(12).fill(false),
    ...patch,
  };
}

function Harness({ initial, onLoad, onJettison, onDoor, onMasterArm }: {
  initial: ArmamentPanelState;
  onLoad: (load: readonly (string | null)[]) => void;
  onJettison: (station: number) => void;
  onDoor: (bay: 0 | 1, open: boolean) => void;
  onMasterArm: (armed: boolean) => void;
}) {
  const [current, setCurrent] = useState(initial);
  return <ArmamentPanel state={current}
    onLoad={load => { onLoad(load); setCurrent(previous => ({ ...previous, load })); }}
    onJettison={onJettison} onDoor={onDoor}
    onMasterArm={armed => { onMasterArm(armed); setCurrent(previous => ({ ...previous, masterArm: armed })); }} />;
}

async function mount(initial: ArmamentPanelState) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const onLoad = vi.fn();
  const onJettison = vi.fn();
  const onDoor = vi.fn();
  const onMasterArm = vi.fn();
  await act(async () => root.render(<Harness initial={initial} onLoad={onLoad} onJettison={onJettison}
    onDoor={onDoor} onMasterArm={onMasterArm} />));
  return { host, onLoad, onJettison, onDoor, onMasterArm };
}

function select(host: HTMLElement, label: string): HTMLSelectElement {
  const element = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (!element) throw new Error(`missing ${label}`);
  return element;
}

function values(element: HTMLSelectElement): string[] {
  return [...element.options].map(option => option.value);
}

describe("Armament panel", () => {
  it("offers only the stores a station can hang", async () => {
    const { host } = await mount(state());
    expect(values(select(host, "1 right wingtip"))).toEqual(["", "aim-9x", "asraam"]);
    expect(values(select(host, "4 right bay"))).toEqual(["", "aim-120", "gbu-12", "gbu-32", "paveway-iv"]);
    expect(values(select(host, "4 right bay"))).not.toContain("gbu-31");
    expect(values(select(host, "6 centerline"))).toEqual(["", "gau-22-pod"]);
    const strike = host.querySelector("button");
    expect([...host.querySelectorAll("button")].some(button => button.textContent === "USMC strike")).toBe(true);
    expect(strike).toBeTruthy();
  });

  it("loads a preset, refuses a wing weapon while the tank is attached, and jettsions in the air", async () => {
    const tank = Array<boolean>(12).fill(false);
    tank[3] = true;
    const loaded = emptyLoad();
    loaded[1] = "aim-9x";
    const { host, onLoad, onJettison, onDoor, onMasterArm } = await mount(state({
      load: loaded, onGround: false, tankOnStation: tank,
    }));
    const preset = [...host.querySelectorAll("button")].find(button => button.textContent === "USMC strike")!;
    expect(preset.disabled).toBe(true);
    expect(preset.title).toContain("wheels");
    const paveway = [...select(host, "3 right inboard").options].find(option => option.value === "paveway-iv")!;
    expect(paveway.disabled).toBe(true);
    expect(paveway.textContent).toContain("external tank");
    const jettison = host.querySelector<HTMLButtonElement>('button[aria-label="Jettison station 1"]')!;
    expect(jettison.disabled).toBe(false);
    await act(async () => { jettison.click(); });
    expect(onJettison).toHaveBeenCalledWith(1);
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Right bay door"]')!.click(); });
    expect(onDoor).toHaveBeenCalledWith(0, true);
    await act(async () => {
      const arm = host.querySelector<HTMLInputElement>('input[aria-label="Master arm"]')!;
      arm.click();
    });
    expect(onMasterArm).toHaveBeenCalledWith(true);
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("applies the USMC strike preset on the ground with the arm safe", async () => {
    const { host, onLoad } = await mount(state());
    const preset = [...host.querySelectorAll("button")].find(button => button.textContent === "USMC strike")!;
    await act(async () => { preset.click(); });
    expect(onLoad).toHaveBeenCalledWith(loadFromPreset("usmc-strike"));
    expect(select(host, "4 right bay").value).toBe("gbu-32");
    expect(select(host, "5 right bay").value).toBe("aim-120");
  });
});
