import type { CharacterState, Puppet, PuppetView, ViewId } from '@/types';
import { advancePhase, chooseViewForState, poseAt, resolveView, skinVertices } from './runtime';
import { sampleSet } from './keyposes';

export interface PuppetLayer { view: PuppetView; positions: Float32Array; alpha: number }
export interface PuppetFrame {
  viewId: ViewId; view: PuppetView; positions: Float32Array;
  /** Key-pose playback only: the neighbouring key, drawn on top of the main layer with this alpha. */
  over?: PuppetLayer;
}

const setKeyOf = (state: CharacterState): 'climb' | 'jump' | null => (state === 'CLIMB' ? 'climb' : state === 'JUMP' || state === 'FALL' ? 'jump' : null);

/**
 * Per-character animation clock. Picks the view, advances the clip phase (walk cycles sync to the travel speed)
 * and returns the skinned vertices. Pure: used by the playtest renderer and available to host games.
 */
export class PuppetPlayer {
  private phase = 0;
  private lastState: CharacterState | null = null;
  private buf = new WeakMap<PuppetView, Float32Array>();

  /** `speedFigureHeights` = travel speed divided by the figure height (px/s ÷ px). `dt` = 0 renders without advancing. */
  frame(puppet: Puppet, state: CharacterState, dt: number, speedFigureHeights: number, hint?: string): PuppetFrame | null {
    if (state !== this.lastState) { this.lastState = state; this.phase = 0; }
    const sk = setKeyOf(state);
    const set = !hint && sk ? puppet.poseSets?.[sk] : undefined;
    if (set && set.frames.length >= 2 && set.frames.every((f) => f.mesh && f.skin && f.cutoutAssetId)) {
      if (dt > 0) { const next = this.phase + dt / Math.max(0.05, set.duration); this.phase = set.loop ? next % 1 : Math.min(1, next); }
      const s = sampleSet(set, this.phase);
      if (s) {
        const under = this.layer(s.under.view, s.under.pose);
        const over = s.over ? this.layer(s.over.view, s.over.pose) : null;
        if (under) return { viewId: s.under.view.id, view: s.under.view, positions: under, over: over && s.over ? { view: s.over.view, positions: over, alpha: s.over.alpha } : undefined };
      }
    }
    const viewId = chooseViewForState(puppet.views, state, puppet.idleView, hint);
    if (!viewId) return null;
    const view = resolveView(puppet.views[viewId]!);
    if (dt > 0) this.phase = advancePhase(view, state, this.phase, dt, speedFigureHeights);
    const positions = skinVertices(view, poseAt(view, state, this.phase), this.buf.get(view));
    if (!positions) return null;
    this.buf.set(view, positions);
    return { viewId, view, positions };
  }

  private layer(view: PuppetView, pose: import('@/types').Pose): Float32Array | null {
    const pos = skinVertices(view, pose, this.buf.get(view));
    if (pos) this.buf.set(view, pos);
    return pos;
  }
}
