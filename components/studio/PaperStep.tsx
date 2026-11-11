'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PaperSetup } from '@/types';
import { PIECE_LABEL, type PieceId, type Pieces } from '@/engine/puppet/paperpuppet';
import { assembleSetup, commitPaper, loadPieces } from '@/lib/studio/paper';
import { imgToCanvas } from '@/lib/studio/pipeline';
import { ZoomCanvas } from './ZoomCanvas';
import { ed, st, type StepProps } from './shared';

const ORDER: PieceId[] = ['head', 'torso', 'pelvis', 'uarm', 'farm', 'hand', 'thigh', 'shin', 'foot', 'accA', 'accB'];
const LABEL: Record<string, string> = { ...PIECE_LABEL, accA: 'Zaino (dietro)', accB: 'Bretella (sul busto)' };

/**
 * Paper puppet: the automatic assembly with manual touch-ups. Click a piece (or pick it in the list), nudge it relative to the
 * joint it hangs on (children follow), and move it in front of / behind its neighbours. Changes are saved automatically.
 */
export function PaperStep({ store, puppet, projectId, go }: StepProps) {
  const setup = puppet.paper!;
  const [pieces, setPieces] = useState<Pieces | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [local, setLocal] = useState<PaperSetup>(setup);
  const [sel, setSel] = useState<PieceId>('head');
  const [stepPx, setStepPx] = useState(4);
  const [saving, setSaving] = useState(false);
  const [ver, setVer] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    loadPieces(projectId, puppet).then((r) => { if (alive) { if (r) setPieces(r.pieces); else setWarn('Foglio dei pezzi non trovato: importalo di nuovo.'); } }).catch((e) => alive && setWarn(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [projectId, puppet.paper?.sheetAssetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const asm = useMemo(() => (pieces ? assembleSetup(pieces, local) : null), [pieces, local]);
  const canvas = useMemo(() => (asm ? imgToCanvas(asm.cutout) : null), [asm]);
  useEffect(() => setVer((n) => n + 1), [asm, sel]);

  // auto-save (debounced): the assembled images are rebuilt as new assets
  const first = useRef(true);
  useEffect(() => {
    if (!pieces) return;
    if (first.current) { first.current = false; return; }
    const my = ++seq.current;
    const t = setTimeout(async () => { setSaving(true); try { await commitPaper(store, puppet.id, pieces, local); } finally { if (seq.current === my) setSaving(false); } }, 900);
    return () => clearTimeout(t);
  }, [local]); // eslint-disable-line react-hooks/exhaustive-deps

  const adj = local.adjust[sel] ?? { dx: 0, dy: 0, z: 0 };
  const set = (patch: Partial<typeof adj>) => setLocal((l) => ({ ...l, adjust: { ...l.adjust, [sel]: { ...(l.adjust[sel] ?? { dx: 0, dy: 0, z: 0 }), ...patch } } }));
  const nudge = (dx: number, dy: number) => set({ dx: adj.dx + dx * stepPx, dy: adj.dy + dy * stepPx });

  const pick = (x: number, y: number) => {
    if (!asm) return;
    for (let i = asm.placed.length - 1; i >= 0; i--) {
      const p = asm.placed[i]; if (p.far) continue;
      const lx = Math.round(x - p.x), ly = Math.round(y - p.y);
      if (lx >= 0 && ly >= 0 && lx < p.img.width && ly < p.img.height && p.img.data[(ly * p.img.width + lx) * 4 + 3] > 40) { setSel(p.id); return; }
    }
  };

  return (
    <div className={st.main}>
      <div className={st.stage}>
        <div className={st.toolbar}>
          <button className={`${ed.btn} ${ed.btnPrimary}`} onClick={() => go(6)} data-testid="next-step">Avanti: animazioni →</button>
          <span className={ed.help}>{saving ? 'Salvataggio…' : 'Clicca un pezzo per selezionarlo: lo sposti con le frecce.'}</span>
        </div>
        <div className={st.canvasWrap}>
          {asm && canvas ? <ZoomCanvas contentWidth={asm.cutout.width} contentHeight={asm.cutout.height} version={ver} fitKey={String(asm.cutout.height)} checker testId="paper-canvas"
            onPointer={(e) => { if (e.type === 'down') pick(e.x, e.y); }}
            draw={(ctx, v) => {
              ctx.drawImage(canvas, 0, 0);
              const p = asm.placed.find((q) => q.id === sel && !q.far);
              if (p) { ctx.strokeStyle = '#4f8cff'; ctx.lineWidth = 2 / v.zoom; ctx.setLineDash([6 / v.zoom, 4 / v.zoom]); ctx.strokeRect(p.x, p.y, p.img.width, p.img.height); ctx.setLineDash([]); }
            }} />
            : <div className={st.empty}><div>{warn ?? 'Carico i pezzi…'}</div></div>}
        </div>
      </div>
      <aside className={st.panel} aria-label="Montaggio del burattino">
        <div className={ed.section}>
          <h4>Pezzi</h4>
          <div className={st.list} data-testid="paper-pieces">
            {ORDER.filter((id) => pieces?.[id]).map((id) => <button key={id} className={st.item} aria-current={sel === id} onClick={() => setSel(id)} data-testid={`paper-piece-${id}`}><span>{LABEL[id]}</span>{local.adjust[id] && (local.adjust[id].dx || local.adjust[id].dy || local.adjust[id].z) ? <span className={st.tag}>ritoccato</span> : null}</button>)}
          </div>
        </div>
        <div className={ed.section}>
          <h4>Sposta «{LABEL[sel]}»</h4>
          <span className={ed.help}>Rispetto all’articolazione a cui è attaccato; i pezzi collegati seguono (spostando il braccio si sposta anche la mano).</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 44px)', gap: 4, justifyContent: 'center' }}>
            <span /><button className={ed.btn} onClick={() => nudge(0, -1)} aria-label="Su" data-testid="paper-up">↑</button><span />
            <button className={ed.btn} onClick={() => nudge(-1, 0)} aria-label="Sinistra" data-testid="paper-left">←</button>
            <button className={ed.btn} onClick={() => set({ dx: 0, dy: 0 })} aria-label="Azzera la posizione" title="Azzera">⟲</button>
            <button className={ed.btn} onClick={() => nudge(1, 0)} aria-label="Destra" data-testid="paper-right">→</button>
            <span /><button className={ed.btn} onClick={() => nudge(0, 1)} aria-label="Giù" data-testid="paper-down">↓</button><span />
          </div>
          <div className={ed.row2} style={{ gridTemplateColumns: 'auto 1fr' }}>
            <label className={ed.help} style={{ alignSelf: 'center' }}>Passo</label>
            <select className={ed.select} value={stepPx} onChange={(e) => setStepPx(Number(e.target.value))} aria-label="Passo di spostamento">{[1, 4, 12, 30].map((n) => <option key={n} value={n}>{n} px</option>)}</select>
          </div>
          <span className={ed.help} data-testid="paper-offset">Spostamento: x {adj.dx}, y {adj.dy} px</span>
        </div>
        <div className={ed.section}>
          <h4>Sovrapposizione</h4>
          <div className={ed.row2}>
            <button className={ed.btn} onClick={() => set({ z: adj.z - 1 })} data-testid="paper-back">Porta dietro</button>
            <button className={ed.btn} onClick={() => set({ z: adj.z + 1 })} data-testid="paper-front">Porta davanti</button>
          </div>
          <span className={ed.help}>Livello: {adj.z > 0 ? `+${adj.z} (davanti)` : adj.z < 0 ? `${adj.z} (dietro)` : 'standard'}</span>
          <button className={ed.btn} onClick={() => setLocal((l) => { const a = { ...l.adjust }; delete a[sel]; return { ...l, adjust: a }; })}>Azzera «{LABEL[sel]}»</button>
        </div>
        <div className={ed.section}>
          <h4>Arti lontani</h4>
          <label className={ed.help}>Oscuramento: {Math.round(local.farShade * 100)}%</label>
          <input type="range" min={0} max={0.7} step={0.02} value={local.farShade} onChange={(e) => setLocal((l) => ({ ...l, farShade: Number(e.target.value) }))} aria-label="Oscuramento degli arti lontani" />
          <span className={ed.help}>Braccio e gamba dell’altro lato sono copie scurite di quelli vicini.</span>
        </div>
      </aside>
    </div>
  );
}
