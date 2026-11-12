import type { CollapseConfig, CollapseStage } from '@/types';

/**
 * Collapse timer with the timing of a spinning top. The real duration is drawn at random between min and max and is NEVER exposed:
 * the game only sees how hard the cave is shaking. The wobble speeds up and grows as the end approaches, with a few false alarms
 * early on (tremors that die down), so nobody can tell whether it is about to end or to calm down.
 */
export interface CollapseSignal {
  /** 0–1: how threatening things are right now (drives shake, dust, darkness). Not the same as the progress. */
  intensity: number;
  /** Shake offsets in -1…1 (multiply by your own amplitude) and a small rotation. */
  shake: { x: number; y: number; angle: number };
  /** Stages that fired during this update. */
  fired: CollapseStage[];
  collapsed: boolean;
  /** Index of the last stage reached (-1 = none). */
  stage: number;
}

export class CollapseTimer {
  private readonly cfg: CollapseConfig;
  private readonly rng: () => number;
  private t = 0;
  private total: number;
  private phase = 0;
  private alarms: { at: number; width: number; amp: number }[] = [];
  private stageIdx = -1;
  collapsed = false;

  constructor(cfg: CollapseConfig, rng: () => number) {
    this.cfg = cfg; this.rng = rng;
    const lo = Math.max(1, Math.min(cfg.minSeconds, cfg.maxSeconds)), hi = Math.max(lo, Math.max(cfg.minSeconds, cfg.maxSeconds));
    // skewed draw: shorter runs are more likely than the longest ones, but any value in the range can happen
    this.total = lo + (hi - lo) * Math.pow(rng(), 1.4);
    for (let i = 0; i < Math.max(0, Math.round(cfg.falseAlarms)); i++) this.alarms.push({ at: 0.12 + 0.55 * rng(), width: 0.03 + 0.04 * rng(), amp: 0.25 + 0.35 * rng() });
  }

  /** For tests and the editor's simulation only — a game must not show it. */
  get debugTotal() { return this.total; }
  get debugProgress() { return Math.min(1, this.t / this.total); }

  private intensityAt(p: number): number {
    let base = Math.pow(p, 2.2);
    for (const a of this.alarms) base += a.amp * Math.exp(-Math.pow((p - a.at) / a.width, 2));
    return Math.min(1, base);
  }

  update(dt: number): CollapseSignal {
    if (!this.cfg.enabled) return { intensity: 0, shake: { x: 0, y: 0, angle: 0 }, fired: [], collapsed: false, stage: -1 };
    if (!this.collapsed) this.t += dt;
    const p = Math.min(1, this.t / this.total);
    const intensity = this.collapsed ? 1 : this.intensityAt(p);
    // precession: the wobble frequency rises with the progress, like a top slowing down
    this.phase += dt * 2 * Math.PI * (1.2 + 6 * p * p);
    const amp = intensity * this.cfg.wobble;
    const shake = { x: amp * (0.65 * Math.sin(this.phase) + 0.35 * Math.sin(this.phase * 2.3 + 1.1)), y: amp * 0.6 * Math.sin(this.phase * 1.7 + 0.4), angle: amp * 0.02 * Math.sin(this.phase * 0.9) };
    const fired: CollapseStage[] = [];
    const sorted = [...this.cfg.stages].sort((a, b) => a.at - b.at);
    while (this.stageIdx + 1 < sorted.length && p >= sorted[this.stageIdx + 1].at - 1e-9) { this.stageIdx++; fired.push(sorted[this.stageIdx]); }
    if (p >= 1 && !this.collapsed) this.collapsed = true;
    return { intensity, shake, fired, collapsed: this.collapsed, stage: this.stageIdx };
  }
}
