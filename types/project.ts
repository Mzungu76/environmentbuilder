import type { Environment } from './environment';

/** Bump when the serialized shape changes and add a migration in lib/serialization/migrations.ts. */
export const SCHEMA_VERSION = 1;

export interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  environments: Environment[];
  activeEnvironmentId: string | null;
}
