'use client';

import { useState } from 'react';
import type { CustomProfile, Environment } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import { allEdgeTypes, allProfiles } from '@/engine/profiles';
import { getMovementType } from '@/engine/movement/movementTypes';
import { OBJECT_TYPES } from '@/engine/interaction/objects';
import { uid } from '@/lib/ids';
import { Field } from './fields';
import styles from '../editor/editor.module.css';

/** Profile selector (built-in + project profiles) and a small editor for user-defined profiles. */
export function ProfilesPanel({ store, env }: { store: EditorStore; env: Environment }) {
  const customs = store.project.customProfiles;
  const profiles = allProfiles(customs);
  const [draft, setDraft] = useState<CustomProfile | null>(null);

  const toggle = (id: string) => store.commitEnv((e) => {
    const has = e.profiles.includes(id);
    let next = has ? e.profiles.filter((p) => p !== id) : [...e.profiles.filter((p) => p !== 'custom' || id === 'custom'), id];
    if (id === 'custom' && !has) next = ['custom'];
    return { ...e, profiles: next.length ? next : ['custom'] };
  });
  const toggleIn = <K extends 'suggestedEdgeTypes' | 'suggestedObjectTypes'>(key: K, v: string) =>
    setDraft((d) => d && ({ ...d, [key]: d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v] }));
  const save = () => {
    if (!draft || !draft.label.trim()) return;
    store.commitProject((p) => ({ ...p, customProfiles: p.customProfiles.some((c) => c.id === draft.id) ? p.customProfiles.map((c) => (c.id === draft.id ? draft : c)) : [...p.customProfiles, draft] }));
    setDraft(null);
  };
  const remove = (id: string) => store.commitProject((p) => ({
    ...p, customProfiles: p.customProfiles.filter((c) => c.id !== id),
    environments: p.environments.map((e) => (e.profiles.includes(id) ? { ...e, profiles: e.profiles.filter((x) => x !== id).length ? e.profiles.filter((x) => x !== id) : ['custom'] } : e)),
  }));

  return (
    <div className={styles.section} data-testid="profiles-panel">
      <h4>Profili</h4>
      <div className={styles.checkGrid}>
        {profiles.map((p) => (
          <button key={p.id} className={styles.chip} aria-pressed={env.profiles.includes(p.id)} title={p.description} onClick={() => toggle(p.id)}>{p.label}</button>
        ))}
      </div>
      <span className={styles.help}>I profili suggeriscono soltanto i tipi. Nulla è limitato; se ne possono combinare più di uno.</span>
      {!draft && (
        <div className={styles.row2}>
          <button className={styles.btn} data-testid="profile-new" onClick={() => setDraft({ id: uid('profile'), label: '', description: '', suggestedEdgeTypes: [], suggestedNodeTypes: [], suggestedObjectTypes: [] })}>Nuovo profilo…</button>
          {customs.length > 0 && <span className={styles.help}>{customs.length} personalizzat{customs.length === 1 ? 'o' : 'i'}</span>}
        </div>
      )}
      {!draft && customs.map((c) => (
        <div key={c.id} className={styles.listItem} style={{ cursor: 'default' }}>
          <span>{c.label}</span>
          <span style={{ display: 'flex', gap: 4 }}>
            <button className={styles.btn} style={{ height: 26 }} onClick={() => setDraft(c)}>Modifica</button>
            <button className={`${styles.btn} ${styles.btnDanger}`} style={{ height: 26 }} onClick={() => remove(c.id)} aria-label={`Elimina profilo ${c.label}`}>Elimina</button>
          </span>
        </div>
      ))}
      {draft && (
        <div style={{ display: 'grid', gap: 10, padding: 10, border: '1px solid var(--border-strong)', borderRadius: 8 }}>
          <Field label="Nome del profilo" id="pf-name"><input id="pf-name" className={styles.input} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} data-testid="profile-name" /></Field>
          <Field label="Descrizione" id="pf-desc"><input id="pf-desc" className={styles.input} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
          <Field label="Collegamenti suggeriti" id="pf-edges">
            <div className={styles.checkGrid}>{allEdgeTypes().map((t) => <button key={t} className={styles.chip} aria-pressed={draft.suggestedEdgeTypes.includes(t)} onClick={() => toggleIn('suggestedEdgeTypes', t)}>{getMovementType(t).label}</button>)}</div>
          </Field>
          <Field label="Oggetti suggeriti" id="pf-objs">
            <div className={styles.checkGrid}>{OBJECT_TYPES.map((t) => <button key={t.id} className={styles.chip} aria-pressed={draft.suggestedObjectTypes.includes(t.id)} onClick={() => toggleIn('suggestedObjectTypes', t.id)}>{t.label}</button>)}</div>
          </Field>
          <div className={styles.row2}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!draft.label.trim()} onClick={save} data-testid="profile-save">Salva profilo</button>
            <button className={styles.btn} onClick={() => setDraft(null)}>Annulla</button>
          </div>
        </div>
      )}
    </div>
  );
}
