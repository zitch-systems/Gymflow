# Supabase email templates

These are on-brand HTML templates for the two GymFlow flows that send email:

- `confirm-signup.html` — sent after `auth.signUp()` when email confirmation is enabled
- `reset-password.html` — sent by `auth.resetPasswordForEmail()`

Supabase doesn't auto-pick these up from the repo. You paste them into the dashboard once per project (or per branch).

## Where to paste

For each project (production and any preview branches):

1. Go to **Supabase Dashboard → Authentication → Emails → Templates**
2. Pick **Confirm signup** in the sidebar
3. Replace the contents of the **Message body** textarea with `confirm-signup.html`
4. Subject line: `Confirm your GymFlow account`
5. Save
6. Pick **Reset Password** in the sidebar
7. Paste `reset-password.html`
8. Subject line: `Reset your GymFlow password`
9. Save

## Placeholders

Both templates use the standard Supabase variables:

| Variable | What it is |
| --- | --- |
| `{{ .Email }}` | The user's email address |
| `{{ .ConfirmationURL }}` | The fully-built confirm/reset link |
| `{{ .SiteURL }}` | Set in **Authentication → URL Configuration → Site URL** |
| `{{ .Token }}` / `{{ .TokenHash }}` | Raw token for custom link building (not used here) |

`{{ .ConfirmationURL }}` is built from `Site URL + Redirect URLs`. Make sure both are set correctly in **Authentication → URL Configuration** for the right domain (`http://localhost:3000` in dev, `https://gymflow.ng` in prod).

## Testing

After pasting, send a test:

```bash
# In a server action context (or via the SDK):
await supabase.auth.signUp({ email: 'you+test@gymflow.ng', password: 'test123456' })
await supabase.auth.resetPasswordForEmail('you+test@gymflow.ng')
```

You should receive an email rendered with the GymFlow gradient header, single green CTA, and footer.

## Design notes

- 600px max-width, table-based layout (Outlook-safe).
- Inline CSS only — Gmail strips `<style>` blocks.
- System font stack as fallback; Outfit is requested for the wordmark but most email clients won't fetch web fonts.
- Light background (`#f4f7fb`) because dark-mode-by-default emails look broken in many clients when the user's setting overrides them.
- Brand green `#00c896` for the CTA; dark navy `#080e1c` header band; warm amber for the security note on reset-password.

## Custom SMTP (recommended for prod)

By default Supabase sends from `noreply@mail.app.supabase.io` with strict rate limits. Before launch, configure a custom SMTP under **Authentication → Emails → SMTP Settings** with e.g. Postmark, Resend, or SendGrid using `hello@gymflow.ng`.
