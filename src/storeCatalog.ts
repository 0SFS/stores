import { stationDefinition, type StationDefinition } from "./stationTable";

/** Weapons only. Fuel and the tanks' dry mass stay out of this sum. */
export const WEAPON_PAYLOAD_LIMIT_LBS = 15_000;

/** Frontal disk at Cd = 1, rounded to 0.001 ft². A stand-in drag, not a measured Cd. */
function diskFt2(diameterIn: number): number {
  const radiusFt = diameterIn / 24;
  return Math.round(Math.PI * radiusFt * radiusFt * 1000) / 1000;
}

/** 14 in body used where a diameter was not published. See Stores.NOTICE.md. */
const STAND_IN_DIAMETER_M = 14 * 0.0254;

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

const AIM_120_MASS_LBS = 356;
const GBU_32_MASS_LBS = 1013;
const GUN_POD_MASS_LBS = 1017;

export const STORE_CARDS: readonly StoreCard[] = [
  {
    id: 1, key: "aim-120", label: "AIM-120", massLbs: AIM_120_MASS_LBS,
    dragAreaFt2: diskFt2(7), stations: [4, 5, 7, 8], selectable: true, refusal: null,
    ratingException: { stations: [5, 7], cellLbs: 350 },
    lengthM: 12 * 0.3048, diameterM: 7 * 0.0254, spanM: 19 * 0.0254, boxM: null,
    meshStandIn: false, rounds: null,
    massNote: "356 lb is the Navy fact file. NAVAIR prints 358 lb for the D.",
  },
  {
    id: 2, key: "gbu-12", label: "GBU-12", massLbs: 500, dragAreaFt2: 1,
    stations: [4, 8], selectable: true, refusal: null, ratingException: null,
    lengthM: (10 * 12 + 9) * 0.0254, diameterM: STAND_IN_DIAMETER_M, spanM: null, boxM: null,
    meshStandIn: true, rounds: null,
    massNote: "500 lb is the class figure. The caption does not split body from fin.",
  },
  {
    id: 3, key: "gbu-32", label: "GBU-32", massLbs: GBU_32_MASS_LBS, dragAreaFt2: 1,
    stations: [4, 8], selectable: true, refusal: null, ratingException: null,
    lengthM: 119.5 * 0.0254, diameterM: STAND_IN_DIAMETER_M, spanM: 19.6 * 0.0254, boxM: null,
    meshStandIn: true, rounds: null,
    massNote: "1,013 lb. The bay is described as the 1,000 lb class, and stations 4 and 8 are rated 1,500 lb.",
  },
  {
    id: 4, key: "aim-9x", label: "AIM-9X", massLbs: 186, dragAreaFt2: diskFt2(5),
    stations: [1, 11, 2, 10], selectable: true, refusal: null, ratingException: null,
    lengthM: 9.9 * 0.3048, diameterM: 5 * 0.0254, spanM: 17.6 * 0.0254, boxM: null,
    meshStandIn: false, rounds: null, massNote: null,
  },
  {
    id: 5, key: "asraam", label: "ASRAAM", massLbs: 194, dragAreaFt2: diskFt2(166 / 25.4),
    stations: [1, 11, 2, 10], selectable: true, refusal: null, ratingException: null,
    lengthM: 2.9, diameterM: 0.166, spanM: null, boxM: null,
    meshStandIn: false, rounds: null,
    massNote: "88 kg, taken as 194 lb. Fin span is unpublished, so the mesh is the body.",
  },
  {
    id: 6, key: "paveway-iv", label: "Paveway IV", massLbs: 500, dragAreaFt2: 1,
    stations: [4, 8, 2, 3, 9, 10], selectable: true, refusal: null, ratingException: null,
    lengthM: 10 * 0.3048, diameterM: STAND_IN_DIAMETER_M, spanM: null, boxM: null,
    meshStandIn: true, rounds: null,
    massNote: "500 lb is the class figure. Length and diameter are unpublished.",
  },
  {
    id: 7, key: "gau-22-pod", label: "GAU-22/A pod", massLbs: GUN_POD_MASS_LBS, dragAreaFt2: 6,
    stations: [6], selectable: true, refusal: null,
    ratingException: { stations: [6], cellLbs: 1000 },
    lengthM: null, diameterM: null, spanM: null,
    boxM: { length: 146 * 0.0254, width: 27 * 0.0254, height: 32 * 0.0254 },
    meshStandIn: false, rounds: 220,
    massNote: "1,017 lb loaded. The centerline cell is 1,000 lb. Empty weight is unpublished, so the pod stays 1,017 lb.",
  },
  refused("gbu-31", "GBU-31", "GBU-31 is a 2,000 lb store. This bay is the 1,000 lb class."),
  refused("jsm", "JSM", "JSM is not a selectable F-35B store."),
  refused("sidekick", "Sidekick", "Sidekick is an adapter, not a store on this jet."),
  refused("b61-12", "B61-12", "B61-12 is not carried in this simulator."),
  refused("aim-260", "AIM-260", "AIM-260 is not a selectable F-35B store."),
  refused("meteor", "Meteor", "Meteor is not a selectable F-35B store."),
  refused("spear-3", "SPEAR 3", "SPEAR 3 is not a selectable F-35B store."),
  refused("stormbreaker", "StormBreaker", "StormBreaker is not a selectable F-35B store."),
];

function refused(key: string, label: string, refusal: string): StoreCard {
  return {
    id: 0, key, label, massLbs: 0, dragAreaFt2: 0, stations: [], selectable: false, refusal,
    ratingException: null, lengthM: null, diameterM: null, spanM: null, boxM: null,
    meshStandIn: false, rounds: null, massNote: null,
  };
}

const BY_KEY = new Map(STORE_CARDS.map(card => [card.key, card]));
const BY_ID = new Map(STORE_CARDS.filter(card => card.selectable).map(card => [card.id, card]));

export function storeByKey(key: string): StoreCard | undefined {
  return BY_KEY.get(key);
}

export function storeById(id: number): StoreCard | undefined {
  return id === 0 ? undefined : BY_ID.get(id);
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

export const STORE_PRESETS: readonly StorePreset[] = [
  { id: "clean", label: "Clean", stations: {} },
  { id: "usmc-strike", label: "USMC strike", stations: { 4: "gbu-32", 8: "gbu-32", 5: "aim-120", 7: "aim-120" } },
  { id: "usmc-air-to-air", label: "USMC air-to-air", stations: { 4: "aim-120", 5: "aim-120", 7: "aim-120", 8: "aim-120" } },
  { id: "uk", label: "UK", stations: { 4: "paveway-iv", 8: "paveway-iv", 1: "asraam", 11: "asraam" } },
];

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
  onGround: boolean;
  masterArm: boolean;
  /** Index by station. True when that station's external tank is attached. */
  tankOnStation?: readonly boolean[];
}

export function rearmBlock(context: RearmContext): string | null {
  if (!context.onGround) return "Rearm waits for weight on the wheels.";
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
