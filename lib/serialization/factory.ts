import { SCHEMA_VERSION, type Environment, type Project } from '@/types';
import { uid } from '@/lib/ids';
import { emptyGraph } from '@/engine/navigation/graph';

export function createEnvironment(name = 'Ambiente 1'): Environment {
  return {
    id: uid('env'), name, width: 0, height: 0, profiles: ['custom'], layers: [], assets: [],
    navigation: emptyGraph(), objects: [], entrances: [], exits: [], characters: [],
  };
}

export function createProject(name = 'Progetto senza titolo'): Project {
  const env = createEnvironment();
  const now = Date.now();
  return { schemaVersion: SCHEMA_VERSION, id: uid('proj'), name, createdAt: now, updatedAt: now, environments: [env], activeEnvironmentId: env.id };
}
