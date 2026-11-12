'use client';

import { useSyncExternalStore } from 'react';
import type { Environment, ScaleZone } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import { newZone } from '@/engine/navigation/scaleZones';
import { NumberField, TextField, Field } from './fields';
import styles from '../editor/editor.module.css';

/** Perspective by zones: areas painted on the backdrop with their own size percentage (editable any time). */
export function ZonesPanel({ store, env }: { store: EditorStore; env: Environment }) {
  const st = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const zones = env.scaleZones ?? [], brush = st.zoneBrush, painting = st.tool === 'zones';
  const set = (fn: (z: ScaleZone[]) => ScaleZone[]) => store.commitEnv((e) => ({ ...e, scaleZones: fn(e.scaleZones ?? []) }));
  const patch = (id: string, p: Partial<ScaleZone>) => set((zs) => zs.map((z) => (z.id === id ? { ...z, ...p } : z)));
  const add = () => { const z = newZone(zones.length); set((zs) => [...zs, z]); store.setZoneBrush({ zoneId: z.id, mode: 'paint' }); store.setTool('zones'); };
  const paintWith = (id: string) => { store.setZoneBrush({ zoneId: id, mode: 'paint' }); store.setTool('zones'); };

  return (
    <div data-testid="zones-panel" style={{ display: 'grid', gap: 6 }}>
      <h4 style={{ marginTop: 8 }}>Zone di scala (pennello)</h4>
      <span className={styles.help}>Dipingi sul fondale le aree dove il personaggio deve essere più piccolo (o più grande) e dai a ciascuna una percentuale. Hanno la precedenza sulla scala automatica; la scala impostata su un nodo ha la precedenza su tutto. Le zone si possono ridisegnare, cancellare con la gomma e cambiare in qualsiasi momento.</span>
      {zones.map((z) => {
        const active = painting && brush.zoneId === z.id;
        return (
          <div key={z.id} style={{ display: 'grid', gap: 4, border: `1px solid ${active ? z.color : 'var(--border)'}`, borderRadius: 8, padding: 6 }} data-testid={`zone-${z.id}`}>
            <div className={styles.row2}>
              <TextField id={`zn-${z.id}`} label="Nome" value={z.name} onCommit={(v) => patch(z.id, { name: v })} />
              <NumberField id={`zs-${z.id}`} label="Dimensione (%)" value={Math.round(z.scale * 100)} min={5} max={300} step={5} onCommit={(v) => patch(z.id, { scale: v / 100 })} />
            </div>
            <div className={styles.row2}>
              <button className={`${styles.btn} ${active ? styles.btnPrimary : ''}`} onClick={() => (active ? store.setTool('select') : paintWith(z.id))} data-testid={`zone-paint-${z.id}`}>{active ? 'Fine pittura' : 'Dipingi / modifica'}</button>
              <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => { set((zs) => zs.filter((x) => x.id !== z.id)); if (brush.zoneId === z.id) store.setZoneBrush({ zoneId: null }); }}>Elimina</button>
            </div>
            <button className={styles.btn} onClick={() => patch(z.id, { mask: '' })}>Svuota la zona</button>
          </div>
        );
      })}
      <button className={styles.btn} onClick={add} data-testid="zone-add">+ Nuova zona</button>
      {painting && (
        <div style={{ display: 'grid', gap: 4 }} data-testid="zone-brush">
          <div className={styles.row2}>
            <button className={`${styles.btn} ${brush.mode === 'paint' ? styles.btnPrimary : ''}`} onClick={() => store.setZoneBrush({ mode: 'paint' })}>Pennello</button>
            <button className={`${styles.btn} ${brush.mode === 'erase' ? styles.btnPrimary : ''}`} onClick={() => store.setZoneBrush({ mode: 'erase' })}>Gomma</button>
          </div>
          <Field label={`Dimensione del pennello: ${Math.round(brush.radius * 100)}%`} id="zone-radius">
            <input id="zone-radius" type="range" min={0.01} max={0.25} step={0.005} value={brush.radius} onChange={(e) => store.setZoneBrush({ radius: Number(e.target.value) })} aria-label="Dimensione del pennello" />
          </Field>
          <span className={styles.help}>Trascina sulla scena per dipingere la zona selezionata. Ogni tratto è un passo di Annulla.</span>
        </div>
      )}
    </div>
  );
}
