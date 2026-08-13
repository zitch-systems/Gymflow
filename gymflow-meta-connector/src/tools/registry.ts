import type { z } from 'zod';

import type { Config } from '../config.js';
import {
  businessProfileSchema,
  checkPhoneNumberConfigSchema,
  checkWebhookStatusSchema,
  conversationAnalyticsSchema,
  createFlowSchema,
  createMessageTemplateSchema,
  deleteMessageTemplateSchema,
  deprecateFlowSchema,
  inspectFailedDeliveriesSchema,
  inspectFlowSchema,
  inspectWebhookEventsSchema,
  listFlowsSchema,
  listMessageTemplatesSchema,
  listPhoneNumbersSchema,
  publishFlowSchema,
  publishedFlowScreensSchema,
  updateBusinessProfileSchema,
  updateFlowJsonSchema,
  updateMessageTemplateSchema,
  verifyMetaCredentialsSchema,
  wabaDetailsSchema,
} from '../schemas.js';
import {
  createFlow,
  createMessageTemplate,
  deleteMessageTemplate,
  deprecateFlow,
  publishFlow,
  updateBusinessProfile,
  updateFlowJson,
  updateMessageTemplate,
} from './writes.js';
import { checkWebhookStatus } from './webhookStatus.js';
import { checkPhoneNumberConfig } from './phoneNumberConfig.js';
import { listMessageTemplates } from './messageTemplates.js';
import { inspectFailedDeliveries } from './failedDeliveries.js';
import { inspectWebhookEvents } from './webhookEvents.js';
import { verifyMetaCredentials } from './verifyCredentials.js';
import { getPublishedFlowScreens, inspectFlow, listFlows } from './flows.js';
import {
  getBusinessProfile,
  getConversationAnalytics,
  getWabaDetails,
  listPhoneNumbers,
} from './account.js';

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  handler(config: Config, input: Record<string, unknown>): Promise<unknown>;
  write?: boolean;
}

export const TOOL_REGISTRY: readonly ToolDefinition[] = [
  {
    name: 'check_whatsapp_webhook_status',
    title: 'Check WhatsApp webhook status',
    description:
      "Reports which app(s) are subscribed to this WhatsApp Business Account's webhook events " +
      'and which event fields each is subscribed to.',
    schema: checkWebhookStatusSchema,
    handler: checkWebhookStatus,
  },
  {
    name: 'check_whatsapp_phone_number_config',
    title: 'Check WhatsApp phone number configuration',
    description:
      "Reads GymFlow's outbound WhatsApp number configuration: verification status, quality " +
      'rating, messaging limit tier, and display-name review status.',
    schema: checkPhoneNumberConfigSchema,
    handler: checkPhoneNumberConfig,
  },
  {
    name: 'list_whatsapp_message_templates',
    title: 'List WhatsApp message templates',
    description:
      'Lists the WABA\'s message templates with their approval status, category, language, and ' +
      'quality score.',
    schema: listMessageTemplatesSchema,
    handler: listMessageTemplates,
  },
  {
    name: 'inspect_failed_message_deliveries',
    title: 'Inspect failed message deliveries',
    description:
      'Returns aggregate daily sent/delivered counts for a bounded recent window.',
    schema: inspectFailedDeliveriesSchema,
    handler: inspectFailedDeliveries,
  },
  {
    name: 'inspect_webhook_events',
    title: 'Inspect webhook event configuration',
    description:
      'Lists which webhook event types (fields) are currently configured per subscribed app.',
    schema: inspectWebhookEventsSchema,
    handler: inspectWebhookEvents,
  },
  {
    name: 'verify_meta_credentials',
    title: 'Verify Meta API credentials',
    description:
      'Confirms META_ACCESS_TOKEN is valid and can read the configured WABA and phone number. ' +
      'Never returns the token itself.',
    schema: verifyMetaCredentialsSchema,
    handler: (config: Config) => verifyMetaCredentials(config),
  },
  {
    name: 'list_whatsapp_flows',
    title: 'List WhatsApp Flows',
    description:
      "Lists the WABA's Flows with their publish status and categories.",
    schema: listFlowsSchema,
    handler: listFlows,
  },
  {
    name: 'inspect_whatsapp_flow',
    title: 'Inspect a WhatsApp Flow',
    description:
      "One Flow's status, categories, and validation_errors.",
    schema: inspectFlowSchema,
    handler: inspectFlow,
  },
  {
    name: 'get_published_flow_screens',
    title: 'Get a published Flow\'s screens and routing',
    description:
      'The screen inventory and routing model of the Flow JSON Meta actually has published.',
    schema: publishedFlowScreensSchema,
    handler: getPublishedFlowScreens,
  },
  {
    name: 'get_waba_details',
    title: 'Get WhatsApp Business Account details',
    description:
      "The WABA's name, timezone, template namespace, account review and business " +
      'verification status.',
    schema: wabaDetailsSchema,
    handler: getWabaDetails,
  },
  {
    name: 'list_whatsapp_phone_numbers',
    title: 'List WhatsApp phone numbers',
    description:
      'Every number on the WABA with its quality rating, verification status, messaging limit ' +
      'tier and display-name state.',
    schema: listPhoneNumbersSchema,
    handler: listPhoneNumbers,
  },
  {
    name: 'get_whatsapp_business_profile',
    title: 'Get the public WhatsApp business profile',
    description:
      'The profile customers see: about text, description, address, email, websites and vertical.',
    schema: businessProfileSchema,
    handler: getBusinessProfile,
  },
  {
    name: 'get_conversation_analytics',
    title: 'Get conversation volume and cost',
    description:
      'Aggregate conversation counts and billing over a bounded window, grouped by category.',
    schema: conversationAnalyticsSchema,
    handler: getConversationAnalytics,
  },

  // WRITE tools
  {
    name: 'create_message_template',
    title: 'Create a message template',
    description:
      'Submits a new message template to Meta for review. Requires `confirm` to equal the ' +
      'template name.',
    schema: createMessageTemplateSchema,
    handler: createMessageTemplate,
    write: true,
  },
  {
    name: 'update_message_template',
    title: 'Edit a message template',
    description:
      'Edits an existing template\'s components or category. Requires `confirm` to equal the template ID.',
    schema: updateMessageTemplateSchema,
    handler: updateMessageTemplate,
    write: true,
  },
  {
    name: 'delete_message_template',
    title: 'Delete a message template',
    description:
      'Deletes a template by name, removing EVERY language version. Requires `confirm` to equal the template name.',
    schema: deleteMessageTemplateSchema,
    handler: deleteMessageTemplate,
    write: true,
  },
  {
    name: 'update_whatsapp_business_profile',
    title: 'Update the public business profile',
    description:
      'Updates the profile customers see. Requires `confirm` to equal the phone number ID.',
    schema: updateBusinessProfileSchema,
    handler: updateBusinessProfile,
    write: true,
  },
  {
    name: 'create_whatsapp_flow',
    title: 'Create a WhatsApp Flow',
    description:
      'Creates a new, empty Flow in draft. Requires `confirm` to equal the Flow name.',
    schema: createFlowSchema,
    handler: createFlow,
    write: true,
  },
  {
    name: 'update_whatsapp_flow_json',
    title: "Replace a Flow's draft JSON",
    description:
      "Uploads a Flow JSON document, replacing the draft. Requires `confirm` to equal the Flow ID.",
    schema: updateFlowJsonSchema,
    handler: updateFlowJson,
    write: true,
  },
  {
    name: 'publish_whatsapp_flow',
    title: 'Publish a WhatsApp Flow',
    description:
      'Makes the Flow live for customers. Requires `confirm` to equal the Flow ID.',
    schema: publishFlowSchema,
    handler: publishFlow,
    write: true,
  },
  {
    name: 'deprecate_whatsapp_flow',
    title: 'Deprecate a WhatsApp Flow',
    description:
      'IRREVERSIBLE. No new session can open on this Flow afterwards. Requires `confirm` to equal the Flow ID.',
    schema: deprecateFlowSchema,
    handler: deprecateFlow,
    write: true,
  },
];

export function toolsFor(config: Config): readonly ToolDefinition[] {
  return config.readOnly ? TOOL_REGISTRY.filter((t) => !t.write) : TOOL_REGISTRY;
}

export function targetOf(input: Record<string, unknown>): string | undefined {
  for (const key of ['flowId', 'templateId', 'name', 'phoneNumberId', 'wabaId']) {
    const value = input[key];
    if (typeof value === 'string' && value) return `${key}=${value.slice(0, 120)}`;
  }
  return undefined;
}
