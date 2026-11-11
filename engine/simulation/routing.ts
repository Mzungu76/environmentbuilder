import type { NavigationEdge, NavigationGraph } from '@/types';
import { edgeLengthPx } from '@/engine/navigation/geometry';

export interface RouteStep { edgeId: string; from: string; to: string; reversed: boolean }

export interface RoutingProfile {
  abilities: string[];
  /** Preference per edge type (see CharacterBehavior.edgeWeights). Missing = 1. */
  edgeWeights: Record<string, number>;
}

/** Can the edge be entered from `fromNode`, honouring allowed direction and movement requirements? */
export function canTraverse(e: NavigationEdge, fromNode: string, abilities: string[]): { ok: boolean; to: string; reversed: boolean } {
  const fwd = e.from === fromNode && e.direction !== 'backward';
  const bwd = e.to === fromNode && e.direction !== 'forward';
  const reqOk = e.requirements.every((r) => abilities.includes(r));
  if (!reqOk || (!fwd && !bwd)) return { ok: false, to: '', reversed: false };
  return fwd ? { ok: true, to: e.to, reversed: false } : { ok: true, to: e.from, reversed: true };
}

/**
 * Dijkstra over the navigation graph. Cost = travel time (length / edge speed) divided by the
 * character's preference for the edge type. Weight 0 = edge excluded from *autonomous* choices only
 * when `respectZeroWeights` is true (manual destinations may still use it).
 * Returns null if the target is unreachable.
 */
export function findRoute(
  g: NavigationGraph, from: string, to: string, envW: number, envH: number, profile: RoutingProfile, respectZeroWeights = false,
): { steps: RouteStep[]; cost: number } | null {
  if (from === to) return { steps: [], cost: 0 };
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, RouteStep>();
  const done = new Set<string>();
  const lenCache = new Map<string, number>();
  const len = (e: NavigationEdge) => {
    let l = lenCache.get(e.id);
    if (l === undefined) {
      const a = g.nodes.find((n) => n.id === e.from)!, b = g.nodes.find((n) => n.id === e.to)!;
      l = edgeLengthPx(a, b, e.geometry, envW, envH); lenCache.set(e.id, l);
    }
    return l;
  };
  const queue = new Set<string>([from]);
  while (queue.size) {
    let cur = '', best = Infinity;
    for (const id of queue) { const d = dist.get(id)!; if (d < best) { best = d; cur = id; } }
    queue.delete(cur); done.add(cur);
    if (cur === to) break;
    for (const e of g.edges) {
      const t = canTraverse(e, cur, profile.abilities);
      if (!t.ok || done.has(t.to)) continue;
      const w = profile.edgeWeights[e.type] ?? 1;
      if (w <= 0 && respectZeroWeights) continue;
      const cost = best + len(e) / Math.max(0.01, e.speed) / (w > 0 ? w : 1);
      if (cost < (dist.get(t.to) ?? Infinity)) { dist.set(t.to, cost); prev.set(t.to, { edgeId: e.id, from: cur, to: t.to, reversed: t.reversed }); queue.add(t.to); }
    }
  }
  if (!prev.has(to)) return null;
  const steps: RouteStep[] = [];
  for (let n = to; n !== from; ) { const s = prev.get(n)!; steps.unshift(s); n = s.from; }
  return { steps, cost: dist.get(to)! };
}

/** Every node reachable from `from` under the profile (used for autonomous destination choice). */
export function reachableNodes(g: NavigationGraph, from: string, abilities: string[], edgeWeights: Record<string, number> = {}, respectZeroWeights = false): Set<string> {
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of g.edges) {
      const t = canTraverse(e, cur, abilities);
      if (!t.ok || seen.has(t.to)) continue;
      if (respectZeroWeights && (edgeWeights[e.type] ?? 1) <= 0) continue;
      seen.add(t.to); stack.push(t.to);
    }
  }
  return seen;
}
