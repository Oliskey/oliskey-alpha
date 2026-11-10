// Price chart (react-native-svg). The live candle sits next to the price column; for Fixed Time / InZone the
// space to its right shows the trade window (start/end lines or corridor). Open and past trades are drawn on it.
// Gestures: drag to scroll back, pinch / mouse wheel / +- buttons to zoom, double tap to reset; drag or wheel on the
// price numbers to zoom prices (double tap there to fit them again);
// taps place drawings when a tool is active.
import { memo, type ReactNode, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { PanResponder, Platform, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, LinearGradient as SvgGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { ChevronRight, Minus, Plus } from 'lucide-react-native';
import type { Candle, Trade, TradeMode } from '@/lib/api';
import { clock12, countdown } from '@/lib/format';
import { colors, font, createStyles, veil } from '@/theme';
import { FAN_LEVELS, fibPrice, FIB_LEVELS, type Drawing, type DrawTool, type Pt } from './drawings';
import { computeIndicator, indDef, indTitle, type IndOut, type IndSetting, type VolumeBar } from './indicators';
import { Press } from '@/ui/Press';
import { InkIcon, LiquidView } from '@/ui/liquid';
import { Txt } from '@/ui/Txt';

const MIN_AXIS_W = 64;
const DIGIT_W = 7.8;                // approx. width of one 13 px digit
const TIME_H = 22;
const TOP = 26;
export const PANE_H = 96;           // height of one oscillator panel under the chart
const DEFAULT_STEP = 9;      // px per candle (body 6 + gap 3): the smallest default, on phones
const FIT_CANDLES = 50;      // the default view shows about this many candles left of the live one, on any screen (owner 2026-11-08)
const FIT_MAX_STEP = 24;     // so a very wide screen still shows a useful stretch of history
const MIN_STEP = 3;          // zoomed all the way out
const MAX_STEP = 40;         // zoomed all the way in
const LIVE_AT = 0.7;          // the live candle's position across the chart (0-1)
const TRADE_REACH = 0.6;      // a trade this many candle ranges beyond the candles joins the price fit: the candles always keep nearly half the height
const CONTROLS_ROOM = 60;     // px at the bottom of the prices kept clear for the zoom buttons
const clampStep = (s: number) => Math.max(MIN_STEP, Math.min(MAX_STEP, s));
// Vertical zoom from the price axis: 1 = fit the visible candles, < 1 = prices stretched, > 1 = squeezed.
// Web: a mouse drag moves the chart (candles or the time axis) instead of selecting its text, and touch drags
// are not taken by the page scroll.
const WEB_DRAG = Platform.OS === 'web' ? ({ userSelect: 'none', cursor: 'grab', touchAction: 'none' } as object) : null;
const clampYScale = (v: number) => Math.max(0.2, Math.min(8, v));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type { Drawing, DrawTool } from './drawings';
export type ChartType = 'area' | 'candles' | 'heikin' | 'bar';

// Heikin Ashi: smoothed candles. close = average of OHLC, open = midpoint of the previous HA candle.
function toHeikinAshi(cs: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const c of cs) {
    const prev = out[out.length - 1];
    const close = (c.open + c.high + c.low + c.close) / 4;
    const open = prev ? (prev.open + prev.close) / 2 : (c.open + c.close) / 2;
    out.push({ time: c.time, open, close, high: Math.max(c.high, open, close), low: Math.min(c.low, open, close) });
  }
  return out;
}

type Props = {
  candles: Candle[];
  chartType?: ChartType;
  decimals: number;
  tf: number;                        // seconds per candle
  price: number | null;
  momentumUp: number;                // 0-100
  mode: TradeMode | 'stocks';
  durationSec: number;
  zonePct: number;                   // InZone corridor half-width in %
  trades: Trade[];                   // open trades on this asset
  pastTrades?: Trade[];              // closed trades on this asset: entry dot -> close dot, coloured by result
  focusTime?: number;                // scroll so this moment is in view (Show on Chart)
  now: number;
  drawings?: Drawing[];
  pendingPoints?: Pt[];              // taps placed so far for the active tool
  drawTool?: DrawTool;
  selectedDrawing?: number | null;
  magnet?: boolean;                  // drawing taps snap to the nearest candle open/high/low/close
  onDrawingPress?: (index: number | null) => void;   // tap on a drawing (null = tap on empty chart while one is selected)
  onChartTap?: (t: number, p: number) => void;
  onTradesPress?: (ids: string[]) => void;   // tap on an open-trade marker (several ids when grouped)
  onMomentumPress?: () => void;              // tap on the momentum bar (left edge)
  crosshair?: boolean;                       // desktop: hover crosshair, OHLC readout and "+" to add a level
  onAddLevel?: (price: number) => void;      // "+" on the crosshair price: add a horizontal line there
  indicators?: IndSetting[];                 // overlays on the price and oscillator panels below it
  volume?: VolumeBar[] | null;               // real buy/sell volume per candle (live crypto), null when none
  onIndicatorPress?: (id: string) => void;   // tap on an indicator's name: edit or remove it
  plan?: { entry: number; stop: number; target: number; muted: boolean } | null;   // a signal's start, profit zone and loss zone
  onShowTrade?: () => void;                  // the arrow was pressed to bring the trade into view
};

const dist = (e: GestureResponderEvent) => {
  const [a, b] = e.nativeEvent.touches;
  return a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0;
};

function ChartInner(props: Props) {
  const { candles: raw, chartType = 'candles', decimals, tf, price, momentumUp, mode, durationSec, zonePct, trades, pastTrades = [], focusTime, now, drawings = [], pendingPoints = [] } = props;
  const candles = useMemo(() => (chartType === 'heikin' ? toHeikinAshi(raw) : raw), [raw, chartType]);
  // indicators use the real candles (not Heikin Ashi)
  const indOuts = useMemo(() => (props.indicators ?? []).map((s) => ({ s, out: computeIndicator(s, raw, props.volume ?? null) })), [raw, props.indicators, props.volume]);
  const overlays = useMemo(() => indOuts.filter((o) => !indDef(o.s.key).pane), [indOuts]);
  const panes = indOuts.filter((o) => indDef(o.s.key).pane);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // null = the default view, sized to the screen. A wide screen used to draw ~145 thin candles at 9 px each, hard to read;
  // now every screen starts at about FIT_CANDLES candles. Zooming picks a size; double tap or the arrow returns to the default.
  const [chosen, setChosen] = useState<number | null>(null);
  const [yScale, setYScale] = useState(1);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [offset, setOffset] = useState(0);   // candles scrolled back from the latest

  // Show on Chart: put the focused moment a few candles left of the anchor, once candles are loaded.
  const focusedFor = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!focusTime || !candles.length || focusedFor.current === focusTime) return;
    focusedFor.current = focusTime;
    const idx = candles.findIndex((c) => c.time + tf * 1000 > focusTime);
    setOffset(idx < 0 ? 0 : Math.max(0, candles.length - 1 - idx - 6));
  }, [focusTime, candles.length, tf]); // eslint-disable-line react-hooks/exhaustive-deps
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  // Price column sized to the longest label (e.g. 68237.08 needs more room than 1.11620).
  const refPrice = price ?? (candles.length ? candles[candles.length - 1].close : 0);
  const AXIS_W = Math.max(MIN_AXIS_W, Math.ceil(refPrice.toFixed(decimals).length * DIGIT_W + 16));
  const plotW = Math.max(0, size.w - AXIS_W);
  const fitStep = Math.max(DEFAULT_STEP, Math.min(FIT_MAX_STEP, (plotW * LIVE_AT) / FIT_CANDLES));
  const step = chosen ?? fitStep;
  const setStep = (v: number | ((s: number) => number)) => setChosen((c) => clampStep(typeof v === 'function' ? v(c ?? live.current.fitStep) : v));
  // panels shrink on short charts (phones) so the price keeps most of the room
  const paneH = Math.min(PANE_H, Math.max(48, Math.round(size.h * 0.16)));
  const plotH = Math.max(0, size.h - TIME_H - TOP - panes.length * paneH);
  // The live candle sits at 70% of the chart width (owner decision 2026-10-30); the right 30% shows the trade
  // window (start/end lines or corridor). Area charts fit their whole history into the left 70% (zoom still scales).
  const zoom = step / fitStep;
  const liveX = plotW * LIVE_AT;
  let unit: number;
  if (chartType === 'area' && candles.length > 1) {
    unit = (liveX / (candles.length - 1)) * zoom;
  } else {
    unit = step;
  }
  const body = Math.max(2, Math.round(unit * 0.66));
  const pxPerMs = unit / (tf * 1000);
  const maxOffset = Math.max(0, candles.length - 10);
  const off = Math.min(offset, maxOffset);
  // Scrolled into the past there is no trade window to show, so the candles slide right until they reach the
  // price numbers (no empty space); back at the live edge the newest candle returns to 70%.
  const anchorX = off === 0 ? liveX : Math.min(plotW - unit, liveX + off * unit);
  const anchorIdx = candles.length - 1 - off;
  const anchorTime = candles.length ? candles[anchorIdx].time : now;
  const xOfTime = (t: number) => anchorX + (t - anchorTime) * pxPerMs + body / 2;
  const timeOfX = (x: number) => anchorTime + (x - anchorX - body / 2) / pxPerMs;
  const visibleCount = Math.ceil(anchorX / unit) + 1;
  const startIdx = Math.max(0, anchorIdx + 1 - visibleCount);
  // On screen by time, not by count: after a gap in the data, candles from before it are off to the left and must not stretch the
  // price scale (that squashed the candles on screen into flat lines until the chart was scrolled).
  const leftTime = timeOfX(-unit);
  const inView = candles.slice(startIdx, anchorIdx + 1);
  const onScreen = inView.filter((c) => c.time >= leftTime);
  const visible = onScreen.length ? onScreen : inView;
  // index -> time, also for indicator points drawn ahead of the last candle
  const timeAt = (i: number) => (i < candles.length ? candles[i].time : (candles[candles.length - 1]?.time ?? now) + (i - candles.length + 1) * tf * 1000);
  const lastIdx = anchorIdx + Math.ceil(Math.max(0, plotW - anchorX) / Math.max(1, unit)) + 1;   // last index that can show

  const zone = mode === 'inzone' && price ? { hi: price * (1 + zonePct / 100), lo: price * (1 - zonePct / 100) } : null;

  const [min, max] = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const c of visible) { lo = Math.min(lo, c.low); hi = Math.max(hi, c.high); }
    // Trades near the candles join the fit. One far away, such as an entry from yesterday, would squash today's candles into a thin band,
    // so it stays out of the fit and is drawn at the edge of the chart with its entry price (owner 2026-11-07: every trade stays visible).
    const reach = isFinite(lo) ? Math.max(hi - lo, hi * 0.0005) * TRADE_REACH : Infinity;
    const candleLo = lo, candleHi = hi;
    for (const t of trades) {
      const p = Number(t.open_quote);
      if (isFinite(candleLo) ? p >= candleLo - reach && p <= candleHi + reach : true) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
    }
    if (zone && off === 0) { lo = Math.min(lo, zone.lo); hi = Math.max(hi, zone.hi); }
    if (props.plan) { const v = props.plan; const a = Math.min(lo, v.entry, v.stop, v.target), z = Math.max(hi, v.entry, v.stop, v.target), m = z - a; lo = a; hi = z + m * 0.06; }
    for (const { out } of overlays) {
      for (const v of [...out.lines.map((l) => l.v), ...(out.dots ? [out.dots.v] : [])]) {
        for (let i = startIdx; i <= anchorIdx; i++) { const x = v[i]; if (x != null) { lo = Math.min(lo, x); hi = Math.max(hi, x); } }
      }
    }
    if (!isFinite(lo)) return [0, 1];
    const pad = (hi - lo || hi * 0.0005) * 0.12;
    const mid = (lo + hi) / 2;
    const half = ((hi - lo) / 2 + pad) * yScale;
    // The zoom buttons cover the bottom of the chart: the price range ends above them, so no candle or trade is ever behind them.
    const span = 2 * half;
    const clear = plotH > CONTROLS_ROOM * 2 ? (span * CONTROLS_ROOM) / (plotH - CONTROLS_ROOM) : 0;
    return [mid - half - clear, mid + half];
  }, [visible, trades, zone?.lo, zone?.hi, off, yScale, overlays, plotH]); // eslint-disable-line react-hooks/exhaustive-deps

  const y = (p: number) => TOP + (1 - (p - min) / (max - min)) * plotH;
  const priceOfY = (yy: number) => min + (1 - (yy - TOP) / plotH) * (max - min);

  // Gestures. Refs keep the latest values for the responder created once.
  const live = useRef({ step, fitStep, unit, offset: off, maxOffset, props, timeOfX, priceOfY, plotW, yScale, snap: (_x: number, _y: number) => null as { t: number; p: number } | null });
  // Magnet: the visible candle nearest the tap, then its open/high/low/close nearest the tap if within 24 px.
  const snap = (lx: number, ly: number): { t: number; p: number } | null => {
    let best: Candle | null = null;
    for (const c of visible) if (!best || Math.abs(xOfTime(c.time) - lx) < Math.abs(xOfTime(best.time) - lx)) best = c;
    if (!best || Math.abs(xOfTime(best.time) - lx) > unit) return null;
    const p = [best.open, best.high, best.low, best.close].reduce((a, b) => (Math.abs(y(b) - ly) < Math.abs(y(a) - ly) ? b : a));
    return Math.abs(y(p) - ly) <= 24 ? { t: best.time, p } : null;
  };
  live.current = { step, fitStep, unit, offset: off, maxOffset, props, timeOfX, priceOfY, plotW, yScale, snap };
  const g = useRef({ startOffset: 0, startStep: DEFAULT_STEP, startDist: 0, moved: false, lastTap: 0, onAxis: false, startYScale: 1 });
  const tradeHits = useRef<{ x: number; y: number; ids: string[] }[]>([]);   // marker centres from the last render
  const drawingHits = useRef<{ x1: number; y1: number; x2: number; y2: number }[][]>([]);   // each drawing's segments, last render
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      g.current = {
        ...g.current, startOffset: live.current.offset, startStep: live.current.step, startDist: dist(e), moved: false,
        onAxis: e.nativeEvent.locationX > live.current.plotW, startYScale: live.current.yScale,
      };
    },
    onPanResponderMove: (e, s) => {
      // Dragging the price numbers zooms prices: up stretches them, down squeezes them.
      if (g.current.onAxis) {
        if (Math.abs(s.dy) > 3) { g.current.moved = true; setYScale(clampYScale(g.current.startYScale * Math.exp(s.dy / 160))); }
        return;
      }
      const d = dist(e);
      if (d && g.current.startDist) {
        g.current.moved = true;
        setStep(clampStep(g.current.startStep * (d / g.current.startDist)));
      } else if (d) {
        g.current.startDist = d; g.current.startStep = live.current.step;
      } else if (Math.abs(s.dx) > 4) {
        g.current.moved = true;
        const next = Math.round(g.current.startOffset + s.dx / live.current.unit);
        setOffset(Math.max(0, Math.min(live.current.maxOffset, next)));
      }
    },
    onPanResponderRelease: (e) => {
      if (g.current.moved) return;
      const tapAt = Date.now();
      const { props: p, timeOfX: tx, priceOfY: py } = live.current;
      const { locationX: lx, locationY: ly } = e.nativeEvent;
      if (g.current.onAxis) {   // double tap on the price numbers: fit prices again
        if (tapAt - g.current.lastTap < 300) setYScale(1);
        g.current.lastTap = tapAt;
        return;
      }
      const hit = (!p.drawTool || p.drawTool === 'none')
        ? tradeHits.current.find((h) => Math.hypot(h.x - lx, h.y - ly) <= 22) : undefined;
      // nearest drawing within 12 px of the tap (distance from point to segment)
      const near = (!p.drawTool || p.drawTool === 'none') ? drawingHits.current.findIndex((segs) => segs.some((s) => {
        const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
        const k = dx || dy ? Math.max(0, Math.min(1, ((lx - s.x1) * dx + (ly - s.y1) * dy) / (dx * dx + dy * dy))) : 0;
        return Math.hypot(lx - (s.x1 + k * dx), ly - (s.y1 + k * dy)) <= 12;
      })) : -1;
      if (hit) {
        p.onTradesPress?.(hit.ids);
      } else if (near >= 0 && p.onDrawingPress) {
        p.onDrawingPress(near);
      } else if (p.selectedDrawing != null && p.onDrawingPress && (!p.drawTool || p.drawTool === 'none')) {
        p.onDrawingPress(null);
      } else if ((!p.drawTool || p.drawTool === 'none') && lx < 48 && p.onMomentumPress) {
        p.onMomentumPress();
      } else if (p.drawTool && p.drawTool !== 'none') {
        const snapped = p.magnet ? live.current.snap(lx, ly) : null;
        p.onChartTap?.(snapped?.t ?? tx(lx), snapped?.p ?? py(ly));
      } else if (tapAt - g.current.lastTap < 300) {
        setChosen(null); setOffset(0); setYScale(1);
      }
      g.current.lastTap = tapAt;
    },
  })).current;

  // Mouse wheel / trackpad pinch zooms on web (scroll up = zoom in).
  const box = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = box.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Over the price numbers the wheel zooms prices; anywhere else it zooms time.
      if (e.clientX - el.getBoundingClientRect().left > live.current.plotW) {
        setYScale((v) => clampYScale(v * (e.deltaY < 0 ? 1 / 1.12 : 1.12)));
      } else {
        setStep((s) => clampStep(s * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    // crosshair: follow the mouse (not touch); cleared when it leaves the chart
    const onMove = (e: MouseEvent) => {
      if (!live.current.props.crosshair) return;
      const r = el.getBoundingClientRect();
      setHover({ x: e.clientX - r.left, y: e.clientY - r.top });
    };
    const onLeave = () => setHover(null);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => { el.removeEventListener('wheel', onWheel); el.removeEventListener('mousemove', onMove); el.removeEventListener('mouseleave', onLeave); };
  }, [size.w > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!size.w) return <View style={{ flex: 1 }} onLayout={onLayout} />;

  const gridCount = 6;
  const grid = Array.from({ length: gridCount }, (_, i) => min + ((max - min) * (i + 0.5)) / gridCount);
  const labelEvery = Math.max(4, Math.round(140 / unit));
  const nowX = xOfTime(now) - body / 2;
  const endX = Math.min(nowX + durationSec * 1000 * pxPerMs, plotW - 4);   // long trades: end line at the right edge
  const candleLeftMs = tf * 1000 - (now % (tf * 1000));
  // Countdown bubble goes right of the live candle when there is room, otherwise to its left.
  const bubbleX = nowX + body + 64 <= plotW ? nowX + body + 6 : nowX - 60;
  const fmtTime = (t: number) => {
    const d = new Date(t);
    // 4 h and 1 day candles, and the first candle of each day on 15 min-1 h charts, show the date instead.
    if (tf >= 14400 || (tf >= 900 && d.getHours() === 0 && d.getMinutes() * 60 < tf)) return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    return clock12(d, tf < 60);
  };
  const live0 = off === 0;
  // The arrow has two jobs. In the past: back to now. Already at now: the clear view, with readable candles and prices fitted to
  // them (and a signal's own chart, where its stop and target fit the candles).
  const settled = live0 && !props.plan && chosen === null && yScale === 1;
  const onArrow = () => {
    if (!live0) { setOffset(0); return; }
    setChosen(null);
    setYScale(1);
    props.onShowTrade?.();
  };

  // ── indicator drawing ──
  const from = Math.max(0, startIdx - 1);
  const pathOf = (v: (number | null)[], yf: (p: number) => number, to = lastIdx) => {
    let d = '', pen = false;
    for (let i = from; i <= Math.min(v.length - 1, to); i++) {
      const x = v[i];
      if (x == null || !isFinite(x)) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${xOfTime(timeAt(i)).toFixed(1)} ${yf(x).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const renderOverlay = (out: IndOut) => {
    const els: ReactNode[] = [];
    if (out.band) {
      const up = pathOf(out.band.upper, y);
      const pts: string[] = [];
      for (let i = Math.min(out.band.lower.length - 1, lastIdx); i >= from; i--) {
        const x = out.band.lower[i];
        if (x != null && out.band.upper[i] != null) pts.push(`${xOfTime(timeAt(i)).toFixed(1)} ${y(x).toFixed(1)}`);
      }
      if (up && pts.length) els.push(<Path key="band" d={`${up} L${pts.join(' L')} Z`} fill={out.band.color} fillOpacity={0.06} />);
    }
    if (out.cloud) {
      let g = '', r = '';
      for (let i = from; i < Math.min(out.cloud.a.length - 1, lastIdx); i++) {
        const a0 = out.cloud.a[i], b0 = out.cloud.b[i], a1 = out.cloud.a[i + 1], b1 = out.cloud.b[i + 1];
        if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
        const x0 = xOfTime(timeAt(i)).toFixed(1), x1 = xOfTime(timeAt(i + 1)).toFixed(1);
        const quad = `M${x0} ${y(a0).toFixed(1)} L${x1} ${y(a1).toFixed(1)} L${x1} ${y(b1).toFixed(1)} L${x0} ${y(b0).toFixed(1)} Z`;
        if (a0 + a1 >= b0 + b1) g += quad; else r += quad;
      }
      if (g) els.push(<Path key="cg" d={g} fill={colors.up} fillOpacity={0.12} />);
      if (r) els.push(<Path key="cr" d={r} fill={colors.down} fillOpacity={0.12} />);
    }
    out.lines.forEach((l, j) => {
      const d = pathOf(l.v, y);
      if (d) els.push(<Path key={`l${j}`} d={d} stroke={l.color} strokeWidth={l.width ?? 1.4} strokeDasharray={l.dash ? '4 3' : undefined} fill="none" strokeLinejoin="round" />);
    });
    if (out.dots) {
      for (let i = from; i <= Math.min(out.dots.v.length - 1, anchorIdx); i++) {
        const x = out.dots.v[i];
        if (x != null) els.push(<Circle key={`d${i}`} cx={xOfTime(timeAt(i))} cy={y(x)} r={Math.max(1.5, Math.min(3, body / 3))} fill={out.dots.colors[i]} />);
      }
    }
    if (out.zig) {
      const first = out.zig.findIndex((q) => q.i >= from);
      const sel = first < 0 ? out.zig.slice(-1) : out.zig.slice(Math.max(0, first - 1)).filter((q, k, arr) => q.i <= anchorIdx || (k > 0 && arr[k - 1].i <= anchorIdx));
      if (sel.length > 1) els.push(<Path key="zz" d={`M${sel.map((q) => `${xOfTime(timeAt(q.i)).toFixed(1)} ${y(q.p).toFixed(1)}`).join(' L')}`} stroke={colors.demo} strokeWidth={1.6} fill="none" />);
    }
    return els;
  };
  const fmtVal = (v: number) => {
    const a = Math.abs(v);
    return a >= 1000 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(Math.min(decimals + 1, 6));
  };
  const renderPane = (out: IndOut, top: number, id: string) => {
    const t0 = top + 22, h = paneH - 28;
    let lo = Infinity, hi = -Infinity;
    if (out.range) [lo, hi] = out.range;
    else {
      for (const v of [...out.lines.map((l) => l.v), ...(out.hist ? [out.hist.v] : []), ...(out.hist2 ? [out.hist2.v] : [])]) {
        for (let i = startIdx; i <= anchorIdx; i++) { const x = v[i]; if (x != null && isFinite(x)) { lo = Math.min(lo, x); hi = Math.max(hi, x); } }
      }
      if (out.hist || out.hist2) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      if (hi === lo) { hi += 1; lo -= 1; }
    }
    const py = (v: number) => t0 + (1 - (v - lo) / (hi - lo)) * h;
    const zeroY = py(Math.max(lo, Math.min(hi, 0)));
    const bars = (hs: NonNullable<IndOut['hist']>, key: string) => {
      const els: ReactNode[] = [];
      for (let i = startIdx; i <= Math.min(anchorIdx, hs.v.length - 1); i++) {
        const v = hs.v[i]; if (v == null) continue;
        const yy = py(v);
        els.push(<Rect key={`${key}${i}`} x={xOfTime(timeAt(i)) - body / 2} y={Math.min(yy, zeroY)} width={body} height={Math.max(1, Math.abs(zeroY - yy))} fill={hs.colors[i]} fillOpacity={0.85} />);
      }
      return els;
    };
    return (
      <G key={id}>
        <Line x1={0} x2={size.w} y1={top} y2={top} stroke={colors.border} strokeWidth={1} />
        {(out.levels ?? []).filter((l) => l >= lo && l <= hi).map((l) => (
          <G key={`lv${l}`}>
            <Line x1={0} x2={plotW} y1={py(l)} y2={py(l)} stroke={colors.faint} strokeOpacity={0.6} strokeDasharray="3 4" />
            {h >= 50 || out.range ? <SvgText x={size.w - 6} y={py(l) + 4} fill={colors.faint} fontSize={11} textAnchor="end">{fmtVal(l)}</SvgText> : null}
          </G>
        ))}
        {out.hist ? bars(out.hist, 'h') : null}
        {out.hist2 ? bars(out.hist2, 'g') : null}
        {out.lines.map((l, j) => <Path key={`p${j}`} d={pathOf(l.v, py, anchorIdx)} stroke={l.color} strokeWidth={l.width ?? 1.4} fill="none" strokeLinejoin="round" />)}
        {!out.range ? <SvgText x={size.w - 6} y={t0 + 4} fill={colors.faint} fontSize={11} textAnchor="end">{fmtVal(hi)}</SvgText> : null}
        {!out.range ? <SvgText x={size.w - 6} y={t0 + h + 4} fill={colors.faint} fontSize={11} textAnchor="end">{fmtVal(lo)}</SvgText> : null}
        {out.note ? <SvgText x={plotW / 2} y={t0 + h / 2 + 4} fill={colors.muted} fontSize={12} textAnchor="middle">{out.note}</SvgText> : null}
      </G>
    );
  };
  // latest values shown next to each indicator's name
  const lastVals = (out: IndOut) => {
    const vals: { v: number; color: string }[] = [];
    for (const l of out.lines) { const v = l.v[Math.min(anchorIdx, l.v.length - 1)]; if (v != null) vals.push({ v, color: l.color }); }
    if (out.hist) { const v = out.hist.v[anchorIdx]; if (v != null) vals.push({ v, color: out.hist.colors[anchorIdx] }); }
    return vals;
  };

  return (
    <View style={{ flex: 1 }}>
    <View ref={box} style={[{ flex: 1 }, WEB_DRAG]} onLayout={onLayout} {...pan.panHandlers}>
      <Svg width={size.w} height={size.h} pointerEvents="none">
        <G fontFamily={font.regular}>
          {/* grid + price axis */}
          {grid.map((p) => (
            <G key={p}>
              <Line x1={0} x2={plotW} y1={y(p)} y2={y(p)} stroke={colors.grid} strokeWidth={1} />
              <SvgText x={size.w - 6} y={y(p) + 4} fill={colors.muted} fontSize={13} textAnchor="end">{p.toFixed(decimals)}</SvgText>
            </G>
          ))}

          {/* time axis */}
          {visible.map((c, i) => ((visible.length - 1 - i) % labelEvery === 0 ? (
            <SvgText key={`t${c.time}`} x={xOfTime(c.time)} y={size.h - 6} fill={colors.muted} fontSize={13} textAnchor="middle">{fmtTime(c.time)}</SvgText>
          ) : null))}

          {/* InZone corridor */}
          {zone && live0 ? (
            <G>
              <Rect x={nowX} y={y(zone.hi)} width={Math.max(0, endX - nowX)} height={y(zone.lo) - y(zone.hi)} fill={colors.zone} fillOpacity={0.14} stroke={colors.zone} strokeOpacity={0.5} />
              <SvgText x={(nowX + endX) / 2} y={y(zone.hi) - 5} fill={colors.zone} fontSize={12} textAnchor="middle">+{zonePct.toFixed(3)}%</SvgText>
              <SvgText x={(nowX + endX) / 2} y={y(zone.lo) + 15} fill={colors.zone} fontSize={12} textAnchor="middle">-{zonePct.toFixed(3)}%</SvgText>
              <Line x1={endX} x2={endX} y1={TOP} y2={TOP + plotH} stroke={colors.muted} strokeWidth={1} />
              <Circle cx={endX} cy={TOP - 2} r={11} fill={colors.surface2} stroke={colors.muted} />
              <Path d={`M${endX - 3} ${TOP + 4} V${TOP - 8} H${endX + 5} L${endX + 3} ${TOP - 5} L${endX + 5} ${TOP - 2} H${endX - 3}`} stroke={colors.text} strokeWidth={1.4} fill="none" />
            </G>
          ) : null}

          {/* a signal's plan: green is where profit is taken, red is where the loss is taken */}
          {props.plan ? (() => {
            const pl = props.plan, yE = y(pl.entry), yS = y(pl.stop), yT = y(pl.target), o = pl.muted ? 0.45 : 1;
            const rows = [{ yy: yT, c: colors.up, t: `Take profit ${pl.target.toFixed(decimals)}`, left: false }, { yy: yS, c: colors.down, t: `Stop loss ${pl.stop.toFixed(decimals)}`, left: false }, { yy: yE, c: colors.text, t: `Start ${pl.entry.toFixed(decimals)}`, left: true }];
            return (
              <G opacity={o}>
                <Rect x={0} width={plotW} y={Math.min(yE, yT)} height={Math.abs(yT - yE)} fill={colors.up} fillOpacity={0.09} />
                <Rect x={0} width={plotW} y={Math.min(yE, yS)} height={Math.abs(yS - yE)} fill={colors.down} fillOpacity={0.09} />
                {rows.map((r) => (
                  <G key={r.t}>
                    <Line x1={0} x2={plotW} y1={r.yy} y2={r.yy} stroke={r.c} strokeWidth={1.5} strokeDasharray="6 4" />
                    <SvgText x={r.left ? 10 : plotW - 8} y={r.yy < TOP + 18 ? r.yy + 15 : r.yy - 5} fill={r.c} fontSize={12} fontWeight="600" textAnchor={r.left ? 'start' : 'end'}>{r.t}</SvgText>
                  </G>
                ))}
              </G>
            );
          })() : null}

          {/* Fixed Time window */}
          {mode === 'fixed_time' && live0 ? (
            <G>
              <Line x1={nowX} x2={nowX} y1={TOP} y2={TOP + plotH} stroke={colors.muted} strokeDasharray="4 4" strokeWidth={1} />
              <Line x1={endX} x2={endX} y1={TOP} y2={TOP + plotH} stroke={colors.muted} strokeDasharray="4 4" strokeWidth={1} />
              <SvgText x={nowX - 4} y={14} fill={colors.muted} fontSize={13} textAnchor="end">Trade start</SvgText>
              {endX + 70 < plotW
                ? <SvgText x={endX + 4} y={14} fill={colors.muted} fontSize={13}>Trade end</SvgText>
                : <SvgText x={endX - 4} y={30} fill={colors.muted} fontSize={13} textAnchor="end">Trade end</SvgText>}
            </G>
          ) : null}

          {/* price series: area line, OHLC bars, or candles (normal / Heikin Ashi) */}
          {chartType === 'area' && visible.length > 1 ? (() => {
            const pts = visible.map((c) => `${xOfTime(c.time).toFixed(1)} ${y(c.close).toFixed(1)}`);
            const line = `M${pts.join(' L')}`;
            const lastX = xOfTime(visible[visible.length - 1].time);
            const firstX = xOfTime(visible[0].time);
            return (
              <G>
                <Defs>
                  <SvgGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={colors.teal} stopOpacity={0.28} />
                    <Stop offset="1" stopColor={colors.teal} stopOpacity={0} />
                  </SvgGradient>
                </Defs>
                <Path d={`${line} L${lastX.toFixed(1)} ${TOP + plotH} L${firstX.toFixed(1)} ${TOP + plotH} Z`} fill="url(#areaFill)" />
                <Path d={line} stroke={colors.teal} strokeWidth={1.6} fill="none" strokeLinejoin="round" />
              </G>
            );
          })() : visible.map((c) => {
            const cx = xOfTime(c.time);
            const color = c.close >= c.open ? colors.upVivid : colors.down;
            if (chartType === 'bar') {
              const tick = Math.max(2, body / 2);
              return (
                <G key={c.time}>
                  <Line x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={1.4} />
                  <Line x1={cx - tick} x2={cx} y1={y(c.open)} y2={y(c.open)} stroke={color} strokeWidth={1.4} />
                  <Line x1={cx} x2={cx + tick} y1={y(c.close)} y2={y(c.close)} stroke={color} strokeWidth={1.4} />
                </G>
              );
            }
            const top = y(Math.max(c.open, c.close));
            const h = Math.max(1, Math.abs(y(c.open) - y(c.close)));
            return (
              <G key={c.time}>
                <Line x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={1} />
                <Rect x={cx - body / 2} y={top} width={body} height={h} fill={color} />
              </G>
            );
          })}

          {/* indicators on the price, clipped to the plot */}
          {overlays.length ? (
            <G>
              <Defs><ClipPath id="plotClip"><Rect x={0} y={TOP} width={plotW} height={plotH} /></ClipPath></Defs>
              <G clipPath="url(#plotClip)">
                {overlays.map(({ s, out }) => <G key={s.id}>{renderOverlay(out)}</G>)}
              </G>
            </G>
          ) : null}

          {/* oscillator panels under the chart */}
          {panes.map(({ s, out }, k) => renderPane(out, TOP + plotH + k * paneH, s.id))}

          {/* drawings (selected one: thicker with handles) */}
          {(() => {
            const G1 = colors.demo;
            const hits: { x1: number; y1: number; x2: number; y2: number }[][] = [];
            const axisTag = (yy: number, text: string, key: string) => (
              <G key={key}>
                <Rect x={plotW + 2} y={yy - 10} width={AXIS_W - 4} height={20} rx={6} fill={G1} />
                <SvgText x={plotW + AXIS_W / 2} y={yy + 4} fill={colors.dark} fontSize={12} textAnchor="middle" fontFamily={font.semibold}>{text}</SvgText>
              </G>
            );
            const nodes = drawings.map((d, i) => {
              const on = props.selectedDrawing === i;
              const w = on ? 2.5 : 1.5;
              const handle = (cx: number, cy: number, k: string) => on ? <Circle key={k} cx={cx} cy={cy} r={5} fill={colors.bg} stroke={G1} strokeWidth={2} /> : null;
              if (d.kind === 'hline') {
                const yy = y(d.price);
                hits.push([{ x1: 0, y1: yy, x2: plotW, y2: yy }]);
                return <G key={i}><Line x1={0} x2={plotW} y1={yy} y2={yy} stroke={G1} strokeWidth={w} />{axisTag(yy, d.price.toFixed(decimals), 't')}</G>;
              }
              if (d.kind === 'hray') {
                const x1 = xOfTime(d.a.t), yy = y(d.a.p);
                hits.push([{ x1, y1: yy, x2: plotW, y2: yy }]);
                return <G key={i}><Line x1={x1} x2={plotW} y1={yy} y2={yy} stroke={G1} strokeWidth={w} /><Circle cx={x1} cy={yy} r={3} fill={G1} />{handle(x1, yy, 'h')}{axisTag(yy, d.a.p.toFixed(decimals), 't')}</G>;
              }
              if (d.kind === 'vline') {
                const xx = xOfTime(d.t);
                hits.push([{ x1: xx, y1: TOP, x2: xx, y2: TOP + plotH }]);
                return <G key={i}><Line x1={xx} x2={xx} y1={TOP} y2={TOP + plotH} stroke={G1} strokeWidth={w} strokeDasharray="6 4" />
                  <Rect x={xx - 26} y={TOP + plotH - 20} width={52} height={18} rx={6} fill={G1} />
                  <SvgText x={xx} y={TOP + plotH - 7} fill={colors.dark} fontSize={11} textAnchor="middle" fontFamily={font.semibold}>{fmtTime(d.t)}</SvgText></G>;
              }
              const ax = xOfTime(d.a.t), ay = y(d.a.p), bx = xOfTime(d.b.t), by = y(d.b.p);
              // a line from (x0,y0) through (x1,y1), continued to the right edge or the top/bottom of the plot
              const extend = (x0: number, y0: number, x1: number, y1: number) => {
                if (x1 === x0) return { ex: x1, ey: y1 };
                const slope = (y1 - y0) / (x1 - x0);
                let ex = plotW, ey = y0 + slope * (plotW - x0);
                const edge = ey < TOP ? TOP : ey > TOP + plotH ? TOP + plotH : null;
                if (edge !== null && slope !== 0) { ey = edge; ex = x0 + (edge - y0) / slope; }
                return { ex, ey };
              };
              if (d.kind === 'channel') {
                // the parallel line is the base line moved by the price gap at the third tap's time
                const atC = d.b.t === d.a.t ? d.a.p : d.a.p + ((d.b.p - d.a.p) * (d.c.t - d.a.t)) / (d.b.t - d.a.t);
                const gap = d.c.p - atC;
                const pay = y(d.a.p + gap), pby = y(d.b.p + gap), may = y(d.a.p + gap / 2), mby = y(d.b.p + gap / 2);
                hits.push([{ x1: ax, y1: ay, x2: bx, y2: by }, { x1: ax, y1: pay, x2: bx, y2: pby }]);
                return (
                  <G key={i}>
                    <Path d={`M${ax} ${ay} L${bx} ${by} L${bx} ${pby} L${ax} ${pay} Z`} fill={G1} fillOpacity={0.08} />
                    <Line x1={ax} y1={ay} x2={bx} y2={by} stroke={G1} strokeWidth={w} />
                    <Line x1={ax} y1={pay} x2={bx} y2={pby} stroke={G1} strokeWidth={w} />
                    <Line x1={ax} y1={may} x2={bx} y2={mby} stroke={G1} strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.7} />
                    {handle(ax, ay, 'a')}{handle(bx, by, 'b')}{handle(xOfTime(d.c.t), y(d.c.p), 'c')}
                  </G>
                );
              }
              if (d.kind === 'fibfan') {
                // rays from the start of the move through each ratio of it, measured at the end of the move
                const rays = [{ lv: 0, yy: by }, ...FAN_LEVELS.map((lv) => ({ lv, yy: y(fibPrice(d, lv)) }))].map((r) => ({ ...r, ...extend(ax, ay, bx, r.yy) }));
                hits.push(rays.map((r) => ({ x1: ax, y1: ay, x2: r.ex, y2: r.ey })));
                return (
                  <G key={i}>
                    <Line x1={bx} x2={bx} y1={ay} y2={by} stroke={G1} strokeWidth={1} strokeDasharray="3 4" strokeOpacity={0.5} />
                    {rays.map((r) => (
                      <G key={r.lv}>
                        <Line x1={ax} y1={ay} x2={r.ex} y2={r.ey} stroke={G1} strokeWidth={r.lv === 0 ? w + 0.5 : w} strokeOpacity={r.lv === 0 ? 1 : 0.75} />
                        {r.lv ? <SvgText x={bx + 4} y={r.yy - 3} fill={G1} fontSize={11} fontFamily={font.semibold}>{`${(r.lv * 100).toFixed(1)}%`}</SvgText> : null}
                      </G>
                    ))}
                    {handle(ax, ay, 'a')}{handle(bx, by, 'b')}
                  </G>
                );
              }
              if (d.kind === 'trend' || d.kind === 'ray') {
                let ex = bx, ey = by;
                if (d.kind === 'ray' && bx !== ax) {
                  // extend to the right edge, or to the top/bottom of the plot if it leaves it first
                  const slope = (by - ay) / (bx - ax);
                  ex = plotW; ey = ay + slope * (plotW - ax);
                  const edge = ey < TOP ? TOP : ey > TOP + plotH ? TOP + plotH : null;
                  if (edge !== null && slope !== 0) { ey = edge; ex = ax + (edge - ay) / slope; }
                }
                hits.push([{ x1: ax, y1: ay, x2: ex, y2: ey }]);
                return <G key={i}><Line x1={ax} y1={ay} x2={ex} y2={ey} stroke={G1} strokeWidth={w} />{handle(ax, ay, 'a')}{handle(bx, by, 'b')}</G>;
              }
              if (d.kind === 'rect' || d.kind === 'measure') {
                const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
                hits.push([{ x1: x0, y1: y0, x2: x1, y2: y0 }, { x1: x0, y1: y1, x2: x1, y2: y1 }, { x1: x0, y1: y0, x2: x0, y2: y1 }, { x1: x1, y1: y0, x2: x1, y2: y1 }]);
                if (d.kind === 'rect') {
                  return <G key={i}><Rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={G1} fillOpacity={0.1} stroke={G1} strokeWidth={w} />{handle(ax, ay, 'a')}{handle(bx, by, 'b')}</G>;
                }
                // measure: price change, % change and time between the two points
                const diff = d.b.p - d.a.p;
                const tone = diff >= 0 ? colors.up : colors.down;
                const secs = Math.abs(d.b.t - d.a.t) / 1000;
                const span = secs >= 86400 ? `${(secs / 86400).toFixed(1)}d` : secs >= 3600 ? `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m` : secs >= 60 ? `${Math.round(secs / 60)}m` : `${Math.round(secs)}s`;
                const bars = Math.round(secs / tf);
                const label = `${diff >= 0 ? '+' : ''}${diff.toFixed(decimals)} (${diff >= 0 ? '+' : ''}${((diff / d.a.p) * 100).toFixed(2)}%) · ${bars} bars · ${span}`;
                const lw = label.length * 6.4 + 16;
                const lx = Math.min(Math.max((x0 + x1) / 2 - lw / 2, 2), plotW - lw - 2);
                const ly = diff >= 0 ? y0 - 26 : y1 + 6;
                return (
                  <G key={i}>
                    <Rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={tone} fillOpacity={0.12} stroke={tone} strokeWidth={on ? 2 : 1} />
                    <Line x1={ax} y1={ay} x2={bx} y2={by} stroke={tone} strokeWidth={1} strokeDasharray="4 3" />
                    <Rect x={lx} y={Math.max(ly, 2)} width={lw} height={20} rx={10} fill={tone} />
                    <SvgText x={lx + lw / 2} y={Math.max(ly, 2) + 14} fill={colors.dark} fontSize={11} textAnchor="middle" fontFamily={font.semibold}>{label}</SvgText>
                    {handle(ax, ay, 'a')}{handle(bx, by, 'b')}
                  </G>
                );
              }
              // Fibonacci retracement: a level line per ratio from the move's start to the right edge, labelled with its price
              const fx0 = Math.min(ax, bx);
              const levels = FIB_LEVELS.map((lv) => ({ lv, yy: y(fibPrice(d, lv)) }));
              hits.push(levels.map(({ yy }) => ({ x1: fx0, y1: yy, x2: plotW, y2: yy })));
              return (
                <G key={i}>
                  <Line x1={ax} y1={ay} x2={bx} y2={by} stroke={G1} strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.7} />
                  {levels.map(({ lv, yy }) => (
                    <G key={lv}>
                      <Line x1={fx0} x2={plotW} y1={yy} y2={yy} stroke={G1} strokeWidth={lv === 0.5 || lv === 0.618 ? w + 0.5 : w} strokeOpacity={lv === 0 || lv === 1 ? 1 : 0.75} />
                      <SvgText x={fx0 + 4} y={yy - 4} fill={G1} fontSize={11} fontFamily={font.semibold}>{`${(lv * 100).toFixed(1)}%  ${fibPrice(d, lv).toFixed(decimals)}`}</SvgText>
                    </G>
                  ))}
                  {handle(ax, ay, 'a')}{handle(bx, by, 'b')}
                </G>
              );
            });
            drawingHits.current = hits;
            return nodes;
          })()}
          {pendingPoints.length === 2 ? <Line x1={xOfTime(pendingPoints[0].t)} y1={y(pendingPoints[0].p)} x2={xOfTime(pendingPoints[1].t)} y2={y(pendingPoints[1].p)} stroke={colors.demo} strokeWidth={1.5} strokeDasharray="4 3" /> : null}
          {pendingPoints.map((q, k) => <Circle key={`pp${k}`} cx={xOfTime(q.t)} cy={y(q.p)} r={5} fill={colors.demo} />)}

          {/* past trades: entry -> close, green profit / red loss / grey refund */}
          {pastTrades.map((t) => {
            if (!t.close_time || !t.close_quote) return null;
            const sx = xOfTime(new Date(t.open_time).getTime());
            const ex = xOfTime(new Date(t.close_time).getTime());
            if (ex < 0 || sx > plotW) return null;
            const color = t.result === 'win' ? colors.up : t.result === 'loss' ? colors.down : colors.muted;
            const sy = y(Number(t.open_quote));
            const ey = y(Number(t.close_quote));
            const d = t.direction === 'down' ? 1 : -1;
            return (
              <G key={`p${t.id}`} opacity={0.9}>
                <Line x1={sx} y1={sy} x2={ex} y2={ey} stroke={color} strokeWidth={1.5} strokeDasharray="3 3" />
                <Circle cx={sx} cy={sy} r={7} fill={colors.bg} stroke={color} strokeWidth={1.5} />
                {t.direction ? (
                  <Path d={`M${sx} ${sy - 3.5 * d} V${sy + 3.5 * d} M${sx - 2.5} ${sy + d} L${sx} ${sy + 3.5 * d} L${sx + 2.5} ${sy + d}`} stroke={color} strokeWidth={1.5} fill="none" />
                ) : null}
                <Circle cx={ex} cy={ey} r={3.5} fill={color} />
              </G>
            );
          })}

          {/* open trades: one marker per cluster (count badge), a glowing line at the entry price to expiry,
              and an end ring with the time left. Trades close together on screen share one marker. */}
          {(() => {
            type Group = { color: string; dir: number; sx: number; sy: number; ex: number; expires: number | null; n: number; key: string; ids: string[]; edge: 0 | 1 | -1; entry: number };
            const groups: Group[] = [];
            for (const t of trades) {
              const color = t.mode === 'inzone' ? colors.zone : t.direction === 'down' ? colors.down : colors.up;
              const entry = Number(t.open_quote);
              const trueY = y(entry);
              // beyond the prices shown: it sits at the edge of the chart, with its entry price beside it
              const topEdge = TOP + 22, bottomEdge = TOP + plotH - (plotH > CONTROLS_ROOM * 2 ? CONTROLS_ROOM : 14);
              const edge: 0 | 1 | -1 = trueY < TOP + 6 ? 1 : trueY > TOP + plotH - 6 ? -1 : 0;
              const sy = edge === 1 ? topEdge : edge === -1 ? bottomEdge : trueY;
              const openedX = xOfTime(new Date(t.open_time).getTime());
              // opened before the time shown: its marker waits at the left, or beside the live candle if it is at an edge, so it can always be tapped
              const sx = openedX >= 20 && !edge ? openedX : edge ? Math.min(Math.max(openedX, nowX + 24), plotW - 20) : 20;
              const expires = t.expires_at ? new Date(t.expires_at).getTime() : null;
              const ex = expires ? xOfTime(expires) : nowX;
              const g = groups.find((o) => o.color === color && o.edge === edge && Math.abs(o.sx - sx) < 16 && Math.abs(o.sy - sy) < 16);
              if (g) {
                g.n++;
                g.ids.push(t.id);
                if (ex > g.ex) { g.ex = ex; g.expires = expires; }
              } else {
                groups.push({ color, dir: t.direction === 'down' ? 1 : t.direction === 'up' ? -1 : 0, sx, sy, ex, expires, n: 1, key: t.id, ids: [t.id], edge, entry });
              }
            }
            tradeHits.current = groups.filter((g) => g.sx <= plotW + 20).map((g) => ({ x: g.sx, y: g.sy, ids: g.ids }));
            return groups.map((g) => {
              if (g.sx > plotW + 20) return null;
              const end = Math.min(Math.max(g.sx, g.ex), plotW - 2);
              const left = g.expires ? countdown(g.expires - now) : null;
              const pillW = left && left.length > 5 ? 58 : 44;
              const pillX = Math.min(end - pillW / 2, plotW - pillW - 2);
              const edgeText = g.edge ? `${g.entry.toFixed(decimals)} ${g.edge === 1 ? 'above' : 'below'}` : '';
              const edgeW = edgeText.length * 6.6 + 12;
              return (
                <G key={g.key}>
                  {/* trade line: soft glow under a crisp 2 px line */}
                  {g.edge ? null : <Line x1={g.sx} x2={end} y1={g.sy} y2={g.sy} stroke={g.color} strokeOpacity={0.18} strokeWidth={8} strokeLinecap="round" />}
                  {g.edge ? null : <Line x1={g.sx} x2={end} y1={g.sy} y2={g.sy} stroke={g.color} strokeWidth={2} strokeLinecap="round" />}
                  {/* beyond the prices shown: where its entry really is */}
                  {g.edge ? (
                    <G>
                      <Rect x={g.sx - 16 - edgeW} y={g.sy - 10} width={edgeW} height={20} rx={10} fill={colors.bg} stroke={g.color} strokeWidth={1} />
                      <SvgText x={g.sx - 16 - edgeW / 2} y={g.sy + 4} fill={colors.text} fontSize={12} fontFamily={font.semibold} textAnchor="middle">{edgeText}</SvgText>
                    </G>
                  ) : null}
                  {/* end: ring on the expiry line + time-left pill above it */}
                  {g.expires && !g.edge ? (
                    <G>
                      <Circle cx={end} cy={g.sy} r={5} fill={colors.bg} stroke={g.color} strokeWidth={2} />
                      <Rect x={pillX} y={g.sy - 30} width={pillW} height={20} rx={10} fill={g.color} />
                      <SvgText x={pillX + pillW / 2} y={g.sy - 16} fill={colors.dark} fontSize={12} fontFamily={font.semibold} textAnchor="middle">{left}</SvgText>
                    </G>
                  ) : null}
                  {/* start: glow, filled dot with the direction arrow */}
                  <Circle cx={g.sx} cy={g.sy} r={17} fill={g.color} fillOpacity={0.16} />
                  <Circle cx={g.sx} cy={g.sy} r={11} fill={g.color} stroke={colors.bg} strokeWidth={2} />
                  {g.dir ? (
                    <Path d={`M${g.sx} ${g.sy - 5 * g.dir} V${g.sy + 5 * g.dir} M${g.sx - 4} ${g.sy + g.dir} L${g.sx} ${g.sy + 5 * g.dir} L${g.sx + 4} ${g.sy + g.dir}`}
                      stroke={colors.dark} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  ) : null}
                  {/* how many trades this marker stands for */}
                  {g.n > 1 ? (
                    <G>
                      <Circle cx={g.sx + 11} cy={g.sy - 11} r={8.5} fill={colors.text} stroke={colors.bg} strokeWidth={2} />
                      <SvgText x={g.sx + 11} y={g.sy - 7.5} fill={colors.dark} fontSize={10} fontFamily={font.bold} textAnchor="middle">{g.n > 9 ? '9+' : g.n}</SvgText>
                    </G>
                  ) : null}
                </G>
              );
            });
          })()}

          {/* current price line, countdown bubble, price tag */}
          {price != null ? (
            <G>
              <Line x1={0} x2={plotW} y1={y(price)} y2={y(price)} stroke={colors.text} strokeOpacity={0.5} strokeWidth={1} />
              {live0 ? (
                <G>
                  <Rect x={bubbleX} y={y(price) - 12} width={52} height={24} rx={12} fill={colors.surface2} stroke={colors.border} />
                  <SvgText x={bubbleX + 26} y={y(price) + 5} fill={colors.text} fontSize={14} textAnchor="middle" fontFamily={font.medium}>{countdown(candleLeftMs)}</SvgText>
                </G>
              ) : null}
              <Rect x={plotW + 2} y={y(price) - 12} width={AXIS_W - 4} height={24} rx={8} fill={colors.text} />
              <SvgText x={plotW + AXIS_W / 2} y={y(price) + 5} fill={colors.dark} fontSize={13} textAnchor="middle" fontFamily={font.bold}>{price.toFixed(decimals)}</SvgText>
            </G>
          ) : null}

          {/* momentum bar: red share on top, green share below */}
          <G>
            <Rect x={0} y={TOP} width={3} height={plotH * (1 - momentumUp / 100)} fill={colors.down} />
            <Rect x={0} y={TOP + plotH * (1 - momentumUp / 100)} width={3} height={plotH * (momentumUp / 100)} fill={colors.up} />
            {/* Share of down/up price ticks over the last 40 ticks: price momentum, not people. */}
            <SvgText x={6} y={TOP + 12} fill={colors.down} fontSize={12}>{`↓ ${100 - momentumUp}%`}</SvgText>
            <SvgText x={6} y={TOP + plotH - 4} fill={colors.up} fontSize={12}>{`↑ ${momentumUp}%`}</SvgText>
          </G>
        </G>
      </Svg>
    </View>

      {/* indicator names (tap to edit or remove): overlays top-left, each panel's name at its top */}
      {overlays.length ? (
        <View style={[styles.legend, { top: TOP + (props.crosshair ? 42 : 20) }]} pointerEvents="box-none">
          {overlays.map(({ s, out }) => (
            <Press key={s.id} haptic={false} onPress={() => props.onIndicatorPress?.(s.id)} style={styles.legendRow} accessibilityLabel={`Edit ${indTitle(s)}`}>
              <Txt style={styles.legendTxt}>{indTitle(s)}</Txt>
              {out.lines.slice(0, 3).map((l, j) => {
                const v = l.v[Math.min(anchorIdx, l.v.length - 1)];
                return v != null ? <Txt key={j} style={[styles.legendTxt, { color: l.color }]}>{v.toFixed(decimals)}</Txt> : null;
              })}
            </Press>
          ))}
        </View>
      ) : null}
      {panes.map(({ s, out }, k) => (
        <Press key={s.id} haptic={false} onPress={() => props.onIndicatorPress?.(s.id)} style={[styles.legendRow, styles.paneLabel, { top: TOP + plotH + k * paneH + 4 }]} accessibilityLabel={`Edit ${indTitle(s)}`}>
          <Txt style={styles.legendTxt}>{indTitle(s)}</Txt>
          {lastVals(out).slice(0, 3).map((x, j) => <Txt key={j} style={[styles.legendTxt, { color: x.color }]}>{fmtVal(x.v)}</Txt>)}
        </Press>
      ))}

      {/* desktop crosshair: snapped to the hovered candle, with its time, the price under the mouse and a "+" to add a level */}
      {props.crosshair ? (() => {
        const inPlot = hover && hover.x >= 0 && hover.x <= plotW && hover.y >= TOP && hover.y <= TOP + plotH;
        let hc: Candle | null = null;
        if (inPlot) for (const c of visible) if (!hc || Math.abs(xOfTime(c.time) - hover!.x) < Math.abs(xOfTime(hc.time) - hover!.x)) hc = c;
        const shown = hc ?? candles[candles.length - 1];
        const hp = inPlot ? priceOfY(hover!.y) : null;
        const cx = hc ? xOfTime(hc.time) : null;
        return (
          <>
            {inPlot && cx != null ? (
              <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill} pointerEvents="none">
                <Line x1={cx} x2={cx} y1={TOP} y2={TOP + plotH} stroke={colors.muted} strokeOpacity={0.6} strokeDasharray="3 4" />
                <Line x1={0} x2={plotW} y1={hover!.y} y2={hover!.y} stroke={colors.muted} strokeOpacity={0.6} strokeDasharray="3 4" />
                <Rect x={cx - 34} y={size.h - TIME_H + 2} width={68} height={20} rx={6} fill={colors.surface2} stroke={colors.border} />
                <SvgText x={cx} y={size.h - TIME_H + 16} fill={colors.text} fontSize={12} textAnchor="middle" fontFamily={font.medium}>{fmtTime(hc!.time)}</SvgText>
              </Svg>
            ) : null}
            {inPlot && hp != null ? (
              <Press haptic={false} onPress={() => props.onAddLevel?.(Number(hp.toFixed(decimals)))} accessibilityLabel={`Add a line at ${hp.toFixed(decimals)}`}
                style={[styles.addLevel, { top: hover!.y - 12, left: plotW - 6 - 18 }]}>
                <Plus size={13} color={colors.text} strokeWidth={2.5} />
                <Txt style={{ fontSize: 12, fontFamily: font.semibold, fontVariant: ['tabular-nums'] }}>{hp.toFixed(decimals)}</Txt>
              </Press>
            ) : null}
            {shown ? (
              <View style={styles.ohlc} pointerEvents="none">
                {(['open', 'high', 'low', 'close'] as const).map((k) => (
                  <View key={k} style={{ flexDirection: 'row', gap: 4 }}>
                    <Txt style={{ fontSize: 12, color: colors.faint }}>{k[0].toUpperCase()}</Txt>
                    <Txt style={{ fontSize: 12, color: colors.muted, fontVariant: ['tabular-nums'] }}>{shown[k].toFixed(decimals)}</Txt>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        );
      })() : null}

      {/* zoom and back to now: together, centred under the prices */}
      <View style={[styles.controls, { left: 0, width: plotW, bottom: TIME_H + panes.length * paneH + 8 }]} pointerEvents="box-none">
        <LiquidView radius={14} bezel={8} thickness={10} flip style={styles.zoomGroup}>
          <Press style={styles.zoomBtn} haptic={false} onPress={() => setStep((s) => clampStep(s / 1.3))} accessibilityLabel="Zoom out">
            <InkIcon icon={Minus} size={16} />
          </Press>
          <View style={styles.zoomLine} />
          <Press style={styles.zoomBtn} haptic={false} onPress={() => setStep((s) => clampStep(s * 1.3))} accessibilityLabel="Zoom in">
            <InkIcon icon={Plus} size={16} />
          </Press>
        </LiquidView>
        <LiquidView radius={14} bezel={8} thickness={10} flip style={styles.nowBox}>
          <Press style={styles.nowBtn} haptic={false} disabled={settled} onPress={onArrow} accessibilityLabel={live0 ? 'Clear view' : 'Back to now'} accessibilityState={{ disabled: settled }}>
            <InkIcon icon={ChevronRight} size={18} />
          </Press>
        </LiquidView>
      </View>
    </View>
  );
}

export const CandleChart = memo(ChartInner);

const styles = createStyles(() => ({
  controls: { position: 'absolute', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  legend: { position: 'absolute', left: 10, gap: 2, alignItems: 'flex-start' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: veil.legend },
  legendTxt: { fontSize: 12, color: colors.muted, fontVariant: ['tabular-nums'] },
  paneLabel: { position: 'absolute', left: 6 },
  addLevel: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 8, borderRadius: 8, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  ohlc: { position: 'absolute', left: 12, top: TOP + 22, flexDirection: 'row', gap: 12 },
  zoomGroup: { flexDirection: 'row', alignItems: 'center', height: 44, borderRadius: 14, overflow: 'hidden' },
  zoomBtn: { width: 44, height: 42, alignItems: 'center', justifyContent: 'center' },
  zoomLine: { width: 1, height: 20, backgroundColor: colors.border },
  nowBox: { borderRadius: 14 },
  nowBtn: { width: 44, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
}));
