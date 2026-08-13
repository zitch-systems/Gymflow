/**
 * WhatsApp Flows — the interactive multi-screen forms (GymFlow's booking,
 * check-in and membership ladders), as distinct from message templates.
 *
 * These exist because of a specific, repeated failure. The Flow JSON lives in
 * the repo but is published BY HAND in WhatsApp Manager, so every screen added
 * in code is missing on Meta's side until someone pastes and publishes. The
 * symptom is that older screens keep working while the newest ones are
 * rejected — which reads like "some features are broken" rather than "the Flow
 * is one publish behind", and is indistinguishable from a bad token, an
 * unverified business, or an expired session without exactly this reading.
 */
import type { Config } from '../config.js';
import { fetchMetaAsset, graphGet } from '../metaClient.js';
import type {
  InspectFlowInput,
  ListFlowsInput,
  PublishedFlowScreensInput,
} from '../schemas.js';

interface FlowNode {
  id?: string;
  name?: string;
  status?: string;
  categories?: string[];
  validation_errors?: Array<{ error?: string; error_type?: string; message?: string; pointers?: unknown }>;
  updated_at?: string;
}

export interface ListFlowsResult {
  wabaId: string;
  flows: Array<{
    id: string | undefined;
    name: string | undefined;
    status: string | undefined;
    categories: string[];
    updatedAt: string | undefined;
  }>;
}

export async function listFlows(config: Config, input: ListFlowsInput): Promise<ListFlowsResult> {
  const wabaId = input.wabaId ?? config.metaWabaId;
  const raw = (await graphGet(config, `${wabaId}/flows`, {
    fields: 'id,name,status,categories,updated_at',
    limit: input.limit ?? 50,
  })) as { data?: FlowNode[] };
  return {
    wabaId,
    flows: (raw.data ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      status: f.status,
      categories: f.categories ?? [],
      updatedAt: f.updated_at,
    })),
  };
}

export interface InspectFlowResult {
  flowId: string;
  name: string | undefined;
  status: string | undefined;
  categories: string[];
  updatedAt: string | undefined;
  validationErrors: string[];
  previewUrl: string | undefined;
  previewExpiresAt: string | undefined;
}

export async function inspectFlow(config: Config, input: InspectFlowInput): Promise<InspectFlowResult> {
  const node = (await graphGet(config, input.flowId, {
    fields: 'id,name,status,categories,updated_at,validation_errors,preview.invalidate(false)',
  })) as FlowNode & { preview?: { preview_url?: string; expires_at?: string } };

  return {
    flowId: input.flowId,
    name: node.name,
    status: node.status,
    categories: node.categories ?? [],
    updatedAt: node.updated_at,
    validationErrors: (node.validation_errors ?? [])
      .map((e) => [e.error_type, e.error ?? e.message].filter(Boolean).join(': '))
      .filter(Boolean)
      .slice(0, 20),
    previewUrl: node.preview?.preview_url,
    previewExpiresAt: node.preview?.expires_at,
  };
}

interface FlowJson {
  version?: string;
  data_api_version?: string;
  routing_model?: Record<string, string[]>;
  screens?: Array<{ id?: string; title?: string; terminal?: boolean }>;
}

export interface PublishedFlowScreensResult {
  flowId: string;
  flowJsonVersion: string | undefined;
  dataApiVersion: string | undefined;
  screens: string[];
  terminalScreens: string[];
  routingRootScreens: string[];
  routingModel: Record<string, string[]>;
  danglingRoutes: string[];
  unreachableScreens: string[];
  note: string;
}

export function analyseFlowJson(
  flowId: string,
  flow: FlowJson,
): Omit<PublishedFlowScreensResult, 'note'> {
  const screens = (flow.screens ?? []).map((s) => s.id).filter((id): id is string => Boolean(id));
  const routing = flow.routing_model ?? {};

  const targets = new Set<string>();
  for (const next of Object.values(routing)) {
    for (const screen of next ?? []) targets.add(screen);
  }

  const known = new Set(screens);
  const dangling = [...new Set([...Object.keys(routing), ...targets])]
    .filter((screen) => !known.has(screen))
    .sort();
  const unreachable = screens
    .filter((screen) => !targets.has(screen) && !(screen in routing))
    .sort();

  return {
    flowId,
    flowJsonVersion: flow.version,
    dataApiVersion: flow.data_api_version,
    screens,
    terminalScreens: (flow.screens ?? [])
      .filter((s) => s.terminal && s.id)
      .map((s) => s.id!)
      .sort(),
    routingRootScreens: screens.filter((screen) => !targets.has(screen)),
    routingModel: routing,
    danglingRoutes: dangling,
    unreachableScreens: unreachable,
  };
}

export async function getPublishedFlowScreens(
  config: Config,
  input: PublishedFlowScreensInput,
): Promise<PublishedFlowScreensResult> {
  const assets = (await graphGet(config, `${input.flowId}/assets`)) as {
    data?: Array<{ asset_type?: string; download_url?: string }>;
  };
  const asset = (assets.data ?? []).find(
    (a) => a.asset_type === 'FLOW_JSON' && typeof a.download_url === 'string',
  );
  if (!asset?.download_url) {
    throw new Error('This Flow has no published FLOW_JSON asset yet.');
  }

  const flow = (await fetchMetaAsset(config, asset.download_url)) as FlowJson;
  return {
    ...analyseFlowJson(input.flowId, flow),
    note:
      'Screen inventory and routing only — the full Flow JSON is deliberately not returned, ' +
      'because it embeds the logo as base64 and runs to hundreds of KB. Compare `screens` ' +
      "against the repo's Flow JSON source to detect a Flow that is one publish behind the " +
      'code; a screen present in the repo and absent here is rejected at send time.',
  };
}
