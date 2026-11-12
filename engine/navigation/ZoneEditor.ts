import type { EditorStore } from '@/lib/store/editorStore';
import type { SceneView, ViewPointerEvent } from '@/engine/rendering/SceneView';
import type { Vec2 } from '@/types';
import { decodeMask, emptyMask, encodeMask, stamp, zoneGrid } from './scaleZones';

/**
 * Brush editor for the scale zones: paints (or erases) the coverage of the zone chosen in the panel. While you drag the stroke is
 * drawn live on a working copy; on release it becomes ONE undo step. The zones are shown over the scene only with this tool active.
 */
export class ZoneEditor {
  private canvas: HTMLCanvasElement | null = null;
  private work: { id: string; mask: Uint8Array } | null = null;
  private last: Vec2 | null = null;
  private unsub: () => void;

  constructor(private store: EditorStore, private view: SceneView) {
    this.unsub = store.subscribe(() => this.refresh());
    this.refresh();
  }

  dispose() { this.unsub(); this.view.setZoneCanvas(null); this.view.setBrush(0, 0, 0, null); }

  private active() { const s = this.store.getState(); return s.tool === 'zones' && s.mode === 'editor' && !s.preview; }

  /** Redraws the translucent zone layer (or hides it when the tool is not active). */
  refresh() {
    if (!this.active()) { this.view.setZoneCanvas(null); this.view.setBrush(0, 0, 0, null); return; }
    const env = this.store.env;
    if (!env.width || !env.height) return;
    const { w, h } = zoneGrid(env);
    if (!this.canvas) this.canvas = document.createElement('canvas');
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const ctx = this.canvas.getContext('2d')!, img = ctx.createImageData(w, h), sel = this.store.getState().zoneBrush.zoneId;
    for (const z of env.scaleZones ?? []) {
      const mask = this.work && this.work.id === z.id ? this.work.mask : decodeMask(z.mask, w, h);
      const r = parseInt(z.color.slice(1, 3), 16), g = parseInt(z.color.slice(3, 5), 16), b = parseInt(z.color.slice(5, 7), 16), k = z.id === sel ? 0.62 : 0.34;
      for (let i = 0; i < w * h; i++) {
        const a = (mask[i] / 255) * k; if (a <= 0) continue;
        const o = i * 4, oa = img.data[o + 3] / 255, na = a + oa * (1 - a);
        img.data[o] = (r * a + img.data[o] * oa * (1 - a)) / (na || 1); img.data[o + 1] = (g * a + img.data[o + 1] * oa * (1 - a)) / (na || 1); img.data[o + 2] = (b * a + img.data[o + 2] * oa * (1 - a)) / (na || 1); img.data[o + 3] = na * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.view.setZoneCanvas(this.canvas);
  }

  /** Returns true when the event belongs to the zones tool (so no other editor reacts to it). */
  handle(e: ViewPointerEvent): boolean {
    if (!this.active()) return false;
    const env = this.store.env, b = this.store.getState().zoneBrush;
    if (!env.width || !env.height) return true;
    if (e.type === 'move' || e.type === 'down') this.view.setBrush(e.pos.x, e.pos.y, b.radius, b.zoneId ? b.mode : null);
    if (e.type === 'down' && e.button === 0 && b.zoneId) {
      const z = env.scaleZones?.find((x) => x.id === b.zoneId); if (!z) return true;
      const { w, h } = zoneGrid(env);
      this.work = { id: z.id, mask: new Uint8Array(decodeMask(z.mask, w, h)) }; this.last = null;
      this.paint(e.pos);
    } else if (e.type === 'move' && this.work) this.paint(e.pos);
    else if ((e.type === 'up' || e.type === 'cancel') && this.work) this.commit();
    return true;
  }

  private paint(p: Vec2) {
    const env = this.store.env, b = this.store.getState().zoneBrush, wk = this.work!, { w, h } = zoneGrid(env), aspect = env.width / env.height;
    const from = this.last ?? p, dist = Math.hypot((p.x - from.x) * aspect, p.y - from.y), step = Math.max(0.002, b.radius * 0.35), n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) stamp(wk.mask, w, h, aspect, from.x + ((p.x - from.x) * i) / n, from.y + ((p.y - from.y) * i) / n, b.radius, b.mode);
    this.last = p;
    this.refresh();
  }

  private commit() {
    const wk = this.work; this.work = null; this.last = null;
    if (!wk) return;
    const mask = encodeMask(wk.mask);
    this.store.commitEnv((e) => ({ ...e, scaleZones: (e.scaleZones ?? []).map((z) => (z.id === wk.id ? { ...z, mask } : z)) }));
  }
}
export { emptyMask };
