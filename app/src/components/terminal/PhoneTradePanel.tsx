// Phone trade panel, one layout per mode. The amount and the trade buttons are always visible, so nobody trades without
// seeing how much. The other options sit behind them and are pulled out with the handle (drag up or tap), pushed back the
// same way (drag down or tap). The choice is remembered.
//   Fixed Time  duration, Risk-free, Order                     | amount | Down · Up
//   InZone      duration, Risk-free, Order                     | amount | Open Trade + what you earn
//   Forex       10/20/50% of balance, multiplier, volume, pending order, auto close | amount | Sell · Buy
//   Stocks      not available yet (needs a licensed data provider and a live account)
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Animated, Easing, PanResponder, ScrollView, TextInput, View } from 'react-native';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, CircleHelp, Clock3, Lock, ShieldCheck } from 'lucide-react-native';
import type { TradeMode } from '@/lib/api';
import { duration, money, moneyShort, price as fmtPrice, type AccountType } from '@/lib/format';
import { PREVIEW } from '@/lib/preview';
import { getPref, setPref } from '@/lib/storage';
import { colors, font, SIDE, createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { glass } from '@/ui/glass';
import { LiquidBox } from '@/ui/liquid';
import { Stepper, Toggle } from '@/ui/kit';
import { prefersReducedMotion, Press } from '@/ui/Press';
import { Reveal } from '@/ui/Reveal';
import { Txt } from '@/ui/Txt';
import { useTabBarSpace } from '../TabBar';
import { defaultTriggerAt, fmtTriggerTime, TradeOptions, type TradeOptionsState } from './TradeOptions';

const OPTIONS_MAX_H = 170;   // the options scroll beyond this; the buttons below never move

export function PhoneTradePanel(p: {
  mode: TradeMode | 'stocks'; accType: AccountType; balance: number;
  amount: number; setAmount: (f: (v: number) => number) => void; amountStep: (v: number) => number;
  durationSec: number; stepDuration: (dir: 1 | -1) => void;
  leverage: number; payout: number; zonePct: number;
  opts: TradeOptionsState; setOpts: (o: TradeOptionsState) => void; riskLeft: number | null; riskAllowed: boolean;
  decimals: number; price: number | null; onHelp: (t: 'riskFree' | 'order') => void;
  takeProfit: string; setTakeProfit: (v: string) => void; stopLoss: string; setStopLoss: (v: string) => void;
  busy: boolean; onOpen: (dir: 'up' | 'down' | null) => void;
  locked?: boolean;   // no connection: trading paused
  onSheet: (s: 'amount' | 'duration' | 'leverage' | 'how') => void;
  onMode: (m: 'fixed_time') => void;
}) {
  const tabSpace = useTabBarSpace();   // the panel runs down behind the floating pill
  const [autoClose, setAutoClose] = useState(!!(p.takeProfit || p.stopLoss));
  const [open, setOpen] = useState(false);   // hidden by default: the chart gets the room
  const [shown, setShown] = useState(true);   // closed options leave the page, so keyboards and screen readers skip them too
  const [progress] = useState(() => new Animated.Value(0));
  const now = useRef(0);
  const loaded = useRef(false);
  useEffect(() => { getPref('tradePanelOpen').then((v) => { if (v === '1') { setOpen(true); setShown(true); progress.setValue(1); now.current = 1; } loaded.current = true; }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (loaded.current) void setPref('tradePanelOpen', open ? '1' : '0'); }, [open]);
  // 0 = options hidden behind the buttons, 1 = pulled out. The options follow the finger while dragging, then glide
  // to whichever side is nearer (or the way it was flicked).
  useEffect(() => { const id = progress.addListener(({ value }) => { now.current = value; }); return () => progress.removeListener(id); }, [progress]);
  // a section that just opened inside the options (Order settings, Auto close fields) scrolls into view
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    if (!p.opts.orderOn && !autoClose) return;
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 320);
    return () => clearTimeout(t);
  }, [p.opts.orderOn, p.opts.orderBy, autoClose]);
  const contentH = useRef(0);
  const [measured, setMeasured] = useState(0);
  const firstMeasure = useRef(false);
  const glideTo = (to: 0 | 1) => {
    if (to === 1) setShown(true);
    Animated.timing(progress, { toValue: to, duration: prefersReducedMotion() ? 0 : 320, easing: Easing.bezier(0.32, 0.72, 0, 1), useNativeDriver: false })
      .start(({ finished }) => { if (finished && to === 0) setShown(false); });
    setOpen(to === 1);
  };
  const toggle = () => glideTo(now.current > 0.5 ? 0 : 1);
  const start = useRef(1);
  const pan = useRef(PanResponder.create({
    // capture: take the drag from the Press inside once the finger clearly moves up or down
    onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { progress.stopAnimation(); start.current = now.current; setShown(true); },
    onPanResponderMove: (_e, g) => {
      const h = contentH.current || 1;
      progress.setValue(Math.max(0, Math.min(1, start.current - g.dy / h)));
    },
    onPanResponderRelease: (_e, g) => {
      // a flick or a clear drag (a fifth of the way) is enough; a tiny nudge goes back where it was
      const moved = now.current - start.current;
      glideTo(g.vy < -0.3 || moved > 0.2 ? 1 : g.vy > 0.3 || moved < -0.2 ? 0 : start.current > 0.5 ? 1 : 0);
    },
  })).current;
  const cur = p.accType === 'DEMO' ? 'α' : p.accType;

  if (p.mode === 'stocks') {
    return (
      <View style={[styles.panel, { paddingTop: 16, paddingBottom: 8 + tabSpace }]}>
        <Txt style={{ fontSize: 16, fontFamily: font.semibold }}>Stocks are not available yet</Txt>
        <Txt style={styles.note}>Stock trading needs a licensed market-data provider and a live account. Until then you can practise on Fixed Time, InZone and Forex.</Txt>
        <Button label="Trade Fixed Time" height={46} onPress={() => p.onMode('fixed_time')} />
      </View>
    );
  }

  const forex = p.mode === 'forex';
  // extras that are ON while the options are hidden show as small icons, so nothing is a surprise and nothing is noise
  const riskOn = p.opts.riskFree && p.riskAllowed && !forex;
  const orderOn = p.opts.orderOn;
  const orderAt = orderOn ? (p.opts.orderBy === 'time' ? fmtTriggerTime(p.opts.triggerAt ?? defaultTriggerAt()) : fmtPrice(p.opts.trigger ?? p.price ?? 0, p.decimals)) : null;
  const summary = forex ? [`${p.leverage}x`, p.takeProfit || p.stopLoss ? 'Auto close' : null].filter(Boolean).join(' · ') : '';

  const handle = (
    <View {...pan.panHandlers}>
      <Press haptic={false} hoverable={false} cursor="grab" onPress={toggle} style={styles.handleArea}
        accessibilityLabel={open ? 'Hide trade options' : 'Show trade options'} accessibilityState={{ expanded: open }}>
        <View style={styles.handle} />
        <Reveal show={!open && (!!summary || riskOn || orderOn)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {summary ? <Txt style={styles.summary} numberOfLines={1}>{summary}</Txt> : null}
            {riskOn ? <View style={styles.extra} accessibilityLabel="Risk-free is on"><ShieldCheck size={14} color={colors.up} /><Txt style={[styles.summary, { color: colors.up }]}>Risk-free</Txt></View> : null}
            {orderOn ? <View style={styles.extra} accessibilityLabel={`Order at ${orderAt}`}><Clock3 size={14} color={colors.accent} /><Txt style={[styles.summary, { color: colors.accent }]}>{orderAt}</Txt></View> : null}
            <ChevronUp size={16} color={colors.muted} />
          </View>
        </Reveal>
      </Press>
    </View>
  );

  const share = p.balance > 0 ? (p.amount / p.balance) * 100 : null;
  const shareText = share == null ? '' : share < 1 ? '< 1%' : `${Math.round(share)}%`;
  const amountStepper = (
    <Stepper compact style={{ flex: 1 }} label="Amount" value={money(p.amount, p.accType, { decimals: 0 })} onPressValue={() => p.onSheet('amount')}
      onMinus={() => p.setAmount((v) => Math.max(1, v - p.amountStep(v - 1)))} onPlus={() => p.setAmount((v) => v + p.amountStep(v))} />
  );
  // the two choices every trade needs, side by side; the second is the time (Fixed Time, InZone) or the multiplier (Forex)
  const amountBar = (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {forex ? (
          <Press haptic={false} onPress={() => p.onSheet('leverage')} accessibilityLabel={`Multiplier ${p.leverage}x`} style={{ flex: 1 }}>
            <LiquidBox radius={24} style={styles.pick}>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Txt style={styles.pickLabel}>Multiplier</Txt>
                <Txt style={styles.pickValue}>{p.leverage}x</Txt>
              </View>
              <ChevronDown size={18} color={colors.muted} />
            </LiquidBox>
          </Press>
        ) : (
          <Stepper compact style={{ flex: 1 }} label="Time" value={duration(p.durationSec)} onPressValue={() => p.onSheet('duration')}
            onMinus={() => p.stepDuration(-1)} onPlus={() => p.stepDuration(1)} />
        )}
        {amountStepper}
      </View>
      {share != null && share > 100 ? <Txt style={[styles.note, { color: colors.down }]}>More than your balance. Lower the amount.</Txt>
        : share != null && share >= 20 ? <Txt style={[styles.note, { color: colors.demo }]}>Big trade: {shareText} of your balance.</Txt> : null}
    </View>
  );
  const how = (
    <Press haptic={false} hitSlop={10} onPress={() => p.onSheet('how')} accessibilityLabel="How it works">
      <CircleHelp size={18} color={colors.muted} />
    </Press>
  );
  const fixedOptions = (
    <>
      <TradeOptions state={p.opts} onChange={p.setOpts} riskLeft={p.riskLeft} riskAllowed={p.riskAllowed} decimals={p.decimals} price={p.price} onHelp={p.onHelp} compact />
    </>
  );
  const forexOptions = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Txt style={styles.lineLabel}>Use</Txt>
        {[0.1, 0.2, 0.5].map((pct) => (
          <Press key={pct} haptic={false} onPress={() => p.setAmount(() => Math.max(1, Math.floor(p.balance * pct)))} style={[styles.pct, { flex: 1 }, glass('regular', { shadow: false })]} accessibilityLabel={`${pct * 100}% of balance`}>
            <Txt style={{ fontSize: 14, fontFamily: font.semibold }}>{pct * 100}%</Txt>
          </Press>
        ))}
      </View>
      <View style={styles.line}>
        <Txt style={styles.lineLabel}>Volume</Txt>
        <View style={styles.dots} />
        <Txt style={styles.lineValue}>{moneyShort(p.amount * p.leverage, p.accType)}</Txt>
      </View>
      <TradeOptions state={p.opts} onChange={p.setOpts} riskLeft={p.riskLeft} riskAllowed={false} decimals={p.decimals} price={p.price} onHelp={p.onHelp} compact hideRisk orderLabel="Pending order" />
      <LiquidBox radius={16} style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Txt style={{ fontSize: 15, fontFamily: font.semibold }}>Auto close</Txt>
          <Txt style={{ fontSize: 12, color: colors.muted }}>Take profit or stop loss</Txt>
        </View>
        <Toggle accessibilityLabel="Auto close" value={autoClose} onValueChange={(v) => { setAutoClose(v); if (!v) { p.setTakeProfit(''); p.setStopLoss(''); } }} />
      </LiquidBox>
      <Reveal show={autoClose}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([['Take profit', p.takeProfit, p.setTakeProfit], ['Stop loss', p.stopLoss, p.setStopLoss]] as const).map(([label, value, set]) => (
            <LiquidBox key={label} radius={14} style={styles.amountBox}>
              <Txt style={{ fontSize: 11, color: colors.muted }}>{label}, {cur}</Txt>
              <TextInput value={value} onChangeText={(v) => set(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="Off" placeholderTextColor={colors.muted}
                accessibilityLabel={label} style={[styles.amountInput, { outlineStyle: 'none' } as object]} />
            </LiquidBox>
          ))}
        </View>
      </Reveal>
    </>
  );

  const order = p.opts.orderOn;
  const buttons = p.locked ? (
    <View style={[styles.lockedBar, glass('regular', { shadow: false })]} accessibilityRole="text" accessibilityLabel="Trading paused until the connection is back">
      <Lock size={18} color={colors.muted} />
      <Txt style={{ fontSize: 15, fontFamily: font.semibold, color: colors.muted }}>{PREVIEW ? 'Trading is off on this preview' : 'Trading paused · reconnecting'}</Txt>
    </View>
  ) : p.mode === 'inzone' ? (
    <Button label={order ? 'Place order' : 'Open Trade'} height={46} loading={p.busy} onPress={() => p.onOpen(null)} />
  ) : (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Button style={{ flex: 1 }} variant="down" height={46} spread disabled={p.busy} onPress={() => p.onOpen('down')}
        label={forex ? (order ? 'Sell order' : 'Sell') : order ? 'Down order' : 'Down'} icon={<ArrowDown size={22} color={colors.dark} />} />
      <Button style={{ flex: 1 }} variant="up" height={46} spread disabled={p.busy} onPress={() => p.onOpen('up')}
        label={forex ? (order ? 'Buy order' : 'Buy') : order ? 'Up order' : 'Up'} icon={<ArrowUp size={22} color={colors.dark} />} />
    </View>
  );
  // one short line: what you can win (InZone: if the price stays inside the band), and a ? for the full explanation
  const win = p.payout > 0 ? `+${moneyShort(p.amount * p.payout / 100, p.accType)}` : null;
  const footer = (
    <View style={[styles.footer, { justifyContent: 'center' }]}>
      {forex ? (
        <Txt style={styles.note}>Volume {moneyShort(p.amount * p.leverage, p.accType)}</Txt>
      ) : win ? (
        <Txt style={styles.winLine}>
          Win <Txt style={styles.winValue}>{win}</Txt>
          {p.mode === 'inzone' ? <Txt style={styles.winLine}>{`  ·  stays within ±${p.zonePct.toFixed(2)}%`}</Txt> : null}
        </Txt>
      ) : <Txt style={styles.note}>Loading…</Txt>}
      {how}
    </View>
  );

  return (
    <View style={[styles.panel, { paddingBottom: 8 + tabSpace }]}>
      {handle}
      <Animated.View style={{
        overflow: 'hidden', opacity: progress,
        height: measured ? progress.interpolate({ inputRange: [0, 1], outputRange: [0, measured] }) : undefined,
        marginBottom: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }),
      }} pointerEvents={open ? 'auto' : 'none'}>
        <View style={[measured ? { position: 'absolute', left: 0, right: 0, top: 0 } : null, !shown && { display: 'none' }]}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h <= 0) return;
            contentH.current = h; setMeasured(h);
            if (!firstMeasure.current) { firstMeasure.current = true; if (now.current === 0) setShown(false); }   // measured while hidden: now take it off the page
          }}>
          <ScrollView ref={scroller} showsVerticalScrollIndicator={false} style={{ maxHeight: OPTIONS_MAX_H, flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
            {forex ? forexOptions : fixedOptions}
          </ScrollView>
        </View>
      </Animated.View>
      {p.locked ? null : amountBar}
      {buttons}
      {footer}
    </View>
  );
}

const styles = createStyles(() => ({
  panel: {
    backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0,
    borderColor: colors.border, paddingHorizontal: SIDE, paddingBottom: 8, gap: 8,
  },
  handleArea: { alignItems: 'center', gap: 6, paddingTop: 8, paddingBottom: 2, minHeight: 22 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.muted },
  summary: { fontSize: 13, color: colors.muted, fontVariant: ['tabular-nums'], flexShrink: 1 },
  note: { fontSize: 12, color: colors.muted, flexShrink: 1 },
  winLine: { fontSize: 14, color: colors.muted },
  winValue: { fontSize: 15, fontFamily: font.bold, color: colors.up, fontVariant: ['tabular-nums'] },
  extra: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pick: { height: 48, borderRadius: 24, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  pickLabel: { fontSize: 11, color: colors.muted, marginBottom: -2 },
  pickValue: { fontSize: 17, fontFamily: font.medium, fontVariant: ['tabular-nums'] },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between' },
  amountBox: { flex: 1, height: 48, borderRadius: 14, paddingHorizontal: 12, justifyContent: 'center' },
  amountInput: { color: colors.text, fontSize: 17, fontFamily: font.semibold, padding: 0 },
  pct: { width: 52, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 26 },
  lineLabel: { fontSize: 13, color: colors.muted },
  lineValue: { fontSize: 13, fontFamily: font.semibold, fontVariant: ['tabular-nums'] },
  dots: { flex: 1, borderBottomWidth: 1, borderStyle: 'dotted', borderColor: colors.border, marginTop: 6 },
  lockedBar: { height: 46, borderRadius: 23, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, paddingHorizontal: 14, height: 44 },
}));
