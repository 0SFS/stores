/** Shared presentation and selection rules for the flight's armament surfaces. */
export type ArmamentStatus = "safe" | "ready" | "firing" | "empty" | "opening-bay"
  | "waiting-for-gear" | "paused" | "destroyed" | "unavailable" | "release-trigger";

export interface ArmamentControlsState {
  load: readonly (string | null)[];
  tankOnStation: readonly boolean[];
  selectedWeaponKey: string | null;
  /** The next loaded station of the selected type, rather than a separate selection. */
  selectedStation: number | null;
  gunRounds: number;
  masterArm: boolean;
  firing: boolean;
  pendingStation: number | null;
  status: ArmamentStatus;
  canFire: boolean;
}

/** These stores have working firing/release behavior in the flight combat runtime. */
export const FIREABLE_WEAPONS = ["aim-9x", "aim-120", "asraam", "gau-22-pod"] as const;

export function isFireableWeapon(key: string | null | undefined): boolean {
  return FIREABLE_WEAPONS.some(supported => supported === key);
}

/** Loaded supported types, once each, in first-station order. */
export function weaponTypes(load: readonly (string | null)[], gunRounds: number): string[] {
  return [...new Set(load.filter((key): key is string => isFireableWeapon(key)
    && (key !== "gau-22-pod" || gunRounds > 0)))];
}

export function weaponStation(load: readonly (string | null)[], key: string | null): number | null {
  if (!isFireableWeapon(key)) return null;
  const index = load.findIndex((store, station) => station > 0 && store === key);
  return index >= 0 ? index : null;
}

export function weaponCount(load: readonly (string | null)[], key: string | null, rounds: number): number {
  if (weaponStation(load, key) === null) return 0;
  return key === "gau-22-pod" ? Math.max(0, Math.floor(rounds))
    : load.filter(store => store === key).length;
}

/** Prefer the first loaded missile, otherwise an available gun. */
export function initialWeapon(load: readonly (string | null)[], rounds: number): string | null {
  const types = weaponTypes(load, rounds);
  return types.find(key => key !== "gau-22-pod") ?? types[0] ?? null;
}
