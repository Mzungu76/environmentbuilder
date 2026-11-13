import type { Graphics } from 'pixi.js';
import type { EditorStore } from '@/lib/store/editorStore';
import type { OccluderItem, SceneView, ViewPointerEvent } from '@/engine/rendering/SceneView';
import type { Occluder, OccluderOp, OccluderShape, OccluderStroke, Vec2 } from '@/types';
import { uid } from '@/lib/ids';
import {
  MIN_POINTS, newOccluder, applyOp, applyStroke, hasCoverage, insertShapePoint, moveShapeHandle, nearestEdge, occGrid, occluderAlpha, occluderCoverage,
  pointInPolygon, removeShapePoint, seedCoverage, shapeHandles, shapePolygon, splinePolygon, translateShape,
} from './occluders';

type Drag =
  | { kind: 'brush'; mask: Uint8Array; pts: number[] }
  | { kind: 'box'; a: Vec2; b: Vec2 }
  | { kind: 'handle'; index: number; start: OccluderShape }
  | { kind: 'body'; from: Vec2; start: OccluderShape };

/**
 * Editor of the occluders (Primo piano tool): brush / eraser strokes, rectangles, ellipses, polygons and splines, and an edit tool
 * to move shapes and drag their points. It is also the one that keeps the cut-outs in the view in sync with the document (in
 * playtest too, where no tool is active). Every finished gesture is ONE undo step.
 */
export class OccluderEditor {
  private canvas: HTMLCanvasElement | null = null;
  private drag: Drag | null = null;
  /** polygon / spline being drawn: placed points (normalized) */
  private draft: number[] = [];
  private hover: Vec2 | null = null;
  /** ops of the occluder being worked on while a gesture is in progress (null = the document's own) */
  private preview: { id: string; ops: OccluderOp[]; mask: Uint8Array | null } | null = null;
  private version = 0;
  private cache = new Map<string, { ops: unknown; soft: number; v: number; alpha: Uint8Array | null; empty: boolean }>();
  private liveTimer: ReturnType<typeof setTimeout> | null = null;
  private tintSig = '';
  private opsIds = new WeakMap<object, number>();
  private opsKey(ops: object) { let k = this.opsIds.get(ops); if (!k) { k = ++this.version; this.opsIds.set(ops, k); } return k; }
  private unsub: () => void;
  private shown = false;

  constructor(private store: EditorStore, private view: SceneView) {
    this.unsub = store.subscribe(() => this.refresh());
    this.refresh();
  }

  dispose() {
    this.unsub(); if (this.liveTimer) clearTimeout(this.liveTimer);
    this.view.setOccluders([]); this.view.setOccluderTint(null); this.view.setOccluderGuides(null); if (this.shown) this.view.setBrush(0, 0, 0, null);
  }

  private active() { const s = this.store.getState(); return s.tool === 'occluders' && s.mode === 'editor' && !s.preview; }
  private brush() { return this.store.getState().occluderBrush; }
  private sign(): 'add' | 'sub' { return this.brush().mode === 'paint' ? 'add' : 'sub'; }
  private cur() { const env = this.store.env, id = this.brush().occluderId; return env.occluders?.find((o) => o.id === id); }

  /**
   * The occluder to draw on. Nothing to choose beforehand: with none selected the last one is used, and when the environment has none
   * the first one ("Primo piano 1") is created by the first stroke or click.
   */
  private ensure(): Occluder | undefined {
    const cur = this.cur(); if (cur) return cur;
    const list = this.store.env.occluders ?? [];
    let id: string;
    if (list.length) id = list[list.length - 1].id;
    else { const n = newOccluder(list, uid('occ')); id = n.id; this.store.commitEnv((e) => ({ ...e, occluders: [...(e.occluders ?? []), n] })); }
    this.store.setOccluderBrush({ occluderId: id, selectedOp: null });
    return this.store.env.occluders?.find((o) => o.id === id);
  }

  /** Coverage grid of an occluder: the live one while a gesture is in progress, else the document's. */
  private coverage(o: { id: string; ops: OccluderOp[] }): Uint8Array {
    const env = this.store.env, p = this.preview;
    if (p && p.id === o.id) {
      if (p.mask) return p.mask;
      const { w, h } = occGrid(env), m = new Uint8Array(w * h), aspect = env.width / env.height;
      for (const op of p.ops) applyOp(m, w, h, aspect, op);
      p.mask = m; return m;
    }
    return occluderCoverage(env, o);
  }

  /** Cut-outs for every occluder of the environment. Unchanged ones reuse their feathered grid. */
  private items(): OccluderItem[] {
    const env = this.store.env, { w, h } = occGrid(env), out: OccluderItem[] = [];
    if (!env.width || !env.height) return out;
    for (const o of env.occluders ?? []) {
      const live = !!this.preview && this.preview.id === o.id, prev = this.cache.get(o.id);
      if (!live && prev && prev.ops === o.ops && prev.soft === o.softness) {
        if (!prev.empty && prev.alpha) out.push({ id: o.id, alpha: prev.alpha, w, h, version: prev.v });
        continue;
      }
      const cov = this.coverage(o), empty = !hasCoverage(cov), v = ++this.version, alpha = empty ? null : occluderAlpha(env, o, cov);
      this.cache.set(o.id, { ops: live ? null : o.ops, soft: o.softness, v, alpha: live ? null : alpha, empty });
      if (alpha) out.push({ id: o.id, alpha, w, h, version: v });
    }
    return out;
  }

  refresh() {
    if (!this.active() && (this.draft.length || this.drag || this.preview)) {          // the tool was left in the middle of a gesture
      this.draft = []; this.drag = null; this.preview = null; this.hover = null;
      if (this.brush().drafting) { this.store.setOccluderBrush({ drafting: false }); return; }
    }
    this.view.setOccluders(this.items());
    this.drawTint();
    this.setGuides();
  }

  /**
   * Tint over the occluders. Strong while the Primo piano tool is in use; faint in the editor otherwise, so the painted parts never
   * look lost (the cut-out itself is the backdrop again, invisible by design). Hidden in playtest and in the clean preview.
   */
  private drawTint() {
    const st = this.store.getState(), act = this.active();
    if (!act && this.shown) { this.shown = false; this.view.setBrush(0, 0, 0, null); }
    if (st.mode !== 'editor' || st.preview || !(this.store.env.occluders?.length)) { this.view.setOccluderTint(null); this.tintSig = ''; return; }
    if (act) this.shown = true;
    const env = this.store.env;
    if (!env.width || !env.height) return;
    const { w, h } = occGrid(env), sel = act ? this.brush().occluderId : null;
    const live = this.preview ? ++this.version : 0;
    const sig = `${act ? 'a' : 'p'}|${sel}|${live}|${(env.occluders ?? []).map((o) => `${o.id}:${this.opsKey(o.ops)}:${o.color}`).join(',')}`;
    if (!live && sig === this.tintSig && this.canvas) { this.view.setOccluderTint(this.canvas); return; }
    this.tintSig = sig;
    if (!this.canvas) this.canvas = document.createElement('canvas');
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const ctx = this.canvas.getContext('2d')!, img = ctx.createImageData(w, h);
    for (const o of env.occluders ?? []) {
      const cov = this.coverage(o);
      const r = parseInt(o.color.slice(1, 3), 16), g = parseInt(o.color.slice(3, 5), 16), b = parseInt(o.color.slice(5, 7), 16), k = act ? (o.id === sel ? 0.5 : 0.28) : 0.2;
      for (let i = 0; i < w * h; i++) {
        const a = (cov[i] / 255) * k; if (a <= 0) continue;
        const p = i * 4, oa = img.data[p + 3] / 255, na = a + oa * (1 - a);
        img.data[p] = (r * a + img.data[p] * oa * (1 - a)) / na; img.data[p + 1] = (g * a + img.data[p + 1] * oa * (1 - a)) / na; img.data[p + 2] = (b * a + img.data[p + 2] * oa * (1 - a)) / na; img.data[p + 3] = na * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.view.setOccluderTint(this.canvas);
  }

  /** The cut-out and the tint follow the gesture, but not on every pointer move (they re-cut a big image). */
  private live() {
    if (this.liveTimer) return;
    this.liveTimer = setTimeout(() => { this.liveTimer = null; if (this.preview) { this.view.setOccluders(this.items()); this.drawTint(); } }, 90);
  }

  // ---- guides (lines and handles over the scene) ----------------------------------------------------------------------------

  private setGuides() {
    if (!this.active()) { this.view.setOccluderGuides(null); return; }
    this.view.setOccluderGuides((g, px, W, H) => this.drawGuides(g, px, W, H));
  }

  private outline(g: Graphics, poly: number[], W: number, H: number, color: number, width: number, alpha: number, close = true) {
    if (poly.length < 4) return;
    g.moveTo(poly[0] * W, poly[1] * H);
    for (let i = 2; i < poly.length; i += 2) g.lineTo(poly[i] * W, poly[i + 1] * H);
    if (close) g.closePath();
    g.stroke({ width, color, alpha, join: 'round' });
  }

  private drawGuides(g: Graphics, px: number, W: number, H: number) {
    const b = this.brush(), o = this.cur();
    // shapes of the current occluder: faint outlines in the edit tool, the selected one with handles
    if (b.tool === 'edit' && o) {
      o.ops.forEach((op, i) => {
        if (op.kind !== 'shape') return;
        const poly = this.opAt(i)?.kind === 'shape' ? shapePolygon(this.opAt(i) as OccluderShape) : shapePolygon(op), sel = i === b.selectedOp;
        this.outline(g, poly, W, H, sel ? 0xffffff : 0xfde047, (sel ? 2 : 1.2) * px, sel ? 1 : 0.55);
      });
      const sel = b.selectedOp !== null ? this.opAt(b.selectedOp) : null;
      if (sel && sel.kind === 'shape') {
        if (sel.shape === 'spline' || sel.shape === 'polygon') this.outline(g, sel.pts, W, H, 0xfde047, 1 * px, 0.35);
        for (const h of shapeHandles(sel)) g.circle(h.x * W, h.y * H, 6 * px).fill({ color: 0xffffff }).stroke({ width: 1.5 * px, color: 0x111827 });
      }
    }
    // rubber band of a rect / ellipse being dragged
    const d = this.drag;
    if (d?.kind === 'box') {
      const sh: OccluderShape = { kind: 'shape', mode: this.sign(), shape: b.tool === 'ellipse' ? 'ellipse' : 'rect', pts: [d.a.x, d.a.y, d.b.x, d.b.y] };
      this.outline(g, shapePolygon(sh), W, H, 0xffffff, 2 * px, 1);
    }
    // polygon / spline being drawn
    if (this.draft.length >= 2 && (b.tool === 'polygon' || b.tool === 'spline')) {
      const pts = this.hover ? [...this.draft, this.hover.x, this.hover.y] : this.draft;
      if (b.tool === 'spline' && pts.length >= 6) this.outline(g, splinePolygon(pts), W, H, 0xffffff, 2 * px, 1);
      else this.outline(g, pts, W, H, 0xffffff, 2 * px, 1, false);
      for (let i = 0; i < this.draft.length; i += 2) g.circle(this.draft[i] * W, this.draft[i + 1] * H, (i === 0 ? 7 : 5) * px).fill({ color: i === 0 ? 0xfde047 : 0xffffff }).stroke({ width: 1.5 * px, color: 0x111827 });
    }
  }

  /** The op at `index` as it currently is (the one being dragged shows its live shape). */
  private opAt(index: number): OccluderOp | undefined {
    const o = this.cur(); if (!o) return undefined;
    return this.preview && this.preview.id === o.id ? this.preview.ops[index] : o.ops[index];
  }

  // ---- commands used by the UI ------------------------------------------------------------------------------------------------

  /** Closes the polygon / spline being drawn and adds it (needs enough points; otherwise it is discarded). */
  finishDraft() {
    const o = this.cur(), b = this.brush();
    const pts = this.draft; this.draft = []; this.hover = null; this.store.setOccluderBrush({ drafting: false });
    if (o && (b.tool === 'polygon' || b.tool === 'spline') && pts.length / 2 >= MIN_POINTS[b.tool]) this.appendOp(o.id, { kind: 'shape', mode: this.sign(), shape: b.tool, pts });
    else this.refresh();
  }
  cancelDraft() { if (!this.draft.length) return; this.draft = []; this.hover = null; this.store.setOccluderBrush({ drafting: false }); this.refresh(); }
  /** Esc: drops what is in progress. */
  cancelPending() { this.cancelDraft(); if (this.drag) { this.drag = null; this.preview = null; this.refresh(); } }

  deleteSelected(): boolean {
    const o = this.cur(), b = this.brush();
    if (!this.active() || !o || b.selectedOp === null || o.ops[b.selectedOp]?.kind !== 'shape') return false;
    const ops = o.ops.filter((_, i) => i !== b.selectedOp);
    this.store.setOccluderBrush({ selectedOp: null });
    this.replaceOps(o.id, ops);
    return true;
  }

  private replaceOps(id: string, ops: OccluderOp[], seed?: Uint8Array) {
    const env = this.store.env;
    this.preview = null;
    this.store.commitEnv((e) => ({ ...e, occluders: (e.occluders ?? []).map((o) => (o.id === id ? { ...o, ops } : o)) }));
    if (seed) seedCoverage(env, ops, seed);
    this.refresh();
  }
  private appendOp(id: string, op: OccluderOp, seed?: Uint8Array) {
    const o = this.store.env.occluders?.find((x) => x.id === id); if (!o) return;
    this.replaceOps(id, [...o.ops, op], seed);
  }

  // ---- pointer ---------------------------------------------------------------------------------------------------------------

  /** Returns true when the event belongs to the occluders tool (so no other editor reacts to it). */
  handle(e: ViewPointerEvent): boolean {
    if (!this.active()) return false;
    const env = this.store.env, b = this.brush();
    if (!env.width || !env.height) return true;
    const o = this.cur();
    if (e.type === 'move' || e.type === 'down') this.view.setBrush(e.pos.x, e.pos.y, b.tool === 'brush' ? b.radius : 0, b.tool === 'brush' ? b.mode : null);
    if (!o && b.tool === 'edit') return true;
    if (!o && e.type !== 'down') return true;
    const occ = o ?? this.ensure();
    if (!occ) return true;
    switch (b.tool) {
      case 'brush': this.brushEvent(e, occ.id); break;
      case 'rect': case 'ellipse': this.boxEvent(e, occ.id, b.tool); break;
      case 'polygon': case 'spline': this.polyEvent(e); break;
      case 'edit': this.editEvent(e, occ.id); break;
    }
    return true;
  }

  private brushEvent(e: ViewPointerEvent, id: string) {
    const env = this.store.env, b = this.brush(), { w, h } = occGrid(env), aspect = env.width / env.height;
    const paint = (p: Vec2) => {
      const d = this.drag as Extract<Drag, { kind: 'brush' }>, n = d.pts.length;
      const last = n >= 2 ? { x: d.pts[n - 2], y: d.pts[n - 1] } : undefined;
      if (last && Math.hypot((p.x - last.x) * aspect, p.y - last.y) < b.radius * 0.15) return;        // thin out the recorded points
      const stroke: OccluderStroke = { kind: 'stroke', mode: this.sign(), radius: b.radius, pts: [p.x, p.y] };
      applyStroke(d.mask, w, h, aspect, stroke, last);
      d.pts.push(p.x, p.y);
      this.preview = { id, ops: [], mask: d.mask }; this.drawTint(); this.live();
    };
    if (e.type === 'down' && e.button === 0) {
      const o = env.occluders!.find((x) => x.id === id)!;
      this.drag = { kind: 'brush', mask: new Uint8Array(occluderCoverage(env, o)), pts: [] }; paint(e.pos);
    } else if (e.type === 'move' && this.drag?.kind === 'brush') paint(e.pos);
    else if ((e.type === 'up' || e.type === 'cancel') && this.drag?.kind === 'brush') {
      const d = this.drag; this.drag = null;
      if (this.liveTimer) { clearTimeout(this.liveTimer); this.liveTimer = null; }
      if (!d.pts.length) { this.preview = null; this.refresh(); return; }
      this.appendOp(id, { kind: 'stroke', mode: this.sign(), radius: b.radius, pts: d.pts }, d.mask);   // the painted grid is what replaying the ops gives
    }
  }

  private boxEvent(e: ViewPointerEvent, id: string, shape: 'rect' | 'ellipse') {
    const update = () => { const d = this.drag as Extract<Drag, { kind: 'box' }>; this.preview = { id, ops: [...this.cur()!.ops, { kind: 'shape', mode: this.sign(), shape, pts: [d.a.x, d.a.y, d.b.x, d.b.y] }], mask: null }; this.setGuidesNow(); this.live(); };
    if (e.type === 'down' && e.button === 0) { this.drag = { kind: 'box', a: e.pos, b: e.pos }; }
    else if (e.type === 'move' && this.drag?.kind === 'box') { this.drag.b = e.pos; update(); }
    else if ((e.type === 'up' || e.type === 'cancel') && this.drag?.kind === 'box') {
      const d = this.drag; this.drag = null;
      if (this.liveTimer) { clearTimeout(this.liveTimer); this.liveTimer = null; }
      const env = this.store.env, tiny = Math.abs(d.b.x - d.a.x) * env.width < 4 || Math.abs(d.b.y - d.a.y) * env.height < 4;
      if (e.type === 'cancel' || tiny) { this.preview = null; this.refresh(); return; }
      this.appendOp(id, { kind: 'shape', mode: this.sign(), shape, pts: [d.a.x, d.a.y, d.b.x, d.b.y] });
    }
  }

  private polyEvent(e: ViewPointerEvent) {
    const b = this.brush(), env = this.store.env, tol = 14 * this.view.pxPerScreenPx;
    if (e.type === 'move') { this.hover = e.pos; if (this.draft.length) this.setGuidesNow(); return; }
    if (e.type === 'dblclick') { this.finishDraft(); return; }
    if (e.type === 'down' && e.button === 0) {
      if (this.draft.length / 2 >= MIN_POINTS[b.tool as 'polygon' | 'spline']) {          // clicking the first point closes the shape
        const dx = (e.pos.x - this.draft[0]) * env.width, dy = (e.pos.y - this.draft[1]) * env.height;
        if (Math.hypot(dx, dy) < tol) { this.finishDraft(); return; }
      }
      this.draft.push(e.pos.x, e.pos.y); this.hover = e.pos;
      if (this.draft.length === 2) this.store.setOccluderBrush({ drafting: true });
      this.setGuidesNow();
    }
  }
  private setGuidesNow() { this.view.setOccluderGuides((g, px, W, H) => this.drawGuides(g, px, W, H)); }

  private editEvent(e: ViewPointerEvent, id: string) {
    const env = this.store.env, o = env.occluders!.find((x) => x.id === id)!, b = this.brush(), tol = 14 * this.view.pxPerScreenPx, W = env.width, H = env.height;
    const near = (a: Vec2, p: Vec2) => Math.hypot((a.x - p.x) * W, (a.y - p.y) * H) <= tol;
    const selOp = b.selectedOp !== null ? o.ops[b.selectedOp] : undefined;
    const sel = selOp?.kind === 'shape' ? selOp : undefined;
    const move = (op: OccluderShape) => { this.preview = { id, ops: o.ops.map((x, i) => (i === b.selectedOp ? op : x)), mask: null }; this.setGuidesNow(); this.live(); };

    if (e.type === 'dblclick' && sel && b.selectedOp !== null) {
      const hs = shapeHandles(sel), hi = hs.findIndex((h) => near(h, e.pos));
      let next: OccluderShape = sel;
      if (hi >= 0) next = removeShapePoint(sel, hi);
      else { const ne = nearestEdge(sel, e.pos, W, H); if (ne && ne.dist <= tol) next = insertShapePoint(sel, ne.index, ne.at); }
      if (next !== sel) this.replaceOps(id, o.ops.map((x, i) => (i === b.selectedOp ? next : x)));
      return;
    }
    if (e.type === 'down' && e.button === 0) {
      if (sel) {                                                      // a handle of the selected shape?
        const hi = shapeHandles(sel).findIndex((h) => near(h, e.pos));
        if (hi >= 0) { this.drag = { kind: 'handle', index: hi, start: sel }; return; }
      }
      for (let i = o.ops.length - 1; i >= 0; i--) {                    // otherwise the top-most shape under the pointer
        const op = o.ops[i];
        if (op.kind === 'shape' && pointInPolygon(shapePolygon(op), e.pos.x, e.pos.y)) {
          this.store.setOccluderBrush({ selectedOp: i });
          this.drag = { kind: 'body', from: e.pos, start: op }; this.preview = null; this.setGuidesNow(); return;
        }
      }
      this.store.setOccluderBrush({ selectedOp: null });
    } else if (e.type === 'move' && this.drag && (this.drag.kind === 'handle' || this.drag.kind === 'body') && sel) {
      const d = this.drag;
      move(d.kind === 'handle' ? moveShapeHandle(d.start, d.index, e.pos) : translateShape(d.start, e.pos.x - d.from.x, e.pos.y - d.from.y));
    } else if ((e.type === 'up' || e.type === 'cancel') && this.drag && (this.drag.kind === 'handle' || this.drag.kind === 'body')) {
      this.drag = null;
      if (this.liveTimer) { clearTimeout(this.liveTimer); this.liveTimer = null; }
      const p = this.preview;
      if (e.type === 'up' && p && p.id === id) this.replaceOps(id, p.ops); else { this.preview = null; this.refresh(); }
    }
  }
}
