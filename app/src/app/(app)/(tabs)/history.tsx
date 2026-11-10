import { useMemo, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, History as HistoryIcon, PieChart } from 'lucide-react-native';
import { api, type Trade } from '@/lib/api';
import { dayLabel, money } from '@/lib/format';
import { useAccount } from '@/context/AccountContext';
import { useAssets } from '@/hooks/useMarket';
import { TradeCard } from '@/components/TradeCard';
import { TradeDetailSheet } from '@/components/TradeDetailSheet';
import { colors, font, SIDE, type, createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Chip, EmptyState, Spinner, SideScroll } from '@/ui/kit';
import { IconButton } from '@/ui/IconButton';
import { Press } from '@/ui/Press';
import { Sheet } from '@/ui/Sheet';
import { Txt } from '@/ui/Txt';
import { useColumn } from '@/ui/Page';

const NAMES = { DEMO: 'Demo account', NGN: 'NGN account', USDT: 'USDT account' } as const;
const TIMES = [
  { key: 'all', label: 'All Time', ms: 0 }, { key: 'day', label: 'Last 24 hours', ms: 864e5 },
  { key: 'week', label: 'Last 7 days', ms: 7 * 864e5 }, { key: 'month', label: 'Last 30 days', ms: 30 * 864e5 },
];
const RESULTS = [
  { key: 'any', label: 'Any Result' }, { key: 'win', label: 'Profit' }, { key: 'loss', label: 'Loss' }, { key: 'refund', label: 'Refund' },
];

type Row = { kind: 'header'; label: string; key: string; day: string } | { kind: 'trade'; trade: Trade; key: string };
type Totals = { start: string; trades: number; traded: number; won: number; lost: number; net: number };
// the person's own calendar day, as the server counts it
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: ZONE });

export default function History() {
  const column = useColumn('regular');
  const { me, activeAccount } = useAccount();
  const { assets } = useAssets();
  const [accountId, setAccountId] = useState(activeAccount?.id);
  const [assetId, setAssetId] = useState('all');
  const [time, setTime] = useState('all');
  const [result, setResult] = useState('any');
  const [picker, setPicker] = useState<null | 'account' | 'asset' | 'time' | 'result'>(null);
  const [selected, setSelected] = useState<Trade | null>(null);
  const [analytics, setAnalytics] = useState(false);
  const account = me?.accounts.find((a) => a.id === accountId) ?? activeAccount;

  const filters = useMemo(() => {
    const p = new URLSearchParams({ status: 'closed', limit: '30' });
    if (account) p.set('accountId', account.id);
    if (assetId !== 'all') p.set('assetId', assetId);
    if (result !== 'any') p.set('result', result);
    const ms = TIMES.find((t) => t.key === time)!.ms;
    if (ms) p.set('from', new Date(Date.now() - ms).toISOString());
    return p.toString();
  }, [account, assetId, result, time]);

  const q = useInfiniteQuery({
    queryKey: ['trades', 'all', filters],
    queryFn: ({ pageParam }) => api<{ trades: Trade[]; nextCursor: string | null }>(`/trades?${filters}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!account,
  });

  // totals for every finished trade on this account, whatever the filters show: worked out by the server
  const sums = useQuery({
    queryKey: ['trades', 'summary', account?.id, ZONE],
    queryFn: () => api<{ days: Totals[]; weeks: Totals[] }>(`/trades/summary?accountId=${account!.id}&tz=${encodeURIComponent(ZONE)}`),
    enabled: !!account, refetchInterval: 30_000,
  });
  const byDay = new Map((sums.data?.days ?? []).map((d) => [d.start, d]));

  const trades = q.data?.pages.flatMap((p) => p.trades) ?? [];
  const rows: Row[] = [];
  let lastDay = '';
  for (const t of trades) {
    const d = dayLabel(t.close_time ?? t.open_time);
    if (d !== lastDay) { rows.push({ kind: 'header', label: d, key: `h${d}`, day: dayKey(t.close_time ?? t.open_time) }); lastDay = d; }
    rows.push({ kind: 'trade', trade: t, key: t.id });
  }

  const options = picker === 'account' ? (me?.accounts ?? []).map((a) => ({ key: a.id, label: NAMES[a.type] }))
    : picker === 'asset' ? [{ key: 'all', label: 'All Assets' }, ...assets.map((a) => ({ key: a.id, label: a.name }))]
    : picker === 'time' ? TIMES : RESULTS;
  const current = picker === 'account' ? account?.id : picker === 'asset' ? assetId : picker === 'time' ? time : result;
  const pick = (k: string) => {
    if (picker === 'account') setAccountId(k); else if (picker === 'asset') setAssetId(k);
    else if (picker === 'time') setTime(k); else setResult(k);
    setPicker(null);
  };

  if (analytics) return <Analytics trades={trades} accountType={account?.type ?? 'DEMO'} onClose={() => setAnalytics(false)} />;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={[styles.bar, column]}>
        <IconButton label="Back" size={40} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}><ArrowLeft size={20} color={colors.text} strokeWidth={2.25} /></IconButton>
        <IconButton label="Analytics" size={40} onPress={() => setAnalytics(true)}><PieChart size={19} color={colors.text} strokeWidth={2.25} /></IconButton>
      </View>
      <Txt style={[type.screenTitle, column]}>History</Txt>
      {/* never shrinks: the list below takes what is left, or it squeezes these buttons in half */}
      <View style={{ flexShrink: 0 }}>
      <SideScroll style={[{ flexGrow: 0 }, column, { paddingHorizontal: 0 }]} contentContainerStyle={[styles.chips, { paddingHorizontal: column.paddingHorizontal as number }]}>
        <Chip label={account ? NAMES[account.type] : 'Account'} open={picker === 'account'} onPress={() => setPicker('account')} />
        <Chip label={assetId === 'all' ? 'All Assets' : assets.find((a) => a.id === assetId)?.name ?? assetId} open={picker === 'asset'} onPress={() => setPicker('asset')} />
        <Chip label={TIMES.find((t) => t.key === time)!.label} open={picker === 'time'} onPress={() => setPicker('time')} />
        <Chip label={RESULTS.find((r) => r.key === result)!.label} open={picker === 'result'} onPress={() => setPicker('result')} />
      </SideScroll>
      </View>

      {q.isLoading ? <Spinner full /> : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={[column, { paddingBottom: 30, gap: 8 }]}
          ListHeaderComponent={account ? <Summary today={byDay.get(dayKey(new Date().toISOString()))} week={sums.data?.weeks[0]} accountType={account.type} /> : undefined}
          onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<EmptyState icon={<HistoryIcon size={26} color={colors.muted} />} title="No trades yet" text="Finished trades that match these filters show here, newest first.">
            <Button variant="secondary" height={44} label="Open a trade" onPress={() => router.navigate('/terminal')} />
          </EmptyState>}
          ListFooterComponent={q.isFetchingNextPage ? <Spinner /> : undefined}
          renderItem={({ item }) => item.kind === 'header'
            ? <DayHeader label={item.label} totals={byDay.get(item.day)} accountType={account?.type ?? 'DEMO'} />
            : <TradeCard showOwner trade={item.trade} accountType={account?.type} onPress={() => setSelected(item.trade)} />}
        />
      )}

      <Sheet open={picker !== null} onClose={() => setPicker(null)}>
        <ScrollView style={{ maxHeight: 460 }}>
          {options.map((o) => (
            <Press key={o.key} style={styles.option} haptic={false} onPress={() => pick(o.key)}>
              <Txt style={{ fontSize: 16 }}>{o.label}</Txt>
              {current === o.key ? <Check size={20} color={colors.up} /> : null}
            </Press>
          ))}
        </ScrollView>
      </Sheet>
      <TradeDetailSheet trade={selected} accountType={account?.type} onClose={() => setSelected(null)} />
    </SafeAreaView>
  );
}

// Today and this week: the total result large and clear, then what was won (green) and lost (red) side by side.
function Summary({ today, week, accountType }: { today?: Totals; week?: Totals; accountType: 'DEMO' | 'NGN' | 'USDT' }) {
  const block = (title: string, s?: Totals) => {
    const net = s?.net ?? 0;
    return (
      <View style={styles.sumRow} key={title} testID={`summary-${title}`}>
        <View style={styles.sumHead}>
          <Txt style={{ fontSize: 16, fontFamily: font.semibold }}>{title}</Txt>
          <Txt style={styles.sumMeta}>
            {s ? `${s.trades} ${s.trades === 1 ? 'trade' : 'trades'} · ${money(s.traded, accountType)} traded` : 'No finished trades yet'}
          </Txt>
        </View>
        <View>
          <Txt style={styles.sumLabel}>Total result</Txt>
          <Txt style={[styles.sumTotal, { color: net > 0 ? colors.up : net < 0 ? colors.down : colors.text }]}>
            {s ? money(net, accountType, { sign: true }) : money(0, accountType)}
          </Txt>
        </View>
        <View style={styles.sumPair}>
          <View style={[styles.sumBox, { backgroundColor: `${colors.up}1A`, borderColor: `${colors.up}55` }]}>
            <Txt style={[styles.sumLabel, { color: colors.up }]}>Won</Txt>
            <Txt style={[styles.sumAmount, { color: colors.up }]}>+{money(Math.abs(s?.won ?? 0), accountType)}</Txt>
          </View>
          <View style={[styles.sumBox, { backgroundColor: `${colors.down}1A`, borderColor: `${colors.down}55` }]}>
            <Txt style={[styles.sumLabel, { color: colors.down }]}>Lost</Txt>
            <Txt style={[styles.sumAmount, { color: colors.down }]}>-{money(Math.abs(s?.lost ?? 0), accountType)}</Txt>
          </View>
        </View>
      </View>
    );
  };
  return <View style={styles.sumCard}>{block('Today', today)}<View style={styles.sumLine} />{block('This week', week)}</View>;
}

// A day in the list, with that day's result beside it.
function DayHeader({ label, totals, accountType }: { label: string; totals?: Totals; accountType: 'DEMO' | 'NGN' | 'USDT' }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Txt style={styles.day}>{label}</Txt>
      {totals ? (
        <Txt style={[styles.dayNet, { color: totals.net === 0 ? colors.muted : totals.net > 0 ? colors.up : colors.down }]}>
          {`${money(totals.traded, accountType)} traded · ${money(totals.net, accountType, { sign: true })}`}
        </Txt>
      ) : null}
    </View>
  );
}

function Analytics({ trades, accountType, onClose }: { trades: Trade[]; accountType: 'DEMO' | 'NGN' | 'USDT'; onClose: () => void }) {
  if (accountType === 'DEMO') {
    return (
      <SafeAreaView style={styles.analytics}>
        <View style={{ flex: 1, justifyContent: 'center', gap: 10 }}>
          <Txt style={{ fontSize: 26, fontFamily: font.bold, textAlign: 'center' }}>Analytics are available on live accounts</Txt>
          <Txt style={{ color: colors.muted, fontSize: 16, textAlign: 'center' }}>Switch to a live account to see your win rate, total result and best assets.</Txt>
        </View>
        <View style={{ gap: 10 }}>
          <Button variant="secondary" height={52} label="Change Account" onPress={() => { onClose(); router.navigate('/'); }} />
          <Button height={52} label="Close" onPress={onClose} />
        </View>
      </SafeAreaView>
    );
  }
  const wins = trades.filter((t) => t.result === 'win').length;
  const total = trades.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
  const byAsset = new Map<string, number>();
  for (const t of trades) byAsset.set(t.asset_id, (byAsset.get(t.asset_id) ?? 0) + Number(t.pnl ?? 0));
  const best = [...byAsset.entries()].sort((a, b) => b[1] - a[1])[0];
  return (
    <SafeAreaView style={styles.analytics}>
      <Txt style={type.screenTitle}>Analytics</Txt>
      <View style={{ gap: 4, marginTop: 20 }}>
        <Txt style={{ color: colors.muted }}>Win rate</Txt>
        <Txt style={{ fontSize: 28, fontFamily: font.bold }}>{trades.length ? Math.round((wins / trades.length) * 100) : 0}%</Txt>
        <Txt style={{ color: colors.muted, marginTop: 12 }}>Total result</Txt>
        <Txt style={{ fontSize: 28, fontFamily: font.bold, color: total >= 0 ? colors.up : colors.down }}>{money(total, accountType, { sign: true })}</Txt>
        <Txt style={{ color: colors.muted, marginTop: 12 }}>Best asset</Txt>
        <Txt style={{ fontSize: 20 }}>{best ? best[0] : '-'}</Txt>
      </View>
      <View style={{ flex: 1 }} />
      <Button height={52} label="Close" onPress={onClose} />
    </SafeAreaView>
  );
}

const styles = createStyles(() => ({
  bar: { flexDirection: 'row', justifyContent: 'space-between', height: 52, alignItems: 'center' },
  chips: { gap: 8, paddingVertical: 14 },
  day: { fontSize: 13, fontFamily: font.bold, color: colors.muted, letterSpacing: 0.5, marginTop: 8 },
  dayNet: { fontSize: 13, fontFamily: font.semibold, fontVariant: ['tabular-nums'] },
  sumCard: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 12, marginBottom: 6 },
  sumRow: { gap: 10 },
  sumHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  sumLine: { height: 1, backgroundColor: colors.border },
  sumMeta: { fontSize: 13, color: colors.muted, fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  sumLabel: { fontSize: 12, color: colors.muted, fontFamily: font.semibold },
  sumTotal: { fontSize: 28, fontFamily: font.bold, fontVariant: ['tabular-nums'] },
  sumPair: { flexDirection: 'row', gap: 10 },
  sumBox: { flex: 1, borderRadius: 12, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  sumAmount: { fontSize: 17, fontFamily: font.bold, fontVariant: ['tabular-nums'] },
  option: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 52, paddingHorizontal: 20 },
  analytics: { flex: 1, padding: SIDE, maxWidth: 520, width: '100%', alignSelf: 'center' },
}));
