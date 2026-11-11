'use client';

import { useState } from 'react';
import type { Environment } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import { Icon } from '@/components/ui/icons';
import styles from '../editor/editor.module.css';

/** Environment switcher: a project holds several autonomous environments. */
export function EnvTabs({ store, envs, activeId, locked }: { store: EditorStore; envs: Environment[]; activeId: string; locked: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const active = envs.find((e) => e.id === activeId);
  return (
    <div className={styles.envTabs} role="tablist" aria-label="Ambienti del progetto" data-testid="env-tabs">
      <div className={styles.envScroll}>
        {envs.map((e) => (
          <button key={e.id} role="tab" aria-selected={e.id === activeId} className={styles.envTab} disabled={locked && e.id !== activeId}
            onClick={() => { setConfirm(false); store.setActiveEnvironment(e.id); }} data-testid="env-tab">{e.name}</button>
        ))}
      </div>
      {!locked && (
        <div className={styles.envActions}>
          <button className={`${styles.btn} ${styles.iconBtn}`} style={{ height: 28 }} onClick={() => store.addEnvironment()} aria-label="Nuovo ambiente" title="Nuovo ambiente" data-testid="env-add">{Icon.plus}</button>
          <button className={`${styles.btn} ${styles.iconBtn}`} style={{ height: 28 }} onClick={() => active && store.duplicateEnvironment(active.id)} aria-label="Duplica ambiente" title="Duplica ambiente" data-testid="env-dup">{Icon.copy}</button>
          {confirm
            ? <button className={`${styles.btn} ${styles.btnDanger}`} style={{ height: 28 }} onClick={() => { if (active) store.deleteEnvironment(active.id); setConfirm(false); }} data-testid="env-del-confirm">Eliminare “{active?.name}”?</button>
            : <button className={`${styles.btn} ${styles.iconBtn} ${styles.btnDanger}`} style={{ height: 28 }} disabled={envs.length <= 1} onClick={() => setConfirm(true)} aria-label="Elimina ambiente" title={envs.length <= 1 ? 'Un progetto deve avere almeno un ambiente' : 'Elimina ambiente'} data-testid="env-del">{Icon.trash}</button>}
          {confirm && <button className={styles.btn} style={{ height: 28 }} onClick={() => setConfirm(false)}>Annulla</button>}
        </div>
      )}
    </div>
  );
}
