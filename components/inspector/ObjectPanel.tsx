'use client';

import { useRef, useState } from 'react';
import type { Environment, InteractiveObject } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import { OBJECT_TYPES, objectIssues, updateObject } from '@/engine/interaction/objects';
import { importObjectImage } from '@/lib/import-export/background';
import { ACCEPTED_IMAGE_TYPES } from '@/lib/import-export/image';
import { CheckField, Field, NumberField, PropsField, TextField } from './fields';
import { InteractionsEditor } from './InteractionsEditor';
import { Icon } from '@/components/ui/icons';
import styles from '../editor/editor.module.css';

export function ObjectPanel({ store, env, o }: { store: EditorStore; env: Environment; o: InteractiveObject }) {
  const project = store.project;
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const edit = (patch: Partial<InteractiveObject>) => store.commitEnv((e) => updateObject(e, o.id, patch));
  const types = OBJECT_TYPES.some((t) => t.id === o.type) ? OBJECT_TYPES : [...OBJECT_TYPES, { id: o.type, label: o.type, color: 0 }];
  const exit = env.exits.find((x) => x.objectId === o.id);
  const targetEnv = exit?.targetEnvironmentId ? project.environments.find((e) => e.id === exit.targetEnvironmentId) : undefined;
  const setExit = (patch: { targetEnvironmentId?: string | null; targetEntranceId?: string | null }) =>
    store.commitEnv((e) => ({ ...e, exits: e.exits.map((x) => (x.objectId === o.id ? { ...x, ...patch } : x)) }));
  const issues = objectIssues(project, env).filter((i) => i.id === o.id);

  return (
    <>
      <div className={styles.section}>
        <TextField id="o-id" label="ID" value={o.id} readOnly mono />
        <TextField id="o-name" label="Nome" value={o.name} onCommit={(v) => edit({ name: v })} />
        <Field label="Tipologia" id="o-type">
          <select id="o-type" className={styles.select} value={o.type} onChange={(e) => edit({ type: e.target.value })}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
        <CheckField id="o-vis" label="Visibile" checked={o.visible} onChange={(v) => edit({ visible: v })} />
      </div>

      {(o.type === 'exit' || o.type === 'entrance') && (
        <div className={styles.section}>
          <h4>{o.type === 'exit' ? 'Uscita verso un altro ambiente' : 'Ingresso'}</h4>
          {o.type === 'entrance' && <span className={styles.help}>Punto in cui compaiono i personaggi che arrivano da un’uscita collegata. Agganciato al nodo scelto sotto (o al più vicino).</span>}
          {o.type === 'exit' && exit && (
            <>
              <Field label="Ambiente di destinazione" id="o-tenv">
                <select id="o-tenv" className={styles.select} value={exit.targetEnvironmentId ?? ''} onChange={(e) => setExit({ targetEnvironmentId: e.target.value || null, targetEntranceId: null })} data-testid="exit-env">
                  <option value="">— nessuno —</option>
                  {project.environments.map((e) => <option key={e.id} value={e.id}>{e.name}{e.id === env.id ? ' (questo)' : ''}</option>)}
                </select>
              </Field>
              <Field label="Ingresso di destinazione" id="o-tent">
                <select id="o-tent" className={styles.select} value={exit.targetEntranceId ?? ''} disabled={!targetEnv} onChange={(e) => setExit({ targetEntranceId: e.target.value || null })} data-testid="exit-entrance">
                  <option value="">— scegli —</option>
                  {targetEnv?.entrances.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
                </select>
              </Field>
              {targetEnv && targetEnv.entrances.length === 0 && <span className={styles.warn}>“{targetEnv.name}” non ha ingressi: aggiungine uno con lo strumento Oggetto.</span>}
            </>
          )}
          {issues.map((i, k) => <span key={k} className={styles.warn}>{i.message}</span>)}
        </div>
      )}

      <div className={styles.section}>
        <h4>Posizione e dimensioni</h4>
        <div className={styles.row2}>
          <NumberField id="o-x" label="X (px)" value={Math.round(o.position.x * env.width)} min={0} max={env.width} onCommit={(v) => edit({ position: { ...o.position, x: v / env.width } })} />
          <NumberField id="o-y" label="Y (px)" value={Math.round(o.position.y * env.height)} min={0} max={env.height} onCommit={(v) => edit({ position: { ...o.position, y: v / env.height } })} />
          <NumberField id="o-w" label="Larghezza (% altezza)" value={Math.round(o.width * 1000) / 10} min={1} max={100} step={0.5} onCommit={(v) => edit({ width: v / 100 })} />
          <NumberField id="o-h" label="Altezza (% altezza)" value={Math.round(o.height * 1000) / 10} min={1} max={100} step={0.5} onCommit={(v) => edit({ height: v / 100 })} />
        </div>
        <span className={styles.help}>Trascina l’oggetto per spostarlo e la maniglia gialla per ridimensionarlo (con immagine mantiene le proporzioni).</span>
      </div>

      <div className={styles.section}>
        <h4>Immagine</h4>
        {o.assetId ? <span className={styles.help} style={{ color: 'var(--text-dim)' }}>{env.assets.find((a) => a.id === o.assetId)?.fileName ?? o.assetId}</span> : <span className={styles.help}>Nessuna immagine: in scena è mostrato un segnaposto di progetto (invisibile nel Playtest).</span>}
        <div className={styles.row2}>
          <button className={styles.btn} onClick={() => file.current?.click()} data-testid="object-image">{Icon.image}{o.assetId ? 'Sostituisci' : 'Importa'}</button>
          {o.assetId && <button className={styles.btn} onClick={() => edit({ assetId: null })}>{Icon.trash}Rimuovi</button>}
        </div>
        {err && <span className={styles.warn} role="alert">{err}</span>}
        <input ref={file} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden data-testid="object-file"
          onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setErr(null); try { await importObjectImage(store, o.id, f); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } }} />
      </div>

      <div className={styles.section}>
        <h4>Collegamento alla navigazione</h4>
        <Field label="Nodo" id="o-node">
          <select id="o-node" className={styles.select} value={o.linkedNodeId ?? ''} onChange={(e) => edit({ linkedNodeId: e.target.value || null })} data-testid="object-node">
            <option value="">— nessuno (usa il più vicino) —</option>
            {env.navigation.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </Field>
        <Field label="Percorso" id="o-edge">
          <select id="o-edge" className={styles.select} value={o.linkedEdgeId ?? ''} onChange={(e) => edit({ linkedEdgeId: e.target.value || null })}>
            <option value="">— nessuno —</option>
            {env.navigation.edges.map((ed) => {
              const a = env.navigation.nodes.find((n) => n.id === ed.from), b = env.navigation.nodes.find((n) => n.id === ed.to);
              return <option key={ed.id} value={ed.id}>{a?.name} → {b?.name} ({ed.type})</option>;
            })}
          </select>
        </Field>
      </div>
      <InteractionsEditor store={store} o={o} />
      <div className={styles.section}><PropsField id="o-props" value={o.props} onCommit={(p) => edit({ props: p })} /></div>
    </>
  );
}
