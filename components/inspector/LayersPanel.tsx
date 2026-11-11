'use client';

import { useRef, useState } from 'react';
import type { Environment, LayerRole } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import { moveLayer, removeLayer, ROLE_LABEL, updateLayer } from '@/engine/scene/layers';
import { importBackground, importLayer } from '@/lib/import-export/background';
import { ACCEPTED_IMAGE_TYPES } from '@/lib/import-export/image';
import { CheckField, NumberField } from './fields';
import { Icon } from '@/components/ui/icons';
import styles from '../editor/editor.module.css';

/** Layer manager: background (mandatory), midground and foreground, with visibility, order, offset and opacity. */
export function LayersPanel({ store, env }: { store: EditorStore; env: Environment }) {
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pick = useRef<{ role: LayerRole | 'replace-bg' } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const ask = (role: LayerRole | 'replace-bg') => { pick.current = { role }; file.current?.click(); };

  const onFile = async (f?: File) => {
    const role = pick.current?.role; if (!f || !role) return;
    setErr(null);
    try { if (role === 'replace-bg') await importBackground(store, f); else if (role !== 'background') await importLayer(store, role, f); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const roles: LayerRole[] = ['foreground', 'midground', 'background'];
  return (
    <div className={styles.section} data-testid="layers-panel">
      <h4>Livelli grafici</h4>
      {roles.map((role) => {
        const items = env.layers.filter((l) => l.role === role).slice().reverse(); // front first
        return (
          <div key={role} className={styles.list}>
            <span className={styles.help}>{ROLE_LABEL[role]}{role === 'background' ? ' (obbligatorio)' : ''}</span>
            {items.length === 0 && role !== 'background' && <span className={styles.help} style={{ opacity: .7 }}>Nessun livello</span>}
            {items.map((l) => {
              const asset = env.assets.find((a) => a.id === l.assetId);
              return (
                <div key={l.id} style={{ display: 'grid', gap: 6 }} data-testid="layer-row">
                  <div className={styles.listItem} style={{ cursor: 'default' }}>
                    <button className={`${styles.btn} ${styles.iconBtn}`} style={{ height: 26, width: 26 }} aria-pressed={l.visible} aria-label={l.visible ? 'Nascondi livello' : 'Mostra livello'} title={l.visible ? 'Nascondi' : 'Mostra'}
                      onClick={() => store.commitEnv((e) => updateLayer(e, l.id, { visible: !l.visible }))}>{l.visible ? Icon.eye : Icon.eyeOff}</button>
                    <button style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>{asset?.fileName ?? l.name}</button>
                    {role !== 'background' && (
                      <>
                        <button className={`${styles.btn} ${styles.iconBtn}`} style={{ height: 26, width: 26 }} aria-label="Porta avanti" title="Porta avanti" onClick={() => store.commitEnv((e) => moveLayer(e, l.id, 'up'))}>{Icon.up}</button>
                        <button className={`${styles.btn} ${styles.iconBtn}`} style={{ height: 26, width: 26 }} aria-label="Porta indietro" title="Porta indietro" onClick={() => store.commitEnv((e) => moveLayer(e, l.id, 'down'))}>{Icon.down}</button>
                      </>
                    )}
                  </div>
                  {open === l.id && (
                    <div style={{ display: 'grid', gap: 8, padding: '4px 4px 8px' }}>
                      <div className={styles.row2}>
                        <NumberField id={`l-x-${l.id}`} label="Spostamento X (px)" value={Math.round(l.offsetX * env.width)} onCommit={(v) => store.commitEnv((e) => updateLayer(e, l.id, { offsetX: v / env.width }))} />
                        <NumberField id={`l-y-${l.id}`} label="Spostamento Y (px)" value={Math.round(l.offsetY * env.height)} onCommit={(v) => store.commitEnv((e) => updateLayer(e, l.id, { offsetY: v / env.height }))} />
                      </div>
                      <NumberField id={`l-o-${l.id}`} label="Opacità (%)" value={Math.round(l.opacity * 100)} min={0} max={100} onCommit={(v) => store.commitEnv((e) => updateLayer(e, l.id, { opacity: v / 100 }))} />
                      <CheckField id={`l-v-${l.id}`} label="Visibile" checked={l.visible} onChange={(v) => store.commitEnv((e) => updateLayer(e, l.id, { visible: v }))} />
                      {role === 'background'
                        ? <button className={styles.btn} onClick={() => ask('replace-bg')}>{Icon.image}Sostituisci immagine</button>
                        : <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => { store.commitEnv((e) => removeLayer(e, l.id)); setOpen(null); }}>{Icon.trash}Elimina livello</button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      <div className={styles.row2}>
        <button className={styles.btn} onClick={() => ask('midground')} data-testid="add-mid">{Icon.plus}Piano intermedio</button>
        <button className={styles.btn} onClick={() => ask('foreground')} data-testid="add-fore">{Icon.plus}Primo piano</button>
      </div>
      <span className={styles.help}>Il primo piano è disegnato sopra i personaggi. Usa PNG con trasparenza della stessa dimensione dello sfondo.</span>
      {err && <span className={styles.warn} role="alert">{err}</span>}
      <input ref={file} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden data-testid="layer-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onFile(f); }} />
    </div>
  );
}
