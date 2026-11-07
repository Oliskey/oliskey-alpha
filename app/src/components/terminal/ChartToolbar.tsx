// Vertical chart toolbar (bottom-left of the chart): time frame, chart type, signals, analysis tools.
// Time frame and chart type open small popovers next to the bar; signals and tools hand off to their panels.
import { useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { Check, DraftingCompass, Radio } from 'lucide-react-native';
import { duration } from '@/lib/format';
import { colors, font, createStyles, veil } from '@/theme';
import { glass } from '@/ui/glass';
import { InkIcon, InkText, LiquidView, useGlassInk } from '@/ui/liquid';
import { Press } from '@/ui/Press';
import { Blink } from '@/ui/kit';
import { Txt } from '@/ui/Txt';
import type { ChartType } from '../CandleChart';

const TYPES: { key: ChartType; label: string }[] = [
  { key: 'area', label: 'Area chart' }, { key: 'candles', label: 'Japanese candlesticks' },
  { key: 'heikin', label: 'Heikin Ashi' }, { key: 'bar', label: 'Bars' },
];

export function ChartToolbar({ tf, tfs, areaLabel, chartType, TypeIcon, onTf, onType, onSignals, onTools, toolsBadge, toolsActive, signalsActive, signalAlert = false, signalOn = false, signalCount = 0, bottom = 34 }: {
  tf: number; tfs: number[]; areaLabel: string | null; chartType: ChartType;
  TypeIcon: (p: { type: ChartType; size: number; color: string }) => ReactElement;
  onTf: (sec: number) => void; onType: (t: ChartType) => void; onSignals: () => void; onTools: () => void;
  toolsBadge: number; toolsActive: boolean; signalsActive?: boolean; signalAlert?: boolean; signalCount?: number; signalOn?: boolean;
  bottom?: number;   // distance from the chart's bottom edge (above the oscillator panels)
}) {
  const [pop, setPop] = useState<null | 'tf' | 'type'>(null);
  const toggle = (p: 'tf' | 'type') => setPop((v) => (v === p ? null : p));
  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      {pop === 'tf' ? (
        <View style={[styles.pop, glass('regular')]}>
          <Txt style={styles.popTitle}>{chartType === 'area' ? 'Chart time frame' : 'Candle time frame'}</Txt>
          <View style={styles.grid}>
            {tfs.map((s) => (
              <Press key={s} haptic={false} onPress={() => { onTf(s); setPop(null); }} style={[styles.cell, s === tf && styles.cellOn]} accessibilityLabel={`Time frame ${duration(s)}`}>
                <Txt style={{ fontSize: 15, fontFamily: font.semibold }}>{duration(s)}</Txt>
              </Press>
            ))}
          </View>
        </View>
      ) : null}
      {pop === 'type' ? (
        <View style={[styles.pop, glass('regular'), { width: 260 }]}>
          <Txt style={styles.popTitle}>Chart type</Txt>
          {TYPES.map((t) => (
            <Press key={t.key} haptic={false} onPress={() => { onType(t.key); setPop(null); }} style={styles.typeRow} accessibilityLabel={t.label}>
              <TypeIcon type={t.key} size={18} color={colors.text} />
              <Txt style={{ flex: 1, fontSize: 15 }}>{t.label}</Txt>
              {chartType === t.key ? <Check size={18} color={colors.text} /> : null}
            </Press>
          ))}
        </View>
      ) : null}
      <LiquidView radius={14} bezel={8} thickness={10} flip style={styles.bar}>
        <Press haptic={false} style={styles.btn} onPress={() => toggle('tf')} accessibilityLabel="Time frame">
          <InkText style={{ fontSize: 14, fontFamily: font.bold }}>{areaLabel ?? duration(tf)}</InkText>
        </Press>
        <Press haptic={false} style={styles.btn} onPress={() => toggle('type')} accessibilityLabel="Chart type">
          <TypeInk type={chartType} Icon={TypeIcon} />
        </Press>
        <Press haptic={false} style={styles.btn} onPress={() => { setPop(null); onSignals(); }} accessibilityLabel={signalAlert ? `Signals, new signal, ${signalCount} available` : signalOn ? `Signals, signal active, ${signalCount} available` : 'Signals'}>
          <Blink on={signalOn} pulse={signalAlert} count={signalCount}><InkIcon icon={Radio} size={19} color={signalsActive ? colors.accent : signalOn ? colors.upVivid : undefined} /></Blink>
        </Press>
        <Press haptic={false} style={styles.btn} onPress={() => { setPop(null); onTools(); }} accessibilityLabel="Technical analysis">
          <InkIcon icon={DraftingCompass} size={19} color={toolsActive ? colors.accent : undefined} />
          {toolsBadge ? <View style={styles.badge}><Txt style={{ fontSize: 9, color: colors.dark, fontFamily: font.bold }}>{toolsBadge}</Txt></View> : null}
        </Press>
      </LiquidView>
    </View>
  );
}

function TypeInk({ type, Icon }: { type: ChartType; Icon: (p: { type: ChartType; size: number; color: string }) => ReactElement }) {
  const ink = useGlassInk();
  return <Icon type={type} size={19} color={ink.text} />;
}

const styles = createStyles(() => ({
  wrap: { position: 'absolute', left: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bar: { borderRadius: 14, paddingVertical: 4 },
  btn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 4, right: 3, minWidth: 14, height: 14, borderRadius: 7, backgroundColor: colors.demo, alignItems: 'center', justifyContent: 'center' },
  pop: { position: 'absolute', left: 52, bottom: 0, width: 300, borderRadius: 18, padding: 14, gap: 8 },
  popTitle: { fontSize: 15, fontFamily: font.bold, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell: { width: '31%', height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cellOn: { backgroundColor: veil.selected },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, paddingHorizontal: 6, borderRadius: 10 },
}));
