import type { Config } from './config.js';

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly metaErrorCode: number | undefined,
    public readonly metaErrorType: string | undefined,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

interface GraphErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export async function graphGet(
  config: Config,
  path: string,
  query: Record<string, string | number | undefined> = {},
): Promise<unknown> {
  const url = new URL(`${config.graphApiBaseUrl}/${config.graphApiVersion}/${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.graphTimeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.metaAccessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new MetaApiError(
        `Meta API returned a non-JSON response (HTTP ${response.status}).`,
        response.status,
        undefined,
        undefined,
      );
    }

    if (!response.ok) {
      const errBody = body as GraphErrorBody;
      throw new MetaApiError(
        errBody.error?.message ?? `Meta API request failed (HTTP ${response.status}).`,
        response.status,
        errBody.error?.code,
        errBody.error?.type,
      );
    }

    return body;
  } catch (err) {
    if (err instanceof MetaApiError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MetaApiError(
        `Meta API did not respond within ${config.graphTimeoutMs}ms.`,
        undefined,
        undefined,
        'timeout',
      );
    }
    throw new MetaApiError(
      `Could not reach Meta API: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      undefined,
      'network_error',
    );
  } finally {
    clearTimeout(timer);
  }
}

async function graphMutate(
  config: Config,
  method: 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
  query: Record<string, string | number | undefined> = {},
): Promise<unknown> {
  if (config.readOnly) {
    throw new MetaApiError(
      'This connector is in read-only mode; write calls are refused.',
      undefined,
      undefined,
      'read_only',
    );
  }
  const url = new URL(`${config.graphApiBaseUrl}/${config.graphApiVersion}/${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.graphTimeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.metaAccessToken}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new MetaApiError(
        `Meta API returned a non-JSON response (HTTP ${response.status}).`,
        response.status,
        undefined,
        undefined,
      );
    }
    if (!response.ok) {
      const errBody = parsed as GraphErrorBody;
      throw new MetaApiError(
        errBody.error?.message ?? `Meta API request failed (HTTP ${response.status}).`,
        response.status,
        errBody.error?.code,
        errBody.error?.type,
      );
    }
    return parsed;
  } catch (err) {
    if (err instanceof MetaApiError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MetaApiError(
        `Meta API did not respond within ${config.graphTimeoutMs}ms.`,
        undefined,
        undefined,
        'timeout',
      );
    }
    throw new MetaApiError(
      `Could not reach Meta API: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      undefined,
      'network_error',
    );
  } finally {
    clearTimeout(timer);
  }
}

export function graphPost(
  config: Config,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return graphMutate(config, 'POST', path, body);
}

export function graphDelete(
  config: Config,
  path: string,
  query: Record<string, string | number | undefined> = {},
): Promise<unknown> {
  return graphMutate(config, 'DELETE', path, undefined, query);
}

export async function graphPostMultipart(
  config: Config,
  path: string,
  fields: Record<string, string>,
  fileField: string,
  fileBlob: Blob,
  fileName: string,
): Promise<unknown> {
  if (config.readOnly) {
    throw new MetaApiError(
      'This connector is in read-only mode; write calls are refused.',
      undefined,
      undefined,
      'read_only',
    );
  }
  const url = new URL(`${config.graphApiBaseUrl}/${config.graphApiVersion}/${path}`);
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append(fileField, fileBlob, fileName);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.graphTimeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.metaAccessToken}`, Accept: 'application/json' },
      body: form,
      signal: controller.signal,
    });
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new MetaApiError(
        `Meta API returned a non-JSON response (HTTP ${response.status}).`,
        response.status,
        undefined,
        undefined,
      );
    }
    if (!response.ok) {
      const errBody = parsed as GraphErrorBody;
      throw new MetaApiError(
        errBody.error?.message ?? `Meta API request failed (HTTP ${response.status}).`,
        response.status,
        errBody.error?.code,
        errBody.error?.type,
      );
    }
    return parsed;
  } catch (err) {
    if (err instanceof MetaApiError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MetaApiError(
        `Meta API did not respond within ${config.graphTimeoutMs}ms.`,
        undefined,
        undefined,
        'timeout',
      );
    }
    throw new MetaApiError(
      `Could not reach Meta API: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      undefined,
      'network_error',
    );
  } finally {
    clearTimeout(timer);
  }
}

const ASSET_HOST_SUFFIXES = ['.fbcdn.net', '.fbsbx.com', '.facebook.com', '.whatsapp.net'] as const;

export function isAllowedAssetUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return ASSET_HOST_SUFFIXES.some(
    (suffix) => url.hostname.endsWith(suffix) || url.hostname === suffix.slice(1),
  );
}

export async function fetchMetaAsset(config: Config, rawUrl: string): Promise<unknown> {
  if (!isAllowedAssetUrl(rawUrl)) {
    throw new MetaApiError(
      'Refusing to fetch an asset from a non-Meta host.',
      undefined,
      undefined,
      'blocked_host',
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.graphTimeoutMs);
  try {
    const response = await fetch(rawUrl, { method: 'GET', signal: controller.signal });
    if (!response.ok) {
      throw new MetaApiError(
        `Could not download the Flow asset (HTTP ${response.status}).`,
        response.status,
        undefined,
        undefined,
      );
    }
    return await response.json();
  } catch (err) {
    if (err instanceof MetaApiError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MetaApiError(
        `The Flow asset download did not complete within ${config.graphTimeoutMs}ms.`,
        undefined,
        undefined,
        'timeout',
      );
    }
    throw new MetaApiError(
      `Could not download the Flow asset: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      undefined,
      'network_error',
    );
  } finally {
    clearTimeout(timer);
  }
}
