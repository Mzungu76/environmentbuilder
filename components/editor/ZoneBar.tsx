'use client';

import { useSyncExternalStore } from 'react';
import type { EditorStore } from '@/lib/store/editorStore';
import styles from './editor.module.css';

/** Floating controls of the zones tool: stays over the scene (also on phones) so you can paint without opening the settings panel. */
export function ZoneBar({ store }: { store: EditorStore }) {
  const st = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const env = store.env, zones = env.scaleZones ?? [], b = st.zoneBrush;
  return (
    <div className={styles.zoneBar} role="group" aria-label="Pennello delle zone di scala" data-testid="zone-bar">
      <select className={styles.select} style={{ width: 'auto', maxWidth: 150 }} value={b.zoneId ?? ''} onChange={(e) => store.setZoneBrush({ zoneId: e.target.value || null })} aria-label="Zona da dipingere" data-testid="zonebar-zone">
        <option value="">Scegli la zona…</option>
        {zones.map((z) => <option key={z.id} value={z.id}>{z.name} · {Math.round(z.scale * 100)}%</option>)}
      </select>
      <button className={`${styles.chip}`} aria-pressed={b.mode === 'paint'} onClick={() => store.setZoneBrush({ mode: 'paint' })}>Pennello</button>
      <button className={`${styles.chip}`} aria-pressed={b.mode === 'erase'} onClick={() => store.setZoneBrush({ mode: 'erase' })}>Gomma</button>
      <input type="range" min={0.01} max={0.25} step={0.005} value={b.radius} onChange={(e) => store.setZoneBrush({ radius: Number(e.target.value) })} aria-label="Dimensione del pennello" />
      <button className={styles.chip} aria-pressed={b.showResult} onClick={() => store.setZoneBrush({ showResult: !b.showResult })} title="Mostra la dimensione risultante">Risultato</button>
      <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => store.setTool('select')} data-testid="zonebar-done">Fine</button>
    </div>
  );
}
