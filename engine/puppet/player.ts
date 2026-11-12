import type { CharacterState, Puppet, PuppetView, ViewId } from '@/types';
import { advancePhase, chooseViewForState, clipFor, poseAt, resolveView, skinVertices } from './runtime';
import { activeAttachments, attachmentQuad, type AttachQuad } from './attachments';
import { sampleSet } from './keyposes';
import { blendPoses } from './animation';
import type { Pose } from '@/types';

export interface PuppetLayer { view: PuppetView; positions: Float32Array; alpha: number }
export interface PuppetFrame {
  viewId: ViewId; view: PuppetView; positions: Float32Array;
  /** Key-pose playback only: the neighbouring key, drawn on top of the main layer with this alpha. */
  over?: PuppetLayer;
  /** Tools / objects held in this frame (view pixel space). */
  attachments?: AttachQuad[];
}

const setKeyOf = (state: CharacterState): 'climb' | 'jump' | null => (state === 'CLIMB' ? 'climb' : state === 'JUMP' || state === 'FALL' ? 'jump' : null);

/**
 * Per-character animation clock. Picks the view, advances the clip phase (walk cycles sync to the travel speed)
 * and returns the skinned vertices. Pure: used by the playtest renderer and available to host games.
 */
export class PuppetPlayer {
  private phase = 0;
  private lastState: CharacterState | null = null;
  private lastClip: string | undefined;
  private buf = new WeakMap<PuppetView, Float32Array>();
  private cur: Pose | null = null;
  private blend: { from: Pose; t: number } | null = null;
  /** Seconds to cross-fade from the previous animation when the state changes. */
  blendTime = 0.18;

  /** `speedFigureHeights` = travel speed divided by the figure height (px/s ÷ px). `dt` = 0 renders without advancing. */
  /**
   * `extra.clip` = clip (by name) chosen on the path segment; `extra.progress` (0–1) = how far along the segment the character is: a
   * clip that does not loop is spread over the whole segment (e.g. a descent), looping ones keep their own rhythm.
   */
  frame(puppet: Puppet, state: CharacterState, dt: number, speedFigureHeights: number, hint?: string, extra?: { clip?: string; progress?: number }): PuppetFrame | null {
    const clipName = extra?.clip || undefined;
    if (clipName !== this.lastClip) { this.lastClip = clipName; this.phase = 0; }
    if (state !== this.lastState) { this.blend = this.lastState && this.cur && this.blendTime > 0 ? { from: this.cur, t: 0 } : null; this.lastState = state; this.phase = 0; }
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
    const named = clipFor(view, state, clipName);
    if (dt > 0) this.phase = advancePhase(view, state, this.phase, dt, speedFigureHeights, clipName);
    if (clipName && named && !named.loop && extra?.progress !== undefined) this.phase = Math.max(0, Math.min(1, extra.progress));
    let pz = poseAt(view, state, this.phase, clipName);
    if (this.blend) {
      this.blend.t += dt / Math.max(0.01, this.blendTime);
      const u = Math.min(1, this.blend.t), e = (1 - Math.cos(Math.PI * u)) / 2;
      pz = blendPoses(this.blend.from, pz, e);
      if (u >= 1) this.blend = null;
    }
    this.cur = pz;
    const positions = skinVertices(view, pz, this.buf.get(view));
    if (!positions) return null;
    this.buf.set(view, positions);
    const att = activeAttachments(puppet.attachments, clipFor(view, state, clipName), viewId).map((a) => attachmentQuad(view, pz, a)).filter((q): q is AttachQuad => !!q);
    return { viewId, view, positions, attachments: att.length ? att : undefined };
  }

  private layer(view: PuppetView, pose: import('@/types').Pose): Float32Array | null {
    const pos = skinVertices(view, pose, this.buf.get(view));
    if (pos) this.buf.set(view, pos);
    return pos;
  }
}
