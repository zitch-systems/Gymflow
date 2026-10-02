export const EXPECTED_FUNCTIONS: readonly string[];
export const EXPECTED_POLICIES: readonly string[];
export const EXPECTED_RLS_TABLES: readonly string[];

export function redact(value: unknown, secrets?: readonly unknown[]): string;
export function validateProductionUrl(raw: unknown): URL;
export function resolveProductionOrigin(baseUrl: URL, responseUrl: string): URL;
export function httpSnapshot(baseUrl: URL, cronSecret: string): Promise<HttpSnapshot>;
export type RuntimeSnapshot = {
  releaseCommit: string;
  environment: ProductionEnvironmentSnapshot['checks'];
  http?: HttpSnapshot;
  errors: string[];
};
export function remoteSnapshot(baseUrl: URL, releaseSecret: string | undefined, releaseCommit: string | undefined): Promise<{
  snapshot: RuntimeSnapshot; errors: string[];
}>;
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
  publicPage: { status: number; canonicalOrigin?: string; html: boolean; gymFlowMarker: boolean };
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
