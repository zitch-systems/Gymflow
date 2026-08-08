'use client';

import { useActionState, useState, useTransition } from 'react';
import { DatabaseBackup, Download, Check, AlertCircle } from 'lucide-react';
import { saveBackupSettings, runBackupNow, backupDownloadUrl, type BackupState } from '@/lib/actions/backup';

const INIT: BackupState = { ok: false, error: null };

export type BackupRow = {
  id: string;
  created_at: string;
  size_bytes: number | null;
  status: string;
  trigger: string;
  error: string | null;
  rows: number;
};

const FREQUENCIES: [string, string, string][] = [
  ['off', 'Off', 'No automatic backups'],
  ['daily', 'Daily', 'Every day, overnight'],
  ['weekly', 'Weekly', 'Once a week'],
  ['monthly', 'Monthly', 'Once a month'],
];

function size(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Settings → Backups.
 *
 * Two things on one screen because they answer the same question: the schedule
 * is a promise about the future, and the list is the evidence it has been kept.
 * A schedule with nothing under it is how gyms discover a year later that
 * backups stopped in March.
 */
export function BackupSettings({
  frequency, emailOn, lastRunAt, backups,
}: { frequency: string; emailOn: boolean; lastRunAt: string | null; backups: BackupRow[] }) {
  const [saveState, saveAction, savePending] = useActionState(saveBackupSettings, INIT);
  const [runState, runAction, runPending] = useActionState(runBackupNow, INIT);
  const [freq, setFreq] = useState(frequency || 'off');
  const [dlError, setDlError] = useState<string | null>(null);
  const [dlPending, startDl] = useTransition();

  // The signed URL is minted on demand rather than rendered into the page: a
  // link in the HTML would still work after the reader closed the tab, and
  // these point at a full member export.
  function download(id: string) {
    setDlError(null);
    startDl(async () => {
      const res = await backupDownloadUrl(id);
      if (res.ok) window.location.href = res.url;
      else setDlError(res.error);
    });
  }

  return (
    <section className="sec on">
      <form className="panel" action={saveAction}>
        <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <DatabaseBackup size={17} strokeWidth={1.9} /> Backups
        </div>
        <div className="panel-desc">
          A copy of your members, subscriptions, payments, check-ins and classes — one spreadsheet
          per table, in a zip. Kept here for you to download, and emailed to you if you want it.
        </div>

        <div className="bk-freq" role="radiogroup" aria-label="Backup schedule">
          {FREQUENCIES.map(([value, label, hint]) => (
            <label key={value} className={`bk-opt${freq === value ? ' on' : ''}`}>
              <input
                type="radio" name="backup_frequency" value={value}
                checked={freq === value} onChange={() => setFreq(value)}
              />
              <span className="bk-opt-tx"><strong>{label}</strong><small>{hint}</small></span>
            </label>
          ))}
        </div>

        <label className="set-row" style={{ cursor: 'pointer', marginTop: 4 }}>
          <div className="m">
            <strong>Email the backup to me</strong>
            <small>Sent to the gym owner&rsquo;s address each time one runs. A copy is always kept here either way.</small>
          </div>
          <input
            type="checkbox" name="backup_email" defaultChecked={emailOn}
            style={{ width: 20, height: 20, accentColor: 'var(--gf-brand)', cursor: 'pointer', flexShrink: 0 }}
          />
        </label>

        <div className="panel-desc" style={{ marginTop: 2 }}>
          Card details and bank account numbers are deliberately left out of the file.
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          <button className="gf-btn gf-btn-primary" type="submit" disabled={savePending}>
            {savePending ? 'Saving…' : 'Save changes'}
          </button>
          {saveState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>{saveState.message ?? 'Saved ✓'}</span>}
          {saveState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{saveState.error}</span>}
        </div>
      </form>

      <div className="panel">
        <div className="panel-title">Recent backups</div>
        <div className="panel-desc">
          {lastRunAt
            ? <>Last backup {when(lastRunAt)}.</>
            : <>No backup has run yet. Take one now to see what the file contains.</>}
        </div>

        <form action={runAction} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '12px 0 4px' }}>
          <button className="gf-btn gf-btn-secondary gf-btn-sm" type="submit" disabled={runPending}>
            <DatabaseBackup size={15} strokeWidth={1.9} /> {runPending ? 'Backing up…' : 'Back up now'}
          </button>
          {runState.ok && <span className="act-fb ok" style={{ margin: 0 }}><Check size={15} strokeWidth={2.5} /> {runState.message}</span>}
          {runState.error && <span className="act-fb err" style={{ margin: 0 }}><AlertCircle size={15} strokeWidth={2} /> {runState.error}</span>}
        </form>

        {dlError && <p className="act-fb err"><AlertCircle size={15} strokeWidth={2} /> {dlError}</p>}

        {backups.length === 0 ? (
          <p className="panel-desc" style={{ marginTop: 12 }}>Nothing stored yet.</p>
        ) : (
          <ul className="bk-list">
            {backups.map((b) => (
              <li key={b.id} className={b.status === 'failed' ? 'failed' : undefined}>
                <span className="bk-when">
                  <strong>{when(b.created_at)}</strong>
                  <small>
                    {b.status === 'failed'
                      ? (b.error ?? 'Failed')
                      : `${size(b.size_bytes)}${b.rows ? ` · ${b.rows.toLocaleString('en-NG')} records` : ''}${b.trigger === 'manual' ? ' · manual' : ''}`}
                  </small>
                </span>
                {b.status === 'failed'
                  ? <span className="gf-badge gf-badge-danger">Failed</span>
                  : (
                    <button type="button" className="gf-btn gf-btn-ghost gf-btn-sm" onClick={() => download(b.id)} disabled={dlPending}>
                      <Download size={15} strokeWidth={1.9} /> Download
                    </button>
                  )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
