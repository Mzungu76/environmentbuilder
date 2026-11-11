'use client';

import { useEffect, useRef, useState } from 'react';
import type { CharacterState, ViewId } from '@/types';
import { VIEW_IDS } from '@/types';
import { advancePhase, chooseViewForState, flipsWithFacing, poseAt, resolveView } from '@/engine/puppet/runtime';
import { createCharacter } from '@/engine/characters/factory';
import { buildPuppetPackage, validatePuppet } from '@/lib/import-export/puppetPackage';
import { downloadBlob, safeFileName } from '@/lib/import-export/archive';
import { ZoomCanvas } from './ZoomCanvas';
import { renderPuppet } from './draw';
import { ed, st, Slider, VIEW_LABEL, type StepProps } from './shared';
import { CheckField } from '../inspector/fields';
import { loadAssetImg, imgToCanvas } from '@/lib/studio/pipeline';

const STATES: CharacterState[] = ['IDLE', 'WALK', 'CLIMB', 'INTERACT', 'COLLECT', 'JUMP', 'FALL', 'CUSTOM'];

/** Step 7 — live preview of every state/view, validation, package export and use in the project's characters. */
export function ExportStep({ store, puppet, projectId }: StepProps) {
  const [state, setState] = useState<CharacterState>('WALK');
  const [forced, setForced] = useState<ViewId | null>(null);
  const [speed, setSpeed] = useState(0.75);
  const [flip, setFlip] = useState(false);
  const [ver, setVer] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const canvases = useRef<Partial<Record<ViewId, HTMLCanvasElement>>>({});
  const phase = useRef(0);
  const check = validatePuppet(puppet);
  const ready = check.errors.length === 0;

  useEffect(() => {
    let alive = true;
    (async () => { for (const v of VIEW_IDS) { const w = puppet.views[v] ? resolveView(puppet.views[v]!) : undefined; if (w?.cutoutAssetId) { const img = await loadAssetImg(projectId, w.cutoutAssetId); if (img && alive) canvases.current[v] = imgToCanvas(img); } } setVer((n) => n + 1); })();
    return () => { alive = false; };
  }, [puppet.views, projectId]);

  useEffect(() => {
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const vid = forced ?? chooseViewForState(puppet.views, state, puppet.idleView);
      const view = vid ? puppet.views[vid] : undefined;
      if (view) phase.current = advancePhase(view, state, phase.current, dt, speed);
      setVer((n) => n + 1); raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, forced, speed, puppet.views, puppet.idleView]);

  const vid = forced ?? chooseViewForState(puppet.views, state, puppet.idleView);
  const view = vid ? resolveView(puppet.views[vid]!) : undefined;
  const cnv = vid ? canvases.current[vid] : undefined;

  const exportZip = async () => {
    setBusy(true); setMsg(null);
    try { downloadBlob(await buildPuppetPackage(store.project, puppet), `${safeFileName(puppet.name)}.ebpuppet.zip`); setMsg('Pacchetto esportato.'); }
    catch (e) { setMsg(`Esportazione non riuscita: ${e instanceof Error ? e.message : e}`); }
    setBusy(false);
  };

  const chars = store.project.environments.flatMap((e) => e.characters.map((c) => ({ env: e.name, envId: e.id, c })));
  const assign = (envId: string, charId: string, puppetId: string | null) =>
    store.commitProject((p) => ({ ...p, environments: p.environments.map((e) => (e.id === envId ? { ...e, characters: e.characters.map((c) => (c.id === charId ? { ...c, puppetId } : c)) } : e)) }));
  const createChar = () => {
    const env = store.env, ch = { ...createCharacter(env.characters.length, env.navigation.nodes[0]?.id ?? null), name: puppet.name, puppetId: puppet.id, height: 0.2, width: 0.09 };
    store.commitProject((p) => ({ ...p, environments: p.environments.map((e) => (e.id === env.id ? { ...e, characters: [...e.characters, ch] } : e)) }));
    setMsg(`Creato il personaggio «${ch.name}» nell’ambiente «${env.name}». Provalo con il Playtest.`);
  };

  return (
    <div className={st.main}>
      <div className={st.stage}>
        <div className={st.toolbar}>
          <div className={ed.seg} role="group" aria-label="Stato">{STATES.map((s) => <button key={s} aria-pressed={state === s} onClick={() => { setState(s); phase.current = 0; }}>{s}</button>)}</div>
        </div>
        <div className={st.canvasWrap}>
          {view && cnv ? <ZoomCanvas contentWidth={view.width} contentHeight={view.height} version={ver} fitKey={vid ?? ''} checker testId="preview-canvas"
            draw={(ctx) => { renderPuppet(ctx, cnv, view, poseAt(view, state, phase.current), flip && flipsWithFacing(view)); }} />
            : <div className={st.empty}>{ready ? 'Caricamento…' : 'Completa i passi precedenti per vedere l’anteprima.'}</div>}
        </div>
      </div>
      <aside className={st.panel}>
        <div className={ed.section}>
          <h4>Controlli</h4>
          <div className={ed.checkGrid}>
            <button className={ed.chip} aria-pressed={!forced} onClick={() => setForced(null)}>Vista automatica</button>
            {VIEW_IDS.filter((v) => puppet.views[v] && resolveView(puppet.views[v]!).mesh).map((v) => <button key={v} className={ed.chip} aria-pressed={forced === v} onClick={() => setForced(v)}>{VIEW_LABEL[v]}</button>)}
          </div>
          <Slider id="x-spd" label="Velocità (altezze/s)" value={speed} min={0} max={2} step={0.05} onChange={setSpeed} fmt={(v) => v.toFixed(2)} />
          <CheckField id="x-flip" label="Specchia (profilo verso sinistra)" checked={flip} onChange={setFlip} />
        </div>
        <div className={ed.section} data-testid="checks">
          <h4>Controllo</h4>
          <div className={st.checks}>
            {ready ? <span className={st.good}>✓ Pronto per l’esportazione</span> : check.errors.map((e, i) => <span key={i} className={st.bad}>✕ {e}</span>)}
            {check.warnings.map((w, i) => <span key={i} className={ed.help}>• {w}</span>)}
          </div>
        </div>
        <div className={ed.section}>
          <h4>Esporta per un gioco</h4>
          <button className={`${ed.btn} ${ed.btnPrimary}`} disabled={!ready || busy} onClick={exportZip} data-testid="export-puppet">{busy ? 'Creazione…' : 'Esporta pacchetto ZIP'}</button>
          <span className={ed.help}>Contiene puppet.json, le texture, il runtime senza dipendenze e <b>demo.html</b>, un lettore autonomo da aprire con doppio click che è anche l’esempio di integrazione. Istruzioni nel manuale e in README.md.</span>
        </div>
        <div className={ed.section}>
          <h4>Usalo nei tuoi ambienti</h4>
          {chars.length === 0 && <span className={ed.help}>Nessun personaggio nel progetto.</span>}
          {chars.map(({ env, envId, c }) => (
            <label key={c.id} className={ed.field}><span>{c.name} <span style={{ color: 'var(--text-faint)' }}>({env})</span></span>
              <select className={ed.select} value={c.puppetId === puppet.id ? puppet.id : ''} onChange={(e) => assign(envId, c.id, e.target.value || null)} data-testid="assign-puppet">
                <option value="">Aspetto: sprite/segnaposto</option><option value={puppet.id}>Aspetto: {puppet.name}</option>
              </select>
            </label>
          ))}
          <button className={ed.btn} disabled={!ready} onClick={createChar} data-testid="create-char">Crea un personaggio con questo modellino</button>
        </div>
        {msg && <div className={ed.section} role="status"><span className={ed.help} style={{ color: 'var(--text)' }}>{msg}</span></div>}
      </aside>
    </div>
  );
}
