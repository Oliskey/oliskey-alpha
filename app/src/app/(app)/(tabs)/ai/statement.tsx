// Statement: profit that is counted (realised, from completed sells) kept apart from profit that is only an estimate
// (open holdings at today's price, never charged). The 15% fee applies only to counted profit above the highest level
// already charged. Every number comes from the server as exact text.
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Landmark, Lock, ShieldCheck } from 'lucide-react-native';
import { api } from '@/lib/api';
import { type Statement as S, tone, usdt } from '@/lib/aiTrading';
import { dayLabel } from '@/lib/format';
import { card, colors, font, type } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { DottedRow, EmptyState, Spinner } from '@/ui/kit';
import { More } from '@/ui/List';
import { Page } from '@/ui/Page';
import { Txt } from '@/ui/Txt';

const signed = (v: string) => `${tone(v) === 'up' ? '+' : ''}${usdt(v)}`;
const colorOf = (v: string) => ({ up: colors.up, down: colors.down, plain: colors.text }[tone(v)]);

export default function Statement() {
  const q = useQuery({ queryKey: ['trading', 'statement'], queryFn: () => api<S>('/trading/financial-statements') });
  const s = q.data;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="narrow" />
      <Page width="narrow" gap={18}>
        <View style={{ gap: 6 }}>
          <Txt style={type.screenTitle}>Statement</Txt>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <ShieldCheck size={16} color={colors.up} />
            <Txt style={{ color: colors.muted, fontSize: 14 }}>Oliskey never holds your money.</Txt>
          </View>
        </View>
        {q.isLoading ? <Spinner /> : q.error || !s ? (
          <EmptyState title="Could not load" text={(q.error as Error)?.message ?? ''}><Button label="Try again" variant="secondary" onPress={() => q.refetch()} /></EmptyState>
        ) : (
          <>
            <View style={[card, { padding: 16, gap: 6 }]}>
              <Txt style={{ fontSize: 13, color: colors.muted }}>Counted profit · from completed sells</Txt>
              <Txt style={[type.balance, { color: colorOf(s.realisedNetProfit) }]}>{signed(s.realisedNetProfit)}</Txt>
              <Txt style={{ fontSize: 13, color: colors.muted }}>after {usdt(s.tradingFees)} exchange fees</Txt>
            </View>
            <View style={[card, { padding: 16, gap: 6 }]}>
              <Txt style={{ fontSize: 13, color: colors.muted }}>Estimated profit · what you still hold, at today's price</Txt>
              <Txt style={[type.sectionTitle, { color: colorOf(s.unrealisedProfitEstimate) }]}>{signed(s.unrealisedProfitEstimate)}</Txt>
              <Txt style={{ fontSize: 13, color: colors.demo }}>An estimate only. It changes with the price and is never charged.</Txt>
            </View>

            <View style={[card, { padding: 16, gap: 10 }]}>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Landmark size={18} color={colors.accent} />
                <Txt style={{ fontSize: 16, fontFamily: font.semibold, flex: 1 }}>15% fee on new counted profit</Txt>
              </View>
              <DottedRow label="Already charged up to" value={usdt(s.alreadyCharged)} />
              <DottedRow label="New profit above that" value={usdt(s.eligibleNow)} />
              <DottedRow label="Fee if you withdrew now" value={usdt(s.commissionNow)} />
              <DottedRow label="You keep" value={usdt(s.customerShareNow)} valueColor={colors.up} />
              <DottedRow label="Fees paid" value={usdt(s.commissionPaid)} />
              <DottedRow label="Fees to pay" value={usdt(s.commissionOutstanding)} />
              <Button label="Pay fees · Opens with live trading" variant="secondary" height={44} disabled iconLeft={<Lock size={16} color={colors.text} />} />
              <More label="How the fee works">
                <Txt style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>
                  We charge 15% only on counted profit that is higher than the highest level we already charged. If you lose and then
                  earn it back, you pay nothing on the recovery. Practice and testnet results are never charged.
                </Txt>
              </More>
            </View>

            <View style={[card, { padding: 16, gap: 10 }]}>
              <Txt style={{ fontSize: 16, fontFamily: font.semibold }}>Your exchange account</Txt>
              {s.balanceReported ? (
                <>
                  <DottedRow label="Started with" value={usdt(s.startingCapital)} />
                  <DottedRow label="Balance now (from the exchange)" value={usdt(s.exchangeBalance)} />
                </>
              ) : <Txt style={{ color: colors.muted, fontSize: 14 }}>No real-money balance yet. Real-money trading is not open.</Txt>}
            </View>

            {s.invoices.length ? (
              <View style={[card, { padding: 16, gap: 10 }]}>
                <Txt style={{ fontSize: 16, fontFamily: font.semibold }}>Invoices</Txt>
                {s.invoices.map((i) => (
                  <DottedRow key={i.number} label={`${i.number} · ${dayLabel(i.issued_at)}`} value={`${usdt(i.commission)} · ${i.status}`} />
                ))}
              </View>
            ) : null}
            {s.notes.map((n) => <Txt key={n} style={{ color: colors.muted, fontSize: 12, lineHeight: 18, paddingHorizontal: 4 }}>{n}</Txt>)}
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
