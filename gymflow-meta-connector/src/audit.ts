import { redactDeep } from './redact.js';

export interface AuditEvent {
  tool: string;
  keyFingerprint: string;
  ip: string | undefined;
  authMethod?: string;
  write?: boolean;
  target?: string;
  outcome: 'success' | 'error' | 'denied';
  durationMs: number;
  errorMessage?: string;
}

export function auditLog(event: AuditEvent): void {
  const record = redactDeep({
    at: new Date().toISOString(),
    level: 'audit',
    ...event,
  });
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export async function withAudit<T>(
  meta: { tool: string; keyFingerprint: string; ip: string | undefined },
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    auditLog({ ...meta, outcome: 'success', durationMs: Date.now() - start });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    auditLog({
      ...meta,
      outcome: 'error',
      durationMs: Date.now() - start,
      errorMessage: message,
    });
    throw err;
  }
}
