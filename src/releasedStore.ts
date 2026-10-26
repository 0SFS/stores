import { Matrix, Quaternion, type TransformNode } from "@babylonjs/core";

/**
 * A store that has left the aircraft: an external fuel tank or a jettisoned
 * weapon. ECEF doubles, so floating-origin rebases cannot drift it. The
 * motion is visual only: radial gravity, no collision, no aerodynamics.
 */
export interface ReleasedStore {
  position: Float64Array;
  velocity: Float64Array;
  /** Three ECEF basis vectors, preserving release attitude across rebases. */
  axes: Float64Array;
  age: number;
  serial: number;
}

const GRAVITY_METERS_PER_SECOND_SQUARED = 9.80665;
const scratch = Matrix.Identity();

/** Inverse of the floating origin's orthonormal rotation, kept in doubles. */
function toEcefVector(m: ArrayLike<number>, x: number, y: number, z: number, target: Float64Array, offset = 0): void {
  target[offset] = m[0] * x + m[1] * y + m[2] * z;
  target[offset + 1] = m[4] * x + m[5] * y + m[6] * z;
  target[offset + 2] = m[8] * x + m[9] * y + m[10] * z;
}

/**
 * Capture a mount's world pose and the aircraft's scene east/up/south ground
 * velocity, metres per second. Null when the velocity is not finite.
 */
export function releaseStore(
  mount: TransformNode,
  worldVelocity: { readonly x: number; readonly y: number; readonly z: number },
  worldFromEcef: ArrayLike<number>,
  serial: number,
): ReleasedStore | null {
  if (!Number.isFinite(worldVelocity.x) || !Number.isFinite(worldVelocity.y) || !Number.isFinite(worldVelocity.z)) return null;
  const m = worldFromEcef, world = mount.computeWorldMatrix(true).m;
  const position = new Float64Array(3), velocity = new Float64Array(3), axes = new Float64Array(9);
  toEcefVector(m, world[12] - m[12], world[13] - m[13], world[14] - m[14], position);
  toEcefVector(m, worldVelocity.x, worldVelocity.y, worldVelocity.z, velocity);
  for (let axis = 0; axis < 3; axis++) toEcefVector(m, world[axis * 4], world[axis * 4 + 1], world[axis * 4 + 2], axes, axis * 3);
  return { position, velocity, axes, age: 0, serial };
}

/** Age and fall by Earth-fixed radial gravity. Zero time does nothing. */
export function stepReleasedStore(store: ReleasedStore, dt: number): void {
  if (!(dt > 0)) return;
  store.age += dt;
  const p = store.position, v = store.velocity;
  const radius = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
  if (radius > 0) for (let axis = 0; axis < 3; axis++) {
    const acceleration = -GRAVITY_METERS_PER_SECOND_SQUARED * p[axis] / radius;
    p[axis] += v[axis] * dt + 0.5 * acceleration * dt * dt;
    v[axis] += acceleration * dt;
  }
}

/**
 * Pose the falling node in the current floating-origin frame. The node needs
 * a rotation quaternion. Returns true when the pose changed.
 */
export function projectReleasedStore(store: ReleasedStore, m: ArrayLike<number>, node: TransformNode): boolean {
  const p = store.position;
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const changed = node.position.x !== x || node.position.y !== y || node.position.z !== z;
  node.position.set(x, y, z);
  const a = store.axes;
  Matrix.FromValuesToRef(
    m[0] * a[0] + m[4] * a[1] + m[8] * a[2], m[1] * a[0] + m[5] * a[1] + m[9] * a[2], m[2] * a[0] + m[6] * a[1] + m[10] * a[2], 0,
    m[0] * a[3] + m[4] * a[4] + m[8] * a[5], m[1] * a[3] + m[5] * a[4] + m[9] * a[5], m[2] * a[3] + m[6] * a[4] + m[10] * a[5], 0,
    m[0] * a[6] + m[4] * a[7] + m[8] * a[8], m[1] * a[6] + m[5] * a[7] + m[9] * a[8], m[2] * a[6] + m[6] * a[7] + m[10] * a[8], 0,
    0, 0, 0, 1, scratch,
  );
  const q = node.rotationQuaternion!;
  const previousX = q.x, previousY = q.y, previousZ = q.z, previousW = q.w;
  Quaternion.FromRotationMatrixToRef(scratch, q);
  return changed || q.x !== previousX || q.y !== previousY || q.z !== previousZ || q.w !== previousW;
}

/**
 * The shared debris budget: newest first, keep at most `maximum`, none past
 * `lifetime`. Returns the slots whose release should be hidden.
 */
export function releasedPastBudget<T extends { released: ReleasedStore | null }>(
  slots: readonly T[], maximum: number, lifetime: number,
): T[] {
  const released = slots.filter(slot => slot.released !== null).sort((a, b) => b.released!.serial - a.released!.serial);
  return released.filter((slot, i) => i >= maximum || slot.released!.age >= lifetime);
}
