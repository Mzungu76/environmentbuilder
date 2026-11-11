import type { Character, Environment } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import type { CharacterRenderItem, SceneView, ViewPointerEvent } from '@/engine/rendering/SceneView';
import type { NavigationEditor } from '@/engine/navigation/NavigationEditor';
import { Agent, type AgentSnapshot } from './Agent';

export type PlayStatus = 'stopped' | 'playing' | 'paused';

export interface PlaytestView {
  status: PlayStatus;
  activeId: string | null;
  message: { text: string; kind: 'info' | 'error'; at: number } | null;
  snapshots: Record<string, AgentSnapshot>;
  version: number;
}

const FIXED_DT = 1 / 60;

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

  constructor(private store: EditorStore, private view: SceneView, private editor: NavigationEditor) {
    this.env = store.env;
    this.rebuild();
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
    return { status: this.status, activeId: this.activeId, message: this.message, snapshots, version: (this.viewState?.version ?? 0) + 1 };
  }

  dispose() {
    this.view.onTick = () => {};
    this.view.setCharacters([]);
    this.editor.markers = null;
    this.editor.attach();
    this.editor.refresh();
    this.listeners.clear();
  }

  // --- setup -----------------------------------------------------------------------------------
  private rebuild() {
    this.env = this.store.env;
    this.agents.clear();
    for (const c of this.env.characters) {
      if (!this.env.navigation.nodes.length) break;
      this.agents.set(c.id, new Agent(this.env, c));
    }
    if (!this.activeId || !this.agents.has(this.activeId)) this.activeId = this.agents.keys().next().value ?? null;
  }

  get characterCount() { return this.agents.size; }
  get active(): Agent | null { return this.activeId ? this.agents.get(this.activeId) ?? null : null; }

  setActive(id: string) { if (this.agents.has(id)) { this.activeId = id; this.updateMarkers(); this.publish(); } }

  // --- controls ----------------------------------------------------------------------------------
  play() { if (!this.agents.size) return; this.status = 'playing'; this.publish(); }
  pause() { if (this.status === 'playing') { this.status = 'paused'; this.publish(); } }
  togglePlay() { this.status === 'playing' ? this.pause() : this.play(); }
  /** Stop: halts the simulation and returns everybody to their start node. */
  stop() { this.status = 'stopped'; this.resetAgents(); this.say('Simulazione fermata.', 'info'); }
  /** Reset: back to the initial state (and seed) keeping the current play/pause status. */
  reset() { this.resetAgents(); this.say('Simulazione riportata allo stato iniziale.', 'info'); }
  private resetAgents() {
    this.rebuild(); this.acc = 0;
    for (const a of this.agents.values()) a.reset();
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
    if (this.status === 'playing') {
      this.acc += dt;
      while (this.acc >= FIXED_DT) { for (const a of this.agents.values()) a.step(FIXED_DT); this.acc -= FIXED_DT; }
      this.updateMarkers();
      this.publish(false);
    }
    this.pushRender();
  }

  private pushRender() {
    const items: CharacterRenderItem[] = [];
    for (const [id, a] of this.agents) {
      const c = a.config, s = a.snapshot();
      items.push({ id, x: s.x, y: s.y, width: c.width, height: c.height, color: c.color, facing: s.facing, state: s.state, shadow: c.shadow, selected: false });
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
