import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { DeliveryStatus } from '@/lib/whatsapp/inbound';

const PREVIOUS: Record<string, string[]> = {
  sent: ['sent'],
  failed: ['sent', 'failed'],
  delivered: ['sent', 'failed', 'delivered'],
  read: ['sent', 'failed', 'delivered', 'read'],
};

/** Receipt delivery can be duplicated or out of order. Advance atomically. */
export async function applyDeliveryStatus(admin: SupabaseClient<Database>, receipt: DeliveryStatus): Promise<void> {
  const previous = PREVIOUS[receipt.status];
  if (!previous) return;
  const { error } = await admin.from('whatsapp_messages')
    .update({ status: receipt.status, error: receipt.status === 'failed' ? receipt.errorTitle : null })
    .eq('wa_message_id', receipt.messageId).eq('direction', 'outbound').in('status', previous);
  if (error) throw new Error('WhatsApp delivery status could not be saved.');
}
