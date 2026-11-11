import { describe, expect, it } from 'vitest';
import type { Environment, NavigationGraph } from '@/types';
import { createEnvironment } from '@/lib/serialization/factory';
import { addEdge, addNode, createEdge, createNode, emptyGraph, updateEdge } from '@/engine/navigation/graph';
import { defaultBezier } from '@/engine/navigation/geometry';
import { createCharacter } from '@/engine/characters/factory';
import { Agent } from '@/engine/simulation/Agent';
import { findRoute } from '@/engine/simulation/routing';

/**   A ──── B ──── C        D (isolated)
 *          └──── E (one-way B→E)                              */
function scene(): { env: Environment; ids: Record<string, string> } {
  const env = createEnvironment(); env.width = 2000; env.height = 1000;
  let g: NavigationGraph = emptyGraph();
  const mk = (n: string, x: number, y: number) => { const node = { ...createNode(x, y), name: n }; g = addNode(g, node); return node.id; };
  const A = mk('A', 0.1, 0.5), B = mk('B', 0.5, 0.5), C = mk('C', 0.9, 0.5), D = mk('D', 0.5, 0.9), E = mk('E', 0.5, 0.1);
  g = addEdge(g, createEdge(A, B)); g = addEdge(g, createEdge(B, C));
  const be = createEdge(B, E); g = addEdge(g, { ...be, direction: 'forward' });
  env.navigation = g;
  return { env, ids: { A, B, C, D, E } };
}
const run = (a: Agent, seconds: number, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) a.step(dt); };
const mkAgent = (env: Environment, start: string, patch: any = {}) => { const c = createCharacter(0, start); Object.assign(c, patch); return new Agent(env, c); };

describe('routing', () => {
  it('finds the shortest route and refuses unreachable nodes', () => {
    const { env, ids } = scene();
    const prof = { abilities: [], edgeWeights: {} };
    expect(findRoute(env.navigation, ids.A, ids.C, 2000, 1000, prof)!.steps.map((s) => s.to)).toEqual([ids.B, ids.C]);
    expect(findRoute(env.navigation, ids.A, ids.D, 2000, 1000, prof)).toBeNull();
    expect(findRoute(env.navigation, ids.E, ids.B, 2000, 1000, prof)).toBeNull(); // one-way edge
  });
  it('respects movement requirements', () => {
    const { env, ids } = scene();
    env.navigation = updateEdge(env.navigation, env.navigation.edges[1].id, { requirements: ['can-climb'] });
    expect(findRoute(env.navigation, ids.A, ids.C, 2000, 1000, { abilities: [], edgeWeights: {} })).toBeNull();
    expect(findRoute(env.navigation, ids.A, ids.C, 2000, 1000, { abilities: ['can-climb'], edgeWeights: {} })).not.toBeNull();
  });
});

describe('manual movement', () => {
  it('walks to the destination at the configured speed and stops there', () => {
    const { env, ids } = scene();
    const a = mkAgent(env, ids.A, { speed: 0.2 }); // 200 px/s
    expect(a.goTo(ids.B)).toEqual({ ok: true });
    run(a, 1); // 200px of 800px
    const s = a.snapshot();
    expect(s.state).toBe('WALK');
    expect(s.x * 2000).toBeCloseTo(200 + 200, 0);
    expect(s.nodeId).toBeNull();
    run(a, 3.5);
    const f = a.snapshot();
    expect(f.nodeId).toBe(ids.B); expect(f.state).toBe('IDLE'); expect(f.x).toBeCloseTo(0.5, 5);
  });
  it('rejects unreachable destinations and never leaves the graph', () => {
    const { env, ids } = scene();
    const a = mkAgent(env, ids.A);
    expect(a.goTo(ids.D)).toEqual({ ok: false, reason: 'unreachable' });
    expect(a.goTo('nope')).toEqual({ ok: false, reason: 'no-node' });
    run(a, 2); expect(a.snapshot().nodeId).toBe(ids.A);
  });
  it('moves along a Bézier curve at constant speed and lands exactly on the node', () => {
    const { env, ids } = scene();
    const e = env.navigation.edges[0];
    env.navigation = updateEdge(env.navigation, e.id, { geometry: defaultBezier(env.navigation.nodes[0], env.navigation.nodes[1]) });
    const a = mkAgent(env, ids.A, { speed: 0.1 });
    a.goTo(ids.B);
    let prev = a.snapshot(), minStep = Infinity, maxStep = 0;
    for (let i = 0; i < 600 && a.snapshot().nodeId !== ids.B; i++) {
      a.step(1 / 60); const s = a.snapshot();
      if (s.nodeId === null && prev.nodeId === null) { const d = Math.hypot((s.x - prev.x) * 2000, (s.y - prev.y) * 1000); minStep = Math.min(minStep, d); maxStep = Math.max(maxStep, d); }
      prev = s;
    }
    expect(a.snapshot().nodeId).toBe(ids.B);
    expect(maxStep / minStep).toBeLessThan(1.15); // ~constant speed on a curve
  });
  it('can reverse mid-edge when that is the shorter way', () => {
    const { env, ids } = scene();
    const a = mkAgent(env, ids.A, { speed: 0.2 });
    a.goTo(ids.C); run(a, 0.5); // 100px into A→B
    expect(a.goTo(ids.A)).toEqual({ ok: true });
    run(a, 1); expect(a.snapshot().nodeId).toBe(ids.A);
  });
  it('edge speed multiplier slows the character', () => {
    const { env, ids } = scene();
    env.navigation = updateEdge(env.navigation, env.navigation.edges[0].id, { speed: 0.5 });
    const a = mkAgent(env, ids.A, { speed: 0.2 }); a.goTo(ids.B); run(a, 1);
    expect(a.snapshot().x * 2000).toBeCloseTo(200 + 100, 0);
  });
  it('uses CLIMB state on climb edges', () => {
    const { env, ids } = scene();
    env.navigation = updateEdge(env.navigation, env.navigation.edges[0].id, { type: 'climb' });
    const a = mkAgent(env, ids.A); a.goTo(ids.B); run(a, 0.2);
    expect(a.snapshot().state).toBe('CLIMB');
  });
});

describe('autonomous movement', () => {
  const auto = { behavior: { mode: 'autonomous', pauseMin: 0.5, pauseMax: 1, stopProbability: 0.3, turnProbability: 0.3, decisionInterval: 0.5, edgeWeights: {} }, speed: 0.3 };
  it('is deterministic for the same seed', () => {
    const { env, ids } = scene();
    const trace = () => { const a = mkAgent(env, ids.A, structuredClone(auto)); a.config.id = 'fixed'; a.reset(); const out: string[] = []; for (let i = 0; i < 1800; i++) { a.step(1 / 60); if (i % 60 === 0) { const s = a.snapshot(); out.push(`${s.x.toFixed(4)},${s.y.toFixed(4)},${s.state}`); } } return out; };
    expect(trace()).toEqual(trace());
  });
  it('only ever visits reachable nodes and stays on the graph', () => {
    const { env, ids } = scene();
    env.navigation = updateEdge(env.navigation, env.navigation.edges[2].id, { direction: 'both' }); // avoid the one-way dead end
    const a = mkAgent(env, ids.A, structuredClone(auto)); a.config.id = 'fixed-seed-1'; a.reset(); // deterministic seed
    const visited = new Set<string>();
    for (let i = 0; i < 60 * 300; i++) {
      a.step(1 / 60); const s = a.snapshot(); if (s.nodeId) visited.add(s.nodeId);
      // always on a horizontal segment (y=0.5) or on the B→E vertical (x=0.5)
      const onA = Math.abs(s.y - 0.5) < 1e-6, onV = Math.abs(s.x - 0.5) < 1e-6;
      expect(onA || onV).toBe(true);
    }
    expect(visited.has(ids.D)).toBe(false);
    expect(visited.has(ids.C)).toBe(true);
    expect(visited.size).toBeGreaterThanOrEqual(3);
  });
  it('pauses at destinations', () => {
    const { env, ids } = scene();
    const a = mkAgent(env, ids.A, { speed: 1, behavior: { ...auto.behavior, turnProbability: 0, stopProbability: 0, pauseMin: 2, pauseMax: 2 } });
    let sawWait = false;
    for (let i = 0; i < 60 * 20; i++) { a.step(1 / 60); if (a.snapshot().waiting > 0.5) sawWait = true; }
    expect(sawWait).toBe(true);
  });
  it('edge weight 0 excludes a path from autonomous choices', () => {
    const { env, ids } = scene();
    const a = mkAgent(env, ids.A, { speed: 1, behavior: { ...auto.behavior, edgeWeights: { walk: 0 } } });
    for (let i = 0; i < 60 * 30; i++) a.step(1 / 60);
    expect(a.snapshot().nodeId).toBe(ids.A); // nothing allowed → stays put
  });
});

describe('arrival events and blocked destinations', () => {
  it('reports a final arrival on the last node of a route', () => {
    const { env, ids } = scene();
    const a = mkAgent(env, ids.A, { speed: 1 });
    a.goTo(ids.C); expect(a.arrivalSeq).toBe(0);
    run(a, 3);
    expect(a.arrivalSeq).toBeGreaterThanOrEqual(2);
    expect(a.arrivalFinal).toBe(true);
    expect(a.snapshot().nodeId).toBe(ids.C);
  });
  it('autonomous mode never picks blocked nodes (exits) as destination', () => {
    const { env, ids } = scene();
    env.navigation = updateEdge(env.navigation, env.navigation.edges[2].id, { direction: 'both' });
    const a = mkAgent(env, ids.A, { speed: 1, behavior: { mode: 'autonomous', pauseMin: 0, pauseMax: 0.2, stopProbability: 0, turnProbability: 0, decisionInterval: 1, edgeWeights: {} } });
    a.blocked = new Set([ids.C]);
    const stops = new Set<string>();
    for (let i = 0; i < 60 * 120; i++) { a.step(1 / 60); const s = a.snapshot(); if (a.arrivalFinal && s.nodeId) stops.add(s.nodeId); }
    expect(stops.has(ids.C)).toBe(false);
    expect(stops.size).toBeGreaterThan(0);
  });
});
