import type { CharacterState, Puppet, PuppetView, ViewId } from '@/types';
import { advancePhase, chooseViewForState, poseAt, skinVertices } from './runtime';

export interface PuppetFrame { viewId: ViewId; view: PuppetView; positions: Float32Array }

/**
 * Per-character animation clock. Picks the view, advances the clip phase (walk cycles sync to the travel speed)
 * and returns the skinned vertices. Pure: used by the playtest renderer and available to host games.
 */
export class PuppetPlayer {
  private phase = 0;
  private lastState: CharacterState | null = null;
  private buf = new Map<ViewId, Float32Array>();

  /** `speedFigureHeights` = travel speed divided by the figure height (px/s ÷ px). `dt` = 0 renders without advancing. */
  frame(puppet: Puppet, state: CharacterState, dt: number, speedFigureHeights: number, hint?: string): PuppetFrame | null {
    const viewId = chooseViewForState(puppet.views, state, puppet.idleView, hint);
    if (!viewId) return null;
    const view = puppet.views[viewId]!;
    if (state !== this.lastState) { this.lastState = state; this.phase = 0; }
    if (dt > 0) this.phase = advancePhase(view, state, this.phase, dt, speedFigureHeights);
    const positions = skinVertices(view, poseAt(view, state, this.phase), this.buf.get(viewId));
    if (!positions) return null;
    this.buf.set(viewId, positions);
    return { viewId, view, positions };
  }
}
