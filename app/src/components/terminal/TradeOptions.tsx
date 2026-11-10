// Risk-free and Order switches for the trade panel (phone and desktop).
//  Risk-free: a lost trade returns the stake; 3 per day on the demo account (the server enforces it).
//  Order: Up/Down place a pending order instead of trading now. It opens By price (when the price reaches the
//  opening price) or By time (at a chosen time, up to 7 days ahead). The server opens it at its own price then.
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { CircleHelp, Clock3, Minus, Plus, ShieldCheck, X, type LucideIcon } from 'lucide-react-native';
import { clock12, price as fmtPrice } from '@/lib/format';
import { colors, createStyles, font, veil } from '@/theme';
import { glass } from '@/ui/glass';
import { Press } from '@/ui/Press';
import { Reveal } from '@/ui/Reveal';
import { Toggle } from '@/ui/kit';
import { Txt } from '@/ui/Txt';
import { Segmented } from '../UnderlineTabs';

export type TradeOptionsState = {
  riskFree: boolean; orderOn: boolean; trigger: number | null;
  orderBy?: 'price' | 'time'; triggerAt?: number | null;   // By time: when the order opens (ms)
};

const STEP_MIN = 5;                     // time steps of 5 minutes
const MAX_DAYS = 7;
// the next 5-minute mark at least 10 minutes away: a sensible first suggestion
export const defaultTriggerAt = (now = Date.now()) => {
  const step = STEP_MIN * 60_000;
  return Math.ceil((now + 10 * 60_000) / step) * step;
};
export const fmtTriggerTime = (ms: number) => clock12(ms);
export const fmtTriggerDate = (ms: number) => {
  const d = new Date(ms), today = new Date();
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86400_000);
  const label = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return days === 0 ? `Today, ${label}` : days === 1 ? `Tomorrow, ${label}` : label;
};

const ORDER_TABS = [{ key: 'price', label: 'By price' }, { key: 'time', label: 'By time' }] as const;

export function TradeOptions({ state, onChange, riskLeft, riskAllowed, decimals, price, onHelp, compact, hideRisk, orderLabel = 'Order' }: {
  state: TradeOptionsState; onChange: (next: TradeOptionsState) => void;
  riskLeft: number | null; riskAllowed: boolean; decimals: number; price: number | null;
  onHelp: (topic: 'riskFree' | 'order') => void; compact?: boolean;
  hideRisk?: boolean;      // Forex: risk-free does not apply
  orderLabel?: string;
}) {
  const step = 10 ** -decimals * (decimals > 2 ? 5 : 1);
  const trigger = state.trigger ?? price ?? 0;
  const setTrigger = (v: number) => onChange({ ...state, trigger: Math.max(step, Number(v.toFixed(decimals))) });
  const [draft, setDraft] = useState<string | null>(null);   // the opening price while it is being typed
  const by = state.orderBy ?? 'price';
  const at = state.triggerAt ?? defaultTriggerAt();
  const setAt = (ms: number) => {
    const min = defaultTriggerAt() - 5 * 60_000, max = Date.now() + MAX_DAYS * 86400_000;
    onChange({ ...state, triggerAt: Math.min(max, Math.max(min, ms)) });
  };
  const riskDisabled = !riskAllowed || riskLeft === 0;
  const h = compact ? 44 : 56;
  const row = (label: string, value: boolean, onToggle: (v: boolean) => void, disabled: boolean, sub: string | null, topic: 'riskFree' | 'order', Icon: LucideIcon) => (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: h }, disabled && { opacity: 0.55 }]}>
      <Icon size={18} color={value ? colors.accent : colors.muted} />
      <View style={{ flex: 1, paddingVertical: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt style={{ fontSize: 15, fontFamily: font.semibold }}>{label}</Txt>
          {sub ? <Txt style={{ fontSize: 12, color: colors.muted }}>{sub}</Txt> : null}
          <Press hitSlop={8} haptic={false} onPress={() => onHelp(topic)} accessibilityLabel={`What is ${label}?`}>
            <CircleHelp size={15} color={colors.muted} />
          </Press>
        </View>
      </View>
      <Toggle accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onToggle} />
    </View>
  );
  const nudge = (label: string, Icon: typeof Minus, onPress: () => void) => (
    <Press style={styles.nudge} onPress={onPress} accessibilityLabel={label} haptic={false}><Icon size={17} color={colors.text} /></Press>
  );

  return (
    <View style={{ gap: 8 }}>
      {hideRisk ? null : (
        <View style={[styles.card, glass('regular', { shadow: false })]}>
          {row('Risk-free', state.riskFree && !riskDisabled, (v) => onChange({ ...state, riskFree: v }), riskDisabled,
            !riskAllowed ? 'demo only' : riskLeft == null ? null : `${riskLeft}/3`, 'riskFree', ShieldCheck)}
        </View>
      )}
      <View style={[styles.card, glass('regular', { shadow: false })]}>
        {row(orderLabel, state.orderOn, (v) => onChange({ ...state, orderOn: v, trigger: v ? (price ?? null) : null, triggerAt: v ? (state.triggerAt ?? defaultTriggerAt()) : null }), false,
          null, 'order', Clock3)}
        <Reveal show={state.orderOn}>
          <View style={{ gap: 8, paddingHorizontal: 10, paddingBottom: 10 }}>
            <Segmented stretch tabs={ORDER_TABS} value={by} onChange={(k) => onChange({ ...state, orderBy: k, triggerAt: state.triggerAt ?? defaultTriggerAt() })} />
            {by === 'price' ? (
              <View style={styles.field}>
                <View style={{ flex: 1 }}>
                  <Txt style={styles.fieldLabel}>Opening price</Txt>
                  <TextInput value={draft ?? fmtPrice(trigger, decimals)} keyboardType="decimal-pad" accessibilityLabel="Opening price"
                    onChangeText={(v) => setDraft(v.replace(/[^0-9.]/g, ''))}
                    onBlur={() => { const n = Number(draft); if (draft != null && n > 0) setTrigger(n); setDraft(null); }}
                    style={[styles.fieldInput, { outlineStyle: 'none' } as object]} />
                </View>
                {nudge('Lower trigger price', Minus, () => setTrigger(trigger - step))}
                {nudge('Raise trigger price', Plus, () => setTrigger(trigger + step))}
                {nudge('Reset to the current price', X, () => { setDraft(null); onChange({ ...state, trigger: price ?? null }); })}
              </View>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <View style={[styles.field, styles.timeField]}>
                  <View style={{ flex: 1 }}>
                    <Txt style={styles.fieldLabel} numberOfLines={1}>Time</Txt>
                    <Txt style={styles.fieldValue} numberOfLines={1}>{fmtTriggerTime(at)}</Txt>
                  </View>
                  {nudge('Earlier time', Minus, () => setAt(at - STEP_MIN * 60_000))}
                  {nudge('Later time', Plus, () => setAt(at + STEP_MIN * 60_000))}
                </View>
                <View style={[styles.field, styles.timeField]}>
                  <View style={{ flex: 1 }}>
                    <Txt style={styles.fieldLabel} numberOfLines={1}>Date</Txt>
                    <Txt style={styles.fieldValue} numberOfLines={1}>{fmtTriggerDate(at)}</Txt>
                  </View>
                  {nudge('Previous day', Minus, () => setAt(at - 86400_000))}
                  {nudge('Next day', Plus, () => setAt(at + 86400_000))}
                </View>
              </View>
            )}
            <Txt style={{ fontSize: 12, color: colors.muted, paddingHorizontal: 4 }}>
              {by === 'price' ? 'Opens when the price reaches this level' : 'Opens at this time at the market price, your local time'}
            </Txt>
          </View>
        </Reveal>
      </View>
    </View>
  );
}

const styles = createStyles(() => ({
  card: { borderRadius: 16, overflow: 'hidden' as const },
  field: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2, minHeight: 50, borderRadius: 12, paddingLeft: 12, paddingRight: 4, backgroundColor: veil.field, borderWidth: 1, borderColor: colors.border },
  // side by side when there is room for both, one above the other when there is not; text never breaks
  timeField: { flexGrow: 1, flexBasis: 165, minWidth: 165 },
  fieldLabel: { fontSize: 11, color: colors.muted },
  fieldValue: { fontSize: 16, fontFamily: font.semibold, fontVariant: ['tabular-nums' as const] },
  fieldInput: { color: colors.text, fontSize: 16, fontFamily: font.semibold, padding: 0 },
  nudge: { width: 34, height: 40, alignItems: 'center' as const, justifyContent: 'center' as const },
}));

export const OPTION_HELP = {
  riskFree: 'A risk-free trade gives your amount back if it loses. If it wins you get the normal payout. You have 3 risk-free trades a day on the demo account, for Fixed Time and InZone.',
  order: 'With Order on, pressing Up or Down does not trade now. It places an order that opens the trade automatically: By price, when the price reaches your opening price; By time, at the time you pick (up to 7 days ahead). It opens at the server price at that moment. You can cancel it until then; a price order expires after 24 hours.',
};
