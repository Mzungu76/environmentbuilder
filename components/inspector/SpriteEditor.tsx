'use client';

import { useRef, useState } from 'react';
import type { Character, CharacterState, Environment } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import { importCharacterSprite } from '@/lib/import-export/background';
import { ACCEPTED_IMAGE_TYPES } from '@/lib/import-export/image';
import { framesToText, parseFrames } from '@/engine/characters/sprites';
import { uid } from '@/lib/ids';
import { CheckField, NumberField, TextField } from './fields';
import { Icon } from '@/components/ui/icons';
import styles from '../editor/editor.module.css';

const STATES: { id: CharacterState; label: string }[] = [
  { id: 'IDLE', label: 'IDLE · fermo' }, { id: 'WALK', label: 'WALK · cammina' }, { id: 'CLIMB', label: 'CLIMB · arrampica' },
  { id: 'INTERACT', label: 'INTERACT · interagisce' }, { id: 'COLLECT', label: 'COLLECT · raccoglie' }, { id: 'JUMP', label: 'JUMP · salta' },
  { id: 'FALL', label: 'FALL · cade' }, { id: 'CUSTOM', label: 'CUSTOM' },
];

/** Static sprite or sprite sheet + per-state animations. Without an image a procedural placeholder is drawn. */
export function SpriteEditor({ store, env, c }: { store: EditorStore; env: Environment; c: Character }) {
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<Character>) => store.commitEnv((e) => ({ ...e, characters: e.characters.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) }));
  const asset = env.assets.find((a) => a.id === (c.spriteSheet?.assetId ?? c.spriteAssetId));
  const sheet = c.spriteSheet;
  const cols = sheet && asset ? Math.floor(asset.width / sheet.frameWidth) : 0, rows = sheet && asset ? Math.floor(asset.height / sheet.frameHeight) : 0;

  const anim = (st: CharacterState) => c.animations.find((a) => a.state === st);
  const setAnim = (st: CharacterState, patch: Partial<{ frames: number[]; fps: number; loop: boolean }>) => {
    const ex = anim(st);
    set({ animations: ex ? c.animations.map((a) => (a.state === st ? { ...a, ...patch } : a)) : [...c.animations, { id: uid('anim'), name: st.toLowerCase(), state: st, frames: [], fps: 8, loop: true, ...patch }] });
  };

  return (
    <div className={styles.section} data-testid="sprite-editor">
      <h4>Sprite e animazioni</h4>
      {asset ? <span className={styles.help} style={{ color: 'var(--text-dim)' }}>{asset.fileName} · {asset.width}×{asset.height}px</span>
        : <span className={styles.help}>Nessuna immagine: è usato un personaggio provvisorio disegnato dal programma.</span>}
      <div className={styles.row2}>
        <button className={styles.btn} onClick={() => file.current?.click()} data-testid="sprite-import">{Icon.image}{asset ? 'Sostituisci' : 'Importa sprite'}</button>
        {asset && <button className={styles.btn} onClick={() => set({ spriteAssetId: null, spriteSheet: null })}>{Icon.trash}Rimuovi</button>}
      </div>
      {err && <span className={styles.warn} role="alert">{err}</span>}
      <input ref={file} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden data-testid="sprite-file"
        onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setErr(null); try { await importCharacterSprite(store, c.id, f); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } }} />

      {asset && (
        <>
          <CheckField id="sp-sheet" label="È uno sprite sheet (griglia di fotogrammi)" checked={!!sheet}
            onChange={(v) => set({ spriteSheet: v ? { assetId: asset.id, frameWidth: Math.max(1, Math.floor(asset.width / 4)), frameHeight: asset.height } : null })} />
          {sheet && (
            <>
              <div className={styles.row2}>
                <NumberField id="sp-fw" label="Larghezza fotogramma (px)" value={sheet.frameWidth} min={1} max={asset.width} onCommit={(v) => set({ spriteSheet: { ...sheet, frameWidth: v } })} />
                <NumberField id="sp-fh" label="Altezza fotogramma (px)" value={sheet.frameHeight} min={1} max={asset.height} onCommit={(v) => set({ spriteSheet: { ...sheet, frameHeight: v } })} />
              </div>
              <span className={styles.help}>Griglia: {cols} colonne × {rows} righe = {cols * rows} fotogrammi, numerati da 0 a destra e poi verso il basso. Lo sprite deve guardare a destra: a sinistra viene specchiato.</span>
              {STATES.map((s) => {
                const a = anim(s.id);
                return (
                  <div key={s.id} style={{ display: 'grid', gap: 6, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                    <TextField id={`an-${s.id}`} label={s.label} value={a ? framesToText(a.frames) : ''} onCommit={(v) => setAnim(s.id, { frames: parseFrames(v).filter((n) => n < Math.max(1, cols * rows)) })} />
                    <div className={styles.row2}>
                      <NumberField id={`an-fps-${s.id}`} label="Fotogrammi/s" value={a?.fps ?? 8} min={1} max={60} onCommit={(v) => setAnim(s.id, { fps: v })} />
                      <CheckField id={`an-loop-${s.id}`} label="Ripeti" checked={a?.loop ?? true} onChange={(v) => setAnim(s.id, { loop: v })} />
                    </div>
                  </div>
                );
              })}
              <span className={styles.help}>Fotogrammi come «0-3» o «0, 2, 4». Uno stato senza animazione usa IDLE.</span>
            </>
          )}
        </>
      )}
    </div>
  );
}
