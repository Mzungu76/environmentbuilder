import { describe, expect, it } from 'vitest';
import { BONE_IDS, type PuppetView } from '@/types';
import { buildManikin, DEFAULT_MANIKIN } from '@/engine/puppet/manikin';
import { bodyCenterX, refineLandmarks, templateLandmarks } from '@/engine/puppet/skeleton';
import { newImg, opaqueBounds, type Img } from '@/engine/puppet/imageProc';
import { resolveView, skinVertices, chooseViewForState } from '@/engine/puppet/runtime';
import { PuppetPlayer } from '@/engine/puppet/player';
import { defaultClips } from '@/engine/puppet/animation';
import { createPuppet } from '@/lib/studio/pipeline';

const RED: [number, number, number] = [200, 40, 40], BLUE: [number, number, number] = [40, 60, 200], GREEN: [number, number, number] = [40, 160, 60];
function fill(img: Img, x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * img.width + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255; }
}
/** Front-like synthetic figure: red torso, blue legs, green arms hanging apart from the body. */
function front(): Img {
  const img = newImg(400, 800);
  fill(img, 180, 20, 220, 90, [220, 180, 150]); fill(img, 150, 100, 250, 330, RED);
  fill(img, 95, 100, 140, 420, GREEN); fill(img, 260, 100, 305, 420, GREEN);
  fill(img, 155, 330, 195, 780, BLUE); fill(img, 205, 330, 245, 780, BLUE);
  return img;
}
/** Side-like figure where a GREEN arm hangs in FRONT of the red torso (the arm occludes it). */
function side(): Img {
  const img = newImg(300, 800);
  fill(img, 110, 20, 170, 90, [220, 180, 150]); fill(img, 100, 100, 200, 330, RED);
  fill(img, 100, 330, 200, 420, [90, 90, 40]);
  fill(img, 140, 110, 190, 420, GREEN);                                  // near arm over the torso
  fill(img, 105, 420, 195, 780, BLUE);
  return img;
}
function viewOf(img: Img, id: 'front' | 'side') {
  const b = opaqueBounds(img)!;
  const landmarks = refineLandmarks(img, templateLandmarks(id, b, bodyCenterX(img, b, id)), id, b);
  return { landmarks, figureHeight: b.h };
}
const px = (a: Img, x: number, y: number) => { const i = (Math.round(y) * a.width + Math.round(x)) * 4; return [a.data[i], a.data[i + 1], a.data[i + 2], a.data[i + 3]]; };

describe('manikin builder', () => {
  const img = front(), v = viewOf(img, 'front');
  const m = buildManikin(img, v, 'front')!;
  it('creates one mesh per bone with valid UVs, indices and skin weights', () => {
    expect(m).not.toBeNull();
    const n = m.mesh.vertices.length / 2;
    expect(m.parts).toHaveLength(15);
    expect(m.mesh.uvs.length).toBe(n * 2); expect(m.skin.idx.length).toBe(n * 4);
    expect(m.mesh.uvs.every((u) => u >= 0 && u <= 1)).toBe(true);
    expect(Math.max(...m.mesh.indices)).toBeLessThan(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < 4; k++) s += m.skin.w[i * 4 + k]; expect(s).toBeCloseTo(1, 4); }
    expect(m.atlas.width).toBeLessThanOrEqual(1100); expect(m.atlas.height).toBeLessThan(2400);
  });
  it('bakes the real colours into the atlas (torso red, legs blue, arms green)', () => {
    const find = (bone: string) => m.parts.find((p) => p.bone === bone)!.island;
    const mid = (r: { x: number; y: number; w: number; h: number }) => px(m.atlas, r.x + r.w / 2, r.y + r.h / 2);
    const torso = mid(find('torso')), leg = mid(find('thighR')), arm = mid(find('uarmL'));
    expect(torso[0]).toBeGreaterThan(150); expect(torso[2]).toBeLessThan(80);
    expect(leg[2]).toBeGreaterThan(150); expect(arm[1]).toBeGreaterThan(120); expect(arm[0]).toBeLessThan(80);
  });
  it('rest pose reproduces the mesh; rotating one arm moves only that arm', () => {
    const view = { id: 'front', landmarks: v.landmarks, figureHeight: v.figureHeight, mesh: m.mesh, skin: m.skin } as unknown as PuppetView;
    const rest = skinVertices(view, { rot: {}, dx: 0, dy: 0 })!;
    for (let i = 0; i < rest.length; i++) expect(rest[i]).toBeCloseTo(m.mesh.vertices[i], 3);
    const moved = skinVertices(view, { rot: { uarmR: -90 }, dx: 0, dy: 0 })!;
    const n = rest.length / 2; let armMoved = 0, legMoved = 0;
    for (let i = 0; i < n; i++) { const d = Math.hypot(moved[i * 2] - rest[i * 2], moved[i * 2 + 1] - rest[i * 2 + 1]); if (d > 15) { if (rest[i * 2] > 255) armMoved++; if (rest[i * 2 + 1] > 600) legMoved++; } }
    expect(armMoved).toBeGreaterThan(10); expect(legMoved).toBe(0);
  });
  it('profile views add darkened copies of the near limbs for the far side', () => {
    const si = side(), sv = viewOf(si, 'side'); const sm = buildManikin(si, sv, 'side')!;
    expect(sm.parts.filter((p) => p.copy).map((p) => p.bone).sort()).toEqual(['farmL', 'footL', 'handL', 'shinL', 'thighL', 'uarmL']);
    expect(m.parts.some((p) => p.copy)).toBe(false);
    const near = sm.parts.find((p) => p.bone === 'thighR')!.island, far = sm.parts.find((p) => p.bone === 'thighL')!.island;
    const a = px(sm.atlas, near.x + near.w / 2, near.y + near.h / 2), b = px(sm.atlas, far.x + far.w / 2, far.y + far.h / 2);
    expect(b[2]).toBeLessThan(a[2]); expect(b[2]).toBeGreaterThan(a[2] * 0.5);                   // darker, same hue
    // far parts are drawn BEFORE the body, near limbs after it (index order = drawing order)
    const firstOfBone = (bone: string) => sm.mesh.indices[0] * 0 + sm.parts.findIndex((p) => p.bone === bone);
    expect(firstOfBone('thighL')).toBeLessThan(firstOfBone('torso')); expect(firstOfBone('uarmR')).toBeGreaterThan(firstOfBone('torso'));
  });
  it('rebuilds what the near arm hides: the torso texture under the arm is torso-coloured, not arm-coloured', () => {
    const si = side(), sv = viewOf(si, 'side');
    const withFix = buildManikin(si, sv, 'side', { ...DEFAULT_MANIKIN, inpaint: true })!, without = buildManikin(si, sv, 'side', { ...DEFAULT_MANIKIN, inpaint: false })!;
    const greenShare = (b: typeof withFix) => { const r = b.parts.find((p) => p.bone === 'torso')!.island; let g = 0, t = 0; for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) { const p = px(b.atlas, r.x + i, r.y + j); if (p[3] > 200) { t++; if (p[1] > p[0] && p[1] > p[2] && p[1] > 120) g++; } } return g / Math.max(1, t); };
    expect(greenShare(without)).toBeGreaterThan(0.08);       // the arm is baked into the torso…
    expect(greenShare(withFix)).toBeLessThan(greenShare(without) * 0.6);   // …unless the hidden area is rebuilt
  });
  it('returns null when the skeleton is incomplete', () => { expect(buildManikin(img, { landmarks: {}, figureHeight: 800 }, 'front')).toBeNull(); });
});

describe('manikin as a drawn variant', () => {
  it('resolveView swaps mesh, skin and texture when enabled, and the player/choosers use the manikin', () => {
    const img = front(), v = viewOf(img, 'front'), m = buildManikin(img, v, 'front')!;
    const base: PuppetView = { id: 'front', crop: { x: 0, y: 0, w: 400, h: 800 }, cutoutAssetId: 'orig', width: 400, height: 800, figureHeight: v.figureHeight, pivot: { x: 200, y: 780 }, landmarks: v.landmarks, mesh: null, skin: null, weightParams: { falloff: 0.3, smooth: 2, farPenalty: 1 }, ...defaultClips('front') };
    expect(resolveView(base)).toBe(base);                                           // nothing enabled
    const withM: PuppetView = { ...base, manikin: { enabled: true, atlasAssetId: 'atlas', width: m.atlas.width, height: m.atlas.height, mesh: m.mesh, skin: m.skin, params: DEFAULT_MANIKIN } };
    const r = resolveView(withM);
    expect(r.cutoutAssetId).toBe('atlas'); expect(r.mesh).toBe(m.mesh); expect(resolveView(withM)).toBe(r);   // cached
    expect(resolveView({ ...withM, manikin: { ...withM.manikin!, enabled: false } }).cutoutAssetId).toBe('orig');
    expect(chooseViewForState({ front: withM }, 'IDLE', 'front')).toBe('front');   // usable although the image mesh was never built
    const p = { ...createPuppet('t'), views: { front: withM }, idleView: 'front' as const };
    const f = new PuppetPlayer().frame(p, 'IDLE', 0, 0)!;
    expect(f.view.cutoutAssetId).toBe('atlas'); expect(f.positions.length).toBe(m.mesh.vertices.length);
    expect(BONE_IDS.length).toBe(15);
  });
});
