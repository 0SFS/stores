/**
 * The AF267 weapon-bay door fit as plain geometry, on `aircraft.modelRoot`
 * (+X left, +Y up, +Z forward), metres. Four leaf shells cut from the lower
 * fuselage skin, that skin with the four openings, and a stand-in bay lining.
 * The recipe and every number are F-35B/docs/proposals/f35b-weapon-bay-door-geometry.md:
 * nothing here is a second fit. Built once when the airframe loads.
 */
import { BAYS, BAY_DOOR_FIT, type BayDefinition, type BayLeafDefinition } from "./stationTable";

export type Vec3 = [number, number, number];

/** One source primitive in the body frame. */
export interface SkinPrimitive {
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  uvs: ArrayLike<number> | null;
  indices: ArrayLike<number>;
}

export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  indices: Uint32Array;
}

export interface LeafShell {
  bay: 0 | 1;
  leaf: BayLeafDefinition["leaf"];
  /** Hinge A, the pivot. Shell vertices are stored as P - A. */
  pivot: Vec3;
  /** Unit A→B. */
  axis: Vec3;
  openSign: -1 | 1;
  /** The clipped and reprofiled lower skin, by source primitive, with its UVs. */
  exterior: { source: number; mesh: MeshArrays }[];
  /** The inner face 18 mm above, and the edge caps. */
  interior: MeshArrays;
}

export interface BayDoorFit {
  leaves: LeafShell[];
  /** Each source primitive with the openings cut and the rails stitched, or null where it is unchanged. */
  skins: (MeshArrays | null)[];
  /** The stand-in recess above both openings. */
  lining: MeshArrays;
}

/** A clipped vertex: position, normal, uv. */
type V = Float64Array;
const STRIDE = 8;

const ON_SKIN = 1e-5;
const CLIP_EPS = 1e-9;
const ON_LINE = 1e-7;

/** Right-hand rotation of `p` about the line through `pivot` along unit `axis`. */
export function rotateAboutHinge(p: Vec3, pivot: Vec3, axis: Vec3, theta: number): Vec3 {
  const v: Vec3 = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
  const c = Math.cos(theta), s = Math.sin(theta), d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
  const k: Vec3 = [axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2], axis[0] * v[1] - axis[1] * v[0]];
  return [0, 1, 2].map(i => pivot[i] + v[i] * c + k[i] * s + axis[i] * d * (1 - c)) as Vec3;
}

export function leafPivot(leaf: BayLeafDefinition): Vec3 {
  return [leaf.hingeAft.x, leaf.hingeAft.y, leaf.hingeAft.z];
}

export function leafAxis(leaf: BayLeafDefinition): Vec3 {
  const d: Vec3 = [leaf.hingeForward.x - leaf.hingeAft.x, leaf.hingeForward.y - leaf.hingeAft.y, leaf.hingeForward.z - leaf.hingeAft.z];
  const length = Math.hypot(...d);
  return [d[0] / length, d[1] / length, d[2] / length];
}

// ---------------------------------------------------------------------------
// The skin sampler: every source triangle, bucketed in plan.

interface Tri { ax: number; ay: number; az: number; bx: number; by: number; bz: number; cx: number; cy: number; cz: number; den: number }

/** Every fuselage triangle that can lie over the bays, for vertical-line queries. */
class SkinSampler {
  private readonly cells: Tri[][];
  private readonly x0 = -2; private readonly z0 = -2.2; private readonly size = 0.1;
  private readonly nx = 40; private readonly nz = 54;

  constructor(primitives: readonly SkinPrimitive[]) {
    this.cells = Array.from({ length: this.nx * this.nz }, () => []);
    for (const primitive of primitives) {
      const p = primitive.positions, idx = primitive.indices;
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const a = 3 * idx[t]!, b = 3 * idx[t + 1]!, c = 3 * idx[t + 2]!;
        const tri: Tri = {
          ax: p[a]!, ay: p[a + 1]!, az: p[a + 2]!, bx: p[b]!, by: p[b + 1]!, bz: p[b + 2]!, cx: p[c]!, cy: p[c + 1]!, cz: p[c + 2]!, den: 0,
        };
        tri.den = (tri.bz - tri.cz) * (tri.ax - tri.cx) + (tri.cx - tri.bx) * (tri.az - tri.cz);
        // A vertical triangle has no height on a vertical line.
        if (Math.abs(tri.den) < 1e-11) continue;
        // Padded by the hit tolerance, so a point on a cell edge finds the triangle from either cell.
        const i0 = Math.floor((Math.min(tri.ax, tri.bx, tri.cx) - 1e-6 - this.x0) / this.size);
        const i1 = Math.floor((Math.max(tri.ax, tri.bx, tri.cx) + 1e-6 - this.x0) / this.size);
        const j0 = Math.floor((Math.min(tri.az, tri.bz, tri.cz) - 1e-6 - this.z0) / this.size);
        const j1 = Math.floor((Math.max(tri.az, tri.bz, tri.cz) + 1e-6 - this.z0) / this.size);
        if (i1 < 0 || i0 >= this.nx || j1 < 0 || j0 >= this.nz) continue;
        for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) {
          for (let j = Math.max(0, j0); j <= Math.min(this.nz - 1, j1); j++) this.cells[i * this.nz + j]!.push(tri);
        }
      }
    }
  }

  /** Every intersection of the vertical line at (x, z), with the hit triangle's plan gradient. */
  hits(x: number, z: number, visit: (y: number, gx: number, gz: number) => void): void {
    const i = Math.floor((x - this.x0) / this.size), j = Math.floor((z - this.z0) / this.size);
    if (i < 0 || i >= this.nx || j < 0 || j >= this.nz) return;
    for (const t of this.cells[i * this.nz + j]!) {
      const u = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / t.den;
      const v = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / t.den;
      if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) continue;
      const y = u * t.ay + v * t.by + (1 - u - v) * t.cy;
      const gx = ((t.ay - t.cy) * (t.bz - t.cz) + (t.by - t.cy) * (t.cz - t.az)) / t.den;
      const gz = ((t.ay - t.cy) * (t.cx - t.bx) + (t.by - t.cy) * (t.ax - t.cx)) / t.den;
      visit(y, gx, gz);
    }
  }

  /**
   * Points along every edge of the triangles above the lower skin in a plan
   * rectangle, no more than `spacing` apart, corners included.
   */
  upperEdges(x0: number, x1: number, z0: number, z1: number, spacing: number, visit: (x: number, y: number, z: number) => void): void {
    const seen = new Set<Tri>();
    const i0 = Math.max(0, Math.floor((x0 - this.x0) / this.size)), i1 = Math.min(this.nx - 1, Math.floor((x1 - this.x0) / this.size));
    const j0 = Math.max(0, Math.floor((z0 - this.z0) / this.size)), j1 = Math.min(this.nz - 1, Math.floor((z1 - this.z0) / this.size));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      for (const t of this.cells[i * this.nz + j]!) {
        if (seen.has(t)) continue;
        seen.add(t);
        const cx = (t.ax + t.bx + t.cx) / 3, cz = (t.az + t.bz + t.cz) / 3, skin = this.lowest(cx, cz);
        if (!skin || (t.ay + t.by + t.cy) / 3 <= skin.y + 1e-4) continue;
        const corners = [[t.ax, t.ay, t.az], [t.bx, t.by, t.bz], [t.cx, t.cy, t.cz]] as const;
        for (let k = 0; k < 3; k++) {
          const p = corners[k]!, q = corners[(k + 1) % 3]!;
          const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / spacing));
          for (let s = 0; s < n; s++) {
            const x = p[0] + ((q[0] - p[0]) * s) / n, y = p[1] + ((q[1] - p[1]) * s) / n, z = p[2] + ((q[2] - p[2]) * s) / n;
            if (x >= x0 && x <= x1 && z >= z0 && z <= z1) visit(x, y, z);
          }
        }
      }
    }
  }

  /** S(x, z): the lowest exterior intersection, and that triangle's plan gradient. */
  lowest(x: number, z: number): { y: number; gx: number; gz: number } | null {
    let best: { y: number; gx: number; gz: number } | null = null;
    this.hits(x, z, (y, gx, gz) => { if (!best || y < best.y) best = { y, gx, gz }; });
    return best;
  }

  /**
   * The height under the next surface above the lower skin at which a point
   * is `clearance` from that surface's plane, or null where nothing is above.
   */
  below(x: number, z: number, clearance: number): number | null {
    const skin = this.lowest(x, z);
    if (!skin) return null;
    let next = Infinity, bound = Infinity;
    this.hits(x, z, (y, gx, gz) => {
      if (y <= skin.y + 1e-4 || y >= next) return;
      // Measured square to the surface: a sloped duct floor needs more than the vertical margin.
      next = y;
      bound = y - clearance * Math.min(2, Math.hypot(1, gx, gz));
    });
    return Number.isFinite(bound) ? bound : null;
  }
}

// ---------------------------------------------------------------------------
// Polygons in plan, carrying their attributes.

/** Inside where a*x + b*z + c >= 0. */
interface HalfPlane { a: number; b: number; c: number }

const side = (h: HalfPlane, v: V): number => h.a * v[0]! + h.b * v[2]! + h.c;

/** Lexicographic order, so a shared edge splits at the same point from either triangle. */
function before(p: V, q: V): boolean {
  for (let i = 0; i < 3; i++) if (p[i] !== q[i]) return p[i]! < q[i]!;
  return true;
}

function lerp(p: V, q: V, fp: number, fq: number): V {
  const [s, e, fs, fe] = before(p, q) ? [p, q, fp, fq] : [q, p, fq, fp];
  const t = fs / (fs - fe), out = new Float64Array(STRIDE);
  for (let i = 0; i < STRIDE; i++) out[i] = s[i]! + (e[i]! - s[i]!) * t;
  return out;
}

/** Sutherland-Hodgman in plan, keeping the source winding. */
function clip(poly: V[], h: HalfPlane): V[] {
  const out: V[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!, fp = side(h, p), fq = side(h, q);
    if (fp >= -CLIP_EPS) out.push(p);
    if ((fp > CLIP_EPS && fq < -CLIP_EPS) || (fp < -CLIP_EPS && fq > CLIP_EPS)) out.push(lerp(p, q, fp, fq));
  }
  return tidy(out);
}

function tidy(poly: V[]): V[] {
  const out: V[] = [];
  for (const v of poly) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0]! - v[0]!) < 1e-12 && Math.abs(last[2]! - v[2]!) < 1e-12) continue;
    out.push(v);
  }
  while (out.length > 1 && Math.abs(out[0]![0]! - out[out.length - 1]![0]!) < 1e-12 && Math.abs(out[0]![2]! - out[out.length - 1]![2]!) < 1e-12) out.pop();
  return out.length >= 3 && Math.abs(planArea(out)) > 1e-14 ? out : [];
}

function planArea(poly: readonly V[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    area += p[0]! * q[2]! - q[0]! * p[2]!;
  }
  return area / 2;
}

function centroid(poly: readonly V[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const v of poly) { c[0] += v[0]!; c[1] += v[1]!; c[2] += v[2]!; }
  return [c[0] / poly.length, c[1] / poly.length, c[2] / poly.length];
}

/** Both sides of a line x = value (axis 0) or z = value (axis 2). */
function splitAt(poly: V[], axis: 0 | 2, value: number): V[][] {
  let min = Infinity, max = -Infinity;
  for (const v of poly) { min = Math.min(min, v[axis]!); max = Math.max(max, v[axis]!); }
  if (value <= min + CLIP_EPS || value >= max - CLIP_EPS) return [poly];
  const a = axis === 0 ? 1 : 0, b = axis === 2 ? 1 : 0;
  return [clip(poly, { a, b, c: -value }), clip(poly, { a: -a, b: -b, c: value })].filter(p => p.length);
}

/** Outline -> each edge's inward half-plane, offset outward by `grow(edge)`. */
function halfPlanes(outline: readonly (readonly [number, number])[], grow: (i: number) => number = () => 0): HalfPlane[] {
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x0, z0] = outline[i]!, [x1, z1] = outline[(i + 1) % outline.length]!;
    area += x0 * z1 - x1 * z0;
  }
  const turn = area > 0 ? 1 : -1;
  return outline.map(([x0, z0], i) => {
    const [x1, z1] = outline[(i + 1) % outline.length]!;
    // Left of the edge is inside for a counter-clockwise (x, z) outline.
    const a = -(z1 - z0) * turn, b = (x1 - x0) * turn, length = Math.hypot(a, b);
    return { a: a / length, b: b / length, c: -(a * x0 + b * z0) / length + grow(i) };
  });
}

const insideAll = (planes: readonly HalfPlane[], x: number, z: number): boolean =>
  planes.every(h => h.a * x + h.b * z + h.c > CLIP_EPS);

interface Box { x0: number; x1: number; z0: number; z1: number }

const boxOf = (xs: readonly number[], zs: readonly number[]): Box =>
  ({ x0: Math.min(...xs) - 1e-6, x1: Math.max(...xs) + 1e-6, z0: Math.min(...zs) - 1e-6, z1: Math.max(...zs) + 1e-6 });

const overlaps = (box: Box, xs: readonly number[], zs: readonly number[]): boolean =>
  Math.max(...xs) >= box.x0 && Math.min(...xs) <= box.x1 && Math.max(...zs) >= box.z0 && Math.min(...zs) <= box.z1;

/** A convex plan region, and a rectangle around it. */
interface Region { planes: HalfPlane[]; box: Box }

/**
 * An outline that every line x = constant crosses once, as the convex slabs
 * between its corners' x values. `bounds` cut every slab.
 */
function slabs(outline: readonly (readonly [number, number])[], bounds: readonly HalfPlane[] = []): Region[] {
  const edges = halfPlanes(outline);
  const xs: number[] = [];
  for (const x of outline.map(([x]) => x).sort((a, b) => a - b)) if (!xs.length || x - xs[xs.length - 1]! > 1e-9) xs.push(x);
  const zOn = (h: HalfPlane, x: number) => -(h.a * x + h.c) / h.b;
  return xs.slice(1).map((x1, k) => {
    const x0 = xs[k]!;
    const spanning = edges.filter((_, i) => {
      const [p] = outline[i]!, [q] = outline[(i + 1) % outline.length]!;
      return Math.min(p, q) <= x0 + 1e-9 && Math.max(p, q) >= x1 - 1e-9;
    });
    if (spanning.length !== 2) throw new Error("A weapon-bay door outline crosses a line x = constant more than once.");
    return {
      planes: [{ a: 1, b: 0, c: -x0 }, { a: -1, b: 0, c: x1 }, ...spanning, ...bounds],
      box: boxOf([x0, x1], spanning.flatMap(h => [zOn(h, x0), zOn(h, x1)])),
    };
  });
}

// ---------------------------------------------------------------------------
// The skin profile.

interface Leaf {
  definition: BayLeafDefinition;
  bay: 0 | 1;
  /** Sign of body X on this side. */
  side: -1 | 1;
  /** |x| of the hinge line. */
  h: number;
  pivot: Vec3;
  axis: Vec3;
  /** The outline as convex slabs. */
  parts: Region[];
  /** The full-thickness inner face: the outline set in by the bevel along both ends, as convex slabs. */
  inner: Region[];
  /** One bevel strip per end edge, rising from the edge to the inner face; `edge` is the edge's inward half-plane. */
  bevels: { region: Region; edge: HalfPlane }[];
  /** The hinged and free edges, square through the shell: inward half-plane and extent. */
  squared: { plane: HalfPlane; box: Box }[];
  /** The hinged outline edge. */
  hinged: number;
  /** Plan extent of the outline. */
  zAft: number;
  zFwd: number;
  /** Rail height H(z), and its slope. */
  rail(z: number): number;
  railSlope: number;
  /** True where |x| lies on the door's side of the hinge. */
  doorSide(absX: number): boolean;
}

function leafOf(bay: BayDefinition, definition: BayLeafDefinition): Leaf {
  const pivot = leafPivot(definition), axis = leafAxis(definition);
  const sideSign: -1 | 1 = definition.hingeAft.x < 0 ? -1 : 1;
  const h = Math.abs(definition.hingeAft.x);
  const hinged = definition.outline.findIndex(([x0], i) => {
    const [x1] = definition.outline[(i + 1) % definition.outline.length]!;
    return Math.abs(Math.abs(x0) - h) < 1e-9 && Math.abs(Math.abs(x1) - h) < 1e-9;
  });
  if (hinged < 0) throw new Error(`${bay.label} ${definition.leaf} outline has no edge on its hinge.`);
  const zs = definition.outline.map(([, z]) => z);
  const { hingeAft: A, hingeForward: B } = definition;
  const railSlope = (B.y - A.y) / (B.z - A.z);
  const xs = definition.outline.map(([x]) => Math.abs(x));
  const inboardOfHinge = Math.max(...xs) > h + 1e-9;
  const outline = definition.outline, n = outline.length;
  // The hinged edge and the free edge run along X = constant; every other edge is an end.
  const end = (i: number) => outline[i]![0] !== outline[(i + 1) % n]![0];
  const { endBevel } = BAY_DOOR_FIT;
  const planes = halfPlanes(outline);
  const inset = offsetOutline(outline, i => (end(i) ? -endBevel : 0));
  return {
    definition, bay: bay.bay, side: sideSign, h, pivot, axis, hinged,
    parts: slabs(outline),
    inner: slabs(inset),
    bevels: planes.flatMap((edge, i) => {
      if (!end(i)) return [];
      const strip = [outline[i]!, outline[(i + 1) % n]!, inset[(i + 1) % n]!, inset[i]!];
      return [{ region: { planes: halfPlanes(strip), box: boxOf(strip.map(([x]) => x), strip.map(([, z]) => z)) }, edge }];
    }),
    squared: planes.flatMap((plane, i) => {
      if (end(i)) return [];
      const [x0, z0] = outline[i]!, [x1, z1] = outline[(i + 1) % n]!;
      return [{ plane, box: boxOf([x0, x1], [z0, z1]) }];
    }),
    zAft: Math.min(...zs), zFwd: Math.max(...zs),
    rail: z => A.y + railSlope * (z - A.z), railSlope,
    doorSide: absX => inboardOfHinge ? absX > h : absX < h,
  };
}

/** Plan slopes of the surface under a source normal; the lower skin faces down. */
function slopesOf(v: V): { fx: number; fz: number; down: number } {
  const down = v[4]! <= 0 ? 1 : -1;
  const ny = Math.min(-0.05, down * v[4]!);
  return { fx: (down * v[3]!) / -ny, fz: (down * v[5]!) / -ny, down };
}

function setNormal(v: V, yx: number, yz: number, down: number): void {
  const length = Math.hypot(yx, 1, yz);
  v[3] = (down * yx) / length; v[4] = (down * -1) / length; v[5] = (down * yz) / length;
}

/** Hinge-band weight and its plan slope, segment chosen by the piece it belongs to. */
function bandWeight(absX: number, absCentroidX: number, h: number, width: number, sideSign: number): { w: number; wx: number } {
  const d = Math.abs(absX - h), dc = absCentroidX - h;
  return { w: Math.max(0, 1 - d / width), wx: Math.abs(dc) < width ? -Math.sign(dc) * sideSign / width : 0 };
}

// ---------------------------------------------------------------------------
// Assembly.

class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];
  readonly withUv: boolean;
  constructor(withUv: boolean) { this.withUv = withUv; }
  vertex(p: ArrayLike<number>, n: ArrayLike<number>, uv?: ArrayLike<number>): number {
    this.positions.push(p[0]!, p[1]!, p[2]!);
    this.normals.push(n[0]!, n[1]!, n[2]!);
    if (this.withUv) this.uvs.push(uv?.[0] ?? 0, uv?.[1] ?? 0);
    return this.positions.length / 3 - 1;
  }
  /** Triangle, wound so its (b-a)x(c-a) faces `front`. */
  facing(a: number, b: number, c: number, front: Vec3): void {
    const P = this.positions;
    const e1 = [P[3 * b]! - P[3 * a]!, P[3 * b + 1]! - P[3 * a + 1]!, P[3 * b + 2]! - P[3 * a + 2]!];
    const e2 = [P[3 * c]! - P[3 * a]!, P[3 * c + 1]! - P[3 * a + 1]!, P[3 * c + 2]! - P[3 * a + 2]!];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    if (n[0]! * front[0] + n[1]! * front[1] + n[2]! * front[2] >= 0) this.indices.push(a, b, c);
    else this.indices.push(a, c, b);
  }
  build(): MeshArrays {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: this.withUv ? new Float32Array(this.uvs) : null,
      indices: new Uint32Array(this.indices),
    };
  }
}

function vertexOf(primitive: SkinPrimitive, index: number): V {
  const v = new Float64Array(STRIDE), p = primitive.positions, n = primitive.normals, uv = primitive.uvs;
  v[0] = p[3 * index]!; v[1] = p[3 * index + 1]!; v[2] = p[3 * index + 2]!;
  v[3] = n[3 * index]!; v[4] = n[3 * index + 1]!; v[5] = n[3 * index + 2]!;
  if (uv) { v[6] = uv[2 * index]!; v[7] = uv[2 * index + 1]!; }
  return v;
}

function fan(builder: MeshBuilder, poly: readonly V[], reverse = false, offsetY = 0, flipNormal = false, origin: Vec3 = [0, 0, 0]): void {
  const base = poly.map(v => builder.vertex(
    [v[0]! - origin[0], v[1]! + offsetY - origin[1], v[2]! - origin[2]],
    flipNormal ? [-v[3]!, -v[4]!, -v[5]!] : [v[3]!, v[4]!, v[5]!],
    [v[6]!, v[7]!],
  ));
  for (let i = 1; i + 1 < base.length; i++) {
    if (reverse) builder.indices.push(base[0]!, base[i + 1]!, base[i]!);
    else builder.indices.push(base[0]!, base[i]!, base[i + 1]!);
  }
}

/** One leaf: the source skin inside its outline, reprofiled onto the rail, with thickness. */
function buildLeaf(leaf: Leaf, primitives: readonly SkinPrimitive[], sampler: SkinSampler): LeafShell {
  const { hingeBand, shellThickness } = BAY_DOOR_FIT;
  const xs = leaf.definition.outline.map(([x]) => x);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const pieces: { source: number; poly: V[] }[] = [];
  primitives.forEach((primitive, source) => {
    const idx = primitive.indices, p = primitive.positions;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const corners = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
      const tx = corners.map(i => p[3 * i]!), tz = corners.map(i => p[3 * i + 2]!);
      if (Math.max(...tx) < minX || Math.min(...tx) > maxX || Math.max(...tz) < leaf.zAft || Math.min(...tz) > leaf.zFwd) continue;
      const triangle = corners.map(i => vertexOf(primitive, i));
      for (const part of leaf.parts) {
        if (!overlaps(part.box, tx, tz)) continue;
        let poly = triangle;
        for (const h of part.planes) { poly = clip(poly, h); if (!poly.length) break; }
        if (!poly.length) continue;
        // The lower skin only: the duct and upper fuselage share this plan.
        const c = centroid(poly), skin = sampler.lowest(c[0], c[2]);
        if (!skin || Math.abs(c[1] - skin.y) > ON_SKIN) continue;
        let strips = [poly];
        for (const x of [leaf.side * (leaf.h - hingeBand), leaf.side * (leaf.h + hingeBand)]) {
          strips = strips.flatMap(s => splitAt(s, 0, x));
        }
        for (const strip of strips) pieces.push({ source, poly: strip });
      }
    }
  });
  if (!pieces.length) throw new Error(`No lower skin inside the ${leaf.definition.leaf} leaf of bay ${leaf.bay}.`);
  for (const piece of pieces) {
    const cx = Math.abs(centroid(piece.poly)[0]);
    // Clipped pieces share corner objects; each piece reprofiles its own.
    piece.poly = piece.poly.map(v => v.slice());
    for (const v of piece.poly) {
      const { fx, fz, down } = slopesOf(v);
      const { w, wx } = bandWeight(Math.abs(v[0]!), cx, leaf.h, hingeBand, leaf.side);
      const rail = leaf.rail(v[2]!), lift = rail - v[1]!;
      v[1] = (1 - w) * v[1]! + w * rail;
      setNormal(v, (1 - w) * fx + wx * lift, (1 - w) * fz + w * leaf.railSlope, down);
    }
  }
  // The inner face at full thickness, and the bevels rising to it from the exterior's ends: lift and its plan slope.
  const k = shellThickness / BAY_DOOR_FIT.endBevel;
  const layers = [
    ...leaf.inner.map(region => ({ region, lift: () => shellThickness, slope: [0, 0] })),
    ...leaf.bevels.map(({ region, edge }) => ({ region, lift: (v: V) => k * side(edge, v), slope: [k * edge.a, k * edge.b] })),
  ];
  const exterior = new Map<number, MeshBuilder>();
  const interior = new MeshBuilder(false);
  const at = (v: V, lift: number): Vec3 => [v[0]! - leaf.pivot[0], v[1]! + lift - leaf.pivot[1], v[2]! - leaf.pivot[2]];
  for (const { source, poly } of pieces) {
    let builder = exterior.get(source);
    if (!builder) exterior.set(source, builder = new MeshBuilder(primitives[source]!.uvs !== null));
    fan(builder, poly, false, 0, false, leaf.pivot);
    const xs = poly.map(v => v[0]!), zs = poly.map(v => v[2]!);
    for (const { region, lift, slope } of layers) {
      if (!overlaps(region.box, xs, zs)) continue;
      let part = poly;
      for (const h of region.planes) { part = clip(part, h); if (!part.length) break; }
      if (!part.length) continue;
      const lifts = part.map(lift);
      fan(interior, part.map((v, i) => {
        const { fx, fz } = slopesOf(v), u = v.slice();
        u[1] = v[1]! + lifts[i]!;
        setNormal(u, fx + slope[0]!, fz + slope[1]!, -1);
        return u;
      }), true, 0, false, leaf.pivot);
      // Square caps along the hinged and free edges, up to whichever face is above.
      for (let i = 0; i < part.length; i++) {
        const j = (i + 1) % part.length, p = part[i]!, q = part[j]!;
        const edge = leaf.squared.find(({ plane, box }) => Math.abs(side(plane, p)) < ON_LINE && Math.abs(side(plane, q)) < ON_LINE
          && overlaps(box, [p[0]!], [p[2]!]) && overlaps(box, [q[0]!], [q[2]!]));
        if (!edge) continue;
        const out: Vec3 = [-edge.plane.a, 0, -edge.plane.b];
        const a = interior.vertex(at(p, 0), out), b = interior.vertex(at(q, 0), out);
        const c = interior.vertex(at(q, lifts[j]!), out), d = interior.vertex(at(p, lifts[i]!), out);
        if (lifts[j]! > 1e-9) interior.facing(a, b, c, out);
        if (lifts[i]! > 1e-9) interior.facing(a, c, d, out);
      }
    }
  }
  return {
    bay: leaf.bay, leaf: leaf.definition.leaf, pivot: leaf.pivot, axis: leaf.axis, openSign: leaf.definition.openSign,
    exterior: [...exterior].map(([source, builder]) => ({ source, mesh: builder.build() })),
    interior: interior.build(),
  };
}

interface SideFit {
  side: -1 | 1;
  inboard: Leaf;
  outboard: Leaf;
  /** Skin removed, as convex regions: both leaves grown by the seam off their hinges, and the centre gap. */
  removed: Region[];
  box: Box;
  /** Kinks of the blend, and the lining's jamb lines. */
  xLines: number[];
  zLines: number[];
  /** The lining's plan rectangle. */
  lining: { xIn: number; xOut: number; zAft: number; zFwd: number };
}

function sideFit(bay: BayDefinition): SideFit {
  const [inboard, outboard] = bay.leaves.map(definition => leafOf(bay, definition)) as [Leaf, Leaf];
  if (inboard.definition.leaf !== "inboard" || outboard.definition.leaf !== "outboard") throw new Error(`${bay.label} leaves out of order.`);
  const s = inboard.side;
  const { seam, fixedBlend, hingeBand, hingeRelief, aftJambRelief } = BAY_DOOR_FIT;
  const grown = (leaf: Leaf) => slabs(offsetOutline(leaf.definition.outline, i => (i === leaf.hinged ? 0 : seam)), [
    // A mitred tooth tip would reach past the lining's end walls.
    { a: 0, b: -1, c: leaf.zFwd + seam }, { a: 0, b: 1, c: seam - leaf.zAft },
  ]);
  // The free edges face each other across the centre gap.
  const freeEdge = (leaf: Leaf, pick: (...xs: number[]) => number) => {
    const outline = leaf.definition.outline, edge = pick(...outline.map(([x]) => Math.abs(x)));
    const zs = outline.filter(([x]) => Math.abs(Math.abs(x) - edge) < 1e-9).map(([, z]) => z);
    return { x: edge, z0: Math.min(...zs), z1: Math.max(...zs) };
  };
  const inner = freeEdge(inboard, (...xs) => Math.max(...xs)), outer = freeEdge(outboard, (...xs) => Math.min(...xs));
  const gap = slabs([[s * inner.x, Math.max(inner.z0, outer.z0)], [s * outer.x, Math.max(inner.z0, outer.z0)],
    [s * outer.x, Math.min(inner.z1, outer.z1)], [s * inner.x, Math.min(inner.z1, outer.z1)]]);
  const zAft = Math.min(inboard.zAft, outboard.zAft), zFwd = Math.max(inboard.zFwd, outboard.zFwd);
  const xIn = inboard.h - hingeRelief, xOut = outboard.h + hingeRelief;
  const liningAft = zAft - aftJambRelief, liningFwd = zFwd + seam;
  const xs = [inboard.h - fixedBlend, xIn, inboard.h, inboard.h + hingeBand, outboard.h - hingeBand, outboard.h, xOut, outboard.h + fixedBlend];
  return {
    side: s, inboard, outboard,
    removed: [...grown(inboard), ...grown(outboard), ...gap],
    box: {
      x0: Math.min(s * (inboard.h - fixedBlend), s * (outboard.h + fixedBlend)) - 1e-6,
      x1: Math.max(s * (inboard.h - fixedBlend), s * (outboard.h + fixedBlend)) + 1e-6,
      z0: zAft - fixedBlend - 1e-6, z1: zFwd + fixedBlend + 1e-6,
    },
    xLines: xs.map(x => s * x),
    zLines: [zAft - fixedBlend, liningAft, zAft, zFwd, liningFwd, zFwd + fixedBlend],
    lining: { xIn: s * xIn, xOut: s * xOut, zAft: liningAft, zFwd: liningFwd },
  };
}

/**
 * The outline with each edge moved outward by `grow(edge)`, inward where
 * negative, its corners mitred. An unmoved edge along X = constant keeps
 * its X exactly; its ends slide along it.
 */
function offsetOutline(outline: readonly (readonly [number, number])[], grow: (i: number) => number): [number, number][] {
  const n = outline.length, lines = halfPlanes(outline, grow);
  return outline.map(([x, z], i) => {
    const previous = (i + n - 1) % n, p = lines[previous]!, q = lines[i]!;
    if (grow(previous) === 0 && grow(i) === 0) return [x, z];
    if (grow(previous) === 0 && p.b === 0) return [x, -(q.a * x + q.c) / q.b];
    if (grow(i) === 0 && q.b === 0) return [x, -(p.a * x + p.c) / p.b];
    const det = p.a * q.b - p.b * q.a;
    return [(q.c * p.b - p.c * q.b) / det, (p.c * q.a - p.a * q.c) / det];
  });
}

/** The fixed skin's change: rails stitched at both hinges, faded back over 80 mm. */
function displaceFixed(v: V, absCentroidX: number, centroidZ: number, fit: SideFit, sampler: SkinSampler): void {
  const { fixedBlend, hingeBand } = BAY_DOOR_FIT;
  let d = 0, dx = 0, dz = 0;
  const absX = Math.abs(v[0]!), z = v[2]!;
  const { fx, fz, down } = slopesOf(v);
  for (const leaf of [fit.inboard, fit.outboard]) {
    const width = leaf.doorSide(absCentroidX) ? hingeBand : fixedBlend;
    const { w, wx } = bandWeight(absX, absCentroidX, leaf.h, width, fit.side);
    if (w === 0 && wx === 0) continue;
    if (z >= leaf.zAft && z <= leaf.zFwd && centroidZ >= leaf.zAft && centroidZ <= leaf.zFwd) {
      const lift = leaf.rail(z) - v[1]!;
      d += w * lift; dx += wx * lift - w * fx; dz += w * (leaf.railSlope - fz);
      continue;
    }
    const aft = centroidZ < leaf.zAft, end = aft ? leaf.zAft : leaf.zFwd;
    const distance = aft ? end - z : z - end, distanceC = aft ? end - centroidZ : centroidZ - end;
    const wz = Math.max(0, 1 - distance / fixedBlend);
    const wzz = distanceC < fixedBlend ? (aft ? 1 : -1) / fixedBlend : 0;
    if (wz === 0 && wzz === 0) continue;
    const skin = sampler.lowest(v[0]!, end);
    if (!skin) continue;
    const lift = leaf.rail(end) - skin.y;
    d += wz * w * lift; dx += wz * (wx * lift - w * skin.gx); dz += wzz * w * lift;
  }
  if (d === 0 && dx === 0 && dz === 0) return;
  v[1] = v[1]! + d;
  setNormal(v, fx + dx, fz + dz, down);
}

/** Plan line a lining wall stands on, and its extent along the other axis. */
interface WallLine { axis: 0 | 2; value: number; from: number; to: number; inward: Vec3; segments: [V, V][] }

function cutSkins(primitives: readonly SkinPrimitive[], fits: readonly SideFit[], sampler: SkinSampler, walls: Map<SideFit, WallLine[]>): (MeshArrays | null)[] {
  return primitives.map(primitive => {
    const idx = primitive.indices, p = primitive.positions;
    const builder = new MeshBuilder(primitive.uvs !== null);
    const vertexCount = p.length / 3;
    for (let i = 0; i < vertexCount; i++) {
      builder.vertex([p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!], [primitive.normals[3 * i]!, primitive.normals[3 * i + 1]!, primitive.normals[3 * i + 2]!],
        primitive.uvs ? [primitive.uvs[2 * i]!, primitive.uvs[2 * i + 1]!] : undefined);
    }
    let changed = false;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const corners = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
      const tx = corners.map(i => p[3 * i]!), tz = corners.map(i => p[3 * i + 2]!);
      const touched = fits.filter(fit => overlaps(fit.box, tx, tz));
      if (!touched.length) { builder.indices.push(...corners); continue; }
      let pieces: { poly: V[]; removed: boolean }[] = [{ poly: corners.map(i => vertexOf(primitive, i)), removed: false }];
      for (const fit of touched) {
        // Inside or outside each removed region, exactly.
        for (const region of fit.removed) {
          pieces = pieces.flatMap(piece => {
            if (piece.removed || !overlaps(region.box, piece.poly.map(v => v[0]!), piece.poly.map(v => v[2]!))) return [piece];
            const out: { poly: V[]; removed: boolean }[] = [];
            let rest = piece.poly;
            for (const h of region.planes) {
              const outside = clip(rest, { a: -h.a, b: -h.b, c: -h.c });
              if (outside.length) out.push({ poly: outside, removed: false });
              rest = clip(rest, h);
              if (!rest.length) break;
            }
            if (rest.length) out.push({ poly: rest, removed: true });
            return out;
          });
        }
        for (const x of fit.xLines) pieces = pieces.flatMap(piece => splitAt(piece.poly, 0, x).map(poly => ({ poly, removed: piece.removed })));
        for (const z of fit.zLines) pieces = pieces.flatMap(piece => splitAt(piece.poly, 2, z).map(poly => ({ poly, removed: piece.removed })));
      }
      const lower = pieces.map(piece => {
        const c = centroid(piece.poly), skin = sampler.lowest(c[0], c[2]);
        return skin !== null && Math.abs(c[1] - skin.y) <= ON_SKIN;
      });
      // Upper fuselage and ducts over the bays stay exactly as they were.
      if (!lower.some(Boolean)) { builder.indices.push(...corners); continue; }
      changed = true;
      pieces.forEach((piece, i) => {
        if (!lower[i]) { fan(builder, piece.poly); return; }
        const c = centroid(piece.poly);
        // Every split line includes the box edges, so a piece is in one box or none.
        const fit = touched.find(f => c[0] >= f.box.x0 && c[0] <= f.box.x1 && c[2] >= f.box.z0 && c[2] <= f.box.z1);
        if (!fit) { fan(builder, piece.poly); return; }
        if (fit.removed.some(region => insideAll(region.planes, c[0], c[2]))) return;
        // Clipped pieces share corner objects; each piece displaces its own.
        const poly = piece.poly.map(v => v.slice());
        for (const v of poly) displaceFixed(v, Math.abs(c[0]), c[2], fit, sampler);
        fan(builder, poly);
        piece.poly = poly;
        for (const wall of walls.get(fit)!) {
          for (let k = 0; k < piece.poly.length; k++) {
            const a = piece.poly[k]!, b = piece.poly[(k + 1) % piece.poly.length]!;
            if (Math.abs(a[wall.axis]! - wall.value) > ON_LINE || Math.abs(b[wall.axis]! - wall.value) > ON_LINE) continue;
            const along = wall.axis === 0 ? 2 : 0, lo = Math.min(wall.from, wall.to) - ON_LINE, hi = Math.max(wall.from, wall.to) + ON_LINE;
            if (a[along]! < lo || a[along]! > hi || b[along]! < lo || b[along]! > hi) continue;
            wall.segments.push([a, b]);
          }
        }
      });
    }
    return changed ? builder.build() : null;
  });
}

/**
 * The stand-in recess: jambs up from the cut skin to a roof 30 mm under the
 * next surface above, never an invented depth.
 */
function buildLining(fits: readonly SideFit[], walls: Map<SideFit, WallLine[]>, sampler: SkinSampler): MeshArrays {
  const { liningClearance } = BAY_DOOR_FIT;
  const builder = new MeshBuilder(false);
  for (const fit of fits) {
    const { xIn, xOut, zAft, zFwd } = fit.lining;
    const x0 = Math.min(xIn, xOut), x1 = Math.max(xIn, xOut);
    const nx = Math.max(2, Math.ceil((x1 - x0) / 0.1)), nz = Math.max(2, Math.ceil((zFwd - zAft) / 0.1));
    const hx = (x1 - x0) / nx, hz = (zFwd - zAft) / nz;
    // The clearance bound under the next surface above, sampled finely and taken at its lowest around each roof node.
    const step = 0.025, reach = liningClearance;
    const sx = Math.ceil((x1 - x0 + 2 * reach) / step), sz = Math.ceil((zFwd - zAft + 2 * reach) / step);
    const upper = new Float64Array((sx + 1) * (sz + 1));
    for (let i = 0; i <= sx; i++) for (let j = 0; j <= sz; j++) {
      upper[i * (sz + 1) + j] = sampler.below(x0 - reach + (i * (x1 - x0 + 2 * reach)) / sx, zAft - reach + (j * (zFwd - zAft + 2 * reach)) / sz, liningClearance) ?? Infinity;
    }
    // A faceted surface is lowest along its edges, which a grid can step over: the duct's outer lower edge.
    const edgeBound = Array.from({ length: (nx + 1) * (nz + 1) }, () => Infinity);
    sampler.upperEdges(x0 - hx - reach, x1 + hx + reach, zAft - hz - reach, zFwd + hz + reach, 0.01, (x, y, z) => {
      const ia = Math.max(0, Math.ceil((x - x0 - hx - reach) / hx)), ib = Math.min(nx, Math.floor((x - x0 + hx + reach) / hx));
      const ja = Math.max(0, Math.ceil((z - zAft - hz - reach) / hz)), jb = Math.min(nz, Math.floor((z - zAft + hz + reach) / hz));
      for (let i = ia; i <= ib; i++) for (let j = ja; j <= jb; j++) {
        edgeBound[i * (nz + 1) + j] = Math.min(edgeBound[i * (nz + 1) + j]!, y - liningClearance);
      }
    });
    const roofAt = (ni: number, nj: number): number => {
      const x = x0 + ni * hx, z = zAft + nj * hz;
      let low = edgeBound[ni * (nz + 1) + nj]!;
      const i0 = Math.max(0, Math.floor((x - hx - reach - (x0 - reach)) / ((x1 - x0 + 2 * reach) / sx)));
      const i1 = Math.min(sx, Math.ceil((x + hx + reach - (x0 - reach)) / ((x1 - x0 + 2 * reach) / sx)));
      const j0 = Math.max(0, Math.floor((z - hz - reach - (zAft - reach)) / ((zFwd - zAft + 2 * reach) / sz)));
      const j1 = Math.min(sz, Math.ceil((z + hz + reach - (zAft - reach)) / ((zFwd - zAft + 2 * reach) / sz)));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) low = Math.min(low, upper[i * (sz + 1) + j]!);
      if (!Number.isFinite(low)) throw new Error("No surface above the weapon bay to bound its lining.");
      return low;
    };
    const roof: number[][] = [];
    for (let i = 0; i <= nx; i++) {
      roof.push([]);
      for (let j = 0; j <= nz; j++) roof[i]!.push(roofAt(i, j));
    }
    const node = (i: number, j: number): Vec3 => [x0 + i * hx, roof[i]![j]!, zAft + j * hz];
    // Roof, facing down into the bay.
    const ids: number[][] = roof.map((column, i) => column.map((_, j) => builder.vertex(node(i, j), roofNormal(roof, i, j, hx, hz))));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      builder.facing(ids[i]![j]!, ids[i + 1]![j]!, ids[i + 1]![j + 1]!, [0, -1, 0]);
      builder.facing(ids[i]![j]!, ids[i + 1]![j + 1]!, ids[i]![j + 1]!, [0, -1, 0]);
    }
    // Jambs: the cut skin's own edge along each line, zipped to the roof's edge.
    for (const wall of walls.get(fit)!) {
      const along = wall.axis === 0 ? 2 : 0;
      const bottom = joinSegments(wall, along);
      const top: Vec3[] = [];
      if (wall.axis === 0) {
        const i = Math.round((wall.value - x0) / hx);
        for (let j = 0; j <= nz; j++) top.push(node(i, j));
      } else {
        const j = Math.round((wall.value - zAft) / hz);
        for (let i = 0; i <= nx; i++) top.push(node(i, j));
      }
      top.sort((a, b) => a[along] - b[along]);
      if (Math.abs(bottom[0]![along] - top[0]![along]) > 1e-6 || Math.abs(bottom[bottom.length - 1]![along] - top[top.length - 1]![along]) > 1e-6) {
        throw new Error("Bay lining jamb does not reach its corners on the skin.");
      }
      const b = bottom.map(p => builder.vertex(p, wall.inward)), u = top.map(p => builder.vertex(p, wall.inward));
      let i = 0, j = 0;
      while (i < b.length - 1 || j < u.length - 1) {
        const nextBottom = i < b.length - 1 ? bottom[i + 1]![along] : Infinity, nextTop = j < u.length - 1 ? top[j + 1]![along] : Infinity;
        if (nextBottom <= nextTop) { builder.facing(b[i]!, b[i + 1]!, u[j]!, wall.inward); i++; }
        else { builder.facing(b[i]!, u[j + 1]!, u[j]!, wall.inward); j++; }
      }
    }
  }
  return builder.build();
}

function roofNormal(roof: number[][], i: number, j: number, hx: number, hz: number): Vec3 {
  const at = (a: number, b: number) => roof[Math.max(0, Math.min(roof.length - 1, a))]![Math.max(0, Math.min(roof[0]!.length - 1, b))]!;
  const gx = (at(i + 1, j) - at(i - 1, j)) / (hx * (Math.min(roof.length - 1, i + 1) - Math.max(0, i - 1)));
  const gz = (at(i, j + 1) - at(i, j - 1)) / (hz * (Math.min(roof[0]!.length - 1, j + 1) - Math.max(0, j - 1)));
  const length = Math.hypot(gx, 1, gz);
  return [gx / length, -1 / length, gz / length];
}

/** The skin edge under a wall as one ordered polyline, corner to corner. */
function joinSegments(wall: WallLine, along: 0 | 2): Vec3[] {
  const points = new Map<string, Vec3>();
  for (const [a, b] of wall.segments) for (const v of [a, b]) {
    const key = v[along]!.toFixed(7);
    if (!points.has(key)) points.set(key, [v[0]!, v[1]!, v[2]!]);
  }
  const ordered = [...points.values()].sort((a, b) => a[along] - b[along]);
  const lo = Math.min(wall.from, wall.to), hi = Math.max(wall.from, wall.to);
  if (ordered.length < 2 || Math.abs(ordered[0]![along] - lo) > 1e-6 || Math.abs(ordered[ordered.length - 1]![along] - hi) > 1e-6) {
    throw new Error("The cut skin has no continuous edge under a bay lining jamb.");
  }
  // Every gap between consecutive points must be a skin edge.
  const covered = (s: number, e: number) => wall.segments.some(([a, b]) => {
    const p = Math.min(a[along]!, b[along]!), q = Math.max(a[along]!, b[along]!);
    return p <= s + 1e-7 && q >= e - 1e-7;
  });
  for (let k = 0; k + 1 < ordered.length; k++) {
    if (!covered(ordered[k]![along], ordered[k + 1]![along])) throw new Error("The skin under a bay lining jamb has a hole.");
  }
  return ordered;
}

function liningWalls(fit: SideFit): WallLine[] {
  const { xIn, xOut, zAft, zFwd } = fit.lining, s = fit.side;
  return [
    { axis: 0, value: xIn, from: zAft, to: zFwd, inward: [s, 0, 0], segments: [] },
    { axis: 0, value: xOut, from: zAft, to: zFwd, inward: [-s, 0, 0], segments: [] },
    { axis: 2, value: zAft, from: xIn, to: xOut, inward: [0, 0, 1], segments: [] },
    { axis: 2, value: zFwd, from: xIn, to: xOut, inward: [0, 0, -1], segments: [] },
  ];
}

/**
 * Cut the four leaves out of the lower fuselage skin and build what hangs and
 * stands around them. `primitives` are every fuselage primitive, body frame.
 */
export function fitBayDoors(primitives: readonly SkinPrimitive[], bays: readonly BayDefinition[] = BAYS): BayDoorFit {
  const sampler = new SkinSampler(primitives);
  const fits = bays.map(sideFit);
  const leaves = fits.flatMap(fit => [fit.inboard, fit.outboard].map(leaf => buildLeaf(leaf, primitives, sampler)));
  const walls = new Map(fits.map(fit => [fit, liningWalls(fit)]));
  const skins = cutSkins(primitives, fits, sampler, walls);
  const lining = buildLining(fits, walls, sampler);
  return { leaves, skins, lining };
}
