'use client';

import { useActionState, useState } from 'react';
import { Bot, KeyRound, ExternalLink, Power, Trash2, AlertTriangle } from 'lucide-react';
import {
  setProviderEnabled, setProviderConfig, clearProviderKey, type SettingsState,
} from '@/lib/actions/platform-settings';
import { dialectFor, providerUsable } from '@/lib/ai/dialects';
import { fmtDateTime } from '@/lib/format';

const INIT: SettingsState = { ok: false, error: null };

export type ProviderCard = {
  slug: string;
  name: string;
  baseUrl: string | null;
  defaultModel: string | null;
  models: string[];
  enabled: boolean;
  docsUrl: string | null;
  /** Whether a platform key is stored — never the key itself. */
  hasKey: boolean;
  updatedAt: string | null;
  gymsUsing: number;
  gymsLive: number;
};

type Filter = 'all' | 'enabled' | 'keyed' | 'unsupported';

export function AiConsole({ providers, secretsReady }: { providers: ProviderCard[]; secretsReady: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);

  const enabledCount = providers.filter((p) => p.enabled).length;
  const keyedCount = providers.filter((p) => p.hasKey).length;
  const usableCount = providers.filter((p) => providerUsable(p.slug)).length;

  const shown = providers.filter((p) => {
    if (filter === 'enabled') return p.enabled;
    if (filter === 'keyed') return p.hasKey;
    if (filter === 'unsupported') return !providerUsable(p.slug);
    return true;
  });

  return (
    <>
      <div className="hdr">
        <div>
          <span className="pill-plat">Platform</span>
          <h1>AI providers</h1>
          <p>The vendor catalogue every gym&apos;s WhatsApp assistant picks from</p>
        </div>
      </div>

      {!secretsReady && (
        <div className="panel" style={{ borderColor: 'var(--gf-warning)', marginBottom: 16 }}>
          <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} strokeWidth={2} /> Secrets encryption isn&apos;t configured
          </div>
          <div className="panel-desc" style={{ marginBottom: 0 }}>
            SECRETS_ENCRYPTION_KEY is missing or isn&apos;t 32 bytes, so no API key can be stored safely. Providers can
            still be enabled — gyms would have to supply their own keys, which also cannot be stored until this is set.
          </div>
        </div>
      )}

      <div className="kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Kpi label="Providers" value={String(providers.length)} sub={`${usableCount} usable with a key`} />
        <Kpi label="Enabled" value={String(enabledCount)} sub="Selectable by gyms" />
        <Kpi label="Platform keys" value={String(keyedCount)} sub="GymFlow pays the vendor" />
        <Kpi label="Gyms configured" value={String(providers.reduce((n, p) => n + p.gymsUsing, 0))} sub={`${providers.reduce((n, p) => n + p.gymsLive, 0)} with the assistant on`} />
      </div>

      <nav className="seg" style={{ marginBottom: 14 }}>
        {([['all', 'All'], ['enabled', 'Enabled'], ['keyed', 'With platform key'], ['unsupported', 'Needs more than a key']] as [Filter, string][]).map(([id, label]) => (
          <button type="button" key={id} className={filter === id ? 'on' : undefined} onClick={() => setFilter(id)} aria-current={filter === id ? 'true' : undefined}>
            {label}
          </button>
        ))}
      </nav>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {shown.map((p) => (
          <ProviderRow
            key={p.slug}
            p={p}
            secretsReady={secretsReady}
            open={open === p.slug}
            onToggleOpen={() => setOpen(open === p.slug ? null : p.slug)}
          />
        ))}
        {shown.length === 0 && <div className="panel" style={{ color: 'var(--gf-text-muted)' }}>Nothing matches that filter.</div>}
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

function ProviderRow({ p, secretsReady, open, onToggleOpen }: {
  p: ProviderCard; secretsReady: boolean; open: boolean; onToggleOpen: () => void;
}) {
  const [toggleState, toggleAction, togglePending] = useActionState(setProviderEnabled, INIT);
  const [saveState, saveAction, savePending] = useActionState(setProviderConfig, INIT);
  const [clearState, clearAction, clearPending] = useActionState(clearProviderKey, INIT);

  const spec = dialectFor(p.slug);
  const usable = spec.dialect !== 'unsupported';
  // Ollama is self-hosted and normally has no key at all, so "no key" is not a
  // warning for it the way it is for a hosted vendor.
  const keyOptional = spec.auth === 'none';

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', flexWrap: 'wrap' }}>
        <div className="ig" style={{ background: p.enabled ? 'var(--gf-success-soft)' : 'var(--gf-elevated)', color: p.enabled ? 'var(--gf-success)' : 'var(--gf-text-muted)', width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Bot size={19} strokeWidth={1.75} />
        </div>
        <div style={{ minWidth: 160, flex: 1 }}>
          <div style={{ fontFamily: 'var(--gf-font-display)', fontWeight: 700, fontSize: '0.95rem' }}>{p.name}</div>
          <div style={{ fontSize: '0.74rem', color: 'var(--gf-text-muted)' }}>
            {p.slug} · {p.defaultModel ?? 'no default model'}
            {p.gymsUsing > 0 && ` · ${p.gymsUsing} gym${p.gymsUsing === 1 ? '' : 's'}`}
          </div>
        </div>

        <span className={`gf-badge ${p.enabled ? 'gf-badge-success' : 'gf-badge-neutral'}`}><span className="gf-dot" />{p.enabled ? 'Enabled' : 'Off'}</span>
        {!usable && <span className="gf-badge gf-badge-warning">Needs configuration</span>}
        {usable && (
          <span className={`gf-badge ${p.hasKey ? 'gf-badge-success' : keyOptional ? 'gf-badge-neutral' : 'gf-badge-warning'}`}>
            <KeyRound size={11} strokeWidth={2} />{p.hasKey ? 'Platform key' : keyOptional ? 'No key needed' : 'No key'}
          </span>
        )}

        <form action={toggleAction} style={{ display: 'inline' }}>
          <input type="hidden" name="slug" value={p.slug} />
          <input type="hidden" name="enabled" value={p.enabled ? 'false' : 'true'} />
          <button className={`gf-btn gf-btn-sm ${p.enabled ? '' : 'gf-btn-primary'}`} type="submit" disabled={togglePending || (!usable && !p.enabled)}>
            <Power size={13} strokeWidth={2} /> {togglePending ? '…' : p.enabled ? 'Disable' : 'Enable'}
          </button>
        </form>
        <button className="gf-btn gf-btn-sm" type="button" onClick={onToggleOpen} aria-expanded={open}>
          {open ? 'Close' : 'Configure'}
        </button>
      </div>

      {toggleState.error && <Note tone="danger">{toggleState.error}</Note>}
      {toggleState.ok && <Note tone="success">{toggleState.message}</Note>}

      {open && (
        <div style={{ borderTop: '1px solid var(--gf-border)', padding: '14px 16px', background: 'var(--gf-elevated)' }}>
          {!usable && (
            <div style={{ fontSize: '0.82rem', color: 'var(--gf-warning)', marginBottom: 12 }}>
              {spec.unsupportedReason}
            </div>
          )}

          <form action={saveAction}>
            <input type="hidden" name="slug" value={p.slug} />
            <div className="frow">
              <div className="gf-form-group">
                <label className="gf-form-label">Default model</label>
                <input className="gf-input" name="default_model" defaultValue={p.defaultModel ?? ''} placeholder={p.models[0] ?? 'model id'} list={`models-${p.slug}`} />
                <datalist id={`models-${p.slug}`}>
                  {p.models.map((m) => <option key={m} value={m} />)}
                </datalist>
              </div>
              <div className="gf-form-group">
                <label className="gf-form-label">Base URL</label>
                <input className="gf-input" name="base_url" defaultValue={p.baseUrl ?? ''} placeholder="https://api.vendor.com/v1" />
              </div>
            </div>

            <div className="gf-form-group">
              <label className="gf-form-label">Platform API key</label>
              <input className="gf-input" name="api_key" type="password" autoComplete="off" placeholder={p.hasKey ? '•••••••• stored — leave blank to keep it' : keyOptional ? 'Not required for this provider' : 'Paste the vendor key'} />
              <small className="gf-form-hint" style={{ display: 'block', marginTop: 6, color: 'var(--gf-text-muted)' }}>
                Encrypted at rest and never shown again. A gym that sets its own key uses that instead, and is billed by
                its own vendor account.
              </small>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button className="gf-btn gf-btn-primary gf-btn-sm" type="submit" disabled={savePending || !secretsReady}>
                {savePending ? 'Saving…' : 'Save'}
              </button>
              {p.docsUrl && (
                <a className="gf-btn gf-btn-sm" href={p.docsUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={13} strokeWidth={2} /> Vendor docs
                </a>
              )}
              {p.updatedAt && <span style={{ fontSize: '0.72rem', color: 'var(--gf-text-muted)' }}>Updated {fmtDateTime(p.updatedAt)}</span>}
              {saveState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.82rem', fontWeight: 600 }}>{saveState.message ?? 'Saved ✓'}</span>}
              {saveState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.82rem', fontWeight: 600 }}>{saveState.error}</span>}
            </div>
          </form>

          {p.hasKey && (
            <form action={clearAction} style={{ marginTop: 12, borderTop: '1px dashed var(--gf-border)', paddingTop: 12 }}>
              <input type="hidden" name="slug" value={p.slug} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button className="gf-btn gf-btn-sm gf-btn-danger" type="submit" disabled={clearPending}>
                  <Trash2 size={13} strokeWidth={2} /> {clearPending ? 'Removing…' : 'Remove platform key'}
                </button>
                <span style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted)' }}>
                  {p.gymsLive > 0
                    ? `${p.gymsLive} gym${p.gymsLive === 1 ? '' : 's'} answering on this provider — any without their own key stop replying.`
                    : 'No gym is answering on this provider right now.'}
                </span>
                {clearState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.82rem', fontWeight: 600 }}>{clearState.message}</span>}
                {clearState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.82rem', fontWeight: 600 }}>{clearState.error}</span>}
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function Note({ tone, children }: { tone: 'danger' | 'success'; children: React.ReactNode }) {
  return (
    <div style={{
      padding: '8px 16px', fontSize: '0.8rem', fontWeight: 600,
      color: tone === 'danger' ? 'var(--gf-danger)' : 'var(--gf-success)',
      borderTop: '1px solid var(--gf-border)',
    }}>
      {children}
    </div>
  );
}
