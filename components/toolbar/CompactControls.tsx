'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { EditorState, EditorStore, ToolId } from '@/lib/store/editorStore';
import { Icon } from '@/components/ui/icons';
import { TOOLS } from './ToolPalette';
import { NameField } from './TopBar';
import { FullscreenButton, InstallButton } from '@/components/shell/pwa';
import { EnvTabs } from '@/components/panels/EnvTabs';
import styles from '../editor/editor.module.css';

/** Tools always on screen; the rest live behind “…”. */
const MAIN_TOOLS: ToolId[] = ['select', 'node', 'path', 'object'];

interface Props {
  store: EditorStore;
  state: EditorState;
  envName: string;
  envId: string;
  canPlaytest: boolean;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onLayers: () => void;
  onNew: () => void;
  onExportZip: () => void;
  onExportJson: () => void;
  onExportGame: () => void;
}

/**
 * Smartphone-in-landscape chrome: no bars, round floating buttons over the scene.
 * The properties panel splits the stage instead of covering it (see `.compact` in editor.module.css).
 */
export function CompactControls(p: Props) {
  const { state, store } = p;
  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false);
  const playtest = state.mode === 'playtest';
  const pick = (t: ToolId) => { store.setTool(t); setMore(false); };
  const mainTools = TOOLS.filter((t) => MAIN_TOOLS.includes(t.id));
  const moreTools = TOOLS.filter((t) => !MAIN_TOOLS.includes(t.id));
  const activeHidden = moreTools.some((t) => t.id === state.tool);
  const st = state.saveStatus;
  const statusText = st === 'saved' ? 'Salvato' : st === 'dirty' ? 'Modifiche non salvate' : st === 'saving' ? 'Salvataggio…' : 'Salvataggio non riuscito';
  const dotCls = st === 'dirty' ? styles.dotDirty : st === 'error' ? styles.dotError : st === 'saving' ? styles.dotSaving : '';

  return (
    <>
      <div className={styles.cTopLeft}>
        <button className={styles.cRound} onClick={() => setMenu(true)} aria-label="Menu" data-testid="c-menu">{Icon.menu}</button>
        <button className={styles.cPill} onClick={() => setMenu(true)} aria-label="Cambia ambiente" data-testid="c-env"><span className={`${styles.dot} ${dotCls}`} />{p.envName}{Icon.down}</button>
      </div>

      <div className={styles.cTopRight}>
        {!playtest && <button className={styles.cRound} onClick={() => store.undo()} disabled={!state.canUndo} aria-label="Annulla" data-testid="undo">{Icon.undo}</button>}
        <button className={`${styles.cRound} ${styles.cPlay}`} onClick={() => store.setMode(playtest ? 'editor' : 'playtest')} disabled={!playtest && !p.canPlaytest}
          aria-label={playtest ? 'Esci dal Playtest' : 'Prova'} title={p.canPlaytest || playtest ? undefined : 'Importa prima un’immagine'} data-testid="c-play">{playtest ? Icon.stop : Icon.play}</button>
        <button className={styles.cRound} aria-pressed={p.panelOpen} onClick={p.onTogglePanel} aria-label={p.panelOpen ? 'Chiudi pannello' : 'Apri pannello'} data-testid="c-panel">{p.panelOpen ? Icon.close : Icon.sliders}</button>
      </div>

      {!playtest && !state.preview && (
        <nav className={styles.cTools} aria-label="Strumenti">
          {mainTools.map((t) => (
            <button key={t.id} className={styles.cRound} aria-pressed={state.tool === t.id} aria-label={`${t.label} (${t.key})`} onClick={() => pick(t.id)} data-testid={`tool-${t.id}`}>{Icon[t.icon]}</button>
          ))}
          <button className={styles.cRound} aria-pressed={activeHidden || more} aria-expanded={more} aria-label="Altri strumenti" onClick={() => setMore((m) => !m)} data-testid="tool-more">
            {activeHidden && !more ? Icon[TOOLS.find((t) => t.id === state.tool)!.icon] : Icon.more}
          </button>
          {more && (
            <div className={styles.cMore} role="group" aria-label="Altri strumenti">
              {moreTools.map((t) => (
                <button key={t.id} className={`${styles.cRound} ${styles.cLabeled}`} aria-pressed={state.tool === t.id} onClick={() => (t.id === 'select' ? pick(t.id) : pick(t.id))} data-testid={`tool-${t.id}`}>{Icon[t.icon]}<span>{t.label}</span></button>
              ))}
              <button className={`${styles.cRound} ${styles.cLabeled}`} onClick={() => { setMore(false); p.onLayers(); }} data-testid="tool-layers">{Icon.layers}<span>Livelli</span></button>
            </div>
          )}
        </nav>
      )}

      {menu && (
        <>
          <div className={styles.cScrim} onClick={() => setMenu(false)} />
          <div className={styles.cMenu} role="dialog" aria-label="Menu progetto" data-testid="c-menu-sheet">
            <div className={styles.cMenuHead}>
              <NameField className={styles.projectName} value={state.project.name} onCommit={(n) => store.commitProject((pr) => ({ ...pr, name: n }))} label="Nome progetto" />
              <span className={styles.status} role="status" title={state.saveError ?? undefined}><span className={`${styles.dot} ${dotCls}`} />{statusText}</span>
              <button className={`${styles.btn} ${styles.iconBtn}`} onClick={() => setMenu(false)} aria-label="Chiudi menu">{Icon.close}</button>
            </div>
            <EnvTabs store={store} envs={state.project.environments} activeId={p.envId} locked={playtest} />
            <div className={styles.cMenuGrid}>
              <button className={styles.btn} onClick={() => void store.save()} data-testid="save">{Icon.save}Salva</button>
              <button className={styles.btn} onClick={() => store.redo()} disabled={!state.canRedo} data-testid="redo">{Icon.redo}Ripeti</button>
              <button className={styles.btn} aria-pressed={state.preview} onClick={() => { store.setPreview(!state.preview); setMenu(false); }} data-testid="preview">{state.preview ? Icon.eyeOff : Icon.eye}Anteprima</button>
              <button className={styles.btn} onClick={() => { setMenu(false); p.onExportZip(); }} data-testid="export-zip">{Icon.export}Esporta ZIP</button>
              <button className={styles.btn} onClick={() => { setMenu(false); p.onExportJson(); }} data-testid="export-json">{Icon.export}Esporta JSON</button>
              <button className={styles.btn} onClick={() => { setMenu(false); p.onExportGame(); }} data-testid="export-game">{Icon.export}Pacchetto per il gioco</button>
              <InstallButton className={styles.btn} />
              <FullscreenButton className={styles.btn} />
              <button className={styles.btn} onClick={p.onNew}>{Icon.plus}Nuovo progetto</button>
              <Link href="/" className={styles.btn}>{Icon.folder}Apri progetto</Link>
              <Link href="/manuale" target="_blank" rel="noreferrer" className={styles.btn} data-testid="open-manual">{Icon.help}Manuale</Link>
            </div>
          </div>
        </>
      )}
    </>
  );
}
