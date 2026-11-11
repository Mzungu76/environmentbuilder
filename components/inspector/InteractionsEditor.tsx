'use client';

import type { InteractiveObject, Interaction } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import { updateObject } from '@/engine/interaction/objects';
import { INTERACTION_KINDS, newInteraction } from '@/engine/interaction/system';
import { CheckField, Field, NumberField, PropsField, TextField } from './fields';
import { Icon } from '@/components/ui/icons';
import styles from '../editor/editor.module.css';

/** Configurable interactions of an object (collect, inspect, activate, custom). */
export function InteractionsEditor({ store, o }: { store: EditorStore; o: InteractiveObject }) {
  const setAll = (list: Interaction[]) => store.commitEnv((e) => updateObject(e, o.id, { interactions: list }));
  const patch = (id: string, p: Partial<Interaction>) => setAll(o.interactions.map((i) => (i.id === id ? { ...i, ...p } : i)));
  return (
    <div className={styles.section} data-testid="interactions">
      <h4>Interazioni ({o.interactions.length})</h4>
      <span className={styles.help}>Un oggetto non reagisce al semplice passaggio del personaggio: l’interazione parte solo quando il percorso termina sul suo nodo («all’arrivo») o su richiesta («manuale»).</span>
      {o.interactions.map((i, idx) => (
        <div key={i.id} style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid var(--border)', borderRadius: 8 }} data-testid="interaction">
          <div className={styles.row2} style={{ gridTemplateColumns: '1fr auto' }}>
            <Field label={`Interazione ${idx + 1}`} id={`i-kind-${i.id}`}>
              <select id={`i-kind-${i.id}`} className={styles.select} value={INTERACTION_KINDS.some((k) => k.id === i.kind) ? i.kind : 'custom'} onChange={(e) => patch(i.id, { kind: e.target.value })} data-testid="interaction-kind">
                {INTERACTION_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </Field>
            <button className={`${styles.btn} ${styles.btnDanger} ${styles.iconBtn}`} style={{ alignSelf: 'end' }} aria-label="Elimina interazione" onClick={() => setAll(o.interactions.filter((x) => x.id !== i.id))}>{Icon.trash}</button>
          </div>
          <TextField id={`i-label-${i.id}`} label="Etichetta" value={i.label} onCommit={(v) => patch(i.id, { label: v })} />
          <Field label="Quando parte" id={`i-trig-${i.id}`}>
            <select id={`i-trig-${i.id}`} className={styles.select} value={i.trigger} onChange={(e) => patch(i.id, { trigger: e.target.value as Interaction['trigger'] })} data-testid="interaction-trigger">
              <option value="on-arrival">All’arrivo del personaggio sul nodo</option>
              <option value="manual">Manuale (pulsante nel Playtest)</option>
            </select>
          </Field>
          <div className={styles.row2}>
            <NumberField id={`i-dur-${i.id}`} label="Durata (s)" value={i.duration} min={0.1} max={30} step={0.5} onCommit={(v) => patch(i.id, { duration: v })} />
            <TextField id={`i-req-${i.id}`} label="Abilità richieste" value={i.requires.join(', ')} onCommit={(v) => patch(i.id, { requires: v.split(',').map((s) => s.trim()).filter(Boolean) })} />
          </div>
          <TextField id={`i-msg-${i.id}`} label="Messaggio" value={i.message} onCommit={(v) => patch(i.id, { message: v })} />
          <TextField id={`i-evt-${i.id}`} label="Evento per il gioco ospite" value={i.event} onCommit={(v) => patch(i.id, { event: v })} />
          {i.kind === 'collect' && <TextField id={`i-item-${i.id}`} label="Nome dell’oggetto raccolto (inventario)" value={i.props.item ?? ''} onCommit={(v) => patch(i.id, { props: { ...i.props, item: v } })} />}
          <CheckField id={`i-once-${i.id}`} label="Una sola volta per partita" checked={i.once} onChange={(v) => patch(i.id, { once: v })} />
          <PropsField id={`i-props-${i.id}`} value={i.props} onCommit={(p) => patch(i.id, { props: p })} />
        </div>
      ))}
      <button className={styles.btn} onClick={() => setAll([...o.interactions, newInteraction('collect')])} data-testid="add-interaction">{Icon.plus}Aggiungi interazione</button>
    </div>
  );
}
