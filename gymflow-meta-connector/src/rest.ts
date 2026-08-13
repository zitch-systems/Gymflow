import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import { ZodError } from 'zod';

import type { Config } from './config.js';
import { withAudit } from './audit.js';
import { MetaApiError } from './metaClient.js';
import { redactDeep } from './redact.js';
import { targetOf, toolsFor } from './tools/registry.js';
import { ConfirmationError } from './tools/writes.js';

function coerceQuery(query: Request['query']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== 'string') continue;
    if (key === 'limit' || key === 'lookbackHours') {
      const n = Number(value);
      out[key] = Number.isFinite(n) ? n : value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function buildRestRouter(config: Config): Router {
  const router = createRouter();

  for (const tool of toolsFor(config)) {
    const path = `/${tool.name.replace(/_/g, '-')}`;

    const handle = async (req: Request, res: Response): Promise<void> => {
      const raw = tool.write ? ((req.body ?? {}) as Record<string, unknown>) : coerceQuery(req.query);
      const meta = {
        tool: tool.name,
        keyFingerprint: (res.locals.keyFingerprint as string | undefined) ?? '(none)',
        authMethod: res.locals.authMethod as string | undefined,
        ip: req.ip,
        ...(tool.write ? { write: true, target: targetOf(raw) } : {}),
      };
      try {
        const result = await withAudit(meta, async () => {
          const input = tool.schema.parse(raw);
          return tool.handler(config, input);
        });
        res.status(200).json(redactDeep(result));
      } catch (err) {
        sendRestError(res, err);
      }
    };

    if (tool.write) {
      router.post(path, handle);
      router.get(path, (_req, res) => {
        res.status(405).json({
          error: 'method_not_allowed',
          message: `${tool.name} modifies Meta configuration and must be called with POST.`,
        });
      });
    } else {
      router.get(path, handle);
    }
  }

  router.get('/', (_req, res) => {
    res.status(200).json({
      readOnly: config.readOnly,
      tools: toolsFor(config).map((t) => ({
        name: t.name,
        method: t.write ? 'POST' : 'GET',
        path: `/rest/${t.name.replace(/_/g, '-')}`,
        write: Boolean(t.write),
        description: t.description,
      })),
    });
  });

  return router;
}

function sendRestError(res: Response, err: unknown): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'invalid_input', message: err.message, issues: err.issues });
    return;
  }
  if (err instanceof ConfirmationError) {
    res.status(400).json({ error: 'confirmation_required', message: err.message });
    return;
  }
  if (err instanceof MetaApiError) {
    res.status(err.status && err.status >= 400 && err.status < 500 ? err.status : 502).json({
      error: 'meta_api_error',
      message: err.message,
    });
    return;
  }
  res.status(500).json({ error: 'internal_error', message: 'Internal error handling this request.' });
}
