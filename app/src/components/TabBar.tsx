// Main navigation, all three forms on the liquid glass layer:
//   phone (< 768 px)     floating pill over the content, labels under icons. Scrolling down parts it in the middle: the
//                        selected page's lens becomes a round drop and the other four icons squeeze into a capsule. They
//                        part like water: one body with a bridge that thins until it is gone, and nothing is left between
//                        them (owner 2026-11-06). At rest they sit apart with a clear space.
//                        The drop goes to the side its page belongs to: Home and Trades left, Market and Help right, and
//                        Terminal takes turns, one time left, the next right (owner 2026-11-07).
//                        Scrolling up, the top of the page or a tap pours it back into one pill (owner 2026-11-05).
//   tablet (768-1023 px) floating capsule rail on the left, labels under icons
//   desktop (>= 1024 px) the same rail; items open a panel beside the chart, which always stays on screen
// Navigation has no hover effects, and a tap does not shake or squash anything (owner 2026-11-06): the selection simply glides
// to the new item, and can be dragged along the pill to change page. The phone pill flips
// light/dark with what is behind it; the rail is a large surface, so it adapts its shadow but never flips.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, PanResponder, Platform, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { router, usePathname } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpDown, ChartCandlestick, CircleHelp, LayoutGrid, Store, Trophy } from 'lucide-react-native';
import { api } from '@/lib/api';
import { RAIL_W, SIDEBAR_W, useLayout } from '@/hooks/useLayout';
import { colors, font, type, createStyles } from '@/theme';
import { glassLens, MOTION } from '@/ui/glass';
import { InkLayer, LiquidView, useGlassInk, useLiquidBend } from '@/ui/liquid';
import { useTradeCounts } from '@/hooks/useCounts';
import { CountBadge } from '@/ui/kit';
import { Logo } from '@/ui/Logo';
import { Press, prefersReducedMotion } from '@/ui/Press';
import { Txt } from '@/ui/Txt';

const TABS: Record<string, { label: string; Icon: typeof LayoutGrid }> = {
  index: { label: 'Home', Icon: LayoutGrid },
  trades: { label: 'Trades', Icon: ArrowUpDown },
  terminal: { label: 'Terminal', Icon: ChartCandlestick },
  market: { label: 'Market', Icon: Store },
  funded: { label: 'Funded', Icon: Trophy },
  help: { label: 'Help', Icon: CircleHelp },
};

const PILL_H = 64;         // phone bar height
const PILL_TOP = 6, PILL_BOTTOM_MIN = 10;
const SMALL_H = 54;        // the two drops' height; every item keeps a 44 px target
const SMALL_ITEM = 46;
const NECK_GAP = 18;       // the clear space between the pieces at rest; the liquid crosses it only while moving
const native = false;      // the drops change size, so all of this bar's motion runs on the JS driver
const GLIDE = Easing.bezier(0.32, 0.72, 0, 1);
const NO_BROWSER_GESTURE = (Platform.OS === 'web' ? { touchAction: 'none' } : {}) as object;   // or a sideways drag becomes the browser's own back swipe
const LIQUID = Easing.bezier(0.3, 1.28, 0.4, 1);   // a slight overrun, like liquid settling
const PART = Easing.bezier(0.33, 0, 0.2, 1);        // settling and pouring back: no sudden starts or stops

const MAIN_PATHS = ['/', '/trades', '/terminal', '/market', '/help'];   // pages that show the phone pill
const DROP_RIGHT = ['market', 'help'];   // the other pages part to the left; Terminal takes turns
const TAKES_TURNS = 'terminal';
// Phone: the pill floats over the screen, so tab screens add this much room at the bottom of their content.
const TabSpace = createContext(0);
export const useTabBarSpace = () => useContext(TabSpace);
export function TabSpaceProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { isPhone } = useLayout();
  const pathname = usePathname();
  return <TabSpace.Provider value={isPhone && MAIN_PATHS.includes(pathname) ? PILL_TOP + PILL_H + Math.max(insets.bottom, PILL_BOTTOM_MIN) : 0}>{children}</TabSpace.Provider>;
}
const INSET = 5;           // lens inset inside the bar (same on every side: concentric)
const RAIL_ITEM = 62;      // tablet rail item height
const SIDE_ITEM = 48;      // desktop sidebar item height

// Parting on scroll follows the finger: progress is distance scrolled, not time. When scrolling stops part-way it settles
// gently in the direction it was going. Taps and page changes pour it back on a short timer.
const SCROLL_TRAVEL = 170;   // px of scrolling from one pill to two pieces
const JOIN_MS = 720;         // pouring back into one pill
// The stage where water stretches or joins always gets its time, however fast the page is flicked: otherwise it passes in a few
// frames and only two buttons are ever seen. These match STRAIN_FROM and STRAIN_TO below.
const WATER_FROM = 0.62, WATER_TO = 0.97, WATER_MS = 520;
let lastScrollAt = 0, goal = 0;
const navCollapse = new Animated.Value(0);
const movingListeners = new Set<(moving: boolean) => void>();
let progress = 0, lastY = 0, lastDir = 0, moving = false;
let settleTimer: ReturnType<typeof setTimeout> | undefined, restTimer: ReturnType<typeof setTimeout> | undefined;
navCollapse.addListener(({ value }) => { progress = value; });
const setMovingFlag = (on: boolean) => {
  clearTimeout(restTimer);
  if (on) { if (!moving) { moving = true; movingListeners.forEach((l) => l(true)); } return; }
  // a moment after it stops, so the full bend does not switch on between frames of a slow scroll
  restTimer = setTimeout(() => { moving = false; movingListeners.forEach((l) => l(false)); }, 180);
};
function animateTo(target: number, duration: number) {
  setMovingFlag(true);
  // however little is left, a stretch through the water stage takes its full time
  const a = Math.min(progress, target), b = Math.max(progress, target);
  const water = Math.max(0, Math.min(b, WATER_TO) - Math.max(a, WATER_FROM));
  duration = Math.max(duration, Math.round((water * WATER_MS) / (WATER_TO - WATER_FROM)) + 120);
  Animated.timing(navCollapse, { toValue: target, duration: prefersReducedMotion() ? 0 : duration, easing: PART, useNativeDriver: native })
    .start(({ finished }) => { if (finished) setMovingFlag(false); });
}
function setCollapsed(next: boolean) {
  clearTimeout(settleTimer);
  if (next ? progress === 1 : progress === 0) return;
  if (next && prefersReducedMotion()) return;
  animateTo(next ? 1 : 0, next ? 420 : JOIN_MS);   // joining takes longer: the bridge has to be seen forming
}
/** Pages pass this to their vertical scroller (see ui/Page.tsx). */
export function onNavScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
  const y = e.nativeEvent.contentOffset.y, dy = y - lastY;
  lastY = y;
  if (prefersReducedMotion() || dy === 0) return;
  lastDir = Math.sign(dy);
  navCollapse.stopAnimation();
  setMovingFlag(true);
  // near the top it can never stay parted, so the top of the page is always the full pill
  const at = Date.now(), gapMs = at - lastScrollAt;
  lastScrollAt = at;
  // where the scroll is really heading, kept apart from what is shown, which may be held back
  if (gapMs > 400) goal = progress;
  goal = Math.min(Math.max(0, Math.min(1, goal + dy / SCROLL_TRAVEL)), Math.max(0, y) / 40);
  // inside the water stage it moves no faster than water would; a pause counts as one frame, not as a licence to jump
  const limit = ((WATER_TO - WATER_FROM) * Math.max(8, Math.min(48, gapMs))) / WATER_MS;
  const inWater = Math.max(progress, goal) > WATER_FROM && Math.min(progress, goal) < WATER_TO;
  const next = inWater ? progress + Math.max(-limit, Math.min(limit, goal - progress)) : goal;
  navCollapse.setValue(next);
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    if (progress === 0 || progress === 1) { setMovingFlag(false); return; }
    // settles by where the scroll was heading: what is shown may still be held back in the water stage
    animateTo(lastDir > 0 ? (goal > 0.12 ? 1 : 0) : (goal < 0.88 ? 0 : 1), 300);
  }, 140);
}

// Glides the lens to `index` on the deceleration curve, stretching on the way; first placement is instant.
function useGlide(index: number) {
  const [v] = useState(() => new Animated.Value(index));
  const [stretch] = useState(() => new Animated.Value(0));
  const [gliding, setGliding] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; v.setValue(index); return; }
    setGliding(true);
    Animated.timing(v, { toValue: index, duration: MOTION.glideMs, easing: GLIDE, useNativeDriver: native }).start(() => setGliding(false));
    if (prefersReducedMotion()) return;
    Animated.sequence([
      Animated.timing(stretch, { toValue: 1, duration: MOTION.glideMs * 0.35, easing: Easing.out(Easing.quad), useNativeDriver: native }),
      Animated.timing(stretch, { toValue: 0, duration: MOTION.glideMs * 0.65, easing: GLIDE, useNativeDriver: native }),
    ]).start();
  }, [index, v, stretch]);
  return { v, stretch, gliding };
}

// The selected item's lens takes its tone from the glass it sits in.
function Lens({ style, radius, moving, drop }: { style: object; radius: number; moving: boolean; drop?: Animated.AnimatedInterpolation<number> }) {
  const { tone } = useGlassInk();
  const bend = useLiquidBend({ radius, bezel: Math.min(radius, 14), thickness: 15, tone, moving });
  return (
    <Animated.View ref={bend as never} testID="nav-drop" pointerEvents="none" style={[styles.lens, glassLens(tone), style]}>
      {drop ? <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: radius * 2, opacity: drop, backgroundColor: tone === 'light' ? 'rgba(255,255,255,0.62)' : 'rgba(24,24,28,0.25)' }} /> : null}
    </Animated.View>
  );
}

// The pieces pull apart, like a tug of war. Through the strain stretch of the scroll the gap grows only to STRAIN_GAP while they
// lean toward each other and the bridge thins. Then it is gone and they ease apart. Pouring back, the bridge forms again as they
// pull together.
const STRAIN_GAP = 13;  // the most the gap opens while the bridge still holds
const LEAN = 1.5;       // how far each piece leans toward the other at full strain
const STRAIN_FROM = 0.62, STRAIN_TO = 0.97;   // the share of the scroll spent straining (about 60 px)
// The liquid bridge between two round ends, the standard metaball construction: each side leaves its circle along a tangent, so
// there is never a kink, and the handles shrink as the circles close so it never twists. Pinch-off comes from the attachment
// points sliding toward the middle line as the strain rises, which is how a water bridge really narrows before it breaks.
function metaball(x1: number, x2: number, y: number, r1: number, r2: number, strain: number) {
  const d = x2 - x1;
  const v = 0.86 - 0.76 * Math.pow(strain, 0.8);   // how far from the middle line it attaches
  const overlap = d < r1 + r2;
  const u1 = overlap ? Math.acos(Math.max(-1, Math.min(1, (r1 * r1 + d * d - r2 * r2) / (2 * r1 * d)))) : 0;
  const u2 = overlap ? Math.acos(Math.max(-1, Math.min(1, (r2 * r2 + d * d - r1 * r1) / (2 * r2 * d)))) : 0;
  const reach = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
  const a1 = u1 + (reach - u1) * v;                       // angle on the left circle, from the line between centres
  const a2 = Math.PI - u2 - (Math.PI - u2 - reach) * v;   // angle on the right circle
  const on = (cx: number, r: number, a: number) => [cx + r * Math.cos(a), y + r * Math.sin(a)];
  const [ax, ay] = on(x1, r1, a1), [bx, by] = on(x2, r2, a2);
  const span = Math.hypot(bx - ax, by - ay), total = r1 + r2;
  const k = Math.min(0.5 * 2.4, span / total) * Math.min(1, (d * 2) / total);
  // handles run along each circle's tangent, toward the middle
  const h1x = ax + r1 * k * Math.cos(a1 - Math.PI / 2), h1y = ay + r1 * k * Math.sin(a1 - Math.PI / 2);
  const h2x = bx + r2 * k * Math.cos(a2 + Math.PI / 2), h2y = by + r2 * k * Math.sin(a2 + Math.PI / 2);
  const n = (v2: number) => v2.toFixed(2);
  const ly = (v2: number) => n(2 * y - v2);   // the upper edge mirrors the lower one
  const lower = `M${n(ax)} ${n(ay)} C${n(h1x)} ${n(h1y)} ${n(h2x)} ${n(h2y)} ${n(bx)} ${n(by)}`;
  const upper = `M${n(ax)} ${ly(ay)} C${n(h1x)} ${ly(h1y)} ${n(h2x)} ${ly(h2y)} ${n(bx)} ${ly(by)}`;
  // closed straight across each piece, so it covers the stretch of rim between the attachment points: water has no wall inside it
  const body = `${lower} L${n(bx)} ${ly(by)} C${n(h2x)} ${ly(h2y)} ${n(h1x)} ${ly(h1y)} ${n(ax)} ${ly(ay)} Z`;
  return { body, upper, lower, from: ax, to: bx };
}

function partingCurve(slot: number, index: number, startX: number, capsuleX: number) {
  const gapAt = (c: number) => capsuleX * c - ((INSET + index * slot) * (1 - c) + startX * c + slot * (1 - c) + SMALL_H * c);
  const g0 = gapAt(0), g1 = gapAt(1);
  const cOf = (g: number) => Math.min(0.999, (g - g0) / (g1 - g0));
  return { cA: cOf(0), cC: cOf(STRAIN_GAP) };
}
const EASE = { toValue: 0, duration: 340, easing: PART, useNativeDriver: native };   // settles once, with no bounce
type NeckProps = { width: number; slot: number; index: number; startX: number; capsuleX: number; snap: Animated.Value; curve: { cA: number; cC: number }; mirrored: boolean };
// Worked out as if the drop were on the left. With the drop on the right the same shape is drawn mirrored.
function Neck({ width, slot, index, startX, capsuleX, snap, curve, mirrored }: NeckProps) {
  const { tone } = useGlassInk();
  const light = tone === 'light';
  const [shape, setShape] = useState<ReturnType<typeof metaball> | null>(null);
  const lastC = useRef(0);
  useEffect(() => {
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const { cA, cC } = curve;
    const id = navCollapse.addListener(({ value: raw }) => {
      // parting: when the bridge gives way they ease apart. Joining: the moment they touch, surface tension draws them in.
      if (lastC.current < STRAIN_TO && raw >= STRAIN_TO && !prefersReducedMotion()) {
        snap.setValue(0.6);
        Animated.timing(snap, EASE).start();
      }
      if (lastC.current > STRAIN_TO && raw <= STRAIN_TO && !prefersReducedMotion()) {
        snap.setValue(-0.6);
        Animated.timing(snap, EASE).start();
      }
      lastC.current = raw;
      if (raw <= STRAIN_FROM || raw >= STRAIN_TO) { setShape(null); return; }
      const strain = (raw - STRAIN_FROM) / (STRAIN_TO - STRAIN_FROM);
      const c = cA + (cC - cA) * strain;
      const lensRight = lerp(INSET + index * slot, startX, c) + lerp(slot, SMALL_H, c) + LEAN * strain;
      const capLeft = lerp(0, capsuleX, c) - LEAN * strain;
      const cy = PILL_H - lerp(PILL_H / 2, SMALL_H / 2, c);
      setShape(metaball(lensRight - SMALL_H / 2, capLeft + lerp(PILL_H, SMALL_H, c) / 2, cy, SMALL_H / 2, lerp(PILL_H, SMALL_H, c) / 2, strain));
    });
    return () => navCollapse.removeListener(id);
  }, [slot, index, startX, capsuleX, snap, curve]);
  // as solid as the glass on each side, so the bridge covers both rims and the two pieces read as one body
  const lit = light ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.32)';
  const shade = light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.14)';
  // the bridge carries the drop's body into the capsule's, fading at each end so no edge shows where it meets them
  const dropTone = light ? '#f4f4f7' : '#3a3a40';
  const capsuleTone = light ? '#f7f7f9' : '#17171a';
  return (
      <View testID="nav-neck" pointerEvents="none" style={{ position: 'absolute', left: 0, bottom: 0, width, height: PILL_H, opacity: shape ? 1 : 0, transform: mirrored ? [{ scaleX: -1 }] : undefined }}>
        {shape ? (
          <>
            {Platform.OS === 'web' ? <View style={{ position: 'absolute', left: 0, top: 0, width, height: PILL_H, clipPath: `path('${shape.body}')`, backdropFilter: 'blur(3px) saturate(170%)', WebkitBackdropFilter: 'blur(3px) saturate(170%)' } as object} /> : null}
            <Svg width={width} height={PILL_H} style={{ position: 'absolute', left: 0, top: 0 }}>
              <Defs>
                <LinearGradient id="navWater" gradientUnits="userSpaceOnUse" x1={shape.from} y1={0} x2={shape.to} y2={0}>
                  <Stop offset="0" stopColor={dropTone} stopOpacity={0.2} />
                  <Stop offset="0.3" stopColor={dropTone} stopOpacity={0.97} />
                  <Stop offset="0.7" stopColor={capsuleTone} stopOpacity={0.97} />
                  <Stop offset="1" stopColor={capsuleTone} stopOpacity={0.2} />
                </LinearGradient>
              </Defs>
              <Path d={shape.body} fill="url(#navWater)" />
              <Path d={shape.upper} fill="none" stroke={lit} strokeWidth={1} />
              <Path d={shape.lower} fill="none" stroke={shade} strokeWidth={0.75} />
            </Svg>
          </>
        ) : null}
      </View>
  );
}

function TradesCount() {
  return <CountBadge testID="trades-count" count={useTradeCounts().total} />;
}

function TabItem({ label, Icon, active, layout, onPress, style }: {
  label: string; Icon: typeof LayoutGrid; active: boolean; layout: 'bar' | 'rail' | 'side'; onPress: () => void; style?: object;
}) {
  const ink = useGlassInk();
  const shrinks = layout === 'bar';
  return (
    <Press onPress={onPress} haptic={false} hoverable={false} still accessibilityRole="tab" accessibilityState={{ selected: active }} aria-selected={active} accessibilityLabel={label}
      style={[layout === 'bar' ? styles.barItem : layout === 'rail' ? styles.railItem : styles.sideItem, style]}>
      <Animated.View style={shrinks ? { opacity: active ? 1 : navCollapse.interpolate({ inputRange: [0, 0.14, 0.82, 1], outputRange: [1, 0.22, 0.22, 1], extrapolate: 'clamp' }), transform: [{ translateY: navCollapse.interpolate({ inputRange: [0, 1], outputRange: [0, 8] }) }] } : undefined}>
        <Icon size={layout === 'side' ? 20 : 22} color={active ? ink.accent : ink.muted} strokeWidth={active ? 2.25 : 1.9} />
        {label === 'Trades' ? <TradesCount /> : null}
      </Animated.View>
      {/* labels only appear once each item is nearly home, so they never slide across each other */}
      <Animated.View style={shrinks ? { opacity: navCollapse.interpolate({ inputRange: [0, 0.16], outputRange: [1, 0], extrapolate: 'clamp' }) } : undefined}>
        <Txt style={layout === 'side'
          ? { fontSize: 15, fontFamily: font.semibold, color: active ? ink.text : ink.muted }
          : [type.tabLabel, { color: active ? ink.text : ink.muted, fontFamily: font.semibold }]}>
          {label}
        </Txt>
      </Animated.View>
    </Press>
  );
}

export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { isDesktop, isTablet } = useLayout();
  // real number of people connected right now (live price connections), refreshed every 15 s
  const onlineQ = useQuery({ queryKey: ['online'], queryFn: () => api<{ online: number }>('/online'), refetchInterval: 15000, enabled: isDesktop || isTablet });
  const online = onlineQ.data?.online ?? null;
  // phone: the five main tabs; tablet: those plus Funded; desktop: no Terminal item, the chart is always there
  const routes = state.routes.filter((r) => TABS[r.name] && !(r.name === 'funded' && !isDesktop && !isTablet) && !(r.name === 'terminal' && isDesktop));
  const activeIdx = routes.findIndex((r) => r.key === state.routes[state.index]?.key);   // -1: nothing selected
  const { v: glide, stretch, gliding } = useGlide(Math.max(0, activeIdx));
  const [barW, setBarW] = useState(0);
  const [railBox, setRailBox] = useState<{ x: number; y: number; w: number } | null>(null);
  const [isMoving, setMoving] = useState(false);
  const [lift] = useState(() => new Animated.Value(0));
  const [snap] = useState(() => new Animated.Value(0));  // the ease when the water bridge gives way or first touches

  useEffect(() => { movingListeners.add(setMoving); return () => { movingListeners.delete(setMoving); }; }, []);
  useEffect(() => { lastY = 0; setCollapsed(false); }, [activeIdx]);   // a new page starts with the full pill

  // Which side the drop goes to. It only ever changes while the pill is whole, where the side makes no visible difference, so nothing jumps.
  const activeName = routes[activeIdx]?.name;
  const [turnRight, setTurnRight] = useState(false);
  const wantRight = activeName === TAKES_TURNS ? turnRight : DROP_RIGHT.includes(activeName ?? '');
  const [dropRight, setDropRight] = useState(wantRight);
  const side = useRef({ wantRight, activeName, parted: false });
  side.current.wantRight = wantRight;
  side.current.activeName = activeName;
  useEffect(() => { if (progress === 0) setDropRight(wantRight); }, [wantRight]);
  useEffect(() => {
    const id = navCollapse.addListener(({ value }) => {
      if (value > 0.5) side.current.parted = true;
      if (value !== 0) return;
      if (side.current.parted && side.current.activeName === TAKES_TURNS) setTurnRight((r) => !r);   // whole again: the next time it goes the other way
      side.current.parted = false;
      setDropRight(side.current.wantRight);
    });
    return () => navCollapse.removeListener(id);
  }, []);

  const press = (key: string, active: boolean) => {
    const e = emitter.emit({ type: 'tabPress', target: key, canPreventDefault: true });
    setCollapsed(false);
    if (active && isDesktop) { router.navigate('/terminal'); return; }   // the open item again closes its panel
    if (!active && !e.defaultPrevented) navigateToTab(key);
  };
  const slot = barW > 0 ? (barW - INSET * 2) / Math.max(1, routes.length) : 0;

  // Hold the pill and slide along it: the lens follows the finger, and letting go opens the page under it.
  const drag = useRef({ activeIdx, slot, count: routes.length, go: (_i: number) => {} });
  useEffect(() => {
    drag.current = { activeIdx, slot, count: routes.length, go: (i) => { const r = routes[i]; if (r) press(r.key, i === activeIdx); } };
  });
  const [pan] = useState(() => {
    let head = 0;   // distance moved before the drag took over
    const settle = (dx: number) => {
      const d = drag.current;
      Animated.timing(lift, { toValue: 0, duration: 200, useNativeDriver: native }).start();
      setMoving(false);
      const target = Math.max(0, Math.min(d.count - 1, Math.round(d.activeIdx + (d.slot ? dx / d.slot : 0))));
      if (target !== d.activeIdx) d.go(target);
      else Animated.timing(glide, { toValue: d.activeIdx, duration: 260, easing: GLIDE, useNativeDriver: native }).start();
    };
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => {
        const take = Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy);
        if (take) head = g.dx;
        return take;
      },
      onPanResponderGrant: () => {
        setCollapsed(false);   // dragging always happens on the full pill
        setMoving(true);
        if (!prefersReducedMotion()) Animated.timing(lift, { toValue: 1, duration: 160, useNativeDriver: native }).start();
      },
      onPanResponderMove: (_, g) => {
        const d = drag.current;
        glide.setValue(Math.max(0, Math.min(d.count - 1, d.activeIdx + (d.slot ? (head + g.dx) / d.slot : 0))));
      },
      onPanResponderRelease: (_, g) => settle(head + g.dx),
      onPanResponderTerminate: () => settle(0),
    });
  });

  if (isDesktop || isTablet) {
    const rail = true;   // tablet and desktop both use the slim rail (owner reference, 2026-10-30)
    const itemH = rail ? RAIL_ITEM : SIDE_ITEM;
    const y = glide.interpolate({ inputRange: [0, Math.max(1, routes.length - 1)], outputRange: [0, Math.max(1, routes.length - 1) * (itemH + 6)] });
    return (
      <View style={{ width: rail ? RAIL_W : SIDEBAR_W, height: '100%', backgroundColor: colors.bg, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 10, paddingLeft: 10, paddingRight: rail ? 6 : 10 }}>
        {/* three layers: empty glass, the selected drop that bends what is behind, then sharp icons and labels */}
        <LiquidView radius={26} glow="touch" style={{ flex: 1, borderRadius: 26 }} overlay={(
          <>
            {activeIdx >= 0 && railBox ? <Lens radius={rail ? 18 : 14} moving={gliding} style={{ left: 10 + railBox.x, width: railBox.w, top: insets.top + 10 + railBox.y, height: itemH, borderRadius: rail ? 18 : 14, transform: [{ translateY: y }, { scaleY: stretch.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) }] }} /> : null}
            <InkLayer style={[styles.panel, { position: 'absolute', left: 10, right: rail ? 6 : 10, top: insets.top + 10, bottom: insets.bottom + 10 }, rail ? { alignItems: 'center', paddingHorizontal: 6 } : { paddingHorizontal: 12 }]}>
              <View style={rail ? { alignItems: 'center', marginBottom: 22 } : styles.brand}>
                <Logo size={rail ? 36 : 32} />
                {rail ? null : <Txt style={{ fontSize: 17, fontFamily: font.bold, letterSpacing: -0.3 }}>Oliskey Alpha</Txt>}
              </View>
              <View style={{ gap: 6, alignSelf: 'stretch' }} onLayout={(e) => { const { x: bx, y: by, width } = e.nativeEvent.layout; setRailBox((o) => (o && o.x === bx && o.y === by && o.w === width ? o : { x: bx, y: by, w: width })); }}>
                {routes.map((r, i) => <TabItem key={r.key} label={TABS[r.name].label} Icon={TABS[r.name].Icon} active={i === activeIdx} layout={rail ? 'rail' : 'side'} onPress={() => press(r.key, i === activeIdx)} />)}
              </View>
              <View style={{ flex: 1 }} />
              {online != null ? (
                <View style={{ alignItems: 'center' }} accessibilityLabel={`${online} people online`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.up }} />
                    <Txt style={{ fontSize: 14, fontFamily: font.bold, fontVariant: ['tabular-nums'] }}>{online.toLocaleString()}</Txt>
                  </View>
                  <Txt style={{ fontSize: 11, color: colors.muted }}>online</Txt>
                </View>
              ) : null}
            </InkLayer>
          </>
        )}>
          {null}
        </LiquidView>
      </View>
    );
  }

  // phone: floating glass pill over the content, no background behind it (owner decisions 2026-10-30: locked)
  if (activeIdx < 0) return null;   // secondary pages (profile, withdraw, ...) are full screen with a back arrow

  // Where everything ends up when parted: the drop, the neck, then the capsule of the other items, centred together.
  const others = routes.length - 1;
  const capsuleW = SMALL_ITEM * others + INSET * 2;
  const margin = (barW - (SMALL_H + NECK_GAP + capsuleW)) / 2;
  const startX = dropRight ? margin + capsuleW + NECK_GAP : margin;       // the drop
  const capsuleX = dropRight ? margin : margin + SMALL_H + NECK_GAP;      // the capsule
  const toward = dropRight ? -1 : 1;                                      // the direction from the drop to the capsule
  // the bridge is worked out as if the drop were on the left: the same page counted from the other end
  const leftIndex = dropRight ? routes.length - 1 - activeIdx : activeIdx;
  const leftCapsuleX = margin + SMALL_H + NECK_GAP;
  const curve = partingCurve(slot, leftIndex, margin, leftCapsuleX);
  const raw = navCollapse;
  const c = raw.interpolate({ inputRange: [0, STRAIN_FROM, STRAIN_TO, 1], outputRange: [0, curve.cA, curve.cC, 1] });
  const mix = (from: number, to: number) => c.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
  // leaning toward each other under strain, then thrown apart by the snap
  const lean = raw.interpolate({ inputRange: [STRAIN_FROM, STRAIN_TO, STRAIN_TO + 0.0001], outputRange: [0, LEAN, 0], extrapolate: 'clamp' });
  const kick = snap.interpolate({ inputRange: [-1, 1], outputRange: [-5, 5] });
  const pieceDrop = Animated.multiply(Animated.add(lean, Animated.multiply(kick, -1)), toward);     // the round drop
  const pieceCapsule = Animated.multiply(Animated.add(Animated.multiply(lean, -1), kick), toward);  // the capsule and its icons
  const lensX = Animated.add(pieceDrop, Animated.add(
    Animated.multiply(Animated.add(INSET, Animated.multiply(glide, slot)), c.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })),
    Animated.multiply(startX, c),
  ));
  const stretched = Animated.add(stretch.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }), lift.interpolate({ inputRange: [0, 1], outputRange: [0, 0.08] }));
  const itemLeftAtRest = (i: number) => {
    const rank = i < activeIdx ? i : i - 1;
    return i === activeIdx ? startX + (SMALL_H - SMALL_ITEM) / 2 : capsuleX + INSET + rank * SMALL_ITEM;
  };
  const itemStyle = (i: number) => {
    return {
      position: 'absolute',
      ...NO_BROWSER_GESTURE,
      left: Animated.add(mix(INSET + i * slot, itemLeftAtRest(i)), i === activeIdx ? pieceDrop : pieceCapsule),
      width: mix(slot, SMALL_ITEM),
      bottom: mix(INSET, (SMALL_H - 44) / 2),
      height: mix(PILL_H - INSET * 2, 44),
    };
  };
  return (
    <View pointerEvents="box-none" onLayout={(e) => setBarW(e.nativeEvent.layout.width - 24)} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: PILL_TOP, paddingBottom: Math.max(insets.bottom, PILL_BOTTOM_MIN) }}>
      <Animated.View {...pan.panHandlers} pointerEvents="box-none" style={{ height: PILL_H }}>
        {barW > 0 ? (
          <LiquidView radius={PILL_H / 2} flip glow="touch" moving={isMoving} style={{ position: 'absolute', borderRadius: PILL_H / 2, bottom: 0, ...NO_BROWSER_GESTURE, left: Animated.add(mix(0, capsuleX), pieceCapsule), width: mix(barW, capsuleW), height: mix(PILL_H, SMALL_H), transform: [{ scaleY: snap.interpolate({ inputRange: [-1, 1], outputRange: [0.97, 1.03] }) }] } as never} animated overlay={(
            <>
              <Lens radius={(SMALL_H - INSET * 2) / 2} moving={isMoving || gliding} drop={c} style={{
                left: 0, bottom: mix(INSET, 0), width: mix(slot, SMALL_H), height: mix(PILL_H - INSET * 2, SMALL_H), borderRadius: PILL_H / 2,
                transform: [{ translateX: lensX }, { scaleX: Animated.add(Animated.add(stretched, lean.interpolate({ inputRange: [0, LEAN], outputRange: [0, 0.05] })), snap.interpolate({ inputRange: [-1, 1], outputRange: [0.05, -0.05] })) }, { scaleY: Animated.add(lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }), snap.interpolate({ inputRange: [-1, 1], outputRange: [-0.05, 0.05] })) }],
              }} />
              <Neck width={barW} slot={slot} index={leftIndex} startX={margin} capsuleX={leftCapsuleX} snap={snap} curve={curve} mirrored={dropRight} />
              <InkLayer style={styles.barItems}>
                {routes.map((r, i) => (
                  <TabItem key={r.key} label={TABS[r.name].label} Icon={TABS[r.name].Icon} active={i === activeIdx} layout="bar" style={itemStyle(i)}
                    onPress={() => press(r.key, i === activeIdx)} />
                ))}
              </InkLayer>
            </>
          )}>
            {null}
          </LiquidView>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = createStyles(() => ({
  barItems: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  barItem: { alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: (PILL_H - INSET * 2) / 2 },
  lens: { position: 'absolute' },
  panel: { flex: 1, borderRadius: 26, paddingTop: 18, paddingBottom: 18 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6, marginBottom: 26 },
  railItem: { height: RAIL_ITEM, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 18 },
  sideItem: { height: SIDE_ITEM, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, borderRadius: 14 },
}));
