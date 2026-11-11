import type { Environment, Project } from '@/types';
import { saveProject } from '@/lib/persistence/db';

export type ToolId = 'select' | 'pan' | 'node' | 'connect' | 'path' | 'character';
export type EditorMode = 'editor' | 'playtest';
export type Selection = { kind: 'node' | 'edge' | 'character'; id: string } | null;
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export interface EditorState {
  project: Project;
  tool: ToolId;
  selection: Selection;
  preview: boolean;
  mode: EditorMode;
  /** Playtest only: draw the design paths/nodes over the scene. */
  showPaths: boolean;
  saveStatus: SaveStatus;
  saveError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Increments on every document change (used by views to know when to redraw). */
  revision: number;
}

const HISTORY_LIMIT = 150;

/**
 * Single source of truth for the editor. Project snapshots are immutable, so history is
 * just an array of references (structural sharing keeps it cheap).
 *
 * Gesture protocol (dragging etc.): call `checkpoint()` once, then `update*()` many times.
 * One-shot edits: `commit*()` = checkpoint + update.
 */
export class EditorStore {
  private state: EditorState;
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;

  constructor(project: Project) {
    this.state = {
      project, tool: 'select', selection: null, preview: false, mode: 'editor', showPaths: false,
      saveStatus: 'saved', saveError: null, canUndo: false, canRedo: false, revision: 0,
    };
  }

  // --- subscription (useSyncExternalStore-compatible) -------------------------------------
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getState = () => this.state;
  private set(patch: Partial<EditorState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((l) => l()); }

  // --- accessors --------------------------------------------------------------------------
  get project() { return this.state.project; }
  get env(): Environment {
    const p = this.state.project;
    return p.environments.find((e) => e.id === p.activeEnvironmentId) ?? p.environments[0];
  }

  // --- UI state ---------------------------------------------------------------------------
  setTool(tool: ToolId) { this.set({ tool }); }
  setSelection(selection: Selection) { this.set({ selection }); }
  setPreview(preview: boolean) { this.set({ preview }); }
  setShowPaths(showPaths: boolean) { this.set({ showPaths }); }
  /** Switching mode never touches the document: edits made before a playtest are kept. */
  setMode(mode: EditorMode) { this.set({ mode, selection: mode === 'playtest' ? null : this.state.selection, preview: false }); }

  // --- document mutation ------------------------------------------------------------------
  checkpoint() {
    this.undoStack.push(this.state.project);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.set({ canUndo: true, canRedo: false });
  }

  updateProject(fn: (p: Project) => Project) {
    const next = fn(this.state.project);
    if (next === this.state.project) return;
    this.set({ project: { ...next, updatedAt: Date.now() }, saveStatus: 'dirty', revision: this.state.revision + 1 });
    this.scheduleSave();
  }

  updateEnv(fn: (e: Environment) => Environment) {
    const id = this.env.id;
    this.updateProject((p) => ({ ...p, environments: p.environments.map((e) => (e.id === id ? fn(e) : e)) }));
  }

  commitProject(fn: (p: Project) => Project) { this.checkpoint(); this.updateProject(fn); }
  commitEnv(fn: (e: Environment) => Environment) { this.checkpoint(); this.updateEnv(fn); }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.state.project);
    this.restore(prev);
  }
  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.state.project);
    this.restore(next);
  }
  private restore(p: Project) {
    const env = p.environments.find((e) => e.id === p.activeEnvironmentId) ?? p.environments[0];
    const sel = this.state.selection;
    const stillValid = sel && (sel.kind === 'node' ? env.navigation.nodes.some((n) => n.id === sel.id)
      : sel.kind === 'edge' ? env.navigation.edges.some((e) => e.id === sel.id) : env.characters.some((c) => c.id === sel.id));
    this.set({
      project: { ...p, updatedAt: Date.now() }, selection: stillValid ? sel : null, saveStatus: 'dirty',
      canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, revision: this.state.revision + 1,
    });
    this.scheduleSave();
  }

  // --- persistence ------------------------------------------------------------------------
  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.save(); }, 800);
  }

  /** Saves now (manual save and autosave share this path). */
  async save(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.saving) await this.saving;
    const snapshot = this.state.project;
    this.set({ saveStatus: 'saving', saveError: null });
    this.saving = saveProject(snapshot)
      .then(() => { this.set({ saveStatus: this.state.project === snapshot ? 'saved' : 'dirty' }); })
      .catch((err) => { this.set({ saveStatus: 'error', saveError: err instanceof Error ? err.message : String(err) }); })
      .finally(() => { this.saving = null; });
    await this.saving;
  }

  dispose() { if (this.saveTimer) clearTimeout(this.saveTimer); }
}
