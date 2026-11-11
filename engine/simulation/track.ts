import type { NavigationEdge, NavigationGraph, Vec2 } from '@/types';
import { sampleEdge } from '@/engine/navigation/geometry';

/**
 * A Track is an edge sampled in PIXEL space with cumulative arc length, so a character moves
 * at constant speed along straight segments and Bézier curves alike.
 */
export interface Track {
  edgeId: string;
  type: string;
  from: string;
  to: string;
  /** Speed multiplier of the edge. */
  speedMul: number;
  pts: Vec2[];      // pixel coordinates
  cum: number[];    // cumulative length at each point
  length: number;
}

export function buildTrack(g: NavigationGraph, e: NavigationEdge, reversed: boolean, envW: number, envH: number): Track | null {
  const a = g.nodes.find((n) => n.id === e.from), b = g.nodes.find((n) => n.id === e.to);
  if (!a || !b) return null;
  let pts = sampleEdge(a, b, e.geometry, e.geometry.kind === 'line' ? 1 : 48).map((p) => ({ x: p.x * envW, y: p.y * envH }));
  if (reversed) pts = pts.slice().reverse();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { edgeId: e.id, type: e.type, from: reversed ? e.to : e.from, to: reversed ? e.from : e.to, speedMul: e.speed, pts, cum, length: cum[cum.length - 1] };
}

export function reverseTrack(t: Track): Track {
  const pts = t.pts.slice().reverse();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { ...t, from: t.to, to: t.from, pts, cum };
}

/** Position (pixels) and tangent direction at arc length `s`. */
export function pointAt(t: Track, s: number): { x: number; y: number; dx: number; dy: number } {
  const d = Math.min(t.length, Math.max(0, s));
  let lo = 0, hi = t.cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t.cum[mid] <= d) lo = mid; else hi = mid; }
  const a = t.pts[lo], b = t.pts[hi];
  const seg = t.cum[hi] - t.cum[lo];
  const k = seg > 0 ? (d - t.cum[lo]) / seg : 0;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dx: b.x - a.x, dy: b.y - a.y };
}
