import type { Project } from '@/types';

/** Minimal promise wrapper over IndexedDB (no dependencies). Everything is local to the browser. */

const DB_NAME = 'environment-builder';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const ASSETS = 'assets';

export interface StoredAsset {
  /** Key: `${projectId}:${assetId}` */
  key: string;
  projectId: string;
  assetId: string;
  blob: Blob;
}

export interface ProjectSummary { id: string; name: string; updatedAt: number; environmentCount: number; thumbAssetId: string | null; environments: { id: string; name: string }[] }

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB non è disponibile in questo browser'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(ASSETS)) {
          const s = db.createObjectStore(ASSETS, { keyPath: 'key' });
          s.createIndex('projectId', 'projectId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error ?? new Error('Cannot open IndexedDB')); };
    });
  }
  return dbPromise;
}

function tx<T>(stores: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(stores, mode);
        const req = run(t);
        t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
      }),
  );
}

export async function saveProject(project: Project): Promise<void> {
  await tx([PROJECTS], 'readwrite', (t) => { t.objectStore(PROJECTS).put(project); });
}

export async function loadProject(id: string): Promise<Project | undefined> {
  return (await tx<Project>([PROJECTS], 'readonly', (t) => t.objectStore(PROJECTS).get(id))) ?? undefined;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = (await tx<Project[]>([PROJECTS], 'readonly', (t) => t.objectStore(PROJECTS).getAll())) ?? [];
  return all
    .map((p) => ({
      id: p.id, name: p.name, updatedAt: p.updatedAt, environmentCount: p.environments.length,
      thumbAssetId: p.environments[0]?.layers.find((l) => l.role === 'background')?.assetId ?? null,
      environments: p.environments.map((e) => ({ id: e.id, name: e.name })),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  const keys = await listAssetKeys(id);
  await tx([PROJECTS, ASSETS], 'readwrite', (t) => {
    t.objectStore(PROJECTS).delete(id);
    for (const k of keys) t.objectStore(ASSETS).delete(k);
  });
}

async function listAssetKeys(projectId: string): Promise<string[]> {
  return (await tx<IDBValidKey[]>([ASSETS], 'readonly', (t) => t.objectStore(ASSETS).index('projectId').getAllKeys(projectId)))?.map(String) ?? [];
}

export async function putAsset(projectId: string, assetId: string, blob: Blob): Promise<void> {
  const rec: StoredAsset = { key: `${projectId}:${assetId}`, projectId, assetId, blob };
  await tx([ASSETS], 'readwrite', (t) => { t.objectStore(ASSETS).put(rec); });
}

export async function getAsset(projectId: string, assetId: string): Promise<Blob | undefined> {
  const rec = await tx<StoredAsset>([ASSETS], 'readonly', (t) => t.objectStore(ASSETS).get(`${projectId}:${assetId}`));
  return rec?.blob;
}

export async function deleteAsset(projectId: string, assetId: string): Promise<void> {
  await tx([ASSETS], 'readwrite', (t) => { t.objectStore(ASSETS).delete(`${projectId}:${assetId}`); });
}

export async function listAssets(projectId: string): Promise<StoredAsset[]> {
  return (await tx<StoredAsset[]>([ASSETS], 'readonly', (t) => t.objectStore(ASSETS).index('projectId').getAll(projectId))) ?? [];
}

/** Copies a project together with its image assets. Returns the new project. */
export async function duplicateProject(id: string, newId: string, newName: string): Promise<Project> {
  const src = await loadProject(id);
  if (!src) throw new Error('Progetto non trovato');
  const copy: Project = { ...structuredClone(src), id: newId, name: newName, createdAt: Date.now(), updatedAt: Date.now() };
  for (const a of await listAssets(id)) await putAsset(newId, a.assetId, a.blob);
  await saveProject(copy);
  return copy;
}
