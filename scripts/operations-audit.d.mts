export type OperationsSnapshot = {
  jobs: Array<Record<string, unknown>>;
  incidents: Array<Record<string, unknown>>;
  queues: Record<string, unknown>;
  unallocated_member_payments: Array<Record<string, unknown>>;
  unallocated_platform_payments: Array<Record<string, unknown>>;
};
export function safeLabel(value: unknown, fallback?: string): string;
export function errorClass(value: unknown): string;
export function incidentKind(value: unknown): string;
export function operationsSnapshot(client: { query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }> }): Promise<OperationsSnapshot>;
export function runOperationsAudit(connectionString?: string): Promise<OperationsSnapshot>;
