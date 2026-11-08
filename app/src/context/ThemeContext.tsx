// Dark / White / Same as device. Saved on this device; with no saved choice the app follows the device. Everything below the provider is redrawn
// when the theme changes (see the key in the root layout), so every screen switches together.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { getPref, setPref } from '@/lib/storage';
import { colors, savedThemeMode, setThemeName, type ThemeMode, type ThemeName } from '@/theme';

type ThemeState = { mode: ThemeMode; theme: ThemeName; ready: boolean; setMode: (m: ThemeMode) => void };
const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const device = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(savedThemeMode);
  const [ready, setReady] = useState(Platform.OS === 'web');
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void getPref('theme').then((v) => { if (v === 'light' || v === 'system' || v === 'dark') setModeState(v); setReady(true); });
  }, []);
  const theme: ThemeName = mode === 'system' ? (device === 'light' ? 'light' : 'dark') : mode;
  setThemeName(theme);   // before children render, so they read the right colours

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.body.style.backgroundColor = colors.bg;
    document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors.bg);
    const id = 'oliskey-scrollbars';
    const css = document.getElementById(id) ?? document.head.appendChild(Object.assign(document.createElement('style'), { id }));
    css.textContent = `input:-webkit-autofill{-webkit-text-fill-color:${colors.text}!important;-webkit-box-shadow:0 0 0 40px ${colors.surface} inset!important;caret-color:${colors.text}}[data-away] [data-glass-body]{box-shadow:none!important}[data-glass-ink] *{transition:color 250ms ease,stroke 250ms ease}[data-glass-ink=light]{text-shadow:0 0 6px rgba(255,255,255,.9)}[data-glass-ink=dark]{text-shadow:0 0 6px rgba(0,0,0,.75)}[data-glass-ink=light] svg{filter:drop-shadow(0 0 3px rgba(255,255,255,.9))}[data-glass-ink=dark] svg{filter:drop-shadow(0 0 3px rgba(0,0,0,.7))}[data-reveal]{transition:opacity 160ms ease-out}@media (prefers-reduced-motion:reduce){[data-reveal],[data-glass-ink] *{transition:none}}@media (hover:hover) and (pointer:fine){[data-reveal-host] [data-reveal]:not([data-reveal-on]){opacity:0}[data-reveal-host]:hover [data-reveal],[data-reveal-host]:focus-within [data-reveal]{opacity:1}}@media (hover:none),(pointer:coarse){[data-side-arrow]{display:none}}[tabindex]:focus-visible,a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid ${colors.accent}!important;outline-offset:2px}[data-own-focus]:focus,[data-own-focus]:focus-visible{outline:none!important}*{scrollbar-width:thin;scrollbar-color:${colors.border} transparent}*::-webkit-scrollbar{width:6px;height:6px}*::-webkit-scrollbar-thumb{background:${colors.border};border-radius:3px}*::-webkit-scrollbar-track{background:transparent}`;
  }, [theme]);

  // Glass recedes while the window is not in front (web): its floating shadow goes quiet.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const set = (away: boolean) => { if (away) document.documentElement.dataset.away = '1'; else delete document.documentElement.dataset.away; };
    const blur = () => set(true), focus = () => set(false);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    return () => { window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); };
  }, []);

  const value = useMemo(() => ({ mode, theme, ready, setMode: (m: ThemeMode) => { setModeState(m); void setPref('theme', m); } }), [mode, theme, ready]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useTheme outside ThemeProvider');
  return v;
}
