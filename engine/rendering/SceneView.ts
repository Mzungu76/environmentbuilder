import { Application, BlurFilter, ColorMatrixFilter, Container, Graphics, MeshSimple, Rectangle, Sprite, Texture } from 'pixi.js';
import type { SpriteDraw } from '@/engine/characters/sprites';
import type { DollShape } from '@/engine/doll/shapes';
import type { CharacterLook, CharacterState, InteractiveObject, NavigationGraph, SceneLayer, Vec2 } from '@/types';
import { objectTypeInfo } from '@/engine/interaction/objects';
import { EDGE_COLOR } from '@/engine/movement/movementTypes';
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
  /** Interactive objects and which one is selected (design markers are drawn only with the overlay). */
  objects?: InteractiveObject[];
  selectedObjectId?: string | null;
}

export interface ObjectSource { object: InteractiveObject; blobLoader: () => Promise<Blob | undefined> }

/** Destination markers / route highlight used by the playtest (drawn even when the editor overlay is hidden). */
export interface PlaytestMarkers {
  nodeIds: string[];
  hoverId: string | null;
  targetId: string | null;
  routeEdgeIds: string[];
}

/** A rigged character frame: skinned vertices in cut-out pixels + the static mesh data. */
export interface PuppetDraw {
  assetId: string;
  positions: Float32Array;
  uvs: number[];
  indices: number[];
  pivot: { x: number; y: number };
  figureHeight: number;
  flip: boolean;
  viewKey: string;
  /** Key-pose playback: the neighbouring key drawn on top, cross-faded. */
  over?: Omit<PuppetDraw, 'over' | 'flip' | 'attachments'> & { alpha: number };
  /** Tools / objects held by the character. */
  attachments?: { id: string; assetId: string; positions: Float32Array; uvs: number[]; indices: number[]; front: boolean }[];
}

/** A procedural "omino" frame: posed shapes in doll units (feet at the origin, 1000 tall). */
export interface DollDraw { shapes: DollShape[]; outline: string; outlineWidth: number; flip: boolean }

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
  /** Visual lift in px (jump arcs). */
  lift: number;
  sprite: SpriteDraw | null;
  /** Seconds since the state started; ignored when `liveClock` (editor: idle animation plays on its own). */
  stateTime: number;
  liveClock: boolean;
  puppet?: PuppetDraw | null;
  doll?: DollDraw | null;
  look?: CharacterLook;
}

export interface LayerSource { layer: SceneLayer; blobLoader: () => Promise<Blob | undefined> }

const NODE_COLORS: Record<string, number> = {
  waypoint: 0xffffff, junction: 0xfacc15, endpoint: 0xf87171, platform: 0x60a5fa, entrance: 0x22c55e, exit: 0xef4444,
};
const SELECT_COLOR = 0xffffff;
const HANDLE_COLOR = 0xfde047;

export class SceneView {
  private app!: Application;
  private world = new Container();
  private zoneSprite: Sprite | null = null;
  private zoneTex: Texture | null = null;
  private brushGfx = new Graphics();
  private bgRoot = new Container();   // background + midground
  private objRoot = new Container();  // object images (below characters)
  private fgRoot = new Container();   // foreground (above characters)
  private objSprites = new Map<string, Sprite>();
  /** Objects consumed at runtime (e.g. collected in the playtest): hidden but still part of the document. */
  private hiddenObjects = new Set<string>();
  private loading = new Map<string, Promise<Texture | null>>();
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
  private objVersion = 0;
  private destroyed = false;
  private resizeObs?: ResizeObserver;
  private charGfx = new Graphics();
  private chars: CharacterRenderItem[] = [];
  private charRoot = new Container();
  private charSprites = new Map<string, Sprite>();
  private puppetMeshes = new Map<string, { mesh: MeshSimple; key: string }>();
  private typed = new WeakMap<object, Float32Array | Uint32Array>();
  private frameTex = new Map<string, Texture>();
  /** Loads the binary of an image asset (set by the host component). */
  assetLoader: (assetId: string) => Promise<Blob | undefined> = async () => undefined;

  /** When true, single-pointer drag pans the camera (pan tool / space held). */
  panMode = false;
  /** True while the camera is still the one set by fit(): a window resize then re-fits instead of just re-centring. */
  private autoFit = false;
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
    this.world.addChild(this.bgRoot, this.objRoot, this.charRoot, this.charGfx, this.fgRoot, this.overlay, this.brushGfx);
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
      // browser bars and fullscreen change the size without a reliable window 'resize': always resync the canvas
      this.app?.resize();
      if (this.autoFit && this.envW && this.envH) this.fit();
      else if (lastW && lastH) this.world.position.set(this.world.x + (w - lastW) / 2, this.world.y + (h - lastH) / 2);
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

  /** Texture cache keyed by asset id (shared by layers and objects); concurrent loads are de-duplicated. */
  private texture(assetId: string, loader: () => Promise<Blob | undefined>): Promise<Texture | null> {
    const cached = this.textures.get(assetId);
    if (cached) return Promise.resolve(cached);
    let p = this.loading.get(assetId);
    if (!p) {
      p = (async () => {
        try {
          const blob = await loader();
          if (!blob) throw new Error('dati immagine mancanti nell’archivio locale');
          const tex = Texture.from(await createImageBitmap(blob));
          // mip-mapped, trilinear sampling for big textures drawn small (characters in a wide scene). Only when the GPU can really build the
          // mip chain for this size: asking for mipmap filtering without mipmaps makes the texture "incomplete" and some phones draw nothing.
          const gl = (this.app?.renderer as unknown as { context?: { supports?: { nonPowOf2mipmaps?: boolean } } } | undefined)?.context;
          const canMip = !!(gl?.supports?.nonPowOf2mipmaps || tex.source.isPowerOfTwo) && Math.max(tex.source.pixelWidth, tex.source.pixelHeight) <= 4096;
          if (canMip) { tex.source.autoGenerateMipmaps = true; tex.source.style.scaleMode = 'linear'; tex.source.style.mipmapFilter = 'linear'; }
          this.textures.set(assetId, tex);
          return tex;
        } catch (err) {
          this.onAssetError(assetId, err instanceof Error ? err.message : String(err));
          return null;
        } finally { this.loading.delete(assetId); }
      })();
      this.loading.set(assetId, p);
    }
    return p;
  }

  /** Synchronizes layer sprites. Draw order: background/midground → objects → characters → foreground. */
  async setLayers(sources: LayerSource[]) {
    const version = ++this.layerVersion;
    const wanted = new Set(sources.map((s) => s.layer.id));
    for (const [id, sp] of this.sprites) if (!wanted.has(id)) { sp.destroy(); this.sprites.delete(id); }

    const roleOrder = { background: 0, midground: 1, foreground: 2 } as const;
    const ordered = sources.map((s, i) => ({ s, i })).sort((a, b) => roleOrder[a.s.layer.role] - roleOrder[b.s.layer.role] || a.i - b.i);
    const texs = await Promise.all(ordered.map(({ s }) => this.texture(s.layer.assetId, s.blobLoader)));
    if (this.destroyed || version !== this.layerVersion) return; // superseded by a newer call

    const counts = { bg: 0, fg: 0 };
    ordered.forEach(({ s }, k) => {
      const tex = texs[k];
      const { layer } = s;
      let sp = this.sprites.get(layer.id);
      if (!tex) { sp?.destroy(); this.sprites.delete(layer.id); return; }
      if (!sp) { sp = new Sprite(tex); this.sprites.set(layer.id, sp); } else if (sp.texture !== tex) sp.texture = tex;
      sp.visible = layer.visible; sp.alpha = layer.opacity;
      sp.position.set(layer.offsetX * this.envW, layer.offsetY * this.envH);
      const root = layer.role === 'foreground' ? this.fgRoot : this.bgRoot;
      if (sp.parent !== root) root.addChild(sp);
      root.setChildIndex(sp, layer.role === 'foreground' ? counts.fg++ : counts.bg++);
    });
    this.dirty = true;
  }

  setHiddenObjects(ids: Set<string>) {
    this.hiddenObjects = new Set(ids);
    for (const [id, sp] of this.objSprites) { const o = this.model?.objects?.find((x) => x.id === id); sp.visible = (o?.visible ?? true) && !this.hiddenObjects.has(id); }
    this.dirty = true;
  }

  /** Object images. Objects without an asset are design markers drawn by the overlay only. */
  async setObjects(sources: ObjectSource[]) {
    const withImg = sources.filter((s) => s.object.assetId);
    const wanted = new Set(withImg.map((s) => s.object.id));
    for (const [id, sp] of this.objSprites) if (!wanted.has(id)) { sp.destroy(); this.objSprites.delete(id); }
    const version = ++this.objVersion;
    const texs = await Promise.all(withImg.map((s) => this.texture(s.object.assetId!, s.blobLoader)));
    if (this.destroyed || version !== this.objVersion) return;
    withImg.forEach(({ object: o }, k) => {
      const tex = texs[k];
      let sp = this.objSprites.get(o.id);
      if (!tex) { sp?.destroy(); this.objSprites.delete(o.id); return; }
      if (!sp) { sp = new Sprite(tex); sp.anchor.set(0.5); this.objSprites.set(o.id, sp); this.objRoot.addChild(sp); } else if (sp.texture !== tex) sp.texture = tex;
      sp.visible = o.visible && !this.hiddenObjects.has(o.id);
      sp.position.set(o.position.x * this.envW, o.position.y * this.envH);
      sp.width = o.width * this.envH; sp.height = o.height * this.envH;
      this.objRoot.setChildIndex(sp, Math.min(k, this.objRoot.children.length - 1));
    });
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
    this.zoom = z; this.autoFit = true;
    this.world.scale.set(z);
    this.world.position.set((this.vw - this.envW * z) / 2, (this.vh - this.envH * z) / 2);
    this.onCamera(z); this.dirty = true;
  }

  getZoom() { return this.zoom; }

  zoomAt(factor: number, sx: number, sy: number) {
    const z = Math.min(32, Math.max(0.02, this.zoom * factor));
    const k = z / this.zoom;
    this.world.position.set(sx - (sx - this.world.x) * k, sy - (sy - this.world.y) * k);
    this.zoom = z; this.autoFit = false;
    this.world.scale.set(z);
    this.onCamera(z); this.dirty = true;
  }
  zoomCenter(factor: number) { this.zoomAt(factor, this.vw / 2, this.vh / 2); }
  /** Shows the painted scale zones as a translucent layer (editor, zones tool). Pass null to hide it. */
  setZoneCanvas(canvas: HTMLCanvasElement | null) {
    if (!canvas) { if (this.zoneSprite) this.zoneSprite.visible = false; return; }
    if (!this.zoneSprite || !this.zoneTex || this.zoneTex.source.resource !== canvas) {
      this.zoneSprite?.destroy(); this.zoneTex?.destroy(true);
      this.zoneTex = Texture.from(canvas); this.zoneSprite = new Sprite(this.zoneTex);
      this.world.addChildAt(this.zoneSprite, this.world.getChildIndex(this.overlay));
    } else this.zoneTex.source.update();
    this.zoneSprite.width = this.envW; this.zoneSprite.height = this.envH; this.zoneSprite.visible = true;
  }
  /** Brush ring in the scene (normalized centre, radius as a fraction of the image height). */
  setBrush(x: number, y: number, r: number, mode: 'paint' | 'erase' | null) {
    const g = this.brushGfx; g.clear();
    if (!mode) return;
    g.circle(x * this.envW, y * this.envH, r * this.envH).stroke({ width: 2 / this.zoom, color: mode === 'paint' ? 0xffffff : 0xff6b6b, alpha: 0.95 });
  }
  /** Camera shake (environment px): the whole scene moves by the opposite offset, without touching pan/zoom. */
  setShake(x: number, y: number) { this.world.pivot.set(x, y); }
  panBy(dx: number, dy: number) { this.autoFit = false; this.world.position.set(this.world.x + dx, this.world.y + dy); }

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
      const color = EDGE_COLOR(e.type);
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

    this.drawObjects(g, m, px, P);

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

  private drawObjects(g: Graphics, m: OverlayModel, px: number, P: (p: Vec2) => [number, number]) {
    for (const o of m.objects ?? []) {
      if (this.hiddenObjects.has(o.id)) continue;
      const [cx, cy] = P(o.position);
      const w = o.width * this.envH, h = o.height * this.envH;
      const info = objectTypeInfo(o.type);
      const sel = o.id === m.selectedObjectId;
      const alpha = o.visible ? 1 : 0.35;
      if (o.linkedNodeId) {
        const n = m.graph.nodes.find((x) => x.id === o.linkedNodeId);
        if (n) g.moveTo(cx, cy).lineTo(...P(n)).stroke({ width: 1.2 * px, color: info.color, alpha: 0.5 * alpha });
      }
      if (!o.assetId) {
        const x0 = cx - w / 2, y0 = cy - h / 2, lw = 2 * px;
        switch (o.type) {
          case 'collectible': g.poly([cx, y0, cx + w / 2, cy, cx, y0 + h, cx - w / 2, cy]).fill({ color: info.color, alpha: 0.4 * alpha }).stroke({ width: lw, color: info.color, alpha }); break;
          case 'interaction-point': g.circle(cx, cy, Math.min(w, h) / 2).fill({ color: info.color, alpha: 0.35 * alpha }).stroke({ width: lw, color: info.color, alpha }); g.circle(cx, cy, Math.min(w, h) / 6).fill({ color: info.color, alpha }); break;
          case 'observation-point': g.circle(cx, cy, Math.min(w, h) / 2).stroke({ width: lw, color: info.color, alpha }); g.circle(cx, cy, Math.min(w, h) / 4).stroke({ width: lw, color: info.color, alpha }); break;
          case 'entrance': case 'exit': {
            g.roundRect(x0, y0, w, h, w * 0.3).fill({ color: info.color, alpha: 0.3 * alpha }).stroke({ width: lw, color: info.color, alpha });
            const t = Math.min(w, h) * 0.28, dir = o.type === 'entrance' ? 1 : -1; // entrance: arrow in (down), exit: arrow out (up)
            g.poly([cx - t, cy - dir * t * 0.6, cx + t, cy - dir * t * 0.6, cx, cy + dir * t]).fill({ color: info.color, alpha });
            break;
          }
          case 'trigger': g.rect(x0, y0, w, h).fill({ color: info.color, alpha: 0.12 * alpha }).stroke({ width: lw, color: info.color, alpha: 0.9 * alpha }); break;
          default: g.roundRect(x0, y0, w, h, Math.min(w, h) * 0.15).fill({ color: info.color, alpha: 0.35 * alpha }).stroke({ width: lw, color: info.color, alpha });
        }
      } else if (!o.visible) {
        g.rect(cx - w / 2, cy - h / 2, w, h).stroke({ width: 1.5 * px, color: info.color, alpha: 0.4 });
      }
      if (sel) {
        g.rect(cx - w / 2 - 3 * px, cy - h / 2 - 3 * px, w + 6 * px, h + 6 * px).stroke({ width: 2 * px, color: 0xffffff, alpha: 0.9 });
        g.rect(cx + w / 2 - 5 * px, cy + h / 2 - 5 * px, 10 * px, 10 * px).fill({ color: 0xfde047 }).stroke({ width: 1.5 * px, color: 0x000000, alpha: 0.7 });
      }
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
  private frameTexture(base: Texture, sp: SpriteDraw, idx: number): Texture {
    const fw = sp.frameWidth ?? base.width, fh = sp.frameHeight ?? base.height;
    const cols = Math.max(1, Math.floor(base.width / fw)), rows = Math.max(1, Math.floor(base.height / fh));
    const i = Math.min(Math.max(0, idx), cols * rows - 1);
    const key = `${sp.assetId}:${fw}x${fh}:${i}`;
    let t = this.frameTex.get(key);
    if (!t) { t = new Texture({ source: base.source, frame: new Rectangle((i % cols) * fw, Math.floor(i / cols) * fh, fw, fh) }); this.frameTex.set(key, t); }
    return t;
  }

  private drawCharacters() {
    const g = this.charGfx;
    g.clear();
    const t = performance.now() / 1000;
    const H = this.envH, W = this.envW;
    const seen = new Set<string>(), seenMesh = new Set<string>();
    for (const c of this.chars) {
      const h = c.height * H, w = c.width * H;
      const cx = c.x * W, cy = c.y * H;
      const lift = c.lift;
      // --- rigged puppet (skinned mesh) when available
      if (c.puppet && this.drawPuppetMesh(g, c, cx, cy, h, w, lift)) { seenMesh.add(c.id); if (c.puppet.over) seenMesh.add(c.id + '#over'); if (c.look && c.look.halo > 0.01) seenMesh.add(c.id + '#halo'); (c.puppet.attachments ?? []).forEach((_, i) => seenMesh.add(`${c.id}#att${i}`)); continue; }
      // --- sprite (image / sprite sheet) when available; procedural placeholder otherwise
      if (c.sprite) {
        const base = this.textures.get(c.sprite.assetId);
        if (!base) void this.texture(c.sprite.assetId, () => this.assetLoader(c.sprite!.assetId));
        else {
          const st = c.liveClock ? t : c.stateTime;
          const n = c.sprite.frames.length, k = Math.floor(st * c.sprite.fps);
          const idx = c.sprite.frames[c.sprite.loop ? k % n : Math.min(k, n - 1)];
          const ft = this.frameTexture(base, c.sprite, idx);
          let sp = this.charSprites.get(c.id);
          if (!sp) { sp = new Sprite(ft); sp.anchor.set(0.5, 1); this.charSprites.set(c.id, sp); this.charRoot.addChild(sp); }
          sp.texture = ft;
          sp.scale.set((w / ft.width) * c.facing, h / ft.height);
          sp.position.set(cx, cy - lift);
          seen.add(c.id);
          if (c.shadow) g.ellipse(cx, cy, w * 0.55, Math.max(2, h * 0.05)).fill({ color: 0x000000, alpha: 0.35 });
          if (c.selected) g.ellipse(cx, cy, w * 0.8, Math.max(3, h * 0.09)).stroke({ width: 2 / this.zoom, color: 0xffffff, alpha: 0.9 });
          continue;
        }
      }
      if (c.doll) { this.drawDollShapes(g, c, cx, cy - lift, h, w, lift); continue; }
      this.drawProcedural(g, c, cx, cy, w, h, lift, t);
    }
    for (const [id, sp] of this.charSprites) if (!seen.has(id)) { sp.destroy(); this.charSprites.delete(id); }
    for (const [id, m] of this.puppetMeshes) if (!seenMesh.has(id)) { m.mesh.destroy(); this.puppetMeshes.delete(id); }
  }

  /** Draws the shapes of an "omino" (polygons, then outlines) with Pixi graphics. */
  private drawDollShapes(g: Graphics, c: CharacterRenderItem, cx: number, cy: number, h: number, w: number, lift: number) {
    const d = c.doll!, sc = h / 1000, f = d.flip ? -1 : 1;
    if (c.shadow) g.ellipse(cx, cy + lift, w * 0.55, Math.max(2, h * 0.05)).fill({ color: 0x000000, alpha: 0.35 });
    const ow = d.outlineWidth * sc;
    for (const s of d.shapes) {
      const n = s.pts.length;
      if (n < 4) continue;
      const pts = new Array<number>(n);
      for (let i = 0; i < n; i += 2) { pts[i] = cx + s.pts[i] * sc * f; pts[i + 1] = cy + s.pts[i + 1] * sc; }
      if (s.kind === 'line') { g.poly(pts, !!s.closed).stroke({ width: (s.w ?? 8) * sc, color: s.fill, cap: 'round', join: 'round' }); continue; }
      g.poly(pts, true).fill(s.fill);
      if (!s.bare && ow > 0) g.poly(pts, true).stroke({ width: ow, color: d.outline, join: 'round' });
    }
    if (c.selected) g.ellipse(cx, cy + lift, w * 0.8, Math.max(3, h * 0.09)).stroke({ width: 2 / this.zoom, color: 0xffffff, alpha: 0.9 });
  }

  /** Draws a skinned puppet with a Pixi mesh; false while its texture is still loading (placeholder is used meanwhile). */
  private drawPuppetMesh(g: Graphics, c: CharacterRenderItem, cx: number, cy: number, h: number, w: number, lift: number): boolean {
    const pd = c.puppet!, look = c.look;
    if (!this.placeMesh(c.id, pd, pd.flip, 1, cx, cy - lift, h)) return false;
    const main = this.puppetMeshes.get(c.id)!.mesh;
    this.applyLook(main, look);
    const ov = pd.over && pd.over.alpha > 0.003 ? pd.over : null;
    if (ov) {
      if (this.placeMesh(c.id + '#over', ov, pd.flip, ov.alpha, cx, cy - lift, h)) {
        const m = this.puppetMeshes.get(c.id + '#over')!.mesh; this.charRoot.addChild(m);   // always above the main layer
        this.applyLook(m, look);
      }
    }
    // tools / objects: in front of the body or behind it
    (pd.attachments ?? []).forEach((a, i) => {
      const slot = `${c.id}#att${i}`;
      if (!this.placeMesh(slot, { assetId: a.assetId, positions: a.positions, uvs: a.uvs, indices: a.indices, pivot: pd.pivot, figureHeight: pd.figureHeight, viewKey: `att:${a.assetId}:${i}` }, pd.flip, 1, cx, cy - lift, h)) return;
      const m = this.puppetMeshes.get(slot)!.mesh;
      if (a.front) this.charRoot.addChild(m);
      else { const mi = this.charRoot.getChildIndex(main); if (this.charRoot.getChildIndex(m) > mi) this.charRoot.setChildIndex(m, mi); }
    });
    // soft light halo behind the figure (separates it from busy backgrounds)
    if (look && look.halo > 0.01 && this.placeMesh(c.id + '#halo', pd, pd.flip, Math.min(1, look.halo), cx, cy - lift, h)) {
      const hm = this.puppetMeshes.get(c.id + '#halo')!.mesh;
      hm.tint = parseInt(look.haloColor.replace('#', ''), 16) || 0xffffff;
      if (!hm.filters || !(hm.filters[0] instanceof BlurFilter)) hm.filters = [new BlurFilter({ strength: 6, quality: 2, resolution: 'inherit' })];
      const mi = this.charRoot.getChildIndex(main);
      if (this.charRoot.getChildIndex(hm) > mi) this.charRoot.setChildIndex(hm, mi);
    }
    const sa = look ? look.shadow : 0.35;
    if (c.shadow) g.ellipse(cx, cy, w * 0.55, Math.max(2, h * 0.05)).fill({ color: 0x000000, alpha: sa });
    if (c.selected) g.ellipse(cx, cy, w * 0.8, Math.max(3, h * 0.09)).stroke({ width: 2 / this.zoom, color: 0xffffff, alpha: 0.9 });
    return true;
  }

  /** Brightness / contrast / saturation / ambient tint as one colour-matrix filter (removed when everything is neutral). */
  private applyLook(mesh: MeshSimple, look?: CharacterLook) {
    const neutral = !look || (Math.abs(look.brightness - 1) < 0.01 && Math.abs(look.contrast - 1) < 0.01 && Math.abs(look.saturation - 1) < 0.01 && look.tintAmount < 0.01);
    if (neutral) { if (mesh.filters && mesh.filters[0] instanceof ColorMatrixFilter) mesh.filters = null; return; }
    const key = `${look.brightness.toFixed(2)}|${look.contrast.toFixed(2)}|${look.saturation.toFixed(2)}|${look.tint}|${look.tintAmount.toFixed(2)}`;
    const holder = mesh as MeshSimple & { __lookKey?: string };
    const existing = mesh.filters && mesh.filters[0] instanceof ColorMatrixFilter ? (mesh.filters[0] as ColorMatrixFilter) : null;
    if (holder.__lookKey === key && existing) return;
    // Pixi renders a filter at resolution 1 by default: on a phone (DPR 2+) the filtered figure came out blurry. 'inherit' = the canvas resolution.
    const f = existing ?? new ColorMatrixFilter({ resolution: 'inherit' });       // reused: the light changes continuously while the character walks
    f.reset();
    f.brightness(look.brightness, false); f.contrast(look.contrast - 1, true); f.saturate(look.saturation - 1, true);
    if (look.tintAmount > 0.01) {
      const col = parseInt(look.tint.replace('#', ''), 16) || 0xffffff, r = ((col >> 16) & 255) / 255, gr = ((col >> 8) & 255) / 255, b = (col & 255) / 255, k = look.tintAmount;
      const m = f.matrix; // multiply the RGB rows by the tint, blended by the amount
      for (let row = 0; row < 3; row++) { const t = [r, gr, b][row], mix = 1 - k + k * t; for (let c2 = 0; c2 < 5; c2++) m[row * 5 + c2] *= mix; }
    }
    if (!existing) mesh.filters = [f];
    holder.__lookKey = key;
  }

  private placeMesh(slot: string, pd: Omit<PuppetDraw, 'over' | 'flip' | 'attachments'>, flip: boolean, alpha: number, x: number, y: number, h: number): boolean {
    const base = this.textures.get(pd.assetId);
    if (!base) { void this.texture(pd.assetId, () => this.assetLoader(pd.assetId)); return false; }
    const cached = (arr: number[], Ctor: typeof Float32Array | typeof Uint32Array) => { let t = this.typed.get(arr); if (!t) { t = Ctor.from(arr); this.typed.set(arr, t); } return t; };
    let entry = this.puppetMeshes.get(slot);
    if (!entry || entry.key !== pd.viewKey) {
      entry?.mesh.destroy();
      const mesh = new MeshSimple({ texture: base, vertices: new Float32Array(pd.positions), uvs: cached(pd.uvs, Float32Array) as Float32Array, indices: cached(pd.indices, Uint32Array) as Uint32Array });
      this.charRoot.addChild(mesh);
      entry = { mesh, key: pd.viewKey }; this.puppetMeshes.set(slot, entry);
    }
    const m = entry.mesh;
    m.vertices = pd.positions;
    m.alpha = alpha;
    const s = h / pd.figureHeight;
    m.pivot.set(pd.pivot.x, pd.pivot.y);
    m.scale.set(s * (flip ? -1 : 1), s);
    m.position.set(x, y);
    return true;
  }

  private drawProcedural(g: Graphics, c: CharacterRenderItem, cx: number, cy: number, w: number, h: number, lift: number, t: number) {
    {
      const col = parseInt(c.color.replace('#', ''), 16) || 0x4f8cff;
      const f = c.facing;
      const walk = c.state === 'WALK', climb = c.state === 'CLIMB', act = c.state === 'INTERACT' || c.state === 'COLLECT', air = c.state === 'JUMP' || c.state === 'FALL';
      const phase = Math.sin(t * (walk ? 11 : 7));
      const bob = walk ? Math.abs(phase) * h * 0.035 : c.state === 'IDLE' ? Math.sin(t * 2) * h * 0.01 : act ? Math.abs(Math.sin(t * 6)) * h * 0.04 : phase * h * 0.015;
      const sway = climb ? phase * w * 0.12 : 0;
      const gy = cy; // ground (shadow stays on the ground while the body is lifted)
      cy -= lift;

      if (c.shadow) g.ellipse(cx, gy, w * 0.55, Math.max(2, h * 0.05)).fill({ color: 0x000000, alpha: 0.35 });
      const hipY = cy - h * 0.34 - bob * 0.3;
      const stride = walk ? phase * w * 0.3 : climb ? phase * w * 0.18 : air ? w * 0.25 : 0;
      g.moveTo(cx - w * 0.15 + sway, hipY).lineTo(cx - w * 0.15 + stride * f, cy - (climb ? Math.max(0, -phase) * h * 0.08 : 0))
        .stroke({ width: Math.max(2, w * 0.16), color: 0x111827, cap: 'round' });
      g.moveTo(cx + w * 0.15 + sway, hipY).lineTo(cx + w * 0.15 - stride * f, cy - (climb ? Math.max(0, phase) * h * 0.08 : 0))
        .stroke({ width: Math.max(2, w * 0.16), color: 0x111827, cap: 'round' });
      g.roundRect(cx - w * 0.32 + sway, cy - h * 0.78 - bob, w * 0.64, h * 0.46, w * 0.2).fill({ color: col }).stroke({ width: Math.max(1.5, w * 0.05), color: 0x0b0f19, alpha: 0.85 });
      if (act) { // arms raised while interacting / collecting
        const up = Math.abs(Math.sin(t * 6)) * h * 0.12;
        g.moveTo(cx - w * 0.32, cy - h * 0.7 - bob).lineTo(cx - w * 0.5, cy - h * 0.82 - up).stroke({ width: Math.max(2, w * 0.12), color: col, cap: 'round' });
        g.moveTo(cx + w * 0.32, cy - h * 0.7 - bob).lineTo(cx + w * 0.5, cy - h * 0.82 - up).stroke({ width: Math.max(2, w * 0.12), color: col, cap: 'round' });
      }
      g.circle(cx + sway, cy - h * 0.87 - bob, h * 0.13).fill({ color: 0xf3d3b5 }).stroke({ width: Math.max(1.5, w * 0.05), color: 0x0b0f19, alpha: 0.85 });
      g.circle(cx + sway + f * h * 0.06, cy - h * 0.88 - bob, Math.max(1.2, h * 0.02)).fill({ color: 0x111827 });
      if (c.selected) g.ellipse(cx, gy, w * 0.8, Math.max(3, h * 0.09)).stroke({ width: 2 / this.zoom, color: 0xffffff, alpha: 0.9 });
    }
  }
}
