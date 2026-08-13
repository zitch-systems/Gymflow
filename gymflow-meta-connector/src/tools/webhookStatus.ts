import type { Config } from '../config.js';
import { graphGet } from '../metaClient.js';
import type { CheckWebhookStatusInput } from '../schemas.js';

interface SubscribedApp {
  whatsapp_business_api_data?: { id?: string; name?: string; link?: string };
  subscribed_fields?: string[];
}

interface SubscribedAppsResponse {
  data?: SubscribedApp[];
}

export interface WebhookStatusResult {
  wabaId: string;
  subscribed: boolean;
  subscribedApps: Array<{ appName: string | undefined; subscribedFields: string[] }>;
}

export async function checkWebhookStatus(
  config: Config,
  input: CheckWebhookStatusInput,
): Promise<WebhookStatusResult> {
  const wabaId = input.wabaId ?? config.metaWabaId;
  const raw = (await graphGet(config, `${wabaId}/subscribed_apps`)) as SubscribedAppsResponse;
  const apps = raw.data ?? [];
  return {
    wabaId,
    subscribed: apps.length > 0,
    subscribedApps: apps.map((app) => ({
      appName: app.whatsapp_business_api_data?.name,
      subscribedFields: app.subscribed_fields ?? [],
    })),
  };
}
