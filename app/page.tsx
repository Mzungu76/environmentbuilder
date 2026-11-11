'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteProject, getAsset, listProjects, saveProject, type ProjectSummary } from '@/lib/persistence/db';
import { createProject } from '@/lib/serialization/factory';
import { migrateProject } from '@/lib/serialization/migrations';
import { importProjectZip } from '@/lib/import-export/archive';
import { Icon } from '@/components/ui/icons';
import styles from './library.module.css';

function Thumb({ projectId, assetId }: { projectId: string; assetId: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null, alive = true;
    if (assetId) getAsset(projectId, assetId).then((b) => { if (b && alive) { revoke = URL.createObjectURL(b); setUrl(revoke); } }).catch(() => {});
    return () => { alive = false; if (revoke) URL.revokeObjectURL(revoke); };
  }, [projectId, assetId]);
  return <div className={styles.thumb} style={url ? { backgroundImage: `url(${url})` } : undefined}>{!url && Icon.image}</div>;
}

export default function LibraryPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => listProjects().then(setProjects).catch((e) => { setProjects([]); setError(e instanceof Error ? e.message : String(e)); }), []);
  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    try { const p = createProject(name.trim() || 'Untitled project'); await saveProject(p); router.push(`/editor?id=${p.id}`); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const onImport = async (file?: File) => {
    if (!file) return;
    setError(null);
    try {
      if (file.name.toLowerCase().endsWith('.json')) {
        const p = migrateProject(JSON.parse(await file.text()));
        p.id = createProject().id; p.updatedAt = Date.now();
        await saveProject(p); router.push(`/editor?id=${p.id}`);
      } else { const p = await importProjectZip(file); router.push(`/editor?id=${p.id}`); }
    } catch (e) { setError(`Import failed: ${e instanceof Error ? e.message : e}`); }
  };

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div><h1>Environment Builder</h1><p>Turn 2D illustrations into explorable, configurable environments.</p></div>
        <div className={styles.actions}>
          <button className={styles.btn} onClick={() => importRef.current?.click()} data-testid="import-project">{Icon.folder}Import project…</button>
        </div>
      </div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      <form className={styles.create} onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name (e.g. Cavern level 1)" aria-label="New project name" data-testid="new-project-name" />
        <button className={`${styles.btn} ${styles.primary}`} type="submit" data-testid="create-project">{Icon.plus}New project</button>
      </form>
      {projects === null ? <p>Loading…</p> : projects.length === 0 ? (
        <div className={styles.empty}><h2>No projects yet</h2><p>Create a project, then import an illustration to start drawing paths.</p></div>
      ) : (
        <div className={styles.grid}>
          {projects.map((p) => (
            <article key={p.id} className={styles.card} data-testid="project-card">
              <Thumb projectId={p.id} assetId={p.thumbAssetId} />
              <div className={styles.body}><span className={styles.name}>{p.name}</span><span className={styles.meta}>{p.environmentCount} environment{p.environmentCount === 1 ? '' : 's'} · {new Date(p.updatedAt).toLocaleString()}</span></div>
              <div className={styles.foot}>
                <button className={`${styles.btn} ${styles.primary}`} onClick={() => router.push(`/editor?id=${p.id}`)}>Open</button>
                {confirmId === p.id
                  ? <button className={`${styles.btn} ${styles.danger}`} onClick={async () => { await deleteProject(p.id); setConfirmId(null); void refresh(); }}>Delete “{p.name}”?</button>
                  : <button className={`${styles.btn} ${styles.danger}`} aria-label={`Delete ${p.name}`} onClick={() => setConfirmId(p.id)}>{Icon.trash}</button>}
              </div>
            </article>
          ))}
        </div>
      )}
      <input ref={importRef} type="file" accept=".zip,.json,application/zip,application/json" hidden data-testid="project-file" onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = ''; }} />
    </main>
  );
}
