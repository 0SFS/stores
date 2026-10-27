/**
 * F-35B structural CG, inches, from the plant mass balance. +X aft, +Y right,
 * +Z up. The same reference the external tanks use. This package does not
 * import the fuel package; the fly app coordinates the two.
 */
export const F35B_STRUCTURAL_REFERENCE_IN: { x: number; y: number; z: number } = { x: 368.52, y: 0, z: -15.36 };

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
 * Bay stores sit 0.40 m forward of the CG: the heavy station 0.60 m off
 * centerline, the light station 1.15 m. Their waterlines are the store fit's
 * centre lines inside the door fit's opening, 0.11 m and 0.09 m above the CG,
 * where every store the station carries clears the closed leaves. The gun pod
 * is 0.75 m below the CG on the centerline.
 */
export const STATIONS: readonly StationDefinition[] = [
  { station: 1, label: "1 right wingtip", place: "wingtip", side: "right", ratingLbs: 300, bay: null, fuelTankIndex: null, pointmassIndex: 2, locationIn: { x: 374.43, y: 210, z: -15.36 } },
  { station: 2, label: "2 right outboard", place: "outboard", side: "right", ratingLbs: 1500, bay: null, fuelTankIndex: null, pointmassIndex: 3, locationIn: { x: 371.91, y: 175, z: -15.36 } },
  { station: 3, label: "3 right inboard", place: "inboard", side: "right", ratingLbs: 5000, bay: null, fuelTankIndex: 2, pointmassIndex: 4, locationIn: { x: 368.52, y: 127.952756, z: -15.36 } },
  { station: 4, label: "4 right bay", place: "bay-heavy", side: "right", ratingLbs: 1500, bay: 0, fuelTankIndex: null, pointmassIndex: 5, locationIn: { x: 352.77, y: 23.62, z: -11.03 } },
  { station: 5, label: "5 right bay", place: "bay-light", side: "right", ratingLbs: 350, bay: 0, fuelTankIndex: null, pointmassIndex: 6, locationIn: { x: 352.77, y: 45.28, z: -11.82 } },
  { station: 6, label: "6 centerline", place: "centerline", side: "center", ratingLbs: 1000, bay: null, fuelTankIndex: null, pointmassIndex: 7, locationIn: { x: 368.52, y: 0, z: -44.89 } },
  { station: 7, label: "7 left bay", place: "bay-light", side: "left", ratingLbs: 350, bay: 1, fuelTankIndex: null, pointmassIndex: 8, locationIn: { x: 352.77, y: -45.28, z: -11.82 } },
  { station: 8, label: "8 left bay", place: "bay-heavy", side: "left", ratingLbs: 1500, bay: 1, fuelTankIndex: null, pointmassIndex: 9, locationIn: { x: 352.77, y: -23.62, z: -11.03 } },
  { station: 9, label: "9 left inboard", place: "inboard", side: "left", ratingLbs: 5000, bay: null, fuelTankIndex: 3, pointmassIndex: 10, locationIn: { x: 368.52, y: -127.952756, z: -15.36 } },
  { station: 10, label: "10 left outboard", place: "outboard", side: "left", ratingLbs: 1500, bay: null, fuelTankIndex: null, pointmassIndex: 11, locationIn: { x: 371.91, y: -175, z: -15.36 } },
  { station: 11, label: "11 left wingtip", place: "wingtip", side: "left", ratingLbs: 300, bay: null, fuelTankIndex: null, pointmassIndex: 12, locationIn: { x: 374.43, y: -210, z: -15.36 } },
];

/**
 * Where a store's procedural mesh hangs on its station, the same on the left
 * and right members of a pair. The station point stays the plant's mass and
 * drag point. A mesh fit to AF267 on 2026-10-24, not a station drawing.
 */
export interface StoreMeshFit {
  /** Store centre toward the centerline from the station, metres. */
  inboardM: number;
  /** Store centre above the station, metres. */
  upM: number;
  /** Pitch about the store centre. */
  noseDownRad: number;
}

/** The bay stations sit on these centre lines; the stores only pitch to follow the closed leaves. */
const BAY_HEAVY_FIT: StoreMeshFit = { inboardM: 0, upM: 0, noseDownRad: 3.25 * Math.PI / 180 };
const BAY_LIGHT_FIT: StoreMeshFit = { inboardM: 0, upM: 0, noseDownRad: 5 * Math.PI / 180 };

/**
 * Wing stores hang level, the top 20 mm under the lowest wing or flaperon
 * surface over them through the flaperon's whole animated travel. The
 * wingtip rail sits 0.244 m inboard so the widest fins end 20 mm inside the
 * tip. Those station points stay on the tank waterline, about where a pylon
 * would carry the store, and these meshes have no pylon. Bay stores sit 30 mm
 * over the closed leaves' inner faces and no nearer than 26 mm to the leaves
 * or the lining anywhere. The gun pod follows the belly, its top
 * 20 mm under it; its station point stays inside the box, 0.21 m under the
 * box centre.
 */
export const STORE_MESH_FITS: Readonly<Record<StationDefinition["place"], Readonly<Record<string, StoreMeshFit>>>> = {
  wingtip: {
    "aim-9x": { inboardM: 0.244, upM: 0.721, noseDownRad: 0 },
    asraam: { inboardM: 0.244, upM: 0.704, noseDownRad: 0 },
  },
  outboard: {
    "aim-9x": { inboardM: 0, upM: 0.692, noseDownRad: 0 },
    asraam: { inboardM: 0, upM: 0.674, noseDownRad: 0 },
    "paveway-iv": { inboardM: 0, upM: 0.575, noseDownRad: 0 },
  },
  inboard: {
    "paveway-iv": { inboardM: 0, upM: 0.533, noseDownRad: 0 },
  },
  "bay-heavy": { "aim-120": BAY_HEAVY_FIT, "gbu-12": BAY_HEAVY_FIT, "gbu-32": BAY_HEAVY_FIT, "paveway-iv": BAY_HEAVY_FIT },
  "bay-light": { "aim-120": BAY_LIGHT_FIT },
  centerline: { "gau-22-pod": { inboardM: 0, upM: 0.21, noseDownRad: 4 * Math.PI / 180 } },
};

const UNFITTED: StoreMeshFit = { inboardM: 0, upM: 0, noseDownRad: 0 };

/** The store centre from its station root on `aircraft.modelRoot`, metres, and its nose-down pitch. */
export function storeMeshPlacement(station: StationDefinition, storeKey: string): { x: number; y: number; z: number; noseDownRad: number } {
  const fit = STORE_MESH_FITS[station.place][storeKey] ?? UNFITTED;
  // +X is left, so a left station's inboard is -X.
  const inboard = station.side === "left" ? -1 : station.side === "right" ? 1 : 0;
  return { x: inboard * fit.inboardM, y: fit.upM, z: 0, noseDownRad: fit.noseDownRad };
}

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

export interface BayLeafDefinition {
  leaf: "inboard" | "outboard";
  /**
   * Straight hinge line on `aircraft.modelRoot`, metres, A aft and B forward.
   * A is the pivot. Both ends lie on the AF267 lower skin. An AF267 visual
   * fit, not a hinge drawing or survey.
   */
  hingeAft: { x: number; y: number; z: number };
  hingeForward: { x: number; y: number; z: number };
  /** Sign of the right-hand rotation about A→B that swings this leaf open. */
  openSign: -1 | 1;
  /**
   * Exterior plan outline, (x, z) metres around the face. The serrated ends
   * are traced from photographs (F-35B/docs/proposals/f35b-weapon-bay-door-serrations.md),
   * a visual fit, not a drawing. The edge at the hinge's x is the hinged edge.
   * Any line x = constant crosses the outline once.
   */
  outline: readonly (readonly [number, number])[];
}

export interface BayDefinition {
  bay: 0 | 1;
  label: string;
  /** Inboard and outboard leaves. Both follow the bay's one door position. */
  leaves: readonly [BayLeafDefinition, BayLeafDefinition];
}

// Aft end hinge to free edge, then forward end free edge to hinge. The outboard aft end is
// the inboard one scaled to its width: no photograph shows it.
const INBOARD_OUTLINE = [
  [0.350, -1.520], [0.453, -1.580], [0.530, -1.530], [0.633, -1.600], [0.714, -1.535], [0.802, -1.590], [0.894, -1.520],
  [0.894, 2.320], [0.840, 2.455], [0.742, 2.415], [0.617, 2.500], [0.464, 2.415], [0.350, 2.210],
] as const;
const OUTBOARD_OUTLINE = [
  [0.906, -1.524], [0.993, -1.591], [1.076, -1.539], [1.153, -1.600], [1.250, -1.534], [1.322, -1.581], [1.420, -1.524],
  [1.420, 2.200], [1.261, 2.500], [1.163, 2.435], [1.081, 2.495], [0.906, 2.360],
] as const;
const sided = (outline: readonly (readonly [number, number])[], side: -1 | 1) =>
  outline.map(([x, z]) => [side * x, z] as const);

/**
 * The AF267 weapon-bay door fit (F-35B/docs/proposals/f35b-weapon-bay-door-geometry.md).
 * Hinge lines, outlines, thickness and the skin band are visual fits to the
 * mesh, not aircraft station or hinge drawings. Bay 0 is the pilot's right,
 * stations 4 and 5, which is itself an assumption the briefs do not settle.
 */
export const BAYS: readonly BayDefinition[] = [
  { bay: 0, label: "Right bay", leaves: [
    { leaf: "inboard", hingeAft: { x: -0.35, y: 0.033099, z: -1.6 }, hingeForward: { x: -0.35, y: -0.153644, z: 2.5 }, openSign: 1, outline: sided(INBOARD_OUTLINE, -1) },
    { leaf: "outboard", hingeAft: { x: -1.42, y: 0.204225, z: -1.6 }, hingeForward: { x: -1.42, y: -0.098552, z: 2.5 }, openSign: -1, outline: sided(OUTBOARD_OUTLINE, -1) },
  ] },
  { bay: 1, label: "Left bay", leaves: [
    { leaf: "inboard", hingeAft: { x: 0.35, y: 0.033099, z: -1.6 }, hingeForward: { x: 0.35, y: -0.153644, z: 2.5 }, openSign: -1, outline: sided(INBOARD_OUTLINE, 1) },
    { leaf: "outboard", hingeAft: { x: 1.42, y: 0.204225, z: -1.6 }, hingeForward: { x: 1.42, y: -0.098552, z: 2.5 }, openSign: 1, outline: sided(OUTBOARD_OUTLINE, 1) },
  ] },
];

/** The fit's skin adaptation and lining, metres. Development choices, not aircraft data. */
export const BAY_DOOR_FIT = {
  /** Panel strip beside the hinge reprofiled from the skin onto the straight rail. */
  hingeBand: 0.12,
  /** Shell thickness, toward body +Y in the closed pose; the exterior stays on the skin. */
  shellThickness: 0.018,
  /**
   * Plan width of the bevel through the shell along the serrated ends. A
   * square edge there sweeps through the fixed skin between the teeth as the leaf opens.
   */
  endBevel: 0.018,
  /** Fixed skin on the far side of a hinge, and beyond each leaf end, blends back to the skin over this. */
  fixedBlend: 0.08,
  /** Opening seam cut outward into the stationary skin at every non-hinged edge, never past the bay's end lines by more. */
  seam: 0.003,
  /** Lining jamb set back from each hinge line, room for the shell's hinge edge to turn. */
  hingeRelief: 0.025,
  /** Aft jamb relief: the canted hinges carry open aft teeth to Z -1.616. */
  aftJambRelief: 0.035,
  /** Lining clearance from every existing surface above it. */
  liningClearance: 0.03,
} as const;

/**
 * Code One's inboard-door launch angle. Applying it to the outboard leaf is a
 * simulation convention; no outboard travel was published. The powered-lift
 * fountain-fence position, about 45 degrees, is deferred. The rectangular
 * gun-pod stand-in, seated under the belly, meets the inboard leaves from
 * about 47 degrees on; the travel is not shortened to hide that, and no pod
 * clearance is claimed.
 */
export let DOOR_OPEN_RAD = 97 * Math.PI / 180;

/**
 * Development stand-in for an unpublished slew. The plant kinematic uses this
 * same 1.5 s. It is not a measured door time.
 */
export let DOOR_FULL_TRAVEL_SECONDS = 1.5;

/** An internal store stays hidden until the door has opened this far. */
export let INTERNAL_STORE_VISIBLE_AT = 0.2;

export interface PayloadInstallationRegistration {
  structuralReferenceIn: { x: number; y: number; z: number };
  stations: readonly StationDefinition[];
  meshFits: typeof STORE_MESH_FITS;
  bays: readonly BayDefinition[];
  bayDoorFit: typeof BAY_DOOR_FIT;
  doorOpenRad: number;
  doorFullTravelSeconds: number;
  internalStoreVisibleAt: number;
}

/** Replaces the station, mesh-fit and bay-door tables with an aircraft mod's installation. */
export function registerPayloadInstallation(installation: PayloadInstallationRegistration): void {
  Object.assign(F35B_STRUCTURAL_REFERENCE_IN, installation.structuralReferenceIn);
  const stations = STATIONS as StationDefinition[];
  stations.splice(0, stations.length, ...installation.stations);
  for (const place of Object.keys(STORE_MESH_FITS) as (keyof typeof STORE_MESH_FITS)[]) {
    const target = STORE_MESH_FITS[place] as Record<string, StoreMeshFit>;
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, installation.meshFits[place]);
  }
  const bays = BAYS as BayDefinition[];
  bays.splice(0, bays.length, ...installation.bays);
  Object.assign(BAY_DOOR_FIT, installation.bayDoorFit);
  DOOR_OPEN_RAD = installation.doorOpenRad;
  DOOR_FULL_TRAVEL_SECONDS = installation.doorFullTravelSeconds;
  INTERNAL_STORE_VISIBLE_AT = installation.internalStoreVisibleAt;
}
