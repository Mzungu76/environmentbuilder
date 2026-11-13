'use client';

import type { Character, CharacterBehavior } from '@/types';
import { DEFAULT_LOOK } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import { allEdgeTypes } from '@/engine/profiles';
import { getMovementType } from '@/engine/movement/movementTypes';
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
          {allEdgeTypes().map((t) => (
            <NumberField key={t} id={`${idp}-w-${t}`} label={getMovementType(t).label} value={b.edgeWeights[t] ?? 1} min={0} max={10} step={0.5}
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
      {c.puppetId && <LookFields store={store} c={c} idp={idp} />}
    </>
  );
}

/** Scene integration of a rigged character: colour grading, ambient tint, halo and shadow (so it blends with, or stands out from, the background). */
export function LookFields({ store, c, idp }: { store: EditorStore; c: Character; idp: string }) {
  const look = { ...DEFAULT_LOOK, ...(c.look ?? {}) };
  const setL = (patch: Partial<typeof look>) => store.commitEnv((e) => ({ ...e, characters: e.characters.map((x) => (x.id === c.id ? { ...x, look: { ...look, ...patch } } : x)) }));
  const pct = (v: number) => Math.round(v * 100);
  return (
    <Field label="Resa nella scena" id={`${idp}-look`} help="Per far spiccare o integrare il personaggio nello sfondo: correggi luce e colori, aggiungi una tinta d’ambiente e un alone chiaro.">
      <div className={styles.row2}>
        <NumberField id={`${idp}-lb`} label="Luminosità (%)" value={pct(look.brightness)} min={40} max={200} step={5} onCommit={(v) => setL({ brightness: v / 100 })} />
        <NumberField id={`${idp}-lc`} label="Contrasto (%)" value={pct(look.contrast)} min={40} max={200} step={5} onCommit={(v) => setL({ contrast: v / 100 })} />
      </div>
      <div className={styles.row2}>
        <NumberField id={`${idp}-ls`} label="Saturazione (%)" value={pct(look.saturation)} min={0} max={200} step={5} onCommit={(v) => setL({ saturation: v / 100 })} />
        <NumberField id={`${idp}-lsh`} label="Ombra a terra (%)" value={pct(look.shadow)} min={0} max={100} step={5} onCommit={(v) => setL({ shadow: v / 100 })} />
      </div>
      <div className={styles.row2}>
        <NumberField id={`${idp}-lta`} label="Tinta d’ambiente (%)" value={pct(look.tintAmount)} min={0} max={100} step={5} onCommit={(v) => setL({ tintAmount: v / 100 })} />
        <Field label="Colore tinta" id={`${idp}-lt`}><input id={`${idp}-lt`} type="color" className={styles.input} style={{ padding: 2, height: 34 }} value={look.tint} onChange={(e) => setL({ tint: e.target.value })} /></Field>
      </div>
      <div className={styles.row2}>
        <NumberField id={`${idp}-lh`} label="Alone chiaro (%)" value={pct(look.halo)} min={0} max={100} step={5} onCommit={(v) => setL({ halo: v / 100 })} />
        <Field label="Colore alone" id={`${idp}-lhc`}><input id={`${idp}-lhc`} type="color" className={styles.input} style={{ padding: 2, height: 34 }} value={look.haloColor} onChange={(e) => setL({ haloColor: e.target.value })} /></Field>
      </div>
      <button className={styles.btn} onClick={() => store.commitEnv((e) => ({ ...e, characters: e.characters.map((x) => (x.id === c.id ? { ...x, look: undefined } : x)) }))}>Ripristina</button>
    </Field>
  );
}
