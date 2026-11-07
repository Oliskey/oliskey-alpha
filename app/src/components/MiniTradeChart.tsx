// Trade detail chart: tick line (teal, 10% fill), dashed open/close lines, entry marker, direction-coloured entry line.
import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import type { TradeDetail } from '@/lib/api';
import { colors } from '@/theme';

export function MiniTradeChart({ trade, height = 150 }: { trade: TradeDetail; height?: number }) {
  const [w, setW] = useState(0);
  const ticks = trade.ticks.map((t) => ({ ts: new Date(t.ts).getTime(), p: Number(t.price) }));
  const open = Number(trade.open_quote);
  const close = Number(trade.close_quote ?? open);
  const t0 = new Date(trade.open_time).getTime();
  const t1 = new Date(trade.close_time ?? trade.open_time).getTime();
  const span = Math.max(1, t1 - t0);
  const from = t0 - span * 0.25;
  const to = t1 + span * 0.15;

  const prices = [...ticks.map((t) => t.p), open, close];
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const pad = (hi - lo || open * 0.0002) * 0.2;
  const x = (ts: number) => ((ts - from) / (to - from)) * w;
  const y = (p: number) => 10 + (1 - (p - (lo - pad)) / (hi - lo + 2 * pad)) * (height - 20);
  const color = trade.result === 'win' ? colors.up : trade.direction === 'down' ? colors.down : trade.direction === 'up' ? colors.up : colors.zone;

  const pts = ticks.length ? ticks : [{ ts: t0, p: open }, { ts: t1, p: close }];
  const line = pts.map((t, i) => `${i ? 'L' : 'M'}${x(t.ts).toFixed(1)} ${y(t.p).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts[pts.length - 1].ts).toFixed(1)} ${height} L${x(pts[0].ts).toFixed(1)} ${height} Z`;
  const ex = x(t0), ey = y(open);
  const dir = trade.direction === 'down' ? -1 : 1;   // arrow tip at ey - 6*dir: up points up, down points down

  return (
    <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w ? (
        <Svg width={w} height={height}>
          <Path d={area} fill={colors.teal} fillOpacity={0.1} />
          <Path d={line} stroke={colors.teal} strokeWidth={1.5} fill="none" />
          <Line x1={ex} x2={ex} y1={0} y2={height} stroke={colors.muted} strokeDasharray="3 4" />
          <Line x1={x(t1)} x2={x(t1)} y1={0} y2={height} stroke={colors.muted} strokeDasharray="3 4" />
          <Line x1={ex} x2={x(t1)} y1={ey} y2={ey} stroke={trade.direction === 'down' ? colors.down : trade.direction === 'up' ? colors.up : colors.zone} strokeWidth={1.5} />
          <Circle cx={ex} cy={ey} r={12} fill={trade.direction === 'down' ? colors.down : trade.direction === 'up' ? colors.up : colors.zone} />
          {trade.direction ? (
            <Path d={`M${ex} ${ey + 6 * dir} V${ey - 6 * dir} M${ex - 4} ${ey - 2 * dir} L${ex} ${ey - 6 * dir} L${ex + 4} ${ey - 2 * dir}`} stroke={colors.dark} strokeWidth={2} fill="none" />
          ) : null}
          <Circle cx={x(t1)} cy={y(close)} r={3} fill={color} />
        </Svg>
      ) : null}
    </View>
  );
}
