import { describe, expect, it } from 'vitest';
import type { Puppet, PuppetView, ViewId } from '@/types';
import { BONE_IDS } from '@/types';
import { alignLimbSides, frameQualities, posePartway, sampleSet } from '@/engine/puppet/keyposes';
import { PuppetPlayer } from '@/engine/puppet/player';
import { boneMatrices, buildRig, apply, restAngle, templateLandmarks } from '@/engine/puppet/skeleton';
import { defaultClips } from '@/engine/puppet/animation';
import { normalizeScale, autoMesh } from '@/lib/studio/poseSets';
import { newImg } from '@/engine/puppet/imageProc';
import { createPuppet } from '@/lib/studio/pipeline';

const bounds = { x: 0, y: 0, w: 300, h: 800 };
function frame(id: ViewId, kind: 'side' | 'climb', scale = 1): PuppetView {
  const lm = templateLandmarks(kind, bounds, 150);
  const s = (p: { x: number; y: number }) => ({ x: p.x * scale, y: p.y * scale });
  const landmarks = Object.fromEntries(Object.entries(lm).map(([k, p]) => [k, s(p!)]));
  return { id, crop: { x: 0, y: 0, w: 300, h: 800 }, cutoutAssetId: `a-${kind}-${scale}`, width: 300 * scale, height: 800 * scale, figureHeight: 800 * scale, pivot: { x: 150 * scale, y: 800 * scale }, landmarks, mesh: null, skin: null, weightParams: { falloff: 0.3, smooth: 2, farPenalty: 1 }, ...defaultClips(id) };
}
function withMesh(v: PuppetView): PuppetView {
  const img = newImg(Math.round(v.width), Math.round(v.height));
  for (let y = 0; y < img.height; y++) for (let x = 100; x < 200; x++) { const i = (y * img.width + x) * 4; img.data[i] = 200; img.data[i + 3] = 255; }
  return autoMesh(v, img);
}

describe('key poses', () => {
  const A = frame('climb', 'side'), B = frame('climb', 'climb');
  it('posePartway(u=1) orients every bone of A like the same bone of B', () => {
    const rig = buildRig(A)!, pose = posePartway(A, B, 1), mats = boneMatrices(rig, pose), rigB = buildRig(B)!;
    for (const b of rig.bones) {
      const h = apply(mats[b.index], b.head), t = apply(mats[b.index], b.tail);
      const posed = (Math.atan2(t.y - h.y, t.x - h.x) * 180) / Math.PI, target = restAngle(rigB.bones[b.index]);
      expect(Math.abs((((posed - target) % 360) + 540) % 360 - 180)).toBeLessThan(0.01);
    }
    expect(BONE_IDS.length).toBe(15);
  });
  it('posePartway(u=0) is the rest pose', () => {
    const p = posePartway(A, B, 0); expect(Object.keys(p.rot)).toHaveLength(0); expect(Math.abs(p.dx)).toBe(0); expect(Math.abs(p.dy)).toBe(0);
  });
  it('sampleSet: key exactly at a key, cross-fade in between, continuous at the switch', () => {
    const C = frame('climb', 'side', 1.0), set = { frames: [A, B, C], duration: 1, loop: true };
    const s0 = sampleSet(set, 0)!; expect(s0.under.view).toBe(A); expect(s0.over).toBeUndefined();
    const mid = sampleSet(set, 1 / 6)!;                       // halfway between key 0 and key 1
    expect(mid.over).toBeDefined(); expect(mid.under.alpha).toBe(1);
    const before = sampleSet(set, 1 / 6 - 0.002)!, after = sampleSet(set, 1 / 6 + 0.002)!;
    const mixB = (s: NonNullable<typeof before>) => (s.under.view === B ? 1 - (s.over?.alpha ?? 0) : s.over?.alpha ?? 0);
    expect(Math.abs(mixB(before) - mixB(after))).toBeLessThan(0.05);
    const wrap = sampleSet(set, 0.999)!; expect(wrap.over?.view === A || wrap.under.view === A).toBe(true);   // loops back to the first key
  });
  it('non-looping sets stop on the last key', () => {
    const s = sampleSet({ frames: [A, B], duration: 1, loop: false }, 1)!; expect(s.under.view).toBe(B);
  });
  it('flags a frame with another scale or a broken skeleton, accepts a coherent sequence', () => {
    expect(frameQualities([A, frame('climb', 'side'), frame('climb', 'side')]).every((q) => q.ok)).toBe(true);
    const big = frameQualities([A, frame('climb', 'side'), frame('climb', 'side', 2)]);
    expect(big[2].ok).toBe(false); expect(big[2].issues.join()).toMatch(/scala/);
    expect(frameQualities([{ ...A, landmarks: {} }])[0].ok).toBe(false);
  });
  it('normalizeScale derives the standing height from the torso, not from the bounding box', () => {
    const tall = { ...B, figureHeight: 1500 };           // arms-up bbox is taller
    const [n] = normalizeScale([tall], createPuppet('x'));
    expect(n.figureHeight).toBeGreaterThan(700); expect(n.figureHeight).toBeLessThan(1000);
  });
  it('alignLimbSides keeps the same hand the same hand from key to key', () => {
    const base = { ...A, landmarks: { ...A.landmarks, wristR: { x: 300, y: 60 }, elbowR: { x: 250, y: 150 }, handR: { x: 310, y: 20 }, wristL: { x: 250, y: 400 }, elbowL: { x: 200, y: 330 }, handL: { x: 260, y: 440 } } };
    const f0 = base, swapped = { ...base, landmarks: { ...base.landmarks, wristL: base.landmarks.wristR, wristR: base.landmarks.wristL, elbowL: base.landmarks.elbowR, elbowR: base.landmarks.elbowL, handL: base.landmarks.handR, handR: base.landmarks.handL } };
        const [a, b] = alignLimbSides([f0, swapped]);
    expect(b.landmarks.wristR).toEqual(a.landmarks.wristR); expect(b.landmarks.wristL).toEqual(a.landmarks.wristL);
    const [, c] = alignLimbSides([f0, { ...base }]); expect(c.landmarks.wristR).toEqual(base.landmarks.wristR);   // already consistent: untouched
  });
  it('low fit scores are flagged', () => { expect(frameQualities([{ ...A, fitScore: 0.4 } as never])[0].ok).toBe(false); });
  it('PuppetPlayer uses the set for CLIMB and returns an over layer between keys; other states ignore it', () => {
    const fa = withMesh(A), fb = withMesh(B);
    const puppet: Puppet = { ...createPuppet('p'), views: { side: withMesh(frame('side', 'side')) }, poseSets: { climb: { frames: [fa, fb], duration: 1, loop: true } } };
    const pl = new PuppetPlayer();
    const f0 = pl.frame(puppet, 'CLIMB', 0, 0)!; expect(f0.view).toBe(fa); expect(f0.over).toBeUndefined();
    const f1 = pl.frame(puppet, 'CLIMB', 0.25, 0)!; expect(f1.over).toBeDefined(); expect(f1.over!.alpha).toBeGreaterThan(0); expect(f1.positions.length).toBe(fa.mesh!.vertices.length === f1.positions.length ? f1.positions.length : fb.mesh!.vertices.length);
    const w = new PuppetPlayer().frame(puppet, 'WALK', 0, 0)!; expect(w.view.id).toBe('side'); expect(w.over).toBeUndefined();
    const hint = new PuppetPlayer().frame(puppet, 'CLIMB', 0, 0, 'side')!; expect(hint.viewId).toBe('side');   // explicit hint wins
  });
});

import { puppetJson, validatePuppet } from '@/lib/import-export/puppetPackage';
describe('export of key-pose sequences', () => {
  it('puppet.json carries poseSets with a texture per frame; validation reports bad frames', () => {
    const A = withMesh(frame('climb', 'side')), B = withMesh(frame('climb', 'climb'));
    const p: Puppet = { ...createPuppet('p'), views: { side: withMesh(frame('side', 'side')) }, poseSets: { climb: { frames: [A, B], duration: 1.2, loop: true } } };
    const j = puppetJson(p) as { poseSets: Record<string, { frames: { texture: string }[]; duration: number }> };
    expect(j.poseSets.climb.frames.map((f) => f.texture)).toEqual(['textures/climb-0.png', 'textures/climb-1.png']);
    expect(j.poseSets.climb.duration).toBe(1.2);
    expect(validatePuppet(p).errors.join()).not.toMatch(/Sequenza/);
    const bad: Puppet = { ...p, poseSets: { climb: { frames: [A, { ...B, mesh: null }], duration: 1, loop: true } } };
    expect(validatePuppet(bad).errors.join()).toMatch(/Sequenza arrampicata, posa 2/);
  });
});
