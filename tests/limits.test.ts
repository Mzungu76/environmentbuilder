import { describe, expect, it } from 'vitest';
import { clampPose, limitsFor } from '@/engine/puppet/limits';
import { makePreset, defaultClips } from '@/engine/puppet/animation';
import { EXTRA_KINDS } from '@/engine/puppet/presets';
import { poseAt } from '@/engine/puppet/runtime';
import { templateLandmarks } from '@/engine/puppet/skeleton';
import type { PuppetView } from '@/types';

describe('joint limits', () => {
  it('a knee cannot bend backwards and an elbow cannot hyper-extend (profile)', () => {
    const p = clampPose({ rot: { shinR: -40, farmR: 30, thighR: -170, uarmR: -200 }, dx: 0, dy: 0 }, 'side');
    expect(p.rot.shinR).toBe(-10); expect(p.rot.farmR).toBe(8); expect(p.rot.thighR).toBe(-115); expect(p.rot.uarmR).toBe(-175);
  });
  it('frontal views: arms open sideways, the left side is the mirror of the right, knees barely bend in the image plane', () => {
    const l = limitsFor('front');
    expect(l.uarmR).toEqual([-170, 15]); expect(l.uarmL).toEqual([-15, 170]); expect(l.thighL![0]).toBe(-l.thighR![1]);
    const p = clampPose({ rot: { uarmR: 60, uarmL: -60, shinR: 90 }, dx: 0, dy: 0 }, 'front');
    expect(p.rot.uarmR).toBe(15); expect(p.rot.uarmL).toBe(-15); expect(p.rot.shinR).toBe(15);
  });
  it('returns the same object when the pose is already valid; pose views have no limits', () => {
    const ok = { rot: { uarmR: -90 }, dx: 0, dy: 0 }; expect(clampPose(ok, 'side')).toBe(ok);
    expect(clampPose({ rot: { shinR: -90 }, dx: 0, dy: 0 }, 'climb').rot.shinR).toBe(-90);
  });
  it('every preset stays inside the limits of the profile view (no silent clipping of the ready-made movements)', () => {
    const lm = templateLandmarks('side', { x: 0, y: 0, w: 300, h: 800 }, 150);
    const view = { id: 'side', landmarks: lm, figureHeight: 800, pivot: { x: 150, y: 800 } } as unknown as PuppetView;
    const lim = limitsFor('side');
    for (const k of [...EXTRA_KINDS, 'walk', 'climb', 'jump', 'fall', 'idle', 'interact', 'collect'] as const) {
      const c = makePreset(k, 'side', 1, view);
      for (const key of c.keys) for (const [b, v] of Object.entries(key.pose.rot) as [keyof typeof lim, number][]) { const l = lim[b]; if (l) expect(v, `${k} ${b}`).toBeGreaterThanOrEqual(l[0] - 0.01), expect(v, `${k} ${b}`).toBeLessThanOrEqual(l[1] + 0.01); }
    }
  });
  it('poseAt applies the limits at runtime', () => {
    const view = { id: 'side', ...defaultClips('side') } as unknown as PuppetView;
    const clip = { ...view.clips[0], keys: [{ t: 0, pose: { rot: { shinR: -80 }, dx: 0, dy: 0 } }, { t: 1, pose: { rot: { shinR: -80 }, dx: 0, dy: 0 } }] };
    expect(poseAt({ ...view, clips: [clip], stateClips: { IDLE: clip.id } }, 'IDLE', 0.3).rot.shinR).toBe(-10);
  });
});
