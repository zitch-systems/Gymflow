// The email layout: one bulletproof table-based shell that every GymFlow
// message renders into, plus the block vocabulary templates compose from.
//
// Three rules drive every decision here:
//
//  1. EVERY block emits HTML *and* plain text together. Text twins kept in a
//     separate string drift the moment someone edits one and not the other —
//     and a missing or rotten text part is a real spam signal. Here both come
//     out of the same call, so they cannot diverge.
//
//  2. Interpolation is escaped by construction. Gym names, member names, plan
//     names and staff notes are all user-controlled and all land in these
//     bodies; the `t` tagged template escapes every interpolated value unless
//     it is a Safe produced by our own helpers.
//
//  3. Styling is inline first. Inline attributes carry the whole light-theme
//     design so a client that strips <style> still renders correctly; the
//     <style> block only adds what an attribute cannot express (dark-mode
//     re-tinting, small-screen padding), keyed off `gf-*` classes.
//
// Pure functions only (no 'server-only') so the vitest suite renders and
// asserts on real output.

import {
  FONT_BODY, FONT_DISPLAY, FONT_MONO, PALETTE, RADIUS, logomarkUrl, siteUrl,
  type EmailBrand,
} from './brand';

// ── Escaping + safe fragments ────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/** An HTML fragment that is already safe, paired with its plain-text twin. */
export class Safe {
  constructor(readonly html: string, readonly text: string) {}
}

type Value = string | number | Safe | null | undefined;

function toSafe(v: Value): Safe {
  if (v === null || v === undefined) return new Safe('', '');
  if (v instanceof Safe) return v;
  const s = String(v);
  return new Safe(escapeHtml(s), s);
}

/**
 * Tagged template that escapes every interpolated value and carries the plain
 * text alongside. t`Hi ${name}` is safe even when `name` is `<script>`.
 */
export function t(strings: TemplateStringsArray, ...values: Value[]): Safe {
  let html = '';
  let text = '';
  strings.forEach((chunk, i) => {
    html += chunk;
    text += chunk;
    if (i < values.length) {
      const v = toSafe(values[i]);
      html += v.html;
      text += v.text;
    }
  });
  return new Safe(html, text);
}

export const strong = (s: string): Safe =>
  new Safe(`<strong class="gf-t" style="color:${PALETTE.text};font-weight:600">${escapeHtml(s)}</strong>`, s);

/**
 * Inline link. Only http(s) and mailto: targets survive: an href is the one
 * place a bad value turns a notification into a phishing vector, and
 * `javascript:` still executes in a few desktop clients. Rejected URLs degrade
 * to unlinked text, never to markup.
 */
export function link(text: string, href: string, color?: string): Safe {
  const ok = /^https?:\/\/[^\s"'<>]+$/i.test(href) || /^mailto:[^\s"'<>]+$/i.test(href);
  if (!ok) return new Safe(escapeHtml(text), text);
  const c = color ?? PALETTE.brand;
  return new Safe(
    `<a href="${escapeHtml(href)}" style="color:${c};text-decoration:underline">${escapeHtml(text)}</a>`,
    href.startsWith('mailto:') ? text : `${text} (${href})`,
  );
}

/** ₦ amounts, formatted the way the app formats them everywhere else. */
export const naira = (amountNaira: number): Safe => {
  const s = `₦${Math.round(amountNaira).toLocaleString('en-NG')}`;
  return new Safe(escapeHtml(s), s);
};

// ── Blocks ───────────────────────────────────────────────────────────────────

/** A block renders itself once the brand (colours) is known. */
export type Block = (b: EmailBrand) => { html: string; text: string };

const P_STYLE = `margin:0 0 16px;font-family:${FONT_BODY};font-size:15px;line-height:1.65;color:${PALETTE.textSecondary}`;

/** Body paragraph. */
export function p(content: Safe | string): Block {
  const v = toSafe(content);
  return () => ({ html: `<p class="gf-t2" style="${P_STYLE}">${v.html}</p>`, text: `${v.text}\n` });
}

/** The one big line at the top of the card. */
export function h1(content: Safe | string): Block {
  const v = toSafe(content);
  return () => ({
    html: `<h1 class="gf-t" style="margin:0 0 16px;font-family:${FONT_DISPLAY};font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:${PALETTE.text}">${v.html}</h1>`,
    text: `${v.text}\n${'='.repeat(Math.min(Math.max(v.text.length, 3), 60))}\n`,
  });
}

/** Section heading inside the body. */
export function h2(content: Safe | string): Block {
  const v = toSafe(content);
  return () => ({
    html: `<h2 class="gf-t" style="margin:26px 0 12px;font-family:${FONT_DISPLAY};font-size:17px;line-height:1.3;font-weight:700;color:${PALETTE.text}">${v.html}</h2>`,
    text: `\n${v.text}\n${'-'.repeat(Math.min(Math.max(v.text.length, 3), 60))}\n`,
  });
}

/**
 * Primary call to action.
 *
 * An <a> styled as a button rather than a <button> (which no client renders),
 * wrapped in an MSO conditional so Outlook — which ignores border-radius and
 * padding on inline anchors — draws a real filled rectangle via VML instead of
 * a bare underlined link.
 */
export function button(label: string, href: string): Block {
  return (b) => {
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(href)) return { html: '', text: '' };
    const h = escapeHtml(href);
    const l = escapeHtml(label);
    return {
      html: [
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr>`,
        `<td align="center" bgcolor="${b.color}" style="border-radius:${RADIUS.sm};background-color:${b.color}">`,
        `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${h}" style="height:46px;v-text-anchor:middle;width:280px" arcsize="22%" stroke="f" fillcolor="${b.color}"><w:anchorlock/><center style="color:${b.onColor};font-family:Arial,sans-serif;font-size:15px;font-weight:bold">${l}</center></v:roundrect><![endif]-->`,
        `<!--[if !mso]><!-- -->`,
        `<a href="${h}" style="display:inline-block;padding:13px 30px;font-family:${FONT_DISPLAY};font-size:15px;font-weight:600;line-height:20px;color:${b.onColor};text-decoration:none;border-radius:${RADIUS.sm}">${l}</a>`,
        `<!--<![endif]-->`,
        `</td></tr></table>`,
      ].join(''),
      text: `${label}: ${href}\n`,
    };
  };
}

/** Secondary, low-emphasis action rendered as a plain link line. */
export function linkLine(label: string, href: string): Block {
  return (b) => {
    const l = link(label, href, b.color);
    return { html: `<p class="gf-t2" style="${P_STYLE}">${l.html}</p>`, text: `${l.text}\n` };
  };
}

/**
 * Key/value panel — receipts, booking details, payout summaries.
 * Values are right-aligned so amounts and dates form a readable column.
 */
export function panel(rows: Array<[string, Safe | string]>, title?: string): Block {
  const items = rows.filter(([, v]) => toSafe(v).text.trim() !== '');
  if (items.length === 0) return () => ({ html: '', text: '' });
  return () => {
    const trs = items.map(([k, v], i) => {
      const val = toSafe(v);
      const border = i === 0 ? '' : `border-top:1px solid ${PALETTE.border};`;
      return [
        `<tr>`,
        `<td class="gf-t3 gf-rule-b" style="${border}padding:11px 0;font-family:${FONT_BODY};font-size:14px;line-height:1.4;color:${PALETTE.textMuted}">${escapeHtml(k)}</td>`,
        `<td class="gf-t gf-rule-b" align="right" style="${border}padding:11px 0;font-family:${FONT_BODY};font-size:14px;line-height:1.4;font-weight:600;color:${PALETTE.text}">${val.html}</td>`,
        `</tr>`,
      ].join('');
    }).join('');
    const pad = Math.max(...items.map(([k]) => k.length));
    return {
      html: [
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="gf-panel" bgcolor="${PALETTE.elevated}" style="width:100%;margin:0 0 24px;background-color:${PALETTE.elevated};border-radius:${RADIUS.md}">`,
        `<tr><td style="padding:6px 20px 10px">`,
        title ? `<p class="gf-t3" style="margin:12px 0 4px;font-family:${FONT_DISPLAY};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${PALETTE.textMuted}">${escapeHtml(title)}</p>` : '',
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%">${trs}</table>`,
        `</td></tr></table>`,
      ].join(''),
      text: `${title ? `${title}\n` : ''}${items.map(([k, v]) => `  ${k.padEnd(pad)}  ${toSafe(v).text}`).join('\n')}\n`,
    };
  };
}

const TONES = {
  info: { bg: '#eef4ff', bar: PALETTE.info },
  success: { bg: '#e7f9f2', bar: PALETTE.success },
  warning: { bg: '#fff6e6', bar: PALETTE.warning },
  danger: { bg: '#ffedf0', bar: PALETTE.danger },
} as const;

/** Tinted aside for the one thing that must not be skimmed past. */
export function callout(tone: keyof typeof TONES, content: Safe | string): Block {
  const v = toSafe(content);
  const { bg, bar } = TONES[tone];
  return () => ({
    html: [
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="gf-panel" bgcolor="${bg}" style="width:100%;margin:0 0 24px;background-color:${bg};border-radius:${RADIUS.sm}">`,
      `<tr><td width="4" bgcolor="${bar}" style="width:4px;background-color:${bar};border-radius:${RADIUS.sm} 0 0 ${RADIUS.sm}">&nbsp;</td>`,
      `<td class="gf-t" style="padding:14px 18px;font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${PALETTE.text}">${v.html}</td>`,
      `</tr></table>`,
    ].join(''),
    text: `! ${v.text}\n`,
  });
}

/** Monospace one-time code, letter-spaced so it can be read off a screen. */
export function code(value: string): Block {
  return () => ({
    html: [
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:0 0 24px"><tr>`,
      `<td align="center" class="gf-panel gf-t" bgcolor="${PALETTE.elevated}" style="padding:20px;background-color:${PALETTE.elevated};border-radius:${RADIUS.md};font-family:${FONT_MONO};font-size:30px;font-weight:600;letter-spacing:0.28em;line-height:1.2;color:${PALETTE.text}">${escapeHtml(value)}</td>`,
      `</tr></table>`,
    ].join(''),
    text: `    ${value}\n`,
  });
}

/** Fine print: expiry notes, "you can ignore this", legal lines. */
export function small(content: Safe | string): Block {
  const v = toSafe(content);
  return () => ({
    html: `<p class="gf-t3" style="margin:0 0 12px;font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${PALETTE.textMuted}">${v.html}</p>`,
    text: `${v.text}\n`,
  });
}

export function divider(): Block {
  return () => ({
    html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:4px 0 24px"><tr><td height="1" class="gf-rule" bgcolor="${PALETTE.border}" style="height:1px;line-height:1px;font-size:0;background-color:${PALETTE.border}">&nbsp;</td></tr></table>`,
    text: `\n---\n`,
  });
}

/** Bulleted list. */
export function bullets(items: Array<Safe | string>): Block {
  const vs = items.map(toSafe).filter((v) => v.text.trim() !== '');
  if (vs.length === 0) return () => ({ html: '', text: '' });
  return (b) => ({
    html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">${vs.map((v) => (
      `<tr><td valign="top" style="padding:0 10px 8px 0;font-family:${FONT_BODY};font-size:15px;line-height:1.65;color:${b.color}">&bull;</td>`
      + `<td class="gf-t2" style="padding:0 0 8px;font-family:${FONT_BODY};font-size:15px;line-height:1.65;color:${PALETTE.textSecondary}">${v.html}</td></tr>`
    )).join('')}</table>`,
    text: `${vs.map((v) => `  - ${v.text}`).join('\n')}\n`,
  });
}

// ── Shell ────────────────────────────────────────────────────────────────────

/**
 * What every template returns.
 *
 * Templates produce *content*, never rendered HTML: the sender (lib/email/send)
 * owns the shell, because the shell is where branding and gating live. Keeping
 * templates at this level makes them pure functions of their arguments — which
 * is what lets the test suite assert on them directly, in a repo that uses no
 * mocking anywhere.
 */
export type EmailContent = {
  subject: string;
  /** Inbox preview line. Never a repeat of the subject — it is the second line
   *  of the pitch, not an echo of the first. */
  preheader: string;
  blocks: Block[];
};

export type RenderedEmail = { html: string; text: string };

export type RenderOptions = {
  brand: EmailBrand;
  /** Inbox preview line. Falls back to the first rendered line when omitted. */
  preheader?: string;
  /** <title>; also the accessible document name. */
  title: string;
  blocks: Block[];
  /** "Manage email preferences" target. Omitted for account-critical mail,
   *  which a recipient must not be able to switch off. */
  preferencesUrl?: string | null;
};

/**
 * Header lockup. A gym's logo renders at a bounded height with the gym name as
 * alt text, so an image-blocking client (Outlook's default) still shows who is
 * writing. The platform lockup pairs the app icon with live text for the same
 * reason — the wordmark is never an image.
 */
function header(b: EmailBrand): string {
  const name = escapeHtml(b.name);
  if (b.isPlatform) {
    return [
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`,
      `<td style="padding-right:10px"><img src="${escapeHtml(logomarkUrl())}" alt="" width="36" height="36" style="display:block;width:36px;height:36px;border:0;border-radius:9px;outline:none;text-decoration:none"></td>`,
      `<td class="gf-t" style="font-family:${FONT_DISPLAY};font-size:20px;font-weight:800;letter-spacing:-0.02em;color:${PALETTE.text}">GymFlow</td>`,
      `</tr></table>`,
    ].join('');
  }
  if (b.logoUrl) {
    return `<img src="${escapeHtml(b.logoUrl)}" alt="${name}" height="44" style="display:block;height:44px;max-height:44px;width:auto;border:0;outline:none;text-decoration:none">`;
  }
  // Gym with no logo uploaded: set its name in the display face instead.
  return `<div class="gf-t" style="font-family:${FONT_DISPLAY};font-size:20px;font-weight:800;letter-spacing:-0.02em;color:${PALETTE.text}">${name}</div>`;
}

/**
 * Footer. For gym mail this carries the gym's own contact details AND the
 * "Powered by GymFlow" lockup — the gym owns the relationship, GymFlow is named
 * as the system of record so an unfamiliar sending domain reads as legitimate
 * rather than suspicious.
 */
function footer(b: EmailBrand, preferencesUrl: string | null | undefined): string {
  const line = (html: string) =>
    `<p class="gf-t3" style="margin:0 0 8px;font-family:${FONT_BODY};font-size:12px;line-height:1.6;color:${PALETTE.textMuted}">${html}</p>`;
  const s: string[] = [];

  if (b.isPlatform) {
    s.push(line(`GymFlow — gym management software for Nigeria.`));
    if (b.supportEmail) {
      s.push(line(`Questions? Reply to this email, or write to ${link(b.supportEmail, `mailto:${b.supportEmail}`, PALETTE.textMuted).html}.`));
    }
  } else {
    s.push(line(`You're receiving this because you're a member at <strong style="color:${PALETTE.textSecondary}">${escapeHtml(b.name)}</strong>.`));
    if (b.contactLine) s.push(line(escapeHtml(b.contactLine)));
    if (b.supportEmail) s.push(line(`Reply to this email to reach ${escapeHtml(b.name)} directly.`));
  }

  if (preferencesUrl && /^https?:\/\//i.test(preferencesUrl)) {
    s.push(line(`<a href="${escapeHtml(preferencesUrl)}" style="color:${PALETTE.textMuted};text-decoration:underline">Manage email preferences</a>`));
  }

  // The GymFlow lockup on gym mail. Platform mail already leads with it.
  if (!b.isPlatform) {
    s.push([
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0"><tr>`,
      `<td style="padding-right:7px"><img src="${escapeHtml(logomarkUrl())}" alt="" width="18" height="18" style="display:block;width:18px;height:18px;border:0;border-radius:5px;outline:none;text-decoration:none"></td>`,
      `<td class="gf-t3" style="font-family:${FONT_BODY};font-size:12px;line-height:18px;color:${PALETTE.textMuted}">Powered by <a href="${escapeHtml(siteUrl())}" style="color:${PALETTE.textSecondary};text-decoration:none;font-weight:600">GymFlow</a></td>`,
      `</tr></table>`,
    ].join(''));
  }
  return s.join('');
}

/** Render a complete email to HTML + plain text. */
export function renderEmail(opts: RenderOptions): RenderedEmail {
  const { brand: b } = opts;
  const parts = opts.blocks.map((block) => block(b));
  const bodyHtml = parts.map((x) => x.html).join('');
  const bodyText = parts.map((x) => x.text).filter((x) => x.trim()).join('\n');

  const preheader = (opts.preheader ?? parts.find((x) => x.text.trim())?.text ?? '')
    .replace(/[=\-]{3,}/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);

  const html = [
    `<!DOCTYPE html>`,
    `<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">`,
    `<head>`,
    `<meta charset="UTF-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    `<meta http-equiv="X-UA-Compatible" content="IE=edge">`,
    `<meta name="color-scheme" content="light dark">`,
    `<meta name="supported-color-schemes" content="light dark">`,
    `<title>${escapeHtml(opts.title)}</title>`,
    `<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->`,
    `<style>`,
    // Dark-mode re-tint for clients that honour prefers-color-scheme (Apple
    // Mail, iOS, Outlook.com). Values are the dark-theme tokens from
    // design/colors_and_type.css. Outlook desktop ignores this whole block and
    // keeps the inline light theme, which is why the inline styles are the
    // source of truth rather than these.
    `@media (prefers-color-scheme:dark){`,
    `.gf-page{background-color:#0a0a12!important}`,
    `.gf-card{background-color:#12121e!important}`,
    `.gf-panel{background-color:#1b1b2b!important}`,
    `.gf-t,.gf-t strong{color:#f3f3fa!important}`,
    `.gf-t2{color:#9b9bb8!important}`,
    `.gf-t3{color:#8a89a3!important}`,
    `.gf-rule{background-color:#2a2a40!important}`,
    `.gf-rule-b{border-top-color:#2a2a40!important}`,
    `}`,
    `@media only screen and (max-width:620px){`,
    `.gf-card-pad{padding-left:22px!important;padding-right:22px!important}`,
    `.gf-outer-pad{padding-left:10px!important;padding-right:10px!important}`,
    `}`,
    `</style>`,
    `</head>`,
    `<body class="gf-page" style="margin:0;padding:0;width:100%;background-color:${PALETTE.bg};-webkit-font-smoothing:antialiased">`,
    // Preview text: shown in the inbox list beside the subject. The zero-width
    // run after it stops clients padding the preview with body copy.
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${PALETTE.bg};opacity:0">${escapeHtml(preheader)}${'&#8203;'.repeat(80)}</div>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="gf-page" bgcolor="${PALETTE.bg}" style="width:100%;background-color:${PALETTE.bg}">`,
    `<tr><td class="gf-outer-pad" align="center" style="padding:32px 16px">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px">`,

    // Brand accent rule across the top of the card — the one element that
    // carries the gym's colour whether or not it uploaded a logo.
    `<tr><td height="4" bgcolor="${b.color}" style="height:4px;line-height:4px;font-size:0;background-color:${b.color};border-radius:${RADIUS.lg} ${RADIUS.lg} 0 0">&nbsp;</td></tr>`,

    `<tr><td class="gf-card" bgcolor="${PALETTE.surface}" style="background-color:${PALETTE.surface};border-radius:0 0 ${RADIUS.lg} ${RADIUS.lg}">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%">`,
    `<tr><td class="gf-card-pad" style="padding:32px 36px 4px">${header(b)}</td></tr>`,
    `<tr><td class="gf-card-pad" style="padding:26px 36px 10px">${bodyHtml}</td></tr>`,
    `</table></td></tr>`,

    `<tr><td class="gf-card-pad" style="padding:22px 36px 0">${footer(b, opts.preferencesUrl)}</td></tr>`,
    `<tr><td style="height:24px;line-height:24px;font-size:0">&nbsp;</td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join('');

  const textFooter = b.isPlatform
    ? `GymFlow — gym management software for Nigeria.${b.supportEmail ? `\nQuestions? ${b.supportEmail}` : ''}`
    : [
      `You're receiving this because you're a member at ${b.name}.`,
      b.contactLine,
      b.supportEmail ? `Reply to this email to reach ${b.name} directly.` : null,
      `Powered by GymFlow — ${siteUrl()}`,
    ].filter(Boolean).join('\n');

  const text = [
    bodyText.trim(),
    '',
    '—',
    textFooter,
    preferencesUrl(opts.preferencesUrl),
  ].filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';

  return { html, text };
}

function preferencesUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? `Manage email preferences: ${url}` : null;
}
