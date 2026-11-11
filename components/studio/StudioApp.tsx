'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { EditorStore } from '@/lib/store/editorStore';
import { loadProject } from '@/lib/persistence/db';
import { migrateProject } from '@/lib/serialization/migrations';
import { createPuppet } from '@/lib/studio/pipeline';
import { VIEW_IDS } from '@/types';
import { resolveView } from '@/engine/puppet/runtime';
import { validatePuppet } from '@/lib/import-export/puppetPackage';
import { ImportStep } from './ImportStep';
import { BackgroundStep } from './BackgroundStep';
import { ViewsStep } from './ViewsStep';
import { PaperStep } from './PaperStep';
import { SkeletonStep } from './SkeletonStep';
import { MeshStep } from './MeshStep';
import { ManikinStep } from './ManikinStep';
import { AnimateStep } from './AnimateStep';
import { ExportStep } from './ExportStep';
import { DollStudio } from './DollStudio';
import { Icon } from '@/components/ui/icons';
import { ed, st, type StepProps } from './shared';

const STEPS = ['Importa', 'Sfondo', 'Viste', 'Scheletro', 'Mesh e pesi', 'Manichino', 'Animazioni', 'Anteprima ed esporta'];

export function StudioApp({ projectId, puppetId }: { projectId: string | null; puppetId: string | null }) {
  const [store, setStore] = useState<EditorStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!projectId) throw new Error('Nessun progetto selezionato.');
        const raw = await loadProject(projectId);
        if (!raw) throw new Error('Progetto non trovato in questo browser.');
        if (alive) setStore(new EditorStore(migrateProject(raw)));
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { alive = false; };
  }, [projectId]);

  if (error) return <div className={ed.center}><div><p>{error}</p><Link href="/" className={ed.btn}>Torna alla libreria</Link></div></div>;
  if (!store) return <div className={ed.center}>Caricamento…</div>;
  return <Studio store={store} initialPuppet={puppetId} />;
}

function Studio({ store, initialPuppet }: { store: EditorStore; initialPuppet: string | null }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const puppets = state.project.puppets;
  const [pid, setPid] = useState<string | null>(initialPuppet && puppets.some((p) => p.id === initialPuppet) ? initialPuppet : puppets[0]?.id ?? null);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'puppet' | 'doll'>('puppet');
  const dolls = state.project.dolls;
  const [did, setDid] = useState<string | null>(dolls[0]?.id ?? null);
  const [confirmDel, setConfirmDel] = useState(false);
  const puppet = puppets.find((p) => p.id === pid) ?? null;
  const stepsRef = useRef<HTMLElement>(null);
  useEffect(() => { stepsRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }); }, [step]);

  useEffect(() => {
    const flush = () => { if (store.getState().saveStatus !== 'saved') void store.save(); };
    window.addEventListener('beforeunload', flush); document.addEventListener('visibilitychange', flush);
    return () => { window.removeEventListener('beforeunload', flush); document.removeEventListener('visibilitychange', flush); flush(); store.dispose(); };
  }, [store]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement; if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void store.save(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [store]);

  const done = useMemo(() => {
    if (!puppet) return [] as boolean[];
    const vs = VIEW_IDS.map((v) => puppet.views[v]).filter(Boolean);
    return [!!puppet.source, !!puppet.source, vs.length > 0, vs.length > 0 && vs.every((v) => Object.keys(v!.landmarks).length >= 19), vs.length > 0 && vs.every((v) => !!resolveView(v!).skin), vs.some((v) => !!v!.manikin?.enabled), vs.length > 0 && vs.every((v) => v!.clips.length > 0), validatePuppet(puppet).errors.length === 0];
  }, [puppet]);

  const create = () => { const p = createPuppet(`Personaggio ${puppets.length + 1}`); store.commitProject((pr) => ({ ...pr, puppets: [...pr.puppets, p] })); setPid(p.id); setStep(0); };
  const st2 = state.saveStatus;

  const props: StepProps | null = puppet ? { store, puppet, projectId: store.project.id, go: setStep, version: state.revision } : null;
  return (
    <div className={st.app}>
      <header className={st.top}>
        <Link href={`/editor?id=${store.project.id}`} className={ed.btn} data-testid="back-editor" aria-label="Torna all’editor">←<span className={st.hideSm}> Editor</span></Link>
        <h1 className={st.hideSm}>Studio personaggi · {state.project.name}</h1>
        <div className={ed.seg} role="group" aria-label="Tipo di personaggio">
          <button aria-pressed={mode === 'puppet'} onClick={() => setMode('puppet')} data-testid="mode-puppet">Modellini</button>
          <button aria-pressed={mode === 'doll'} onClick={() => setMode('doll')} data-testid="mode-doll">Omini</button>
        </div>
        <span className={st.spacer} />
        {mode === 'puppet' && <>
        <select className={ed.select} style={{ width: 170, flex: '0 1 200px' }} value={pid ?? ''} onChange={(e) => { setPid(e.target.value || null); setStep(0); setConfirmDel(false); }} aria-label="Personaggio" data-testid="puppet-select">
          {puppets.length === 0 && <option value="">Nessun personaggio</option>}
          {puppets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className={ed.btn} onClick={create} data-testid="new-puppet">{Icon.plus}<span className={st.hideSm}>Nuovo</span></button>
        {puppet && (confirmDel
          ? <button className={`${ed.btn} ${ed.btnDanger}`} onClick={() => { store.commitProject((pr) => ({ ...pr, puppets: pr.puppets.filter((p) => p.id !== puppet.id), environments: pr.environments.map((e) => ({ ...e, characters: e.characters.map((c) => (c.puppetId === puppet.id ? { ...c, puppetId: null } : c)) })) })); setPid(null); setConfirmDel(false); }}>Eliminare «{puppet.name}»?</button>
          : <button className={`${ed.btn} ${ed.btnDanger} ${ed.iconBtn}`} onClick={() => setConfirmDel(true)} aria-label="Elimina personaggio" title="Elimina personaggio">{Icon.trash}</button>)}
        </>}
        <button className={`${ed.btn} ${ed.iconBtn}`} onClick={() => store.undo()} disabled={!state.canUndo} aria-label="Annulla" title="Annulla (Ctrl+Z)">{Icon.undo}</button>
        <button className={`${ed.btn} ${ed.iconBtn}`} onClick={() => store.redo()} disabled={!state.canRedo} aria-label="Ripeti" title="Ripeti">{Icon.redo}</button>
        <span className={`${ed.status} ${st.hideSm}`} role="status"><span className={`${ed.dot} ${st2 === 'dirty' ? ed.dotDirty : st2 === 'error' ? ed.dotError : st2 === 'saving' ? ed.dotSaving : ''}`} />{st2 === 'saved' ? 'Salvato' : st2 === 'dirty' ? 'Modifiche non salvate' : st2 === 'saving' ? 'Salvataggio…' : 'Salvataggio non riuscito'}</span>
        <Link href="/manuale" target="_blank" className={`${ed.btn} ${ed.iconBtn} ${st.hideSm}`} aria-label="Manuale" title="Manuale">{Icon.help}</Link>
      </header>
      {mode === 'doll' ? <div /> : <nav className={st.steps} aria-label="Passi" ref={stepsRef}>
        {STEPS.map((s0, i) => { const s = i === 2 && puppet?.paper ? 'Montaggio' : s0; return (
          <button key={s0} className={st.step} aria-current={step === i} onClick={() => setStep(i)} data-testid={`step-${i}`}>
            <span className={st.num}>{i + 1}</span>{s}{puppet && done[i] ? <span className={st.ok} /> : null}
          </button>
        ); })}
      </nav>}
      {mode === 'doll' ? <DollStudio store={store} dolls={dolls} selectedId={did} onSelect={setDid} /> : !puppet ? (
        <div className={st.stage} style={{ gridTemplateRows: '1fr' }}>
          <div className={st.empty}><div><h2 style={{ color: 'var(--text)', margin: '0 0 8px' }}>Studio personaggi</h2><p style={{ margin: '0 0 14px' }}>Trasforma un foglio di rotazione (fronte, profilo, retro) in un personaggio con scheletro e animazioni, da usare negli ambienti o in un altro gioco.</p><button className={`${ed.btn} ${ed.btnPrimary}`} onClick={create} data-testid="new-puppet-big">Crea il primo personaggio</button></div></div>
        </div>
      ) : props && (
        <>
          {step === 0 && <ImportStep {...props} />}
          {step === 1 && <BackgroundStep {...props} />}
          {step === 2 && (puppet.paper ? <PaperStep {...props} /> : <ViewsStep {...props} />)}
          {step === 3 && <SkeletonStep {...props} />}
          {step === 4 && <MeshStep {...props} />}
          {step === 5 && <ManikinStep {...props} />}
          {step === 6 && <AnimateStep {...props} />}
          {step === 7 && <ExportStep {...props} />}
        </>
      )}
    </div>
  );
}
