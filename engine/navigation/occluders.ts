import type { Environment, Occluder, OccluderOp } from '@/types';
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
export function applyStroke(mask: Uint8Array, w: number, h: number, aspect: number, op: OccluderOp, from?: { x: number; y: number }): { x: number; y: number } | undefined {
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
    for (const op of occ.ops) applyStroke(m, w, h, aspect, op);
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
