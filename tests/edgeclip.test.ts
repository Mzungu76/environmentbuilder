import { describe, expect, it } from 'vitest';
import type { Clip, PuppetView } from '@/types';
import { PuppetPlayer } from '@/engine/puppet/player';
import { clipFor } from '@/engine/puppet/runtime';
import { defaultClips } from '@/engine/puppet/animation';
import { createPuppet } from '@/lib/studio/pipeline';
import { templateLandmarks } from '@/engine/puppet/skeleton';

const view = (): PuppetView => {
  const base = { id: 'side', crop: { x: 0, y: 0, w: 300, h: 800 }, cutoutAssetId: 'a', width: 300, height: 800, figureHeight: 800, pivot: { x: 150, y: 800 }, landmarks: templateLandmarks('side', { x: 0, y: 0, w: 300, h: 800 }, 150),
    mesh: { cell: 1, vertices: [100, 400, 160, 400, 100, 460], uvs: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }, skin: { idx: [6, 0, 0, 0, 6, 0, 0, 0, 6, 0, 0, 0], w: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] }, weightParams: { falloff: 0.3, smooth: 2, farPenalty: 1 }, ...defaultClips('side') } as unknown as PuppetView;
  const custom: Clip = { id: 'c1', name: 'Discesa nuova', duration: 2, loop: false, keys: [{ t: 0, pose: { rot: { uarmR: 0 }, dx: 0, dy: 0 } }, { t: 1, pose: { rot: { uarmR: -90 }, dx: 0, dy: 0 } }] };
  return { ...base, clips: [...base.clips, custom] };
};

describe('animation chosen on a path segment', () => {
  it('clipFor finds a clip by name (any case) or id, and falls back to the state clip', () => {
    const v = view();
    expect(clipFor(v, 'WALK', 'Discesa nuova')!.id).toBe('c1'); expect(clipFor(v, 'WALK', '  discesa NUOVA ')!.id).toBe('c1'); expect(clipFor(v, 'WALK', 'c1')!.id).toBe('c1');
    expect(clipFor(v, 'WALK', 'non esiste')!.id).toBe(v.stateClips.WALK); expect(clipFor(v, 'WALK')!.id).toBe(v.stateClips.WALK);
  });
  it('a custom clip that does not loop is spread over the whole segment (progress drives it)', () => {
    const puppet = { ...createPuppet('p'), views: { side: view() }, idleView: 'side' as const };
    const pl = new PuppetPlayer();
    const at = (p: number) => Array.from(pl.frame(puppet, 'WALK', 0.016, 0, undefined, { clip: 'Discesa nuova', progress: p })!.positions).join(',');   // (the buffer is reused: copy it)
    const a = at(0), mid = at(0.5), end = at(1);
    expect(a).not.toBe(end); expect(mid).not.toBe(a); expect(mid).not.toBe(end);              // the pose follows the progress
  });
  it('without a clip name the state mapping is used, exactly as before', () => {
    const puppet = { ...createPuppet('p'), views: { side: view() }, idleView: 'side' as const };
    const f = new PuppetPlayer().frame(puppet, 'WALK', 0.016, 0, undefined, {})!, g = new PuppetPlayer().frame(puppet, 'WALK', 0.016, 0)!;
    expect(Array.from(f.positions)).toEqual(Array.from(g.positions));
  });
});
