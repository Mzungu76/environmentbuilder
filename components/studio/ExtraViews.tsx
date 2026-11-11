'use client';

import { useRef, useState } from 'react';
import type { Puppet, PuppetView, ViewId } from '@/types';
import { detectCells, keyBackground, crop, trim, opaqueBounds } from '@/engine/puppet/imageProc';
import { readImageFile, ACCEPTED_IMAGE_TYPES } from '@/lib/import-export/image';
import { putAsset } from '@/lib/persistence/db';
import { blobToImg, imgToBlob, makeView, pruneAssets, storePuppetImage, updatePuppet } from '@/lib/studio/pipeline';
import { ed } from './shared';

const EXTRA: { id: ViewId; label: string; help: string }[] = [
  { id: 'climb', label: 'Arrampicata', help: 'Mostrata quando il personaggio si arrampica (stato CLIMB).' },
  { id: 'jump', label: 'Salto', help: 'Mostrata durante salto e caduta (stati JUMP e FALL).' },
];

/**
 * Extra pose views drawn in their own posture. Each comes from its own image (one figure) or from a "pose sheet"
 * with climb on the left and jump on the right. The background is removed with the puppet's keying settings
 * (colour detected from this image), then the skeleton is proposed from a pose-specific template.
 */
export function ExtraViews({ store, puppet, projectId }: { store: import('@/lib/store/editorStore').EditorStore; puppet: Puppet; projectId: string }) {
  const file = useRef<HTMLInputElement>(null);
  const targets = useRef<ViewId[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const ask = (t: ViewId[]) => { targets.current = t; file.current?.click(); };

  const load = async (f: File) => {
    const t = targets.current;
    if (!t.length) { setMsg('Scegli prima quale posa importare (Arrampicata, Salto o il foglio pose).'); return; }
    setBusy(true); setMsg(null);
    try {
      const { meta, blob } = await readImageFile(f);
      await putAsset(projectId, meta.id, blob);
      const raw = await blobToImg(blob);
      const keyed = keyBackground(raw, { ...puppet.keying, color: null });
      let cells = [{ x: 0, y: 0, w: keyed.width, h: keyed.height }];
      if (t.length > 1) cells = detectCells(keyed, t.length);
      const views: Partial<Record<ViewId, PuppetView>> = { ...puppet.views };
      const metas = [meta];
      for (let i = 0; i < t.length; i++) {
        const tr = trim(crop(keyed, cells[i]), 8);
        if (!opaqueBounds(tr.img)) { setMsg(`Non trovo la figura «${t[i]}» nell’immagine: controlla lo sfondo o importa le pose una alla volta.`); setBusy(false); return; }
        const m = await storePuppetImage(store, await imgToBlob(tr.img), `${puppet.name}-${t[i]}.png`, tr.img.width, tr.img.height);
        metas.push(m);
        const v = makeView(t[i], tr.img, { x: cells[i].x + tr.offset.x, y: cells[i].y + tr.offset.y, w: tr.img.width, h: tr.img.height }, m.id, views[t[i]], meta.id);
        if (v) views[t[i]] = v;
      }
      updatePuppet(store, puppet.id, (p) => ({ ...p, views, assets: [...p.assets, ...metas] }));
      await pruneAssets(store, puppet.id);
      setMsg(t.length > 1 ? 'Pose importate. Ora puoi ritoccarle (sotto) e passare allo scheletro.' : `Vista «${t[0]}» importata. Controlla lo scheletro nel passo 4.`);
    } catch (e) { setMsg(`Errore: ${e instanceof Error ? e.message : e}`); }
    setBusy(false);
  };

  const remove = (id: ViewId) => { updatePuppet(store, puppet.id, (p) => { const v = { ...p.views }; delete v[id]; return { ...p, views: v }; }); void pruneAssets(store, puppet.id); };

  return (
    <div className={ed.section} data-testid="extra-views">
      <h4>Pose aggiuntive (opzionale)</h4>
      <span className={ed.help}>Un’immagine unica non può arrampicarsi o saltare in modo convincente: disegna (o genera) il personaggio già in quella posa e importala qui. Nel gioco la vista giusta compare da sola. La guida è nel passo 1.</span>
      {EXTRA.map((x) => (
        <div key={x.id} style={{ display: 'grid', gap: 4 }}>
          <div className={ed.row2} style={{ gridTemplateColumns: '1fr auto' }}>
            <button className={ed.btn} disabled={busy} onClick={() => ask([x.id])} data-testid={`extra-${x.id}`}>{puppet.views[x.id] ? '✓ ' : ''}{x.label}: {puppet.views[x.id] ? 'sostituisci…' : 'importa…'}</button>
            {puppet.views[x.id] && <button className={`${ed.btn} ${ed.btnDanger}`} onClick={() => remove(x.id)} aria-label={`Rimuovi vista ${x.label}`}>✕</button>}
          </div>
          <span className={ed.help}>{x.help}</span>
        </div>
      ))}
      <button className={ed.btn} disabled={busy} onClick={() => ask(['climb', 'jump'])} data-testid="extra-sheet">Importa foglio pose (arrampicata + salto)…</button>
      {busy && <span className={ed.help}>Elaborazione…</span>}
      {msg && <span className={ed.help} style={{ color: 'var(--text)' }} role="status" data-testid="extra-msg">{msg}</span>}
      <input ref={file} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden data-testid="extra-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void load(f); }} />
    </div>
  );
}
