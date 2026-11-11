import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { CharacterState, NavigationGraph, SceneLayer, Vec2 } from '@/types';
import { edgePolyline } from '@/engine/navigation/geometry';

/**
 * Scene Manager rendering layer (PixiJS).
 *
 * - World space == original image pixels (scale 1 = 100% of the artwork).
 * - Everything exposed to callers is in NORMALIZED coordinates (0..1) so the document never depends on the viewport.
 * - It knows nothing about tools or the store: it renders a model and emits raw pointer events.
 */

export interface ViewPointerEvent {
  type: 'down' | 'move' | 'up' | 'cancel' | 'dblclick';
  /** Normalized position in the environment (can be outside 0..1 when the pointer is off the image). */
  pos: Vec2;
  screen: Vec2;
  button: number;
  pointerType: string;
  shift: boolean;
}

export interface OverlayModel {
  graph: NavigationGraph;
  selection: { kind: 'node' | 'edge'; id: string } | null;
  /** When true no editor overlay is drawn (clean preview). */
  preview: boolean;
  /** Node that starts a pending link / path segment. */
  pendingFrom: string | null;
  /** Cursor position (normalized) used for the rubber-band line. */
  cursor: Vec2 | null;
  hoverNodeId: string | null;
  markers?: PlaytestMarkers | null;
}

/** Destination markers / route highlight used by the playtest (drawn even when the editor overlay is hidden). */
export interface PlaytestMarkers {
  nodeIds: string[];
  hoverId: string | null;
  targetId: string | null;
  routeEdgeIds: string[];
}

export interface CharacterRenderItem {
  id: string;
  /** Feet position, normalized. */
  x: number; y: number;
  /** Size as fractions of the environment height. */
  width: number; height: number;
  color: string;
  facing: 1 | -1;
  state: CharacterState;
  shadow: boolean;
  selected: boolean;
}

export interface LayerSource { layer: SceneLayer; blobLoader: () => Promise<Blob | undefined> }

const EDGE_COLORS: Record<string, number> = {
  walk: 0x2dd4bf, ramp: 0xfb923c, climb: 0xc084fc, stairs: 0xf472b6, 'platform-link': 0x60a5fa, curve: 0x4ade80,
};
const NODE_COLORS: Record<string, number> = {
  waypoint: 0xffffff, junction: 0xfacc15, endpoint: 0xf87171, platform: 0x60a5fa, entrance: 0x22c55e, exit: 0xef4444,
};
const SELECT_COLOR = 0xffffff;
const HANDLE_COLOR = 0xfde047;

export class SceneView {
  private app!: Application;
  private world = new Container();
  private layerRoot = new Container();
  private overlay = new Graphics();
  private host!: HTMLElement;
  private envW = 1;
  private envH = 1;
  private zoom = 1;
  private model: OverlayModel | null = null;
  private dirty = true;
  private sprites = new Map<string, Sprite>();
  private textures = new Map<string, Texture>();
  private layerVersion = 0;
  private destroyed = false;
  private resizeObs?: ResizeObserver;
  private charGfx = new Graphics();
  private chars: CharacterRenderItem[] = [];

  /** When true, single-pointer drag pans the camera (pan tool / space held). */
  panMode = false;
  onPointer: (e: ViewPointerEvent) => void = () => {};
  onCamera: (zoom: number) => void = () => {};
  onAssetError: (assetId: string, message: string) => void = () => {};
  /** Called every frame with the elapsed seconds (drives the simulation in playtest). */
  onTick: (dt: number) => void = () => {};

  static async create(host: HTMLElement): Promise<SceneView> {
    const v = new SceneView();
    await v.init(host);
    return v;
  }

  private async init(host: HTMLElement) {
    this.host = host;
    const app = new Application();
    await app.init({
      resizeTo: host, background: 0x14161a, antialias: true, autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    if (this.destroyed) { app.destroy(true); return; }
    this.app = app;
    host.appendChild(app.canvas);
    app.canvas.style.touchAction = 'none';
    app.canvas.style.display = 'block';
    this.world.addChild(this.layerRoot, this.overlay, this.charGfx);
    app.stage.addChild(this.world);
    app.ticker.add((t) => {
      this.onTick(Math.min(0.1, t.deltaMS / 1000));
      if (this.dirty) { this.dirty = false; this.drawOverlay(); }
      this.drawCharacters();
    });
    this.bindInput(app.canvas);
    let lastW = host.clientWidth, lastH = host.clientHeight;
    this.resizeObs = new ResizeObserver(() => {
      // keep the view centred on the same point when the viewport changes size
      const w = host.clientWidth, h = host.clientHeight;
      if (lastW && lastH) this.world.position.set(this.world.x + (w - lastW) / 2, this.world.y + (h - lastH) / 2);
      lastW = w; lastH = h; this.dirty = true;
    });
    this.resizeObs.observe(host);
  }

  destroy() {
    this.destroyed = true;
    this.resizeObs?.disconnect();
    for (const t of this.textures.values()) t.destroy(true);
    this.textures.clear();
    if (this.app) this.app.destroy(true, { children: true });
  }

  // --- environment / layers ----------------------------------------------------------------
  setEnvironmentSize(w: number, h: number, refit: boolean) {
    const changed = w !== this.envW || h !== this.envH;
    this.envW = Math.max(1, w); this.envH = Math.max(1, h);
    if (changed || refit) { this.fit(); }
    this.dirty = true;
  }

  /** Synchronizes sprites with the layer list. Textures are loaded lazily and cached per asset id. */
  async setLayers(sources: LayerSource[]) {
    const version = ++this.layerVersion;
    const wanted = new Set(sources.map((s) => s.layer.id));
    for (const [id, sp] of this.sprites) if (!wanted.has(id)) { sp.destroy(); this.sprites.delete(id); }

    const roleOrder = { background: 0, midground: 1, foreground: 2 } as const;
    const ordered = sources.map((s, i) => ({ s, i })).sort((a, b) => roleOrder[a.s.layer.role] - roleOrder[b.s.layer.role] || a.i - b.i);

    for (const { s } of ordered) {
      const { layer } = s;
      let tex = this.textures.get(layer.assetId);
      if (!tex) {
        try {
          const blob = await s.blobLoader();
          if (!blob) throw new Error('image data missing in local storage');
          const bmp = await createImageBitmap(blob);
          tex = Texture.from(bmp);
          this.textures.set(layer.assetId, tex);
        } catch (err) {
          this.onAssetError(layer.assetId, err instanceof Error ? err.message : String(err));
          continue;
        }
        if (this.destroyed || version !== this.layerVersion) return; // superseded by a newer call
      }
      let sp = this.sprites.get(layer.id);
      if (!sp) { sp = new Sprite(tex); this.sprites.set(layer.id, sp); }
      else if (sp.texture !== tex) sp.texture = tex;
      sp.visible = layer.visible;
      sp.alpha = layer.opacity;
      sp.position.set(layer.offsetX * this.envW, layer.offsetY * this.envH);
    }
    // attach, then order children back-to-front
    let idx = 0;
    for (const { s } of ordered) {
      const sp = this.sprites.get(s.layer.id);
      if (!sp) continue;
      if (!sp.parent) this.layerRoot.addChild(sp);
      this.layerRoot.setChildIndex(sp, idx++);
    }
    this.dirty = true;
  }

  setCharacters(items: CharacterRenderItem[]) { this.chars = items; }

  /** Screen-independent hit test of the node nearest to a normalized point (used by playtest). */
  get envSize() { return { w: this.envW, h: this.envH }; }

  // --- model ------------------------------------------------------------------------------
  setModel(model: OverlayModel) { this.model = model; this.dirty = true; }

  // --- camera -----------------------------------------------------------------------------
  private get vw() { return this.host.clientWidth || 1; }
  private get vh() { return this.host.clientHeight || 1; }

  fit() {
    if (!this.app) return;
    const pad = 0.94;
    const z = Math.min(this.vw / this.envW, this.vh / this.envH) * pad;
    this.zoom = z;
    this.world.scale.set(z);
    this.world.position.set((this.vw - this.envW * z) / 2, (this.vh - this.envH * z) / 2);
    this.onCamera(z); this.dirty = true;
  }

  getZoom() { return this.zoom; }

  zoomAt(factor: number, sx: number, sy: number) {
    const z = Math.min(32, Math.max(0.02, this.zoom * factor));
    const k = z / this.zoom;
    this.world.position.set(sx - (sx - this.world.x) * k, sy - (sy - this.world.y) * k);
    this.zoom = z;
    this.world.scale.set(z);
    this.onCamera(z); this.dirty = true;
  }
  zoomCenter(factor: number) { this.zoomAt(factor, this.vw / 2, this.vh / 2); }
  panBy(dx: number, dy: number) { this.world.position.set(this.world.x + dx, this.world.y + dy); }

  /** Pixels of environment covered by one screen pixel. */
  get pxPerScreenPx() { return 1 / this.zoom; }

  private toNorm(sx: number, sy: number): Vec2 {
    return { x: (sx - this.world.x) / this.zoom / this.envW, y: (sy - this.world.y) / this.zoom / this.envH };
  }

  // --- input ------------------------------------------------------------------------------
  private bindInput(canvas: HTMLCanvasElement) {
    const pointers = new Map<number, Vec2>();
    let panning: { id: number; x: number; y: number } | null = null;
    let pinch: { dist: number; cx: number; cy: number } | null = null;
    let lastClick = { t: 0, x: 0, y: 0 };

    const local = (e: PointerEvent | WheelEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const emit = (type: ViewPointerEvent['type'], e: PointerEvent) => {
      const s = local(e);
      this.onPointer({ type, pos: this.toNorm(s.x, s.y), screen: s, button: e.button, pointerType: e.pointerType, shift: e.shiftKey });
    };

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const s = local(e);
      if (e.ctrlKey || Math.abs(e.deltaY) >= 1) this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), s.x, s.y);
    }, { passive: false });

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const s = local(e);
      pointers.set(e.pointerId, s);
      if (pointers.size === 2) {
        // second finger: cancel any single-pointer gesture and switch to pinch/pan
        panning = null;
        this.onPointer({ type: 'cancel', pos: this.toNorm(s.x, s.y), screen: s, button: 0, pointerType: e.pointerType, shift: false });
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        return;
      }
      if (pointers.size > 2) return;
      const isPanButton = e.button === 1 || e.button === 2;
      if (isPanButton || this.panMode) { panning = { id: e.pointerId, x: s.x, y: s.y }; canvas.style.cursor = 'grabbing'; return; }
      const now = performance.now();
      const dbl = now - lastClick.t < 350 && Math.hypot(s.x - lastClick.x, s.y - lastClick.y) < 8;
      lastClick = { t: now, x: s.x, y: s.y };
      emit(dbl ? 'dblclick' : 'down', e);
    });

    canvas.addEventListener('pointermove', (e) => {
      const s = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, s);
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        this.panBy(cx - pinch.cx, cy - pinch.cy);
        if (pinch.dist > 0) this.zoomAt(d / pinch.dist, cx, cy);
        pinch = { dist: d, cx, cy };
        return;
      }
      if (panning && panning.id === e.pointerId) { this.panBy(s.x - panning.x, s.y - panning.y); panning.x = s.x; panning.y = s.y; this.dirty = true; return; }
      emit('move', e);
    });

    const end = (e: PointerEvent, cancelled: boolean) => {
      pointers.delete(e.pointerId);
      if (pinch) { if (pointers.size < 2) pinch = null; return; }
      if (panning && panning.id === e.pointerId) { panning = null; canvas.style.cursor = ''; return; }
      emit(cancelled ? 'cancel' : 'up', e);
    };
    canvas.addEventListener('pointerup', (e) => end(e, false));
    canvas.addEventListener('pointercancel', (e) => end(e, true));
  }

  setCursor(css: string) { if (this.app) this.app.canvas.style.cursor = css; }

  // --- overlay drawing --------------------------------------------------------------------
  private drawOverlay() {
    const g = this.overlay;
    g.clear();
    const m = this.model;
    if (!m) return;
    const px = 1 / this.zoom; // one screen pixel in world units
    const W = this.envW, H = this.envH;
    const P = (p: Vec2): [number, number] => [p.x * W, p.y * H];
    if (m.markers) this.drawMarkers(g, m, px, P);
    if (m.preview) return;
    const selEdge = m.selection?.kind === 'edge' ? m.selection.id : null;
    const selNode = m.selection?.kind === 'node' ? m.selection.id : null;

    // edges
    for (const e of m.graph.edges) {
      const pts = edgePolyline(m.graph, e, 28);
      if (!pts) continue;
      const color = EDGE_COLORS[e.type] ?? 0xa3a3a3;
      const selected = e.id === selEdge;
      if (m.markers?.routeEdgeIds.includes(e.id)) {
        g.moveTo(...P(pts[0]));
        for (let i = 1; i < pts.length; i++) g.lineTo(...P(pts[i]));
        g.stroke({ width: 9 * px, color: 0xfde047, alpha: 0.35 });
      }
      g.moveTo(...P(pts[0]));
      for (let i = 1; i < pts.length; i++) g.lineTo(...P(pts[i]));
      if (selected) g.stroke({ width: 7 * px, color: SELECT_COLOR, alpha: 0.35 });
      g.moveTo(...P(pts[0]));
      for (let i = 1; i < pts.length; i++) g.lineTo(...P(pts[i]));
      g.stroke({ width: (selected ? 3.5 : 2.5) * px, color, alpha: 0.95 });

      // direction arrow for one-way edges
      if (e.direction !== 'both') {
        const mi = Math.floor(pts.length / 2);
        const a = pts[mi - 1] ?? pts[0], b = pts[mi];
        let ang = Math.atan2((b.y - a.y) * H, (b.x - a.x) * W);
        if (e.direction === 'backward') ang += Math.PI;
        const [cx, cy] = P(b), s = 9 * px;
        g.moveTo(cx + Math.cos(ang) * s, cy + Math.sin(ang) * s)
          .lineTo(cx + Math.cos(ang + 2.5) * s, cy + Math.sin(ang + 2.5) * s)
          .lineTo(cx + Math.cos(ang - 2.5) * s, cy + Math.sin(ang - 2.5) * s).closePath()
          .fill({ color, alpha: 1 }).stroke({ width: 1 * px, color: 0x000000, alpha: 0.6 });
      }

      // curve handles for the selected bezier edge
      if (selected && e.geometry.kind === 'bezier') {
        const a = m.graph.nodes.find((n) => n.id === e.from)!, b = m.graph.nodes.find((n) => n.id === e.to)!;
        for (const [anchor, c] of [[a, e.geometry.c1], [b, e.geometry.c2]] as const) {
          g.moveTo(...P(anchor)).lineTo(...P(c)).stroke({ width: 1.5 * px, color: HANDLE_COLOR, alpha: 0.7 });
          const [hx, hy] = P(c);
          g.rect(hx - 5 * px, hy - 5 * px, 10 * px, 10 * px).fill({ color: HANDLE_COLOR }).stroke({ width: 1.5 * px, color: 0x000000, alpha: 0.7 });
        }
      }
    }

    // rubber band
    if (m.pendingFrom && m.cursor) {
      const a = m.graph.nodes.find((n) => n.id === m.pendingFrom);
      if (a) g.moveTo(...P(a)).lineTo(...P(m.cursor)).stroke({ width: 2 * px, color: 0xffffff, alpha: 0.6 });
    }

    // nodes
    for (const n of m.graph.nodes) {
      const [x, y] = P(n);
      const sel = n.id === selNode, hov = n.id === m.hoverNodeId, pend = n.id === m.pendingFrom;
      const r = (sel || hov || pend ? 8 : 6.5) * px;
      if (sel || pend) g.circle(x, y, r + 5 * px).fill({ color: pend ? 0xfacc15 : SELECT_COLOR, alpha: 0.3 });
      g.circle(x, y, r).fill({ color: NODE_COLORS[n.type] ?? 0xd4d4d4 }).stroke({ width: (sel ? 2.5 : 1.8) * px, color: sel ? 0x2563eb : 0x111827 });
    }
  }

  private drawMarkers(g: Graphics, m: OverlayModel, px: number, P: (p: Vec2) => [number, number]) {
    const mk = m.markers!;
    for (const id of mk.nodeIds) {
      const n = m.graph.nodes.find((x) => x.id === id);
      if (!n) continue;
      const [x, y] = P(n);
      const hov = id === mk.hoverId, tgt = id === mk.targetId;
      if (!m.preview && !hov && !tgt) continue; // full overlay already draws every node
      g.circle(x, y, (hov ? 11 : tgt ? 10 : 6) * px).fill({ color: tgt ? 0xfde047 : 0xffffff, alpha: hov || tgt ? 0.35 : 0.0 })
        .stroke({ width: (hov || tgt ? 2.5 : 1.5) * px, color: tgt ? 0xfde047 : 0xffffff, alpha: hov || tgt ? 1 : 0.55 });
    }
  }

  // --- characters (procedural placeholder: no asset required) ---------------------------------
  private drawCharacters() {
    const g = this.charGfx;
    g.clear();
    if (!this.chars.length) return;
    const t = performance.now() / 1000;
    const H = this.envH, W = this.envW;
    for (const c of this.chars) {
      const h = c.height * H, w = c.width * H;
      const cx = c.x * W, cy = c.y * H;
      const col = parseInt(c.color.replace('#', ''), 16) || 0x4f8cff;
      const f = c.facing;
      const walk = c.state === 'WALK', climb = c.state === 'CLIMB';
      const phase = Math.sin(t * (walk ? 11 : 7));
      const bob = walk ? Math.abs(phase) * h * 0.035 : c.state === 'IDLE' ? Math.sin(t * 2) * h * 0.01 : phase * h * 0.015;
      const sway = climb ? phase * w * 0.12 : 0;

      if (c.shadow) g.ellipse(cx, cy, w * 0.55, Math.max(2, h * 0.05)).fill({ color: 0x000000, alpha: 0.35 });
      const hipY = cy - h * 0.34 - bob * 0.3;
      // legs
      const stride = walk ? phase * w * 0.3 : climb ? phase * w * 0.18 : 0;
      g.moveTo(cx - w * 0.15 + sway, hipY).lineTo(cx - w * 0.15 + stride * f, cy - (climb ? Math.max(0, -phase) * h * 0.08 : 0))
        .stroke({ width: Math.max(2, w * 0.16), color: 0x111827, cap: 'round' });
      g.moveTo(cx + w * 0.15 + sway, hipY).lineTo(cx + w * 0.15 - stride * f, cy - (climb ? Math.max(0, phase) * h * 0.08 : 0))
        .stroke({ width: Math.max(2, w * 0.16), color: 0x111827, cap: 'round' });
      // body + head
      g.roundRect(cx - w * 0.32 + sway, cy - h * 0.78 - bob, w * 0.64, h * 0.46, w * 0.2).fill({ color: col }).stroke({ width: Math.max(1.5, w * 0.05), color: 0x0b0f19, alpha: 0.85 });
      g.circle(cx + sway, cy - h * 0.87 - bob, h * 0.13).fill({ color: 0xf3d3b5 }).stroke({ width: Math.max(1.5, w * 0.05), color: 0x0b0f19, alpha: 0.85 });
      g.circle(cx + sway + f * h * 0.06, cy - h * 0.88 - bob, Math.max(1.2, h * 0.02)).fill({ color: 0x111827 });
      if (c.selected) g.ellipse(cx, cy, w * 0.8, Math.max(3, h * 0.09)).stroke({ width: 2 / this.zoom, color: 0xffffff, alpha: 0.9 });
    }
  }
}
