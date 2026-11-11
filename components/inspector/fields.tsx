'use client';

import { useEffect, useState, type ReactNode } from 'react';
import styles from '../editor/editor.module.css';

/* ---- small field components: commit on blur / Enter so each edit is ONE undo step ------------ */

export function Field({ label, children, help, id }: { label: string; children: ReactNode; help?: string; id?: string }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {help && <span className={styles.help}>{help}</span>}
    </div>
  );
}

export function TextField({ label, value, onCommit, readOnly, mono, id }: { label: string; value: string; onCommit?: (v: string) => void; readOnly?: boolean; mono?: boolean; id: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Field label={label} id={id}>
      <input id={id} className={styles.input} value={v} readOnly={readOnly} style={mono ? { fontFamily: 'var(--mono)', fontSize: 12 } : undefined}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (!readOnly && v !== value) onCommit?.(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value); (e.target as HTMLInputElement).blur(); } }} />
    </Field>
  );
}

export function NumberField({ label, value, onCommit, min, max, step = 1, id, help }: { label: string; value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; id: string; help?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Number(v);
    if (!Number.isFinite(n)) { setV(String(value)); return; }
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (c !== value) onCommit(c); else setV(String(value));
  };
  return (
    <Field label={label} id={id} help={help}>
      <input id={id} className={styles.input} type="number" inputMode="decimal" value={v} min={min} max={max} step={step}
        onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(String(value)); (e.target as HTMLInputElement).blur(); } }} />
    </Field>
  );
}

const propsToText = (p: Record<string, string>) => Object.entries(p).map(([k, v]) => `${k}=${v}`).join('\n');
const textToProps = (t: string) => {
  const out: Record<string, string> = {};
  for (const line of t.split('\n')) { const i = line.indexOf('='); if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return out;
};

export function PropsField({ id, value, onCommit }: { id: string; value: Record<string, string>; onCommit: (p: Record<string, string>) => void }) {
  const text = propsToText(value);
  const [v, setV] = useState(text);
  useEffect(() => setV(text), [text]);
  return (
    <Field label="Proprietà personalizzate" id={id} help="Una coppia chiave=valore per riga. Dati liberi per il tuo gioco.">
      <textarea id={id} className={styles.textarea} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== text) onCommit(textToProps(v)); }} spellCheck={false} />
    </Field>
  );
}


export function CheckField({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}
    </label>
  );
}
