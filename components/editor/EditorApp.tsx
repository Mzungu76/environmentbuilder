'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { EditorStore, type ToolId } from '@/lib/store/editorStore';
import { loadProject, saveProject, getAsset } from '@/lib/persistence/db';
import { migrateProject } from '@/lib/serialization/migrations';
import { createProject } from '@/lib/serialization/factory';
import { importBackground } from '@/lib/import-export/background';
import { downloadBlob, exportProjectJson, exportProjectZip, safeFileName } from '@/lib/import-export/archive';
import { ACCEPTED_IMAGE_TYPES } from '@/lib/import-export/image';
import { SceneCanvas, type SceneHandle } from '@/components/scene/SceneCanvas';
import { TopBar } from '@/components/toolbar/TopBar';
import { TOOLS, ToolPalette } from '@/components/toolbar/ToolPalette';
import { PlaytestPanel } from '@/components/panels/PlaytestPanel';
import { PlaytestController } from '@/engine/simulation/PlaytestController';
import { Inspector } from '@/components/inspector/Inspector';
import { Icon } from '@/components/ui/icons';
import styles from './editor.module.css';

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; store: EditorStore };

export function EditorApp({ projectId }: { projectId: string | null }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!projectId) { setLoad({ status: 'error', message: 'Nessun progetto selezionato.' }); return; }
      try {
        const raw = await loadProject(projectId);
        if (!raw) throw new Error('Progetto non trovato in questo browser.');
        if (alive) setLoad({ status: 'ready', store: new EditorStore(migrateProject(raw)) });
      } catch (e) {
        if (alive) setLoad({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  if (load.status === 'loading') return <div className={styles.center}>Caricamento progetto…</div>;
  if (load.status === 'error') return <div className={styles.center}><div><p>{load.message}</p><Link href="/" className={styles.btn}>Torna alla libreria</Link></div></div>;
  return <Editor store={load.store} />;
}

function Editor({ store }: { store: EditorStore }) {
  const router = useRouter();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const env = store.env;
  const handle = useRef<SceneHandle | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [zoom, setZoom] = useState(1);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [ctrl, setCtrl] = useState<PlaytestController | null>(null);
  const ctrlRef = useRef<PlaytestController | null>(null);
  ctrlRef.current = ctrl;
  const playtest = state.mode === 'playtest';

  // Playtest lifecycle: the controller owns the pointer/tick while active and restores the editor on exit.
  useEffect(() => {
    if (!playtest || !sceneReady || !handle.current) return;
    const c = new PlaytestController(store, handle.current.view, handle.current.editor);
    setCtrl(c);
    return () => { c.dispose(); setCtrl(null); };
  }, [playtest, sceneReady, store]);

  // --- missing assets check (after load) ---
  useEffect(() => {
    let alive = true;
    (async () => {
      const missing: string[] = [];
      for (const a of store.env.assets) if (!(await getAsset(store.project.id, a.id))) missing.push(a.fileName);
      if (alive && missing.length) setNotice(`Dati immagine mancanti per: ${missing.join(', ')}. Reimporta l’immagine per ripristinare lo sfondo.`);
    })();
    return () => { alive = false; };
  }, [store]);

  // --- flush on leave ---
  useEffect(() => {
    const flush = () => { if (store.getState().saveStatus !== 'saved') void store.save(); };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('beforeunload', flush); document.removeEventListener('visibilitychange', onVis); flush(); store.dispose(); };
  }, [store]);

  const importFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try { await importBackground(store, file); setNotice(null); }
    catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [store]);

  const setTool = useCallback((t: ToolId) => store.setTool(t), [store]);

  // --- keyboard shortcuts ---
  useEffect(() => {
    let spaceHeld = false;
    const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (store.getState().mode === 'playtest') {
        if (e.key === ' ') { e.preventDefault(); ctrlRef.current?.togglePlay(); }
        else if (e.key.toLowerCase() === 'f') handle.current?.view.fit();
        else if (e.key === '+' || e.key === '=') handle.current?.view.zoomCenter(1.25);
        else if (e.key === '-') handle.current?.view.zoomCenter(0.8);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); store.redo(); return; }
      if (mod && k === 's') { e.preventDefault(); void store.save(); return; }
      if (mod || e.altKey) return;
      if (e.key === ' ' && !spaceHeld) { spaceHeld = true; if (handle.current) handle.current.view.panMode = true; e.preventDefault(); return; }
      const tool = TOOLS.find((t) => t.key.toLowerCase() === k);
      if (tool) { setTool(tool.id); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { handle.current?.editor.deleteSelection(); e.preventDefault(); }
      else if (e.key === 'Escape') { handle.current?.editor.cancelPending(); store.setSelection(null); if (store.getState().tool === 'path' || store.getState().tool === 'connect') store.setTool('select'); }
      else if (k === 'f') handle.current?.view.fit();
      else if (k === 'o') store.setPreview(!store.getState().preview);
      else if (k === '+' || k === '=') handle.current?.view.zoomCenter(1.25);
      else if (k === '-') handle.current?.view.zoomCenter(0.8);
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ') { spaceHeld = false; if (handle.current) handle.current.view.panMode = store.getState().tool === 'pan'; } };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [store, setTool]);

  const onNew = async () => { const p = createProject(); await saveProject(p); router.push(`/editor?id=${p.id}`); };
  const onExportZip = async () => {
    try { await store.save(); downloadBlob(await exportProjectZip(store.project), `${safeFileName(store.project.name)}.ebproj.zip`); }
    catch (e) { setNotice(`Esportazione non riuscita: ${e instanceof Error ? e.message : e}`); }
  };
  const onExportJson = () => downloadBlob(exportProjectJson(store.project), `${safeFileName(store.project.name)}.json`);

  const hasImage = env.layers.some((l) => l.role === 'background');
  const toolInfo = TOOLS.find((t) => t.id === state.tool)!;
  const onAssetError = useCallback((id: string, msg: string) => setNotice(`Impossibile caricare l’immagine (${id}): ${msg}`), []);
  const stableOnReady = useCallback((h: SceneHandle | null) => { handle.current = h; setSceneReady(!!h); }, []);
  const memoEnvName = useMemo(() => env.name, [env.name]);

  return (
    <div className={styles.app}>
      <TopBar
        state={state} envName={memoEnvName}
        onProjectName={(n) => store.commitProject((p) => ({ ...p, name: n }))}
        onEnvName={(n) => store.commitEnv((e) => ({ ...e, name: n }))}
        onNew={onNew} onSave={() => void store.save()} onUndo={() => store.undo()} onRedo={() => store.redo()}
        onExportZip={onExportZip} onExportJson={onExportJson} onToggleInspector={() => setInspectorOpen((o) => !o)}
        onMode={(m) => store.setMode(m)} canPlaytest={hasImage}
      />
      <div className={`${styles.main} ${playtest ? styles.mainPlay : ''}`}>
        {!playtest && <ToolPalette tool={state.tool} onTool={setTool} />}
        <div className={styles.stageWrap}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); void importFile(e.dataTransfer.files[0]); }}>
          <SceneCanvas store={store} onReady={stableOnReady} onZoom={setZoom} onAssetError={onAssetError} />
          {!hasImage && (
            <div className={styles.empty}>
              <div className={`${styles.dropzone} ${dragOver ? styles.dragOver : ''}`}>
                {Icon.image}
                <h2>Importa l’illustrazione dell’ambiente</h2>
                <p>Trascina qui un PNG, JPG o WebP. Diventa il fondale statico; poi disegnerai sopra i percorsi percorribili.</p>
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => fileInput.current?.click()} disabled={busy} data-testid="import-image">{busy ? 'Importazione…' : 'Scegli immagine…'}</button>
              </div>
            </div>
          )}
          {hasImage && !state.preview && !playtest && <div className={styles.hint}>{toolInfo.hint}</div>}
          {notice && <div className={styles.banner} role="alert">{notice}<button onClick={() => setNotice(null)}>Chiudi</button></div>}
          <div className={styles.hud}>
            <button className={`${styles.btn} ${styles.iconBtn}`} onClick={() => handle.current?.view.zoomCenter(0.8)} aria-label="Riduci" title="Riduci (-)">{Icon.minus}</button>
            <span className={styles.zoomLabel} data-testid="zoom">{Math.round(zoom * 100)}%</span>
            <button className={`${styles.btn} ${styles.iconBtn}`} onClick={() => handle.current?.view.zoomCenter(1.25)} aria-label="Ingrandisci" title="Ingrandisci (+)">{Icon.plus}</button>
            <button className={`${styles.btn} ${styles.iconBtn}`} onClick={() => handle.current?.view.fit()} aria-label="Adatta alla finestra" title="Adatta alla finestra (F)">{Icon.fit}</button>
            {!playtest && <button className={`${styles.btn} ${styles.iconBtn}`} aria-pressed={state.preview} onClick={() => store.setPreview(!state.preview)} aria-label="Anteprima senza strumenti" title="Anteprima senza strumenti (O)" style={state.preview ? { borderColor: 'var(--accent)' } : undefined} data-testid="preview">{state.preview ? Icon.eyeOff : Icon.eye}</button>}
          </div>
        </div>
        {playtest ? (ctrl && <PlaytestPanel store={store} env={env} ctrl={ctrl} showPaths={state.showPaths} open={inspectorOpen} />) : <Inspector store={store} env={env} selection={state.selection} revision={state.revision} open={inspectorOpen}
          onFit={() => handle.current?.view.fit()} onReplaceImage={() => fileInput.current?.click()}
          onToggleCurve={(id) => handle.current?.editor.toggleCurve(id)} onDeleteSelection={() => handle.current?.editor.deleteSelection()} />}
      </div>
      <input ref={fileInput} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden data-testid="file-input"
        onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
