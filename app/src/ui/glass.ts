// Liquid Glass-inspired material for the control/navigation layer only (see liquid.tsx for bending and tone; tab bar, rail, sidebar, icon buttons,
// secondary buttons, segmented tracks, chips, floating chart controls). Content (cards, lists, money, forms) stays on
// solid surfaces. Web approximation: backdrop blur + saturation, a near-clear tint, a bright top lip, faint chromatic
// fringe and a soft drop shadow. It is not Apple's renderer. Native and browsers without backdrop-filter get a solid
// surface that keeps the same shape and rim.
import { Platform, type ViewStyle } from 'react-native';
import { colors, isLight } from '@/theme';

const web = Platform.OS === 'web';
const blurOk = web && typeof CSS !== 'undefined'
  && (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));
// Read live, so changing the system setting applies on the next render. Web builds must honour these by hand.
const media = (q: string) => web && typeof matchMedia !== 'undefined' && matchMedia(q).matches;
export const reducedTransparency = () => media('(prefers-reduced-transparency: reduce)');
export const moreContrast = () => media('(prefers-contrast: more)');

export type Tone = 'light' | 'dark';

// Edge light: bright top lip, faint bottom light. Small glints come from the rim map in liquid.tsx.
const RIM = 'inset 0 1px 0 rgba(255,255,255,0.20), inset 0 -1px 0 rgba(255,255,255,0.05)';
const DROP = '0 10px 28px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.35)';
// White mode: glass over white has to carry its own body, so a frosted fill, a fine dark hairline, a bright top lip
// and a soft neutral shadow, never a coloured one.
const RIM_L = 'inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(0,0,0,0.03)';
const DROP_L = '0 8px 28px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06)';
const LIFT_L = '0 1px 2px rgba(0,0,0,0.05)';
const DROP_PLAIN = '0 6px 18px rgba(0,0,0,0.38), 0 1px 3px rgba(0,0,0,0.25)';   // softer over a plain surface
const DROP_BUSY_L = '0 10px 32px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.10)';   // stronger over text
const DROP_PLAIN_L = '0 6px 20px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.05)';  // softer over a plain surface

// Regular only: Apple says Regular and Clear should never be mixed, and Clear needs rich media and a dimming layer.
// tone: small floating glass can flip away from the theme (see liquid.tsx). busy: text is under it, so a stronger
// shadow. bent: LiquidView adds the bend and rim, so the fill is lighter and the look changes ease.
export function glass(_variant: 'regular' = 'regular', { shadow = true, tone, busy = false, bent = false }: { shadow?: boolean; tone?: Tone; busy?: boolean; bent?: boolean } = {}): ViewStyle {
  const light = tone ? tone === 'light' : isLight();
  const contrast = moreContrast();
  const blur = blurOk && !reducedTransparency() && !contrast;
  const fill = blur
    ? (light ? (bent ? 'rgba(255,255,255,0.54)' : 'rgba(255,255,255,0.55)') : bent ? 'rgba(24,24,28,0.3)' : 'rgba(28,28,33,0.42)')
    : light ? '#FFFFFF' : '#1E1E1E';
  const style: Record<string, unknown> = {
    backgroundColor: fill,
    borderWidth: contrast ? 2 : 1,
    borderColor: contrast ? (light ? '#000000' : '#FFFFFF') : light ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.10)',
  };
  if (web) {
    const dropL = bent ? (busy ? DROP_BUSY_L : DROP_PLAIN_L) : DROP_L;
    style.boxShadow = light ? (shadow ? `${RIM_L}, ${dropL}` : `${RIM_L}, ${LIFT_L}`) : shadow ? `${RIM}, ${bent && !busy ? DROP_PLAIN : DROP}` : RIM;
    if (blur) {
      const filter = light ? 'blur(2px) saturate(170%)' : 'blur(2px) saturate(165%) brightness(1.04)';   // before the bend attaches; also Safari and Firefox
      style.backdropFilter = filter;
      style.WebkitBackdropFilter = filter;
    }
    if (bent) style.transition = 'background-color 250ms ease, box-shadow 250ms ease, border-color 250ms ease';
  }
  return style as ViewStyle;
}

// The same edge light on a solid body (primary white buttons, Up/Down): keeps the colour solid for contrast and
// gives it the glass rim so every button reads as one family.
export function glassEdge(onLight = false): ViewStyle {
  if (!web) return {};
  if (isLight()) return { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 1px 2px rgba(0,0,0,0.14), 0 4px 12px rgba(0,0,0,0.10)' } as unknown as ViewStyle;
  const lip = onLight ? 'inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -2px 4px rgba(0,0,0,0.10)' : 'inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 4px rgba(0,0,0,0.18)';
  return { boxShadow: `${lip}, 0 6px 18px rgba(0,0,0,0.45)` } as unknown as ViewStyle;
}

// Selected item inside glass (segmented controls, tab bar): a neutral lens, colour stays in the icon/label.
export function glassLens(tone?: Tone): ViewStyle {
  if (tone ? tone === 'light' : isLight()) {
    const l: Record<string, unknown> = { backgroundColor: 'rgba(120,120,128,0.13)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)' };
    if (web) l.boxShadow = 'inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -1px 1px rgba(0,0,0,0.04), 0 0 0 0.5px rgba(0,0,0,0.08), 0 3px 10px rgba(0,0,0,0.10)';
    return l as ViewStyle;
  }
  const style: Record<string, unknown> = { backgroundColor: 'rgba(255,255,255,0.09)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' };
  if (web) style.boxShadow = 'inset 0 1px 1px rgba(255,255,255,0.32), inset 0 -1px 1px rgba(255,255,255,0.05), 0 3px 12px rgba(0,0,0,0.4)';
  return style as ViewStyle;
}

// Motion tokens: hover grows 2% over ~160 ms, press 0.96 for ~120 ms (no wobble); selection glides on the iOS deceleration curve.
export const MOTION = { pressScale: 0.96, pressMs: 120, hoverScale: 1.02, hoverMs: 160, glideMs: 420 } as const;
