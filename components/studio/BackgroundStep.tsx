'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyParams } from '@/types';
import { DEFAULT_KEYING, estimateKeyColor, keyBackground, type Img } from '@/engine/puppet/imageProc';
import { imgToCanvas, updatePuppet } from '@/lib/studio/pipeline';
import { ZoomCanvas } from './ZoomCanvas';
import { ed, st, Slider, useAssetImage, type StepProps } from './shared';
import { CheckField } from '../inspector/fields';

const hex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Step 2 — background removal with tolerances. The result is previewed here and applied when the views are generated. */
export function BackgroundStep({ store, puppet, projectId, go }: StepProps) {
  const src = useAssetImage(projectId, puppet.source?.assetId);
  const [params, setParams] = useState<KeyParams>(puppet.keying);
  const [mode, setMode] = useState<'result' | 'original' | 'split'>('result');
  const [pick, setPick] = useState(false);
  const [version, setVersion] = useState(0);
  const result = useRef<{ img: Img; canvas: HTMLCanvasElement } | null>(null);
  const auto = useMemo(() => (src ? estimateKeyColor(src.img) : null), [src]);
  const key = params.color ?? auto;

  useEffect(() => {
    if (!src) return;
    const t = setTimeout(() => {
      const img = keyBackground(src.img, params);
      result.current = { img, canvas: imgToCanvas(img, result.current?.canvas) };
      setVersion((v) => v + 1);
    }, 120);
    return () => clearTimeout(t);
  }, [src, params]);

  const set = (patch: Partial<KeyParams>, commit = false) => {
    const next = { ...params, ...patch }; setParams(next);
    if (commit) updatePuppet(store, puppet.id, (p) => ({ ...p, keying: next }));
  };
  const commit = () => updatePuppet(store, puppet.id, (p) => ({ ...p, keying: params }));

  if (!puppet.source) return <div className={st.empty}>Importa prima il foglio (passo 1).</div>;
  return (
    <div className={st.main}>
      <div className={st.stage}>
        <div className={st.toolbar}>
          <div className={ed.seg} role="group" aria-label="Anteprima">
            {([['result', 'Risultato'], ['original', 'Originale'], ['split', 'Confronto']] as const).map(([m, l]) => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{l}</button>)}
          </div>
          <button className={ed.btn} aria-pressed={pick} onClick={() => setPick((p) => !p)} style={pick ? { borderColor: 'var(--accent)' } : undefined} data-testid="eyedropper">Contagocce: clicca lo sfondo</button>
          <button className={`${ed.btn} ${ed.btnPrimary}`} onClick={() => { commit(); go(2); }} data-testid="next-step">Avanti: viste →</button>
        </div>
        <div className={st.canvasWrap}>
          {src && <ZoomCanvas contentWidth={src.img.width} contentHeight={src.img.height} version={version} fitKey={puppet.source.assetId} checker={mode !== 'original'} cursor={pick ? 'crosshair' : 'default'} testId="bg-canvas"
            onPointer={(e) => {
              if (e.type !== 'down' || !pick) return;
              const x = Math.round(e.x), y = Math.round(e.y);
              if (x < 0 || y < 0 || x >= src.img.width || y >= src.img.height) return;
              const i = (y * src.img.width + x) * 4; set({ color: [src.img.data[i], src.img.data[i + 1], src.img.data[i + 2]] }, true); setPick(false);
            }}
            draw={(ctx) => {
              const r = result.current;
              if (mode === 'original' || !r) { ctx.drawImage(src.canvas, 0, 0); return; }
              if (mode === 'result') { ctx.drawImage(r.canvas, 0, 0); return; }
              const half = src.img.width / 2;
              ctx.save(); ctx.beginPath(); ctx.rect(0, 0, half, src.img.height); ctx.clip(); ctx.drawImage(src.canvas, 0, 0); ctx.restore();
              ctx.save(); ctx.beginPath(); ctx.rect(half, 0, half, src.img.height); ctx.clip(); ctx.drawImage(r.canvas, 0, 0); ctx.restore();
              ctx.strokeStyle = '#4f8cff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(half, 0); ctx.lineTo(half, src.img.height); ctx.stroke();
            }} />}
        </div>
      </div>
      <aside className={st.panel} aria-label="Parametri sfondo">
        <div className={ed.section}>
          <h4>Colore dello sfondo</h4>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {key && <span className={st.swatch} style={{ background: hex(key) }} />}<span className={ed.help}>{params.color ? 'Scelto da te' : 'Rilevato dai bordi'} {key ? hex(key) : ''}</span>
          </div>
          <div className={ed.row2}>
            <button className={ed.btn} onClick={() => set({ color: null }, true)}>Automatico</button>
            <button className={ed.btn} onClick={() => { setParams({ ...DEFAULT_KEYING }); updatePuppet(store, puppet.id, (p) => ({ ...p, keying: { ...DEFAULT_KEYING } })); }}>Ripristina</button>
          </div>
        </div>
        <div className={ed.section}>
          <h4>Tolleranze</h4>
          <Slider id="k-tol" label="Tolleranza colore" value={params.tolerance} min={2} max={120} onChange={(v) => set({ tolerance: v })} onCommit={commit} />
          <span className={ed.help}>Più alta = rimuove anche sfondi non uniformi o sporchi (JPEG). Troppo alta = mangia i colori chiari del personaggio.</span>
          <Slider id="k-fea" label="Morbidezza del bordo" value={params.feather} min={1} max={90} onChange={(v) => set({ feather: v })} onCommit={commit} />
          <Slider id="k-cho" label="Restringi (+) / allarga (−) il contorno" value={params.choke} min={-6} max={6} onChange={(v) => set({ choke: v })} onCommit={commit} fmt={(v) => `${v} px`} />
          <Slider id="k-def" label="Pulizia alone del colore" value={Math.round(params.defringe * 100)} min={0} max={100} onChange={(v) => set({ defringe: v / 100 })} onCommit={commit} fmt={(v) => `${v}%`} />
          <Slider id="k-isl" label="Elimina macchie più piccole di" value={params.minIsland} min={0} max={2000} step={10} onChange={(v) => set({ minIsland: v })} onCommit={commit} fmt={(v) => `${v} px²`} />
          <CheckField id="k-flood" label="Rimuovi solo lo sfondo collegato ai bordi" checked={params.floodFromBorder} onChange={(v) => set({ floodFromBorder: v }, true)} />
          <span className={ed.help}>Attivo: i dettagli bianchi dentro il personaggio restano. Disattivo: rimuove ogni pixel di quel colore.</span>
        </div>
        <div className={ed.section}><span className={ed.help}>Eventuali difetti rimasti si ritoccano con la gomma nel passo 3, vista per vista.</span></div>
      </aside>
    </div>
  );
}
