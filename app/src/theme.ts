// Oliskey Alpha design tokens. Two themes: dark (the default: pure black, neutral greys, sharp saturated signals) and
// white (colourful, see `light`).
// Colour roles: white = primary action, violet accent = selection/links/focus (used sparingly),
// green/red = Up/Down and profit/loss ONLY, gold = demo. Gradients are reserved for the logo and mascot.
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

const dark = {
  bg: '#000000',
  surface: '#0E0E10',        // cards, sheets, panels
  surface2: '#1A1A1D',       // inputs, pills, pressed rows
  border: '#26262A',         // 1 px hairlines
  text: '#FFFFFF',
  muted: '#A0A0A8',          // 8.3:1 on black, 7.4:1 on surface
  faint: '#8E8E93',          // inactive tab icons, axis ticks (non-essential text only)
  accent: '#8B7BFF',         // violet: links, focus, selected states (5.9:1 on black)
  primaryFrom: '#7C5CFF',    // brand gradient: logo + mascot only
  primaryTo: '#3BA4FF',
  up: '#00D27A',
  upVivid: '#00D27A',        // shapes with no text on them (candles, switches): white mode can go brighter than `up`
  down: '#FF3D5A',
  demo: '#F5B942',
  grid: '#141416',
  tabBar: '#000000',
  teal: '#2EE6D0',
  zone: '#3BA4FF',
  dark: '#000000',
  tooltipBg: '#FFFFFF',
};

// White mode (owner 2026-11-05): a true white page, neutral greys and near-black text, so one sharp violet and the
// Up/Down colours stand out. `dark` is the text colour on filled controls (white here: on violet, Up and Down).
const light: Record<keyof typeof dark, string> = {
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  surface2: '#F4F5F8',       // inputs, pills, pressed rows: a cool, barely-there grey
  border: '#E6E8EE',
  text: '#0F172A',           // deep slate: softer than black, still 17:1
  muted: '#5B6475',          // 5.9:1 on white
  faint: '#6B7280',          // readable on white, also as small text (4.8:1)
  accent: '#5B3DF5',
  primaryFrom: '#6A4BFF',    // main buttons: a slight same-colour shift, not a two-colour gradient
  primaryTo: '#5432F0',
  up: '#0A8449',             // emerald: 4.7:1 as text on white, and white text on it
  upVivid: '#12B76A',        // candles, switches, bars (no text on them)
  down: '#E11D48',           // rose red: 4.7:1 as text on white, and white text on it
  demo: '#B45309',           // amber: 5:1 on white
  grid: '#F1F3F7',
  tabBar: '#FFFFFF',
  teal: '#0E8A80',
  zone: '#2563EB',
  dark: '#FFFFFF',
  tooltipBg: '#0F172A',
};

export type ThemeName = 'dark' | 'light';
export type ThemeMode = ThemeName | 'system';
let active: ThemeName = 'dark';
let palette: Record<keyof typeof dark, string> = dark;
let version = 0;

/** Colours always read the active theme, so `colors.text` needs no changes anywhere it is used. */
export const colors = {} as Record<keyof typeof dark, string>;
for (const key of Object.keys(dark) as (keyof typeof dark)[]) {
  Object.defineProperty(colors, key, { enumerable: true, get: () => palette[key] });
}

export const isLight = () => active === 'light';
export function setThemeName(name: ThemeName) {
  if (name === active) return;
  active = name;
  palette = name === 'light' ? light : dark;
  version += 1;
}

// Web can read the saved choice before anything renders, so the page never flashes the wrong theme.
export function savedThemeMode(): ThemeMode {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem('oliskey-alpha.theme') : null;
    return v === 'light' || v === 'dark' ? v : 'system';   // no saved choice: follow the device
  } catch { return 'system'; }
}
export const systemPrefersLight = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches;
{
  const mode = savedThemeMode();
  if (mode === 'light' || (mode === 'system' && systemPrefersLight())) setThemeName('light');
}

/** Like StyleSheet.create, but rebuilt when the theme changes, because a fixed style would keep its old colours. */
export function createStyles<T extends { [K in keyof T]: ViewStyle | TextStyle | ImageStyle }>(build: () => T): T {
  let built = -1;
  let current = {} as T;
  return new Proxy({} as object, {
    get(_t, key) {
      if (built !== version) { current = StyleSheet.create(build() as never) as T; built = version; }
      return (current as Record<string | symbol, unknown>)[key];
    },
  }) as T;
}

// Icon tiles: a neutral tile with a sharp coloured icon in white mode, the quiet neutral tile in dark mode.
const TINTS = [
  { bg: '#F2F2F7', fg: '#5B2EFF' }, { bg: '#F2F2F7', fg: '#0066CC' }, { bg: '#F2F2F7', fg: '#00857A' },
  { bg: '#F2F2F7', fg: '#D1006C' }, { bg: '#F2F2F7', fg: '#A8620A' },
];
export function tint(key: string | number): { bg: string; fg: string } {
  if (active !== 'light') return { bg: colors.surface2, fg: colors.text };
  const n = typeof key === 'number' ? key : [...key].reduce((a, c) => a + c.charCodeAt(0), 0);
  return TINTS[Math.abs(n) % TINTS.length];
}

// Surfaces drawn over content
export const veil = {
  get scrim() { return active === 'light' ? 'rgba(255,255,255,0.86)' : 'rgba(0,0,0,0.82)'; },
  get legend() { return active === 'light' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.55)'; },
  get backdrop() { return active === 'light' ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.6)'; },
  get selected() { return active === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.12)'; },
  get field() { return active === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)'; },
  get switchOff() { return active === 'light' ? '#D1D1D6' : '#39393D'; },
  get hover() { return active === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'; },
  get shimmer() { return active === 'light' ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)'; },
};

export const gradient = [colors.primaryFrom, colors.primaryTo] as const;

export const space = { xs: 4, sm: 8, md: 14, lg: 24 } as const;
export const SIDE = 16;            // side padding on every screen
export const SECTION_GAP = 28;

export const radius = { sm: 6, md: 12, card: 16, lg: 18, sheet: 22, dialog: 18 } as const;

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

const NUM = { fontVariant: ['tabular-nums' as const] };

// size / weight pairs; line height 1.25x. Headings tighten slightly; numbers are always tabular.
const t = (fontSize: number, fontFamily: string, letterSpacing = 0) => ({ fontSize, fontFamily, letterSpacing, lineHeight: Math.round(fontSize * 1.25) });
export const type = {
  screenTitle: t(30, font.bold, -0.6),
  sectionTitle: t(21, font.semibold, -0.3),
  balance: { ...t(34, font.semibold, -0.8), ...NUM },
  cardValue: { ...t(16, font.medium), ...NUM },
  cardLabel: t(13, font.regular),
  button: t(16, font.semibold, -0.1),
  tabLabel: t(11, font.medium, 0.1),
  body: t(15, font.regular),
  small: t(12, font.regular),
  num: NUM,
} as const;

// Hairline card: near-black fill + 1 px border reads crisper on pure black than a flat grey block.
export const card = {
  get backgroundColor() { return colors.surface; }, borderRadius: radius.card, borderWidth: 1,
  get borderColor() { return colors.border; },
};
