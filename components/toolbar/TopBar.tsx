'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { EditorState } from '@/lib/store/editorStore';
import { Icon } from '@/components/ui/icons';
import styles from '../editor/editor.module.css';

interface Props {
  state: EditorState;
  envName: string;
  onProjectName: (n: string) => void;
  onEnvName: (n: string) => void;
  onNew: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExportZip: () => void;
  onExportJson: () => void;
  onToggleInspector: () => void;
  onMode: (m: 'editor' | 'playtest') => void;
  canPlaytest: boolean;
}

function NameField({ value, onCommit, label, className }: { value: string; onCommit: (v: string) => void; label: string; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { const t = v.trim(); if (t && t !== value) onCommit(t); else setV(value); };
  return (
    <input className={`${styles.nameInput} ${className ?? ''}`} value={v} aria-label={label} title={label}
      onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value); (e.target as HTMLInputElement).blur(); } }} />
  );
}

export function TopBar(p: Props) {
  const { state } = p;
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [menu]);

  const st = state.saveStatus;
  const statusText = st === 'saved' ? 'Salvato' : st === 'dirty' ? 'Modifiche non salvate' : st === 'saving' ? 'Salvataggio…' : 'Salvataggio non riuscito';
  const dotCls = st === 'dirty' ? styles.dotDirty : st === 'error' ? styles.dotError : st === 'saving' ? styles.dotSaving : '';

  return (
    <header className={styles.top}>
      <span className={styles.brand}>Environment Builder</span>
      <NameField className={styles.projectName} value={state.project.name} onCommit={p.onProjectName} label="Nome progetto" />
      <span className={styles.hideSm} aria-hidden>/</span>
      <NameField value={p.envName} onCommit={p.onEnvName} label="Nome ambiente" />
      <span className={`${styles.sep} ${styles.hideXs}`} />
      <Link href="/" className={`${styles.btn} ${styles.hideXs}`} title="Apri progetto (libreria)"><span className={styles.hideSm}>Apri</span>{Icon.folder}</Link>
      <button className={`${styles.btn} ${styles.hideSm}`} onClick={p.onNew} title="Nuovo progetto">{Icon.plus}Nuovo</button>
      <span className={styles.spacer} />
      <span className={`${styles.status} ${styles.hideXs}`} role="status" title={state.saveError ?? undefined}><span className={`${styles.dot} ${dotCls}`} />{statusText}</span>
      <button className={`${styles.btn} ${styles.iconBtn}`} onClick={p.onUndo} disabled={!state.canUndo} title="Annulla (Ctrl+Z)" aria-label="Annulla" data-testid="undo">{Icon.undo}</button>
      <button className={`${styles.btn} ${styles.iconBtn}`} onClick={p.onRedo} disabled={!state.canRedo} title="Ripeti (Ctrl+Shift+Z)" aria-label="Ripeti" data-testid="redo">{Icon.redo}</button>
      <button className={styles.btn} onClick={p.onSave} title="Salva (Ctrl+S)" data-testid="save">{Icon.save}<span className={styles.hideSm}>Salva</span></button>
      <span className={`${styles.sep} ${styles.hideSm}`} />
      <div className={`${styles.seg} ${styles.hideSm}`} role="group" aria-label="Modalità">
        <button aria-pressed={state.mode === 'editor'} onClick={() => p.onMode('editor')} data-testid="mode-editor">Editor</button>
        <button aria-pressed={state.mode === 'playtest'} onClick={() => p.onMode('playtest')} disabled={!p.canPlaytest} title={p.canPlaytest ? 'Prova la simulazione' : 'Importa prima un’immagine'} data-testid="mode-playtest">Playtest</button>
      </div>
      <div className={styles.menuWrap} ref={wrap}>
        <button className={styles.btn} onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} data-testid="export-menu">{Icon.export}<span className={styles.hideSm}>Esporta</span></button>
        {menu && (
          <div className={styles.menu} role="menu">
            <button role="menuitem" onClick={() => { setMenu(false); p.onExportZip(); }} data-testid="export-zip">Esporta pacchetto ZIP<small>project.json + immagini, re-importabile</small></button>
            <button role="menuitem" onClick={() => { setMenu(false); p.onExportJson(); }} data-testid="export-json">Esporta solo JSON<small>configurazione senza immagini</small></button>
          </div>
        )}
      </div>
      <Link href="/manuale" target="_blank" rel="noreferrer" className={`${styles.btn} ${styles.iconBtn}`} title="Manuale (si apre in una nuova scheda)" aria-label="Manuale" data-testid="open-manual">{Icon.help}</Link>
      <button className={`${styles.btn} ${styles.iconBtn} ${styles.inspToggle}`} onClick={p.onToggleInspector} aria-label="Mostra/nascondi inspector" title="Inspector">{Icon.panel}</button>
    </header>
  );
}
