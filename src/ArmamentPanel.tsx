import "./armamentPanel.css";

import { STATIONS } from "./stationTable";
import {
  STORE_PRESETS, loadFromPreset, loadRefusal, rearmBlock, rearmRefusal, storesForStation,
  weaponMassLbs, withAim9x, withGunPod, withStation, WEAPON_PAYLOAD_LIMIT_LBS,
  type RearmContext,
} from "./storeCatalog";

export interface ArmamentPanelState {
  load: readonly (string | null)[];
  /** "Rearm on the ground only": the pilot's setting, or a session rule. */
  groundOnly: boolean;
  onGround: boolean;
  masterArm: boolean;
  bayCmd: readonly [number, number];
  bayPos: readonly [number, number];
  /** An open asked for while the gear moves; the bay opens once the gear rests. */
  bayQueued: readonly [boolean, boolean];
  /** Index by station. True when that station's external tank is attached. */
  tankOnStation: readonly boolean[];
  /** The missile a press will launch. */
  selectedStation?: number | null;
}

export interface ArmamentPanelProps {
  state: ArmamentPanelState;
  onLoad(load: readonly (string | null)[]): void;
  onJettison(station: number): void;
  onDoor(bay: 0 | 1, open: boolean): void;
  onMasterArm(armed: boolean): void;
  onSelect?(station: number): void;
}

/**
 * The hung load. Changing it needs a safe master arm, and the wheels when
 * rearm is ground only. Jettison and the bay doors work in the air either way;
 * the doors wait for the landing gear to rest.
 */
export function ArmamentPanel({ state, onLoad, onJettison, onDoor, onMasterArm, onSelect }: ArmamentPanelProps) {
  const context: RearmContext = {
    groundOnly: state.groundOnly, onGround: state.onGround, masterArm: state.masterArm,
    tankOnStation: state.tankOnStation,
  };
  const blocked = rearmBlock(context);
  const mass = weaponMassLbs(state.load);
  const propose = (next: readonly (string | null)[]) => {
    if (rearmRefusal(next, context)) return;
    onLoad(next);
  };
  return (
    <div className="flight-armament">
      <p className="flight-panel__hint">
        {mass.toLocaleString("en-US")} lb of weapons, of {WEAPON_PAYLOAD_LIMIT_LBS.toLocaleString("en-US")} lb.
        Rearm waits for {state.groundOnly ? "the wheels and " : ""}a safe master arm.
        Jettison drops the store, armed or safe.
        With the master arm on, Space or the right bumper fires the gun, and a press launches the selected missile.
        Y selects the next missile. An internal missile waits for its bay door.
      </p>
      <div className="flight-armament__row">
        <label>
          <input type="checkbox" aria-label="Master arm" checked={state.masterArm}
            onChange={event => onMasterArm(event.target.checked)} />
          Master arm
        </label>
        <label>
          <input type="checkbox" aria-label="AIM-9X on the wingtips"
            checked={state.load[1] === "aim-9x" && state.load[11] === "aim-9x"}
            disabled={blocked !== null}
            onChange={event => propose(withAim9x(state.load, event.target.checked))} />
          AIM-9X on the wingtips
        </label>
        <label>
          <input type="checkbox" aria-label="Gun pod"
            checked={state.load[6] === "gau-22-pod"}
            disabled={blocked !== null}
            onChange={event => propose(withGunPod(state.load, event.target.checked))} />
          Gun pod
        </label>
      </div>
      <div className="flight-armament__row">
        {STORE_PRESETS.map(preset => {
          const next = loadFromPreset(preset.id) ?? state.load;
          const refusal = rearmRefusal(next, context);
          return (
            <button key={preset.id} type="button" disabled={refusal !== null} title={refusal ?? undefined}
              onClick={() => propose(next)}>
              {preset.label}
            </button>
          );
        })}
      </div>
      <div className="flight-armament__row">
        {([0, 1] as const).map(bay => {
          const queued = state.bayQueued[bay] ?? false;
          // A queued open counts as open: pressing again takes it back.
          const open = queued || (state.bayCmd[bay] ?? 0) >= 0.5;
          const percent = Math.round(((state.bayPos[bay] ?? 0)) * 100);
          return (
            <button key={bay} type="button" aria-label={bay === 0 ? "Right bay door" : "Left bay door"}
              onClick={() => onDoor(bay, !open)}>
              {bay === 0 ? "Right bay" : "Left bay"} {open ? "shut" : "open"} ({queued ? "waiting for the gear" : `${percent}%`})
            </button>
          );
        })}
      </div>
      {blocked && <p className="flight-panel__hint">{blocked}</p>}
      <div>
        {STATIONS.map(station => {
          const current = state.load[station.station] ?? null;
          return (
            <div key={station.station} className="flight-armament__station">
              <span>{station.label}</span>
              <select aria-label={station.label} value={current ?? ""} disabled={blocked !== null}
                onChange={event => propose(withStation(state.load, station.station, event.target.value || null))}>
                <option value="">Empty</option>
                {storesForStation(station.station).map(card => {
                  const refusal = loadRefusal(withStation(state.load, station.station, card.key), context);
                  return (
                    <option key={card.key} value={card.key} disabled={refusal !== null}>
                      {refusal ? `${card.label} — ${refusal}` : card.label}
                    </option>
                  );
                })}
              </select>
              <button type="button" disabled={current === null}
                aria-label={`Jettison station ${station.station}`}
                onClick={() => onJettison(station.station)}>
                Jettison
              </button>
              <button type="button"
                disabled={current !== "aim-120" && current !== "aim-9x" && current !== "asraam"}
                aria-pressed={state.selectedStation === station.station}
                aria-label={`Select station ${station.station}`}
                onClick={() => onSelect?.(station.station)}>
                {state.selectedStation === station.station ? "Selected" : "Select"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
