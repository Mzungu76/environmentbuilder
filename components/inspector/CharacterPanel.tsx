'use client';

import Link from 'next/link';
import type { Character, Environment } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import { Field, TextField } from './fields';
import { AppearanceFields, BehaviorFields } from './CharacterFields';
import { SpriteEditor } from './SpriteEditor';
import styles from '../editor/editor.module.css';

export function CharacterPanel({ store, env, c }: { store: EditorStore; env: Environment; c: Character }) {
  const set = (patch: Partial<Character>) => store.commitEnv((e) => ({ ...e, characters: e.characters.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) }));
  return (
    <>
      <div className={styles.section}>
        <TextField id="c-id" label="ID" value={c.id} readOnly mono />
        <TextField id="c-name" label="Nome" value={c.name} onCommit={(v) => set({ name: v })} />
        <Field label="Nodo di partenza" id="c-start" help="Si può anche impostare con lo strumento Personaggio cliccando un nodo.">
          <select id="c-start" className={styles.select} value={c.startNodeId ?? ''} onChange={(e) => set({ startNodeId: e.target.value || null })}>
            <option value="">— nessuno —</option>
            {env.navigation.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </Field>
      </div>
      <div className={styles.section}><h4>Aspetto</h4><AppearanceFields store={store} c={c} idp="c" /></div>
      <div className={styles.section}>
        <h4>Modellino (Studio personaggi)</h4>
        <Field label="Aspetto con scheletro" id="c-puppet" help="Se scelto, ha la precedenza su sprite e segnaposto. Si crea nello Studio personaggi.">
          <select id="c-puppet" className={styles.select} value={c.puppetId ?? ''} onChange={(e) => set({ puppetId: e.target.value || null })} data-testid="char-puppet">
            <option value="">— nessuno —</option>
            {store.project.puppets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Link className={styles.btn} href={`/studio?id=${store.project.id}`} style={{ textDecoration: 'none' }}>Apri lo Studio personaggi</Link>
      </div>
      <SpriteEditor store={store} env={env} c={c} />
      <div className={styles.section}>
        <h4>Capacità</h4>
        <TextField id="c-abil" label="Abilità" value={c.abilities.join(', ')} onCommit={(v) => set({ abilities: v.split(',').map((s) => s.trim()).filter(Boolean) })} />
        <span className={styles.help}>Separate da virgola. Un collegamento con requisiti (es. can-climb) è percorribile solo se il personaggio ha tutte le abilità richieste.</span>
      </div>
      <div className={styles.section}>
        <h4>Comportamento</h4>
        <Field label="Modalità di movimento" id="c-mode">
          <select id="c-mode" className={styles.select} value={c.behavior.mode} onChange={(e) => store.commitEnv((en) => ({ ...en, characters: en.characters.map((x) => (x.id === c.id ? { ...x, behavior: { ...x.behavior, mode: e.target.value as 'manual' | 'autonomous' } } : x)) }))}>
            <option value="manual">Manuale (test)</option>
            <option value="autonomous">Autonomo</option>
          </select>
        </Field>
        <BehaviorFields store={store} c={c} idp="c" />
      </div>
    </>
  );
}
