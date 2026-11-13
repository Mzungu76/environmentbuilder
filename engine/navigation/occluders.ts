import type { Environment, Occluder, OccluderOp, OccluderShape, OccluderShapeKind, OccluderStroke } from '@/types';
import { blurMask, softRadius, stamp } from './scaleZones';

/**
 * Occluders: parts of the backdrop drawn again over the characters. An occluder is a list of ops (brush strokes now; shapes and
 * splines later) that is rasterized into a coverage grid; the grid is feathered by `softness` and used as the alpha of a cut-out of
 * the backdrop. Ops are kept (not the pixels) so strokes stay editable and the file stays small.
 */

/** Cells across the coverage grid: finer than the scale zones because the edge of a rock must stay crisp. */
export const OCC_GRID_W = 1024;
export const occGrid = (env: Pick<Environment, 'width' | 'height'>) => ({ w: OCC_GRID_W, h: Math.max(8, Math.round((OCC_GRID_W * (env.height || 1)) / (env.width || 1))) });
/** Brush edge: fairly hard (the final feathering is the occluder's own `softness`). */
export const OCC_HARDNESS = 0.7;
export const DEFAULT_OCC_SOFTNESS = 0.03;

export const OCC_COLORS = ['#ff6b6b', '#4f8cff', '#3ecf8e', '#f5b84a', '#b57bff', '#2dd4bf'];

/** Stamps one stroke (a polyline of normalized points) into `mask`, interpolating so the line has no gaps. */
export function applyStroke(mask: Uint8Array, w: number, h: number, aspect: number, op: OccluderStroke, from?: { x: number; y: number }): { x: number; y: number } | undefined {
  const mode = op.mode === 'add' ? 'paint' : 'erase';
  let last = from;
  for (let i = 0; i + 1 < op.pts.length; i += 2) {
    const p = { x: op.pts[i], y: op.pts[i + 1] }, a = last ?? p;
    const dist = Math.hypot((p.x - a.x) * aspect, p.y - a.y), step = Math.max(0.0015, op.radius * 0.3), n = Math.max(1, Math.ceil(dist / step));
    for (let k = 1; k <= n; k++) stamp(mask, w, h, aspect, a.x + ((p.x - a.x) * k) / n, a.y + ((p.y - a.y) * k) / n, op.radius, mode, OCC_HARDNESS);
    last = p;
  }
  return last;
}

/* ---- shapes ---------------------------------------------------------------------------------------- */

type P = { x: number; y: number };
const SPLINE_SAMPLES = 14;
export const MIN_POINTS: Record<OccluderShapeKind, number> = { rect: 2, ellipse: 2, polygon: 3, spline: 3 };

/** Box of a rect / ellipse as [x0, y0, x1, y1] with x0 ≤ x1, y0 ≤ y1. */
export function shapeBox(pts: number[]): [number, number, number, number] {
  return [Math.min(pts[0], pts[2]), Math.min(pts[1], pts[3]), Math.max(pts[0], pts[2]), Math.max(pts[1], pts[3])];
}

/** Closed Catmull-Rom curve through the control points, sampled as a polygon. */
export function splinePolygon(pts: number[], samples = SPLINE_SAMPLES): number[] {
  const n = pts.length / 2, out: number[] = [];
  if (n < 3) return pts.slice();
  const g = (i: number) => { const k = ((i % n) + n) % n; return { x: pts[k * 2], y: pts[k * 2 + 1] }; };
  for (let i = 0; i < n; i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    for (let s = 0; s < samples; s++) {
      const t = s / samples, t2 = t * t, t3 = t2 * t;
      out.push(
        0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      );
    }
  }
  return out;
}

/** The outline of a shape as a closed polygon in normalized coordinates. */
export function shapePolygon(sh: Pick<OccluderShape, 'shape' | 'pts'>): number[] {
  if (sh.shape === 'rect') { const [x0, y0, x1, y1] = shapeBox(sh.pts); return [x0, y0, x1, y0, x1, y1, x0, y1]; }
  if (sh.shape === 'ellipse') {
    const [x0, y0, x1, y1] = shapeBox(sh.pts), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2, out: number[] = [];
    for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2; out.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); }
    return out;
  }
  if (sh.shape === 'spline') return splinePolygon(sh.pts);
  return sh.pts.slice();
}

export function pointInPolygon(poly: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Fills a polygon (normalized points) into the grid with anti-aliased edges (4 sub-scanlines per row, exact horizontal coverage).
 * `add` raises the coverage, `sub` lowers it, both in proportion to how much of the cell the polygon covers.
 */
export function fillPolygon(mask: Uint8Array, w: number, h: number, poly: number[], mode: 'add' | 'sub') {
  const n = poly.length / 2; if (n < 3) return;
  const px = new Float64Array(n), py = new Float64Array(n);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { px[i] = poly[i * 2] * w; py[i] = poly[i * 2 + 1] * h; minY = Math.min(minY, py[i]); maxY = Math.max(maxY, py[i]); }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h - 1, Math.ceil(maxY)), SUB = 4, cov = new Float32Array(w);
  for (let y = y0; y <= y1; y++) {
    cov.fill(0); let any = false;
    for (let s = 0; s < SUB; s++) {
      const sy = y + (s + 0.5) / SUB, xs: number[] = [];
      for (let i = 0, j = n - 1; i < n; j = i++) {
        if ((py[i] > sy) !== (py[j] > sy)) xs.push(px[i] + ((sy - py[i]) * (px[j] - px[i])) / (py[j] - py[i]));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(0, xs[k]), b = Math.min(w, xs[k + 1]); if (b <= a) continue;
        any = true;
        const ca = Math.floor(a), cb = Math.min(w - 1, Math.floor(b));
        if (ca === cb) { cov[ca] += (b - a) / SUB; continue; }
        cov[ca] += (ca + 1 - a) / SUB; cov[cb] += (b - cb) / SUB;
        for (let x = ca + 1; x < cb; x++) cov[x] += 1 / SUB;
      }
    }
    if (!any) continue;
    for (let x = 0; x < w; x++) {
      const c = Math.min(1, cov[x]); if (c <= 0) continue;
      const i = y * w + x;
      mask[i] = mode === 'add' ? Math.max(mask[i], Math.round(c * 255)) : Math.round(mask[i] * (1 - c));
    }
  }
}

/** Applies one op (stroke or shape) to a grid. Returns the last point of a stroke (for continuing it while dragging). */
export function applyOp(mask: Uint8Array, w: number, h: number, aspect: number, op: OccluderOp): void {
  if (op.kind === 'stroke') applyStroke(mask, w, h, aspect, op);
  else fillPolygon(mask, w, h, shapePolygon(op), op.mode);
}

/** Moves every point of a shape by (dx, dy). */
export const translateShape = (sh: OccluderShape, dx: number, dy: number): OccluderShape => ({ ...sh, pts: sh.pts.map((v, i) => v + (i % 2 ? dy : dx)) });

/** The handles of a shape (normalized): the 4 corners of the box for rect / ellipse, the points otherwise. */
export function shapeHandles(sh: OccluderShape): P[] {
  if (sh.shape === 'rect' || sh.shape === 'ellipse') { const [x0, y0, x1, y1] = shapeBox(sh.pts); return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]; }
  const out: P[] = []; for (let i = 0; i < sh.pts.length; i += 2) out.push({ x: sh.pts[i], y: sh.pts[i + 1] }); return out;
}
/** Drags handle `i` to `p`: a corner moves the box (the opposite corner stays), a point moves itself. */
export function moveShapeHandle(sh: OccluderShape, i: number, p: P): OccluderShape {
  if (sh.shape === 'rect' || sh.shape === 'ellipse') {
    const [x0, y0, x1, y1] = shapeBox(sh.pts), opp = [{ x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }, { x: x1, y: y0 }][i];
    return { ...sh, pts: [p.x, p.y, opp.x, opp.y] };
  }
  const pts = sh.pts.slice(); pts[i * 2] = p.x; pts[i * 2 + 1] = p.y; return { ...sh, pts };
}
/** Inserts a point after control point `after` (polygon / spline). */
export function insertShapePoint(sh: OccluderShape, after: number, p: P): OccluderShape {
  if (sh.shape === 'rect' || sh.shape === 'ellipse') return sh;
  const pts = sh.pts.slice(); pts.splice((after + 1) * 2, 0, p.x, p.y); return { ...sh, pts };
}
export function removeShapePoint(sh: OccluderShape, i: number): OccluderShape {
  if (sh.shape === 'rect' || sh.shape === 'ellipse' || sh.pts.length / 2 <= MIN_POINTS[sh.shape]) return sh;
  const pts = sh.pts.slice(); pts.splice(i * 2, 2); return { ...sh, pts };
}
/** Closest control edge of a polygon / spline to `p` (in env pixels) with the projection point. */
export function nearestEdge(sh: OccluderShape, p: P, sx: number, sy: number): { index: number; dist: number; at: P } | null {
  if (sh.shape === 'rect' || sh.shape === 'ellipse') return null;
  const n = sh.pts.length / 2; let best: { index: number; dist: number; at: P } | null = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = sh.pts[i * 2] * sx, ay = sh.pts[i * 2 + 1] * sy, bx = sh.pts[j * 2] * sx, by = sh.pts[j * 2 + 1] * sy, px = p.x * sx, py = p.y * sy;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    const qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(px - qx, py - qy);
    if (!best || d < best.dist) best = { index: i, dist: d, at: { x: qx / sx, y: qy / sy } };
  }
  return best;
}

// Rasterizing replays every op, so the result is cached per ops array (a new array = a changed occluder; old arrays stay valid for undo).
const cache = new WeakMap<OccluderOp[], Map<string, Uint8Array>>();

/** Raw coverage (0–255) of the occluder, before feathering. Do not mutate the result. */
export function occluderCoverage(env: Pick<Environment, 'width' | 'height'>, occ: Pick<Occluder, 'ops'>): Uint8Array {
  const { w, h } = occGrid(env), key = `${w}x${h}`;
  let per = cache.get(occ.ops);
  if (!per) { per = new Map(); cache.set(occ.ops, per); }
  let m = per.get(key);
  if (!m) {
    m = new Uint8Array(w * h);
    const aspect = (env.width || 1) / (env.height || 1);
    for (const op of occ.ops) applyOp(m, w, h, aspect, op);
    per.set(key, m);
  }
  return m;
}
/** Seeds the cache with a mask that was painted incrementally while dragging (committed as `ops`). */
export function seedCoverage(env: Pick<Environment, 'width' | 'height'>, ops: OccluderOp[], mask: Uint8Array) {
  const { w, h } = occGrid(env);
  let per = cache.get(ops); if (!per) { per = new Map(); cache.set(ops, per); }
  per.set(`${w}x${h}`, mask);
}

/** Final alpha of the cut-out: the coverage feathered by the occluder's softness. */
export function occluderAlpha(env: Pick<Environment, 'width' | 'height'>, occ: Pick<Occluder, 'ops' | 'softness'>, coverage = occluderCoverage(env, occ)): Uint8Array {
  const { w, h } = occGrid(env);
  return blurMask(coverage, w, h, softRadius(occ.softness, h));
}

export const hasCoverage = (m: Uint8Array) => { for (let i = 0; i < m.length; i++) if (m[i] > 8) return true; return false; };

export function newOccluder(existing: Occluder[], id: string): Occluder {
  return { id, name: `Primo piano ${existing.length + 1}`, color: OCC_COLORS[existing.length % OCC_COLORS.length], softness: DEFAULT_OCC_SOFTNESS, ops: [] };
}
