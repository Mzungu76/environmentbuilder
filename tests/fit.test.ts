import { describe, expect, it } from 'vitest';
import type { Pose } from '@/types';
import { BONE_IDS } from '@/types';
import { fitPoseToSilhouette, fillCapsules, poseCapsules } from '@/engine/puppet/fit';
import { apply, boneMatrices, buildRig, bodyCenterX, refineLandmarks, templateLandmarks } from '@/engine/puppet/skeleton';
import { opaqueBounds, newImg } from '@/engine/puppet/imageProc';

function ref() {
  const img = newImg(300, 800);
  for (let y = 10; y < 780; y++) for (let x = 110; x < 190; x++) { const i = (y * 300 + x) * 4; img.data[i + 3] = 255; }
  const b = opaqueBounds(img)!;
  return { landmarks: refineLandmarks(img, templateLandmarks('side', b, bodyCenterX(img, b, 'side')), 'side', b), figureHeight: b.h };
}
/** The "AI drawing": the reference skeleton posed, drawn as capsules at another scale and position. */
function drawing(r: ReturnType<typeof ref>, pose: Pose, sc: number, ox: number, oy: number) {
  const W = 420, H = 760, caps = poseCapsules(r, pose).map((c) => ({ a: { x: c.a.x * sc + ox, y: c.a.y * sc + oy }, b: { x: c.b.x * sc + ox, y: c.b.y * sc + oy }, r: c.r * sc }));
  const mask = new Uint8Array(W * H); fillCapsules(mask, W, H, caps);
  const img = newImg(W, H); for (let i = 0; i < mask.length; i++) if (mask[i]) img.data[i * 4 + 3] = 255;
  return img;
}
/** Mean landmark error (in figure heights). Near/far limbs are interchangeable in a silhouette, so each R/L pair is matched either way. */
const err = (r: ReturnType<typeof ref>, pose: Pose, sc: number, ox: number, oy: number, got: NonNullable<ReturnType<typeof fitPoseToSilhouette>>) => {
  const rig = buildRig(r)!, mats = boneMatrices(rig, pose);
  const truth = (id: string, bone: string) => { const p = apply(mats[BONE_IDS.indexOf(bone as never)], r.landmarks[id as 'neck']!); return { x: p.x * sc + ox, y: p.y * sc + oy }; };
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) / (r.figureHeight * sc);
  let e = 0, n = 0;
  for (const [l, lb, rr, rb] of [['wristL', 'handL', 'wristR', 'handR'], ['elbowL', 'farmL', 'elbowR', 'farmR'], ['kneeL', 'shinL', 'kneeR', 'shinR'], ['ankleL', 'footL', 'ankleR', 'footR']] as const) {
    const tl = truth(l, lb), tr = truth(rr, rb), gl = got.landmarks[l]!, gr = got.landmarks[rr]!;
    e += Math.min(d(tl, gl) + d(tr, gr), d(tl, gr) + d(tr, gl)) / 2; n++;
  }
  e += d(truth('neck', 'head'), got.landmarks.neck!); n++;
  return e / n;
};

describe('silhouette fit', () => {
  const R = ref();
  const POSES: Record<string, Pose> = {
    climb: { rot: { uarmR: -150, uarmL: -120, farmR: -20, farmL: -20, thighR: -45, shinR: 70, thighL: -10, torso: 4 }, dx: 0, dy: 0 },
    step: { rot: { thighR: -40, shinR: 20, thighL: 30, shinL: 40, uarmR: 30, uarmL: -30 }, dx: 0, dy: 0 },
    crouch: { rot: { thighR: -80, thighL: -75, shinR: 100, shinL: 95, torso: 25, uarmR: -40, uarmL: -35 }, dx: 0, dy: 0 },
  };
  for (const [name, pose] of Object.entries(POSES)) {
    it(`recovers scale and joints of a known «${name}» pose`, () => {
      const sc = 0.72, ox = 50, oy = 30, got = fitPoseToSilhouette(R, drawing(R, pose, sc, ox, oy))!;
      expect(got).not.toBeNull();
      expect(got.scale).toBeGreaterThan(sc * 0.9); expect(got.scale).toBeLessThan(sc * 1.1);
      expect(got.score).toBeGreaterThan(0.7);
      expect(err(R, pose, sc, ox, oy, got)).toBeLessThan(name === 'step' ? 0.08 : 0.18);   // mean landmark error (figure heights); folded legs are ambiguous in a silhouette
    });
  }
  it('is not fooled by an empty drawing', () => { expect(fitPoseToSilhouette(R, newImg(50, 50))).toBeNull(); });
});
