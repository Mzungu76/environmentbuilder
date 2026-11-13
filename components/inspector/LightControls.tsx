'use client';

import { useEffect, useRef, useState } from 'react';
import type { Environment } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import { lightMapPixels } from '@/engine/game/light';
import { computeLightMap, DEFAULT_LIGHT_PRECISION, LIGHT_PRECISIONS } from '@/lib/studio/lightmap';
import { CheckField, NumberField } from './fields';
import styles from '../editor/editor.module.css';

/** Light on the characters: they take the brightness and hue of the zone of the background they stand in. */
export function LightControls({ store, env }: { store: EditorStore; env: Environment }) {
  const L = env.lighting, map = env.lightMap;
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const cv = useRef<HTMLCanvasElement>(null);

  const recompute = async (enable?: boolean, precision?: number) => {
    setBusy(true); setMsg(null);
    try {
      const m = await computeLightMap(store.project.id, store.env, precision ?? store.env.lighting?.precision);
      if (!m) { setMsg('Nessuna immagine di sfondo da cui ricavare la luce.'); return; }
      store.commitEnv((e) => ({ ...e, lightMap: m, lighting: { strength: e.lighting?.strength ?? 0.7, enabled: enable ?? e.lighting?.enabled ?? true, precision: precision ?? e.lighting?.precision ?? DEFAULT_LIGHT_PRECISION } }));
    } catch (e) { setMsg(`Calcolo non riuscito: ${e instanceof Error ? e.message : e}`); } finally { setBusy(false); }
  };

  useEffect(() => {
    const c = cv.current; if (!c || !map) return;
    const px = lightMapPixels(map); c.width = px.w; c.height = px.h;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.rgba), px.w, px.h), 0, 0);
  }, [map]);

  return (
    <>
      <h4 style={{ marginTop: 8 }}>Luce sul personaggio</h4>
      <CheckField id="light-on" label="Il personaggio prende la luce della zona in cui si trova" checked={!!L?.enabled}
        onChange={(v) => { if (v && !map) void recompute(true); else store.commitEnv((e) => ({ ...e, lighting: { strength: e.lighting?.strength ?? 0.7, enabled: v, precision: e.lighting?.precision } })); }} />
      {L?.enabled && (
        <>
          <NumberField id="light-str" label="Intensità (%)" value={Math.round(L.strength * 100)} min={0} max={100} step={5} onCommit={(v) => store.commitEnv((e) => ({ ...e, lighting: { enabled: true, strength: v / 100, precision: e.lighting?.precision } }))} />
          <label className={styles.help} htmlFor="light-prec">Precisione della mappa: {env.lighting?.precision ?? DEFAULT_LIGHT_PRECISION} celle di larghezza{map ? ` (${map.w}×${map.h})` : ''}</label>
          <select id="light-prec" className={styles.select} value={env.lighting?.precision ?? DEFAULT_LIGHT_PRECISION} disabled={busy} onChange={(e) => void recompute(undefined, Number(e.target.value))} data-testid="light-precision">
            {LIGHT_PRECISIONS.map((n) => <option key={n} value={n}>{n}{n >= 384 ? ' (molto precisa, file più grande)' : n === 256 ? ' (consigliata)' : ''}</option>)}
          </select>
          {map && <canvas ref={cv} aria-label="Mappa della luce ricavata dallo sfondo" style={{ width: '100%', imageRendering: 'pixelated', borderRadius: 6, border: '1px solid var(--border)' }} data-testid="light-map" />}
          <button className={styles.btn} disabled={busy} onClick={() => void recompute()} data-testid="light-recompute">{busy ? 'Calcolo…' : 'Ricalcola dallo sfondo'}</button>
          <span className={styles.help}>La luce è ricavata dall’immagine: nelle zone scure il personaggio si scurisce, sotto un fascio azzurro si tinge di azzurro. Ricalcola se cambi lo sfondo o i livelli. La «Resa nella scena» del personaggio (luminosità, tinta propria) si somma a questa.</span>
        </>
      )}
      {msg && <span className={styles.warn} role="alert">{msg}</span>}
    </>
  );
}
