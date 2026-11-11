import type { InteractiveObject, NavigationGraph, Vec2 } from '@/types';
import { dist, distToSegmentPx, sampleEdge } from './geometry';

export type Hit =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'handle'; edgeId: string; which: 1 | 2 }
  | { kind: 'object'; id: string }
  | { kind: 'objhandle'; id: string }
  | null;

export interface HitContext {
  graph: NavigationGraph;
  envW: number;
  envH: number;
  /** How many environment pixels one screen pixel covers (1 / zoom). */
  pxPerScreenPx: number;
  selectedEdgeId?: string | null;
  objects?: InteractiveObject[];
  selectedObjectId?: string | null;
  /** Tolerance in screen pixels. */
  tolerance?: number;
}

/** Priority: curve handles of the selected edge > nodes > edges. */
export function hitTest(p: Vec2, ctx: HitContext): Hit {
  const tol = (ctx.tolerance ?? 10) * ctx.pxPerScreenPx;
  const { graph, envW, envH } = ctx;
  const d = (a: Vec2, b: Vec2) => Math.hypot((a.x - b.x) * envW, (a.y - b.y) * envH);

  // resize handle (bottom-right corner) of the selected object
  const objs = ctx.objects ?? [];
  const sel = ctx.selectedObjectId ? objs.find((o) => o.id === ctx.selectedObjectId) : undefined;
  if (sel) {
    const corner = { x: sel.position.x + (sel.width * envH) / 2 / envW, y: sel.position.y + sel.height / 2 };
    if (d(p, corner) <= tol) return { kind: 'objhandle', id: sel.id };
  }

  if (ctx.selectedEdgeId) {
    const e = graph.edges.find((x) => x.id === ctx.selectedEdgeId);
    if (e && e.geometry.kind === 'bezier') {
      if (d(p, e.geometry.c1) <= tol) return { kind: 'handle', edgeId: e.id, which: 1 };
      if (d(p, e.geometry.c2) <= tol) return { kind: 'handle', edgeId: e.id, which: 2 };
    }
  }
  let best: { id: string; dd: number } | null = null;
  for (const n of graph.nodes) {
    const dd = d(p, n);
    if (dd <= tol && (!best || dd <= best.dd)) best = { id: n.id, dd };
  }
  if (best) return { kind: 'node', id: best.id };

  // objects: topmost (last drawn) wins
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    const hx = (o.width * envH) / 2 + tol * 0.4, hy = (o.height * envH) / 2 + tol * 0.4;
    if (Math.abs((p.x - o.position.x) * envW) <= hx && Math.abs((p.y - o.position.y) * envH) <= hy) return { kind: 'object', id: o.id };
  }

  let bestE: { id: string; dd: number } | null = null;
  for (const e of graph.edges) {
    const a = graph.nodes.find((n) => n.id === e.from), b = graph.nodes.find((n) => n.id === e.to);
    if (!a || !b) continue;
    const pts = sampleEdge(a, b, e.geometry, 20);
    for (let i = 1; i < pts.length; i++) {
      const dd = distToSegmentPx(p, pts[i - 1], pts[i], envW, envH);
      if (dd <= tol * 0.8 && (!bestE || dd < bestE.dd)) bestE = { id: e.id, dd };
    }
  }
  return bestE ? { kind: 'edge', id: bestE.id } : null;
}

export { dist };
