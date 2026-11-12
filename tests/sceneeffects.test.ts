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
    const a = { y: 1, props: {} }, b = { y: 0, props: { scale: '0.2' } };
    expect(nodeScale(env, a)).toBe(1); expect(nodeScale(env, b)).toBe(0.2); expect(nodeScale(env, { y: 0.2, props: { scale: 'abc' } })).toBeCloseTo(0.6, 6);
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
