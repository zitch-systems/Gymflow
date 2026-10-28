import { describe, expect, it } from 'vitest';
import { applyDeliveryStatus } from '@/lib/whatsapp/delivery-status';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
describe('WhatsApp out-of-order delivery receipts', () => {
  function fixture() {
    const row = { status: 'sent', error: null as string | null };
    let patch: typeof row; const filters: unknown[][] = [];
    const q = { update: (value: typeof row) => { patch = value; return q; }, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; }, in: async (_key: string, allowed: string[]) => { if (allowed.includes(row.status)) Object.assign(row, patch); return { error: null }; } };
    return { row, filters, client: { from: () => q } as unknown as SupabaseClient<Database> };
  }
  it('does not downgrade read to delivered, sent or failed', async () => {
    const f = fixture();
    for (const status of ['read', 'delivered', 'sent', 'failed']) await applyDeliveryStatus(f.client, { messageId: 'message', status, recipientId: null, errorTitle: 'late error' });
    expect(f.row).toEqual({ status: 'read', error: null });
    expect(f.filters).toContainEqual(['direction', 'outbound']);
    expect(f.filters).toContainEqual(['wa_message_id', 'message']);
  });
  it('clears a stale failure when delivery is confirmed', async () => {
    const f = fixture();
    for (const status of ['failed', 'delivered']) await applyDeliveryStatus(f.client, { messageId: 'message', status, recipientId: null, errorTitle: 'provider error' });
    expect(f.row).toEqual({ status: 'delivered', error: null });
  });
  it('surfaces Supabase returned errors, which do not throw themselves', async () => {
    const q = { update: () => q, eq: () => q, in: async () => ({ error: { message: 'private details' } }) };
    await expect(applyDeliveryStatus({ from: () => q } as unknown as SupabaseClient<Database>, { messageId: 'message', status: 'read', recipientId: null, errorTitle: null })).rejects.toThrow('could not be saved');
  });
});
