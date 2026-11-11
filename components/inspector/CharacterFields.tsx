'use client';

import type { Character, CharacterBehavior } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import { ALL_EDGE_TYPES } from '@/engine/profiles';
import { CheckField, Field, NumberField } from './fields';
import styles from '../editor/editor.module.css';

/** Behaviour parameters (autonomous movement). Shared by the editor inspector and the playtest panel. */
export function BehaviorFields({ store, c, idp }: { store: EditorStore; c: Character; idp: string }) {
  const setB = (patch: Partial<CharacterBehavior>) => store.commitEnv((e) => ({ ...e, characters: e.characters.map((x) => (x.id === c.id ? { ...x, behavior: { ...x.behavior, ...patch } } : x)) }));
  const set = (patch: Partial<Character>) => store.commitEnv((e) => ({ ...e, characters: e.characters.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) }));
  const b = c.behavior;
  return (
    <>
      <NumberField id={`${idp}-speed`} label="Velocità (% altezza immagine al secondo)" value={Math.round(c.speed * 1000) / 10} min={1} max={200} step={1} onCommit={(v) => set({ speed: v / 100 })} />
      <div className={styles.row2}>
        <NumberField id={`${idp}-pmin`} label="Sosta minima (s)" value={b.pauseMin} min={0} max={120} step={0.5} onCommit={(v) => setB({ pauseMin: v, pauseMax: Math.max(v, b.pauseMax) })} />
        <NumberField id={`${idp}-pmax`} label="Sosta massima (s)" value={b.pauseMax} min={0} max={120} step={0.5} onCommit={(v) => setB({ pauseMax: v, pauseMin: Math.min(v, b.pauseMin) })} />
      </div>
      <NumberField id={`${idp}-stop`} label="Probabilità di sosta ai nodi intermedi (%)" value={Math.round(b.stopProbability * 100)} min={0} max={100} onCommit={(v) => setB({ stopProbability: v / 100 })} />
      <div className={styles.row2}>
        <NumberField id={`${idp}-dec`} label="Frequenza decisioni (s)" value={b.decisionInterval} min={0.2} max={60} step={0.5} onCommit={(v) => setB({ decisionInterval: v })} />
        <NumberField id={`${idp}-turn`} label="Cambio direzione (%)" value={Math.round(b.turnProbability * 100)} min={0} max={100} onCommit={(v) => setB({ turnProbability: v / 100 })} />
      </div>
      <Field label="Preferenze di percorso" id={`${idp}-w`} help="Peso per tipo di collegamento: 1 = neutro, >1 preferito, <1 evitato, 0 = mai scelto in autonomia.">
        <div className={styles.row2}>
          {ALL_EDGE_TYPES.map((t) => (
            <NumberField key={t} id={`${idp}-w-${t}`} label={t} value={b.edgeWeights[t] ?? 1} min={0} max={10} step={0.5}
              onCommit={(v) => setB({ edgeWeights: { ...b.edgeWeights, [t]: v } })} />
          ))}
        </div>
      </Field>
    </>
  );
}

export function AppearanceFields({ store, c, idp }: { store: EditorStore; c: Character; idp: string }) {
  const set = (patch: Partial<Character>) => store.commitEnv((e) => ({ ...e, characters: e.characters.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) }));
  return (
    <>
      <div className={styles.row2}>
        <NumberField id={`${idp}-h`} label="Altezza (% immagine)" value={Math.round(c.height * 1000) / 10} min={1} max={60} step={0.5} onCommit={(v) => set({ height: v / 100 })} />
        <NumberField id={`${idp}-w`} label="Larghezza (% immagine)" value={Math.round(c.width * 1000) / 10} min={1} max={60} step={0.5} onCommit={(v) => set({ width: v / 100 })} />
      </div>
      <Field label="Colore" id={`${idp}-col`}>
        <input id={`${idp}-col`} type="color" className={styles.input} style={{ padding: 2, height: 34 }} value={c.color} onChange={(e) => set({ color: e.target.value })} />
      </Field>
      <CheckField id={`${idp}-shadow`} label="Ombra" checked={c.shadow} onChange={(v) => set({ shadow: v })} />
    </>
  );
}
