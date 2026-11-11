import type { Character, CharacterState, Environment, Vec2 } from '@/types';
import { buildTrack, pointAt, reverseTrack, type Track } from './track';
import { canTraverse, findRoute, reachableNodes, type RouteStep } from './routing';
import { createRng, hashString } from './rng';

export interface AgentSnapshot {
  x: number; y: number;           // normalized
  facing: 1 | -1;
  state: CharacterState;
  nodeId: string | null;          // node the agent is standing on (null while in transit)
  lastNodeId: string | null;
  edgeId: string | null;
  edgeType: string | null;
  speedPx: number;                // effective speed, px/s (0 when not moving)
  destinationId: string | null;
  routeNodeIds: string[];
  routeEdgeIds: string[];
  waiting: number;                // seconds of pause left
  time: number;
}

export type GoToResult = { ok: true } | { ok: false; reason: 'no-node' | 'unreachable' };

/**
 * One simulated character. Fully deterministic (seeded RNG, fixed-step friendly) and graph-driven:
 * the position is ALWAYS a point on a navigation edge or on a node – there is no free movement.
 * The character config is read live (`config`) so edits in the panel apply immediately.
 */
export class Agent {
  config: Character;
  private readonly env: Environment;
  private rng: () => number;
  private tracks = new Map<string, Track>();

  private nodeId: string | null = null;
  private lastNodeId: string | null = null;
  private track: Track | null = null;
  private s = 0;
  private moving = false;
  private route: RouteStep[] = [];
  private destination: string | null = null;
  private pause = 0;
  private decisionTimer = 0;
  private facing: 1 | -1 = 1;
  private state: CharacterState = 'IDLE';
  private pos: Vec2 = { x: 0, y: 0 };
  private speedPx = 0;
  private time = 0;

  constructor(env: Environment, config: Character) {
    this.env = env; this.config = config;
    this.rng = createRng(hashString(config.id));
    this.reset();
  }

  /** Back to the start node, RNG re-seeded. */
  reset() {
    this.rng = createRng(hashString(this.config.id));
    const nav = this.env.navigation;
    const start = nav.nodes.find((n) => n.id === this.config.startNodeId) ?? nav.nodes[0] ?? null;
    this.track = null; this.s = 0; this.moving = false; this.route = []; this.destination = null;
    this.pause = 0; this.decisionTimer = 0; this.state = 'IDLE'; this.speedPx = 0; this.time = 0; this.lastNodeId = null;
    this.nodeId = start?.id ?? null;
    this.pos = start ? { x: start.x, y: start.y } : { x: 0, y: 0 };
  }

  get hasPosition() { return this.nodeId !== null || this.track !== null; }

  private getTrack(edgeId: string, reversed: boolean): Track | null {
    const key = `${edgeId}:${reversed ? 1 : 0}`;
    let t = this.tracks.get(key);
    if (!t) {
      const e = this.env.navigation.edges.find((x) => x.id === edgeId);
      if (!e) return null;
      t = buildTrack(this.env.navigation, e, reversed, this.env.width, this.env.height) ?? undefined;
      if (t) this.tracks.set(key, t);
    }
    return t ?? null;
  }

  private profile() { return { abilities: this.config.abilities, edgeWeights: this.config.behavior.edgeWeights }; }
  private pxSpeed() { return this.config.speed * this.env.height; }

  // --- commands ------------------------------------------------------------------------------

  /** Manual mode: walk to a node following existing links only. */
  goTo(target: string): GoToResult {
    const nav = this.env.navigation;
    if (!nav.nodes.some((n) => n.id === target)) return { ok: false, reason: 'no-node' };
    const prof = this.profile();
    const { width: W, height: H } = this.env;

    if (!this.track) {
      if (!this.nodeId) return { ok: false, reason: 'unreachable' };
      const r = findRoute(nav, this.nodeId, target, W, H, prof);
      if (!r) return { ok: false, reason: 'unreachable' };
      this.route = r.steps; this.destination = target; this.pause = 0;
      return { ok: true };
    }

    // mid-edge: either finish the current edge, or turn back if the edge allows it
    const tr = this.track;
    const edge = nav.edges.find((e) => e.id === tr.edgeId)!;
    const fwd = findRoute(nav, tr.to, target, W, H, prof);
    const canBack = canTraverse(edge, tr.to, prof.abilities).ok;
    const back = canBack ? findRoute(nav, tr.from, target, W, H, prof) : null;
    const costFwd = fwd ? (tr.length - this.s) / tr.speedMul + fwd.cost : Infinity;
    const costBack = back ? this.s / tr.speedMul + back.cost : Infinity;
    if (!fwd && !back) return { ok: false, reason: 'unreachable' };
    if (costBack < costFwd) { this.flip(); this.route = back!.steps; }
    else this.route = fwd!.steps;
    this.destination = target; this.pause = 0; this.moving = true;
    return { ok: true };
  }

  /** Stops moving right where the character is (it may stand in the middle of a path). */
  halt() { this.route = []; this.destination = null; this.moving = false; this.pause = 0; if (this.track) this.speedPx = 0; this.state = 'IDLE'; }

  private flip() {
    if (!this.track) return;
    this.track = reverseTrack(this.track);
    this.s = this.track.length - this.s;
  }

  // --- simulation step -----------------------------------------------------------------------

  step(dt: number) {
    this.time += dt;
    const b = this.config.behavior;
    if (this.pause > 0) {
      this.pause -= dt; this.speedPx = 0; this.state = 'IDLE';
      if (this.pause > 0) return;
      dt = -this.pause; this.pause = 0;
      if (dt <= 0) return;
    }

    // autonomous: when idle at a node with nothing to do, pick a destination
    if (b.mode === 'autonomous' && !this.track && this.route.length === 0 && this.nodeId) this.pickDestination();

    // resume a halted mid-edge character in autonomous mode
    if (b.mode === 'autonomous' && this.track && !this.moving && this.route.length === 0) this.moving = true;

    // start next route step from a node
    if (!this.track && this.route.length && this.nodeId) this.beginStep();

    if (!this.track || !this.moving) { this.speedPx = 0; this.state = 'IDLE'; return; }

    // direction-change decisions (autonomous only)
    if (b.mode === 'autonomous') {
      this.decisionTimer += dt;
      if (this.decisionTimer >= Math.max(0.2, b.decisionInterval)) {
        this.decisionTimer = 0;
        if (this.rng() < b.turnProbability) this.turnBack();
      }
    }

    let budget = this.pxSpeed() * (this.track?.speedMul ?? 1) * dt; // px to travel this step
    while (budget > 1e-9 && this.track && this.moving) {
      const tr = this.track;
      const left = tr.length - this.s;
      const mul = tr.speedMul;
      if (budget < left) { this.s += budget; budget = 0; }
      else {
        this.s = tr.length; budget -= left;
        this.arrive(tr);
        if (this.pause > 0 || !this.moving) break;
        if (this.track) budget *= (this.track.speedMul / mul); // convert leftover to the next edge's speed
      }
    }
    this.syncPose();
  }

  private beginStep() {
    const step = this.route.shift()!;
    const t = this.getTrack(step.edgeId, step.reversed);
    if (!t) { this.route = []; return; }
    this.track = t; this.s = 0; this.moving = true; this.lastNodeId = this.nodeId; this.nodeId = null;
  }

  private arrive(tr: Track) {
    this.track = null; this.nodeId = tr.to; this.lastNodeId = tr.from; this.s = 0;
    const node = this.env.navigation.nodes.find((n) => n.id === tr.to)!;
    this.pos = { x: node.x, y: node.y };
    const b = this.config.behavior;
    if (this.route.length) {
      this.beginStep();
      if (b.mode === 'autonomous' && this.rng() < b.stopProbability) this.pause = this.randPause();
    } else {
      this.destination = null; this.moving = false;
      if (b.mode === 'autonomous') this.pause = this.randPause();
    }
    this.state = 'IDLE'; this.speedPx = 0;
  }

  private randPause() { const b = this.config.behavior; const lo = Math.min(b.pauseMin, b.pauseMax), hi = Math.max(b.pauseMin, b.pauseMax); return lo + this.rng() * (hi - lo); }

  /** Reverse direction on the current edge (if allowed) and forget the old plan. */
  private turnBack() {
    if (!this.track) return;
    const edge = this.env.navigation.edges.find((e) => e.id === this.track!.edgeId)!;
    if (!canTraverse(edge, this.track.to, this.config.abilities).ok) return;
    this.flip(); this.route = []; this.destination = null;
  }

  private pickDestination() {
    const nav = this.env.navigation, from = this.nodeId!;
    const prof = this.profile();
    const cands = [...reachableNodes(nav, from, prof.abilities, prof.edgeWeights, true)].filter((id) => id !== from);
    if (!cands.length) { this.pause = this.randPause(); return; }
    // weight candidates by how attractive the route is (mean edge preference)
    const scored: { id: string; w: number; steps: RouteStep[] }[] = [];
    for (const id of cands) {
      const r = findRoute(nav, from, id, this.env.width, this.env.height, prof, true);
      if (!r || !r.steps.length) continue;
      const ws = r.steps.map((s) => prof.edgeWeights[nav.edges.find((e) => e.id === s.edgeId)!.type] ?? 1);
      scored.push({ id, w: ws.reduce((a, c) => a + c, 0) / ws.length, steps: r.steps });
    }
    const total = scored.reduce((a, c) => a + c.w, 0);
    if (!scored.length || total <= 0) { this.pause = this.randPause(); return; }
    let pick = this.rng() * total;
    const chosen = scored.find((c) => (pick -= c.w) <= 0) ?? scored[scored.length - 1];
    this.route = chosen.steps; this.destination = chosen.id;
  }

  private syncPose() {
    if (this.track) {
      const p = pointAt(this.track, this.s);
      this.pos = { x: p.x / this.env.width, y: p.y / this.env.height };
      if (Math.abs(p.dx) > 1e-6 && this.track.type !== 'climb') this.facing = p.dx >= 0 ? 1 : -1;
      this.state = this.track.type === 'climb' ? 'CLIMB' : 'WALK';
      this.speedPx = this.pxSpeed() * this.track.speedMul;
    }
  }

  snapshot(): AgentSnapshot {
    const nav = this.env.navigation;
    const nodeIds = [this.track?.to ?? this.nodeId, ...this.route.map((r) => r.to)].filter(Boolean) as string[];
    return {
      x: this.pos.x, y: this.pos.y, facing: this.facing, state: this.state,
      nodeId: this.nodeId, lastNodeId: this.lastNodeId, edgeId: this.track?.edgeId ?? null,
      edgeType: this.track?.type ?? null, speedPx: this.moving && this.track ? this.speedPx : 0,
      destinationId: this.destination, routeNodeIds: this.track ? nodeIds : nodeIds.slice(1),
      routeEdgeIds: [...(this.track ? [this.track.edgeId] : []), ...this.route.map((r) => r.edgeId)],
      waiting: Math.max(0, this.pause), time: this.time,
    };
  }
}
