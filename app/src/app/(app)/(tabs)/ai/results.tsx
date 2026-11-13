// Practice and testnet results: what is held now, orders sent, and every fill. Read-only; the server records it all.
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Inbox } from 'lucide-react-native';
import { Segmented } from '@/components/UnderlineTabs';
import { api } from '@/lib/api';
import { type Fill, type Order, type Position, decimal, envLabel, pair, statusWord, strategyName, tone, usdt } from '@/lib/aiTrading';
import { dayLabel, clock12 } from '@/lib/format';
import { card, colors, font, type } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { EmptyState, Spinner } from '@/ui/kit';
import { Page } from '@/ui/Page';
import { Txt } from '@/ui/Txt';

type Tab = 'holdings' | 'orders' | 'history';
const TABS = [{ key: 'holdings', label: 'Holdings' }, { key: 'orders', label: 'Orders' }, { key: 'history', label: 'History' }] as const;
const when = (iso: string) => `${dayLabel(iso)} ${clock12(iso)}`;
const colorOf = (v: string) => ({ up: colors.up, down: colors.down, plain: colors.text }[tone(v)]);

function Line({ left, sub, right, rightColor, icon }: { left: string; sub: string; right: string; rightColor?: string; icon?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: colors.border }}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt style={{ fontSize: 15, fontFamily: font.semibold }}>{left}</Txt>
        <Txt style={{ fontSize: 13, color: colors.muted }} numberOfLines={1}>{sub}</Txt>
      </View>
      <Txt style={[type.cardValue, { color: rightColor ?? colors.text, textAlign: 'right' }]}>{right}</Txt>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return <EmptyState icon={<Inbox size={28} color={colors.muted} />} title="Nothing yet" text={text} />;
}

export default function Results() {
  const [tab, setTab] = useState<Tab>('holdings');
  const positions = useQuery({ queryKey: ['trading', 'positions'], queryFn: () => api<Position[]>('/trading/positions'), enabled: tab === 'holdings', refetchInterval: 30_000 });
  const orders = useQuery({ queryKey: ['trading', 'orders'], queryFn: () => api<Order[]>('/trading/trading/orders'), enabled: tab === 'orders', refetchInterval: 30_000 });
  const history = useQuery({ queryKey: ['trading', 'history'], queryFn: () => api<Fill[]>('/trading/trading/history'), enabled: tab === 'history' });
  const q = tab === 'holdings' ? positions : tab === 'orders' ? orders : history;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="narrow" />
      <Page width="narrow" gap={16}>
        <View style={{ gap: 6 }}>
          <Txt style={type.screenTitle}>Practice results</Txt>
          <Txt style={{ color: colors.demo, fontSize: 14, fontFamily: font.medium }}>Practice and testnet only · real prices, no real money</Txt>
        </View>
        <Segmented tabs={TABS} value={tab} onChange={setTab} stretch />
        {q.isLoading ? <Spinner /> : q.error ? (
          <EmptyState title="Could not load" text={(q.error as Error).message}><Button label="Try again" variant="secondary" onPress={() => q.refetch()} /></EmptyState>
        ) : tab === 'holdings' ? (
          positions.data?.length ? (
            <View style={[card, { overflow: 'hidden' }]}>
              {positions.data.map((p, i) => (
                <Line key={`${p.strategy_id}${p.symbol}${p.environment}${i}`} left={`${pair(p.symbol)} · ${statusWord(p.status)}`}
                  sub={`${strategyName(p.strategy_id)} · ${envLabel(p.environment)} · holds ${decimal(p.quantity, 6)}`}
                  right={`${tone(p.realised_pnl) === 'up' ? '+' : ''}${usdt(p.realised_pnl)}`} rightColor={colorOf(p.realised_pnl)} />
              ))}
            </View>
          ) : <Empty text="When a strategy buys on practice, it shows here." />
        ) : tab === 'orders' ? (
          orders.data?.length ? (
            <View style={[card, { overflow: 'hidden' }]}>
              {orders.data.map((o) => (
                <Line key={o.id} icon={o.side === 'buy' ? <ArrowUpRight size={18} color={colors.up} /> : <ArrowDownRight size={18} color={colors.down} />}
                  left={`${o.side === 'buy' ? 'Buy' : 'Sell'} ${pair(o.symbol)}`}
                  sub={`${strategyName(o.strategy_id)} · ${envLabel(o.environment)} · ${when(o.created_at)}${o.status_detail ? ` · ${o.status_detail}` : ''}`}
                  right={statusWord(o.status)} rightColor={o.status === 'rejected' || o.status === 'failed' ? colors.down : colors.text} />
              ))}
            </View>
          ) : <Empty text="Orders the strategies send appear here." />
        ) : history.data?.length ? (
          <View style={[card, { overflow: 'hidden' }]}>
            {history.data.map((f, i) => (
              <Line key={`${f.filled_at}${i}`} icon={f.side === 'buy' ? <ArrowUpRight size={18} color={colors.up} /> : <ArrowDownRight size={18} color={colors.down} />}
                left={`${f.side === 'buy' ? 'Bought' : 'Sold'} ${decimal(f.quantity, 6)} ${f.symbol.replace(/USDT$/, '')}`}
                sub={`at ${decimal(f.price, 2)} · fee ${decimal(f.fee, 6)} ${f.fee_asset} · ${when(f.filled_at)}`}
                right={usdt(f.quote_quantity)} />
            ))}
          </View>
        ) : <Empty text="Every completed buy and sell is listed here." />}
      </Page>
    </SafeAreaView>
  );
}
