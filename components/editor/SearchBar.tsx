'use client';

import { useSyncExternalStore } from 'react';
import type { EditorStore, SearchTool } from '@/lib/store/editorStore';
import { searchZoneInfo, searchZoneIssues, MAX_WEIGHT } from '@/engine/search/zones';
import { Icon } from '@/components/ui/icons';
import styles from './editor.module.css';

const TOOLS: { id: SearchTool; label: string }[] = [
  { id: 'polygon', label: 'Poligono' }, { id: 'ellipse', label: 'Ellisse' }, { id: 'rect', label: 'Rettangolo' }, { id: 'edit', label: 'Modifica' },
];
const HINT: Record<SearchTool, string> = {
  polygon: 'Tocca per aggiungere i punti. Tocca il primo punto o «Chiudi» per finire.',
  ellipse: 'Trascina da un angolo all’opposto.', rect: 'Trascina da un angolo all’opposto.',
  edit: 'Tocca una zona per selezionarla. Trascina i punti o la zona. Doppio tocco su un lato aggiunge un punto, su un punto lo toglie.',
};

/** Controls of the "Zone di ricerca" tool: drawing shape, the zones with their weight (the odds of hiding a gem there), warnings. */
export function SearchBar({ store, onFinish, onCancel, onDelete }: { store: EditorStore; onFinish: () => void; onCancel: () => void; onDelete: () => void }) {
  const st = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const env = store.env, info = searchZoneInfo(env), t = st.searchTool;
  const sel = info.find((i) => i.zone.id === t.selectedId)?.zone;
  const patch = (id: string, p: Record<string, unknown>) => store.commitEnv((e) => ({ ...e, searchZones: (e.searchZones ?? []).map((z) => (z.id === id ? { ...z, ...p } : z)) }));
  const pick = (tool: SearchTool) => { onCancel(); store.setSearchTool({ tool }); };
  const issues = searchZoneIssues(env);
  return (
    <div className={styles.zoneBar} role="group" aria-label="Zone di ricerca" data-testid="search-bar">
      {t.drafting && <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onFinish} data-testid="search-close">Chiudi zona</button>}
      {t.drafting && <button className={styles.chip} onClick={onCancel}>Annulla</button>}
      <span className={styles.help}>Disegna dove il giocatore può cercare le gemme. Il peso è la probabilità che la zona ne riceva: 0 = sempre vuota. Le zone non devono sovrapporsi.</span>
      <div className={styles.occTools} role="group" aria-label="Forma">
        {TOOLS.map((x) => <button key={x.id} className={styles.chip} aria-pressed={t.tool === x.id} onClick={() => pick(x.id)} data-testid={`searchtool-${x.id}`}>{x.label}</button>)}
      </div>
      <span className={styles.help}>{HINT[t.tool]}</span>
      {info.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }} data-testid="search-list">
          {info.map(({ zone, share }) => (
            <li key={zone.id}>
              <button className={styles.chip} style={{ width: '100%', justifyContent: 'space-between' }} aria-pressed={t.selectedId === zone.id}
                onClick={() => store.setSearchTool({ selectedId: zone.id })} data-testid={`search-zone-${zone.id}`}>
                <span><span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: zone.color, marginRight: 6 }} />{zone.name}</span>
                <span>{zone.weight === 0 ? 'vuota' : `${Math.round(share * 100)}%`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {sel && (
        <div style={{ display: 'grid', gap: 6 }} data-testid="search-selected">
          <input className={styles.input} value={sel.name} aria-label="Nome della zona" onChange={(e) => patch(sel.id, { name: e.target.value })} />
          <label className={styles.help} style={{ display: 'grid', gap: 2 }}>Peso: {sel.weight}
            <input type="range" min={0} max={MAX_WEIGHT} step={1} value={sel.weight} aria-label="Peso della zona" data-testid="search-weight" onChange={(e) => patch(sel.id, { weight: Number(e.target.value) })} />
          </label>
          <button className={`${styles.chip} ${styles.btnDanger}`} onClick={onDelete} data-testid="search-delete">{Icon.trash} Elimina zona</button>
        </div>
      )}
      {issues.map((i, k) => <span key={k} className={styles.help} style={{ color: i.level === 'error' ? 'var(--danger, #f87171)' : undefined }}>⚠ {i.text}</span>)}
    </div>
  );
}
