import type { Vec2 } from '@/types';
import type { CharacterRenderItem, PlaytestMarkers } from '@/engine/rendering/SceneView';
import { createCharacter } from '@/engine/characters/factory';
import { spriteFor } from '@/engine/characters/sprites';
import { PuppetPlayer } from '@/engine/puppet/player';
import { DollPlayer } from '@/engine/doll/player';
import type { EditorStore } from '@/lib/store/editorStore';
import type { SceneView, ViewPointerEvent } from '@/engine/rendering/SceneView';
import { cleanObjectLinks } from '@/engine/interaction/objects';
import { addEdge, addNode, createEdge, createNode, findEdgeBetween, moveNode, removeEdge, removeNode, updateEdge } from './graph';
import { clamp01, defaultBezier } from './geometry';
import { hitTest, type Hit } from './hit';

type Drag =
  | { kind: 'node'; id: string; moved: boolean; startPos: Vec2 }
  | { kind: 'handle'; edgeId: string; which: 1 | 2; moved: boolean }
  | null;

/**
 * Navigation Editor: translates pointer events + the active tool into graph commands.
 * It talks to the document only through the EditorStore and to the renderer only through SceneView.
 */
export class NavigationEditor {
  private pendingFrom: string | null = null;
  private cursor: Vec2 | null = null;
  private hover: string | null = null;
  private drag: Drag = null;
  private lastTool = '';
  private unsub: () => void;
  private players = new Map<string, PuppetPlayer>();
  private dollPlayers = new Map<string, DollPlayer>();

  /** Set by the playtest controller (destination markers); null in the editor. */
  markers: PlaytestMarkers | null = null;

  constructor(private store: EditorStore, private view: SceneView) {
    this.unsub = store.subscribe(() => this.refresh());
    this.refresh();
  }

  dispose() { this.unsub(); }

  /** Pushes the current document + local interaction state to the renderer. */
  refresh() {
    const s = this.store.getState();
    if (s.tool !== this.lastTool) {
      this.lastTool = s.tool; this.pendingFrom = null; this.drag = null;
      this.view.panMode = s.tool === 'pan';
      this.view.setCursor(s.tool === 'pan' ? 'grab' : s.tool === 'select' ? 'default' : 'crosshair');
    }
    const env = this.store.env;
    const play = s.mode === 'playtest';
    this.view.setModel({
      graph: env.navigation, selection: s.selection?.kind === 'node' || s.selection?.kind === 'edge' ? { kind: s.selection.kind, id: s.selection.id } : null,
      preview: play ? !s.showPaths : s.preview,
      pendingFrom: play ? null : this.pendingFrom, cursor: this.cursor, hoverNodeId: play ? null : this.hover,
      markers: play ? this.markers : null,
      objects: env.objects, selectedObjectId: s.selection?.kind === 'object' ? s.selection.id : null,
    });
    if (!play) {
      // editor mode: characters stand on their start node
      const items: CharacterRenderItem[] = [];
      for (const c of env.characters) {
        const n = env.navigation.nodes.find((x) => x.id === c.startNodeId);
        if (!n) continue;
        items.push({ id: c.id, x: n.x, y: n.y, width: c.width, height: c.height, color: c.color, facing: 1, state: 'IDLE', shadow: c.shadow, selected: s.selection?.kind === 'character' && s.selection.id === c.id, lift: 0, sprite: spriteFor(c, 'IDLE'), stateTime: 0, liveClock: true, puppet: this.puppetDraw(c), doll: this.dollDraw(c), look: c.look });
      }
      this.view.setCharacters(items);
    }
  }

  /** Static idle pose of a rigged character (editor mode). */
  private puppetDraw(c: { id: string; puppetId?: string | null }): CharacterRenderItem['puppet'] {
    const puppet = c.puppetId ? this.store.project.puppets.find((p) => p.id === c.puppetId) : undefined;
    if (!puppet) return null;
    let pl = this.players.get(c.id); if (!pl) { pl = new PuppetPlayer(); this.players.set(c.id, pl); }
    const f = pl.frame(puppet, 'IDLE', 0, 0);
    const assetId = f?.view.cutoutAssetId;
    if (!f || !assetId || !f.view.mesh) return null;
    return { assetId, positions: f.positions, uvs: f.view.mesh.uvs, indices: f.view.mesh.indices, pivot: f.view.pivot, figureHeight: f.view.figureHeight, flip: false, viewKey: `${puppet.id}:${f.viewId}:${assetId}` };
  }

  /** Static idle pose of a procedural "omino" (editor mode; used when the character has no puppet). */
  private dollDraw(c: { id: string; puppetId?: string | null; dollId?: string | null }): CharacterRenderItem['doll'] {
    if (c.puppetId && this.store.project.puppets.some((p) => p.id === c.puppetId)) return null;
    const doll = c.dollId ? this.store.project.dolls.find((d) => d.id === c.dollId) : undefined;
    if (!doll) return null;
    let pl = this.dollPlayers.get(c.id); if (!pl) { pl = new DollPlayer(); this.dollPlayers.set(c.id, pl); }
    return { shapes: pl.frame(doll, 'IDLE', 0, 0), outline: doll.colors.outline, outlineWidth: doll.style.outline * 1000, flip: false };
  }

  cancelPending() { this.pendingFrom = null; this.refresh(); }

  deleteSelection() {
    const sel = this.store.getState().selection;
    if (!sel || sel.kind === 'object') return;
    this.store.commitEnv((env) => {
      if (sel.kind === 'character') return { ...env, characters: env.characters.filter((c) => c.id !== sel.id) };
      if (sel.kind === 'object') return env;
      const navigation = sel.kind === 'node' ? removeNode(env.navigation, sel.id) : removeEdge(env.navigation, sel.id);
      // characters starting on a deleted node lose their start (never dangle)
      const ids = new Set(navigation.nodes.map((n) => n.id));
      return cleanObjectLinks({ ...env, navigation, characters: env.characters.map((c) => (c.startNodeId && !ids.has(c.startNodeId) ? { ...c, startNodeId: null } : c)) });
    });
    this.store.setSelection(null);
    this.pendingFrom = null;
    this.refresh();
  }

  toggleCurve(edgeId: string) {
    const env = this.store.env;
    const e = env.navigation.edges.find((x) => x.id === edgeId);
    const a = env.navigation.nodes.find((n) => n.id === e?.from), b = env.navigation.nodes.find((n) => n.id === e?.to);
    if (!e || !a || !b) return;
    this.store.commitEnv((en) => ({
      ...en, navigation: updateEdge(en.navigation, edgeId, { geometry: e.geometry.kind === 'line' ? defaultBezier(a, b) : { kind: 'line' } }),
    }));
  }

  // ------------------------------------------------------------------------------------------
  private hit(pos: Vec2, pointerType: string): Hit {
    const env = this.store.env;
    const sel = this.store.getState().selection;
    return hitTest(pos, {
      graph: env.navigation, envW: env.width, envH: env.height, pxPerScreenPx: this.view.pxPerScreenPx,
      selectedEdgeId: sel?.kind === 'edge' ? sel.id : null, tolerance: pointerType === 'mouse' ? 10 : 22,
    });
  }

  private inside(p: Vec2) { return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1; }

  handle(e: ViewPointerEvent) {
    const env = this.store.env;
    if (!env.width || !env.height) return; // nothing imported yet
    const tool = this.store.getState().tool;
    if (this.store.getState().preview || this.store.getState().mode === 'playtest') return;

    if (e.type === 'cancel') { this.drag = null; this.refresh(); return; }

    if (e.type === 'move') {
      this.cursor = e.pos;
      if (this.drag) { this.updateDrag(e.pos); return; }
      const h = this.hit(e.pos, e.pointerType);
      const hov = h?.kind === 'node' ? h.id : null;
      if (hov !== this.hover || this.pendingFrom) { this.hover = hov; this.refresh(); }
      if (tool === 'select') this.view.setCursor(h ? (h.kind === 'edge' ? 'pointer' : 'move') : 'default');
      return;
    }

    if (e.type === 'up') {
      if (this.drag) { this.drag = null; this.refresh(); }
      return;
    }

    if (e.type === 'dblclick') {
      const h = this.hit(e.pos, e.pointerType);
      if (tool === 'path') { this.pendingFrom = null; this.refresh(); return; }
      if (h?.kind === 'edge') { this.toggleCurve(h.id); this.store.setSelection({ kind: 'edge', id: h.id }); }
      return;
    }

    // --- pointer down ---
    if (e.button !== 0) return;
    const h = this.hit(e.pos, e.pointerType);
    this.cursor = e.pos;

    if (h?.kind === 'handle') { this.drag = { kind: 'handle', edgeId: h.edgeId, which: h.which, moved: false }; return; }

    switch (tool) {
      case 'select':
        if (h?.kind === 'node') { this.store.setSelection({ kind: 'node', id: h.id }); this.drag = { kind: 'node', id: h.id, moved: false, startPos: e.pos }; }
        else if (h?.kind === 'edge') this.store.setSelection({ kind: 'edge', id: h.id });
        else this.store.setSelection(null);
        break;

      case 'node':
        if (h?.kind === 'node') { this.store.setSelection({ kind: 'node', id: h.id }); this.drag = { kind: 'node', id: h.id, moved: false, startPos: e.pos }; }
        else if (this.inside(e.pos)) {
          const node = createNode(e.pos.x, e.pos.y, 'waypoint', env.navigation);
          this.store.commitEnv((en) => ({ ...en, navigation: addNode(en.navigation, node) }));
          this.store.setSelection({ kind: 'node', id: node.id });
        }
        break;

      case 'character': {
        const target = h?.kind === 'node' ? h.id : this.nearestNode(e.pos, 48 * this.view.pxPerScreenPx);
        if (target) this.placeCharacter(target);
        break;
      }

      case 'connect':
        if (h?.kind === 'node') {
          if (!this.pendingFrom) { this.pendingFrom = h.id; this.store.setSelection({ kind: 'node', id: h.id }); }
          else if (this.pendingFrom !== h.id) { this.link(this.pendingFrom, h.id); this.pendingFrom = null; }
        } else this.pendingFrom = null;
        break;

      case 'path':
        if (h?.kind === 'node') {
          if (this.pendingFrom && this.pendingFrom !== h.id) this.link(this.pendingFrom, h.id);
          this.pendingFrom = h.id; this.store.setSelection({ kind: 'node', id: h.id });
        } else if (this.inside(e.pos)) {
          const node = createNode(clamp01(e.pos.x), clamp01(e.pos.y), 'waypoint', env.navigation);
          const from = this.pendingFrom;
          this.store.commitEnv((en) => {
            let nav = addNode(en.navigation, node);
            if (from) nav = addEdge(nav, createEdge(from, node.id));
            return { ...en, navigation: nav };
          });
          this.pendingFrom = node.id;
          this.store.setSelection({ kind: 'node', id: node.id });
        }
        break;
    }
    this.refresh();
  }

  private nearestNode(p: Vec2, maxPx: number): string | null {
    const env = this.store.env;
    let best: string | null = null, bd = maxPx;
    for (const n of env.navigation.nodes) {
      const d = Math.hypot((n.x - p.x) * env.width, (n.y - p.y) * env.height);
      if (d <= bd) { bd = d; best = n.id; }
    }
    return best;
  }

  /** Places the selected character (or a new one) on a node. */
  private placeCharacter(nodeId: string) {
    const sel = this.store.getState().selection;
    const env = this.store.env;
    const existing = sel?.kind === 'character' ? env.characters.find((c) => c.id === sel.id) : undefined;
    if (existing) {
      this.store.commitEnv((en) => ({ ...en, characters: en.characters.map((c) => (c.id === existing.id ? { ...c, startNodeId: nodeId } : c)) }));
    } else {
      const c = createCharacter(env.characters.length, nodeId);
      this.store.commitEnv((en) => ({ ...en, characters: [...en.characters, c] }));
      this.store.setSelection({ kind: 'character', id: c.id });
    }
  }

  private link(a: string, b: string) {
    const nav = this.store.env.navigation;
    const existing = findEdgeBetween(nav, a, b);
    if (existing) { this.store.setSelection({ kind: 'edge', id: existing.id }); return; }
    const edge = createEdge(a, b);
    this.store.commitEnv((en) => ({ ...en, navigation: addEdge(en.navigation, edge) }));
    this.store.setSelection({ kind: 'edge', id: edge.id });
  }

  private updateDrag(pos: Vec2) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved) {
      if (d.kind === 'node') {
        const env = this.store.env;
        const dx = (pos.x - d.startPos.x) * env.width, dy = (pos.y - d.startPos.y) * env.height;
        if (Math.hypot(dx, dy) * this.view.getZoom() < 3) return; // click, not a drag
      }
      d.moved = true;
      this.store.checkpoint();
    }
    if (d.kind === 'node') {
      this.store.updateEnv((en) => ({ ...en, navigation: moveNode(en.navigation, d.id, pos.x, pos.y) }));
    } else {
      this.store.updateEnv((en) => ({
        ...en,
        navigation: updateEdge(en.navigation, d.edgeId, {
          geometry: (() => {
            const e = en.navigation.edges.find((x) => x.id === d.edgeId);
            if (!e || e.geometry.kind !== 'bezier') return { kind: 'line' } as const;
            const p = { x: clamp01(pos.x), y: clamp01(pos.y) };
            return d.which === 1 ? { ...e.geometry, c1: p } : { ...e.geometry, c2: p };
          })(),
        }),
      }));
    }
  }
}
