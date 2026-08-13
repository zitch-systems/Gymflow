import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { loadConfig } from './config.js';
import { registerSecret } from './redact.js';
import { requireApiKey } from './auth.js';
import {
  RateLimiter,
  ipRateLimitMiddleware,
  rateLimitMiddleware,
  startRateLimiterSweep,
} from './rateLimit.js';
import { buildMcpServer } from './mcpServer.js';
import { buildRestRouter } from './rest.js';
import { buildOAuthRouter } from './oauth/router.js';
import { toolsFor } from './tools/registry.js';

const config = loadConfig();

registerSecret(config.metaAccessToken);
registerSecret(config.connectorApiKey);
if (config.metaAppSecret) registerSecret(config.metaAppSecret);

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '256kb' }));

app.get('/healthz', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'gymflow-meta-connector',
    readOnly: config.readOnly,
    toolsExposed: toolsFor(config).length,
  });
});

const limiter = new RateLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests);
startRateLimiterSweep(limiter);

const ipLimiter = new RateLimiter(config.rateLimitWindowMs, config.ipRateLimitMaxRequests);
startRateLimiterSweep(ipLimiter);

app.use(ipRateLimitMiddleware(ipLimiter), buildOAuthRouter(config));

const authenticated = [
  ipRateLimitMiddleware(ipLimiter),
  requireApiKey(config),
  rateLimitMiddleware(config, limiter),
];

app.post('/mcp', ...authenticated, async (req, res) => {
  const requestMeta = {
    keyFingerprint: (res.locals.keyFingerprint as string | undefined) ?? '(none)',
    authMethod: res.locals.authMethod as string | undefined,
    ip: req.ip,
  };
  const server = buildMcpServer(config, requestMeta);
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

app.get('/mcp', ...authenticated, (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed in stateless mode.' },
    id: null,
  });
});
app.delete('/mcp', ...authenticated, (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed in stateless mode.' },
    id: null,
  });
});

app.use('/rest', ...authenticated, buildRestRouter(config));

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

export default app;
