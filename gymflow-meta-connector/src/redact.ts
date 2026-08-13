let secrets: string[] = [];

export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 8 && !secrets.includes(value)) {
    secrets.push(value);
  }
}

export function _resetRedactionForTests(): void {
  secrets = [];
}

const MASK = '[REDACTED]';

export function redactDeep<T>(value: T): T {
  if (secrets.length === 0) return value;
  if (typeof value === 'string') {
    return redactString(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDeep(val);
    }
    return out as T;
  }
  return value;
}

function redactString(input: string): string {
  let result = input;
  for (const secret of secrets) {
    if (result.includes(secret)) {
      result = result.split(secret).join(MASK);
    }
  }
  return result;
}
