'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { EdgeDirection, Environment, NavigationEdge, NavigationNode, ProfileId } from '@/types';
import type { EditorStore, Selection } from '@/lib/store/editorStore';
import { reverseEdge, updateEdge, updateNode, validateGraph, moveNode } from '@/engine/navigation/graph';
import { edgeLengthPx } from '@/engine/navigation/geometry';
import { ALL_EDGE_TYPES, ALL_NODE_TYPES, PROFILES, suggestedTypes } from '@/engine/profiles';
import { Icon } from '@/components/ui/icons';
import styles from '../editor/editor.module.css';

/* ---- small field components: commit on blur / Enter so each edit is ONE undo step ------------ */

function Field({ label, children, help, id }: { label: string; children: ReactNode; help?: string; id?: string }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {help && <span className={styles.help}>{help}</span>}
    </div>
  );
}

function TextField({ label, value, onCommit, readOnly, mono, id }: { label: string; value: string; onCommit?: (v: string) => void; readOnly?: boolean; mono?: boolean; id: string }) {
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

function NumberField({ label, value, onCommit, min, max, step = 1, id, help }: { label: string; value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; id: string; help?: string }) {
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

function PropsField({ id, value, onCommit }: { id: string; value: Record<string, string>; onCommit: (p: Record<string, string>) => void }) {
  const text = propsToText(value);
  const [v, setV] = useState(text);
  useEffect(() => setV(text), [text]);
  return (
    <Field label="Custom properties" id={id} help="One key=value per line. Free-form data for your game.">
      <textarea id={id} className={styles.textarea} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== text) onCommit(textToProps(v)); }} spellCheck={false} />
    </Field>
  );
}

/* ---- inspector -------------------------------------------------------------------------------- */

interface Props { store: EditorStore; env: Environment; selection: Selection; revision: number; open?: boolean; onFit: () => void; onReplaceImage: () => void; onToggleCurve: (id: string) => void; onDeleteSelection: () => void }

export function Inspector({ store, env, selection, open, onFit, onReplaceImage, onToggleCurve, onDeleteSelection }: Props) {
  const nav = env.navigation;
  const node = selection?.kind === 'node' ? nav.nodes.find((n) => n.id === selection.id) : undefined;
  const edge = selection?.kind === 'edge' ? nav.edges.find((e) => e.id === selection.id) : undefined;
  const select = (s: Selection) => store.setSelection(s);

  return (
    <aside className={`${styles.inspector} ${open ? styles.inspectorOpen : ''}`} aria-label="Inspector" data-testid="inspector">
      <div className={styles.inspHead}>
        <h3>{node ? 'Node' : edge ? 'Path' : 'Environment'}</h3>
        {(node || edge) && <button className={`${styles.btn} ${styles.btnDanger}`} onClick={onDeleteSelection} title="Delete (Del)" data-testid="delete-selected">{Icon.trash}Delete</button>}
      </div>
      {node ? <NodePanel store={store} env={env} node={node} select={select} />
        : edge ? <EdgePanel store={store} env={env} edge={edge} select={select} onToggleCurve={onToggleCurve} />
        : <EnvPanel store={store} env={env} onFit={onFit} onReplaceImage={onReplaceImage} />}
    </aside>
  );
}

function NodePanel({ store, env, node, select }: { store: EditorStore; env: Environment; node: NavigationNode; select: (s: Selection) => void }) {
  const nav = env.navigation;
  const sug = suggestedTypes(env.profiles);
  const types = Array.from(new Set([...ALL_NODE_TYPES, node.type]));
  const edit = (patch: Partial<NavigationNode>) => store.commitEnv((e) => ({ ...e, navigation: updateNode(e.navigation, node.id, patch) }));
  const move = (x: number, y: number) => store.commitEnv((e) => ({ ...e, navigation: moveNode(e.navigation, node.id, x, y) }));
  const links = nav.edges.filter((e) => e.from === node.id || e.to === node.id);
  return (
    <>
      <div className={styles.section}>
        <TextField id="n-id" label="ID" value={node.id} readOnly mono />
        <TextField id="n-name" label="Name" value={node.name} onCommit={(v) => edit({ name: v })} />
        <Field label="Type" id="n-type">
          <select id="n-type" className={styles.select} value={node.type} onChange={(e) => edit({ type: e.target.value })}>
            {types.map((t) => <option key={t} value={t}>{t}{sug.nodes.has(t) ? '' : ' (not in profile)'}</option>)}
          </select>
        </Field>
      </div>
      <div className={styles.section}>
        <h4>Position (px of original image)</h4>
        <div className={styles.row2}>
          <NumberField id="n-x" label="X" value={Math.round(node.x * env.width)} min={0} max={env.width} onCommit={(v) => move(v / env.width, node.y)} />
          <NumberField id="n-y" label="Y" value={Math.round(node.y * env.height)} min={0} max={env.height} onCommit={(v) => move(node.x, v / env.height)} />
        </div>
        <span className={styles.help}>Normalized: {node.x.toFixed(4)}, {node.y.toFixed(4)}</span>
      </div>
      <div className={styles.section}>
        <h4>Links ({links.length})</h4>
        <div className={styles.list}>
          {links.length === 0 && <span className={styles.warn}>Not connected. Use the Connect tool.</span>}
          {links.map((e) => {
            const otherId = e.from === node.id ? e.to : e.from;
            const other = nav.nodes.find((n) => n.id === otherId);
            return <button key={e.id} className={styles.listItem} onClick={() => select({ kind: 'edge', id: e.id })}><span>{e.from === node.id ? '→' : '←'} {other?.name ?? otherId}</span><span className={styles.badge}>{e.type}</span></button>;
          })}
        </div>
      </div>
      <div className={styles.section}><PropsField id="n-props" value={node.props} onCommit={(p) => edit({ props: p })} /></div>
    </>
  );
}

function EdgePanel({ store, env, edge, select, onToggleCurve }: { store: EditorStore; env: Environment; edge: NavigationEdge; select: (s: Selection) => void; onToggleCurve: (id: string) => void }) {
  const nav = env.navigation;
  const a = nav.nodes.find((n) => n.id === edge.from), b = nav.nodes.find((n) => n.id === edge.to);
  const sug = suggestedTypes(env.profiles);
  const types = Array.from(new Set([...ALL_EDGE_TYPES, edge.type]));
  const edit = (patch: Partial<NavigationEdge>) => store.commitEnv((e) => ({ ...e, navigation: updateEdge(e.navigation, edge.id, patch) }));
  const len = a && b ? Math.round(edgeLengthPx(a, b, edge.geometry, env.width, env.height)) : 0;
  return (
    <>
      <div className={styles.section}>
        <TextField id="e-id" label="ID" value={edge.id} readOnly mono />
        <Field label="Type" id="e-type">
          <select id="e-type" className={styles.select} value={edge.type} onChange={(e) => edit({ type: e.target.value })}>
            {types.map((t) => <option key={t} value={t}>{t}{sug.edges.has(t) ? '' : ' (not in profile)'}</option>)}
          </select>
        </Field>
      </div>
      <div className={styles.section}>
        <h4>Connection</h4>
        <div className={styles.list}>
          <button className={styles.listItem} onClick={() => a && select({ kind: 'node', id: a.id })}><span>From: {a?.name ?? edge.from}</span></button>
          <button className={styles.listItem} onClick={() => b && select({ kind: 'node', id: b.id })}><span>To: {b?.name ?? edge.to}</span></button>
        </div>
        <Field label="Allowed direction" id="e-dir">
          <select id="e-dir" className={styles.select} value={edge.direction} onChange={(e) => edit({ direction: e.target.value as EdgeDirection })}>
            <option value="both">Both ways</option>
            <option value="forward">From → To only</option>
            <option value="backward">To → From only</option>
          </select>
        </Field>
        <button className={styles.btn} onClick={() => store.commitEnv((e) => ({ ...e, navigation: reverseEdge(e.navigation, edge.id) }))}>{Icon.swap}Reverse path</button>
      </div>
      <div className={styles.section}>
        <h4>Geometry</h4>
        <button className={styles.btn} onClick={() => onToggleCurve(edge.id)} data-testid="toggle-curve">{Icon.curve}{edge.geometry.kind === 'line' ? 'Convert to curve' : 'Straighten'}</button>
        {edge.geometry.kind === 'bezier' && <span className={styles.help}>Drag the yellow handles on the scene (Select tool) to shape the curve.</span>}
        <span className={styles.help}>Length: {len}px</span>
      </div>
      <div className={styles.section}>
        <h4>Movement</h4>
        <NumberField id="e-speed" label="Speed multiplier" value={edge.speed} min={0.1} max={10} step={0.1} onCommit={(v) => edit({ speed: v })} help="Applied to the character's base speed." />
        <TextField id="e-req" label="Requirements" value={edge.requirements.join(', ')} onCommit={(v) => edit({ requirements: v.split(',').map((s) => s.trim()).filter(Boolean) })} />
        <span className={styles.help}>Comma-separated abilities a character needs (e.g. can-climb). Enforced by the simulation (Milestone 2).</span>
      </div>
      <div className={styles.section}><PropsField id="e-props" value={edge.props} onCommit={(p) => edit({ props: p })} /></div>
    </>
  );
}

function EnvPanel({ store, env, onFit, onReplaceImage }: { store: EditorStore; env: Environment; onFit: () => void; onReplaceImage: () => void }) {
  const bg = env.layers.find((l) => l.role === 'background');
  const asset = env.assets.find((a) => a.id === bg?.assetId);
  const issues = validateGraph(env.navigation);
  const toggleProfile = (id: ProfileId) => store.commitEnv((e) => {
    const has = e.profiles.includes(id);
    let next = has ? e.profiles.filter((p) => p !== id) : [...e.profiles.filter((p) => p !== 'custom' || id === 'custom'), id];
    if (id === 'custom' && !has) next = ['custom'];
    return { ...e, profiles: next.length ? next : ['custom'] };
  });
  return (
    <>
      <div className={styles.section}>
        <TextField id="env-id" label="ID" value={env.id} readOnly mono />
        <TextField id="env-name" label="Name" value={env.name} onCommit={(v) => store.commitEnv((e) => ({ ...e, name: v }))} />
      </div>
      <div className={styles.section}>
        <h4>Background image</h4>
        {asset ? (
          <div className={styles.help} style={{ color: 'var(--text-dim)' }}>
            <div>{asset.fileName}</div>
            <div>{asset.width} × {asset.height}px · {asset.mime.replace('image/', '').toUpperCase()} · {(asset.bytes / 1024).toFixed(0)} KB</div>
          </div>
        ) : <span className={styles.help}>No image yet.</span>}
        <div className={styles.row2}>
          <button className={styles.btn} onClick={onReplaceImage}>{Icon.image}{asset ? 'Replace' : 'Import'}</button>
          <button className={styles.btn} onClick={onFit}>{Icon.fit}Fit view</button>
        </div>
      </div>
      <div className={styles.section}>
        <h4>Profiles</h4>
        <div className={styles.checkGrid}>
          {(Object.keys(PROFILES) as ProfileId[]).map((id) => (
            <button key={id} className={styles.chip} aria-pressed={env.profiles.includes(id)} title={PROFILES[id].description} onClick={() => toggleProfile(id)}>{PROFILES[id].label}</button>
          ))}
        </div>
        <span className={styles.help}>Profiles only suggest types. Nothing is restricted.</span>
      </div>
      <div className={styles.section}>
        <h4>Navigation graph</h4>
        <span className={styles.help} style={{ color: 'var(--text-dim)' }}>{env.navigation.nodes.length} nodes · {env.navigation.edges.length} paths</span>
        {issues.slice(0, 6).map((i, k) => <span key={k} className={styles.warn}>{i.message}</span>)}
        {issues.length > 6 && <span className={styles.help}>+{issues.length - 6} more</span>}
      </div>
      <div className={styles.section}>
        <h4>Legend</h4>
        <div className={styles.legend}>
          {[['walk', '#2dd4bf'], ['ramp', '#fb923c'], ['climb', '#c084fc'], ['stairs', '#f472b6'], ['platform-link', '#60a5fa'], ['curve', '#4ade80']].map(([n, c]) => (
            <span key={n}><i className={styles.swatch} style={{ background: c }} />{n}</span>
          ))}
          <span><i className={styles.swatchDot} style={{ background: '#fff' }} />node · <i className={styles.swatchDot} style={{ background: '#22c55e' }} />entrance · <i className={styles.swatchDot} style={{ background: '#ef4444' }} />exit</span>
        </div>
      </div>
    </>
  );
}

