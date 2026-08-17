'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, Bot, QrCode, Power, Users, AlertTriangle } from 'lucide-react';
import { setGymChannelFlag, type ChannelState } from '@/lib/actions/platform-whatsapp';
import { formatWaId } from '@/lib/whatsapp/phone';
import { ROOT_DOMAIN } from '@/lib/tenant';

const INIT: ChannelState = { ok: false, error: null };

// The server env this channel runs on, and what each piece is for. The booleans
// come from the server page — process.env doesn't exist here.
const ENV_ITEMS = [
  { key: 'WHATSAPP_ACCESS_TOKEN', label: 'Access token', hint: 'Authenticates every outbound send to Meta’s Cloud API.' },
  { key: 'WHATSAPP_PHONE_NUMBER_ID', label: 'Phone number ID', hint: 'The Meta business number all gyms send from.' },
  { key: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', label: 'Webhook verify token', hint: 'Completes Meta’s webhook subscription handshake.' },
  { key: 'META_APP_SECRET', label: 'App secret', hint: 'Verifies inbound webhook calls really came from Meta.' },
  { key: 'WHATSAPP_FLOW_ID', label: 'Flow ID', hint: 'The sign-up / sign-in Flow rendered inside WhatsApp.' },
  { key: 'WHATSAPP_FLOW_PRIVATE_KEY', label: 'Flow private key', hint: 'Decrypts each Flow screen’s data exchange.' },
  { key: 'SECRETS_ENCRYPTION_KEY', label: 'Secrets encryption key', hint: 'Encrypts stored AI provider keys at rest.' },
] as const;

export type EnvStatus = Record<(typeof ENV_ITEMS)[number]['key'], boolean>;

export type GymChannelRow = {
  id: string;
  name: string;
  slug: string;
  status: string | null;
  /** False = no gym_whatsapp_settings row; the gym runs on defaults. */
  configured: boolean;
  enabled: boolean;
  aiEnabled: boolean;
  qrCheckinEnabled: boolean;
  supportPhone: string | null;
  contacts: number;
  linkedContacts: number;
  messages7d: number;
  pendingIntents: number;
};

export function WhatsAppConsole({ gyms, env, businessNumber, totals }: {
  gyms: GymChannelRow[];
  env: EnvStatus;
  businessNumber: string | null;
  totals: { messagesAllTime: number; inbound7d: number };
}) {
  const [onlyLive, setOnlyLive] = useState(false);

  const missing = ENV_ITEMS.filter((i) => !env[i.key]);
  const liveGyms = gyms.filter((g) => g.enabled).length;
  const aiGyms = gyms.filter((g) => g.aiEnabled).length;
  const contacts = gyms.reduce((n, g) => n + g.contacts, 0);
  const linked = gyms.reduce((n, g) => n + g.linkedContacts, 0);
  const shown = onlyLive ? gyms.filter((g) => g.enabled) : gyms;

  return (
    <>
      <div className="hdr">
        <div>
          <span className="pill-plat">Platform</span>
          <h1>WhatsApp channel</h1>
          <p>
            One business number{businessNumber ? ` (${formatWaId(businessNumber)})` : ''} fronting every gym
          </p>
        </div>
      </div>

      {missing.length > 0 && (
        <div className="panel" style={{ borderColor: 'var(--gf-warning)', marginBottom: 16 }}>
          <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} strokeWidth={2} /> {missing.length} setting{missing.length === 1 ? '' : 's'} missing
          </div>
          <div className="panel-desc" style={{ marginBottom: 0 }}>
            The channel is degraded platform-wide until these are set in the deployment environment:{' '}
            {missing.map((m) => m.label).join(', ')}.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Kpi label="Gyms live" value={`${liveGyms}/${gyms.length}`} sub="Members can reach them here" />
        <Kpi label="Assistant on" value={String(aiGyms)} sub="Answering free text, not just the menu" />
        <Kpi label="Contacts" value={String(contacts)} sub={`${linked} linked to an account`} />
        <Kpi label="Messages" value={String(totals.messagesAllTime)} sub={`${totals.inbound7d} inbound in 7 days`} />
      </div>

      <div className="two" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, alignItems: 'start' }}>
        <div className="panel">
          <div className="panel-title">Rollout</div>
          <div className="panel-desc">
            Per-gym switches on the shared number. A gym with no settings of its own runs on the defaults shown here —
            channel on, assistant off — and its owner can change the rest from their own WhatsApp tab.
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: '0.82rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyLive} onChange={(e) => setOnlyLive(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--gf-brand)' }} />
            Only gyms that are live
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {shown.map((g) => <GymRow key={g.id} g={g} />)}
            {shown.length === 0 && <div style={{ color: 'var(--gf-text-muted)', fontSize: '0.85rem' }}>No gyms match.</div>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Channel health</div>
          <div className="panel-desc">Server configuration this channel depends on.</div>
          {ENV_ITEMS.map((it) => (
            <div className="integ" key={it.key}>
              <div className="m"><strong>{it.label}</strong><small>{it.hint}</small></div>
              <span className={`gf-badge ${env[it.key] ? 'gf-badge-success' : 'gf-badge-warning'}`}>
                <span className="gf-dot" />{env[it.key] ? 'Set' : 'Missing'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="panel" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gf-text-muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: 'var(--gf-font-display)', fontWeight: 800, fontSize: '1.6rem', lineHeight: 1.15 }}>{value}</div>
      <div style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted)' }}>{sub}</div>
    </div>
  );
}

function GymRow({ g }: { g: GymChannelRow }) {
  const [state, action, pending] = useActionState(setGymChannelFlag, INIT);

  const flag = (name: 'enabled' | 'ai_enabled' | 'qr_checkin_enabled', on: boolean, label: string, Icon: typeof Power) => (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="gym_id" value={g.id} />
      <input type="hidden" name="flag" value={name} />
      <input type="hidden" name="value" value={on ? 'false' : 'true'} />
      <button
        className={`gf-btn gf-btn-sm${on ? ' gf-btn-primary' : ''}`}
        type="submit"
        disabled={pending}
        title={`${on ? 'Turn off' : 'Turn on'} ${label} for ${g.name}`}
      >
        <Icon size={13} strokeWidth={2} /> {label}
      </button>
    </form>
  );

  return (
    <div style={{ border: '1px solid var(--gf-border)', borderRadius: 'var(--gf-radius-sm)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 150, flex: 1 }}>
          <div style={{ fontFamily: 'var(--gf-font-display)', fontWeight: 700, fontSize: '0.92rem' }}>
            {g.name}{' '}
            {!g.configured && <span style={{ fontSize: '0.68rem', color: 'var(--gf-text-muted)', fontWeight: 500 }}>(defaults)</span>}
          </div>
          <div style={{ fontSize: '0.73rem', color: 'var(--gf-text-muted)' }}>
            {g.slug} · {g.contacts} contact{g.contacts === 1 ? '' : 's'} ({g.linkedContacts} linked) · {g.messages7d} msg/7d
            {g.pendingIntents > 0 && ` · ${g.pendingIntents} payment pending`}
          </div>
        </div>
        {flag('enabled', g.enabled, 'Channel', Power)}
        {flag('ai_enabled', g.aiEnabled, 'Assistant', Bot)}
        {flag('qr_checkin_enabled', g.qrCheckinEnabled, 'QR check-in', QrCode)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, fontSize: '0.73rem', color: 'var(--gf-text-muted)', flexWrap: 'wrap' }}>
        <span><MessageCircle size={12} strokeWidth={2} style={{ verticalAlign: '-2px' }} /> Support line: {g.supportPhone ? formatWaId(g.supportPhone) : 'not set — members get no number'}</span>
        <Link href={`https://${g.slug}.${ROOT_DOMAIN}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gf-brand)' }}>
          <Users size={12} strokeWidth={2} style={{ verticalAlign: '-2px' }} /> Member site
        </Link>
        {state.ok && <span style={{ color: 'var(--gf-success)', fontWeight: 600 }}>{state.message}</span>}
        {state.error && <span style={{ color: 'var(--gf-danger)', fontWeight: 600 }}>{state.error}</span>}
      </div>
    </div>
  );
}
