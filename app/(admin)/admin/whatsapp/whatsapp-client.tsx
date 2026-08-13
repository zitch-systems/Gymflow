'use client';

import { useEffect, useRef, useState } from 'react';
import { useActionState } from 'react';
import {
  LayoutDashboard, Users, Settings as SettingsIcon, Bot, KeyRound, UserCheck2,
  MessagesSquare, Wallet, Send,
} from 'lucide-react';
import {
  saveWhatsAppSettings, saveAiSettings, clearAiKey, replyToContact, loadContactMessages,
  type WhatsAppSaveState, type WhatsAppMessageRow,
} from '@/lib/actions/whatsapp';
import { providerUsable, dialectFor } from '@/lib/ai/dialects';
import { formatWaId } from '@/lib/whatsapp/phone';
import { fmtDateTime } from '@/lib/format';

const INIT: WhatsAppSaveState = { ok: false, error: null };

const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
  { id: 'ai', label: 'AI assistant', icon: Bot },
] as const;

// Which server env vars this channel depends on, and why — shown as
// integration-health rows. Booleans come from the server page (see
// app/(admin)/admin/whatsapp/page.tsx); this file only knows how to label them.
const ENV_ITEMS = [
  { key: 'WHATSAPP_ACCESS_TOKEN', label: 'WhatsApp access token', hint: 'Authenticates outbound sends to Meta’s Cloud API.' },
  { key: 'WHATSAPP_PHONE_NUMBER_ID', label: 'WhatsApp phone number ID', hint: 'Which Meta business number this gym’s messages send from.' },
  { key: 'META_APP_SECRET', label: 'Meta app secret', hint: 'Verifies inbound webhook calls really came from Meta.' },
  { key: 'WHATSAPP_FLOW_ID', label: 'WhatsApp Flow ID', hint: 'The sign-up / sign-in Flow rendered inside WhatsApp.' },
  { key: 'WHATSAPP_FLOW_PRIVATE_KEY', label: 'Flow private key', hint: 'Decrypts each Flow screen’s data exchange.' },
  { key: 'SECRETS_ENCRYPTION_KEY', label: 'Secrets encryption key', hint: 'Encrypts stored AI provider keys at rest.' },
] as const;

export type EnvStatus = Record<(typeof ENV_ITEMS)[number]['key'], boolean>;

export type ContactRow = {
  id: string;
  waId: string;
  displayName: string | null;
  profileName: string | null;
  profileEmail: string | null;
  linked: boolean;
  optedIn: boolean;
  blocked: boolean;
  lastMessageAt: string | null;
};

export type AiProviderRow = {
  slug: string;
  name: string;
  models: string[];
  defaultModel: string | null;
  docsUrl: string | null;
};

export type WhatsAppSettingsData = {
  enabled: boolean;
  supportPhone: string | null;
  appHomeUrl: string | null;
  welcomeMessage: string | null;
  qrCheckinEnabled: boolean;
};

export type AiSettingsData = {
  providerSlug: string | null;
  model: string | null;
  systemPrompt: string | null;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  monthlyTokenCap: number;
  tokensUsedThisMonth: number;
};

export type WhatsAppKpis = { totalContacts: number; linkedContacts: number; messages7d: number; pendingIntents: number };

export function WhatsAppClient({
  gymName, gymPhone, kpis, env, contacts, whatsappSettings, aiSettings, providers, hasGymKey, secretsReady,
}: {
  gymName: string;
  gymPhone: string | null;
  kpis: WhatsAppKpis;
  env: EnvStatus;
  contacts: ContactRow[];
  whatsappSettings: WhatsAppSettingsData;
  aiSettings: AiSettingsData;
  providers: AiProviderRow[];
  hasGymKey: boolean;
  secretsReady: boolean;
}) {
  const [sec, setSec] = useState<(typeof NAV)[number]['id']>('overview');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <>
      <div className="page-h"><div><h1>WhatsApp</h1><p>{gymName} · member chat, replies and the AI assistant behind them</p></div></div>

      <div className="set-wrap">
        <nav className="subnav">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <button type="button" key={n.id} className={sec === n.id ? 'on' : undefined} onClick={() => setSec(n.id)} aria-current={sec === n.id ? 'true' : undefined}>
                <Icon strokeWidth={1.75} /> {n.label}
              </button>
            );
          })}
        </nav>

        <div>
          {sec === 'overview' && <OverviewTab kpis={kpis} env={env} />}

          {sec === 'members' && (
            <MembersTab contacts={contacts} selectedId={selectedId} onSelect={setSelectedId} />
          )}

          {sec === 'settings' && <SettingsTab gymPhone={gymPhone} initial={whatsappSettings} />}

          {sec === 'ai' && (
            <AiTab initial={aiSettings} providers={providers} hasGymKey={hasGymKey} secretsReady={secretsReady} />
          )}
        </div>
      </div>
    </>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────
function OverviewTab({ kpis, env }: { kpis: WhatsAppKpis; env: EnvStatus }) {
  const KPIS = [
    { icon: Users, bg: '#4080ff1f', fg: '#4080ff', val: kpis.totalContacts, lbl: 'WhatsApp contacts' },
    { icon: UserCheck2, bg: '#11d18b1f', fg: '#11d18b', val: kpis.linkedContacts, lbl: 'Linked to a member account' },
    { icon: MessagesSquare, bg: '#c6f24e1f', fg: '#a8d92e', val: kpis.messages7d, lbl: 'Messages, last 7 days' },
    { icon: Wallet, bg: '#ffb0201f', fg: '#ffb020', val: kpis.pendingIntents, lbl: 'Pending payment intents' },
  ];
  return (
    <section className="sec on">
      <div className="kpis" style={{ marginBottom: 16 }}>
        {KPIS.map((k) => {
          const Icon = k.icon;
          return (
            <div className="kpi" key={k.lbl}>
              <div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div>
              <div className="kpi-val">{k.val}</div>
              <div className="kpi-lbl">{k.lbl}</div>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <div className="panel-title">Channel health</div>
        <div className="panel-desc">Server-side configuration this integration needs — set these as environment variables, not here.</div>
        {ENV_ITEMS.map((it) => {
          const live = env[it.key];
          return (
            <div className="integ" key={it.key}>
              <div className="ig" style={{ background: 'var(--gf-elevated)', color: 'var(--gf-text-secondary)' }}><KeyRound strokeWidth={1.75} /></div>
              <div className="m"><strong>{it.label}</strong><small>{it.hint}</small></div>
              <span className={`gf-badge ${live ? 'gf-badge-success' : 'gf-badge-neutral'}`}><span className="gf-dot" />{live ? 'Live' : 'Not set'}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Members ──────────────────────────────────────────────────────────────────
function MembersTab({ contacts, selectedId, onSelect }: { contacts: ContactRow[]; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const selected = contacts.find((c) => c.id === selectedId) ?? null;
  return (
    <section className="sec on">
      <div className="panel">
        <div className="panel-title">Conversations</div>
        <div className="panel-desc">Everyone who has messaged this gym on WhatsApp — {contacts.length} contact{contacts.length === 1 ? '' : 's'}.</div>
        {contacts.length === 0 ? (
          <div className="empty sm"><h3>No conversations yet</h3><p>Contacts appear here once a member messages your WhatsApp number.</p></div>
        ) : (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>Name</th><th>Phone</th><th>Linked account</th><th>Opted in</th><th>Last message</th><th />
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => {
                  const name = c.profileName || c.displayName || formatWaId(c.waId);
                  const isSelected = c.id === selectedId;
                  return (
                    <tr key={c.id} style={isSelected ? { background: 'var(--gf-elevated)' } : undefined}>
                      <td>{name}</td>
                      <td>{formatWaId(c.waId)}</td>
                      <td><span className={`gf-badge ${c.linked ? 'gf-badge-success' : 'gf-badge-neutral'}`}>{c.linked ? 'Yes' : 'No'}</span></td>
                      <td><span className={`gf-badge ${c.optedIn ? 'gf-badge-success' : 'gf-badge-neutral'}`}>{c.optedIn ? 'Yes' : 'No'}</span></td>
                      <td>{fmtDateTime(c.lastMessageAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="gf-btn gf-btn-secondary gf-btn-sm"
                          onClick={() => onSelect(isSelected ? null : c.id)}
                        >
                          {isSelected ? 'Hide chat' : 'View chat'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <ContactChat
          key={selected.id}
          contactId={selected.id}
          label={selected.profileName || selected.displayName || formatWaId(selected.waId)}
        />
      )}
    </section>
  );
}

// Owns its own message list + reply form, keyed by contactId in the parent so
// switching contacts remounts it fresh — a stale transcript or a leftover
// "24-hour window closed" error from the PREVIOUS conversation never bleeds
// into the next one.
function ContactChat({ contactId, label }: { contactId: string; label: string }) {
  const [messages, setMessages] = useState<WhatsAppMessageRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [replyState, replyAction, replyPending] = useActionState(replyToContact, INIT);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  // contactId is only ever the one this instance was mounted with — the
  // parent remounts ContactChat (via `key={selected.id}`) on every switch —
  // so this fetch runs exactly once per conversation and messages/loadError
  // are already at their fresh initial values with nothing to reset first.
  useEffect(() => {
    let live = true;
    loadContactMessages(contactId).then((res) => {
      if (!live) return;
      if (res.ok) setMessages(res.messages); else setLoadError(res.error);
    });
    return () => { live = false; };
  }, [contactId]);

  // A submit just finished successfully — pull the transcript again so the
  // staff reply that was just sent shows up, and clear the textarea.
  useEffect(() => {
    if (wasPending.current && !replyPending && replyState.ok) {
      loadContactMessages(contactId).then((res) => { if (res.ok) setMessages(res.messages); });
      formRef.current?.reset();
    }
    wasPending.current = replyPending;
  }, [replyPending, replyState, contactId]);

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-title">{label}</div>
      <div className="panel-desc">Last 50 messages.</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto', padding: '4px 2px', marginBottom: 14 }}>
        {messages === null && !loadError && <div style={{ color: 'var(--gf-text-muted)', fontSize: '0.85rem' }}>Loading…</div>}
        {loadError && <div style={{ color: 'var(--gf-danger)', fontSize: '0.85rem' }}>{loadError}</div>}
        {messages && messages.length === 0 && <div style={{ color: 'var(--gf-text-muted)', fontSize: '0.85rem' }}>No messages yet.</div>}
        {messages?.map((m) => {
          const inbound = m.direction === 'inbound';
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: inbound ? 'flex-start' : 'flex-end' }}>
              <div style={{
                maxWidth: '72%', padding: '8px 12px', borderRadius: 14,
                background: inbound ? 'var(--gf-elevated)' : 'var(--gf-brand-soft)',
                border: '1px solid var(--gf-border)',
              }}>
                <div style={{ fontSize: '0.92rem', whiteSpace: 'pre-wrap', color: 'var(--gf-text)' }}>
                  {m.body || <em style={{ color: 'var(--gf-text-muted)' }}>[{m.kind}]</em>}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--gf-text-muted)', marginTop: 4, textAlign: inbound ? 'left' : 'right' }}>
                  {fmtDateTime(m.created_at)}{m.authored_by ? ` · ${m.authored_by}` : ''}{m.status === 'failed' ? ' · failed' : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <form ref={formRef} action={replyAction}>
        <input type="hidden" name="contact_id" value={contactId} />
        <div className="gf-form-group">
          <textarea className="gf-input" name="body" rows={2} placeholder="Type a reply…" required style={{ resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="gf-btn gf-btn-primary gf-btn-sm" type="submit" disabled={replyPending}>
            <Send size={14} strokeWidth={2} /> {replyPending ? 'Sending…' : 'Send'}
          </button>
          {replyState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.82rem', fontWeight: 600 }}>Sent ✓</span>}
          {replyState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.82rem', fontWeight: 600 }}>{replyState.error}</span>}
        </div>
      </form>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────
function SettingsTab({ gymPhone, initial }: { gymPhone: string | null; initial: WhatsAppSettingsData }) {
  const [state, action, pending] = useActionState(saveWhatsAppSettings, INIT);
  return (
    <section className="sec on">
      <form className="panel" action={action}>
        <div className="panel-title">WhatsApp channel</div>
        <div className="panel-desc">Controls for the shared GymFlow WhatsApp number as it behaves for this gym.</div>

        <label className="set-row" style={{ cursor: 'pointer' }}>
          <div className="m"><strong>Channel enabled</strong><small>Turn off to stop this gym&apos;s members reaching you on WhatsApp entirely.</small></div>
          <input type="checkbox" name="enabled" defaultChecked={initial.enabled} style={{ width: 20, height: 20, accentColor: 'var(--gf-brand)', cursor: 'pointer', flexShrink: 0 }} />
        </label>

        <div className="gf-form-group" style={{ marginTop: 14 }}>
          <label className="gf-form-label">Customer service number</label>
          <input className="gf-input" name="support_phone" defaultValue={initial.supportPhone ?? ''} placeholder={gymPhone ?? '0803 123 4567'} />
          <small className="gf-form-hint" style={{ display: 'block', marginTop: 6, color: 'var(--gf-text-muted)' }}>
            Shown to your members when they ask for help. Defaults to your gym phone number.
          </small>
        </div>

        <div className="gf-form-group">
          <label className="gf-form-label">App home link (optional)</label>
          <input className="gf-input" name="app_home_url" type="url" defaultValue={initial.appHomeUrl ?? ''} placeholder="https://" />
          <small className="gf-form-hint" style={{ display: 'block', marginTop: 6, color: 'var(--gf-text-muted)' }}>
            Overrides the menu&apos;s default link to your gym&apos;s page — use a store listing or a branded deep link if you have one.
          </small>
        </div>

        <div className="gf-form-group">
          <label className="gf-form-label">Welcome message (optional)</label>
          <textarea className="gf-input" name="welcome_message" rows={3} defaultValue={initial.welcomeMessage ?? ''} placeholder="Sent the first time a member messages you." style={{ resize: 'vertical' }} />
        </div>

        <label className="set-row" style={{ cursor: 'pointer' }}>
          <div className="m"><strong>QR check-in over WhatsApp</strong><small>Members may check in by sending the code behind the door QR.</small></div>
          <input type="checkbox" name="qr_checkin_enabled" defaultChecked={initial.qrCheckinEnabled} style={{ width: 20, height: 20, accentColor: 'var(--gf-brand)', cursor: 'pointer', flexShrink: 0 }} />
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <button className="gf-btn gf-btn-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</button>
          {state.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Saved ✓</span>}
          {state.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{state.error}</span>}
        </div>
      </form>
    </section>
  );
}

// ── AI assistant ─────────────────────────────────────────────────────────────
function AiTab({ initial, providers, hasGymKey, secretsReady }: {
  initial: AiSettingsData; providers: AiProviderRow[]; hasGymKey: boolean; secretsReady: boolean;
}) {
  const [state, action, pending] = useActionState(saveAiSettings, INIT);
  const [clearState, clearAction, clearPending] = useActionState(clearAiKey, INIT);

  const initialProviderSlug = initial.providerSlug ?? providers[0]?.slug ?? '';
  const initialProvider = providers.find((p) => p.slug === initialProviderSlug) ?? null;
  const initialModelInList = !!(initial.model && initialProvider?.models.includes(initial.model));

  const [providerSlug, setProviderSlug] = useState(initialProviderSlug);
  const [modelValue, setModelValue] = useState(
    initialModelInList ? (initial.model as string) : (initialProvider?.defaultModel ?? initialProvider?.models[0] ?? ''),
  );
  // Pre-fills when the stored model isn't one of the provider's known ids
  // (an older or newer model than our catalogue) — the override still wins.
  const [modelCustom, setModelCustom] = useState(!initialModelInList ? (initial.model ?? '') : '');

  const selectedProvider = providers.find((p) => p.slug === providerSlug) ?? null;

  function onProviderChange(slug: string) {
    setProviderSlug(slug);
    const p = providers.find((x) => x.slug === slug);
    const opts = p?.models ?? [];
    setModelValue(p?.defaultModel && opts.includes(p.defaultModel) ? p.defaultModel : (opts[0] ?? ''));
    setModelCustom('');
  }

  const usagePct = initial.monthlyTokenCap > 0 ? Math.min(100, Math.round((initial.tokensUsedThisMonth / initial.monthlyTokenCap) * 100)) : 0;

  return (
    <section className="sec on">
      <form className="panel" action={action}>
        <div className="panel-title">AI assistant</div>
        <div className="panel-desc">Lets the assistant answer free text on WhatsApp instead of only the numbered menu. Safety rules always apply on top of anything set here.</div>

        <label className="set-row" style={{ cursor: 'pointer' }}>
          <div className="m"><strong>Assistant enabled</strong><small>Off keeps the deterministic numbered menu only — the safe default.</small></div>
          <input type="checkbox" name="enabled" defaultChecked={initial.enabled} style={{ width: 20, height: 20, accentColor: 'var(--gf-brand)', cursor: 'pointer', flexShrink: 0 }} />
        </label>

        <div className="frow" style={{ marginTop: 14 }}>
          <div className="gf-form-group">
            <label className="gf-form-label">Provider</label>
            <select className="gf-select" name="provider_slug" value={providerSlug} onChange={(e) => onProviderChange(e.target.value)}>
              {providers.length === 0 && <option value="">No providers configured</option>}
              {providers.map((p) => {
                const usable = providerUsable(p.slug);
                return <option key={p.slug} value={p.slug} disabled={!usable}>{p.name}{usable ? '' : ' (needs configuration)'}</option>;
              })}
            </select>
            {selectedProvider && !providerUsable(selectedProvider.slug) && (
              <small className="gf-form-hint" style={{ display: 'block', marginTop: 6, color: 'var(--gf-warning, #ffb020)' }}>
                {dialectFor(selectedProvider.slug).unsupportedReason}
              </small>
            )}
          </div>
          <div className="gf-form-group">
            <label className="gf-form-label">Model</label>
            <select className="gf-select" name="model" value={modelValue} onChange={(e) => setModelValue(e.target.value)} disabled={!(selectedProvider?.models.length)}>
              {(selectedProvider?.models ?? []).length === 0 && <option value="">No known models — use the override below</option>}
              {(selectedProvider?.models ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className="gf-form-group">
          <label className="gf-form-label">Or use a specific model id</label>
          <input className="gf-input" name="model_custom" value={modelCustom} onChange={(e) => setModelCustom(e.target.value)} placeholder="Overrides the dropdown above when set" />
        </div>

        <div className="gf-form-group">
          <label className="gf-form-label">Provider API key</label>
          <input
            className="gf-input" type="password" name="api_key" autoComplete="new-password"
            disabled={!secretsReady}
            placeholder={!secretsReady ? 'Server not configured to store keys' : hasGymKey ? 'A key is installed — leave blank to keep it' : "Using GymFlow's key — paste one to use your own"}
          />
          <small className="gf-form-hint" style={{ display: 'block', marginTop: 6, color: 'var(--gf-text-muted)' }}>
            {!secretsReady
              ? 'Set SECRETS_ENCRYPTION_KEY on the server before storing provider keys.'
              : hasGymKey
                ? 'A key is installed. Never shown again once saved — paste a new one to replace it.'
                : "Using GymFlow's key. Paste your own vendor key to use it instead."}
          </small>
        </div>

        <div className="gf-form-group">
          <label className="gf-form-label">Extra instructions for your gym (optional)</label>
          <textarea className="gf-input" name="system_prompt" rows={4} defaultValue={initial.systemPrompt ?? ''} placeholder="Opening times, house rules, tone…" style={{ resize: 'vertical' }} />
          <small className="gf-form-hint" style={{ display: 'block', marginTop: 6, color: 'var(--gf-text-muted)' }}>
            Extra instructions about your gym — opening times, rules, tone. Safety rules always apply on top.
          </small>
        </div>

        <div className="frow">
          <div className="gf-form-group">
            <label className="gf-form-label">Temperature</label>
            <input className="gf-input" type="number" name="temperature" step="0.1" min="0" max="2" defaultValue={initial.temperature} />
          </div>
          <div className="gf-form-group">
            <label className="gf-form-label">Max tokens per reply</label>
            <input className="gf-input" type="number" name="max_tokens" step="1" min="100" max="4000" defaultValue={initial.maxTokens} />
          </div>
        </div>

        <div className="gf-form-group">
          <label className="gf-form-label">Monthly token cap</label>
          <input className="gf-input" type="number" name="monthly_token_cap" step="1" min="0" defaultValue={initial.monthlyTokenCap} />
          <small className="gf-form-hint" style={{ display: 'block', marginTop: 6, color: 'var(--gf-text-muted)' }}>
            {initial.tokensUsedThisMonth.toLocaleString()} / {initial.monthlyTokenCap.toLocaleString()} tokens used this month ({usagePct}%). The assistant falls back to the numbered menu once the cap is reached.
          </small>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
          <button className="gf-btn gf-btn-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</button>
          {state.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Saved ✓</span>}
          {state.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{state.error}</span>}
        </div>
      </form>

      {secretsReady && hasGymKey && (
        <form className="panel" action={clearAction} style={{ marginTop: 16 }}>
          <div className="panel-title">Remove gym key</div>
          <div className="panel-desc">Falls back to GymFlow&apos;s own key for this provider.</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" className="gf-btn gf-btn-secondary" disabled={clearPending}>{clearPending ? 'Removing…' : 'Remove key'}</button>
            {clearState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Removed ✓</span>}
            {clearState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{clearState.error}</span>}
          </div>
        </form>
      )}
    </section>
  );
}
