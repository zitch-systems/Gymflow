import type { Config } from '../config.js';
import { graphPost } from '../metaClient.js';
import type { SendTemplateMessageInput, SendTextMessageInput } from '../schemas.js';
import { assertConfirmed } from './writes.js';

// ------------------------------------------------------- send text message
export interface SendTextMessageResult {
  action: 'send_text_message';
  phoneNumberId: string;
  to: string;
  messageId: string | undefined;
  status: string | undefined;
}

export async function sendTextMessage(
  config: Config,
  input: SendTextMessageInput,
): Promise<SendTextMessageResult> {
  assertConfirmed(config, input.to, input.confirm);
  const phoneNumberId = input.phoneNumberId ?? config.metaPhoneNumberId;
  const res = (await graphPost(config, `${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: input.to,
    type: 'text',
    text: { body: input.body, preview_url: input.previewUrl ?? false },
  })) as { messages?: Array<{ id?: string; message_status?: string }> };
  const msg = res.messages?.[0];
  return {
    action: 'send_text_message',
    phoneNumberId,
    to: input.to,
    messageId: msg?.id,
    status: msg?.message_status,
  };
}

// ------------------------------------------------- send template message
export interface SendTemplateMessageResult {
  action: 'send_template_message';
  phoneNumberId: string;
  to: string;
  templateName: string;
  messageId: string | undefined;
  status: string | undefined;
}

export async function sendTemplateMessage(
  config: Config,
  input: SendTemplateMessageInput,
): Promise<SendTemplateMessageResult> {
  assertConfirmed(config, input.to, input.confirm);
  const phoneNumberId = input.phoneNumberId ?? config.metaPhoneNumberId;
  const template: Record<string, unknown> = {
    name: input.templateName,
    language: { code: input.languageCode },
  };
  if (input.components && input.components.length > 0) {
    template.components = input.components;
  }
  const res = (await graphPost(config, `${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to: input.to,
    type: 'template',
    template,
  })) as { messages?: Array<{ id?: string; message_status?: string }> };
  const msg = res.messages?.[0];
  return {
    action: 'send_template_message',
    phoneNumberId,
    to: input.to,
    templateName: input.templateName,
    messageId: msg?.id,
    status: msg?.message_status,
  };
}
