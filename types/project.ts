import type { Environment } from './environment';
import type { EdgeType, NodeType } from './navigation';
import type { ObjectType } from './interaction';
import type { Puppet } from './puppet';

/** User-defined environment profile (configuration only: it suggests types, never restricts). */
export interface CustomProfile {
  id: string;
  label: string;
  description: string;
  suggestedEdgeTypes: EdgeType[];
  suggestedNodeTypes: NodeType[];
  suggestedObjectTypes: ObjectType[];
}

/** Bump when the serialized shape changes and add a migration in lib/serialization/migrations.ts. */
export const SCHEMA_VERSION = 3;

export interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  environments: Environment[];
  activeEnvironmentId: string | null;
  /** Added in schema v2. */
  customProfiles: CustomProfile[];
  /** Added in schema v3: rigged characters made in the Character Studio. */
  puppets: Puppet[];
}
