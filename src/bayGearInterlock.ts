import type { StorePropertyAccess } from "./storeAttachment";

/**
 * A door or gear value this close to an endpoint counts as there. A
 * development choice, not aircraft data.
 */
export const BAY_GEAR_LOCK_TOLERANCE = 0.001;

export interface BayGearInterlock {
  /**
   * The gear command to write this step. A new gear request shuts both bays
   * and holds the previous command until both door positions and commands
   * are shut. Nothing waiting, it returns at once without a property read.
   */
  gearCommand(requested: number): number;
  /**
   * Shut now, or open now when the gear rests at an endpoint. An open asked
   * for while the gear waits or moves is queued until the gear arrives.
   */
  requestBay(bay: 0 | 1, open: boolean): void;
  queued(bay: 0 | 1): boolean;
  /** After a load, reset or restore: take the plant's gear command and drop anything waiting. */
  resync(): void;
}

/**
 * Keeps the gear and the bay doors from moving together. The F-35B rig and
 * the AF267 belly were never cleared against each other in transit, so this
 * is a simulation integration rule, not a published F-35B operating rule. It
 * only holds a command; neither mechanism is moved or teleported. Both run
 * their own JSBSim kinematics.
 */
export function createBayGearInterlock(
  sdk: StorePropertyAccess,
  onBayCommand: (bay: 0 | 1, cmd: number) => void,
): BayGearInterlock {
  let applied = finite(sdk.getPropertyValue("gear/gear-cmd-norm"), 1);
  let pending: number | null = null;
  const waiting: [boolean, boolean] = [false, false];

  const shutBay = (bay: 0 | 1): void => {
    sdk.setPropertyValue(`stores/bay[${bay}]/door-cmd-norm`, 0);
    onBayCommand(bay, 0);
  };
  const openBay = (bay: 0 | 1): void => {
    sdk.setPropertyValue(`stores/bay[${bay}]/door-cmd-norm`, 1);
    onBayCommand(bay, 1);
  };
  // Reads both bays; asks any that are not commanded shut to shut. True once both are shut.
  const baysShut = (): boolean => {
    let shut = true;
    for (const bay of [0, 1] as const) {
      const cmd = finite(sdk.getPropertyValue(`stores/bay[${bay}]/door-cmd-norm`), 0);
      if (cmd > BAY_GEAR_LOCK_TOLERANCE) { shutBay(bay); shut = false; continue; }
      if (finite(sdk.getPropertyValue(`stores/bay[${bay}]/door-pos-norm`), 0) > BAY_GEAR_LOCK_TOLERANCE) shut = false;
    }
    return shut;
  };
  const gearLocked = (): boolean => {
    const position = finite(sdk.getPropertyValue("gear/gear-pos-norm"), applied);
    return atEndpoint(position, applied);
  };

  return {
    gearCommand(requested) {
      const want = finite(requested, applied);
      if (pending !== null || want !== applied) {
        // The pilot put the handle back: the gear never left, and the bays stay shut.
        if (want === applied) pending = null;
        else {
          pending = want;
          if (baysShut()) { applied = pending; pending = null; }
        }
      }
      if (pending === null && (waiting[0] || waiting[1]) && gearLocked()) {
        for (const bay of [0, 1] as const) {
          if (!waiting[bay]) continue;
          waiting[bay] = false;
          openBay(bay);
        }
      }
      return applied;
    },
    requestBay(bay, open) {
      if (!open) {
        waiting[bay] = false;
        shutBay(bay);
        return;
      }
      if (pending === null && gearLocked()) {
        waiting[bay] = false;
        openBay(bay);
      } else waiting[bay] = true;
    },
    queued(bay) {
      return waiting[bay];
    },
    resync() {
      applied = finite(sdk.getPropertyValue("gear/gear-cmd-norm"), applied);
      pending = null;
      waiting[0] = waiting[1] = false;
    },
  };
}

function atEndpoint(position: number, command: number): boolean {
  const low = BAY_GEAR_LOCK_TOLERANCE, high = 1 - BAY_GEAR_LOCK_TOLERANCE;
  return (position <= low && command <= low) || (position >= high && command >= high);
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
