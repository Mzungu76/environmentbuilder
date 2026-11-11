import type { Character, Environment } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import type { CharacterRenderItem, SceneView, ViewPointerEvent } from '@/engine/rendering/SceneView';
import type { SceneController } from '@/engine/editor/SceneController';
import { spriteFor } from '@/engine/characters/sprites';
import { PuppetPlayer } from '@/engine/puppet/player';
import { DollPlayer } from '@/engine/doll/player';
import { flipsWithFacing } from '@/engine/puppet/runtime';
import { Agent, type AgentSnapshot } from './Agent';
import { exitNodeIds, resolveExit } from '@/engine/interaction/objects';
import { availableInteractions, createRuntimeState, performInteraction, resetRuntimeState, type Available, type GameEvent, type RuntimeState } from '@/engine/interaction/system';
import { emitHostEvent } from '@/lib/integration/hostBridge';

export type PlayStatus = 'stopped' | 'playing' | 'paused';

export interface PlaytestView {
  status: PlayStatus;
  activeId: string | null;
  message: { text: string; kind: 'info' | 'error'; at: number } | null;
  snapshots: Record<string, AgentSnapshot>;
  inventory: Record<string, number>;
  events: GameEvent[];
  /** Manual interactions the active character can run where it stands. */
  available: { objectId: string; interactionId: string; label: string; objectName: string }[];
  version: number;
}

const FIXED_DT = 1 / 60;

export interface PlaytestOptions {
  /** A character coming from another environment through an exit. */
  carried?: Character;
  /** Node (in this environment) where the carried character appears. */
  entryNodeId?: string;
  message?: string;
  autoplay?: boolean;
  /** Called when a character reaches an exit linked to an entrance of another (or the same) environment. */
  /** Runtime state (inventory, collected objects) shared across environments during one playtest. */
  runtime?: RuntimeState;
  onTransition?: (t: { targetEnvId: string; entryNodeId: string; character: Character; text: string }) => void;
}

/**
 * Simulation Engine host. Runs the agents on a FIXED time step (deterministic regardless of frame rate),
 * pushes poses to the renderer and publishes a throttled view for the UI.
 * The environment is snapshotted at start: playtest never mutates the document.
 */
export class PlaytestController {
  private env: Environment;
  private agents = new Map<string, Agent>();
  private status: PlayStatus = 'stopped';
  private activeId: string | null = null;
  private message: PlaytestView['message'] = null;
  private acc = 0;
  private lastPublish = 0;
  private listeners = new Set<() => void>();
  private viewState: PlaytestView;
  private hoverId: string | null = null;
  private pan: { x: number; y: number } | null = null;

  private lastSeq = new Map<string, number>();
  private players = new Map<string, PuppetPlayer>();
  private dollPlayers = new Map<string, DollPlayer>();
  private lastRender = performance.now();
  readonly runtime: RuntimeState;

  constructor(private store: EditorStore, private view: SceneView, private editor: SceneController, private opts: PlaytestOptions = {}) {
    this.env = store.env;
    this.runtime = opts.runtime ?? createRuntimeState();
    this.rebuild();
    if (opts.message) this.message = { text: opts.message, kind: 'info', at: Date.now() };
    if (opts.autoplay && this.agents.size) this.status = 'playing';
    this.viewState = this.compute();
    view.onPointer = (e) => this.onPointer(e);
    view.onTick = (dt) => this.tick(dt);
    view.panMode = false;
    view.setCursor('default');
    this.pushRender();
  }

  // --- external-store API for React ---------------------------------------------------------
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getView = () => this.viewState;
  private publish(force = true) {
    const now = performance.now();
    if (!force && now - this.lastPublish < 100) return;
    this.lastPublish = now;
    this.viewState = this.compute();
    this.listeners.forEach((l) => l());
  }
  private compute(): PlaytestView {
    const snapshots: Record<string, AgentSnapshot> = {};
    for (const [id, a] of this.agents) snapshots[id] = a.snapshot();
    const act = this.active, sn = act?.snapshot();
    const available = act && sn?.nodeId && !sn.acting ? availableInteractions(this.env, sn.nodeId, act.config.abilities, this.runtime, 'manual').map((a) => ({ objectId: a.object.id, interactionId: a.interaction.id, label: a.interaction.label, objectName: a.object.name })) : [];
    return { status: this.status, activeId: this.activeId, message: this.message, snapshots, inventory: { ...this.runtime.inventory }, events: this.runtime.events.slice(-12), available, version: (this.viewState?.version ?? 0) + 1 };
  }

  dispose() {
    this.view.onTick = () => {};
    this.view.setCharacters([]);
    this.view.setHiddenObjects(new Set());
    this.editor.markers = null;
    this.editor.attach();
    this.editor.refresh();
    this.listeners.clear();
  }

  // --- setup -----------------------------------------------------------------------------------
  private rebuild() {
    this.env = this.store.env;
    this.agents.clear();
    const blocked = exitNodeIds(this.env);
    const chars = this.env.characters.filter((c) => c.id !== this.opts.carried?.id);
    if (this.opts.carried && this.env.navigation.nodes.some((n) => n.id === this.opts.entryNodeId)) chars.push({ ...this.opts.carried, startNodeId: this.opts.entryNodeId ?? null });
    for (const c of chars) {
      if (!this.env.navigation.nodes.length) break;
      const a = new Agent(this.env, c); a.blocked = blocked; this.agents.set(c.id, a);
    }
    this.lastSeq.clear();
    if (!this.activeId || !this.agents.has(this.activeId)) this.activeId = this.agents.keys().next().value ?? null;
  }

  get characterCount() { return this.agents.size; }
  /** Characters taking part in this playtest (including a visitor from another environment). */
  listCharacters(): Character[] { return [...this.agents.values()].map((a) => a.config); }
  isVisitor(id: string) { return !this.store.env.characters.some((c) => c.id === id); }

  setMode(id: string, mode: 'manual' | 'autonomous') {
    const a = this.agents.get(id);
    if (!a) return;
    if (this.isVisitor(id)) a.config = { ...a.config, behavior: { ...a.config.behavior, mode } };
    else this.store.commitEnv((e) => ({ ...e, characters: e.characters.map((x) => (x.id === id ? { ...x, behavior: { ...x.behavior, mode } } : x)) }));
    if (id === this.activeId) { a.halt(); this.updateMarkers(); this.publish(); }
  }
  get active(): Agent | null { return this.activeId ? this.agents.get(this.activeId) ?? null : null; }

  setActive(id: string) { if (this.agents.has(id)) { this.activeId = id; this.updateMarkers(); this.publish(); } }

  // --- controls ----------------------------------------------------------------------------------
  play() { if (!this.agents.size) return; this.status = 'playing'; this.publish(); }
  pause() { if (this.status === 'playing') { this.status = 'paused'; this.publish(); } }
  togglePlay() { this.status === 'playing' ? this.pause() : this.play(); }
  /** Stop: halts the simulation and returns everybody to their start node. */
  stop() { this.status = 'stopped'; resetRuntimeState(this.runtime); this.resetAgents(); this.say('Simulazione fermata.', 'info'); }
  /** Reset: back to the initial state (and seed) keeping the current play/pause status. */
  reset() { resetRuntimeState(this.runtime); this.resetAgents(); this.say('Simulazione riportata allo stato iniziale.', 'info'); }
  private resetAgents() {
    this.rebuild(); this.acc = 0;
    for (const a of this.agents.values()) a.reset();
    this.view.setHiddenObjects(this.runtime.collected);
    this.updateMarkers(); this.pushRender(); this.publish();
  }

  /** Manual movement command (also used by the destination list on touch devices). */
  goTo(nodeId: string) {
    const a = this.active;
    if (!a) return;
    const r = a.goTo(nodeId);
    const name = this.env.navigation.nodes.find((n) => n.id === nodeId)?.name ?? nodeId;
    if (r.ok) { this.say(`Destinazione: ${name}`, 'info'); if (this.status !== 'playing') this.status = 'playing'; }
    else this.say(`“${name}” non è raggiungibile seguendo i collegamenti consentiti.`, 'error');
    this.updateMarkers(); this.publish();
  }
  haltActive() { this.active?.halt(); this.updateMarkers(); this.publish(); }

  private say(text: string, kind: 'info' | 'error') { this.message = { text, kind, at: Date.now() }; this.publish(); }

  // --- loop ---------------------------------------------------------------------------------------
  private tick(dt: number) {
    // live config: panel edits apply immediately
    for (const c of this.store.env.characters) { const a = this.agents.get(c.id); if (a) a.config = c; }
    if (this.status === 'playing') this.checkExits();
    if (this.status === 'playing') {
      this.acc += dt;
      while (this.acc >= FIXED_DT) { for (const a of this.agents.values()) a.step(FIXED_DT); this.acc -= FIXED_DT; }
      this.updateMarkers();
      this.publish(false);
    }
    this.pushRender();
  }

  /** A character that ENDS a route on an exit node leaves for the linked entrance. */
  private checkExits() {
    for (const [id, a] of this.agents) {
      if (a.arrivalSeq === (this.lastSeq.get(id) ?? 0)) continue;
      this.lastSeq.set(id, a.arrivalSeq);
      const node = a.snapshot().nodeId;
      if (!a.arrivalFinal || !node) continue;
      const r = resolveExit(this.store.project, this.env, node);
      if (!r || !this.opts.onTransition) { this.onArrival(a, node); continue; }
      this.emit({ t: a.snapshot().time, type: 'transition', character: a.config.name, environment: this.env.name, node, message: `verso ${r.targetEnv.name}` });
      this.status = 'paused';
      this.opts.onTransition({ targetEnvId: r.targetEnv.id, entryNodeId: r.entranceNodeId, character: a.config, text: `${a.config.name} è passato da “${this.env.name}” a “${r.targetEnv.name}”.` });
      return;
    }
  }

  private emit(e: GameEvent) { this.runtime.events.push(e); if (this.runtime.events.length > 200) this.runtime.events.shift(); emitHostEvent(e); }

  /** A route ended on a node: report it and run the 'on-arrival' interactions available there. */
  private onArrival(a: Agent, node: string) {
    this.emit({ t: a.snapshot().time, type: 'arrival', character: a.config.name, environment: this.env.name, node });
    for (const av of availableInteractions(this.env, node, a.config.abilities, this.runtime, 'on-arrival')) this.run(a, av);
  }

  private run(a: Agent, av: Available) {
    const out = performInteraction(this.env, av, a.config, this.runtime, a.snapshot().time);
    a.queueAction(out.state, out.seconds);
    emitHostEvent(out.event);
    this.say(out.message, 'info');
    this.view.setHiddenObjects(this.runtime.collected);
  }

  /** Manual interaction (button in the panel): the active character must stand on the object's node. */
  interact(objectId: string, interactionId: string) {
    const a = this.active, node = a?.snapshot().nodeId;
    if (!a || !node) return;
    const av = availableInteractions(this.env, node, a.config.abilities, this.runtime, 'manual').find((x) => x.object.id === objectId && x.interaction.id === interactionId);
    if (!av) return;
    this.run(a, av);
    if (this.status !== 'playing') this.status = 'playing';
    this.publish();
  }

  private puppetFor(c: Character, s: AgentSnapshot, dt: number): CharacterRenderItem['puppet'] {
    const puppet = c.puppetId ? this.store.project.puppets.find((p) => p.id === c.puppetId) : undefined;
    if (!puppet) return null;
    let pl = this.players.get(c.id); if (!pl) { pl = new PuppetPlayer(); this.players.set(c.id, pl); }
    const figurePx = Math.max(1, c.height * this.env.height);
    const hint = s.edgeId ? this.env.navigation.edges.find((e) => e.id === s.edgeId)?.props.view : undefined;
    const f = pl.frame(puppet, s.state, dt, s.speedPx / figurePx, hint);
    const assetId = f?.view.cutoutAssetId;
    if (!f || !assetId || !f.view.mesh) return null;
    return { assetId, positions: f.positions, uvs: f.view.mesh.uvs, indices: f.view.mesh.indices, pivot: f.view.pivot, figureHeight: f.view.figureHeight, flip: flipsWithFacing(f.view) && s.facing < 0, viewKey: `${puppet.id}:${f.viewId}:${assetId}`,
      over: f.over?.view.cutoutAssetId && f.over.view.mesh ? { assetId: f.over.view.cutoutAssetId, positions: f.over.positions, uvs: f.over.view.mesh.uvs, indices: f.over.view.mesh.indices, pivot: f.over.view.pivot, figureHeight: f.over.view.figureHeight, alpha: f.over.alpha, viewKey: `${puppet.id}:${f.over.view.id}:${f.over.view.cutoutAssetId}` } : undefined };
  }

  private dollFor(c: Character, s: AgentSnapshot, dt: number): CharacterRenderItem['doll'] {
    if (c.puppetId && this.store.project.puppets.some((p) => p.id === c.puppetId)) return null;
    const doll = c.dollId ? this.store.project.dolls.find((d) => d.id === c.dollId) : undefined;
    if (!doll) return null;
    let pl = this.dollPlayers.get(c.id); if (!pl) { pl = new DollPlayer(); this.dollPlayers.set(c.id, pl); }
    const figurePx = Math.max(1, c.height * this.env.height);
    return { shapes: pl.frame(doll, s.state, dt, s.speedPx / figurePx), outline: doll.colors.outline, outlineWidth: doll.style.outline * 1000, flip: s.facing < 0 };
  }

  private pushRender() {
    const now = performance.now(), dt = this.status === 'playing' ? Math.min(0.1, (now - this.lastRender) / 1000) : 0;
    this.lastRender = now;
    const items: CharacterRenderItem[] = [];
    for (const [id, a] of this.agents) {
      const c = a.config, s = a.snapshot();
      items.push({ id, x: s.x, y: s.y, width: c.width, height: c.height, color: c.color, facing: s.facing, state: s.state, shadow: c.shadow, selected: false, lift: s.lift, sprite: spriteFor(c, s.state), stateTime: s.stateTime, liveClock: false, puppet: this.puppetFor(c, s, dt), doll: this.dollFor(c, s, dt) });
    }
    this.view.setCharacters(items);
  }

  private updateMarkers() {
    const a = this.active;
    const manual = a?.config.behavior.mode === 'manual';
    const s = a?.snapshot();
    this.editor.markers = {
      nodeIds: manual ? this.env.navigation.nodes.map((n) => n.id) : [],
      hoverId: manual ? this.hoverId : null, targetId: s?.destinationId ?? null, routeEdgeIds: s?.routeEdgeIds ?? [],
    };
    this.editor.refresh();
  }

  // --- pointer: pick a destination node (manual) / pan the camera -----------------------------------
  private nodeAt(pos: { x: number; y: number }, tolPx: number): string | null {
    let best: string | null = null, bd = tolPx * this.view.pxPerScreenPx;
    for (const n of this.env.navigation.nodes) {
      const d = Math.hypot((n.x - pos.x) * this.env.width, (n.y - pos.y) * this.env.height);
      if (d <= bd) { bd = d; best = n.id; }
    }
    return best;
  }

  private onPointer(e: ViewPointerEvent) {
    const manual = this.active?.config.behavior.mode === 'manual';
    const tol = e.pointerType === 'mouse' ? 16 : 30;
    if (e.type === 'move') {
      if (this.pan) { this.view.panBy(e.screen.x - this.pan.x, e.screen.y - this.pan.y); this.pan = { x: e.screen.x, y: e.screen.y }; return; }
      const h = manual ? this.nodeAt(e.pos, tol) : null;
      if (h !== this.hoverId) { this.hoverId = h; this.updateMarkers(); }
      this.view.setCursor(h ? 'pointer' : 'default');
    } else if (e.type === 'down' || e.type === 'dblclick') {
      const h = manual ? this.nodeAt(e.pos, tol) : null;
      if (h) this.goTo(h); else this.pan = { x: e.screen.x, y: e.screen.y };
    } else { this.pan = null; }
  }
}
