import { SCHEMA_VERSION, type Project } from '@/types';

/** One migration per version step: migrations[n] upgrades a version-n document to n+1. */
const migrations: Record<number, (doc: any) => any> = {
  // v1 → v2: user-defined profiles; interactions get their full configurable shape.
  1: (doc) => ({
    ...doc, schemaVersion: 2, customProfiles: doc.customProfiles ?? [],
    environments: (doc.environments ?? []).map((env: any) => ({
      ...env,
      objects: (env.objects ?? []).map((o: any) => ({ ...o, interactions: (o.interactions ?? []).map(normalizeInteraction) })),
    })),
  }),
};

function normalizeInteraction(i: any) {
  return {
    id: i.id, kind: i.kind ?? 'custom', label: i.label ?? i.kind ?? 'Interazione', trigger: i.trigger ?? 'manual', once: i.once ?? false,
    requires: i.requires ?? [], duration: i.duration ?? 1, message: i.message ?? '', event: i.event ?? '', props: i.props ?? {},
  };
}

export class SchemaError extends Error {}

/** Validates the basic shape and upgrades older documents to the current schema. */
export function migrateProject(input: unknown): Project {
  if (!input || typeof input !== 'object') throw new SchemaError('File di progetto non valido');
  let doc = input as any;
  let v = Number(doc.schemaVersion);
  if (!Number.isInteger(v) || v < 1) throw new SchemaError('schemaVersion mancante o non valido');
  if (v > SCHEMA_VERSION) throw new SchemaError(`Il progetto usa uno schema più recente (v${v}); questa app supporta fino alla v${SCHEMA_VERSION} (newer schema)`);
  while (v < SCHEMA_VERSION) {
    const step = migrations[v];
    if (!step) throw new SchemaError(`Nessuna migrazione dallo schema v${v}`);
    doc = step(doc);
    v = doc.schemaVersion;
  }
  if (!Array.isArray(doc.environments) || typeof doc.id !== 'string') throw new SchemaError('Struttura del progetto non valida');
  for (const env of doc.environments) {
    if (!env?.navigation || !Array.isArray(env.navigation.nodes) || !Array.isArray(env.navigation.edges))
      throw new SchemaError(`L’ambiente “${env?.name ?? '?'}” ha un grafo di navigazione non valido`);
    doc.customProfiles ??= [];
    env.layers ??= []; env.assets ??= []; env.objects ??= []; env.entrances ??= []; env.exits ??= []; env.characters ??= []; env.profiles ??= ['custom'];
  }
  return doc as Project;
}
