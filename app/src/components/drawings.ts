// Chart drawing tools: one place for their data shapes, how many taps each needs, and the hints shown while drawing.
// Picked from what traders use most on mobile charts (TradingView, TradeStation, cTrader, OANDA): levels, rays, trend
// lines, zones, Fibonacci retracements and a measure tool. Saved drawings from earlier versions (hline, trend) still load.
import {
  AlignVerticalSpaceAround, ArrowRightFromLine, Equal, Fan, Minus, MoveUpRight, RectangleHorizontal, RulerDimensionLine,
  SeparatorVertical, TrendingUp, type LucideIcon,
} from 'lucide-react-native';

export type Pt = { t: number; p: number };
export type Drawing =
  | { kind: 'hline'; price: number }                                           // level across the whole chart
  | { kind: 'hray'; a: Pt }                                                    // level from a candle to the right
  | { kind: 'vline'; t: number }                                               // a moment in time
  | { kind: 'trend' | 'ray' | 'rect' | 'fib' | 'fibfan' | 'measure'; a: Pt; b: Pt }   // two-point tools
  | { kind: 'channel'; a: Pt; b: Pt; c: Pt };                                 // base line a-b, parallel line through c
export type DrawTool = 'none' | Drawing['kind'];

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
export const FAN_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786] as const;

export const TOOLS: { tool: Exclude<DrawTool, 'none'>; label: string; hint: string; taps: 1 | 2 | 3; Icon: LucideIcon }[] = [
  { tool: 'hline', label: 'Horizontal line', hint: 'Support or resistance across the chart', taps: 1, Icon: Minus },
  { tool: 'hray', label: 'Horizontal ray', hint: 'A level from one candle to the right', taps: 1, Icon: ArrowRightFromLine },
  { tool: 'vline', label: 'Vertical line', hint: 'Mark a moment, such as news or an expiry', taps: 1, Icon: SeparatorVertical },
  { tool: 'trend', label: 'Trend line', hint: 'Connect two highs or two lows', taps: 2, Icon: TrendingUp },
  { tool: 'ray', label: 'Ray', hint: 'A trend line that continues into the future', taps: 2, Icon: MoveUpRight },
  { tool: 'rect', label: 'Zone', hint: 'Shade a supply or demand area', taps: 2, Icon: RectangleHorizontal },
  { tool: 'fib', label: 'Fibonacci retracement', hint: 'Tap the start, then the end of a move', taps: 2, Icon: AlignVerticalSpaceAround },
  { tool: 'fibfan', label: 'Fibonacci fan', hint: 'Sloping support and resistance from the start of a move', taps: 2, Icon: Fan },
  { tool: 'channel', label: 'Parallel channel', hint: 'Two parallel lines around a trend: tap two points, then the width', taps: 3, Icon: Equal },
  { tool: 'measure', label: 'Measure', hint: 'Price change, % and time between two points', taps: 2, Icon: RulerDimensionLine },
];

export const toolInfo = (tool: DrawTool) => TOOLS.find((t) => t.tool === tool);

// What to tell the user while a tool is active.
export function stepHint(tool: DrawTool, pending: number): string {
  const t = toolInfo(tool);
  if (!t) return '';
  const havePending = pending > 0;
  if (tool === 'channel') return pending === 0 ? 'Tap the first point of the trend' : pending === 1 ? 'Tap the second point of the trend' : 'Tap where the parallel line goes';
  if (tool === 'fibfan') return havePending ? 'Tap the end of the move' : 'Tap the start of the move';
  if (t.taps === 1) return tool === 'vline' ? 'Tap the chart where the vertical line goes' : `Tap the chart to place the ${t.label.toLowerCase()}`;
  if (tool === 'fib') return havePending ? 'Tap the end of the move' : 'Tap the start of the move';
  if (tool === 'measure') return havePending ? 'Tap the second point to measure' : 'Tap the first point to measure from';
  return havePending ? `Tap the second point of the ${t.label.toLowerCase()}` : `Tap the first point of the ${t.label.toLowerCase()}`;
}

// Builds the drawing once enough taps have arrived (1, 2 or 3 depending on the tool).
export function makeDrawing(tool: DrawTool, a: Pt, b?: Pt, c?: Pt): Drawing | null {
  switch (tool) {
    case 'hline': return { kind: 'hline', price: a.p };
    case 'hray': return { kind: 'hray', a };
    case 'vline': return { kind: 'vline', t: a.t };
    case 'trend': case 'ray': case 'rect': case 'fib': case 'fibfan': case 'measure': return b ? { kind: tool, a, b } : null;
    case 'channel': return b && c ? { kind: 'channel', a, b, c } : null;
    default: return null;
  }
}

// Price at a Fibonacci level: 0% at the end of the move (b), 100% at its start (a).
export const fibPrice = (d: { a: Pt; b: Pt }, level: number) => d.b.p + (d.a.p - d.b.p) * level;
