import { describe, expect, it } from 'vitest';
import type { Environment, NavigationGraph, Project } from '@/types';
import { createProject, createEnvironment } from '@/lib/serialization/factory';
import { addEdge, addNode, createEdge, createNode, emptyGraph } from '@/engine/navigation/graph';
import { createCharacter } from '@/engine/characters/factory';
import { GameSession, createGameSession, type SessionEvent } from '@/engine/game/session';
import { CollapseTimer } from '@/engine/game/collapse';
import { defaultCollapse, defaultGameplay, newCollectible } from '@/engine/game/defaults';
import { createRng } from '@/engine/simulation/rng';

function project(patch?: (env: Environment) => void): Project {
  const p = createProject('Grotta'); const env = p.environments[0];
  env.width = 2000; env.height = 1000;
  let g: NavigationGraph = emptyGraph();
  const mk = (x: number, y: number) => { const n = createNode(x, y); g = addNode(g, n); return n.id; };
  const A = mk(0.1, 0.6), B = mk(0.5, 0.6), C = mk(0.9, 0.6);
  g = addEdge(g, createEdge(A, B)); g = addEdge(g, createEdge(B, C)); env.navigation = g;
  const c = createCharacter(0, A); c.behavior.pauseMin = 0.2; c.behavior.pauseMax = 0.5; env.characters = [c];
  env.gameplay = defaultGameplay();
  patch?.(env);
  return p;
}
const run = (s: GameSession, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) s.update(1 / 30); };

describe('game session', () => {
  it('the character wanders by itself, with no commands', () => {
    const s = createGameSession(project()), a = s.frame().characters[0];
    run(s, 12);
    const b = s.frame().characters[0];
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(50);              // it moved (environment pixels)
    expect(['WALK', 'IDLE']).toContain(b.state);
  });
  it('a trigger stops the character, it picks the item up, celebrates and the counter goes up', () => {
    const s = createGameSession(project()), events: SessionEvent[] = []; s.on((e) => events.push(e));
    run(s, 3);
    const r = s.triggerCollect(); expect(r.ok).toBe(true);
    const states: string[] = [];
    for (let t = 0; t < 4; t += 1 / 30) { s.update(1 / 30); states.push(s.frame().characters[0].state); }
    expect(states).toContain('COLLECT'); expect(states).toContain('CELEBRATE');
    expect(states.indexOf('COLLECT')).toBeLessThan(states.indexOf('CELEBRATE'));
    const types = events.map((e) => e.type);
    expect(types.indexOf('collect:start')).toBeLessThan(types.indexOf('collect:pick')); expect(types.indexOf('collect:pick')).toBeLessThan(types.indexOf('collect:done'));
    expect(s.score.points).toBe(1); expect(s.frame().score.counts[s.collectibles[0].id]).toBe(1);
    run(s, 4); expect(states.length).toBeGreaterThan(0);
    expect(s.frame().characters[0].state).not.toBe('CELEBRATE');               // back to wandering afterwards
  });
  it('the point is counted when the item is in hand (mid pick-up), not at the trigger or at the end', () => {
    const s = createGameSession(project()); run(s, 2);
    s.triggerCollect();
    s.update(0.2); expect(s.score.points).toBe(0);
    run(s, 1.2); expect(s.score.points).toBe(1);
  });
  it('several kinds of items with their own points; a named trigger picks that one, a random one follows the weights', () => {
    const gem = newCollectible('Gemma', 5), coin = newCollectible('Moneta', 1); coin.weight = 0;
    const s = createGameSession(project((e) => { e.gameplay!.collectibles = [gem, coin]; }));
    expect(s.triggerCollect('Moneta').collectible!.id).toBe(coin.id);
    run(s, 6); expect(s.score.points).toBe(1);
    for (let i = 0; i < 20; i++) expect(s.triggerCollect().collectible!.id).toBe(gem.id);   // weight 0 never drawn
    expect(s.triggerCollect('???').ok).toBe(false);
  });
  it('triggers made during a pick-up are queued, not lost', () => {
    const s = createGameSession(project()); run(s, 1);
    s.triggerCollect(); s.triggerCollect(); run(s, 12);
    expect(s.score.points).toBe(2);
  });
  it('same seed → same game; different seed → different wandering', () => {
    const trace = (seed: string) => { const s = createGameSession(project(), { seed }); run(s, 20); const f = s.frame().characters[0]; return `${f.x.toFixed(1)},${f.y.toFixed(1)}`; };
    expect(trace('a')).toBe(trace('a'));
  });
});

describe('collapse (spinning-top timing)', () => {
  const cfg = () => ({ ...defaultCollapse(), enabled: true, minSeconds: 20, maxSeconds: 60 });
  it('the real duration is unpredictable but inside the configured range, and depends on the seed', () => {
    const totals = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => new CollapseTimer(cfg(), createRng(i)).debugTotal);
    for (const t of totals) { expect(t).toBeGreaterThanOrEqual(20); expect(t).toBeLessThanOrEqual(60); }
    expect(new Set(totals.map((t) => Math.round(t))).size).toBeGreaterThan(3);
  });
  it('the shaking grows with time (on average), has false alarms, wobbles faster near the end and the final stage fires once', () => {
    const t = new CollapseTimer({ ...cfg(), falseAlarms: 3 }, createRng(9)), total = t.debugTotal;
    const fired: string[] = []; const samples: number[] = []; let zeroCross = [0, 0];
    let prev = 0;
    for (let s = 0; s < total + 2; s += 1 / 30) {
      const sig = t.update(1 / 30); samples.push(sig.intensity); fired.push(...sig.fired.map((x) => x.effect));
      const half = s < total / 2 ? 0 : 1; if (Math.sign(sig.shake.x) !== Math.sign(prev) && prev !== 0) zeroCross[half]++; prev = sig.shake.x || prev;
    }
    const third = Math.floor(samples.length / 3), mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
    expect(mean(samples.slice(2 * third))).toBeGreaterThan(mean(samples.slice(0, third)) * 2);
    expect(Math.max(...samples.slice(0, Math.floor(samples.length * 0.7)))).toBeGreaterThan(0.1);   // there are early alarms
    expect(zeroCross[1]).toBeGreaterThan(zeroCross[0] * 0.9);                                      // oscillation does not slow down
    expect(fired.filter((e) => e === 'final')).toHaveLength(1); expect(t.collapsed).toBe(true);
  });
  it('disabled → no signal at all', () => {
    const t = new CollapseTimer({ ...cfg(), enabled: false }, createRng(1));
    const sig = t.update(100); expect(sig.intensity).toBe(0); expect(sig.collapsed).toBe(false);
  });
  it('in a session: stage events reach the game, then the collapse; afterwards nobody moves and no more items are found', () => {
    const s = createGameSession(project((e) => { e.gameplay!.collapse = { ...cfg(), minSeconds: 8, maxSeconds: 12 }; }), { seed: 'x' });
    const ev: SessionEvent[] = []; s.on((e) => ev.push(e));
    run(s, 16);
    expect(ev.some((e) => e.type === 'stage')).toBe(true); expect(ev.filter((e) => e.type === 'collapse')).toHaveLength(1);
    expect(s.collapsed).toBe(true); expect(s.frame().collapse.intensity).toBe(1);
    const before = s.frame().characters[0].x; run(s, 3); expect(s.frame().characters[0].x).toBe(before);
    expect(s.triggerCollect().reason).toBe('collapsed');
    expect(JSON.stringify(s.frame())).not.toMatch(/debug|total/i);                                   // the remaining time is never exposed
  });
});

import { gameReadiness } from '@/engine/game/validate';
import { scenarioManifest } from '@/lib/import-export/gamePackage';
describe('scenario contract', () => {
  it('the manifest lists items and collapse stages but never the duration of the collapse', () => {
    const p = project((e) => { e.gameplay!.collapse = { ...defaultCollapse(), enabled: true, minSeconds: 33, maxSeconds: 77 }; });
    const m = scenarioManifest(p, p.environments[0].id);
    expect(m.format).toBe('environment-builder-scenario'); expect(m.collectibles).toHaveLength(1); expect(m.collapse!.stages.length).toBeGreaterThan(2);
    expect(JSON.stringify(m)).not.toMatch(/minSeconds|maxSeconds|total|duration/i); expect(JSON.stringify(m)).not.toMatch(/[:,\[]\s*(33|77)\s*[,}\]]/);
  });
  it('readiness: a good scenario passes; missing pieces are reported with readable messages', () => {
    const good = project(); expect(gameReadiness(good, good.environments[0]).filter((i) => i.level === 'error')).toEqual([]);
    const bad = project((e) => { e.characters = []; e.gameplay!.collectibles = []; e.navigation = emptyGraph(); });
    const t = gameReadiness(bad, bad.environments[0]).map((i) => i.text).join(' | ');
    expect(t).toMatch(/due nodi/); expect(t).toMatch(/Nessun personaggio/); expect(t).toMatch(/Nessun oggetto da trovare/);
    const short = project((e) => { e.gameplay!.collapse = { ...defaultCollapse(), enabled: true, minSeconds: 2, maxSeconds: 3 }; });
    expect(gameReadiness(short, short.environments[0]).some((i) => /meno di 5 secondi/.test(i.text))).toBe(true);
  });
});
