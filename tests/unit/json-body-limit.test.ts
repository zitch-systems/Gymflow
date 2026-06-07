import { describe, it, expect } from 'vitest';
import { readJsonBody } from '@/lib/rate-limit';

function buildRequest(body: string, contentLength?: number): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (contentLength !== undefined) headers['content-length'] = String(contentLength);
  return new Request('https://test.local/api', { method: 'POST', headers, body });
}

describe('readJsonBody — bounded body reader', () => {
  it('parses valid JSON within the limit', async () => {
    const raw = JSON.stringify({ hello: 'world' });
    const out = await readJsonBody<{ hello: string }>(buildRequest(raw));
    expect(out).toEqual({ hello: 'world' });
  });

  it('returns a 413 when content-length exceeds the cap', async () => {
    // Cheap header-only attack — never read the body.
    const out = await readJsonBody(buildRequest('{}', 32_000), 1024);
    expect(out).toBeInstanceOf(Response);
    expect((out as Response).status).toBe(413);
  });

  it('returns a 413 when the actual body exceeds the cap (lying header)', async () => {
    // Attacker omits or lies about content-length; we must still cap on read.
    const big = '"' + 'A'.repeat(20_000) + '"';
    const out = await readJsonBody(buildRequest(big), 1024);
    expect(out).toBeInstanceOf(Response);
    expect((out as Response).status).toBe(413);
  });

  it('returns a 400 on malformed JSON', async () => {
    const out = await readJsonBody(buildRequest('{not-json'));
    expect(out).toBeInstanceOf(Response);
    expect((out as Response).status).toBe(400);
  });

  it('default cap is large enough for the real payloads we send', async () => {
    // The biggest real call is platform-initiate with gym + owner fields.
    const big = JSON.stringify({
      gymName: 'A'.repeat(120),
      ownerEmail: 'owner@example.com',
      ownerName: 'A'.repeat(80),
      ownerPhone: '+234' + '8'.repeat(13),
      slug: 'demo-gym',
      billing: 'annual',
    });
    expect(big.length).toBeLessThan(8 * 1024);
    const out = await readJsonBody(buildRequest(big));
    expect(out).not.toBeInstanceOf(Response);
  });
});
