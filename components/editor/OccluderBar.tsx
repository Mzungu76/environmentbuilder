'use client';

import { useSyncExternalStore } from 'react';
import type { EditorStore } from '@/lib/store/editorStore';
import { uid } from '@/lib/ids';
import { newOccluder } from '@/engine/navigation/occluders';
import { Icon } from '@/components/ui/icons';
import styles from './editor.module.css';

/** Controls of the Primo piano tool: choose / create the occluder, brush or eraser, size. Lives over the scene on desktop, in the side column on a phone. */
export function OccluderBar({ store }: { store: EditorStore }) {
  const st = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const env = store.env, list = env.occluders ?? [], b = st.occluderBrush;
  const cur = list.find((o) => o.id === b.occluderId);
  const add = () => {
    const o = newOccluder(list, uid('occ'));
    store.commitEnv((e) => ({ ...e, occluders: [...(e.occluders ?? []), o] }));
    store.setOccluderBrush({ occluderId: o.id });
  };
  const remove = () => {
    if (!cur) return;
    store.commitEnv((e) => ({ ...e, occluders: (e.occluders ?? []).filter((o) => o.id !== cur.id) }));
    store.setOccluderBrush({ occluderId: null });
  };
  return (
    <div className={styles.zoneBar} role="group" aria-label="Pennello del primo piano" data-testid="occluder-bar">
      <select className={styles.select} style={{ width: 'auto', maxWidth: 150 }} value={b.occluderId ?? ''} onChange={(e) => store.setOccluderBrush({ occluderId: e.target.value || null })} aria-label="Parte da dipingere" data-testid="occbar-select">
        <option value="">Scegli la parte…</option>
        {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <button className={styles.chip} onClick={add} data-testid="occbar-add">{Icon.plus} Nuova</button>
      {cur && <input className={styles.input} style={{ width: 130 }} value={cur.name} aria-label="Nome" onChange={(e) => store.commitEnv((en) => ({ ...en, occluders: (en.occluders ?? []).map((o) => (o.id === cur.id ? { ...o, name: e.target.value } : o)) }))} />}
      <button className={styles.chip} aria-pressed={b.mode === 'paint'} onClick={() => store.setOccluderBrush({ mode: 'paint' })}>Pennello</button>
      <button className={styles.chip} aria-pressed={b.mode === 'erase'} onClick={() => store.setOccluderBrush({ mode: 'erase' })}>Gomma</button>
      <input type="range" min={0.004} max={0.15} step={0.002} value={b.radius} onChange={(e) => store.setOccluderBrush({ radius: Number(e.target.value) })} aria-label="Dimensione del pennello" />
      {cur && <label className={styles.help} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Bordo
        <input type="range" min={0} max={0.3} step={0.005} value={cur.softness} onChange={(e) => store.commitEnv((en) => ({ ...en, occluders: (en.occluders ?? []).map((o) => (o.id === cur.id ? { ...o, softness: Number(e.target.value) } : o)) }))} aria-label="Morbidezza del bordo" />
      </label>}
      {cur && <button className={`${styles.chip} ${styles.btnDanger}`} onClick={remove} aria-label="Elimina la parte">{Icon.trash}</button>}
      <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => store.setTool('select')} data-testid="occbar-done">Fine</button>
    </div>
  );
}
