import type { Character, CharacterState, Collectible, Environment, GameplayConfig, Project, Puppet } from '@/types';
import { Agent } from '@/engine/simulation/Agent';
import { createRng } from '@/engine/simulation/rng';
import { availableInteractions, createRuntimeState, performInteraction, type GameEvent, type RuntimeState } from '@/engine/interaction/system';
import { PuppetPlayer, type PuppetFrame } from '@/engine/puppet/player';
import { CollapseTimer } from './collapse';
import { sampleLight, type LightSample } from './light';
import { defaultGameplay } from './defaults';

/**
 * Game session: the facade a host game talks to. It runs the characters of ONE environment on their own (autonomous wandering),
 * lets the game say "now a gem is found" (`triggerCollect`) — the character stops, picks it up, celebrates, the counter goes up —
 * and runs the collapse timer. No rendering: every frame the game asks `frame()` and draws what it returns.
 */
export type SessionEventType = 'collect:start' | 'collect:pick' | 'collect:done' | 'score' | 'stage' | 'collapse' | 'arrival' | 'interaction';
export interface SessionEvent { type: SessionEventType; t: number; character?: string; collectible?: Collectible; points?: number; total?: number; stage?: { effect: string; intensity: number; event: string }; node?: string; message?: string }
export type SessionListener = (e: SessionEvent) => void;

export interface Score { points: number; counts: Record<string, number> }
export interface CharacterFrame {
  id: string; name: string; x: number; y: number; facing: 1 | -1; state: CharacterState; speedPx: number; lift: number; edgeId: string | null; nodeId: string | null;
  puppetId: string | null; puppet: PuppetFrame | null;
  /** Character size in environment pixels (use it to scale the puppet: scale = heightPx / view.figureHeight). */
  heightPx: number;
  /** Perspective scale already applied to heightPx (1 = normal). */
  scale: number;
  /** Light of the zone the character stands in (null when the scene has no light map): apply brightness / tint to the sprite. */
  light: LightSample | null;
}
export interface PickupFrame { collectible: Collectible; x: number; y: number; /** 0–1 progress of the pop-up (appears at 0, ends at 1). */ progress: number; character: string }
export interface SessionFrame {
  time: number; environment: { id: string; width: number; height: number };
  characters: CharacterFrame[]; pickups: PickupFrame[];
  score: Score;
  /** Collapse signals (all zero when the environment has none). */
  collapse: { intensity: number; shake: { x: number; y: number; angle: number }; stage: number; collapsed: boolean };
}
export interface CollectResult { ok: boolean; reason?: 'no-character' | 'collapsed' | 'no-collectible'; collectible?: Collectible; character?: string }
export interface SessionOptions { environmentId?: string; seed?: string | number; /** Keep the characters wandering by themselves (default true). */ autonomous?: boolean }

const STEP = 1 / 60;
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

interface Active { agentId: string; collectible: Collectible; stage: 'wait' | 'collect' | 'celebrate'; t0: number; picked: boolean }

export class GameSession {
  readonly env: Environment;
  readonly project: Project;
  readonly gameplay: GameplayConfig;
  readonly runtime: RuntimeState = createRuntimeState();
  readonly score: Score = { points: 0, counts: {} };
  private agents = new Map<string, Agent>();
  private players = new Map<string, PuppetPlayer>();
  private rng: () => number;
  private timer: CollapseTimer | null = null;
  private listeners = new Set<SessionListener>();
  private time = 0;
  private acc = 0;
  private active: Active[] = [];
  private pending: { collectible: Collectible; characterId?: string }[] = [];
  private pickups: { collectible: Collectible; x: number; y: number; t0: number; character: string }[] = [];
  private lastSeq = new Map<string, number>();
  private signal = { intensity: 0, shake: { x: 0, y: 0, angle: 0 }, stage: -1, collapsed: false };

  constructor(project: Project, opts: SessionOptions = {}) {
    const env = project.environments.find((e) => e.id === (opts.environmentId ?? project.activeEnvironmentId)) ?? project.environments[0];
    if (!env) throw new Error('Il progetto non contiene ambienti.');
    this.project = project; this.env = env;
    this.gameplay = { ...defaultGameplay(), ...(env.gameplay ?? {}) };
    const seed = String(opts.seed ?? `${env.id}`);
    this.rng = createRng(hash(seed));
    for (const c of env.characters) {
      const cfg: Character = opts.autonomous === false ? c : { ...c, behavior: { ...c.behavior, mode: 'autonomous' } };
      this.agents.set(c.id, new Agent(env, cfg, `${seed}:${c.name}:${this.agents.size}`)); this.players.set(c.id, new PuppetPlayer());
    }
    if (this.gameplay.collapse.enabled) this.timer = new CollapseTimer(this.gameplay.collapse, createRng(hash(seed + ':collapse')));
  }

  on(fn: SessionListener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: Omit<SessionEvent, 't'>) { const ev = { ...e, t: this.time }; for (const l of this.listeners) l(ev); }

  get collapsed() { return this.signal.collapsed; }
  /** Collectibles defined for the scenario. */
  get collectibles(): Collectible[] { return this.gameplay.collectibles; }

  // --- commands ------------------------------------------------------------------------------------------------------------

  /**
   * "A gem is found": the character stops where it is, picks the item up, celebrates and the counter goes up when it is in hand.
   * `collectibleId` = a specific item, otherwise one is drawn by weight. Requests made while a pick-up is running are queued.
   */
  triggerCollect(collectibleId?: string, characterId?: string): CollectResult {
    if (this.signal.collapsed) return { ok: false, reason: 'collapsed' };
    const list = this.gameplay.collectibles;
    const col = collectibleId ? list.find((c) => c.id === collectibleId || c.name === collectibleId) : this.draw(list);
    if (!col) return { ok: false, reason: 'no-collectible' };
    const id = characterId ?? [...this.agents.keys()][0];
    if (!id || !this.agents.has(id)) return { ok: false, reason: 'no-character' };
    if (this.active.some((a) => a.agentId === id)) { this.pending.push({ collectible: col, characterId: id }); return { ok: true, collectible: col, character: this.agents.get(id)!.config.name }; }
    this.begin(id, col);
    return { ok: true, collectible: col, character: this.agents.get(id)!.config.name };
  }

  private draw(list: Collectible[]): Collectible | undefined {
    const total = list.reduce((a, c) => a + Math.max(0, c.weight), 0);
    if (!list.length) return undefined;
    if (total <= 0) return list[0];
    let r = this.rng() * total;
    return list.find((c) => (r -= Math.max(0, c.weight)) <= 0) ?? list[list.length - 1];
  }

  private begin(agentId: string, col: Collectible) {
    const a = this.agents.get(agentId)!;
    a.queueAction('COLLECT', this.gameplay.collectSeconds); a.queueAction('CELEBRATE', this.gameplay.celebrateSeconds);
    this.active.push({ agentId, collectible: col, stage: 'wait', t0: this.time, picked: false });
    this.emit({ type: 'collect:start', character: a.config.name, collectible: col });
  }

  // --- simulation ----------------------------------------------------------------------------------------------------------

  update(dt: number) {
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= STEP) { this.acc -= STEP; this.step(STEP); }
  }

  private step(dt: number) {
    this.time += dt;
    if (this.timer) {
      const sig = this.timer.update(dt);
      this.signal = { intensity: sig.intensity, shake: sig.shake, stage: sig.stage, collapsed: sig.collapsed };
      for (const s of sig.fired) this.emit({ type: 'stage', stage: { effect: s.effect, intensity: s.intensity, event: s.event } });
      if (sig.collapsed && !this.collapseSent) { this.collapseSent = true; this.emit({ type: 'collapse' }); }
    }
    for (const [id, a] of this.agents) {
      if (this.signal.collapsed) { /* the cave is gone: everyone stops where they are */ continue; }
      a.step(dt);
      this.arrivals(id, a);
    }
    this.progressCollects();
    this.pickups = this.pickups.filter((p) => this.time - p.t0 < 1.4);
  }
  private collapseSent = false;

  /** Runs the 'on-arrival' interactions of the environment (objects placed in the editor) and reports arrivals. */
  private arrivals(id: string, a: Agent) {
    if (a.arrivalSeq === (this.lastSeq.get(id) ?? 0)) return;
    this.lastSeq.set(id, a.arrivalSeq);
    const node = a.snapshot().nodeId;
    if (!a.arrivalFinal || !node) return;
    this.emit({ type: 'arrival', character: a.config.name, node });
    for (const av of availableInteractions(this.env, node, a.config.abilities, this.runtime, 'on-arrival')) {
      const out = performInteraction(this.env, av, a.config, this.runtime, this.time);
      a.queueAction(out.state, out.seconds);
      this.emit({ type: 'interaction', character: a.config.name, message: out.message, node });
      const colId = av.interaction.props.collectible, col = colId ? this.gameplay.collectibles.find((c) => c.id === colId) : undefined;
      if (col) this.addScore(col, a.config.name);
    }
  }

  private progressCollects() {
    for (const act of [...this.active]) {
      const a = this.agents.get(act.agentId)!, snap = a.snapshot();
      if (act.stage === 'wait' && snap.state === 'COLLECT') { act.stage = 'collect'; act.t0 = this.time; }
      if (act.stage === 'collect') {
        if (!act.picked && this.time - act.t0 >= this.gameplay.collectSeconds * 0.55) {
          act.picked = true; this.addScore(act.collectible, a.config.name);
          this.pickups.push({ collectible: act.collectible, x: snap.x * this.env.width, y: snap.y * this.env.height, t0: this.time, character: a.config.name });
          this.emit({ type: 'collect:pick', character: a.config.name, collectible: act.collectible });
        }
        if (snap.state === 'CELEBRATE') act.stage = 'celebrate';
      } else if (act.stage === 'celebrate' && snap.state !== 'CELEBRATE') {
        this.active = this.active.filter((x) => x !== act);
        this.emit({ type: 'collect:done', character: a.config.name, collectible: act.collectible });
        const next = this.pending.findIndex((p) => p.characterId === act.agentId);
        if (next >= 0) { const [p] = this.pending.splice(next, 1); this.begin(act.agentId, p.collectible); }
      }
    }
  }

  private addScore(col: Collectible, who: string) {
    this.score.points += col.points; this.score.counts[col.id] = (this.score.counts[col.id] ?? 0) + 1;
    this.emit({ type: 'score', character: who, collectible: col, points: col.points, total: this.score.points });
  }

  // --- what the host draws ---------------------------------------------------------------------------------------------------

  frame(dt = 0): SessionFrame {
    const characters: CharacterFrame[] = [];
    for (const [id, a] of this.agents) {
      const s = a.snapshot(), cfg = a.config;
      const puppet = cfg.puppetId ? (this.project.puppets.find((p: Puppet) => p.id === cfg.puppetId) ?? null) : null;
      const heightPx = Math.max(1, cfg.height * s.scale * this.env.height);
      const hint = s.edgeId ? this.env.navigation.edges.find((e) => e.id === s.edgeId)?.props.view : undefined;
      const pf = puppet ? this.players.get(id)!.frame(puppet, s.state, dt, s.speedPx / heightPx, hint, { clip: s.edgeId ? this.env.navigation.edges.find((e) => e.id === s.edgeId)?.props.clip : undefined, progress: s.edgeProgress }) : null;
      characters.push({ id, name: cfg.name, x: s.x * this.env.width, y: s.y * this.env.height, facing: s.facing, state: s.state, speedPx: s.speedPx, lift: s.lift, edgeId: s.edgeId, nodeId: s.nodeId, puppetId: cfg.puppetId ?? null, puppet: pf, heightPx, scale: s.scale, light: this.env.lighting?.enabled && this.env.lightMap ? sampleLight(this.env.lightMap, s.x, Math.max(0, s.y - cfg.height * s.scale * 0.4), this.env.lighting.strength) : null });
    }
    return {
      time: this.time, environment: { id: this.env.id, width: this.env.width, height: this.env.height }, characters,
      pickups: this.pickups.map((p) => ({ collectible: p.collectible, x: p.x, y: p.y, progress: Math.min(1, (this.time - p.t0) / 1.4), character: p.character })),
      score: { points: this.score.points, counts: { ...this.score.counts } },
      collapse: { ...this.signal },
    };
  }

  /** Editor / tests only: the hidden total and progress of the collapse. A game must not use these. */
  get debugCollapse() { return this.timer ? { total: this.timer.debugTotal, progress: this.timer.debugProgress } : null; }
  /** Host events recorded by the interaction system. */
  get events(): GameEvent[] { return this.runtime.events; }
}

export function createGameSession(project: Project, opts?: SessionOptions) { return new GameSession(project, opts); }
