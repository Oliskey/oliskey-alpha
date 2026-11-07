import { useEffect, useState } from 'react';
import { liveUpdate } from '@/lib/liveBatch';
import { View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpDown } from 'lucide-react-native';
import { api, type Trade, type TradeMode } from '@/lib/api';
import { money } from '@/lib/format';
import { getPref, setPref } from '@/lib/storage';
import { useAccount } from '@/context/AccountContext';
import { useLivePrices } from '@/hooks/useMarket';
import { ActiveTradeSheet } from '@/components/ActiveTradeSheet';
import { pnlColor, previewPnl, TradeCard } from '@/components/TradeCard';
import { TradeDetailSheet } from '@/components/TradeDetailSheet';
import { UnderlineTabs } from '@/components/UnderlineTabs';
import { useAiTrader, useTradeCounts } from '@/hooks/useCounts';
import { ListenCard } from './scanner';
import { colors, font, SIDE, type, createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { EmptyState, SectionHeader, Skeleton, Tooltip } from '@/ui/kit';
import { Txt } from '@/ui/Txt';
import { Page } from '@/ui/Page';

type Tab = TradeMode | 'stocks';
const TABS = [
  { key: 'fixed_time', label: 'Fixed Time' }, { key: 'inzone', label: 'InZone' },
  { key: 'forex', label: 'Forex' }, { key: 'stocks', label: 'Stocks' },
] as const;
const NAMES: Record<Tab, string> = { fixed_time: 'Fixed Time', inzone: 'InZone', forex: 'Forex', stocks: 'Stocks' };

export default function Trades() {
  const { activeAccount } = useAccount();
  const [tab, setTab] = useState<Tab>('fixed_time');
  const [selected, setSelected] = useState<Trade | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showTip, setShowTip] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => liveUpdate(() => setNow(Date.now()), setNow), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { getPref('tip-ai').then((v) => setShowTip(v !== '1')); }, []);

  const counts = useTradeCounts();
  const accountId = activeAccount?.id;
  const accType = activeAccount?.type ?? 'DEMO';
  const openQ = useQuery({
    queryKey: ['trades', 'open'],
    queryFn: () => api<{ trades: Trade[] }>('/trades?status=open&limit=100'),
    select: (d) => d.trades,
  });
  const historyQ = useQuery({
    // only what finished today, at most 4; everything else is under Show All
    queryKey: ['trades', 'history', tab, accountId, new Date().toDateString()],
    queryFn: () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return api<{ trades: Trade[] }>(`/trades?status=closed&mode=${tab}&accountId=${accountId}&limit=4&from=${encodeURIComponent(today.toISOString())}`);
    },
    enabled: !!accountId && tab !== 'stocks',
    select: (d) => d.trades,
  });
  const active = (openQ.data ?? []).filter((t) => t.mode === tab && t.account_id === accountId);
  // The AI trader's own demo trades, shown beside yours on demo. They use its money and only it can close them.
  const ai = useAiTrader();
  const aiOpen = accType === 'DEMO' ? (ai.data?.positions ?? []).filter((t) => t.mode === tab) : [];
  const aiDone = accType === 'DEMO' ? (ai.data?.finished_trades ?? []).filter((t) => t.mode === tab) : [];
  const prices = useLivePrices([...new Set([...active, ...aiOpen].map((t) => t.asset_id))]);
  const totalAmount = active.reduce((s, t) => s + Number(t.amount), 0);
  const totalPnl = active.reduce((s, t) => s + (previewPnl(t, prices[t.asset_id]) ?? 0), 0);
  // Looked up from the live list, so the sheet closes by itself once the server settles the trade.
  const activeTrade = (openQ.data ?? []).find((t) => t.id === activeId) ?? null;

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <Page top={40} gap={18}>
        <Txt style={type.screenTitle}>Trades</Txt>
        <UnderlineTabs tabs={TABS.map((t) => ({ ...t, count: t.key === 'stocks' ? 0 : counts.byMode(t.key) }))} value={tab} onChange={setTab} />

        {tab === 'stocks' ? (
          <View style={styles.stocks}>
            <View style={styles.stocksIcon}><ArrowUpDown size={30} color={colors.muted} /></View>
            <Txt style={{ color: colors.muted, fontSize: 16, textAlign: 'center' }}>Buying and selling stocks will be available on live accounts.</Txt>
          </View>
        ) : (
          <>
            {active.length ? (
              <View style={{ gap: 10 }}>
                <Txt style={styles.section}>Active Trades</Txt>
                <View style={styles.totals}>
                  <View>
                    <Txt style={styles.totalLabel}>Total amount</Txt>
                    <Txt style={styles.totalValue}>{money(totalAmount, accType)}</Txt>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt style={styles.totalLabel}>Profit and loss</Txt>
                    <Txt style={[styles.totalValue, { color: pnlColor(totalPnl) }]}>{money(totalPnl, accType, { sign: true })}</Txt>
                  </View>
                </View>
                {active.map((t) => (
                  <TradeCard key={t.id} trade={t} accountType={accType} livePrice={prices[t.asset_id]} now={now} onPress={() => setActiveId(t.id)} />
                ))}
              </View>
            ) : (
              <EmptyState icon={<ArrowUpDown size={26} color={colors.muted} />} title="No open trades" text={`Your active ${NAMES[tab]} trades on this account show here.`}>
                <Button variant="secondary" height={48} label="Explore Assets" onPress={() => router.navigate('/market')} />
              </EmptyState>
            )}

            {accType === 'DEMO' && ai.data?.listening ? (
              <View style={{ gap: 8 }}>
                {!aiOpen.length && !aiDone.length ? <SectionHeader title="AI trades" action="See why" onAction={() => router.push({ pathname: '/scanner', params: { tab: 'ai' } })} /> : null}
                {ai.data.listening.filter((l) => l.mode === tab).map((l) => <ListenCard key={l.mode} l={l} />)}
              </View>
            ) : null}
            {aiOpen.length || aiDone.length ? (
              <View style={{ gap: 8 }}>
                <SectionHeader title="AI trades" action="See why" onAction={() => router.push({ pathname: '/scanner', params: { tab: 'ai' } })} />
                <Txt style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>The AI's own practice account, for comparison. These don't change your balance.</Txt>
                {[...aiOpen, ...aiDone].map((t) => (
                  <TradeCard key={t.id} ai trade={t} accountType="DEMO" livePrice={prices[t.asset_id]} now={now} onPress={() => router.push({ pathname: '/scanner', params: { tab: 'ai' } })} />
                ))}
              </View>
            ) : null}

            <SectionHeader title="History" action="Show All" onAction={() => router.push('/history')} />
            {showTip && (historyQ.data?.length ?? 0) > 0 ? (
              <Tooltip
                title="Analyze your trades with AI"
                body="Open any trade below to see what shaped the result and what to try next time."
                onDismiss={() => { setShowTip(false); void setPref('tip-ai', '1'); }}
              />
            ) : null}
            {historyQ.isLoading ? (
              [0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={62} style={{ borderRadius: 14 }} />)
            ) : historyQ.data?.length ? (
              <View style={{ gap: 8 }}>
                {historyQ.data.map((t) => <TradeCard key={t.id} showOwner trade={t} accountType={accType} onPress={() => setSelected(t)} />)}
              </View>
            ) : (
              <Txt style={{ color: colors.muted }}>No trades finished today.</Txt>
            )}
          </>
        )}
      </Page>
      <TradeDetailSheet trade={selected} accountType={accType} onClose={() => setSelected(null)} />
      <ActiveTradeSheet trade={activeTrade} accountType={accType} onClose={() => setActiveId(null)} />
    </SafeAreaView>
  );
}

const styles = createStyles(() => ({
  page: { paddingHorizontal: SIDE, paddingTop: 40, paddingBottom: 30, gap: 18 },
  section: { fontSize: 20, fontFamily: font.bold, letterSpacing: -0.3 },
  totals: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { color: colors.muted, fontSize: 13 },
  totalValue: { fontSize: 16, fontFamily: font.semibold, marginTop: 2, fontVariant: ['tabular-nums'] },
  stocks: { alignItems: 'center', gap: 16, paddingVertical: 60 },
  stocksIcon: { width: 70, height: 70, borderRadius: 35, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
}));
