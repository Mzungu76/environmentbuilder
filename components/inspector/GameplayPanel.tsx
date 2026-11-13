'use client';

import { useMemo, useState } from 'react';
import type { CollapseConfig, CollapseStage, Collectible, Environment, GameplayConfig } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import { CollapseTimer } from '@/engine/game/collapse';
import { defaultGameplay, newCollectible } from '@/engine/game/defaults';
import { gameReadiness } from '@/engine/game/validate';
import { createRng } from '@/engine/simulation/rng';
import { uid } from '@/lib/ids';
import { CheckField, Field, NumberField, TextField } from './fields';
import styles from '../editor/editor.module.css';

const EFFECTS = ['tremor', 'dust', 'rocks', 'darken', 'flash', 'final'];

/** Rules of the game for the scenario: what can be found and how the collapse unfolds. Exported with the scenario for the game app. */
export function GameplayPanel({ store, env }: { store: EditorStore; env: Environment }) {
  const g: GameplayConfig = { ...defaultGameplay(), ...(env.gameplay ?? {}) };
  const set = (patch: Partial<GameplayConfig>) => store.commitEnv((e) => ({ ...e, gameplay: { ...defaultGameplay(), ...(e.gameplay ?? {}), ...patch } }));
  const setCol = (id: string, patch: Partial<Collectible>) => set({ collectibles: g.collectibles.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const setCollapse = (patch: Partial<CollapseConfig>) => set({ collapse: { ...g.collapse, ...patch } });
  const setStage = (id: string, patch: Partial<CollapseStage>) => setCollapse({ stages: g.collapse.stages.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const issues = useMemo(() => gameReadiness(store.project, env), [store.project, env]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.section} data-testid="gameplay-panel">
      <h4>Gioco</h4>
      <span className={styles.help}>Cosa può trovare il personaggio e come cede la grotta. L’app di gioco legge queste regole dal pacchetto esportato.</span>

      <h4 style={{ marginTop: 8 }}>Oggetti da trovare</h4>
      {g.collectibles.map((c) => (
        <div key={c.id} style={{ display: 'grid', gap: 4, border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
          <div className={styles.row2}>
            <TextField id={`col-n-${c.id}`} label="Nome" value={c.name} onCommit={(v) => setCol(c.id, { name: v })} />
            <Field label="Colore" id={`col-c-${c.id}`}><input id={`col-c-${c.id}`} type="color" className={styles.input} style={{ padding: 2, height: 34 }} value={c.color} onChange={(e) => setCol(c.id, { color: e.target.value })} /></Field>
          </div>
          <div className={styles.row2}>
            <NumberField id={`col-p-${c.id}`} label="Punti" value={c.points} min={0} max={1000} onCommit={(v) => setCol(c.id, { points: v })} />
            <NumberField id={`col-w-${c.id}`} label="Frequenza (peso)" value={c.weight} min={0} max={100} step={0.5} onCommit={(v) => setCol(c.id, { weight: v })} help="Quanto è probabile quando il gioco ne estrae uno a caso." />
          </div>
          {g.collectibles.length > 1 && <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => set({ collectibles: g.collectibles.filter((x) => x.id !== c.id) })}>Rimuovi «{c.name}»</button>}
        </div>
      ))}
      <button className={styles.btn} onClick={() => set({ collectibles: [...g.collectibles, newCollectible('Nuovo oggetto', 1, '#f6ad55')] })} data-testid="add-collectible">+ Aggiungi un oggetto</button>

      <div className={styles.row2}>
        <NumberField id="gp-collect" label="Durata della raccolta (s)" value={g.collectSeconds} min={0.3} max={10} step={0.1} onCommit={(v) => set({ collectSeconds: v })} />
        <NumberField id="gp-celebrate" label="Durata dell’esultanza (s)" value={g.celebrateSeconds} min={0.3} max={10} step={0.1} onCommit={(v) => set({ celebrateSeconds: v })} />
      </div>
      <span className={styles.help}>Il punto si conta a metà raccolta, quando l’oggetto è in mano. Servono le animazioni per gli stati COLLECT e CELEBRATE del personaggio (nello Studio).</span>

      <h4 style={{ marginTop: 8 }}>Crollo della grotta</h4>
      <CheckField id="gp-collapse" label="La grotta cede a un certo punto" checked={g.collapse.enabled} onChange={(v) => setCollapse({ enabled: v })} />
      {g.collapse.enabled && (
        <>
          <div className={styles.row2}>
            <NumberField id="gp-min" label="Dopo almeno (s)" value={g.collapse.minSeconds} min={5} max={3600} onCommit={(v) => setCollapse({ minSeconds: v, maxSeconds: Math.max(v, g.collapse.maxSeconds) })} />
            <NumberField id="gp-max" label="Al massimo (s)" value={g.collapse.maxSeconds} min={5} max={3600} onCommit={(v) => setCollapse({ maxSeconds: v, minSeconds: Math.min(v, g.collapse.minSeconds) })} />
          </div>
          <div className={styles.row2}>
            <NumberField id="gp-wob" label="Oscillazione (%)" value={Math.round(g.collapse.wobble * 100)} min={0} max={100} step={5} onCommit={(v) => setCollapse({ wobble: v / 100 })} />
            <NumberField id="gp-fa" label="Falsi allarmi" value={g.collapse.falseAlarms} min={0} max={8} onCommit={(v) => setCollapse({ falseAlarms: v })} help="Tremori che poi si calmano." />
          </div>
          <span className={styles.help}>Come una trottola: l’istante del crollo è casuale tra i due limiti e il gioco non lo conosce mai. Vede solo quanto trema la grotta, che aumenta in modo irregolare e sempre più veloce.</span>
          <CollapsePreview cfg={g.collapse} />
          <h4 style={{ marginTop: 6 }}>Fasi</h4>
          {g.collapse.stages.map((s) => (
            <div key={s.id} style={{ display: 'grid', gap: 4, border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
              <div className={styles.row2}>
                <NumberField id={`st-at-${s.id}`} label="Quando (% del crollo)" value={Math.round(s.at * 100)} min={0} max={100} step={5} onCommit={(v) => setStage(s.id, { at: v / 100 })} />
                <NumberField id={`st-i-${s.id}`} label="Intensità (%)" value={Math.round(s.intensity * 100)} min={0} max={100} step={5} onCommit={(v) => setStage(s.id, { intensity: v / 100 })} />
              </div>
              <div className={styles.row2}>
                <Field label="Effetto" id={`st-e-${s.id}`}>
                  <input id={`st-e-${s.id}`} list="gp-effects" className={styles.input} defaultValue={s.effect} onBlur={(e) => setStage(s.id, { effect: e.target.value.trim() || 'tremor' })} />
                </Field>
                <TextField id={`st-ev-${s.id}`} label="Evento per il gioco" value={s.event} onCommit={(v) => setStage(s.id, { event: v })} />
              </div>
              <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => setCollapse({ stages: g.collapse.stages.filter((x) => x.id !== s.id) })}>Rimuovi fase</button>
            </div>
          ))}
          <datalist id="gp-effects">{EFFECTS.map((e) => <option key={e} value={e} />)}</datalist>
          <button className={styles.btn} onClick={() => setCollapse({ stages: [...g.collapse.stages, { id: uid('stg'), at: 0.5, effect: 'tremor', intensity: 0.4, event: '' }] })}>+ Aggiungi una fase</button>
          <span className={styles.help}>L’effetto è un nome che il gioco interpreta (tremore, polvere, sassi, buio, lampo…).</span>
        </>
      )}

      <h4 style={{ marginTop: 8 }}>Pronto per il gioco?</h4>
      {issues.length === 0 ? <span className={styles.help} style={{ color: 'var(--ok, #3ecf8e)' }} data-testid="gp-ready">✓ Tutto a posto: puoi esportare il pacchetto per il gioco.</span>
        : issues.map((i, k) => <span key={k} className={i.level === 'error' ? styles.warn : styles.help} data-testid="gp-issue">{i.level === 'error' ? '✗ ' : '⚠ '}{i.text}</span>)}
    </div>
  );
}

/** Simulation of the shaking over time for ONE random draw of the duration (press again for another). */
function CollapsePreview({ cfg }: { cfg: CollapseConfig }) {
  const [seed, setSeed] = useState(1);
  const { pts, total } = useMemo(() => {
    const t = new CollapseTimer({ ...cfg, enabled: true }, createRng(seed * 7919 + 13)), total = t.debugTotal, pts: number[] = [];
    for (let s = 0; s <= total; s += total / 160) { const sig = t.update(total / 160); pts.push(sig.intensity); }
    return { pts, total };
  }, [cfg, seed]);
  const W = 260, H = 56, line = pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H - 4 - v * (H - 8)}`).join(' ');
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Simulazione del tremore nel tempo" style={{ background: 'var(--panel-2, #181c24)', borderRadius: 6 }}>
        <polyline points={line} fill="none" stroke="#f59e0b" strokeWidth="1.5" />
      </svg>
      <span className={styles.help}>Simulazione: crolla dopo {Math.round(total)} s (questa estrazione). I picchi precoci sono i falsi allarmi.</span>
      <button className={styles.btn} onClick={() => setSeed((n) => n + 1)} data-testid="collapse-resim">Nuova estrazione</button>
    </div>
  );
}
