import { z } from 'zod';

const metaId = z
  .string()
  .trim()
  .regex(/^\d{1,32}$/, 'must be a numeric Meta object ID');

const paginationCursor = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .optional()
  .describe('Opaque `after` cursor from a previous response\'s paging.cursors.after, for the next page.');

const pageLimit = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe('Max items to return (1-100). Defaults to a safe page size.');

export const checkWebhookStatusSchema = z
  .object({
    wabaId: metaId
      .optional()
      .describe('WhatsApp Business Account ID to check. Defaults to META_WABA_ID.'),
  })
  .strict();

export const checkPhoneNumberConfigSchema = z
  .object({
    phoneNumberId: metaId
      .optional()
      .describe('Phone number ID to inspect. Defaults to META_PHONE_NUMBER_ID.'),
  })
  .strict();

export const listMessageTemplatesSchema = z
  .object({
    wabaId: metaId.optional().describe('WhatsApp Business Account ID. Defaults to META_WABA_ID.'),
    limit: pageLimit,
    after: paginationCursor,
    nameFilter: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .optional()
      .describe('Case-sensitive exact template name to filter on.'),
  })
  .strict();

const lookbackHours = z
  .number()
  .int()
  .min(1)
  .max(24 * 30, 'lookback cannot exceed 30 days (720 hours)')
  .optional()
  .describe('How far back to look, in hours (1-720). Defaults to 24.');

export const inspectFailedDeliveriesSchema = z
  .object({
    wabaId: metaId.optional().describe('WhatsApp Business Account ID. Defaults to META_WABA_ID.'),
    lookbackHours,
  })
  .strict();

export const inspectWebhookEventsSchema = z
  .object({
    wabaId: metaId.optional().describe('WhatsApp Business Account ID. Defaults to META_WABA_ID.'),
  })
  .strict();

export const verifyMetaCredentialsSchema = z.object({}).strict();

export const listFlowsSchema = z
  .object({
    wabaId: metaId.optional().describe('WhatsApp Business Account ID. Defaults to META_WABA_ID.'),
    limit: pageLimit,
  })
  .strict();

export const inspectFlowSchema = z
  .object({
    flowId: metaId.describe('Flow ID, from list_whatsapp_flows.'),
  })
  .strict();

export const publishedFlowScreensSchema = z
  .object({
    flowId: metaId.describe('Flow ID, from list_whatsapp_flows.'),
  })
  .strict();

export const wabaDetailsSchema = z
  .object({
    wabaId: metaId.optional().describe('WhatsApp Business Account ID. Defaults to META_WABA_ID.'),
  })
  .strict();

export const listPhoneNumbersSchema = z
  .object({
    wabaId: metaId.optional().describe('WhatsApp Business Account ID. Defaults to META_WABA_ID.'),
  })
  .strict();

export const businessProfileSchema = z
  .object({
    phoneNumberId: metaId
      .optional()
      .describe('Phone number ID whose public profile to read. Defaults to META_PHONE_NUMBER_ID.'),
  })
  .strict();

export const conversationAnalyticsSchema = z
  .object({
    wabaId: metaId.optional().describe('WhatsApp Business Account ID. Defaults to META_WABA_ID.'),
    lookbackHours,
  })
  .strict();

const confirm = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'Safety interlock: must exactly equal the name or ID of the resource this call will ' +
      'change. The call is refused otherwise.',
  );

const templateName = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^[a-z0-9_]+$/, 'Meta template names are lowercase letters, digits and underscores only');

const templateComponents = z
  .array(z.record(z.string(), z.unknown()))
  .min(1)
  .max(20)
  .describe('Meta message-template components array (HEADER / BODY / FOOTER / BUTTONS).');

export const createMessageTemplateSchema = z
  .object({
    wabaId: metaId.optional(),
    name: templateName.describe('Template name. Lowercase, digits and underscores.'),
    language: z.string().trim().min(2).max(10).describe('Language code, e.g. en_US.'),
    category: z
      .enum(['AUTHENTICATION', 'MARKETING', 'UTILITY'])
      .describe('Meta template category.'),
    components: templateComponents,
    confirm: confirm.describe('Must equal the template `name`.'),
  })
  .strict();

export const updateMessageTemplateSchema = z
  .object({
    templateId: metaId.describe('Template ID to edit.'),
    components: templateComponents.optional(),
    category: z.enum(['AUTHENTICATION', 'MARKETING', 'UTILITY']).optional(),
    confirm: confirm.describe('Must equal `templateId`.'),
  })
  .strict();

export const deleteMessageTemplateSchema = z
  .object({
    wabaId: metaId.optional(),
    name: templateName.describe('Template name to delete (removes ALL language versions).'),
    hsmId: metaId.optional().describe('Optional specific template ID, to delete one version only.'),
    confirm: confirm.describe('Must equal the template `name`.'),
  })
  .strict();

export const updateBusinessProfileSchema = z
  .object({
    phoneNumberId: metaId.optional(),
    about: z.string().max(139).optional(),
    address: z.string().max(256).optional(),
    description: z.string().max(512).optional(),
    email: z.string().email().max(128).optional(),
    vertical: z.string().max(64).optional(),
    websites: z.array(z.string().url()).max(2).optional(),
    confirm: confirm.describe('Must equal the phone number ID being updated.'),
  })
  .strict();

export const createFlowSchema = z
  .object({
    wabaId: metaId.optional(),
    name: z.string().trim().min(1).max(200).describe('Flow name.'),
    categories: z
      .array(
        z.enum([
          'SIGN_UP',
          'SIGN_IN',
          'APPOINTMENT_BOOKING',
          'LEAD_GENERATION',
          'CONTACT_US',
          'CUSTOMER_SUPPORT',
          'SURVEY',
          'OTHER',
        ]),
      )
      .min(1)
      .max(8),
    confirm: confirm.describe('Must equal the Flow `name`.'),
  })
  .strict();

export const updateFlowJsonSchema = z
  .object({
    flowId: metaId.describe('Flow ID whose draft JSON to replace.'),
    flowJson: z
      .string()
      .min(2)
      .max(4_000_000)
      .describe('The complete Flow JSON document, as a string.'),
    confirm: confirm.describe('Must equal `flowId`.'),
  })
  .strict();

export const publishFlowSchema = z
  .object({
    flowId: metaId.describe('Flow ID to publish. This makes it live for customers.'),
    confirm: confirm.describe('Must equal `flowId`.'),
  })
  .strict();

export const deprecateFlowSchema = z
  .object({
    flowId: metaId.describe('Flow ID to deprecate. IRREVERSIBLE.'),
    confirm: confirm.describe('Must equal `flowId`.'),
  })
  .strict();

export type CreateMessageTemplateInput = z.infer<typeof createMessageTemplateSchema>;
export type UpdateMessageTemplateInput = z.infer<typeof updateMessageTemplateSchema>;
export type DeleteMessageTemplateInput = z.infer<typeof deleteMessageTemplateSchema>;
export type UpdateBusinessProfileInput = z.infer<typeof updateBusinessProfileSchema>;
export type CreateFlowInput = z.infer<typeof createFlowSchema>;
export type UpdateFlowJsonInput = z.infer<typeof updateFlowJsonSchema>;
export type PublishFlowInput = z.infer<typeof publishFlowSchema>;
export type DeprecateFlowInput = z.infer<typeof deprecateFlowSchema>;

export type ListFlowsInput = z.infer<typeof listFlowsSchema>;
export type InspectFlowInput = z.infer<typeof inspectFlowSchema>;
export type PublishedFlowScreensInput = z.infer<typeof publishedFlowScreensSchema>;
export type WabaDetailsInput = z.infer<typeof wabaDetailsSchema>;
export type ListPhoneNumbersInput = z.infer<typeof listPhoneNumbersSchema>;
export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;
export type ConversationAnalyticsInput = z.infer<typeof conversationAnalyticsSchema>;

export type CheckWebhookStatusInput = z.infer<typeof checkWebhookStatusSchema>;
export type CheckPhoneNumberConfigInput = z.infer<typeof checkPhoneNumberConfigSchema>;
export type ListMessageTemplatesInput = z.infer<typeof listMessageTemplatesSchema>;
export type InspectFailedDeliveriesInput = z.infer<typeof inspectFailedDeliveriesSchema>;
export type InspectWebhookEventsInput = z.infer<typeof inspectWebhookEventsSchema>;
export type VerifyMetaCredentialsInput = z.infer<typeof verifyMetaCredentialsSchema>;

// ── New read schemas ─────────────────────────────────────────────────────────

export const getMessageTemplateSchema = z
  .object({
    wabaId: metaId.optional().describe('WhatsApp Business Account ID. Defaults to META_WABA_ID.'),
    name: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .describe('Template name to look up. Returns all language versions of that template.'),
  })
  .strict();

export const getMessageAnalyticsSchema = z
  .object({
    phoneNumberId: metaId
      .optional()
      .describe('Phone number ID to fetch analytics for. Defaults to META_PHONE_NUMBER_ID.'),
    lookbackHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .optional()
      .describe('How far back to look, in hours (1-720). Defaults to 24.'),
    granularity: z
      .enum(['HALF_HOUR', 'DAY', 'MONTH'])
      .optional()
      .describe('Time bucket size. Defaults to HALF_HOUR.'),
  })
  .strict();

export const getPhoneNumberThroughputSchema = z
  .object({
    phoneNumberId: metaId
      .optional()
      .describe('Phone number ID to inspect. Defaults to META_PHONE_NUMBER_ID.'),
  })
  .strict();

export const getMediaUrlSchema = z
  .object({
    mediaId: metaId.describe(
      'Media ID returned by upload_media or extracted from an incoming webhook message.',
    ),
  })
  .strict();

// ── New write schemas ────────────────────────────────────────────────────────

const e164Phone = z
  .string()
  .trim()
  .min(7)
  .max(20)
  .regex(/^\+?[0-9]+$/, 'must be a phone number in E.164 format, e.g. +2349123456789');

export const sendTextMessageSchema = z
  .object({
    phoneNumberId: metaId
      .optional()
      .describe('Sender phone number ID. Defaults to META_PHONE_NUMBER_ID.'),
    to: e164Phone.describe('Recipient phone number in E.164 format, e.g. +2349123456789.'),
    body: z.string().min(1).max(4096).describe('Text body to send (max 4096 chars).'),
    previewUrl: z
      .boolean()
      .optional()
      .describe('Enable URL link preview in the message. Defaults to false.'),
    confirm: z
      .string()
      .min(1)
      .max(200)
      .describe('Safety interlock: must exactly equal the recipient `to` number.'),
  })
  .strict();

export const sendTemplateMessageSchema = z
  .object({
    phoneNumberId: metaId
      .optional()
      .describe('Sender phone number ID. Defaults to META_PHONE_NUMBER_ID.'),
    to: e164Phone.describe('Recipient phone number in E.164 format.'),
    templateName: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^[a-z0-9_]+$/, 'Meta template names are lowercase letters, digits and underscores')
      .describe('Name of the approved template to send.'),
    languageCode: z
      .string()
      .trim()
      .min(2)
      .max(10)
      .describe('Template language code, e.g. en_US or en.'),
    components: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe(
        'Template variable components array (HEADER/BODY/BUTTONS with parameter substitutions). ' +
          'Omit for templates with no variables.',
      ),
    confirm: z
      .string()
      .min(1)
      .max(200)
      .describe('Safety interlock: must exactly equal the recipient `to` number.'),
  })
  .strict();

export const uploadMediaSchema = z
  .object({
    phoneNumberId: metaId
      .optional()
      .describe('Phone number ID to upload media under. Defaults to META_PHONE_NUMBER_ID.'),
    mediaUrl: z
      .string()
      .url()
      .describe('Publicly accessible HTTPS URL of the media file to upload to WhatsApp.'),
    mimeType: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe(
        'MIME type of the file, e.g. image/jpeg, image/png, audio/mpeg, video/mp4, ' +
          'application/pdf. Must match the actual file content.',
      ),
    confirm: z
      .string()
      .min(1)
      .max(200)
      .describe('Safety interlock: must exactly equal the `mimeType` being uploaded.'),
  })
  .strict();

export const deleteMediaSchema = z
  .object({
    mediaId: metaId.describe('Media ID to permanently delete.'),
    confirm: z
      .string()
      .min(1)
      .max(200)
      .describe('Safety interlock: must exactly equal the `mediaId` being deleted.'),
  })
  .strict();

export const updatePhoneNumberNameSchema = z
  .object({
    phoneNumberId: metaId
      .optional()
      .describe('Phone number ID whose display name to change. Defaults to META_PHONE_NUMBER_ID.'),
    verifiedName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe('New display name to request. Subject to Meta review before it goes live.'),
    confirm: z
      .string()
      .min(1)
      .max(200)
      .describe('Safety interlock: must exactly equal the requested `verifiedName`.'),
  })
  .strict();

export const getBusinessEncryptionSchema = z
  .object({
    phoneNumberId: metaId
      .optional()
      .describe('Phone number ID whose encryption status to read. Defaults to META_PHONE_NUMBER_ID.'),
  })
  .strict();

export const setBusinessEncryptionSchema = z
  .object({
    phoneNumberId: metaId
      .optional()
      .describe('Phone number ID to register the key against. Defaults to META_PHONE_NUMBER_ID.'),
    businessPublicKey: z
      .string()
      .trim()
      .min(1)
      .max(8192)
      .refine(
        (v) => v.includes('-----BEGIN PUBLIC KEY-----') && v.includes('-----END PUBLIC KEY-----'),
        'Must be an RSA public key in PEM form, including the BEGIN/END PUBLIC KEY lines.',
      )
      .refine(
        (v) => !v.includes('PRIVATE KEY'),
        'That is a PRIVATE key. Only the public half is ever uploaded to Meta.',
      )
      .describe(
        'RSA-2048 public key in PEM form. This is the public half of the keypair whose private ' +
          'key the Flow endpoint holds — never the private key itself.',
      ),
    confirm: z
      .string()
      .min(1)
      .max(200)
      .describe('Safety interlock: must exactly equal the `phoneNumberId` being changed.'),
  })
  .strict();

export type GetBusinessEncryptionInput = z.infer<typeof getBusinessEncryptionSchema>;
export type SetBusinessEncryptionInput = z.infer<typeof setBusinessEncryptionSchema>;
export type GetMessageTemplateInput = z.infer<typeof getMessageTemplateSchema>;
export type GetMessageAnalyticsInput = z.infer<typeof getMessageAnalyticsSchema>;
export type GetPhoneNumberThroughputInput = z.infer<typeof getPhoneNumberThroughputSchema>;
export type GetMediaUrlInput = z.infer<typeof getMediaUrlSchema>;
export type SendTextMessageInput = z.infer<typeof sendTextMessageSchema>;
export type SendTemplateMessageInput = z.infer<typeof sendTemplateMessageSchema>;
export type UploadMediaInput = z.infer<typeof uploadMediaSchema>;
export type DeleteMediaInput = z.infer<typeof deleteMediaSchema>;
export type UpdatePhoneNumberNameInput = z.infer<typeof updatePhoneNumberNameSchema>;
