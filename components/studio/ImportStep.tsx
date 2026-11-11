'use client';

import { useRef, useState } from 'react';
import silhouetteMod from '@/docs/guida-di-prova/guida-silhouette.png';
import mapMod from '@/docs/guida-di-prova/guida-mappa-parti.png';
import promptText from '@/docs/guida-di-prova/prompt-guida.txt';
import posesMod from '@/docs/guida-di-prova/guida-pose-extra.png';
import posesPrompt from '@/docs/guida-di-prova/prompt-pose-extra.txt';
import { readImageFile, ACCEPTED_IMAGE_TYPES } from '@/lib/import-export/image';
import { putAsset } from '@/lib/persistence/db';
import { updatePuppet, pruneAssets } from '@/lib/studio/pipeline';
import { ZoomCanvas } from './ZoomCanvas';
import { ed, st, useAssetImage, type StepProps } from './shared';

const url = (m: unknown): string => (typeof m === 'string' ? m : (m as { src: string }).src);

/** Step 1 — import the turnaround sheet (or consult the guide to make one). */
export function ImportStep({ store, puppet, projectId, go }: StepProps) {
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<File | null>(null);
  const [copied, setCopied] = useState(false);
  const src = useAssetImage(projectId, puppet.source?.assetId);
  const hasViews = Object.keys(puppet.views).length > 0;

  const load = async (f: File) => {
    setErr(null);
    try {
      const { meta, blob } = await readImageFile(f);
      await putAsset(projectId, meta.id, blob);
      updatePuppet(store, puppet.id, (p) => ({ ...p, source: { assetId: meta.id, width: meta.width, height: meta.height }, assets: [...p.assets, meta], views: {} }));
      await pruneAssets(store, puppet.id);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const pick = (f?: File) => { if (!f) return; if (hasViews) setConfirm(f); else void load(f); };

  return (
    <div className={st.main}>
      <div className={st.stage}>
        <div className={st.toolbar}>
          <button className={`${ed.btn} ${ed.btnPrimary}`} onClick={() => file.current?.click()} data-testid="sheet-import">{puppet.source ? 'Sostituisci foglio…' : 'Importa foglio di rotazione…'}</button>
          {puppet.source && <button className={ed.btn} onClick={() => go(1)} data-testid="next-step">Avanti: rimuovi lo sfondo →</button>}
          {puppet.source && <span className={ed.help}>{puppet.source.width} × {puppet.source.height}px</span>}
        </div>
        <div className={st.canvasWrap}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
          {src ? <ZoomCanvas contentWidth={src.img.width} contentHeight={src.img.height} version={1} fitKey={puppet.source?.assetId} checker
            draw={(ctx) => ctx.drawImage(src.canvas, 0, 0)} />
            : <div className={st.empty}><div><h2 style={{ margin: '0 0 6px', color: 'var(--text)' }}>Importa il foglio di rotazione</h2><p style={{ margin: 0 }}>Trascina qui un’immagine (PNG, JPG, WebP) con le tre viste del personaggio — fronte, profilo verso destra, retro — oppure usa la guida a destra per farla generare.</p></div></div>}
        </div>
        {confirm && <div className={ed.banner} style={{ position: 'static' }} role="alert">Sostituendo il foglio si perdono viste, scheletro e pesi già creati. <button onClick={() => { void load(confirm); setConfirm(null); }}>Sostituisci</button><button onClick={() => setConfirm(null)}>Annulla</button></div>}
        {err && <div className={ed.banner} style={{ position: 'static' }} role="alert">{err}</div>}
        <input ref={file} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden data-testid="sheet-file" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <aside className={st.panel} aria-label="Guida per l’AI">
        <div className={ed.section}>
          <h4>Come ottenere il foglio</h4>
          <span className={ed.help}>Il builder non genera immagini: prepara una guida da dare al tuo generatore AI e poi importa il risultato. Le tolleranze (sfondo, proporzioni, allineamento) si correggono nei passi successivi.</span>
        </div>
        <div className={ed.section}>
          <h4>1 · Immagine di riferimento</h4>
          <img className={st.guideImg} src={url(silhouetteMod)} alt="Guida: sagoma in tre viste" />
          <a className={ed.btn} href={url(silhouetteMod)} download="guida-silhouette.png">Scarica la sagoma</a>
          <a className={ed.btn} href={url(mapMod)} download="guida-mappa-parti.png">Scarica la mappa delle parti</a>
        </div>
        <div className={ed.section}>
          <h4>2 · Prompt</h4>
          <div className={st.promptBox} data-testid="prompt-text">{promptText}</div>
          <button className={ed.btn} onClick={async () => { try { await navigator.clipboard.writeText(promptText); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setErr('Copia non riuscita: seleziona il testo a mano.'); } }}>{copied ? 'Copiato ✓' : 'Copia il prompt'}</button>
          <span className={ed.help}>Compila i parametri tra {'{{ }}'} (personaggio, vestiti, palette, stile, sfondo).</span>
        </div>
        <div className={ed.section}>
          <h4>3 · Pose aggiuntive: arrampicata e salto (opzionale)</h4>
          <span className={ed.help}>Si generano dopo il foglio, usando come riferimento il personaggio già approvato. Si importano nel passo 3 («Pose aggiuntive»).</span>
          <img className={st.guideImg} src={url(posesMod)} alt="Guida: pose di arrampicata e salto" />
          <a className={ed.btn} href={url(posesMod)} download="guida-pose-extra.png">Scarica la sagoma delle pose</a>
          <div className={st.promptBox} data-testid="prompt-poses">{posesPrompt}</div>
          <button className={ed.btn} onClick={async () => { try { await navigator.clipboard.writeText(posesPrompt); } catch { setErr('Copia non riuscita: seleziona il testo a mano.'); } }}>Copia il prompt delle pose</button>
        </div>
      </aside>
    </div>
  );
}
