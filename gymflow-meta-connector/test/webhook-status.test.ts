import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../src/metaClient.js', () => ({ graphGet: mocks.get }));
import { checkWebhookStatus } from '../src/tools/webhookStatus.js';
import { inspectWebhookEvents } from '../src/tools/webhookEvents.js';
const config = { metaWabaId: 'waba' } as Config;

describe('Meta event configuration evidence', () => {
  it('distinguishes omitted fields from an explicitly empty field list', async () => {
    mocks.get.mockResolvedValue({ data: [
      { whatsapp_business_api_data: { name: 'Unknown' } },
      { whatsapp_business_api_data: { name: 'Empty' }, subscribed_fields: [] },
      { whatsapp_business_api_data: { name: 'Messages' }, subscribed_fields: ['messages'] },
    ] });
    const status = await checkWebhookStatus(config, {});
    expect(status.subscribed).toBe(true);
    expect(status.subscribedApps.map((app) => app.fieldsReported)).toEqual([false, true, true]);
    const events = await inspectWebhookEvents(config, {});
    expect(events.perApp.map((app) => app.fieldsReported)).toEqual([false, true, true]);
    expect(events.configuredEventTypes).toEqual(['messages']);
    expect(events.note).toContain('unknown, not disabled');
  });
  it('reports no app subscription when Meta returns no subscribed apps', async () => {
    mocks.get.mockResolvedValue({ data: [] });
    expect((await checkWebhookStatus(config, {})).subscribed).toBe(false);
  });
});
