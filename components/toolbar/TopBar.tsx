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
  const statusText = st === 'saved' ? 'Saved' : st === 'dirty' ? 'Unsaved changes' : st === 'saving' ? 'Saving…' : 'Save failed';
  const dotCls = st === 'dirty' ? styles.dotDirty : st === 'error' ? styles.dotError : st === 'saving' ? styles.dotSaving : '';

  return (
    <header className={styles.top}>
      <span className={styles.brand}>Environment Builder</span>
      <NameField className={styles.projectName} value={state.project.name} onCommit={p.onProjectName} label="Project name" />
      <span className={styles.hideSm} aria-hidden>/</span>
      <NameField value={p.envName} onCommit={p.onEnvName} label="Environment name" />
      <span className={`${styles.sep} ${styles.hideXs}`} />
      <Link href="/" className={`${styles.btn} ${styles.hideXs}`} title="Open project (library)"><span className={styles.hideSm}>Open</span>{Icon.folder}</Link>
      <button className={`${styles.btn} ${styles.hideSm}`} onClick={p.onNew} title="New project">{Icon.plus}New</button>
      <span className={styles.spacer} />
      <span className={`${styles.status} ${styles.hideXs}`} role="status" title={state.saveError ?? undefined}><span className={`${styles.dot} ${dotCls}`} />{statusText}</span>
      <button className={`${styles.btn} ${styles.iconBtn}`} onClick={p.onUndo} disabled={!state.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo" data-testid="undo">{Icon.undo}</button>
      <button className={`${styles.btn} ${styles.iconBtn}`} onClick={p.onRedo} disabled={!state.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" data-testid="redo">{Icon.redo}</button>
      <button className={styles.btn} onClick={p.onSave} title="Save (Ctrl+S)" data-testid="save">{Icon.save}<span className={styles.hideSm}>Save</span></button>
      <span className={`${styles.sep} ${styles.hideSm}`} />
      <div className={`${styles.seg} ${styles.hideSm}`} role="group" aria-label="Mode">
        <button aria-pressed="true">Editor</button>
        <button disabled title="Playtest arrives with Milestone 2">Playtest</button>
      </div>
      <div className={styles.menuWrap} ref={wrap}>
        <button className={styles.btn} onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} data-testid="export-menu">{Icon.export}<span className={styles.hideSm}>Export</span></button>
        {menu && (
          <div className={styles.menu} role="menu">
            <button role="menuitem" onClick={() => { setMenu(false); p.onExportZip(); }} data-testid="export-zip">Export ZIP package<small>project.json + images, re-importable</small></button>
            <button role="menuitem" onClick={() => { setMenu(false); p.onExportJson(); }} data-testid="export-json">Export JSON only<small>configuration without images</small></button>
          </div>
        )}
      </div>
      <button className={`${styles.btn} ${styles.iconBtn} ${styles.inspToggle}`} onClick={p.onToggleInspector} aria-label="Toggle inspector" title="Inspector">{Icon.panel}</button>
    </header>
  );
}
