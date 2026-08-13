// Email sent as part of a WhatsApp sign-up.
//
// The member is standing in WhatsApp with a form open. Sending them a
// confirmation LINK would throw them out into a browser and require them to
// find their way back, and the Flow would already have closed by the time they
// did. So this is a code they read and type into the next screen — the same
// shape as the staff two-factor mail, for the same reason.
//
// This is a real verification, not a formality: the account is created
// unconfirmed and stays that way until the code comes back. Nothing about
// possessing a WhatsApp number proves you own the mailbox you typed.

import { callout, code, h1, p, small, t, type EmailContent } from '../layout';

export function whatsappSignupCode(a: {
  code: string;
  minutes: number;
  gymName: string;
  fullName?: string | null;
  email: string;
}): EmailContent {
  const first = (a.fullName ?? '').trim().split(/\s+/)[0] || a.email.split('@')[0] || 'there';
  return {
    subject: `${a.code} confirms your ${a.gymName} account`,
    preheader: `Type this code into WhatsApp to finish signing up. It expires in ${a.minutes} minutes.`,
    blocks: [
      h1(t`Confirm your email`),
      p(t`Hi ${first}, you started creating a ${a.gymName} account on WhatsApp. Type this code into the WhatsApp screen to confirm this address:`),
      code(a.code),
      small(t`The code expires in ${String(a.minutes)} minutes and can only be used once.`),
      p(t`Once confirmed, this email and password also sign you in on the GymFlow app and on the web — it is one account everywhere.`),
      callout('warning', t`If you didn't start this, you can ignore this email. Nobody can use your address without the code above.`),
    ],
  };
}
