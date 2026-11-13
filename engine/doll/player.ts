import type { CharacterState, Clip, Doll } from '@/types';
import { defaultClips, phaseRate, samplePose } from '@/engine/puppet/animation';
import { buildDollShapes, DOLL_HEIGHT, type DollShape } from './shapes';

interface ClipSet { clips: Clip[]; stateClips: Partial<Record<CharacterState, string>> }
const sets = new WeakMap<Doll, ClipSet>();

/** The standard side-view clips scaled by the doll's vivacity (cached per doll). */
export function dollClips(doll: Doll): ClipSet {
  let s = sets.get(doll);
  if (!s) {
    s = scaled(defaultClips('side'), doll.motion.vivacity);
    sets.set(doll, s);
  }
  return s;
}

function scaled(set: ClipSet, a: number): ClipSet {
  if (Math.abs(a - 1) < 1e-3) return set;
  const clips = set.clips.map((c) => ({ ...c, keys: c.keys.map((k) => ({ t: k.t, pose: { rot: Object.fromEntries(Object.entries(k.pose.rot).map(([b, v]) => [b, (v as number) * a])), dx: k.pose.dx * a, dy: k.pose.dy * a } })) }));
  return { clips, stateClips: set.stateClips };
}

/** Per-character animation clock for dolls: state → clip → posed shapes. Walk cycles sync to the travel speed. */
export class DollPlayer {
  private phase = 0;
  private last: CharacterState | null = null;

  /** `speedFigureHeights` = speed ÷ figure height. `dt` = 0 renders without advancing. */
  frame(doll: Doll, state: CharacterState, dt: number, speedFigureHeights: number): DollShape[] {
    const { clips, stateClips } = dollClips(doll);
    const clip = clips.find((c) => c.id === (stateClips[state] ?? stateClips.IDLE)) ?? clips[0];
    if (state !== this.last) { this.last = state; this.phase = 0; }
    if (clip && dt > 0) { const n = this.phase + dt * phaseRate(clip, speedFigureHeights); this.phase = clip.loop ? n % 1 : Math.min(1, n); }
    return buildDollShapes(doll, clip ? samplePose(clip, this.phase) : { rot: {}, dx: 0, dy: 0 });
  }
}

export { DOLL_HEIGHT };
