import type { EdgeType, NavigationEdge, NavigationGraph, NavigationNode, NodeType } from '@/types';
import { uid } from '@/lib/ids';
import { clamp01 } from './geometry';

/**
 * Pure graph operations. Every function returns a NEW graph and never mutates its input,
 * which keeps undo/redo trivial (snapshots share structure).
 */

export const emptyGraph = (): NavigationGraph => ({ nodes: [], edges: [] });

export function createNode(x: number, y: number, type: NodeType = 'waypoint', graph?: NavigationGraph): NavigationNode {
  const n = (graph?.nodes.length ?? 0) + 1;
  return { id: uid('node'), name: `Nodo ${n}`, x: clamp01(x), y: clamp01(y), type, props: {} };
}

export function addNode(g: NavigationGraph, node: NavigationNode): NavigationGraph {
  return { ...g, nodes: [...g.nodes, node] };
}

export function updateNode(g: NavigationGraph, id: string, patch: Partial<NavigationNode>): NavigationGraph {
  return { ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch, id: n.id } : n)) };
}

/** Moves a node; Bézier control points of attached edges are translated along so curves keep their shape. */
export function moveNode(g: NavigationGraph, id: string, x: number, y: number): NavigationGraph {
  const node = g.nodes.find((n) => n.id === id);
  if (!node) return g;
  const nx = clamp01(x), ny = clamp01(y);
  const dx = nx - node.x, dy = ny - node.y;
  return {
    nodes: g.nodes.map((n) => (n.id === id ? { ...n, x: nx, y: ny } : n)),
    edges: g.edges.map((e) => {
      if (e.geometry.kind !== 'bezier') return e;
      const geo = e.geometry;
      if (e.from === id) return { ...e, geometry: { ...geo, c1: { x: geo.c1.x + dx, y: geo.c1.y + dy } } };
      if (e.to === id) return { ...e, geometry: { ...geo, c2: { x: geo.c2.x + dx, y: geo.c2.y + dy } } };
      return e;
    }),
  };
}

/** Deleting a node removes every edge attached to it (no dangling references). */
export function removeNode(g: NavigationGraph, id: string): NavigationGraph {
  return { nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id) };
}

export function findEdgeBetween(g: NavigationGraph, a: string, b: string): NavigationEdge | undefined {
  return g.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}

export function createEdge(from: string, to: string, type: EdgeType = 'walk'): NavigationEdge {
  return { id: uid('edge'), from, to, type, geometry: { kind: 'line' }, direction: 'both', speed: 1, requirements: [], props: {} };
}

/** Adds an edge unless it is a self-loop or a duplicate of an existing link between the same nodes. */
export function addEdge(g: NavigationGraph, edge: NavigationEdge): NavigationGraph {
  if (edge.from === edge.to) return g;
  if (!g.nodes.some((n) => n.id === edge.from) || !g.nodes.some((n) => n.id === edge.to)) return g;
  if (findEdgeBetween(g, edge.from, edge.to)) return g;
  return { ...g, edges: [...g.edges, edge] };
}

export function updateEdge(g: NavigationGraph, id: string, patch: Partial<NavigationEdge>): NavigationGraph {
  return { ...g, edges: g.edges.map((e) => (e.id === id ? { ...e, ...patch, id: e.id } : e)) };
}

export function removeEdge(g: NavigationGraph, id: string): NavigationGraph {
  return { ...g, edges: g.edges.filter((e) => e.id !== id) };
}

/** Reverses an edge (swaps endpoints, curve handles and one-way direction). */
export function reverseEdge(g: NavigationGraph, id: string): NavigationGraph {
  return {
    ...g,
    edges: g.edges.map((e) => {
      if (e.id !== id) return e;
      const geometry = e.geometry.kind === 'bezier' ? { ...e.geometry, c1: e.geometry.c2, c2: e.geometry.c1 } : e.geometry;
      const direction = e.direction === 'forward' ? 'backward' : e.direction === 'backward' ? 'forward' : 'both';
      return { ...e, from: e.to, to: e.from, geometry, direction };
    }),
  };
}

/** Edges leaving `nodeId` according to their allowed direction (used by the simulation engine). */
export function outgoing(g: NavigationGraph, nodeId: string): { edge: NavigationEdge; to: string; reversed: boolean }[] {
  const res: { edge: NavigationEdge; to: string; reversed: boolean }[] = [];
  for (const e of g.edges) {
    if (e.from === nodeId && e.direction !== 'backward') res.push({ edge: e, to: e.to, reversed: false });
    else if (e.to === nodeId && e.direction !== 'forward') res.push({ edge: e, to: e.from, reversed: true });
  }
  return res;
}

/** Nodes reachable from `start` following allowed directions. */
export function reachable(g: NavigationGraph, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const { to } of outgoing(g, cur)) if (!seen.has(to)) { seen.add(to); stack.push(to); }
  }
  return seen;
}

export interface GraphIssue { severity: 'error' | 'warning'; message: string; id?: string }

/** Consistency check: dangling edges, duplicates, isolated nodes. */
export function validateGraph(g: NavigationGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const ids = new Set(g.nodes.map((n) => n.id));
  const linked = new Set<string>();
  for (const e of g.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) issues.push({ severity: 'error', message: `Il collegamento ${e.id} punta a un nodo inesistente`, id: e.id });
    if (e.from === e.to) issues.push({ severity: 'error', message: `Il collegamento ${e.id} collega un nodo a se stesso`, id: e.id });
    linked.add(e.from); linked.add(e.to);
  }
  for (const n of g.nodes) if (!linked.has(n.id)) issues.push({ severity: 'warning', message: `Il nodo “${n.name}” non è collegato`, id: n.id });
  return issues;
}
