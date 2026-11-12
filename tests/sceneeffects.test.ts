import { describe, expect, it } from 'vitest';
import type { Environment } from '@/types';
import { createProject } from '@/lib/serialization/factory';
import { addEdge, addNode, createEdge, createNode, emptyGraph } from '@/engine/navigation/graph';
import { createCharacter } from '@/engine/characters/factory';
import { Agent } from '@/engine/simulation/Agent';
import { baseScale, nodeScale, scaleAlong } from '@/engine/navigation/perspective';
import { applyLight, buildLightMap, lightMapPixels, sampleLight } from '@/engine/game/light';
import { createGameSession } from '@/engine/game/session';

describe('perspective', () => {
  const env = { perspective: { topScale: 0.5, bottomScale: 1 } } as Pick<Environment, 'perspective'>;
  it('automatic scale by height; no perspective = 1', () => {
    expect(baseScale(env, 0)).toBe(0.5); expect(baseScale(env, 1)).toBe(1); expect(baseScale(env, 0.5)).toBeCloseTo(0.75, 6); expect(baseScale({}, 0.3)).toBe(1);
  });
  it('a node can fix its own scale (it wins over the automatic one); along a path the scale blends the two nodes', () => {
    const a = { x: 0.5, y: 1, props: {} }, b = { x: 0.5, y: 0, props: { scale: '0.2' } };
    expect(nodeScale(env, a)).toBe(1); expect(nodeScale(env, b)).toBe(0.2); expect(nodeScale(env, { x: 0.5, y: 0.2, props: { scale: 'abc' } })).toBeCloseTo(0.6, 6);
    expect(scaleAlong(env, a as never, b as never, 0.5)).toBeCloseTo(0.6, 6);
  });
  it('the agent shrinks and slows down while walking into the depth', () => {
    const p = createProject('x'); const e = p.environments[0]; e.width = 2000; e.height = 1000;
    let g = emptyGraph(); const near = { ...createNode(0.2, 0.9), props: { scale: '1' } }, far = { ...createNode(0.8, 0.3), props: { scale: '0.4' } };
    g = addNode(addNode(g, near), far); g = addEdge(g, createEdge(near.id, far.id)); e.navigation = g;
    const c = createCharacter(0, near.id); c.behavior.mode = 'manual'; const a = new Agent(e, c);
    expect(a.snapshot().scale).toBe(1);
    a.goTo(far.id);
    const scales: number[] = [], speeds: number[] = [];
    for (let t = 0; t < 40 && !a.snapshot().nodeId || t < 1; t += 1 / 30) { a.step(1 / 30); const s = a.snapshot(); if (s.edgeId) { scales.push(s.scale); speeds.push(s.speedPx); } if (s.nodeId === far.id) break; }
    expect(scales[0]).toBeGreaterThan(scales[scales.length - 1]); expect(scales[scales.length - 1]).toBeLessThan(0.6);
    expect(speeds[0]).toBeGreaterThan(speeds[speeds.length - 1] * 1.5);                      // smaller steps far away
    expect(a.snapshot().scale).toBeCloseTo(0.4, 2);
  });
  it('the game session hands out the already-scaled height', () => {
    const p = createProject('x'); const e = p.environments[0]; e.width = 2000; e.height = 1000; e.perspective = { topScale: 0.5, bottomScale: 1 };
    let g = emptyGraph(); const n1 = createNode(0.2, 1), n2 = createNode(0.8, 1); g = addEdge(addNode(addNode(g, n1), n2), createEdge(n1.id, n2.id)); e.navigation = g;
    const c = createCharacter(0, n1.id); c.height = 0.2; e.characters = [c];
    const f = createGameSession(p).frame().characters[0];
    expect(f.scale).toBe(1); expect(f.heightPx).toBeCloseTo(200, 3);
  });
});

describe('scene light on the characters', () => {
  /** left half bright warm, right half dark blue */
  const W = 200, H = 100, img = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, left = x < W / 2; img[i] = left ? 230 : 20; img[i + 1] = left ? 190 : 40; img[i + 2] = left ? 120 : 90; img[i + 3] = 255; }
  const map = buildLightMap(img, W, H, 40);
  it('builds a small map (a few KB) with the aspect of the image', () => {
    expect(map.w).toBe(40); expect(map.h).toBe(20); expect(map.data.length).toBeLessThan(4000);
    const px = lightMapPixels(map); expect(px.w * px.h * 4).toBe(px.rgba.length); expect(px.rgba[0]).toBeGreaterThan(200);
  });
  it('bright warm zone → brighter and warm; dark blue zone → darker and blue; strength 0 → no change', () => {
    const lit = sampleLight(map, 0.1, 0.5, 1), dark = sampleLight(map, 0.9, 0.5, 1);
    expect(lit.brightness).toBeGreaterThan(1); expect(dark.brightness).toBeLessThan(1); expect(lit.brightness).toBeGreaterThan(dark.brightness + 0.3);
    const warm = parseInt(lit.tint.slice(1, 3), 16) > parseInt(lit.tint.slice(5, 7), 16), blue = parseInt(dark.tint.slice(5, 7), 16) > parseInt(dark.tint.slice(1, 3), 16);
    expect(warm).toBe(true); expect(blue).toBe(true);
    const off = sampleLight(map, 0.9, 0.5, 0); expect(off.brightness).toBe(1); expect(off.tintAmount).toBe(0);
  });
  it('the light changes smoothly across the boundary (no jump)', () => {
    let prev = sampleLight(map, 0.3, 0.5, 1).brightness, maxStep = 0;
    for (let x = 0.3; x <= 0.7; x += 0.005) { const b = sampleLight(map, x, 0.5, 1).brightness; maxStep = Math.max(maxStep, Math.abs(b - prev)); prev = b; }
    expect(maxStep).toBeLessThan(0.1);
  });
  it('applyLight multiplies the brightness and keeps the character’s own tint when it has one', () => {
    const l = { brightness: 0.8, tint: '#3355ff', tintAmount: 0.4 };
    expect(applyLight(undefined, null)).toBeUndefined();
    const a = applyLight(undefined, l)!; expect(a.brightness).toBeCloseTo(0.8, 6); expect(a.tint).toBe('#3355ff');
    const own = applyLight({ brightness: 1.5, contrast: 1, saturation: 1, tint: '#ff0000', tintAmount: 0.3, halo: 0, haloColor: '#fff', shadow: 0.35 }, l)!;
    expect(own.brightness).toBeCloseTo(1.2, 6); expect(own.tint).toBe('#ff0000');
  });
  it('the session reports the light of the place where each character stands', () => {
    const p = createProject('x'); const e = p.environments[0]; e.width = 2000; e.height = 1000; e.lightMap = map; e.lighting = { enabled: true, strength: 1 };
    let g = emptyGraph(); const n1 = createNode(0.1, 0.8), n2 = createNode(0.9, 0.8); g = addEdge(addNode(addNode(g, n1), n2), createEdge(n1.id, n2.id)); e.navigation = g;
    const c = createCharacter(0, n1.id); e.characters = [c];
    const s = createGameSession(p), f0 = s.frame().characters[0];
    expect(f0.light!.brightness).toBeGreaterThan(1);
    e.lighting = { enabled: false, strength: 1 }; expect(createGameSession(p).frame().characters[0].light).toBeNull();
  });
});

import { decodeMask, emptyMask, encodeMask, stamp, zoneGrid, zonesScale, coverageAt } from '@/engine/navigation/scaleZones';
import { scaleAt } from '@/engine/navigation/perspective';
describe('scale zones (painted)', () => {
  const env = { width: 2000, height: 1000, perspective: undefined, scaleZones: [] as import('@/types').ScaleZone[] };
  const grid = zoneGrid(env);
  const paint = (cx: number, cy: number, r: number, mode: 'paint' | 'erase' = 'paint', m = emptyMask(grid.w, grid.h)) => { stamp(m, grid.w, grid.h, 2, cx, cy, r, mode); return m; };
  it('the grid has the aspect of the environment and masks round-trip through base64', () => {
    expect(grid.w).toBe(256); expect(grid.h).toBe(128);
    const m = paint(0.5, 0.5, 0.1); expect(Array.from(decodeMask(encodeMask(m), grid.w, grid.h))).toEqual(Array.from(m));
    expect(decodeMask('', grid.w, grid.h).length).toBe(grid.w * grid.h); expect(decodeMask('AAAA', grid.w, grid.h).length).toBe(grid.w * grid.h);   // wrong size → empty
  });
  it('the brush is round on screen (radius = fraction of the height), soft at the edge, and erase removes it', () => {
    const m = paint(0.5, 0.5, 0.2);
    expect(coverageAt(m, grid.w, grid.h, 0.5, 0.5)).toBeGreaterThan(0.95);
    expect(coverageAt(m, grid.w, grid.h, 0.5, 0.5 + 0.1)).toBeGreaterThan(0.9);                 // inside
    expect(coverageAt(m, grid.w, grid.h, 0.5 + 0.085, 0.5)).toBeGreaterThan(0.1);           // 0.085 of the WIDTH = 170 px: near the rim, soft
    expect(coverageAt(m, grid.w, grid.h, 0.5, 0.5 + 0.26)).toBe(0);                              // outside
    stamp(m, grid.w, grid.h, 2, 0.5, 0.5, 0.3, 'erase', 1); expect(coverageAt(m, grid.w, grid.h, 0.5, 0.5)).toBe(0);
  });
  it('inside a zone the scale is the zone’s, outside it is the automatic one, and the edge blends', () => {
    const e = { ...env, perspective: { topScale: 0.8, bottomScale: 1 }, scaleZones: [{ id: 'z', name: 'Tunnel', scale: 0.3, color: '#fff', mask: encodeMask(paint(0.7, 0.4, 0.15)) }] };
    expect(scaleAt(e, 0.7, 0.4)).toBeCloseTo(0.3, 1);
    expect(scaleAt(e, 0.1, 0.9)).toBeCloseTo(0.98, 2);                                           // untouched: automatic perspective
    const edge = scaleAt(e, 0.7 + 0.15 * 0.5, 0.4); expect(edge).toBeGreaterThan(0.3); expect(edge).toBeLessThan(0.92);
    e.scaleZones[0].scale = 0.5; expect(scaleAt(e, 0.7, 0.4)).toBeCloseTo(0.5, 1);                 // editable afterwards
  });
  it('several zones: the later one is on top; a node with its own scale wins over the zones', () => {
    const a = { id: 'a', name: 'A', scale: 0.5, color: '#f00', mask: encodeMask(paint(0.5, 0.5, 0.2)) }, b = { id: 'b', name: 'B', scale: 0.2, color: '#0f0', mask: encodeMask(paint(0.5, 0.5, 0.1)) };
    const e = { ...env, scaleZones: [a, b] };
    expect(zonesScale(e, 0.5, 0.5, 1)).toBeCloseTo(0.2, 1); expect(zonesScale(e, 0.5 + 0.1 * 0.6 + 0.05, 0.5 + 0.12, 1)).toBeGreaterThan(0.2);
    expect(nodeScale(e, { x: 0.5, y: 0.5, props: { scale: '0.9' } })).toBe(0.9); expect(nodeScale(e, { x: 0.5, y: 0.5, props: {} })).toBeCloseTo(0.2, 1);
  });
  it('walking along a path shrinks the character exactly where the zone is', () => {
    const p = createProject('x'); const e = p.environments[0]; e.width = 2000; e.height = 1000;
    e.scaleZones = [{ id: 'z', name: 'Z', scale: 0.3, color: '#fff', mask: encodeMask(paint(0.5, 0.5, 0.12)) }];
    let g = emptyGraph(); const n1 = createNode(0.1, 0.5), n2 = createNode(0.9, 0.5); g = addEdge(addNode(addNode(g, n1), n2), createEdge(n1.id, n2.id)); e.navigation = g;
    const c = createCharacter(0, n1.id); c.behavior.mode = 'manual'; c.speed = 0.4; const a = new Agent(e, c); a.goTo(n2.id);
    const seen: number[] = [];
    for (let t = 0; t < 40; t += 1 / 30) { a.step(1 / 30); const s = a.snapshot(); if (s.edgeId) seen.push(s.scale); if (s.nodeId === n2.id) break; }
    expect(seen[0]).toBeCloseTo(1, 1); expect(Math.min(...seen)).toBeLessThan(0.4); expect(seen[seen.length - 1]).toBeGreaterThan(0.8);   // big → small in the zone → big again
  });
});

describe('placing the character on a node', () => {
  it('teleport puts it on the node at once, clears route/actions/pause and does not count as an arrival', () => {
    const p = createProject('x'); const e = p.environments[0]; e.width = 2000; e.height = 1000;
    let g = emptyGraph(); const n1 = createNode(0.1, 0.5), n2 = createNode(0.5, 0.5), n3 = createNode(0.9, 0.5); g = addNode(addNode(addNode(g, n1), n2), n3); g = addEdge(addEdge(g, createEdge(n1.id, n2.id)), createEdge(n2.id, n3.id)); e.navigation = g;
    const c = createCharacter(0, n1.id); c.behavior.mode = 'manual'; const a = new Agent(e, c);
    a.goTo(n3.id); for (let i = 0; i < 30; i++) a.step(1 / 30); a.queueAction('COLLECT', 5);
    const seq = a.arrivalSeq;
    expect(a.teleport(n3.id)).toBe(true);
    const s = a.snapshot(); expect(s.nodeId).toBe(n3.id); expect(s.x).toBeCloseTo(0.9, 6); expect(s.state).toBe('IDLE'); expect(s.edgeId).toBeNull(); expect(s.acting).toBe(false); expect(a.arrivalSeq).toBe(seq);
    for (let i = 0; i < 60; i++) a.step(1 / 30); expect(a.snapshot().nodeId).toBe(n3.id);              // stays there (manual mode)
    expect(a.teleport('nope')).toBe(false);
  });
});
