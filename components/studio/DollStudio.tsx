'use client';

import { useEffect, useRef, useState } from 'react';
import type { AccessoryId, CharacterState, Doll, EditorStore } from './dollTypes';
import { DOLL_PRESETS, ACCESSORY_LABEL, accessory, createDoll, randomDoll } from '@/engine/doll/defaults';
import { DollPlayer } from '@/engine/doll/player';
import { drawDoll } from '@/engine/doll/render';
import { DOLL_HEIGHT } from '@/engine/doll/shapes';
import { createCharacter } from '@/engine/characters/factory';
import { buildDollPackage } from '@/lib/import-export/dollPackage';
import { downloadBlob, safeFileName } from '@/lib/import-export/archive';
import { uid } from '@/lib/ids';
import { updateDoll } from '@/lib/studio/dolls';
import { ZoomCanvas } from './ZoomCanvas';
import { ed, st, Slider } from './shared';
import { CheckField, TextField } from '../inspector/fields';
import { Icon } from '@/components/ui/icons';

const STATES: CharacterState[] = ['IDLE', 'WALK', 'CLIMB', 'INTERACT', 'COLLECT', 'JUMP', 'FALL'];
const ACCESSORIES = Object.keys(ACCESSORY_LABEL) as AccessoryId[];
const OPTIONS = {
  hair: [['none', 'Nessuno'], ['short', 'Corti'], ['messy', 'Spettinati'], ['long', 'Lunghi'], ['ponytail', 'Coda'], ['bun', 'Chignon']],
  face: [['dots', 'Puntini'], ['simple', 'Semplice'], ['smile', 'Sorriso'], ['stern', 'Serio']],
  top: [['tshirt', 'Maglietta'], ['shirt', 'Camicia'], ['jacket', 'Giacca'], ['vest', 'Gilet']],
  bottom: [['long', 'Pantaloni lunghi'], ['shorts', 'Pantaloncini'], ['cargo', 'Cargo']],
  shoes: [['boots', 'Stivali'], ['sneakers', 'Scarpe da ginnastica'], ['bare', 'Scalzo']],
} as const;
const BODY: { key: keyof Doll['body']; label: string; min: number; max: number; step: number }[] = [
  { key: 'headSize', label: 'Testa (altezza)', min: 0.12, max: 0.32, step: 0.005 }, { key: 'headWidth', label: 'Testa (larghezza)', min: 0.8, max: 1.3, step: 0.01 },
  { key: 'neck', label: 'Collo', min: 0.01, max: 0.06, step: 0.002 }, { key: 'torso', label: 'Busto (lunghezza)', min: 0.2, max: 0.36, step: 0.005 },
  { key: 'torsoWidth', label: 'Busto (larghezza)', min: 0.08, max: 0.18, step: 0.005 }, { key: 'hips', label: 'Fianchi', min: 0.8, max: 1.3, step: 0.01 },
  { key: 'arm', label: 'Braccia (lunghezza)', min: 0.24, max: 0.46, step: 0.005 }, { key: 'armThickness', label: 'Braccia (spessore)', min: 0.012, max: 0.034, step: 0.001 },
  { key: 'legThickness', label: 'Gambe (spessore)', min: 0.024, max: 0.05, step: 0.001 }, { key: 'hand', label: 'Mani', min: 0.035, max: 0.07, step: 0.002 }, { key: 'foot', label: 'Piedi', min: 0.08, max: 0.16, step: 0.005 },
];
const COLORS: { key: keyof Doll['colors']; label: string }[] = [
  { key: 'skin', label: 'Pelle' }, { key: 'hair', label: 'Capelli' }, { key: 'top', label: 'Maglia' }, { key: 'bottom', label: 'Pantaloni' },
  { key: 'shoes', label: 'Scarpe' }, { key: 'accent', label: 'Accento' }, { key: 'outline', label: 'Contorno' },
];

/** Omini: procedural characters with adjustable proportions, colours, clothes and accessories. Mobile friendly. */
export function DollStudio({ store, dolls, selectedId, onSelect }: { store: EditorStore; dolls: Doll[]; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const doll = dolls.find((d) => d.id === selectedId) ?? null;
  const [state, setState] = useState<CharacterState>('WALK');
  const [flip, setFlip] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(0.75);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [preset, setPreset] = useState(DOLL_PRESETS[0].id);
  const gesture = useRef(false);
  const create = (d: Doll) => { store.commitProject((p) => ({ ...p, dolls: [...p.dolls, d] })); onSelect(d.id); };
  const live = (fn: (d: Doll) => Doll) => { if (!doll) return; if (!gesture.current) { store.checkpoint(); gesture.current = true; } updateDoll(store, doll.id, fn, 'live'); };
  const end = () => { gesture.current = false; };
  const commit = (fn: (d: Doll) => Doll) => { if (doll) updateDoll(store, doll.id, fn); };

  const chars = store.project.environments.flatMap((e) => e.characters.map((c) => ({ env: e.name, envId: e.id, c })));
  const assign = (envId: string, charId: string, dollId: string | null) => store.commitProject((p) => ({ ...p, environments: p.environments.map((e) => (e.id === envId ? { ...e, characters: e.characters.map((c) => (c.id === charId ? { ...c, dollId } : c)) } : e)) }));
  const createChar = () => {
    if (!doll) return;
    const env = store.env, ch = { ...createCharacter(env.characters.length, env.navigation.nodes[0]?.id ?? null), name: doll.name, dollId: doll.id, height: 0.2, width: 0.09 };
    store.commitProject((p) => ({ ...p, environments: p.environments.map((e) => (e.id === env.id ? { ...e, characters: [...e.characters, ch] } : e)) }));
    setMsg(`Creato il personaggio «${ch.name}» nell’ambiente «${env.name}». Provalo con il Playtest.`);
  };

  return (
    <div className={st.main}>
      <div className={st.stage}>
        <div className={st.toolbar}>
          <select className={ed.select} style={{ width: 180 }} value={selectedId ?? ''} onChange={(e) => { onSelect(e.target.value || null); setConfirmDel(false); }} aria-label="Omino" data-testid="doll-select">
            {dolls.length === 0 && <option value="">Nessun omino</option>}
            {dolls.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className={ed.select} style={{ width: 170 }} value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Modello di partenza">{DOLL_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
          <button className={ed.btn} onClick={() => create(DOLL_PRESETS.find((p) => p.id === preset)!.make())} data-testid="new-doll">{Icon.plus}Nuovo</button>
          <button className={ed.btn} onClick={() => create(randomDoll())} data-testid="random-doll">Casuale</button>
          {doll && <button className={ed.btn} onClick={() => create({ ...JSON.parse(JSON.stringify(doll)), id: uid('doll'), name: `${doll.name} (copia)` })}>{Icon.copy}</button>}
          {doll && (confirmDel
            ? <button className={`${ed.btn} ${ed.btnDanger}`} onClick={() => { store.commitProject((p) => ({ ...p, dolls: p.dolls.filter((d) => d.id !== doll.id), environments: p.environments.map((e) => ({ ...e, characters: e.characters.map((c) => (c.dollId === doll.id ? { ...c, dollId: null } : c)) })) })); onSelect(null); setConfirmDel(false); }}>Eliminare «{doll.name}»?</button>
            : <button className={`${ed.btn} ${ed.btnDanger} ${ed.iconBtn}`} onClick={() => setConfirmDel(true)} aria-label="Elimina omino">{Icon.trash}</button>)}
        </div>
        <div className={st.canvasWrap} style={{ display: 'grid', gridTemplateRows: '1fr auto', gap: 8 }}>
          {doll ? <DollPreview doll={doll} state={state} speed={speed} flip={flip} paused={paused} /> : <div className={st.empty}><div><h2 style={{ color: 'var(--text)', margin: '0 0 8px' }}>Omini</h2><p style={{ margin: '0 0 14px' }}>Personaggi procedurali con braccia, gambe, vestiti e accessori che si personalizzano a piacere. Partono da un modello (es. il Minatore) o a caso.</p><button className={`${ed.btn} ${ed.btnPrimary}`} onClick={() => create(DOLL_PRESETS[0].make())} data-testid="new-doll-big">Crea il primo omino</button></div></div>}
          {doll && (
            <div className={`${ed.section} ${st.dock}`} style={{ borderRadius: 8, border: '1px solid var(--border)', padding: '8px 12px', gap: 6 }}>
              <div className={ed.seg} role="group" aria-label="Stato" style={{ overflowX: 'auto' }}>{STATES.map((s) => <button key={s} aria-pressed={state === s} onClick={() => setState(s)} data-testid={`dstate-${s}`}>{s}</button>)}</div>
              <div className={ed.row2}>
                <Slider id="d-spd" label="Velocità (altezze/s)" value={speed} min={0} max={2} step={0.05} onChange={setSpeed} fmt={(v) => v.toFixed(2)} />
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><CheckField id="d-flip" label="Specchia" checked={flip} onChange={setFlip} /><CheckField id="d-pause" label="Ferma" checked={paused} onChange={setPaused} /></div>
              </div>
            </div>
          )}
        </div>
      </div>
      <aside className={st.panel} aria-label="Personalizzazione">
        {doll && (
          <>
            <div className={ed.section}>
              <TextField id="d-name" label="Nome" value={doll.name} onCommit={(v) => commit((d) => ({ ...d, name: v }))} />
              <span className={ed.help}>Cambia il modello di partenza con «Nuovo» in alto, oppure personalizza questo omino qui sotto.</span>
            </div>
            <div className={ed.section}>
              <h4>Aspetto</h4>
              {(['hair', 'face', 'top', 'bottom', 'shoes'] as const).map((k) => (
                <label key={k} className={ed.field}><span>{{ hair: 'Capelli', face: 'Volto', top: 'Maglia', bottom: 'Pantaloni', shoes: 'Scarpe' }[k]}</span>
                  <select className={ed.select} value={doll.features[k]} onChange={(e) => commit((d) => ({ ...d, features: { ...d.features, [k]: e.target.value } }))} data-testid={`feat-${k}`}>
                    {OPTIONS[k].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className={ed.section}>
              <h4>Colori</h4>
              <div className={ed.row2}>
                {COLORS.map(({ key, label }) => (
                  <label key={key} className={ed.field}><span>{label}</span>
                    <input type="color" className={ed.input} style={{ padding: 2, height: 36 }} value={doll.colors[key]} onChange={(e) => live((d) => ({ ...d, colors: { ...d.colors, [key]: e.target.value } }))} onBlur={end} onPointerUp={end} data-testid={`color-${key}`} />
                  </label>
                ))}
              </div>
            </div>
            <div className={ed.section}>
              <h4>Accessori</h4>
              {ACCESSORIES.map((id) => {
                const on = doll.accessories.find((a) => a.id === id);
                return (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1 }}><CheckField id={`acc-${id}`} label={ACCESSORY_LABEL[id]} checked={!!on}
                      onChange={(v) => commit((d) => ({ ...d, accessories: v ? [...d.accessories.filter((a) => a.id !== id), accessory(id)] : d.accessories.filter((a) => a.id !== id) }))} /></div>
                    {on && <input type="color" aria-label={`Colore ${ACCESSORY_LABEL[id]}`} style={{ width: 40, height: 30, padding: 1 }} value={on.color} onChange={(e) => live((d) => ({ ...d, accessories: d.accessories.map((a) => (a.id === id ? { ...a, color: e.target.value } : a)) }))} onBlur={end} onPointerUp={end} />}
                  </div>
                );
              })}
            </div>
            <div className={ed.section}>
              <h4>Proporzioni</h4>
              {BODY.map((b) => <Slider key={b.key} id={`b-${b.key}`} label={b.label} value={doll.body[b.key]} min={b.min} max={b.max} step={b.step} onChange={(v) => live((d) => ({ ...d, body: { ...d.body, [b.key]: v } }))} onCommit={end} fmt={(v) => v.toFixed(3)} />)}
              <button className={ed.btn} onClick={() => commit((d) => ({ ...d, body: { ...createDoll().body } }))}>Ripristina le proporzioni</button>
            </div>
            <div className={ed.section}>
              <h4>Stile e movimento</h4>
              <Slider id="s-out" label="Spessore del contorno" value={doll.style.outline} min={0} max={0.016} step={0.0005} onChange={(v) => live((d) => ({ ...d, style: { ...d.style, outline: v } }))} onCommit={end} fmt={(v) => v.toFixed(4)} />
              <Slider id="s-far" label="Ombra degli arti lontani" value={doll.style.farShade} min={0} max={0.6} step={0.02} onChange={(v) => live((d) => ({ ...d, style: { ...d.style, farShade: v } }))} onCommit={end} fmt={(v) => v.toFixed(2)} />
              <Slider id="s-viv" label="Vivacità dei movimenti" value={doll.motion.vivacity} min={0.4} max={1.8} step={0.05} onChange={(v) => live((d) => ({ ...d, motion: { vivacity: v } }))} onCommit={end} fmt={(v) => `×${v.toFixed(2)}`} />
            </div>
            <div className={ed.section}>
              <h4>Esporta e usa</h4>
              <button className={`${ed.btn} ${ed.btnPrimary}`} onClick={async () => { try { downloadBlob(await buildDollPackage(doll), `${safeFileName(doll.name)}.ebdoll.zip`); setMsg('Pacchetto esportato.'); } catch (e) { setMsg(`Esportazione non riuscita: ${e instanceof Error ? e.message : e}`); } }} data-testid="export-doll">Esporta pacchetto ZIP</button>
              <span className={ed.help}>doll.json + runtime senza dipendenze + <b>demo.html</b> (lettore autonomo, esempio di integrazione).</span>
              {chars.map(({ env, envId, c }) => (
                <label key={c.id} className={ed.field}><span>{c.name} <span style={{ color: 'var(--text-faint)' }}>({env})</span></span>
                  <select className={ed.select} value={c.dollId === doll.id ? doll.id : ''} onChange={(e) => assign(envId, c.id, e.target.value || null)} data-testid="assign-doll">
                    <option value="">Aspetto: altro</option><option value={doll.id}>Aspetto: {doll.name}</option>
                  </select>
                </label>
              ))}
              <button className={ed.btn} onClick={createChar} data-testid="create-doll-char">Crea un personaggio con questo omino</button>
              {msg && <span className={ed.help} style={{ color: 'var(--text)' }} role="status">{msg}</span>}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

/** Animated preview. Owns its own frame loop so that only the canvas redraws (not the whole panel). */
function DollPreview({ doll, state, speed, flip, paused }: { doll: Doll; state: CharacterState; speed: number; flip: boolean; paused: boolean }) {
  const [ver, setVer] = useState(0);
  const player = useRef(new DollPlayer());
  const shapes = useRef<ReturnType<DollPlayer['frame']>>([]);
  const live = useRef({ doll, state, speed, paused });
  live.current = { doll, state, speed, paused };
  useEffect(() => { shapes.current = player.current.frame(doll, state, 0, 0); setVer((n) => n + 1); }, [doll, state, flip, paused]); // redraw on edits even while stopped
  useEffect(() => {
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const { doll: d, state: s, speed: sp, paused: pz } = live.current;
      if (!pz) { shapes.current = player.current.frame(d, s, Math.min(0.1, (now - last) / 1000), s === 'WALK' || s === 'CLIMB' ? sp : 0); setVer((n) => n + 1); }
      last = now; raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <ZoomCanvas contentWidth={760} contentHeight={1180} version={ver} fitKey={doll.id} checker testId="doll-canvas"
      draw={(ctx) => {
        const fx = 380, fy = 1080;
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(fx, fy, 120, 22, 0, 0, Math.PI * 2); ctx.fill();
        drawDoll(ctx, shapes.current, { x: fx, y: fy, scale: 1, flip, outline: doll.colors.outline, outlineWidth: doll.style.outline * DOLL_HEIGHT });
      }} />
  );
}
