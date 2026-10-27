import { stationDefinition, type StationDefinition } from "./stationTable";

/** Weapons only. Fuel and the tanks' dry mass stay out of this sum. */
export const WEAPON_PAYLOAD_LIMIT_LBS = 15_000;

export interface StoreCard {
  /**
   * Integer written to `stores/station[n]/store-id`. Do not renumber: saved
   * flights store these values. Refused rows use 0 and are never written.
   */
  id: number;
  key: string;
  label: string;
  massLbs: number;
  dragAreaFt2: number;
  stations: readonly number[];
  selectable: boolean;
  refusal: string | null;
  /** Printed cell this card is allowed to exceed, on those stations only. */
  ratingException: { stations: readonly number[]; cellLbs: number } | null;
  lengthM: number | null;
  diameterM: number | null;
  spanM: number | null;
  boxM: { length: number; width: number; height: number } | null;
  /** A mesh dimension standing in for one that was not published. */
  meshStandIn: boolean;
  /** Rounds loaded with the store. Only the gun pod has a count. */
  rounds: number | null;
  massNote: string | null;
}

/** Filled from payload mods. Station clearances come from the aircraft that hangs them. */
export const STORE_CARDS: StoreCard[] = [];

const byKey = () => new Map(STORE_CARDS.map(card => [card.key, card]));
const byId = () => new Map(STORE_CARDS.filter(card => card.selectable && card.id !== 0).map(card => [card.id, card]));

export interface PayloadStoreRegistration {
  id: number;
  key: string;
  label: string;
  massLbs: number;
  dragAreaFt2: number;
  lengthM: number | null;
  diameterM: number | null;
  spanM: number | null;
  boxM: StoreCard["boxM"];
  meshStandIn: boolean;
  rounds: number | null;
  massNote: string | null;
}

function upsert(card: StoreCard): void {
  const index = STORE_CARDS.findIndex(item => item.key === card.key);
  if (index >= 0) STORE_CARDS[index] = card;
  else STORE_CARDS.push(card);
}

/** Registers one weapon, pod or other store. Stations stay empty until an aircraft clears them. */
export function registerPayloadStore(store: PayloadStoreRegistration): void {
  const existing = STORE_CARDS.find(item => item.key === store.key);
  upsert({
    ...store,
    stations: existing?.stations ?? [],
    selectable: existing?.selectable ?? true,
    refusal: existing?.refusal ?? null,
    ratingException: existing?.ratingException ?? null,
  });
}

/** The aircraft says which of its stations may carry this payload, and any published rating exception. */
export function applyStoreClearance(key: string, stations: readonly number[], ratingException: StoreCard["ratingException"]): void {
  const existing = STORE_CARDS.find(item => item.key === key);
  if (!existing) return;
  upsert({ ...existing, stations: [...stations], selectable: true, refusal: null, ratingException });
}

/** A card the aircraft shows but will not load. Id 0 is never written to a saved flight. */
export function registerRefusedStore(key: string, label: string, refusal: string): void {
  upsert({
    id: 0, key, label, massLbs: 0, dragAreaFt2: 0, stations: [], selectable: false, refusal,
    ratingException: null, lengthM: null, diameterM: null, spanM: null, boxM: null,
    meshStandIn: false, rounds: null, massNote: null,
  });
}

export function storeByKey(key: string): StoreCard | undefined {
  return byKey().get(key);
}

export function storeById(id: number): StoreCard | undefined {
  return id === 0 ? undefined : byId().get(id);
}

export function storesForStation(station: number): readonly StoreCard[] {
  return STORE_CARDS.filter(card => card.selectable && card.stations.includes(station));
}

export interface StorePreset {
  id: string;
  label: string;
  /** Stations absent here are empty of weapons. External tanks are not touched. */
  stations: Readonly<Record<number, string>>;
}

export const STORE_PRESETS: StorePreset[] = [];

export function registerStorePresets(presets: readonly StorePreset[]): void {
  STORE_PRESETS.splice(0, STORE_PRESETS.length, ...presets);
}

/** Index 0 is unused. Index n is station n's store key, or null when empty. */
export function emptyLoad(): (string | null)[] {
  return Array<string | null>(12).fill(null);
}

export function loadFromPreset(id: string): (string | null)[] | null {
  const preset = STORE_PRESETS.find(item => item.id === id);
  if (!preset) return null;
  const load = emptyLoad();
  for (const [station, key] of Object.entries(preset.stations)) load[Number(station)] = key;
  return load;
}

export function withStation(load: readonly (string | null)[], station: number, key: string | null): (string | null)[] {
  const next = load.slice();
  next[station] = key;
  return next;
}

/** Wingtip AIM-9X, the checkbox beside the presets. Turning it off leaves another missile where it is. */
export function withAim9x(load: readonly (string | null)[], on: boolean): (string | null)[] {
  const next = load.slice();
  for (const station of [1, 11]) next[station] = on ? "aim-9x" : next[station] === "aim-9x" ? null : next[station];
  return next;
}

export function withGunPod(load: readonly (string | null)[], on: boolean): (string | null)[] {
  const next = load.slice();
  next[6] = on ? "gau-22-pod" : next[6] === "gau-22-pod" ? null : next[6];
  return next;
}

export function weaponMassLbs(load: readonly (string | null)[]): number {
  let mass = 0;
  for (const key of load) {
    if (key) mass += storeByKey(key)?.massLbs ?? 0;
  }
  return mass;
}

export interface MassPiece {
  station: number;
  massLbs: number;
  /** Set when this piece is the published store that exceeds the printed cell. */
  ratingException?: boolean;
}

export function payloadRefusal(weaponMassLbs: number): string | null {
  if (weaponMassLbs <= WEAPON_PAYLOAD_LIMIT_LBS) return null;
  return `Weapon payload is past ${WEAPON_PAYLOAD_LIMIT_LBS.toLocaleString("en-US")} lb.`;
}

/** Station ratings and the 15,000 lb card, checked separately. Masses may be synthetic. */
export function assessPieces(pieces: readonly MassPiece[]): string | null {
  let mass = 0;
  for (const piece of pieces) {
    const station = stationDefinition(piece.station);
    if (!station) return `Station ${piece.station} is not on this jet.`;
    if (piece.massLbs > station.ratingLbs && !piece.ratingException) {
      return `Station ${piece.station} is rated ${station.ratingLbs} lb.`;
    }
    mass += piece.massLbs;
  }
  return payloadRefusal(mass);
}

export interface RearmContext {
  /** The pilot's "Rearm on the ground only" setting, or a session rule that forces it on. */
  groundOnly: boolean;
  onGround: boolean;
  masterArm: boolean;
  /** Index by station. True when that station's external tank is attached. */
  tankOnStation?: readonly boolean[];
}

/** Why the load cannot change now. Jettison and bay doors never ask. */
export function rearmBlock(context: RearmContext): string | null {
  if (context.groundOnly && !context.onGround) return "Rearm waits for weight on the wheels.";
  if (context.masterArm) return "Safe the master arm before changing the load.";
  return null;
}

export function loadRefusal(load: readonly (string | null)[], context: { tankOnStation?: readonly boolean[] } = {}): string | null {
  const pieces: MassPiece[] = [];
  for (let station = 1; station <= 11; station++) {
    const key = load[station];
    if (!key) continue;
    const problem = pieceProblem(station, key, context.tankOnStation?.[station] === true);
    if (typeof problem === "string") return problem;
    pieces.push(problem);
  }
  return assessPieces(pieces);
}

export function rearmRefusal(load: readonly (string | null)[], context: RearmContext): string | null {
  return rearmBlock(context) ?? loadRefusal(load, context);
}

function pieceProblem(station: number, key: string, tankAttached: boolean): MassPiece | string {
  const definition = stationDefinition(station);
  if (!definition) return `Station ${station} is not on this jet.`;
  const card = storeByKey(key);
  if (!card) return "That store is not in the catalog.";
  if (!card.selectable) return card.refusal ?? `${card.label} is not selectable.`;
  if (!card.stations.includes(station)) return offStation(card, definition);
  if (tankAttached) return `Station ${station} is carrying the external tank.`;
  const exception = card.ratingException?.stations.includes(station) ?? false;
  return { station, massLbs: card.massLbs, ratingException: exception };
}

function offStation(card: StoreCard, station: StationDefinition): string {
  if (station.place === "wingtip") return `${card.label} is not hung on a wingtip.`;
  return `${card.label} is not hung on station ${station.station}.`;
}
