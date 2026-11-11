'use client';

import { useEffect, useState } from 'react';
import type { BoneId, LandmarkId, Puppet, PuppetView, ViewId } from '@/types';
import { VIEW_IDS } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import type { Img } from '@/engine/puppet/imageProc';
import { imgToCanvas, loadAssetImg } from '@/lib/studio/pipeline';
import editor from '../editor/editor.module.css';
import styles from './studio.module.css';

export { editor as ed, styles as st };

export interface StepProps { store: EditorStore; puppet: Puppet; projectId: string; go: (step: number) => void; version: number }

export const VIEW_LABEL: Record<ViewId, string> = { front: 'Fronte', side: 'Profilo', back: 'Retro' };

const BASE_LABEL: Record<string, string> = { pelvis: 'Bacino', torso: 'Busto', head: 'Testa', uarm: 'Braccio', farm: 'Avambraccio', hand: 'Mano', thigh: 'Coscia', shin: 'Stinco', foot: 'Piede' };
const LM_LABEL: Record<string, string> = { headTop: 'Cima della testa', neck: 'Collo', pelvis: 'Bacino', shoulder: 'Spalla', elbow: 'Gomito', wrist: 'Polso', hand: 'Punta della mano', hip: 'Anca', knee: 'Ginocchio', ankle: 'Caviglia', toe: 'Punta del piede' };
/** L/R = left/right of the image (front, back) or far/near (profile). */
const side = (c: string, view: ViewId) => (view === 'side' ? (c === 'L' ? 'lontano' : 'vicino') : c === 'L' ? 'sx' : 'dx');
export const boneLabel = (id: BoneId, view: ViewId) => { const m = id.match(/^(.*?)([LR])$/); return m && BASE_LABEL[m[1]] ? `${BASE_LABEL[m[1]]} ${side(m[2], view)}` : BASE_LABEL[id] ?? id; };
export const landmarkLabel = (id: LandmarkId, view: ViewId) => { const m = id.match(/^(.*?)([LR])$/); return m && LM_LABEL[m[1]] ? `${LM_LABEL[m[1]]} ${side(m[2], view)}` : LM_LABEL[id] ?? id; };

/** Loads an asset's pixels (and a canvas to draw it) — null while loading or missing. */
export function useAssetImage(projectId: string, assetId: string | null | undefined): { img: Img; canvas: HTMLCanvasElement } | null {
  const [st2, setSt] = useState<{ id: string; img: Img; canvas: HTMLCanvasElement } | null>(null);
  useEffect(() => {
    let alive = true;
    if (!assetId) { setSt(null); return; }
    loadAssetImg(projectId, assetId).then((img) => { if (alive && img) setSt({ id: assetId, img, canvas: imgToCanvas(img) }); });
    return () => { alive = false; };
  }, [projectId, assetId]);
  return st2 && st2.id === assetId ? st2 : null;
}

/** Tabs for the views that have been generated. */
export function ViewTabs({ puppet, value, onChange, requireMesh }: { puppet: Puppet; value: ViewId; onChange: (v: ViewId) => void; requireMesh?: boolean }) {
  const list = VIEW_IDS.filter((v) => puppet.views[v]);
  return (
    <div className={editor.seg} role="group" aria-label="Vista">
      {list.map((v) => <button key={v} aria-pressed={value === v} onClick={() => onChange(v)} data-testid={`view-${v}`}>{VIEW_LABEL[v]}{requireMesh && !puppet.views[v]?.mesh ? ' ·' : ''}</button>)}
    </div>
  );
}

export function useView(puppet: Puppet, preferred?: ViewId): [ViewId, (v: ViewId) => void, PuppetView | undefined] {
  const first = (VIEW_IDS.find((v) => puppet.views[v]) ?? 'side') as ViewId;
  const [v, setV] = useState<ViewId>(preferred && puppet.views[preferred] ? preferred : first);
  const cur = puppet.views[v] ? v : first;
  return [cur, setV, puppet.views[cur]];
}

/** Small helper for a numeric slider with a label and value. */
export function Slider({ label, value, min, max, step = 1, onChange, onCommit, fmt, id }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onCommit?: (v: number) => void; fmt?: (v: number) => string; id: string }) {
  return (
    <div className={editor.field}>
      <label htmlFor={id} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{label}</span><span style={{ color: 'var(--text-faint)' }}>{fmt ? fmt(value) : value}</span></label>
      <input id={id} className={styles.range} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))} onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))} />
    </div>
  );
}
