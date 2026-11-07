// Technical analysis panel: a search box and four folding sections (Indicators, Oscillators, Drawing, Strategies).
// Indicators and oscillators can be added several times (e.g. EMA 20 and EMA 50), edited and removed.
// Strategies are starting layouts of indicators with a short "how to read it"; they are not signals.
import { useState, type ReactNode } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { ChartColumn, ChevronDown, ChevronLeft, ChevronUp, DraftingCompass, Pencil, Plus, RotateCcw, Search, Shapes, SlidersHorizontal, Trash2, X, type LucideIcon } from 'lucide-react-native';
import { colors, font, createStyles } from '@/theme';
import { Press } from '@/ui/Press';
import { Stepper } from '@/ui/kit';
import { Txt } from '@/ui/Txt';
import { defaults, IND_DEFS, indDef, indTitle, type IndKey, type IndSetting } from '../indicators';

export type AnalysisTab = 'indicator' | 'oscillator' | 'drawing' | 'strategy';
const SECTIONS: { key: AnalysisTab; label: string; Icon: LucideIcon }[] = [
  { key: 'indicator', label: 'Indicators', Icon: DraftingCompass }, { key: 'oscillator', label: 'Oscillators', Icon: ChartColumn },
  { key: 'drawing', label: 'Drawing', Icon: Pencil }, { key: 'strategy', label: 'Strategies', Icon: Shapes },
];
export const MAX_PANES = 3;      // panels under the chart; more would squeeze the price too much
export const MAX_OVERLAYS = 6;

type Preset = { name: string; about: string; read: string; items: { key: IndKey; params?: number[] }[] };
export const STRATEGIES: Preset[] = [
  { name: 'Trend rider', about: 'Follow an established trend', read: 'Price above both averages with ADX over 25 suggests a strong uptrend; below both, a strong downtrend. ADX under 20 means no clear trend.', items: [{ key: 'ema', params: [20] }, { key: 'ema', params: [50] }, { key: 'adx' }] },
  { name: 'Range bounce', about: 'Turns at the edges of a range', read: 'In a sideways market, a touch of the upper band with RSI over 70 can stall; a touch of the lower band with RSI under 30 can bounce. In a strong trend bands get walked, so check the slope first.', items: [{ key: 'bollinger' }, { key: 'rsi' }] },
  { name: 'Breakout watch', about: 'Moves out of a quiet range', read: 'A close outside the channel while ATR rises shows a range breaking with more movement behind it. Breakouts often fail, so wait for the candle to close.', items: [{ key: 'donchian' }, { key: 'atr' }] },
  { name: 'Momentum shift', about: 'Early change of direction', read: 'MACD crossing its signal line and Stochastic leaving 20 or 80 in the same direction point to momentum turning. Both lag; they confirm rather than predict.', items: [{ key: 'macd' }, { key: 'stoch' }] },
  { name: 'Cloud trend', about: 'Trend and its support in one view', read: 'Price above the cloud with SAR dots below it describes an uptrend; below the cloud with dots above, a downtrend. Inside the cloud the trend is unclear.', items: [{ key: 'ichimoku' }, { key: 'psar' }] },
  { name: 'Swing map', about: 'The main swings and the trend stop', read: 'Zig Zag shows the swing highs and lows; Supertrend changes colour when price closes through it. Its last leg can still move until a new swing forms.', items: [{ key: 'zigzag' }, { key: 'supertrend' }] },
  { name: 'Alligator', about: 'Is the market sleeping or moving?', read: 'Tangled lines and short Gator bars mean the market is quiet; lines fanning out with growing bars mean a move is under way.', items: [{ key: 'alligator' }, { key: 'ao' }, { key: 'gator' }] },
];

let seq = 0;
export const newSetting = (key: IndKey, params?: number[]): IndSetting => ({ id: `${key}-${Date.now().toString(36)}-${seq++}`, key, params: params ?? defaults(key) });

export function AnalysisPanel({ indicators, onChange, drawing, tab, onTab, editId, onEdit, notify, liveCrypto, title = true }: {
  indicators: IndSetting[]; onChange: (list: IndSetting[]) => void;
  drawing: ReactNode;                       // the drawing tools list
  tab: AnalysisTab | null; onTab: (t: AnalysisTab | null) => void;   // the open section
  editId: string | null; onEdit: (id: string | null) => void;
  notify: (title: string, message: string) => void;
  liveCrypto: boolean;
  title?: boolean;                          // false when the host shows its own header
}) {
  const [query, setQuery] = useState('');
  const editing = indicators.find((s) => s.id === editId);
  const paneCount = indicators.filter((s) => indDef(s.key).pane).length;
  const overlayCount = indicators.length - paneCount;

  const add = (key: IndKey) => {
    const def = indDef(key);
    if (def.pane && paneCount >= MAX_PANES) return notify('Panel limit', `Up to ${MAX_PANES} panels fit under the chart. Remove one first.`);
    if (!def.pane && overlayCount >= MAX_OVERLAYS) return notify('Indicator limit', `Up to ${MAX_OVERLAYS} indicators on the price. Remove one first.`);
    onChange([...indicators, newSetting(key)]);
  };
  const remove = (id: string) => { onChange(indicators.filter((s) => s.id !== id)); if (id === editId) onEdit(null); };

  // ── settings of one indicator ──
  if (editing) {
    const def = indDef(editing.key);
    const setParam = (k: number, v: number) => onChange(indicators.map((s) => (s.id === editing.id ? { ...s, params: s.params.map((x, j) => (j === k ? v : x)) } : s)));
    return (
      <View style={{ gap: 10 }}>
        <View style={styles.head}>
          <Press haptic={false} onPress={() => onEdit(null)} accessibilityLabel="Back" style={styles.iconBtn}><ChevronLeft size={22} color={colors.text} /></Press>
          <Txt style={styles.title} numberOfLines={1}>{def.label}</Txt>
          <View style={styles.iconBtn} />
        </View>
        <Txt style={styles.about}>{def.about}</Txt>
        {def.params.map((prm, k) => {
          const stepBy = prm.step ?? 1;
          const fix = (v: number) => Number(Math.min(prm.max, Math.max(prm.min, v)).toFixed(stepBy < 1 ? 2 : 0));
          return (
            <View key={prm.name} style={{ gap: 4 }}>
              <Txt style={styles.label}>{prm.name}</Txt>
              <Stepper value={String(editing.params[k])} onMinus={() => setParam(k, fix(editing.params[k] - stepBy))} onPlus={() => setParam(k, fix(editing.params[k] + stepBy))} />
            </View>
          );
        })}
        {!def.params.length ? <Txt style={styles.about}>This one has no settings.</Txt> : null}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          {def.params.length ? (
            <Press style={styles.action} onPress={() => onChange(indicators.map((s) => (s.id === editing.id ? { ...s, params: defaults(s.key) } : s)))} accessibilityLabel="Reset settings">
              <RotateCcw size={18} color={colors.text} /><Txt style={{ fontSize: 15 }}>Reset</Txt>
            </Press>
          ) : null}
          <Press style={styles.action} onPress={() => remove(editing.id)} accessibilityLabel={`Remove ${def.label}`}>
            <Trash2 size={18} color={colors.down} /><Txt style={{ fontSize: 15, color: colors.down }}>Remove</Txt>
          </Press>
        </View>
      </View>
    );
  }

  const q = query.trim().toLowerCase();
  const match = (t: string) => !q || t.toLowerCase().includes(q);
  const presets = STRATEGIES.filter((p) => match(p.name) || match(p.about));

  const indicatorList = (group: 'indicator' | 'oscillator') => {
    const active = indicators.filter((s) => indDef(s.key).group === group);
    const list = IND_DEFS.filter((d) => d.group === group && (match(d.label) || match(d.about)));
    return (
      <>
        {active.length ? <Txt style={styles.section}>On the chart</Txt> : null}
        {active.map((s) => (
          <View key={s.id} style={styles.row}>
            <Press haptic={false} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }} onPress={() => onEdit(s.id)} accessibilityLabel={`Edit ${indTitle(s)}`}>
              <SlidersHorizontal size={18} color={colors.demo} />
              <Txt style={{ fontSize: 15 }} numberOfLines={1}>{indTitle(s)}</Txt>
            </Press>
            <Press haptic={false} hitSlop={8} onPress={() => remove(s.id)} accessibilityLabel={`Remove ${indTitle(s)}`}><X size={18} color={colors.muted} /></Press>
          </View>
        ))}
        {active.length ? <Txt style={styles.section}>Add</Txt> : null}
        {list.map((d) => {
          const off = d.needsVolume && !liveCrypto;
          return (
            <Press key={d.key} haptic={false} style={styles.row} onPress={() => add(d.key)} accessibilityLabel={`Add ${d.label}`}>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontSize: 15 }}>{d.label}</Txt>
                <Txt style={styles.hint}>{off ? 'Live crypto only: simulated prices have no real volume' : d.about}</Txt>
              </View>
              <Plus size={20} color={off ? colors.faint : colors.text} />
            </Press>
          );
        })}
        {!list.length ? <Txt style={styles.hint}>Nothing matches “{query}”.</Txt> : null}
      </>
    );
  };
  const strategyList = (
    <>
      <Txt style={styles.hint}>Ready-made sets of indicators with how to read them. They describe past prices and are not trading signals.</Txt>
      {presets.map((p) => (
        <View key={p.name} style={styles.preset}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontSize: 15, fontFamily: font.semibold }}>{p.name}</Txt>
              <Txt style={styles.hint}>{p.items.map((it) => indTitle({ id: '', key: it.key, params: it.params ?? defaults(it.key) })).join(' · ')}</Txt>
            </View>
            <Press haptic={false} style={styles.apply} accessibilityLabel={`Apply ${p.name}`}
              onPress={() => { onChange(p.items.map((it) => newSetting(it.key, it.params))); notify(p.name, 'Indicators replaced with this set.'); }}>
              <Txt style={{ fontSize: 14, fontFamily: font.semibold, color: colors.dark }}>Apply</Txt>
            </Press>
          </View>
          <Txt style={[styles.hint, { marginTop: 6 }]}>{p.read}</Txt>
        </View>
      ))}
      {!presets.length ? <Txt style={styles.hint}>Nothing matches “{query}”.</Txt> : null}
    </>
  );
  const content = (k: AnalysisTab) => (k === 'drawing' ? drawing : k === 'strategy' ? strategyList : indicatorList(k));
  // while searching every section with a match is open
  const isOpen = (k: AnalysisTab) => (q ? k !== 'drawing' : tab === k);

  return (
    <View style={{ gap: 10, flexShrink: 1 }}>
      {title ? <Txt style={[styles.title, { textAlign: 'center' }]}>Technical analysis</Txt> : null}
      <View style={styles.search}>
        <Search size={18} color={colors.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={colors.muted} accessibilityLabel="Search indicators and strategies" style={styles.input} />
        {query ? <Press haptic={false} onPress={() => setQuery('')} accessibilityLabel="Clear search"><X size={16} color={colors.muted} /></Press> : null}
      </View>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>
        {SECTIONS.filter((sec) => !q || sec.key !== 'drawing').map((sec) => {
          const on = isOpen(sec.key);
          const count = sec.key === 'indicator' || sec.key === 'oscillator' ? indicators.filter((x) => indDef(x.key).group === sec.key).length : 0;
          return (
            <View key={sec.key} style={styles.sectionBox}>
              <Press haptic={false} style={styles.sectionHead} onPress={() => onTab(on ? null : sec.key)} accessibilityLabel={sec.label} accessibilityState={{ expanded: on }}>
                <sec.Icon size={20} color={colors.text} />
                <Txt style={{ flex: 1, fontSize: 16, fontFamily: font.semibold }}>{sec.label}</Txt>
                {count ? <View style={styles.count}><Txt style={{ fontSize: 11, color: colors.dark, fontFamily: font.bold }}>{count}</Txt></View> : null}
                {on ? <ChevronUp size={20} color={colors.muted} /> : <ChevronDown size={20} color={colors.muted} />}
              </Press>
              {on ? <View style={{ paddingBottom: 10 }}>{content(sec.key)}</View> : null}
            </View>
          );
        })}
        <Txt style={[styles.hint, { marginTop: 14 }]}>These tools describe past prices. They do not predict the market, and every trading decision is yours.</Txt>
        {indicators.length ? (
          <Press haptic={false} style={styles.clear} onPress={() => onChange([])} accessibilityLabel="Remove all indicators">
            <Trash2 size={18} color={colors.down} /><Txt style={{ fontSize: 15, color: colors.down }}>Remove all indicators</Txt>
          </Press>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = createStyles(() => ({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontFamily: font.semibold, flexShrink: 1 },
  about: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  label: { fontSize: 12, color: colors.muted, paddingHorizontal: 6 },
  sectionBox: { borderBottomWidth: 1, borderColor: colors.border },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 52 },
  count: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: colors.demo, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: 12, color: colors.muted, marginTop: 8, marginBottom: 2 },
  hint: { fontSize: 12, color: colors.muted },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.surface2 },
  input: { flex: 1, color: colors.text, fontFamily: font.regular, fontSize: 15, outlineStyle: 'none' } as object,
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 6 },
  preset: { padding: 12, borderRadius: 14, backgroundColor: colors.surface2, marginTop: 8 },
  apply: { height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  action: { flex: 1, height: 46, borderRadius: 23, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  clear: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44 },
}));
