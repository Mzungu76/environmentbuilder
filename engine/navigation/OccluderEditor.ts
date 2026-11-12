import type { EditorStore } from '@/lib/store/editorStore';
import type { OccluderItem, SceneView, ViewPointerEvent } from '@/engine/rendering/SceneView';
import type { Occluder, OccluderStroke, Vec2 } from '@/types';
import { applyStroke, hasCoverage, occGrid, occluderAlpha, occluderCoverage, seedCoverage } from './occluders';

/**
 * Brush editor for the occluders (Primo piano tool) AND the one that keeps the cut-outs in the view in sync with the document
 * (also in playtest, where no tool is active). While you drag, the stroke is painted live on a working copy; on release it
 * becomes ONE undo step (one stroke op).
 */
export class OccluderEditor {
  private canvas: HTMLCanvasElement | null = null;
  private work: { id: string; mask: Uint8Array; pts: number[]; last?: Vec2 } | null = null;
  private version = 0;
  private versions = new Map<string, { ops: unknown; soft: number; v: number; alpha: Uint8Array | null; empty: boolean }>();
  private liveTimer: ReturnType<typeof setTimeout> | null = null;
  private unsub: () => void;
  private shown = false;

  constructor(private store: EditorStore, private view: SceneView) {
    this.unsub = store.subscribe(() => this.refresh());
    this.refresh();
  }

  dispose() { this.unsub(); if (this.liveTimer) clearTimeout(this.liveTimer); this.view.setOccluders([]); this.view.setOccluderTint(null); if (this.shown) this.view.setBrush(0, 0, 0, null); }

  private active() { const s = this.store.getState(); return s.tool === 'occluders' && s.mode === 'editor' && !s.preview; }

  /** Cut-outs for every occluder of the environment (the one being painted uses its live working mask). */
  private items(): OccluderItem[] {
    const env = this.store.env, { w, h } = occGrid(env), out: OccluderItem[] = [];
    if (!env.width || !env.height) return out;
    for (const o of env.occluders ?? []) {
      const live = !!this.work && this.work.id === o.id, prev = this.versions.get(o.id);
      if (!live && prev && prev.ops === o.ops && prev.soft === o.softness) {        // unchanged: reuse the feathered grid, no re-rasterizing
        if (!prev.empty && prev.alpha) out.push({ id: o.id, alpha: prev.alpha, w, h, version: prev.v });
        continue;
      }
      const cov = live ? this.work!.mask : occluderCoverage(env, o);
      const empty = !live && !hasCoverage(cov), v = ++this.version;
      const alpha = empty ? null : occluderAlpha(env, o, cov);
      this.versions.set(o.id, { ops: live ? null : o.ops, soft: o.softness, v, alpha: live ? null : alpha, empty });
      if (alpha) out.push({ id: o.id, alpha, w, h, version: v });
    }
    return out;
  }

  refresh() {
    this.view.setOccluders(this.items());
    this.drawTint();
  }

  private drawTint() {
    if (!this.active()) { this.view.setOccluderTint(null); if (this.shown) { this.shown = false; this.view.setBrush(0, 0, 0, null); } return; }
    this.shown = true;
    const env = this.store.env;
    if (!env.width || !env.height) return;
    const { w, h } = occGrid(env), sel = this.store.getState().occluderBrush.occluderId;
    if (!this.canvas) this.canvas = document.createElement('canvas');
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const ctx = this.canvas.getContext('2d')!, img = ctx.createImageData(w, h);
    for (const o of env.occluders ?? []) {
      const cov = this.work && this.work.id === o.id ? this.work.mask : occluderCoverage(env, o);
      const r = parseInt(o.color.slice(1, 3), 16), g = parseInt(o.color.slice(3, 5), 16), b = parseInt(o.color.slice(5, 7), 16), k = o.id === sel ? 0.5 : 0.28;
      for (let i = 0; i < w * h; i++) {
        const a = (cov[i] / 255) * k; if (a <= 0) continue;
        const p = i * 4, oa = img.data[p + 3] / 255, na = a + oa * (1 - a);
        img.data[p] = (r * a + img.data[p] * oa * (1 - a)) / na; img.data[p + 1] = (g * a + img.data[p + 1] * oa * (1 - a)) / na; img.data[p + 2] = (b * a + img.data[p + 2] * oa * (1 - a)) / na; img.data[p + 3] = na * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.view.setOccluderTint(this.canvas);
  }

  /** Returns true when the event belongs to the occluders tool (so no other editor reacts to it). */
  handle(e: ViewPointerEvent): boolean {
    if (!this.active()) return false;
    const env = this.store.env, b = this.store.getState().occluderBrush;
    if (!env.width || !env.height) return true;
    if (e.type === 'move' || e.type === 'down') this.view.setBrush(e.pos.x, e.pos.y, b.radius, b.occluderId ? b.mode : null);
    if (e.type === 'down' && e.button === 0 && b.occluderId) {
      const o = env.occluders?.find((x) => x.id === b.occluderId); if (!o) return true;
      this.work = { id: o.id, mask: new Uint8Array(occluderCoverage(env, o)), pts: [] };
      this.paint(e.pos);
    } else if (e.type === 'move' && this.work) this.paint(e.pos);
    else if ((e.type === 'up' || e.type === 'cancel') && this.work) this.commit();
    return true;
  }

  private paint(p: Vec2) {
    const env = this.store.env, b = this.store.getState().occluderBrush, wk = this.work!, { w, h } = occGrid(env), aspect = env.width / env.height;
    const last = wk.pts.length >= 2 ? { x: wk.pts[wk.pts.length - 2], y: wk.pts[wk.pts.length - 1] } : undefined;
    if (last && Math.hypot((p.x - last.x) * aspect, p.y - last.y) < b.radius * 0.15) return;      // thin out the recorded points
    const stroke: OccluderStroke = { kind: 'stroke', mode: b.mode === 'paint' ? 'add' : 'sub', radius: b.radius, pts: [p.x, p.y] };
    applyStroke(wk.mask, w, h, aspect, stroke, last);
    wk.pts.push(p.x, p.y);
    this.drawTint();
    // the real cut-out follows the brush, but not on every move (it re-cuts a big image)
    if (!this.liveTimer) this.liveTimer = setTimeout(() => { this.liveTimer = null; if (this.work) this.view.setOccluders(this.items()); }, 90);
  }

  private commit() {
    const wk = this.work; this.work = null;
    if (this.liveTimer) { clearTimeout(this.liveTimer); this.liveTimer = null; }
    if (!wk || !wk.pts.length) { this.refresh(); return; }
    const b = this.store.getState().occluderBrush, env = this.store.env;
    const op: OccluderStroke = { kind: 'stroke', mode: b.mode === 'paint' ? 'add' : 'sub', radius: b.radius, pts: wk.pts };
    let newOps: OccluderStroke[] | null = null;
    this.store.commitEnv((e) => ({ ...e, occluders: (e.occluders ?? []).map((o) => { if (o.id !== wk.id) return o; newOps = [...o.ops, op]; return { ...o, ops: newOps }; }) }));
    if (newOps) seedCoverage(env, newOps, wk.mask);        // the painted grid is exactly what replaying the ops gives: no re-rasterizing
    this.refresh();
  }
}
export type { Occluder };
