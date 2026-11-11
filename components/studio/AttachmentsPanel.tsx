'use client';

import { useRef, useState } from 'react';
import type { Attachment, BoneId, Clip, Puppet, ViewId } from '@/types';
import { DEFAULT_ATTACHMENT } from '@/engine/puppet/attachments';
import { keyBackground, trim } from '@/engine/puppet/imageProc';
import { readImageFile, ACCEPTED_IMAGE_TYPES } from '@/lib/import-export/image';
import { blobToImg, imgToBlob, pruneAssets, storePuppetImage, updatePuppet } from '@/lib/studio/pipeline';
import { uid } from '@/lib/ids';
import { CheckField, NumberField, TextField } from '../inspector/fields';
import { ed, boneLabel, type StepProps } from './shared';

const BONES: BoneId[] = ['handR', 'handL', 'farmR', 'farmL', 'footR', 'footL', 'torso', 'head', 'pelvis'];
const VIEWS: { id: ViewId; label: string }[] = [{ id: 'side', label: 'Profilo' }, { id: 'front', label: 'Fronte' }, { id: 'back', label: 'Retro' }];

/**
 * Tools and objects the character holds (pickaxe, torch, a found item…): an image fixed to a bone with its grip point, shown
 * always or only in the animations that list it. `selected` is previewed in the stage so it can be placed even when no clip shows it.
 */
export function AttachmentsPanel({ store, puppet, projectId, clip, vid, selected, onSelect, setClip }: Pick<StepProps, 'store' | 'puppet' | 'projectId'> & {
  clip: Clip | undefined; vid: ViewId; selected: string | null; onSelect: (id: string | null) => void; setClip: (patch: Partial<Clip>) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const list = puppet.attachments ?? [];
  const sel = list.find((a) => a.id === selected) ?? null;
  const setList = (fn: (l: Attachment[]) => Attachment[]) => updatePuppet(store, puppet.id, (p) => ({ ...p, attachments: fn(p.attachments ?? []) }));
  const patch = (a: Attachment, ch: Partial<Attachment>) => setList((l) => l.map((x) => (x.id === a.id ? { ...x, ...ch } : x)));

  const add = async (f: File) => {
    setMsg(null);
    try {
      const { blob } = await readImageFile(f);
      let img = await blobToImg(blob);
      let opaque = true; for (let i = 3; i < img.data.length; i += 4 * 97) if (img.data[i] < 250) { opaque = false; break; }
      if (opaque) img = keyBackground(img, { ...puppet.keying, color: null });       // picture on a flat background → transparent
      const t = trim(img, 2).img;
      const meta = await storePuppetImage(store, await imgToBlob(t), f.name.replace(/\.\w+$/, '') + '.png', t.width, t.height);
      const a: Attachment = { ...DEFAULT_ATTACHMENT, id: uid('att'), name: f.name.replace(/\.\w+$/, ''), assetId: meta.id, width: t.width, height: t.height, grip: { x: t.width / 2, y: t.height * 0.7 } };
      updatePuppet(store, puppet.id, (p) => ({ ...p, assets: [...p.assets, meta], attachments: [...(p.attachments ?? []), a] }));
      onSelect(a.id);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const remove = (a: Attachment) => { setList((l) => l.filter((x) => x.id !== a.id)); onSelect(null); void pruneAssets(store, puppet.id); };
  const shownIn = !!(sel && clip?.attach?.includes(sel.id));
  const pct = (v: number) => Math.round(v * 1000) / 10;

  return (
    <div className={ed.section} data-testid="attachments">
      <h4>Attrezzi e oggetti</h4>
      <span className={ed.help}>Immagini (PNG trasparente o su sfondo piatto) che il personaggio tiene in mano o porta con sé: piccone, torcia, un oggetto raccolto. Si attaccano a un osso nel punto di impugnatura e si mostrano sempre o solo in certe animazioni (per esempio «Scava»).</span>
      <div className={ed.checkGrid}>
        {list.map((a) => <button key={a.id} className={ed.chip} aria-pressed={selected === a.id} onClick={() => onSelect(selected === a.id ? null : a.id)} data-testid={`att-${a.id}`}>{a.name}</button>)}
        <button className={ed.btn} onClick={() => file.current?.click()} data-testid="att-add">+ Aggiungi…</button>
      </div>
      <input ref={file} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden data-testid="att-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void add(f); }} />
      {msg && <span className={ed.help} role="alert">{msg}</span>}
      {sel && (
        <>
          <TextField id="att-name" label="Nome" value={sel.name} onCommit={(v) => patch(sel, { name: v })} />
          <label className={ed.field}><span>Attaccato a</span>
            <select className={ed.select} value={sel.bone} onChange={(e) => patch(sel, { bone: e.target.value as BoneId })} data-testid="att-bone">{BONES.map((b) => <option key={b} value={b}>{boneLabel(b, vid)}</option>)}</select>
          </label>
          <div className={ed.row2}>
            <NumberField id="att-gx" label="Impugnatura X (% immagine)" value={Math.round((sel.grip.x / sel.width) * 100)} min={0} max={100} step={1} onCommit={(v) => patch(sel, { grip: { ...sel.grip, x: (v / 100) * sel.width } })} />
            <NumberField id="att-gy" label="Impugnatura Y (% immagine)" value={Math.round((sel.grip.y / sel.height) * 100)} min={0} max={100} step={1} onCommit={(v) => patch(sel, { grip: { ...sel.grip, y: (v / 100) * sel.height } })} />
          </div>
          <div className={ed.row2}>
            <NumberField id="att-s" label="Altezza (% del personaggio)" value={pct(sel.scale)} min={2} max={150} step={1} onCommit={(v) => patch(sel, { scale: v / 100 })} />
            <NumberField id="att-r" label="Rotazione (°)" value={sel.rot} min={-180} max={180} step={5} onCommit={(v) => patch(sel, { rot: v })} />
          </div>
          <div className={ed.row2}>
            <NumberField id="att-ox" label="Sposta X (% altezza)" value={pct(sel.offset.x)} min={-50} max={50} step={0.5} onCommit={(v) => patch(sel, { offset: { ...sel.offset, x: v / 100 } })} />
            <NumberField id="att-oy" label="Sposta Y (% altezza)" value={pct(sel.offset.y)} min={-50} max={50} step={0.5} onCommit={(v) => patch(sel, { offset: { ...sel.offset, y: v / 100 } })} />
          </div>
          <CheckField id="att-front" label="Davanti al corpo" checked={sel.front} onChange={(v) => patch(sel, { front: v })} />
          <CheckField id="att-always" label="Sempre visibile (es. un oggetto trasportato)" checked={sel.always} onChange={(v) => patch(sel, { always: v })} />
          {clip && !sel.always && <CheckField id="att-clip" label={`Mostra in «${clip.name}»`} checked={shownIn} onChange={(v) => setClip({ attach: v ? [...(clip.attach ?? []), sel.id] : (clip.attach ?? []).filter((x) => x !== sel.id) })} />}
          <div className={ed.checkGrid}>{VIEWS.map((v) => <button key={v.id} className={ed.chip} aria-pressed={(sel.views ?? ['side']).includes(v.id)} onClick={() => { const cur = sel.views ?? ['side']; patch(sel, { views: cur.includes(v.id) ? cur.filter((x) => x !== v.id) : [...cur, v.id] }); }}>{v.label}</button>)}</div>
          <span className={ed.help}>L’anteprima mostra l’attrezzo selezionato anche se l’animazione non lo usa, così puoi posizionarlo. Punto verde = impugnatura.</span>
          <button className={`${ed.btn} ${ed.btnDanger}`} onClick={() => remove(sel)}>Elimina «{sel.name}»</button>
        </>
      )}
    </div>
  );
}
