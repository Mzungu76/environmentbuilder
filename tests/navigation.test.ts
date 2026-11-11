import { describe, expect, it } from 'vitest';
import { addEdge, addNode, createEdge, createNode, emptyGraph, moveNode, outgoing, reachable, removeNode, reverseEdge, updateEdge, validateGraph } from '@/engine/navigation/graph';
import { bezierPoint, defaultBezier, edgeLengthPx, sampleEdge } from '@/engine/navigation/geometry';
import { hitTest } from '@/engine/navigation/hit';

function build() {
  let g = emptyGraph();
  const a = createNode(0.1, 0.5), b = createNode(0.5, 0.5), c = createNode(0.9, 0.5), d = createNode(0.5, 0.9);
  for (const n of [a, b, c, d]) g = addNode(g, n);
  g = addEdge(g, createEdge(a.id, b.id));
  g = addEdge(g, createEdge(b.id, c.id));
  return { g, a, b, c, d };
}

describe('graph', () => {
  it('rejects self loops, duplicates and dangling edges', () => {
    const { g, a, b } = build();
    expect(addEdge(g, createEdge(a.id, a.id))).toBe(g);
    expect(addEdge(g, createEdge(b.id, a.id))).toBe(g);
    expect(addEdge(g, createEdge(a.id, 'nope'))).toBe(g);
  });
  it('removing a node removes its edges', () => {
    const { g, b } = build();
    const r = removeNode(g, b.id);
    expect(r.edges).toHaveLength(0);
    expect(r.nodes).toHaveLength(3);
  });
  it('is immutable', () => {
    const { g, a } = build();
    const snapshot = JSON.stringify(g);
    moveNode(g, a.id, 0.3, 0.3);
    expect(JSON.stringify(g)).toBe(snapshot);
  });
  it('clamps node coordinates to 0..1', () => {
    const { g, a } = build();
    const m = moveNode(g, a.id, 2, -1).nodes.find((n) => n.id === a.id)!;
    expect([m.x, m.y]).toEqual([1, 0]);
  });
  it('moving a node translates attached bezier handles', () => {
    const { g, a, b } = build();
    const e = g.edges[0];
    const bz = updateEdge(g, e.id, { geometry: defaultBezier(a, b) });
    const before = (bz.edges[0].geometry as any).c1;
    const moved = moveNode(bz, a.id, a.x + 0.1, a.y);
    expect((moved.edges[0].geometry as any).c1.x).toBeCloseTo(before.x + 0.1);
  });
  it('reachability follows allowed directions only', () => {
    const { g, a, b, c, d } = build();
    expect([...reachable(g, a.id)].sort()).toEqual([a.id, b.id, c.id].sort());
    expect(reachable(g, a.id).has(d.id)).toBe(false); // unconnected node is unreachable
    const oneWay = updateEdge(g, g.edges[0].id, { direction: 'forward' });
    expect(reachable(oneWay, b.id).has(a.id)).toBe(false);
    expect(reachable(oneWay, a.id).has(b.id)).toBe(true);
    expect(outgoing(oneWay, b.id).map((o) => o.to)).toEqual([c.id]);
  });
  it('reverseEdge swaps endpoints and direction', () => {
    const { g, a, b } = build();
    const fwd = updateEdge(g, g.edges[0].id, { direction: 'forward' });
    const r = reverseEdge(fwd, fwd.edges[0].id).edges[0];
    expect([r.from, r.to, r.direction]).toEqual([b.id, a.id, 'backward']);
  });
  it('validate reports isolated nodes', () => {
    const { g, d } = build();
    expect(validateGraph(g).some((i) => i.id === d.id)).toBe(true);
  });
});

describe('geometry', () => {
  it('bezier endpoints', () => {
    const p0 = { x: 0, y: 0 }, p1 = { x: 1, y: 1 };
    const g = defaultBezier(p0, p1);
    if (g.kind !== 'bezier') throw new Error();
    expect(bezierPoint(p0, g.c1, g.c2, p1, 0)).toEqual(p0);
    expect(bezierPoint(p0, g.c1, g.c2, p1, 1)).toEqual(p1);
    expect(sampleEdge(p0, p1, g, 10)).toHaveLength(11);
  });
  it('measures length in pixel space (aspect aware)', () => {
    expect(edgeLengthPx({ x: 0, y: 0 }, { x: 1, y: 0 }, { kind: 'line' }, 2000, 1000)).toBe(2000);
    expect(edgeLengthPx({ x: 0, y: 0 }, { x: 0, y: 1 }, { kind: 'line' }, 2000, 1000)).toBe(1000);
  });
});

describe('hit testing', () => {
  it('prefers nodes over edges and respects zoom tolerance', () => {
    const { g, a } = build();
    const ctx = { graph: g, envW: 1000, envH: 1000, pxPerScreenPx: 1 };
    expect(hitTest({ x: a.x + 0.005, y: a.y }, ctx)).toEqual({ kind: 'node', id: a.id });
    expect(hitTest({ x: 0.3, y: 0.5 }, ctx)?.kind).toBe('edge');
    expect(hitTest({ x: 0.3, y: 0.7 }, ctx)).toBeNull();
    // zoomed out 10x: the same 10 screen px cover 100 env px
    expect(hitTest({ x: 0.3, y: 0.55 }, { ...ctx, pxPerScreenPx: 10 })?.kind).toBe('edge');
  });
});
