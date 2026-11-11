import type { Vec2 } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import type { SceneView, ViewPointerEvent } from '@/engine/rendering/SceneView';
import { hitTest } from '@/engine/navigation/hit';
import { clamp01 } from '@/engine/navigation/geometry';
import { addObject, createObject, nearestNodeId, removeObject, updateObject } from './objects';

type Drag = { kind: 'move'; id: string; grab: Vec2; moved: boolean; start: Vec2 } | { kind: 'resize'; id: string; moved: boolean } | null;

/**
 * Object & Interaction Editor: placement, moving, resizing and deleting of interactive objects.
 * Independent from the navigation tools; SceneController decides which editor receives an event.
 */
export class ObjectEditor {
  private drag: Drag = null;
  constructor(private store: EditorStore, private view: SceneView) {}

  /** Returns true when the event was consumed (so the navigation editor must ignore it). */
  handle(e: ViewPointerEvent): boolean {
    const env = this.store.env;
    if (!env.width || !env.height) return false;
    const tool = this.store.getState().tool;

    if (this.drag) {
      if (e.type === 'move') this.updateDrag(e); else if (e.type === 'up' || e.type === 'cancel') this.drag = null;
      return true;
    }
    if (e.type !== 'down' || e.button !== 0) return tool === 'object';

    const sel = this.store.getState().selection;
    const h = hitTest(e.pos, {
      graph: env.navigation, envW: env.width, envH: env.height, pxPerScreenPx: this.view.pxPerScreenPx,
      objects: env.objects, selectedObjectId: sel?.kind === 'object' ? sel.id : null, tolerance: e.pointerType === 'mouse' ? 10 : 22,
    });

    if (h?.kind === 'objhandle') { this.drag = { kind: 'resize', id: h.id, moved: false }; return true; }
    if (h?.kind === 'object' && (tool === 'select' || tool === 'object')) {
      const o = env.objects.find((x) => x.id === h.id)!;
      this.store.setSelection({ kind: 'object', id: o.id });
      this.drag = { kind: 'move', id: o.id, grab: { x: e.pos.x - o.position.x, y: e.pos.y - o.position.y }, moved: false, start: e.screen };
      return true;
    }
    if (tool !== 'object') return false;

    // place a new object of the chosen type
    if (e.pos.x < 0 || e.pos.x > 1 || e.pos.y < 0 || e.pos.y > 1) return true;
    const type = this.store.getState().objectType;
    const o = createObject(type, e.pos, env.objects.filter((x) => x.type === type).length);
    if (type === 'entrance' || type === 'exit') {
      o.linkedNodeId = nearestNodeId(env, e.pos, 60 * this.view.pxPerScreenPx);
      o.position = { x: o.position.x, y: clamp01(e.pos.y - o.height / 2) }; // doors stand on the clicked point (their base), leaving the node selectable
    }
    this.store.commitEnv((en) => addObject(en, o));
    this.store.setSelection({ kind: 'object', id: o.id });
    return true;
  }

  deleteSelected() {
    const sel = this.store.getState().selection;
    if (sel?.kind !== 'object') return;
    this.store.commitEnv((en) => removeObject(en, sel.id));
    this.store.setSelection(null);
  }

  private updateDrag(e: ViewPointerEvent) {
    const d = this.drag!;
    const env = this.store.env;
    const o = env.objects.find((x) => x.id === d.id);
    if (!o) { this.drag = null; return; }
    if (!d.moved) {
      if (d.kind === 'move' && Math.hypot(e.screen.x - d.start.x, e.screen.y - d.start.y) < 3) return;
      d.moved = true; this.store.checkpoint();
    }
    if (d.kind === 'move') {
      const x = clamp01(e.pos.x - d.grab.x), y = clamp01(e.pos.y - d.grab.y);
      this.store.updateEnv((en) => updateObject(en, d.id, { position: { x, y } }));
    } else {
      const halfW = Math.max(4, (e.pos.x - o.position.x) * env.width), halfH = Math.max(4, (e.pos.y - o.position.y) * env.height);
      let w = (halfW * 2) / env.height, h = (halfH * 2) / env.height;
      if (o.assetId || e.shift) { const f = Math.max(w / o.width, h / o.height); w = o.width * f; h = o.height * f; }
      this.store.updateEnv((en) => updateObject(en, d.id, { width: Math.min(1, Math.max(0.01, w)), height: Math.min(1, Math.max(0.01, h)) }));
    }
  }
}
