import type { Graphics } from 'pixi.js';
import type { EditorStore } from '@/lib/store/editorStore';
import type { SceneView, ViewPointerEvent } from '@/engine/rendering/SceneView';
import type { OccluderShape, SearchZone, Vec2 } from '@/types';
import { uid } from '@/lib/ids';
import { MIN_POINTS, insertShapePoint, moveShapeHandle, nearestEdge, pointInPolygon, removeShapePoint, shapeHandles, shapePolygon, translateShape } from '@/engine/navigation/occluders';
import { newSearchZone, zonePolygon } from './zones';

type Drag = { kind: 'box'; a: Vec2; b: Vec2 } | { kind: 'handle'; index: number; start: OccluderShape } | { kind: 'body'; from: Vec2; start: OccluderShape };

const hex = (c: string) => parseInt(c.slice(1), 16);

/**
 * Editor of the search zones ("Zone di ricerca" tool). Draws zones as polygon / ellipse / rectangle and edits them (move, drag the points,
 * add or remove points). The zones are shown over the scene (faint outlines when another tool is active, never in playtest or in the
 * clean preview). Every finished gesture is ONE undo step.
 */
export class SearchZoneEditor {
  private drag: Drag | null = null;
  private draft: number[] = [];
  private hover: Vec2 | null = null;
  /** shape of the zone being dragged (live), null = the document's own */
  private preview: { id: string; shape: OccluderShape } | null = null;
  private unsub: () => void;

  constructor(private store: EditorStore, private view: SceneView) {
    this.unsub = store.subscribe(() => this.refresh());
    this.refresh();
  }

  dispose() { this.unsub(); this.view.setSearchGuides(null); }

  private active() { const s = this.store.getState(); return s.tool === 'search' && s.mode === 'editor' && !s.preview; }
  private st() { return this.store.getState().searchTool; }
  private zones(): SearchZone[] { return this.store.env.searchZones ?? []; }
  private shapeOf(z: SearchZone): OccluderShape { return this.preview && this.preview.id === z.id ? this.preview.shape : z.shape; }

  refresh() {
    const s = this.store.getState();
    if (!this.active() && (this.draft.length || this.drag || this.preview)) {
      this.draft = []; this.drag = null; this.preview = null; this.hover = null;
      if (this.st().drafting) { this.store.setSearchTool({ drafting: false }); return; }
    }
    if (s.mode !== 'editor' || s.preview || !this.zones().length && !this.active()) { this.view.setSearchGuides(null); return; }
    this.view.setSearchGuides((g, px, W, H) => this.draw(g, px, W, H));
  }
  private redraw() { this.view.setSearchGuides((g, px, W, H) => this.draw(g, px, W, H)); }

  private outline(g: Graphics, poly: number[], W: number, H: number, color: number, width: number, alpha: number, close = true) {
    if (poly.length < 4) return;
    g.moveTo(poly[0] * W, poly[1] * H);
    for (let i = 2; i < poly.length; i += 2) g.lineTo(poly[i] * W, poly[i + 1] * H);
    if (close) g.closePath();
    g.stroke({ width, color, alpha, join: 'round' });
  }

  private draw(g: Graphics, px: number, W: number, H: number) {
    const act = this.active(), st = this.st();
    for (const z of this.zones()) {
      const poly = shapePolygon(this.shapeOf(z)), sel = act && st.selectedId === z.id, col = hex(z.color);
      if (poly.length < 6) continue;
      if (act) { g.poly(poly.map((v, i) => (i % 2 ? v * H : v * W))).fill({ color: col, alpha: sel ? 0.4 : 0.22 }); }
      this.outline(g, poly, W, H, sel ? 0xffffff : col, (sel ? 2.4 : act ? 1.6 : 1.2) * px, act ? 1 : 0.55);
    }
    if (!act) return;
    const sel = this.zones().find((z) => z.id === st.selectedId);
    if (sel && st.tool === 'edit') {
      const sh = this.shapeOf(sel);
      if (sh.shape === 'polygon' || sh.shape === 'spline') this.outline(g, sh.pts, W, H, 0xfde047, 1 * px, 0.4);
      for (const h of shapeHandles(sh)) g.circle(h.x * W, h.y * H, 6 * px).fill({ color: 0xffffff }).stroke({ width: 1.5 * px, color: 0x111827 });
    }
    const d = this.drag;
    if (d?.kind === 'box') this.outline(g, shapePolygon({ shape: st.tool === 'ellipse' ? 'ellipse' : 'rect', pts: [d.a.x, d.a.y, d.b.x, d.b.y] }), W, H, 0xffffff, 2 * px, 1);
    if (this.draft.length >= 2 && st.tool === 'polygon') {
      const pts = this.hover ? [...this.draft, this.hover.x, this.hover.y] : this.draft;
      this.outline(g, pts, W, H, 0xffffff, 2 * px, 1, false);
      for (let i = 0; i < this.draft.length; i += 2) g.circle(this.draft[i] * W, this.draft[i + 1] * H, (i === 0 ? 7 : 5) * px).fill({ color: i === 0 ? 0xfde047 : 0xffffff }).stroke({ width: 1.5 * px, color: 0x111827 });
    }
  }

  // ---- commands used by the UI ------------------------------------------------------------------------------------------------

  private add(shape: OccluderShape) {
    const z = newSearchZone(this.zones(), uid('zone'), shape);
    this.store.commitEnv((e) => ({ ...e, searchZones: [...(e.searchZones ?? []), z] }));
    this.store.setSearchTool({ selectedId: z.id });
    this.refresh();
  }
  finishDraft() {
    const pts = this.draft; this.draft = []; this.hover = null; this.store.setSearchTool({ drafting: false });
    if (pts.length / 2 >= MIN_POINTS.polygon) this.add({ kind: 'shape', mode: 'add', shape: 'polygon', pts }); else this.refresh();
  }
  cancelDraft() { if (!this.draft.length) return; this.draft = []; this.hover = null; this.store.setSearchTool({ drafting: false }); this.refresh(); }
  cancelPending() { this.cancelDraft(); if (this.drag) { this.drag = null; this.preview = null; this.refresh(); } }
  /** Deletes the selected zone (Canc). Returns true when this tool handled the key. */
  deleteSelected(): boolean {
    const id = this.st().selectedId;
    if (!this.active() || !id || !this.zones().some((z) => z.id === id)) return false;
    this.store.setSearchTool({ selectedId: null });
    this.store.commitEnv((e) => ({ ...e, searchZones: (e.searchZones ?? []).filter((z) => z.id !== id) }));
    this.refresh();
    return true;
  }
  private replace(id: string, shape: OccluderShape) {
    this.preview = null;
    this.store.commitEnv((e) => ({ ...e, searchZones: (e.searchZones ?? []).map((z) => (z.id === id ? { ...z, shape } : z)) }));
    this.refresh();
  }

  // ---- pointer ---------------------------------------------------------------------------------------------------------------

  /** Returns true when the event belongs to this tool (so no other editor reacts to it). */
  handle(e: ViewPointerEvent): boolean {
    if (!this.active()) return false;
    const env = this.store.env; if (!env.width || !env.height) return true;
    const st = this.st();
    if (st.tool === 'polygon') this.polyEvent(e); else if (st.tool === 'edit') this.editEvent(e); else this.boxEvent(e, st.tool);
    return true;
  }

  private boxEvent(e: ViewPointerEvent, shape: 'rect' | 'ellipse') {
    if (e.type === 'down' && e.button === 0) { this.drag = { kind: 'box', a: e.pos, b: e.pos }; }
    else if (e.type === 'move' && this.drag?.kind === 'box') { this.drag.b = e.pos; this.redraw(); }
    else if ((e.type === 'up' || e.type === 'cancel') && this.drag?.kind === 'box') {
      const d = this.drag; this.drag = null;
      const env = this.store.env, tiny = Math.abs(d.b.x - d.a.x) * env.width < 8 || Math.abs(d.b.y - d.a.y) * env.height < 8;
      if (e.type === 'cancel' || tiny) { this.refresh(); return; }
      this.add({ kind: 'shape', mode: 'add', shape, pts: [d.a.x, d.a.y, d.b.x, d.b.y] });
    }
  }

  private polyEvent(e: ViewPointerEvent) {
    const env = this.store.env, tol = 14 * this.view.pxPerScreenPx;
    if (e.type === 'move') { this.hover = e.pos; if (this.draft.length) this.redraw(); return; }
    if (e.type === 'dblclick') { this.finishDraft(); return; }
    if (e.type === 'down' && e.button === 0) {
      if (this.draft.length / 2 >= MIN_POINTS.polygon) {                    // clicking the first point closes the zone
        const dx = (e.pos.x - this.draft[0]) * env.width, dy = (e.pos.y - this.draft[1]) * env.height;
        if (Math.hypot(dx, dy) < tol) { this.finishDraft(); return; }
      }
      this.draft.push(e.pos.x, e.pos.y); this.hover = e.pos;
      if (this.draft.length === 2) this.store.setSearchTool({ drafting: true });
      this.redraw();
    }
  }

  private editEvent(e: ViewPointerEvent) {
    const env = this.store.env, st = this.st(), tol = 14 * this.view.pxPerScreenPx, W = env.width, H = env.height;
    const near = (a: Vec2, p: Vec2) => Math.hypot((a.x - p.x) * W, (a.y - p.y) * H) <= tol;
    const sel = this.zones().find((z) => z.id === st.selectedId);
    const move = (id: string, shape: OccluderShape) => { this.preview = { id, shape }; this.redraw(); };

    if (e.type === 'dblclick' && sel) {
      const sh = sel.shape, hs = shapeHandles(sh), hi = hs.findIndex((h) => near(h, e.pos));
      let next: OccluderShape = sh;
      if (hi >= 0) next = removeShapePoint(sh, hi);
      else { const ne = nearestEdge(sh, e.pos, W, H); if (ne && ne.dist <= tol) next = insertShapePoint(sh, ne.index, ne.at); }
      if (next !== sh) this.replace(sel.id, next);
      return;
    }
    if (e.type === 'down' && e.button === 0) {
      if (sel) { const hi = shapeHandles(sel.shape).findIndex((h) => near(h, e.pos)); if (hi >= 0) { this.drag = { kind: 'handle', index: hi, start: sel.shape }; return; } }
      const list = this.zones();
      for (let i = list.length - 1; i >= 0; i--) {                      // the top-most zone under the pointer
        if (pointInPolygon(zonePolygon(list[i]), e.pos.x, e.pos.y)) {
          this.store.setSearchTool({ selectedId: list[i].id });
          this.drag = { kind: 'body', from: e.pos, start: list[i].shape }; this.preview = null; this.redraw(); return;
        }
      }
      this.store.setSearchTool({ selectedId: null });
    } else if (e.type === 'move' && this.drag && (this.drag.kind === 'handle' || this.drag.kind === 'body') && sel) {
      const d = this.drag;
      move(sel.id, d.kind === 'handle' ? moveShapeHandle(d.start, d.index, e.pos) : translateShape(d.start, e.pos.x - d.from.x, e.pos.y - d.from.y));
    } else if ((e.type === 'up' || e.type === 'cancel') && this.drag && (this.drag.kind === 'handle' || this.drag.kind === 'body')) {
      this.drag = null;
      const p = this.preview;
      if (e.type === 'up' && p) this.replace(p.id, p.shape); else { this.preview = null; this.refresh(); }
    }
  }
}
