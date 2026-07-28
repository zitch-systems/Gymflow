// Brand tokens and per-gym branding for transactional email.
//
// Email clients are a hostile rendering target: no CSS variables, no external
// stylesheets, no SVG (Gmail strips it). So the `gf-*` design tokens that live
// as CSS custom properties in design/colors_and_type.css are mirrored here as
// literal hex strings, resolved to the LIGHT theme — inboxes composite on white
// and a dark-first palette reads as broken in Outlook, which ignores
// prefers-color-scheme entirely. layout.ts re-tints for dark-mode-capable
// clients (Apple Mail, iOS) on top of these.
//
// Nothing here is server-only: renderers are pure and the vitest suite calls
// them directly.

// ── GymFlow palette ──
// Source of truth is app/globals.css `[data-theme="light"]`, NOT the copy in
// design/colors_and_type.css: the light brand there is still #08a86c, while
// production darkened it to #0a7d52 for WCAG AA on white. Emails composite on
// white, so they must track the production value or a CTA in an email and the
// same CTA in the app are visibly different greens.
export const PALETTE = {
  brand: '#0a7d52',
  brandDark: '#06603f',
  brandLight: '#11d18b',
  accent: '#7fb800',
  bg: '#f6f6fb',
  surface: '#ffffff',
  elevated: '#f0f0f7',
  border: '#e3e3ee',
  borderLight: '#cdcde0',
  text: '#14121f',
  textSecondary: '#55546e',
  textMuted: '#6c6b85',
  danger: '#ff4560',
  warning: '#ffb020',
  info: '#4080ff',
  success: '#00c896',
} as const;

// Plus Jakarta Sans / Inter are webfonts — email clients won't load them, so
// every stack ends in ubiquitous system faces that are actually used.
export const FONT_DISPLAY = "'Plus Jakarta Sans','Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const FONT_BODY = "'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const FONT_MONO = "'JetBrains Mono',ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace";

export const RADIUS = { sm: '10px', md: '14px', lg: '18px' } as const;

// Public origin used to build absolute asset + link URLs. Emails render outside
// our origin, so every href/src must be absolute.
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (raw) return raw.replace(/\/+$/, '');
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim();
  return root ? `https://${root}` : 'https://gymflow.ng';
}

// The GymFlow logomark. Deliberately the 192px app icon (19 KB) and not the 4K
// wordmark: it is the only raster asset small enough to be polite in an inbox,
// and its own dark rounded-square background means it reads on both light and
// dark email surfaces. The wordmark beside it is live text, not an image, so
// the lockup survives image-blocking (the default in Outlook and many clients).
export function logomarkUrl(): string {
  return `${siteUrl()}/images/appicon-192.png`;
}

/**
 * Everything a template needs to dress an email in someone's identity.
 * `kind` decides whose name is on the envelope: 'platform' is GymFlow writing
 * to a gym owner or admin, 'gym' is a gym writing to its own member.
 */
export type EmailBrand = {
  kind: 'platform' | 'gym';
  /** Display name in the From header and the header lockup. */
  name: string;
  /** Accent colour: buttons, rules, links. Always a validated 6-digit hex. */
  color: string;
  /** Readable foreground for text sitting ON `color`. */
  onColor: string;
  /** Absolute https URL of the sender's logo, or null to fall back to text. */
  logoUrl: string | null;
  /** Where "open the app" style links point. */
  appUrl: string;
  /** Shown in the footer so members can reach a human. */
  supportEmail: string | null;
  /** Free-text location/contact line under the footer, already plain text. */
  contactLine: string | null;
  /** True when GymFlow should sign the footer as the platform, not "powered by". */
  isPlatform: boolean;
};

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;

/**
 * Coerce a gym-supplied colour to a safe 6-digit hex.
 *
 * `gyms.brand_color` is written by gym staff and lands inside a style="…"
 * attribute, so an unvalidated value is a CSS/HTML injection vector. Anything
 * that isn't plainly a hex colour is discarded rather than escaped — there is
 * no legitimate non-hex value, and falling back to the GymFlow brand is a
 * strictly better failure than rendering attacker-chosen CSS.
 */
export function safeHex(input: string | null | undefined, fallback: string = PALETTE.brand): string {
  const v = (input ?? '').trim();
  if (HEX6.test(v)) return v.toLowerCase();
  if (HEX3.test(v)) {
    const [, r, g, b] = v.toLowerCase().match(/^#(.)(.)(.)$/) as RegExpMatchArray;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

/**
 * Pick black or white text for a filled button/badge of `hex`.
 *
 * A gym is free to brand itself in volt lime or pale gold; white-on-lime is
 * unreadable, so the CTA — the one element the whole email exists to get
 * clicked — flips to near-black. Uses WCAG relative luminance with the 0.5
 * crossover, which lands on the higher-contrast option for every hue.
 */
export function readableOn(hex: string): string {
  const h = safeHex(hex);
  const channel = (i: number) => {
    const c = parseInt(h.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return luminance > 0.5 ? PALETTE.text : '#ffffff';
}

/** Shape of the `gyms` columns branding needs. Kept structural so callers can
 *  pass a partial select without casting. */
export type BrandableGym = {
  name?: string | null;
  slug?: string | null;
  logo_url?: string | null;
  brand_color?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
};

/** GymFlow's own identity — used for owner/admin mail and as the fallback when
 *  a gym-scoped send has no gym context. */
export function platformBrand(): EmailBrand {
  return {
    kind: 'platform',
    name: 'GymFlow',
    color: PALETTE.brand,
    onColor: '#ffffff',
    logoUrl: logomarkUrl(),
    appUrl: siteUrl(),
    supportEmail: supportAddress(),
    contactLine: null,
    isPlatform: true,
  };
}

/**
 * A gym's identity, for mail its members receive.
 *
 * Links point at the gym's own subdomain (<slug>.<root>) so the member stays
 * inside the brand they signed up with, and the logo is the gym's own upload.
 * The GymFlow lockup still appears in the footer — members should know what
 * platform holds their membership, and it is what makes an unfamiliar sender
 * domain legible rather than suspicious.
 */
export function gymBrand(gym: BrandableGym | null | undefined): EmailBrand {
  if (!gym) return platformBrand();
  const color = safeHex(gym.brand_color, PALETTE.brand);
  const place = [gym.address, gym.city, gym.state].map((p) => (p ?? '').trim()).filter(Boolean).join(', ');
  const contact = [place, (gym.phone ?? '').trim()].filter(Boolean).join(' · ');
  return {
    kind: 'gym',
    name: (gym.name ?? '').trim() || 'Your gym',
    color,
    onColor: readableOn(color),
    // Only https URLs are honoured: an http (or data:) logo would trip mixed
    // content warnings and image proxies, and the column is staff-writable.
    logoUrl: httpsOrNull(gym.logo_url),
    appUrl: gymUrl(gym.slug),
    supportEmail: (gym.email ?? '').trim() || null,
    contactLine: contact || null,
    isPlatform: false,
  };
}

function httpsOrNull(url: string | null | undefined): string | null {
  const v = (url ?? '').trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(v) ? v : null;
}

/** Public URL of a gym's tenant space, falling back to the apex when a gym has
 *  no slug yet (mid-provisioning). */
export function gymUrl(slug: string | null | undefined): string {
  const s = (slug ?? '').trim().toLowerCase();
  if (!s || !/^[a-z0-9-]+$/.test(s)) return siteUrl();
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim()
    || siteUrl().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return `https://${s}.${root}`;
}

/** Where replies and "contact us" links go when the sender is GymFlow itself. */
export function supportAddress(): string {
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim()
    || siteUrl().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return process.env.EMAIL_SUPPORT_ADDRESS?.trim() || `support@${root}`;
}
