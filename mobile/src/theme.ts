// The GymFlow design tokens, transcribed from app/globals.css.
//
// The member PWA and this app are the same product on two runtimes, and a
// member who signs in on both should not be able to tell which one they are
// looking at. Every value here has a `--gf-*` twin on the web; when one moves,
// move the other.
//
// Dark is the product's native mode (the web app's :root is the dark palette
// and .light overrides it), so it is the default here too.

export type ThemeName = 'dark' | 'light';

export type Palette = {
  brand: string;
  brandDark: string;
  brandSoft: string;
  accent: string;
  bg: string;
  surface: string;
  elevated: string;
  border: string;
  borderLight: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  infoSoft: string;
  success: string;
  successSoft: string;
  /** Text that sits ON a brand-coloured surface. */
  onBrand: string;
};

const dark: Palette = {
  brand: '#11d18b',
  brandDark: '#07a86c',
  brandSoft: 'rgba(17, 209, 139, 0.10)',
  accent: '#c6f24e',
  bg: '#0a0a12',
  surface: '#12121e',
  elevated: '#1b1b2b',
  border: '#2a2a40',
  borderLight: '#3d3d5a',
  text: '#f3f3fa',
  textSecondary: '#9b9bb8',
  textMuted: '#8a8aa8',
  danger: '#ff4560',
  dangerSoft: 'rgba(255, 69, 96, 0.12)',
  warning: '#ffb020',
  warningSoft: 'rgba(255, 176, 32, 0.12)',
  info: '#4080ff',
  infoSoft: 'rgba(64, 128, 255, 0.12)',
  success: '#00c896',
  successSoft: 'rgba(17, 209, 139, 0.12)',
  onBrand: '#04150e',
};

const light: Palette = {
  ...dark,
  bg: '#f6f6fb',
  surface: '#ffffff',
  elevated: '#f0f0f7',
  border: '#e3e3ee',
  borderLight: '#d4d4e2',
  text: '#12121e',
  textSecondary: '#5a5a72',
  textMuted: '#6e6e88',
};

export const palettes: Record<ThemeName, Palette> = { dark, light };

// 4px base scale — the same rhythm the web's padding/gap values sit on.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 } as const;

export const radius = { xs: 8, sm: 12, md: 16, lg: 20, xl: 24, pill: 999 } as const;

export const font = {
  display: { fontWeight: '800' as const },
  h1: { fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.4 },
  h2: { fontSize: 21, fontWeight: '800' as const, letterSpacing: -0.3 },
  h3: { fontSize: 17, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
  small: { fontSize: 12.5, fontWeight: '400' as const },
};
