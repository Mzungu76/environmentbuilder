'use client';

import { useSyncExternalStore } from 'react';
import type { EditorStore, OccluderTool } from '@/lib/store/editorStore';
import { uid } from '@/lib/ids';
import { newOccluder } from '@/engine/navigation/occluders';
import { Icon } from '@/components/ui/icons';
import styles from './editor.module.css';

const TOOLS: { id: OccluderTool; label: string }[] = [
  { id: 'brush', label: 'Pennello' }, { id: 'rect', label: 'Rettangolo' }, { id: 'ellipse', label: 'Ellisse' },
  { id: 'polygon', label: 'Poligono' }, { id: 'spline', label: 'Spline' }, { id: 'edit', label: 'Modifica' },
];
const HINT: Record<OccluderTool, string> = {
  brush: 'Trascina per dipingere.', rect: 'Trascina da un angolo all’opposto.', ellipse: 'Trascina da un angolo all’opposto.',
  polygon: 'Tocca per aggiungere i punti. Tocca il primo punto o «Chiudi» per finire.', spline: 'Tocca per aggiungere i punti: la curva li attraversa. Tocca il primo punto o «Chiudi» per finire.',
  edit: 'Tocca una forma per selezionarla. Trascina i punti o la forma. Doppio tocco su un lato aggiunge un punto, su un punto lo toglie.',
};

/** Controls of the Primo piano tool: choose / create the occluder, drawing tool, add or subtract, size. Lives over the scene on desktop, in the side column on a phone. */
export function OccluderBar({ store, onFinish, onCancel, onDelete }: { store: EditorStore; onFinish: () => void; onCancel: () => void; onDelete: () => void }) {
  const st = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const env = store.env, list = env.occluders ?? [], b = st.occluderBrush;
  const cur = list.find((o) => o.id === b.occluderId) ?? (b.occluderId === null && list.length ? list[list.length - 1] : undefined);
  const patchCur = (patch: Partial<NonNullable<typeof cur>>) => cur && store.commitEnv((en) => ({ ...en, occluders: (en.occluders ?? []).map((o) => (o.id === cur.id ? { ...o, ...patch } : o)) }));
  const add = () => {
    const o = newOccluder(list, uid('occ'));
    store.commitEnv((e) => ({ ...e, occluders: [...(e.occluders ?? []), o] }));
    store.setOccluderBrush({ occluderId: o.id, selectedOp: null });
  };
  const remove = () => {
    if (!cur) return;
    store.commitEnv((e) => ({ ...e, occluders: (e.occluders ?? []).filter((o) => o.id !== cur.id) }));
    store.setOccluderBrush({ occluderId: null, selectedOp: null });
  };
  const pick = (tool: OccluderTool) => { onCancel(); store.setOccluderBrush({ tool, selectedOp: null }); };
  const selIsShape = b.selectedOp !== null && cur?.ops[b.selectedOp]?.kind === 'shape';
  return (
    <div className={styles.zoneBar} role="group" aria-label="Strumenti del primo piano" data-testid="occluder-bar">
      {b.drafting && <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onFinish} data-testid="occ-close">Chiudi forma</button>}
      {b.drafting && <button className={styles.chip} onClick={onCancel}>Annulla forma</button>}
      <span className={styles.help}>Disegna sulla scena le zone che nascondono il personaggio (una roccia, un arco). La prima parte si crea da sola.</span>
      {list.length > 0 && (
        <select className={styles.select} style={{ width: 'auto', maxWidth: 150 }} value={b.occluderId ?? list[list.length - 1].id} onChange={(e) => store.setOccluderBrush({ occluderId: e.target.value || null, selectedOp: null })} aria-label="Parte su cui disegni" data-testid="occbar-select">
          {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
      <button className={styles.chip} onClick={add} data-testid="occbar-add" title="Una parte separata, per esempio un altro oggetto davanti a cui passare">{Icon.plus} {list.length ? 'Altra parte' : 'Nuova parte'}</button>
      {cur && <input className={styles.input} style={{ width: 130 }} value={cur.name} aria-label="Nome" onChange={(e) => patchCur({ name: e.target.value })} />}
      <div className={styles.occTools} role="group" aria-label="Forma">
        {TOOLS.map((t) => <button key={t.id} className={styles.chip} aria-pressed={b.tool === t.id} onClick={() => pick(t.id)} data-testid={`occtool-${t.id}`}>{t.label}</button>)}
      </div>
      {b.tool !== 'edit' && (
        <div className={styles.occTools} role="group" aria-label="Aggiungi o sottrai">
          <button className={styles.chip} aria-pressed={b.mode === 'paint'} onClick={() => store.setOccluderBrush({ mode: 'paint' })} data-testid="occ-add">Aggiungi</button>
          <button className={styles.chip} aria-pressed={b.mode === 'erase'} onClick={() => store.setOccluderBrush({ mode: 'erase' })} data-testid="occ-sub">Sottrai</button>
        </div>
      )}
      {b.tool === 'brush' && <input type="range" min={0.004} max={0.15} step={0.002} value={b.radius} onChange={(e) => store.setOccluderBrush({ radius: Number(e.target.value) })} aria-label="Dimensione del pennello" />}
      {b.tool === 'edit' && selIsShape && <button className={`${styles.chip} ${styles.btnDanger}`} onClick={onDelete} data-testid="occ-delete-shape">{Icon.trash} Elimina forma</button>}
      <span className={styles.help} style={{ width: '100%', textAlign: 'center' }}>{HINT[b.tool]}</span>
      {cur && <label className={styles.help} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Bordo
        <input type="range" min={0} max={0.3} step={0.005} value={cur.softness} onChange={(e) => patchCur({ softness: Number(e.target.value) })} aria-label="Morbidezza del bordo" />
      </label>}
      {cur && <button className={`${styles.chip} ${styles.btnDanger}`} onClick={remove} aria-label="Elimina la parte">{Icon.trash}</button>}
      <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => { onCancel(); store.setTool('select'); }} data-testid="occbar-done">Fine</button>
    </div>
  );
}
