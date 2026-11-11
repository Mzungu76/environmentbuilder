import type { Vec2 } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import type { SceneView, ViewPointerEvent } from '@/engine/rendering/SceneView';
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

  constructor(private store: EditorStore, private view: SceneView) {
    view.onPointer = (e) => this.handle(e);
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
    this.view.setModel({
      graph: env.navigation, selection: s.selection, preview: s.preview,
      pendingFrom: this.pendingFrom, cursor: this.cursor, hoverNodeId: this.hover,
    });
  }

  cancelPending() { this.pendingFrom = null; this.refresh(); }

  deleteSelection() {
    const sel = this.store.getState().selection;
    if (!sel) return;
    this.store.commitEnv((env) => ({
      ...env, navigation: sel.kind === 'node' ? removeNode(env.navigation, sel.id) : removeEdge(env.navigation, sel.id),
    }));
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

  private handle(e: ViewPointerEvent) {
    const env = this.store.env;
    if (!env.width || !env.height) return; // nothing imported yet
    const tool = this.store.getState().tool;
    if (this.store.getState().preview) return;

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
