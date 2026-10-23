const TANK_ATTACHMENT = /^stores\/external-tank(?:\[\d+\])?\/attached$/;
const STATION_INPUT = /^stores\/station\[\d+\]\/(?:occupied|store-id|mass-lbs|drag-area-ft2)$/;
const DOOR = /^stores\/bay\[\d+\]\/door-(?:cmd|pos)-norm$/;

/** A store input a snapshot may replay. Derived drag force stays out. */
export function isWeaponStoreProperty(property: string): boolean {
  return STATION_INPUT.test(property) || DOOR.test(property)
    || property === "stores/gun/rounds" || property === "stores/master-arm";
}

/**
 * Store commands a runway change keeps. Tank attachment is included so the
 * fuel tanks and the hung weapons travel together.
 */
export function isPersistedStoreProperty(property: string): boolean {
  return TANK_ATTACHMENT.test(property) || isWeaponStoreProperty(property);
}
