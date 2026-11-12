import type { EditorStore } from '@/lib/store/editorStore';
import type { PlaytestMarkers, SceneView, ViewPointerEvent } from '@/engine/rendering/SceneView';
import { NavigationEditor } from '@/engine/navigation/NavigationEditor';
import { ObjectEditor } from '@/engine/interaction/ObjectEditor';
import { OccluderEditor } from '@/engine/navigation/OccluderEditor';
import { ZoneEditor } from '@/engine/navigation/ZoneEditor';

/**
 * Routes pointer input to the right editor module (objects first, then navigation) and exposes the
 * small API the UI and the playtest need. The two editors never call each other.
 */
export class SceneController {
  readonly nav: NavigationEditor;
  readonly objects: ObjectEditor;
  readonly zones: ZoneEditor;
  readonly occluders: OccluderEditor;

  constructor(private store: EditorStore, private view: SceneView) {
    this.nav = new NavigationEditor(store, view);
    this.objects = new ObjectEditor(store, view);
    this.zones = new ZoneEditor(store, view);
    this.occluders = new OccluderEditor(store, view);
    this.attach();
  }

  /** (Re)claims pointer input for the editor tools (playtest releases and restores it). */
  attach() { this.view.onPointer = (e) => this.route(e); }

  private route(e: ViewPointerEvent) {
    const s = this.store.getState();
    if (s.mode === 'playtest' || s.preview) return;
    if (this.zones.handle(e)) return;
    if (this.occluders.handle(e)) return;
    if (this.objects.handle(e)) { this.nav.refresh(); return; }
    this.nav.handle(e);
  }

  get markers(): PlaytestMarkers | null { return this.nav.markers; }
  set markers(m: PlaytestMarkers | null) { this.nav.markers = m; }
  refresh() { this.nav.refresh(); }
  cancelPending() { this.nav.cancelPending(); }
  toggleCurve(id: string) { this.nav.toggleCurve(id); }
  deleteSelection() {
    if (this.store.getState().selection?.kind === 'object') this.objects.deleteSelected(); else this.nav.deleteSelection();
    this.nav.refresh();
  }
  dispose() { this.zones.dispose(); this.occluders.dispose(); this.nav.dispose(); }
}
