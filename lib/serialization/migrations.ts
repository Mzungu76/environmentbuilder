import { SCHEMA_VERSION, type Project } from '@/types';

/** One migration per version step: migrations[n] upgrades a version-n document to n+1. */
const migrations: Record<number, (doc: any) => any> = {
  // 1: (doc) => ({ ...doc, schemaVersion: 2, ... })
};

export class SchemaError extends Error {}

/** Validates the basic shape and upgrades older documents to the current schema. */
export function migrateProject(input: unknown): Project {
  if (!input || typeof input !== 'object') throw new SchemaError('Not a valid project file');
  let doc = input as any;
  let v = Number(doc.schemaVersion);
  if (!Number.isInteger(v) || v < 1) throw new SchemaError('Missing or invalid schemaVersion');
  if (v > SCHEMA_VERSION) throw new SchemaError(`Project was created with a newer schema (v${v}); this app supports up to v${SCHEMA_VERSION}`);
  while (v < SCHEMA_VERSION) {
    const step = migrations[v];
    if (!step) throw new SchemaError(`No migration from schema v${v}`);
    doc = step(doc);
    v = doc.schemaVersion;
  }
  if (!Array.isArray(doc.environments) || typeof doc.id !== 'string') throw new SchemaError('Project structure is invalid');
  for (const env of doc.environments) {
    if (!env?.navigation || !Array.isArray(env.navigation.nodes) || !Array.isArray(env.navigation.edges))
      throw new SchemaError(`Environment "${env?.name ?? '?'}" has an invalid navigation graph`);
    env.layers ??= []; env.assets ??= []; env.objects ??= []; env.entrances ??= []; env.exits ??= []; env.characters ??= []; env.profiles ??= ['custom'];
  }
  return doc as Project;
}
