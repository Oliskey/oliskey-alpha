// The liquid layer on top of glass(): edges that bend what is behind them, a thin rim light, a glow from the pointer,
// and a tone that reacts to the background. Used only by floating controls (navigation, chart buttons); cards, lists
// and money stay solid. Web approximation of Apple's material, not its renderer. Bending needs Chromium; Safari and
// Firefox get the same shape, rim and frost. iPhones on iOS 26+ get Apple's real material through GlassView, which does
// its own bending, flipping and accessibility; other native gets glass()'s solid surface. See docs/design-system.md.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Animated, Platform, View, type StyleProp, type TextStyle, type ViewProps, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { colors, isLight } from '@/theme';
import { glass, moreContrast, reducedTransparency, type Tone } from './glass';
import { Txt } from './Txt';

const web = Platform.OS === 'web';
const N = 1.5;   // refractive index of glass

// A convex rim profile: how far a straight-down ray shifts sideways through the bevel, normalised to a peak of 1.
const squircle = (x: number) => Math.pow(1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 4), 0.25);
function rimProfile(thickness: number, bezel: number) {
  const out = new Float32Array(128);
  let max = 0;
  for (let i = 0; i < 128; i++) {
    const x = (i + 0.5) / 128, d = 0.001;
    const t1 = Math.atan(((squircle(x + d) - squircle(x - d)) / (2 * d)) * (thickness / bezel));
    const shift = thickness * squircle(x) * Math.tan(t1 - Math.asin(Math.sin(t1) / N));
    out[i] = shift;
    max = Math.max(max, shift);
  }
  for (let i = 0; i < 128; i++) out[i] = max ? out[i] / max : 0;
  return { profile: out, maxShift: max };
}

// Distance to a rounded rectangle (negative inside) and the outward direction at that point.
function roundedRect(px: number, py: number, hw: number, hh: number, r: number) {
  const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), outside = Math.hypot(ox, oy);
  const dist = outside + Math.min(Math.max(qx, qy), 0) - r;
  const [nx, ny] = qx > 0 && qy > 0 ? [ox / outside, oy / outside] : qx > qy ? [1, 0] : [0, 1];
  return { dist, nx: nx * Math.sign(px || 1), ny: ny * Math.sign(py || 1) };
}

type Maps = { filterId: string; rim: string };
const mapCache = new Map<string, Maps>();
const refracts = () => web && !reducedTransparency()
  && !!(navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands?.some((b) => /Chromium/.test(b.brand));

// One pair of maps per size, shared by elements of that size and never rebuilt per frame.
function mapsFor(w: number, h: number, radius: number, bezelWanted: number, thickness: number, shine: number): Maps {
  const key = `${w}x${h}|${radius}|${bezelWanted}|${thickness}|${shine}`;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const r = Math.min(radius, w / 2, h / 2);
  const bezel = Math.max(3, Math.min(bezelWanted, r, Math.min(w, h) * 0.35));   // a steeper rim mirrors what is under it
  const { profile, maxShift } = rimProfile(thickness, bezel);
  const disp = document.createElement('canvas'), spec = document.createElement('canvas');
  disp.width = spec.width = w; disp.height = spec.height = h;
  const dctx = disp.getContext('2d')!, sctx = spec.getContext('2d')!;
  const dimg = dctx.createImageData(w, h), simg = sctx.createImageData(w, h);
  const lx = -0.62, ly = -0.78;   // light from the top left
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { dist, nx, ny } = roundedRect(x + 0.5 - w / 2, y + 0.5 - h / 2, w / 2, h / 2, r);
      const inside = -dist, k = (y * w + x) * 4;
      let vx = 0, vy = 0, light = 0;
      if (inside >= 0 && inside < bezel) {
        const t = inside / bezel, m = profile[Math.min(127, Math.floor(t * 128))];
        vx = -nx * m; vy = -ny * m;   // look inward, so content swells at the edge like a lens
        const dot = nx * lx + ny * ly;
        light = Math.min(1, Math.pow(1 - t, 2.2) * (0.95 * Math.pow(Math.max(0, dot), 1.6) + 0.35 * Math.pow(Math.max(0, -dot), 2) + 0.12));
      }
      dimg.data[k] = 128 + vx * 127; dimg.data[k + 1] = 128 + vy * 127; dimg.data[k + 2] = 128; dimg.data[k + 3] = 255;
      simg.data[k] = simg.data[k + 1] = simg.data[k + 2] = 255;
      simg.data[k + 3] = Math.round(light * 255 * shine);
    }
  }
  dctx.putImageData(dimg, 0, 0);
  sctx.putImageData(simg, 0, 0);
  const filterId = `liquid-${mapCache.size}`;
  if (refracts()) addFilter(filterId, w, h, disp.toDataURL('image/png'), 2 * maxShift);
  const maps = { filterId, rim: spec.toDataURL('image/png') };
  mapCache.set(key, maps);
  return maps;
}

function addFilter(id: string, w: number, h: number, href: string, scale: number) {
  const ns = 'http://www.w3.org/2000/svg';
  let host = document.getElementById('liquid-filters');
  if (!host) {
    host = document.createElementNS(ns, 'svg') as unknown as HTMLElement;
    host.id = 'liquid-filters';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
    document.body.appendChild(host);
  }
  const f = document.createElementNS(ns, 'filter');
  const box = { x: '0', y: '0', width: String(w), height: String(h) };
  f.id = id;
  f.setAttribute('color-interpolation-filters', 'sRGB');
  f.setAttribute('filterUnits', 'userSpaceOnUse');
  f.setAttribute('primitiveUnits', 'userSpaceOnUse');
  for (const [k, v] of Object.entries(box)) f.setAttribute(k, v);
  const img = document.createElementNS(ns, 'feImage');
  img.setAttribute('result', 'map');
  img.setAttribute('preserveAspectRatio', 'none');
  for (const [k, v] of Object.entries(box)) img.setAttribute(k, v);
  img.setAttribute('href', href);
  const dm = document.createElementNS(ns, 'feDisplacementMap');
  dm.setAttribute('in', 'SourceGraphic');
  dm.setAttribute('in2', 'map');
  dm.setAttribute('xChannelSelector', 'R');
  dm.setAttribute('yChannelSelector', 'G');
  dm.setAttribute('scale', scale.toFixed(1));
  f.append(img, dm);
  host.appendChild(f);
}

// Real liquid, not frost: only enough blur to stop text behind fighting the labels. The bend does the work.
const REST = (tone: Tone) => (tone === 'light' ? 'blur(2px) saturate(170%)' : 'blur(2px) saturate(165%) brightness(1.04)');
const MOVING = (tone: Tone) => (tone === 'light' ? 'blur(3px) saturate(170%)' : 'blur(3px) saturate(165%) brightness(1.04)');

function inScroller(el: HTMLElement) {
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (/auto|scroll/.test(s.overflowY) || /auto|scroll/.test(s.overflowX)) return true;
  }
  return false;
}

/** Puts the bend and rim made for this element's size onto it (web). Safe to call again; maps are cached by size. */
export function applyBend(el: HTMLElement, { radius, bezel, thickness, tone, moving = false, floating = true }: { radius: number; bezel?: number; thickness?: number; tone: Tone; moving?: boolean; floating?: boolean }) {
  const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
  if (w < 8 || h < 8) return;
  const rim = bezel ?? Math.max(5, Math.min(16, h * 0.3));
  const maps = mapsFor(w, h, radius, rim, thickness ?? rim * 1.25, tone === 'light' ? 0.9 : 0.5);
  el.style.backgroundImage = moving ? 'none' : `url("${maps.rim}")`;
  el.style.backgroundSize = '100% 100%';
  el.style.backgroundRepeat = 'no-repeat';
  // Inside a scrolling page a control sits on a flat surface: it keeps its rim, and skipping the filter keeps scrolling smooth.
  if (reducedTransparency() || moreContrast() || (!floating && inScroller(el))) { el.style.backdropFilter = 'none'; el.style.setProperty('-webkit-backdrop-filter', 'none'); return; }
  const filter = moving || !refracts() ? MOVING(tone) : `url(#${maps.filterId}) ${REST(tone)}`;
  el.style.backdropFilter = filter;
  el.style.setProperty('-webkit-backdrop-filter', moving || !refracts() ? REST(tone) : filter);
}

type Shape = { radius: number; bezel?: number; thickness?: number; tone?: Tone; moving?: boolean; floating?: boolean };

/** Hook form of applyBend for a View: pass the returned ref to it. Rebuilds only when its size settles. */
export function useLiquidBend({ radius, bezel, thickness, tone, moving = false, floating = true }: Shape, shared?: React.RefObject<unknown>) {
  const own = useRef<unknown>(null);
  const ref = shared ?? own;
  const t: Tone = tone ?? (isLight() ? 'light' : 'dark');
  useEffect(() => {
    if (!web) return;
    const el = ref.current as HTMLElement | null;
    if (!el?.style || typeof ResizeObserver === 'undefined') return;
    const apply = () => applyBend(el, { radius, bezel, thickness, tone: t, moving, floating });
    apply();
    let timer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(apply, 160); });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, [ref, radius, bezel, thickness, t, moving, floating]);
  return ref;
}

// Reads what is painted under one point: an opaque background, a chart shape or a gradient. Pointer-less layers are skipped.
const channels = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
function paintedAt(x: number, y: number, self: HTMLElement) {
  let busy = false, first = true;
  for (const hit of document.elementsFromPoint(x, y)) {
    if (self.contains(hit)) continue;
    // a fading sheet backdrop or a hidden layer is not what is really behind the glass
    let seen = 1;
    for (let n: Element | null = hit; n && n !== document.body; n = n.parentElement) seen *= +getComputedStyle(n).opacity;
    if (seen < 0.6) continue;
    if (first) {
      first = false;
      busy = hit.tagName.toLowerCase() === 'text' || [...hit.childNodes].some((n) => n.nodeType === 3 && !!n.textContent?.trim());
    }
    const s = getComputedStyle(hit);
    let c = channels(s.backgroundColor);
    if (hit instanceof SVGElement && s.fill && s.fill !== 'none') c = channels(s.fill);
    if ((c.length < 4 || c[3] >= 0.5) && c.length >= 3) return { lum: (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255, busy };
    if (s.backgroundImage.includes('rgb')) {
      const g = channels(s.backgroundImage.match(/rgba?\([^)]*\)/)?.[0] ?? '');
      if (g.length >= 3) return { lum: (0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2]) / 255, busy };
    }
  }
  return { lum: isLight() ? 1 : 0, busy };
}

/** Small glass flips with its background and its shadow reacts to text. Large glass passes flip=false: shadow only. */
function useBackdrop(ref: React.RefObject<unknown>, flip: boolean, stacked: boolean) {
  const [look, setLook] = useState<{ tone: Tone; busy: boolean }>({ tone: isLight() ? 'light' : 'dark', busy: false });
  useEffect(() => {
    if (!web) return;
    const el = ref.current as unknown as HTMLElement | null;
    if (!el?.getBoundingClientRect) return;
    const read = () => {
      if (document.hidden) return;
      const b = el.getBoundingClientRect();
      if (!b.width) return;
      const samples = [0.2, 0.5, 0.8].map((f) => paintedAt(b.left + b.width * f, b.top + b.height / 2, stacked && el.parentElement ? el.parentElement : el));
      const lum = samples.reduce((a, s) => a + s.lum, 0) / samples.length;
      const busy = samples.some((s) => s.busy);
      setLook((prev) => {
        // two thresholds, so it cannot flicker when the background sits between them
        const tone: Tone = !flip ? prev.tone : prev.tone === 'light' ? (lum < 0.35 ? 'dark' : 'light') : (lum > 0.6 ? 'light' : 'dark');
        return tone === prev.tone && busy === prev.busy ? prev : { tone, busy };
      });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { timer ??= setTimeout(() => { timer = undefined; read(); }, 110); };
    window.addEventListener('scroll', soon, { capture: true, passive: true });
    window.addEventListener('resize', soon);
    const slow = setInterval(read, 1200);   // catches page changes and a moving chart without per-frame work
    read();
    return () => {
      window.removeEventListener('scroll', soon, { capture: true });
      window.removeEventListener('resize', soon);
      clearInterval(slow);
      clearTimeout(timer);
    };
  }, [ref, flip, stacked]);
  return look;
}

// A soft light inside the glass that starts at the pointer or finger.
function useGlow(ref: React.RefObject<unknown>, on: boolean | 'touch', tone: Tone, stacked: boolean) {
  useEffect(() => {
    if (!web || !on) return;
    const el = ref.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    const glow = document.createElement('div');
    glow.setAttribute('aria-hidden', 'true');
    const color = tone === 'light' ? 'rgba(110,110,125,0.20)' : 'rgba(255,255,255,0.16)';
    glow.style.cssText = `position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity 200ms ease-out;background:radial-gradient(circle 110px at var(--gx,50%) var(--gy,50%),${color},transparent 70%)`;
    el.insertBefore(glow, el.firstChild);
    let down = false;
    const at = (e: PointerEvent) => {
      if (e.type === 'pointerdown') down = true;
      if (on === 'touch' && !down) return;   // light only under a press, never from a mouse passing over
      const b = el.getBoundingClientRect();
      glow.style.setProperty('--gx', `${e.clientX - b.left}px`);
      glow.style.setProperty('--gy', `${e.clientY - b.top}px`);
      glow.style.opacity = '1';
    };
    const off = () => { down = false; glow.style.opacity = '0'; };
    const host = stacked && el.parentElement ? el.parentElement : el;   // icons sit above the glass, so listen on the stack
    const up = (e: PointerEvent) => { if (on === 'touch' || e.pointerType !== 'mouse') off(); };
    host.addEventListener('pointermove', at);
    host.addEventListener('pointerdown', at);
    host.addEventListener('pointerleave', off);
    host.addEventListener('pointerup', up);
    return () => {
      host.removeEventListener('pointermove', at);
      host.removeEventListener('pointerdown', at);
      host.removeEventListener('pointerleave', off);
      host.removeEventListener('pointerup', up);
      glow.remove();
    };
  }, [ref, on, tone, stacked]);
}

// Checked once. isGlassEffectAPIAvailable guards the iOS 26 betas that lack the API and can crash.
const appleGlass = Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
const AnimatedGlass = Animated.createAnimatedComponent(GlassView);

export type GlassInk = { tone: Tone; text: string; muted: string; accent: string };
const INK: Record<Tone, Omit<GlassInk, 'tone'>> = {
  // one shade stronger than the page's second text: these sit on near-clear glass over changing content
  light: { text: '#1D1D1F', muted: '#3A3A3C', accent: '#5B2EFF' },
  dark: { text: '#FFFFFF', muted: '#E5E5EA', accent: '#C4B5FF' },
};
const InkContext = createContext<GlassInk | null>(null);
/** Colours for icons and labels on glass: they flip with the glass. Falls back to the theme outside a LiquidView. */
export function useGlassInk(): GlassInk {
  return useContext(InkContext) ?? { tone: isLight() ? 'light' : 'dark', text: colors.text, muted: colors.muted, accent: colors.accent };
}

type LiquidProps = ViewProps & {
  children: ReactNode;
  radius: number;
  flip?: boolean;     // small floating controls flip light/dark; large panels never do
  glow?: boolean | 'touch';
  animated?: boolean;   // the style holds animated values
  moving?: boolean;   // light filter while it moves
  bezel?: number;
  thickness?: number;
  style?: StyleProp<ViewStyle>;
  overlay?: ReactNode;   // drawn beside the glass, not inside it: glass inside glass cannot bend what is behind (a selected drop)
};

export function LiquidView({ children, radius, flip = false, glow = true, moving = false, bezel, thickness, style, overlay, animated = false, ...rest }: LiquidProps) {
  const ref0 = useRef<unknown>(null);
  const stacked = overlay !== undefined;
  const { tone, busy } = useBackdrop(ref0, flip, stacked);
  useLiquidBend({ radius, bezel, thickness, tone, moving }, ref0);
  useGlow(ref0, glow, tone, stacked);
  const ink: GlassInk = { tone, ...INK[tone] };
  const Body = (animated ? Animated.View : View) as typeof View;
  if (appleGlass) {
    const AppleBody = (animated ? AnimatedGlass : GlassView) as typeof GlassView;
    return (
      <InkContext.Provider value={ink}>
        <AppleBody {...rest} glassEffectStyle="regular" isInteractive colorScheme={isLight() ? 'light' : 'dark'} style={[{ borderRadius: radius }, style]}>
          {children}
        </AppleBody>
        {overlay}
      </InkContext.Provider>
    );
  }
  return (
    <InkContext.Provider value={ink}>
      <Body {...rest} ref={ref0 as never} style={[glass('regular', { tone, busy, bent: true }), style]}
        {...(web ? ({ dataSet: { glassInk: tone, glassBody: '1' } } as object) : null)}>
        {children}
      </Body>
      {overlay}
    </InkContext.Provider>
  );
}

/** The layer above the glass and the selected drop, so icons and labels stay sharp and get a soft halo. */
export function InkLayer({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { tone } = useGlassInk();
  return <View pointerEvents="box-none" style={style} {...(web ? ({ dataSet: { glassInk: tone } } as object) : null)}>{children}</View>;
}

/** An icon or label inside a LiquidView: it flips with the glass. */
export function InkIcon({ icon: Icon, size, color }: { icon: LucideIcon; size: number; color?: string }) {
  const ink = useGlassInk();
  return <Icon size={size} color={color ?? ink.text} />;
}
export function InkText({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const ink = useGlassInk();
  return <Txt style={[{ color: ink.text }, style]}>{children}</Txt>;
}

/** A plain glass box for controls that are not buttons (groups, steppers, input boxes): same liquid as LiquidView, no flip or glow. */
export function LiquidBox({ children, radius, shadow = false, style, ...rest }: ViewProps & { radius: number; shadow?: boolean; children?: ReactNode }) {
  const bend = useLiquidBend({ radius, floating: false });
  return <View {...rest} ref={bend as never} style={[glass('regular', { shadow }), style]}>{children}</View>;
}
