/**
 * F-35B structural CG, inches, from the plant mass balance. +X aft, +Y right,
 * +Z up. The same reference the external tanks use. This package does not
 * import the fuel package; the fly app coordinates the two.
 */
export const F35B_STRUCTURAL_REFERENCE_IN = { x: 368.52, y: 0, z: -15.36 } as const;

/** Flight body on `aircraft.modelRoot`: +X left, +Y up, +Z forward. */
export function bodyMetersFromStructural(locationIn: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const cg = F35B_STRUCTURAL_REFERENCE_IN;
  return {
    x: -locationIn.y * 0.0254,
    y: (locationIn.z - cg.z) * 0.0254,
    z: (cg.x - locationIn.x) * 0.0254,
  };
}

export interface StationDefinition {
  /** Briefing number, 1 through 11. Saved flights store this, not a rearranged index. */
  station: number;
  label: string;
  place: "wingtip" | "outboard" | "inboard" | "bay-heavy" | "bay-light" | "centerline";
  /** The briefs never say which number is port. Positive structural Y is the pilot's right. */
  side: "right" | "left" | "center";
  /** March 2010 STOVL column, pounds. */
  ratingLbs: number;
  /** 0 is the right bay (stations 4 and 5). 1 is the left bay (stations 7 and 8). */
  bay: 0 | 1 | null;
  /** JSBSim fuel-tank index that shares this station, when the external tank does. */
  fuelTankIndex: number | null;
  /**
   * Pointmass index. The external tanks already occupy 0 and 1, so station n
   * is pointmass n + 1.
   */
  pointmassIndex: number;
  /** Structural inches. A mesh fit to AF267, not a station drawing. */
  locationIn: { x: number; y: number; z: number };
}

/**
 * Stations 1–5 are the right wing, 11–7 the left, 6 the centerline.
 * Wing stores share the external tanks' waterline, which the tank mesh already
 * sits on. The wingtips are at half of 35 ft and 0.15 m aft of the CG. The
 * outboard pair is halfway from the tank station to that tip, swept in proportion.
 * Bay stores sit 0.40 m below the CG and 0.40 m forward of it: the heavy
 * station 0.60 m off centerline, the light station 1.15 m. The gun pod is
 * 0.75 m below the CG on the centerline.
 */
export const STATIONS: readonly StationDefinition[] = [
  { station: 1, label: "1 right wingtip", place: "wingtip", side: "right", ratingLbs: 300, bay: null, fuelTankIndex: null, pointmassIndex: 2, locationIn: { x: 374.43, y: 210, z: -15.36 } },
  { station: 2, label: "2 right outboard", place: "outboard", side: "right", ratingLbs: 1500, bay: null, fuelTankIndex: null, pointmassIndex: 3, locationIn: { x: 371.91, y: 175, z: -15.36 } },
  { station: 3, label: "3 right inboard", place: "inboard", side: "right", ratingLbs: 5000, bay: null, fuelTankIndex: 2, pointmassIndex: 4, locationIn: { x: 368.52, y: 127.952756, z: -15.36 } },
  { station: 4, label: "4 right bay", place: "bay-heavy", side: "right", ratingLbs: 1500, bay: 0, fuelTankIndex: null, pointmassIndex: 5, locationIn: { x: 352.77, y: 23.62, z: -31.11 } },
  { station: 5, label: "5 right bay", place: "bay-light", side: "right", ratingLbs: 350, bay: 0, fuelTankIndex: null, pointmassIndex: 6, locationIn: { x: 352.77, y: 45.28, z: -31.11 } },
  { station: 6, label: "6 centerline", place: "centerline", side: "center", ratingLbs: 1000, bay: null, fuelTankIndex: null, pointmassIndex: 7, locationIn: { x: 368.52, y: 0, z: -44.89 } },
  { station: 7, label: "7 left bay", place: "bay-light", side: "left", ratingLbs: 350, bay: 1, fuelTankIndex: null, pointmassIndex: 8, locationIn: { x: 352.77, y: -45.28, z: -31.11 } },
  { station: 8, label: "8 left bay", place: "bay-heavy", side: "left", ratingLbs: 1500, bay: 1, fuelTankIndex: null, pointmassIndex: 9, locationIn: { x: 352.77, y: -23.62, z: -31.11 } },
  { station: 9, label: "9 left inboard", place: "inboard", side: "left", ratingLbs: 5000, bay: null, fuelTankIndex: 3, pointmassIndex: 10, locationIn: { x: 368.52, y: -127.952756, z: -15.36 } },
  { station: 10, label: "10 left outboard", place: "outboard", side: "left", ratingLbs: 1500, bay: null, fuelTankIndex: null, pointmassIndex: 11, locationIn: { x: 371.91, y: -175, z: -15.36 } },
  { station: 11, label: "11 left wingtip", place: "wingtip", side: "left", ratingLbs: 300, bay: null, fuelTankIndex: null, pointmassIndex: 12, locationIn: { x: 374.43, y: -210, z: -15.36 } },
];

export function stationDefinition(station: number): StationDefinition | undefined {
  const found = STATIONS[station - 1];
  return found?.station === station ? found : undefined;
}

export function stationForFuelTank(fuelTankIndex: number): number | null {
  return STATIONS.find(station => station.fuelTankIndex === fuelTankIndex)?.station ?? null;
}

/** Index by station number. True where an attached fuel tank occupies the station. */
export function tankOnStation(attachedFuelTankIndices: readonly number[]): boolean[] {
  const flags = Array<boolean>(12).fill(false);
  for (const index of attachedFuelTankIndices) {
    const station = stationForFuelTank(index);
    if (station) flags[station] = true;
  }
  return flags;
}

export interface BayDefinition {
  bay: 0 | 1;
  label: string;
  /** Body meters. The hinge is outboard of the light station so the panel covers both bay stores. */
  hingeMeters: { x: number; y: number; z: number };
  /** Sign of a body-Z rotation that swings the panel down. */
  openSign: -1 | 1;
}

export const BAYS: readonly BayDefinition[] = [
  { bay: 0, label: "Right bay", hingeMeters: { x: -1.4, y: -0.3, z: 0.4 }, openSign: -1 },
  { bay: 1, label: "Left bay", hingeMeters: { x: 1.4, y: -0.3, z: 0.4 }, openSign: 1 },
];

/** Code One's inboard-door launch angle. Not a measured hinge survey. */
export const DOOR_OPEN_RAD = 97 * Math.PI / 180;

/**
 * Development stand-in for an unpublished slew. The plant kinematic uses this
 * same 1.5 s. It is not a measured door time.
 */
export const DOOR_FULL_TRAVEL_SECONDS = 1.5;

/** An internal store stays hidden until the door has opened this far. */
export const INTERNAL_STORE_VISIBLE_AT = 0.2;

export const DOOR_PANEL_M = { width: 0.9, length: 2.2, thickness: 0.04 } as const;
