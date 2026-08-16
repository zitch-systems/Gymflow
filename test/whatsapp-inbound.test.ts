import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { extractMessages, extractStatuses, verifyMetaSignature } from '@/lib/whatsapp/inbound';
import { parseQrMessage } from '@/lib/whatsapp/checkin';

const SECRET = 'app-secret';
const sign = (raw: string) => `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;

describe('verifyMetaSignature', () => {
  it('accepts a correctly signed body', () => {
    const raw = '{"entry":[]}';
    expect(verifyMetaSignature(raw, sign(raw), SECRET)).toBe(true);
  });
  it('rejects a body that was altered after signing', () => {
    const raw = '{"entry":[]}';
    expect(verifyMetaSignature('{"entry":[1]}', sign(raw), SECRET)).toBe(false);
  });
  it('rejects a missing or malformed header', () => {
    expect(verifyMetaSignature('{}', null, SECRET)).toBe(false);
    expect(verifyMetaSignature('{}', 'sha1=abc', SECRET)).toBe(false);
  });
  it('rejects a signature of the right shape but the wrong length', () => {
    expect(verifyMetaSignature('{}', 'sha256=aabb', SECRET)).toBe(false);
  });
  it('rejects every request when no app secret is configured', () => {
    expect(verifyMetaSignature('{}', null, undefined)).toBe(false);
    expect(verifyMetaSignature('{}', 'sha256=aabb', undefined)).toBe(false);
  });
});

function envelope(message: Record<string, unknown>, contacts?: unknown) {
  return {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: '1245745388626014' },
          ...(contacts ? { contacts } : {}),
          messages: [message],
        },
      }],
    }],
  };
}

describe('extractMessages', () => {
  it('reads a plain text message and the sender profile name', () => {
    const [msg] = extractMessages(envelope(
      { id: 'wamid.1', from: '2348031234567', type: 'text', text: { body: 'menu' } },
      [{ wa_id: '2348031234567', profile: { name: 'Ada' } }],
    ));
    expect(msg).toMatchObject({ kind: 'text', text: 'menu', from: '2348031234567', contactName: 'Ada', actionId: null });
  });

  it('reads a quick-reply button tap as an action id, not as prose', () => {
    const [msg] = extractMessages(envelope({
      id: 'wamid.2', from: '2348031234567', type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'menu:checkin', title: 'Check in' } },
    }));
    // The action id is what routes; the title is only what we log and show.
    expect(msg).toMatchObject({ kind: 'button', actionId: 'menu:checkin', text: 'Check in' });
  });

  it('reads a list selection', () => {
    const [msg] = extractMessages(envelope({
      id: 'wamid.3', from: '2348031234567', type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id: 'plan:abc-123', title: 'Monthly' } },
    }));
    expect(msg).toMatchObject({ kind: 'list', actionId: 'plan:abc-123' });
  });

  it('decodes a completed Flow submission', () => {
    const [msg] = extractMessages(envelope({
      id: 'wamid.4', from: '2348031234567', type: 'interactive',
      interactive: {
        type: 'nfm_reply',
        nfm_reply: { name: 'flow', body: 'Sent', response_json: '{"flow_token":"tok","status":"ok"}' },
      },
    }));
    expect(msg.kind).toBe('flow');
    expect(msg.flowResponse).toEqual({ flow_token: 'tok', status: 'ok' });
  });

  it('still reports a Flow completion whose payload will not parse', () => {
    const [msg] = extractMessages(envelope({
      id: 'wamid.5', from: '2348031234567', type: 'interactive',
      interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: 'not json' } },
    }));
    expect(msg.kind).toBe('flow');
    expect(msg.flowResponse).toBeNull();
  });

  it('reads a template quick-reply button', () => {
    const [msg] = extractMessages(envelope({
      id: 'wamid.6', from: '2348031234567', type: 'button',
      button: { payload: 'menu:renew', text: 'Renew now' },
    }));
    expect(msg).toMatchObject({ kind: 'template_button', actionId: 'menu:renew' });
  });

  // Media gets a kind so the router can say "I can't read that" rather than
  // leaving the member staring at silence.
  it('reports unsupported media as kind "other"', () => {
    const [msg] = extractMessages(envelope({ id: 'wamid.7', from: '2348031234567', type: 'image', image: { id: '1' } }));
    expect(msg.kind).toBe('other');
  });

  it('drops entries with no phone number id, which cannot be replied to', () => {
    expect(extractMessages({ entry: [{ changes: [{ value: { messages: [{ from: '234', type: 'text', text: { body: 'x' } }] } }] }] })).toEqual([]);
  });

  it('returns nothing for a status-only delivery', () => {
    expect(extractMessages({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '1' }, statuses: [] } }] }] })).toEqual([]);
  });
});

describe('extractStatuses', () => {
  it('reads delivery receipts and their failure reason', () => {
    const statuses = extractStatuses({
      entry: [{ changes: [{ value: { metadata: { phone_number_id: '1' }, statuses: [
        { id: 'wamid.1', status: 'delivered', recipient_id: '2348031234567' },
        { id: 'wamid.2', status: 'failed', recipient_id: '2348031234567', errors: [{ title: 'Re-engagement message' }] },
      ] } }] }],
    });
    expect(statuses).toHaveLength(2);
    expect(statuses[1]).toMatchObject({ status: 'failed', errorTitle: 'Re-engagement message' });
  });
});

describe('parseQrMessage', () => {
  it('recognises the door-QR message', () => {
    expect(parseQrMessage('CHECKIN iron-republic AbCd1234567890efGh')).toEqual({
      slug: 'iron-republic', token: 'AbCd1234567890efGh',
    });
  });
  it('is case-insensitive and tolerant of stray whitespace', () => {
    expect(parseQrMessage('  checkin  iron-republic   AbCd1234567890efGh ')).toMatchObject({ slug: 'iron-republic' });
  });
  it('ignores ordinary conversation', () => {
    expect(parseQrMessage('checkin')).toBeNull();
    expect(parseQrMessage('I want to check in')).toBeNull();
    expect(parseQrMessage('CHECKIN iron-republic')).toBeNull();
  });
  it('rejects a slug that is not a slug', () => {
    expect(parseQrMessage('CHECKIN ../../etc AbCd1234567890efGh')).toBeNull();
  });
});
