import { stationDefinition } from "./stationTable";
import { storeById, storeByKey } from "./storeCatalog";

export interface StorePropertyAccess {
  getPropertyValue(path: string): number;
  setPropertyValue(path: string, value: number): void;
  queryPropertyCatalog?(prefix: string): string;
}

export interface StoreMirror {
  /** Index 0 is unused. Index n is station n. */
  load: (string | null)[];
  bayCmd: [number, number];
  bayPos: [number, number];
  gunRounds: number;
  masterArm: boolean;
}

const STATION_PROPERTY = "stores/station[1]/occupied";

/** True only when the loaded flight model declared weapon stations. Never invents them. */
export function aircraftHasWeaponStations(sdk: StorePropertyAccess): boolean {
  const catalog = sdk.queryPropertyCatalog?.(STATION_PROPERTY) ?? "";
  return catalog.split(/\r?\n/).some(line => line.trim().split(/\s+/)[0] === STATION_PROPERTY);
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** One read of the hung load. Call it when a flight is loaded or restored, not every frame. */
export function readStoreMirror(sdk: StorePropertyAccess): StoreMirror {
  const load = Array<string | null>(12).fill(null);
  for (let station = 1; station <= 11; station++) {
    const occupied = finite(sdk.getPropertyValue(`stores/station[${station}]/occupied`));
    const id = finite(sdk.getPropertyValue(`stores/station[${station}]/store-id`));
    load[station] = occupied > 0.5 ? storeById(id)?.key ?? null : null;
  }
  const bayPos: [number, number] = [0, 0];
  readBayDoorPositionsInto(sdk, bayPos);
  return {
    load,
    bayCmd: [
      finite(sdk.getPropertyValue("stores/bay[0]/door-cmd-norm")),
      finite(sdk.getPropertyValue("stores/bay[1]/door-cmd-norm")),
    ],
    bayPos,
    gunRounds: finite(sdk.getPropertyValue("stores/gun/rounds")),
    masterArm: finite(sdk.getPropertyValue("stores/master-arm")) > 0.5,
  };
}

/** Two reads. The caller uses this only while a door is still moving. */
export function readBayDoorPositionsInto(sdk: StorePropertyAccess, target: [number, number]): void {
  target[0] = finite(sdk.getPropertyValue("stores/bay[0]/door-pos-norm"));
  target[1] = finite(sdk.getPropertyValue("stores/bay[1]/door-pos-norm"));
}

/**
 * Hang a catalog store, or clear the station. Also writes the pointmass so a
 * zero-time step cannot show the previous weight. `gunRounds` is set only when
 * the centerline station changes.
 */
export function writeStation(sdk: StorePropertyAccess, station: number, key: string | null): { gunRounds: number | null } {
  const definition = stationDefinition(station);
  if (!definition) return { gunRounds: null };
  const card = key ? storeByKey(key) : undefined;
  if (key && (!card || !card.selectable)) return { gunRounds: null };
  const occupied = card ? 1 : 0;
  sdk.setPropertyValue(`stores/station[${station}]/occupied`, occupied);
  sdk.setPropertyValue(`stores/station[${station}]/store-id`, card?.id ?? 0);
  sdk.setPropertyValue(`stores/station[${station}]/mass-lbs`, card?.massLbs ?? 0);
  sdk.setPropertyValue(`stores/station[${station}]/drag-area-ft2`, card?.dragAreaFt2 ?? 0);
  sdk.setPropertyValue(`inertia/pointmass-weight-lbs[${definition.pointmassIndex}]`, occupied ? card?.massLbs ?? 0 : 0);
  if (definition.place !== "centerline") return { gunRounds: null };
  const gunRounds = card?.rounds ?? 0;
  sdk.setPropertyValue("stores/gun/rounds", gunRounds);
  return { gunRounds };
}

export function writeBayDoor(sdk: StorePropertyAccess, bay: 0 | 1, open: boolean): void {
  sdk.setPropertyValue(`stores/bay[${bay}]/door-cmd-norm`, open ? 1 : 0);
}

export function writeMasterArm(sdk: StorePropertyAccess, armed: boolean): void {
  sdk.setPropertyValue("stores/master-arm", armed ? 1 : 0);
}

export function writeGunRounds(sdk: StorePropertyAccess, rounds: number): void {
  sdk.setPropertyValue("stores/gun/rounds", rounds);
}

/** 1 while a round is leaving the pod. The flight model turns that into recoil. */
export function writeGunFiring(sdk: StorePropertyAccess, firing: boolean): void {
  sdk.setPropertyValue("stores/gun/firing", firing ? 1 : 0);
}
