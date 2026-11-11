import JSZip from 'jszip';
import type { Project } from '@/types';
import { migrateProject } from '@/lib/serialization/migrations';
import { getAsset, putAsset, saveProject } from '@/lib/persistence/db';
import { uid } from '@/lib/ids';

/**
 * Self-contained package:
 *   project.json          - full project (all environments, graphs, objects…)
 *   manifest.json         - small metadata (app, schema version, counts)
 *   assets/<assetId>.<ext> - every image referenced by any environment
 */

const extOf = (mime: string) => (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : 'bin');

export async function exportProjectZip(project: Project): Promise<Blob> {
  const zip = new JSZip();
  const assetFiles: Record<string, string> = {};
  const missing: string[] = [];
  for (const env of project.environments) {
    for (const a of env.assets) {
      const blob = await getAsset(project.id, a.id);
      if (!blob) { missing.push(a.fileName); continue; }
      const path = `assets/${a.id}.${extOf(a.mime)}`;
      zip.file(path, blob);
      assetFiles[a.id] = path;
    }
  }
  zip.file('project.json', JSON.stringify(project, null, 2));
  zip.file('manifest.json', JSON.stringify({
    app: 'environment-builder', schemaVersion: project.schemaVersion, projectName: project.name,
    exportedAt: new Date().toISOString(), environments: project.environments.length, assets: assetFiles, missingAssets: missing,
  }, null, 2));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export function exportProjectJson(project: Project): Blob {
  return new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
}

/** Imports a ZIP as a NEW project (fresh project id, so it never overwrites an existing one). */
export async function importProjectZip(file: Blob): Promise<Project> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(file); } catch { throw new Error('Il file non è un archivio ZIP valido'); }
  const entry = zip.file('project.json');
  if (!entry) throw new Error('L’archivio non contiene project.json');
  let raw: unknown;
  try { raw = JSON.parse(await entry.async('string')); } catch { throw new Error('project.json non è un JSON valido'); }
  const project = migrateProject(raw);
  project.id = uid('proj');
  project.updatedAt = Date.now();
  for (const env of project.environments) {
    for (const a of env.assets) {
      const f = zip.file(new RegExp(`^assets/${a.id}\\.`))[0];
      if (!f) continue; // reported at load time as a missing asset
      const buf = await f.async('blob');
      await putAsset(project.id, a.id, new Blob([buf], { type: a.mime }));
    }
  }
  await saveProject(project);
  return project;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeFileName = (s: string) => s.trim().replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'project';
