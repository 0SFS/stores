import "./armamentWidget.css";
import { createHelpTooltip } from "foss-earth/shell";
import { STATIONS, type StationDefinition } from "./stationTable";
import { storeByKey } from "./storeCatalog";
import { isFireableWeapon, weaponCount, weaponTypes, type ArmamentControlsState, type ArmamentStatus } from "./armamentControls";

export interface ArmamentWidgetOptions {
  onSelectWeapon(key: string): void;
  onCycle(direction: 1 | -1): void;
  onTrigger(held: boolean): void;
  onCancel(): void;
  onMasterArm(armed: boolean): void;
  onOpen(): void;
}

export interface ArmamentWidgetHandle {
  update(state: ArmamentControlsState): void;
  cancelTrigger(): void;
  destroy(): void;
}

const STATUS: Record<ArmamentStatus, string> = {
  safe: "Safe", ready: "Ready", firing: "Firing", empty: "Empty", "opening-bay": "Opening bay",
  "waiting-for-gear": "Waiting for gear", paused: "Paused", destroyed: "Aircraft destroyed", unavailable: "Unavailable",
  "release-trigger": "Release trigger",
};

/** Schematic station locations: spacing preserves distinct targets for adjacent bay stores. */
function markerPosition(station: StationDefinition): { x: number; y: number } {
  const right = station.side === "right";
  const distance = ({ wingtip: 72, outboard: 44, inboard: 16, "bay-heavy": 15, "bay-light": 45, centerline: 0 })[station.place];
  const y = ({ wingtip: 45, outboard: 57, inboard: 69, "bay-heavy": 31, "bay-light": 25, centerline: 96 })[station.place];
  return { x: 84 + (right ? distance : -distance), y };
}

/** A stable DOM surface. Updates never replace the focused or held control. */
export function createArmamentWidget(root: HTMLElement, options: ArmamentWidgetOptions): ArmamentWidgetHandle {
  const document = root.ownerDocument;
  const window = document.defaultView;
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label: string, text: string, className?: string): HTMLButtonElement => {
    const node = element("button", className, text);
    node.type = "button";
    node.setAttribute("aria-label", label);
    node.title = label;
    return node;
  };
  const container = element("section", "flight-armament-widget");
  container.setAttribute("aria-label", "Armament controls");
  const header = element("div", "flight-armament-widget__header");
  const open = button("Open Armament tab", "Armament", "flight-armament-widget__title");
  open.addEventListener("click", options.onOpen);
  const arming = element("div", "flight-armament-widget__arming");
  arming.setAttribute("role", "group");
  arming.setAttribute("aria-label", "Master arm");
  const safe = button("Master arm safe", "SAFE");
  const arm = button("Master arm armed", "ARM");
  safe.addEventListener("click", () => options.onMasterArm(false));
  arm.addEventListener("click", () => options.onMasterArm(true));
  arming.append(safe, arm);
  header.append(open, arming);

  const body = element("div", "flight-armament-widget__body");
  const diagram = element("div", "flight-armament-widget__diagram");
  diagram.setAttribute("aria-label", "Aircraft stations, nose up");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 168 112");
  svg.setAttribute("aria-hidden", "true");
  const silhouette = document.createElementNS("http://www.w3.org/2000/svg", "path");
  silhouette.setAttribute("d", "M84 3 92 26 94 43 158 72 158 81 98 68 96 90 115 104 115 108 88 103 84 109 80 103 53 108 53 104 72 90 70 68 10 81 10 72 74 43 76 26Z");
  svg.append(silhouette);
  diagram.append(svg);
  let state: ArmamentControlsState | null = null;
  const stations = STATIONS.map(station => {
    const marker = button(station.label, String(station.station), "flight-armament-widget__station");
    marker.dataset.station = String(station.station);
    const position = markerPosition(station);
    marker.style.left = `${position.x / 168 * 100}%`;
    marker.style.top = `${position.y / 112 * 100}%`;
    marker.addEventListener("click", () => {
      const key = state?.load[station.station];
      if (key && isFireableWeapon(key)) options.onSelectWeapon(key);
    });
    diagram.append(marker);
    return { station, marker };
  });
  const controls = element("div", "flight-armament-widget__controls");
  const selection = element("div", "flight-armament-widget__selection");
  const previous = button("Previous weapon type", "‹");
  const next = button("Next weapon type", "›");
  previous.addEventListener("click", () => options.onCycle(-1));
  next.addEventListener("click", () => options.onCycle(1));
  const name = element("span", "flight-armament-widget__name", "No weapon");
  selection.append(previous, name, next);
  const count = element("span", "flight-armament-widget__count");
  const status = element("span", "flight-armament-widget__status");
  status.setAttribute("role", "status");
  const fire = button("Fire selected weapon", "Fire", "flight-armament-widget__fire");
  fire.setAttribute("aria-pressed", "false");
  const cancel = button("Cancel queued launch", "Cancel", "flight-armament-widget__cancel");
  cancel.hidden = true;
  cancel.addEventListener("click", options.onCancel);
  cancel.addEventListener("keydown", event => {
    // Focus moves here when Fire queues a launch; a held Enter must not immediately cancel it.
    if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
  });
  controls.append(selection, count, status, fire, cancel);
  body.append(diagram, controls);

  const footer = element("div", "flight-armament-widget__footer");
  const unavailable = element("span", "flight-armament-widget__unavailable", "Release unavailable");
  unavailable.hidden = true;
  const explanation = element("div");
  explanation.textContent = "Choose a weapon type with the arrows, Y, left bumper or a loaded station. "
    + "Matching stations are filled; the outlined station fires next. Hollow markers are empty; dashed markers carry a tank or a store without working release. "
    + "SAFE / ARM controls the master arm. Fire, Space or right bumper uses only the selected type. Hold for the gun; press once per missile. "
    + "An internal missile opens its bay and launches when ready, even after you release Fire. Cancel, SAFE or changing type cancels the queued launch. "
    + "An empty type stays selected. Open Armament for loadout, doors and jettison. Bomb release is unavailable.";
  const help = createHelpTooltip({ label: "Explain armament controls and stations", content: explanation });
  footer.append(unavailable, help.element);
  container.append(header, body, footer);
  root.append(container);

  let held = false;
  let pointerId: number | null = null;
  let keyHeld: string | null = null;
  let destroyed = false;
  const setHeld = (nextHeld: boolean): void => {
    if (held === nextHeld) return;
    held = nextHeld;
    fire.setAttribute("aria-pressed", String(held));
    options.onTrigger(held);
  };
  const cancelTrigger = (): void => {
    const pointer = pointerId;
    pointerId = null;
    keyHeld = null;
    setHeld(false);
    if (pointer !== null && fire.hasPointerCapture?.(pointer)) fire.releasePointerCapture(pointer);
  };
  fire.addEventListener("pointerdown", event => {
    if (fire.disabled || event.button !== 0 || !event.isPrimary || pointerId !== null) return;
    event.preventDefault();
    fire.focus();
    pointerId = event.pointerId;
    fire.setPointerCapture?.(pointerId);
    setHeld(true);
  });
  const releasePointer = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) cancelTrigger();
  };
  const abortTrigger = (): void => {
    if (!held) return;
    cancelTrigger();
    // Discard a press buffered between simulation steps, rather than turning a canceled gesture into a tap.
    options.onCancel();
  };
  const abortPointer = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) abortTrigger();
  };
  fire.addEventListener("pointerup", releasePointer);
  fire.addEventListener("pointercancel", abortPointer);
  fire.addEventListener("lostpointercapture", abortPointer);
  fire.addEventListener("keydown", event => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (!fire.disabled && !event.repeat && keyHeld === null) { keyHeld = event.key; setHeld(true); }
  });
  fire.addEventListener("keyup", event => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === keyHeld) cancelTrigger();
  });
  fire.addEventListener("blur", abortTrigger);
  // Native accessibility activation has no pointer/key sequence; synthesize one short press.
  fire.addEventListener("click", event => {
    if (event.detail === 0 && !fire.disabled && !held) { setHeld(true); setHeld(false); }
  });
  window?.addEventListener("blur", cancelTrigger);
  const onVisibility = (): void => { if (document.hidden) cancelTrigger(); };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    update(nextState) {
      if (destroyed) return;
      state = nextState;
      container.dataset.status = state.status;
      const label = state.selectedWeaponKey === "gau-22-pod" ? "Gun" : state.selectedWeaponKey
        ? storeByKey(state.selectedWeaponKey)?.label ?? state.selectedWeaponKey : "No weapon";
      if (name.textContent !== label) name.textContent = label;
      const remaining = weaponCount(state.load, state.selectedWeaponKey, state.gunRounds);
      const quantity = `${remaining} ${state.selectedWeaponKey === "gau-22-pod" ? "rounds" : "remaining"}`;
      if (count.textContent !== quantity) count.textContent = quantity;
      if (status.textContent !== STATUS[state.status]) status.textContent = STATUS[state.status];
      safe.setAttribute("aria-pressed", String(!state.masterArm));
      arm.setAttribute("aria-pressed", String(state.masterArm));
      const pending = state.pendingStation !== null;
      const fireFocused = document.activeElement === fire;
      const cancelFocused = document.activeElement === cancel;
      if ((!state.canFire || pending) && held) cancelTrigger();
      fire.disabled = !state.canFire;
      fire.hidden = pending;
      fire.setAttribute("aria-label", `Fire ${label}`);
      cancel.hidden = !pending;
      const types = weaponTypes(state.load, state.gunRounds);
      previous.disabled = next.disabled = types.length === 0 || (types.length === 1 && types[0] === state.selectedWeaponKey);
      if (pending && fireFocused) cancel.focus();
      else if (!pending && cancelFocused) (state.canFire ? fire : !next.disabled ? next : open).focus();
      let hasUnavailable = false;
      for (const { station, marker } of stations) {
        const key = state.load[station.station] ?? null;
        const tank = Boolean(state.tankOnStation[station.station]);
        const supported = isFireableWeapon(key);
        const selected = supported && key === state.selectedWeaponKey;
        const nextStation = selected && station.station === state.selectedStation;
        const identity = key ? storeByKey(key)?.label ?? key : tank ? "External tank" : "Empty";
        const unsupported = (key !== null && !supported) || tank;
        hasUnavailable ||= key !== null && !supported;
        const detail = unsupported ? ". Release unavailable" : nextStation ? ". Fires next" : "";
        marker.title = `${station.label}: ${identity}${detail}`;
        marker.setAttribute("aria-label", marker.title);
        marker.setAttribute("aria-pressed", String(selected));
        marker.setAttribute("aria-disabled", String(!supported));
        marker.tabIndex = key || tank ? 0 : -1;
        marker.dataset.loaded = String(Boolean(key || tank));
        marker.dataset.unsupported = String(unsupported);
        marker.dataset.next = String(nextStation);
        marker.dataset.pending = String(state.pendingStation === station.station);
      }
      unavailable.hidden = !hasUnavailable;
    },
    cancelTrigger,
    destroy() {
      if (destroyed) return;
      cancelTrigger();
      destroyed = true;
      window?.removeEventListener("blur", cancelTrigger);
      document.removeEventListener("visibilitychange", onVisibility);
      help.destroy();
      container.remove();
    },
  };
}
