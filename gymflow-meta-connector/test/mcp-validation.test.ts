import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Config } from '../src/config.js';
import { buildMcpServer } from '../src/mcpServer.js';

describe('patched MCP SDK and Zod integration', () => {
  it('lists real schemas and rejects excessive input before invoking Meta', async () => {
    const config = { readOnly: true, metaWabaId: 'test', metaPhoneNumberId: 'test' } as Config;
    const server = buildMcpServer(config, { keyFingerprint: 'test', ip: undefined });
    const client = new Client({ name: 'test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const listing = await client.listTools();
      expect(listing.tools.length).toBeGreaterThan(5);
      const tool = listing.tools.find((t) => t.name === 'verify_meta_credentials');
      expect(tool).toBeDefined();
      const response = await client.callTool({ name: tool!.name, arguments: { excess: Array(10_001).fill(0) } });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response)).toMatch(/limit|elements|exceed/i);
    } finally { await client.close(); await server.close(); }
  });
});
