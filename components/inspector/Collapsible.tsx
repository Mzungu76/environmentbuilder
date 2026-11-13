'use client';

import { useState, type ReactNode } from 'react';
import styles from '../editor/editor.module.css';

const isNarrow = () => typeof window !== 'undefined' && window.innerWidth < 900;

/** Collapsible group of settings. On phones the groups start closed so the panel stays short. */
export function Collapsible({ title, defaultOpen = true, badge, children, id }: { title: string; defaultOpen?: boolean; badge?: string; children: ReactNode; id?: string }) {
  const [open, setOpen] = useState(() => defaultOpen && !isNarrow());
  return (
    <section className={styles.collapse} data-testid={id ? `collapse-${id}` : undefined}>
      <button className={styles.collapseHead} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>{badge && <span className={styles.badge}>{badge}</span>}<span aria-hidden className={styles.chev}>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div>{children}</div>}
    </section>
  );
}

/** Top bar of the settings panel on phones: expand to full screen / close (the panel behaves as a bottom sheet). */
export function SheetBar({ title, full, onToggleFull, onClose }: { title: string; full: boolean; onToggleFull?: () => void; onClose?: () => void }) {
  return (
    <div className={styles.sheetBar}>
      <span className={styles.sheetGrip} aria-hidden />
      <strong>{title}</strong>
      <span style={{ flex: 1 }} />
      {onToggleFull && <button className={styles.sheetBtn} onClick={onToggleFull} aria-label={full ? 'Riduci il pannello' : 'Espandi il pannello a schermo intero'} data-testid="sheet-full">{full ? '▾ Riduci' : '▴ Espandi'}</button>}
      {onClose && <button className={styles.sheetBtn} onClick={onClose} aria-label="Chiudi il pannello" data-testid="sheet-close">✕</button>}
    </div>
  );
}
