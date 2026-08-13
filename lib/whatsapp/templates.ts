// The message templates submitted to Meta for approval.
//
// Kept here (rather than only in Meta's dashboard) so the placeholder ORDER is
// version-controlled next to the code that fills it. A template's variables are
// positional — {{1}}, {{2}} — and Meta silently accepts a send with the
// arguments in the wrong order, producing a message that reads as nonsense to
// the member. Defining both halves in one file is what stops that drift.
//
// scripts/whatsapp-templates.mjs submits these. Approval takes minutes to
// hours; until a template is APPROVED, sends using it fail and the reminder
// path falls back to email, which it would have sent anyway.

export type TemplateDef = {
  name: string;
  language: string;
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  components: Array<Record<string, unknown>>;
};

export const TEMPLATES = {
  renewalReminder: {
    name: 'gymflow_renewal_reminder',
    language: 'en',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        // 1 first name · 2 gym name · 3 days left · 4 end date
        text: 'Hi {{1}}, your {{2}} membership expires in {{3}} day(s), on {{4}}. Renew now to keep training without a break.',
        example: { body_text: [['Ada', 'Iron Republic', '3', '2026-09-01']] },
      },
      { type: 'FOOTER', text: 'Reply MENU for options or STOP to unsubscribe' },
      {
        type: 'BUTTONS',
        buttons: [{ type: 'QUICK_REPLY', text: 'Renew now' }, { type: 'QUICK_REPLY', text: 'My membership' }],
      },
    ],
  },

  paymentReceipt: {
    name: 'gymflow_payment_receipt',
    language: 'en',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        // 1 gym name · 2 amount · 3 new end date
        text: 'Payment received. Your {{1}} membership has been credited with {{2}} and now runs to {{3}}. Thank you.',
        example: { body_text: [['Iron Republic', '₦25,000', '2026-10-01']] },
      },
      { type: 'FOOTER', text: 'Reply MENU for options' },
    ],
  },

  membershipExpired: {
    name: 'gymflow_membership_expired',
    language: 'en',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        // 1 first name · 2 gym name · 3 end date
        text: 'Hi {{1}}, your {{2}} membership ended on {{3}}. Renew any time to pick up where you left off.',
        example: { body_text: [['Ada', 'Iron Republic', '2026-08-01']] },
      },
      { type: 'FOOTER', text: 'Reply MENU for options or STOP to unsubscribe' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Renew now' }] },
    ],
  },
} satisfies Record<string, TemplateDef>;

export const ALL_TEMPLATES: TemplateDef[] = Object.values(TEMPLATES);
