export const EXPECTED_FUNCTIONS: readonly string[];
export const EXPECTED_POLICIES: readonly string[];
export const EXPECTED_RLS_TABLES: readonly string[];

export function redact(value: unknown, secrets?: readonly unknown[]): string;
export function validateProductionUrl(raw: unknown): URL;
export type ProductionEnvironmentSnapshot = {
  checks: {
    secretsEncryptionKey: boolean;
    cronSecret: boolean;
    siteUrl: boolean;
    supabaseUrl: boolean;
    supabaseAnonKey: boolean;
    supabaseServiceRoleKey: boolean;
  };
  errors: string[];
};
export function validateProductionEnvironment(env: Record<string, string | undefined>): ProductionEnvironmentSnapshot;

export type DatabaseSnapshot = {
  serverMajor: number;
  latestMigrationRecorded: boolean;
  missingFunctions: string[];
  missingPolicies: string[];
  rlsDisabled: string[];
  authPrerequisites: Record<string, boolean>;
  healthNotes: { legacyProfileValuesCleared: boolean; privateTablesRls: boolean };
  privilegedProof: { directGrantCount: number; mutationsServiceOnly: boolean; authenticatedStatusOnly: boolean };
  rawPrivilegeLeaks: { policyCount: number; policyIdentities?: string[]; functionCount: number };
  storage: { gymAssetsPublic?: boolean; gymBackupsPublic?: boolean; canonicalStaffPolicies: boolean; restrictiveBucketGuards: boolean };
  operations: Record<string, number>;
};

export type HttpSnapshot = {
  releaseCommit?: string;
  publicPage: { status: number; html: boolean; gymFlowMarker: boolean };
  unsignedWebhook: { status: number };
  crons: Array<{ name: string; status: number }>;
  serviceSettings: {
    available: boolean;
    authStatus?: number;
    platformStatus?: number;
    platformRows?: number;
  };
};

export function validateDatabaseSnapshot(snapshot: DatabaseSnapshot): string[];
export function validateHttpSnapshot(snapshot: HttpSnapshot): string[];
