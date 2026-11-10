// Market Scanner: live signals from the Market Intelligence Engine, every market's status (signal / don't enter / wait),
// and an honest track record: nothing removed, including the setups it said to skip and whether you took each signal.
import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowDown, ArrowUp, Ban, BookOpen, ChartColumn, CircleCheck, CircleHelp, CircleX, Clock, Eye, FlaskConical, History, Hourglass, Info, ListChecks, Newspaper, Scale, ScrollText, ShieldAlert, Wallet } from 'lucide-react-native';
import { AiIcon } from '@/ui/AiIcon';
import { useAccount } from '@/context/AccountContext';
import { api, type AiListening, type AiTrader, type ApiError, type AutoMode, type AutoState, type AutoStrength, type IntelIdea, type IntelMarket, type IntelPerformance } from '@/lib/api';
import { money, price as fmtPrice } from '@/lib/format';
import { useAiTrader } from '@/hooks/useCounts';
import { useAssets, useLivePrices } from '@/hooks/useMarket';
import { pnlColor, previewPnl } from '@/components/TradeCard';
import { AssetIcon } from '@/components/AssetIcon';
import { EvidenceLines, SignalBadge, strategyLabel, testLine, liveLine, useEvidence } from '@/components/terminal/SignalEvidence';
import { UnderlineTabs } from '@/components/UnderlineTabs';
import { SpotPanel } from '@/components/terminal/SpotPanel';
import { AgentsPanel } from '@/components/terminal/AgentsPanel';
import { card, colors, font, radius, SIDE, type, createStyles } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Blink, Spinner, Stepper } from '@/ui/kit';
import { useToast } from '@/ui/Toast';
import { More, Row } from '@/ui/List';
import { Txt } from '@/ui/Txt';
import { Grid, Page } from '@/ui/Page';
import { useLayout } from '@/hooks/useLayout';

const TABS = [{ key: 'ideas', label: 'Ideas' }, { key: 'markets', label: 'Markets' }, { key: 'record', label: 'Record' }, { key: 'ai', label: 'AI trader' }, { key: 'spot', label: 'AI Spot' }, { key: 'agents', label: 'AI Agents' }] as const;
const CLASS = { crypto: 'Crypto', currency: 'Forex', index: 'Indices', commodity: 'Commodities' } as Record<string, string>;
const COVERED = 34;

const time = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const hold = (h: number) => (h >= 48 ? `${Math.round(h / 24)} days` : `${h} hours`);
const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const r = (v: number | null | undefined) => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(2)}R`);

export default function Scanner() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>(
    TABS.some((t) => t.key === params.tab) ? (params.tab as (typeof TABS)[number]['key']) : 'ideas');
  const ideas = useQuery({ queryKey: ['intel', 'ideas'], queryFn: () => api<IntelIdea[]>('/intel/ideas?limit=200'), refetchInterval: 60_000 });
  const scan = useQuery({ queryKey: ['intel', 'scan'], queryFn: () => api<{ scanned_at: string | null; markets: IntelMarket[] }>('/intel/scan'), refetchInterval: 60_000 });
  const perf = useQuery({ queryKey: ['intel', 'perf'], queryFn: () => api<IntelPerformance>('/intel/performance'), refetchInterval: 120_000 });
  const ai = useAiTrader();
  const refreshing = ideas.isFetching || scan.isFetching;
  const refetch = () => { void ideas.refetch(); void scan.refetch(); void perf.refetch(); };
  // AI Spot has its own data and error message, so it stays usable while the engine starts up.
  const error = tab === 'spot' || tab === 'agents' ? null : ideas.error ?? scan.error ?? (tab === 'record' ? perf.error : null);

  const now = Date.now();
  const active = (ideas.data ?? []).filter((i) => i.kind === 'idea' && i.status === 'open' && new Date(i.enter_until).getTime() > now);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar title="Market Scanner" />
      <Page width="wide" gap={14} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} tintColor={colors.muted} />}>
        <View style={styles.notice}>
          <ShieldAlert size={18} color={colors.demo} />
          <Txt style={styles.noticeText}>Demo only, not financial advice. Every signal can lose.</Txt>
        </View>
        <UnderlineTabs tabs={TABS.map((t) => ({ ...t, count: t.key === 'ideas' ? active.length : t.key === 'ai' ? ai.data?.open ?? 0 : 0 }))} value={tab} onChange={setTab} />
        {error ? (
          <View style={{ gap: 12, paddingVertical: 24 }}>
            <Txt style={{ color: colors.muted, textAlign: 'center' }}>{(error as Error).message}</Txt>
            <Button variant="secondary" label="Try again" onPress={refetch} />
          </View>
        ) : tab === 'ideas' ? (
          <IdeasTab active={active} loading={ideas.isLoading} scannedAt={scan.data?.scanned_at ?? null} markets={scan.data?.markets ?? []} />
        ) : tab === 'markets' ? (
          <MarketsTab markets={scan.data?.markets ?? []} loading={scan.isLoading} />
        ) : tab === 'ai' ? (
          <AiTab />
        ) : tab === 'spot' ? (
          <SpotPanel />
        ) : tab === 'agents' ? (
          <AgentsPanel />
        ) : (
          <RecordTab perf={perf.data} ideas={ideas.data ?? []} loading={perf.isLoading || ideas.isLoading} />
        )}
      </Page>
    </SafeAreaView>
  );
}

function IdeasTab({ active, loading, scannedAt, markets }: { active: IntelIdea[]; loading: boolean; scannedAt: string | null; markets: IntelMarket[] }) {
  const { columns } = useLayout();
  if (loading) return <Spinner />;
  return (
    <View style={{ gap: 12 }}>
      <Txt style={styles.meta}>
        {scannedAt ? `Last scan ${time(scannedAt)}` : 'First scan is running...'}
      </Txt>
      {active.length === 0 ? (
        <View style={[styles.card, { alignItems: 'center', gap: 10, paddingVertical: 28 }]}>
          <Hourglass size={36} color={colors.muted} />
          <Txt style={{ fontSize: 17, fontFamily: font.semibold }}>No trade to take right now</Txt>
        </View>
      ) : <Grid columns={columns}>{active.map((i) => <IdeaCard key={i.id} idea={i} />)}</Grid>}
    </View>
  );
}

function IdeaCard({ idea: i }: { idea: IntelIdea }) {
  const { byId } = useAssets();
  const a = byId.get(i.asset_id);
  const up = i.direction > 0;
  const simulated = a && a.price_source !== 'binance';
  const iz = i.asset_class.startsWith('crypto_iz');
  const ft = i.asset_class.startsWith('crypto_ft') || iz;
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <AssetIcon id={i.asset_id} size={36} />
        <View style={{ flex: 1 }}>
          <Txt style={{ fontSize: 17, fontFamily: font.semibold }}>{a?.name ?? i.asset_id}</Txt>
          <SignalBadge assetClass={i.asset_class} />
        </View>
        {iz ? (
          <View style={[styles.dirChip, { backgroundColor: colors.accent }]}><Txt style={{ color: colors.bg, fontFamily: font.bold }}>Stays in</Txt></View>
        ) : (
          <View style={[styles.dirChip, { backgroundColor: up ? colors.up : colors.down }]}>
            {up ? <ArrowUp size={16} color={colors.dark} /> : <ArrowDown size={16} color={colors.dark} />}
            <Txt style={{ color: colors.dark, fontFamily: font.bold }}>{up ? 'Up' : 'Down'}</Txt>
          </View>
        )}
      </View>
      {a ? <Button label="Set up this trade" onPress={() => router.navigate({ pathname: '/terminal', params: { asset: i.asset_id, mode: iz ? 'inzone' : ft ? 'fixed_time' : 'forex', signal: String(i.id), tf: i.tf === '1d' ? '86400' : i.tf === '4h' ? '14400' : i.tf === '1m' ? '60' : '3600' } })} /> : null}
      <More>
        <Txt style={styles.meta}>{iz ? `${strategyLabel(i.strategy)} · between ${fmtPrice(i.stop, a?.decimals ?? 5)} and ${fmtPrice(i.target, a?.decimals ?? 5)}` : ft ? `${strategyLabel(i.strategy)} · ${up ? 'higher' : 'lower'} than ${fmtPrice(i.entry, a?.decimals ?? 5)}` : `${strategyLabel(i.strategy)} · ${i.tf === '1d' ? 'daily' : i.tf === '4h' ? '4-hour' : '1-hour'} chart`}</Txt>
        {ft ? null : (
          <View style={styles.levels}>
            <Level label="Enter near" value={fmtPrice(i.entry, a?.decimals ?? 5)} />
            <Level label="Stop" value={fmtPrice(i.stop, a?.decimals ?? 5)} color={colors.down} />
            <Level label="Target" value={fmtPrice(i.target, a?.decimals ?? 5)} color={colors.up} />
          </View>
        )}
        <EvidenceLines assetClass={i.asset_class} />
        <View style={[styles.row, { gap: 6 }]}>
          <Clock size={14} color={colors.muted} />
          <Txt style={[styles.meta, { flex: 1 }]}>Enter before {time(i.enter_until)}, or skip it. Closes by itself within {hold(i.horizon_hours)}.</Txt>
        </View>
        <View style={{ gap: 4 }}>
          {i.reasons.map((reason) => <Txt key={reason} style={styles.reason}>• {reason}</Txt>)}
        </View>
        {simulated ? <Txt style={[styles.meta, { color: colors.demo }]}>Practice only: this market's price is simulated in the app, so your result can differ from the real market.</Txt> : null}
      </More>
    </View>
  );
}

function MarketsTab({ markets, loading }: { markets: IntelMarket[]; loading: boolean }) {
  const { byId } = useAssets();
  const { columns } = useLayout();
  const groups = useMemo(() => ['crypto', 'currency', 'index', 'commodity'].map((c) => ({ c, list: markets.filter((m) => m.class === c) })), [markets]);
  if (loading) return <Spinner />;
  return (
    <View style={{ gap: 14 }}>
      <Txt style={styles.meta}>{COVERED} of 75 markets are covered with real data. The rest need a paid data feed (intraday forex, indices and commodities).</Txt>
      {groups.map(({ c, list }) => list.length ? (
        <View key={c} style={{ gap: 8 }}>
          <Txt style={styles.group}>{CLASS[c]} · {list.length}</Txt>
          <Grid columns={columns}>{list.map((m) => {
            const a = byId.get(m.asset);
            const cfg = { trade: { label: 'Signal', color: colors.demo, Icon: FlaskConical }, avoid: { label: "Don't enter", color: colors.down, Icon: Ban }, wait: { label: 'Wait', color: colors.muted, Icon: Hourglass } }[m.status];
            return (
              <View key={m.asset} style={[styles.card, { gap: 6 }]}>
                <View style={styles.row}>
                  <AssetIcon id={m.asset} size={28} />
                  <Txt style={{ flex: 1, fontFamily: font.medium }}>{a?.name ?? m.asset}</Txt>
                  <cfg.Icon size={16} color={cfg.color} />
                  <Txt style={{ color: cfg.color, fontFamily: font.semibold, fontSize: 14 }}>{cfg.label}</Txt>
                </View>
                <Txt style={styles.reason}>{m.reason}</Txt>
              </View>
            );
          })}</Grid>
        </View>
      ) : null)}
    </View>
  );
}

// The user's choice: the AI asks before every trade, or trades by itself, with their amount. Real money needs the risk accepted first,
// and stays off on the server until real trading opens.
function AutoCard() {
  const { activeAccount } = useAccount();
  const { byId } = useAssets();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [skipped, setSkipped] = useState<number[]>([]);
  const accType = activeAccount?.type ?? 'DEMO';
  const scope = accType === 'DEMO' ? 'demo' : 'real';
  const q = useQuery({ queryKey: ['intel', 'auto'], queryFn: () => api<AutoState>('/intel/auto'), refetchInterval: 30_000 });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['intel', 'auto'] }); };
  const save = useMutation({
    mutationFn: (body: { mode?: AutoMode; amount?: number; acceptRisk?: boolean; strength?: AutoStrength }) => api<AutoState>('/intel/auto', { method: 'PUT', body: { scope, ...body } }),
    onSuccess: (data) => { qc.setQueryData(['intel', 'auto'], data); setConfirm(false); },
    onError: (e: ApiError) => toast({ title: 'Not saved', message: e.message, tone: 'down' }),
  });
  const approve = useMutation({
    mutationFn: (id: number) => api(`/intel/signals/${id}/take`, { method: 'POST', body: { accountId: activeAccount?.id, amount: q.data?.demo.amount } }),
    onSuccess: () => { toast({ title: 'Trade placed', message: 'See it in your trades.' }); refresh(); void qc.invalidateQueries({ queryKey: ['trades'] }); void qc.invalidateQueries({ queryKey: ['me'] }); },
    onError: (e: ApiError) => { toast({ title: 'Not placed', message: e.message, tone: 'down' }); refresh(); },
  });
  const s = q.data?.[scope];
  if (!s || !q.data) return null;
  const pick = (mode: AutoMode) => {
    if (mode === s.mode) return;
    if (scope === 'real' && mode === 'auto' && !s.riskAccepted) setConfirm(true);
    else save.mutate({ mode });
  };
  const waiting = scope === 'demo' && s.mode === 'ask' ? q.data.waiting.filter((w) => !skipped.includes(w.id) && byId.has(w.asset_id)) : [];
  return (
    <View style={[styles.card, { gap: 12 }]} testID="ai-trading-choice">
      <Txt style={{ fontSize: 16, fontFamily: font.semibold }}>AI trading for you</Txt>
      <View style={styles.row}>
        {([['ask', 'Always ask'], ['auto', 'Auto trade']] as const).map(([mode, label]) => (
          <View key={mode} style={{ flex: 1 }}>
            <Button label={label} height={44} variant={s.mode === mode ? 'primary' : 'secondary'} onPress={() => pick(mode)} />
          </View>
        ))}
      </View>
      <Txt style={styles.reason}>{s.mode === 'auto' ? 'The AI trades by itself at this amount. It can lose.' : 'The AI asks you before every trade. It can lose.'}</Txt>
      <Stepper label="Amount per trade" value={money(s.amount, accType)} onMinus={() => save.mutate({ amount: Math.max(q.data.min, s.amount - 50) })} onPlus={() => save.mutate({ amount: s.amount + 50 })} />
      {scope === 'demo' && (q.data.strongest.offered || s.strength === 'strongest') ? (
        <View style={{ gap: 8 }} testID="ai-strength-choice">
          <View style={styles.row}>
            {([['all', 'Most profit'], ['strongest', 'Strongest signals']] as const).map(([strength, label]) => (
              <View key={strength} style={{ flex: 1 }}>
                <Button label={label} height={44} variant={s.strength === strength ? 'primary' : 'secondary'} onPress={() => { if (strength !== s.strength) save.mutate({ strength }); }} />
              </View>
            ))}
          </View>
          <Txt style={styles.reason}>{s.strength === 'all'
            ? 'Takes every signal that passed its tests. Earned the most in tests. It can lose.'
            : !q.data.strongest.offered ? 'No level is passing its test right now, so it is waiting. It can lose.'
            : `Fewer trades. Won ${Math.round((q.data.strongest.won ?? 0) * 100)}% in tests, but earned less in total. It can lose.`}</Txt>
        </View>
      ) : null}
      {scope === 'real' ? <Txt style={[styles.meta, { color: colors.demo }]}>Real money stays off until real trading opens. Your choice is saved for then.</Txt> : null}
      {confirm ? (
        <View style={{ gap: 8 }}>
          <Txt style={{ fontSize: 16, fontFamily: font.semibold, color: colors.down }}>Warning: you can lose real money</Txt>
          <Txt style={styles.reason}>• The AI will place real-money trades without asking you first.</Txt>
          <Txt style={styles.reason}>• You can lose the money in any trade, and many trades can lose in a row.</Txt>
          <Txt style={styles.reason}>• Its past or demo results do not promise future profit. It is not financial advice.</Txt>
          <Txt style={styles.reason}>• Only trade money you can afford to lose. The risk is yours.</Txt>
          <Button label="I understand, use auto trade" onPress={() => save.mutate({ mode: 'auto', acceptRisk: true })} />
          <Button label="Keep always ask" variant="secondary" height={44} onPress={() => setConfirm(false)} />
        </View>
      ) : null}
      {waiting.map((w) => (
        <View key={w.id} style={{ gap: 8 }} testID="ai-trade-waiting">
          <View style={styles.row}>
            <AssetIcon id={w.asset_id} size={28} />
            <View style={{ flex: 1 }}>
              <Txt style={{ fontFamily: font.semibold }}>{byId.get(w.asset_id)?.name ?? w.asset_id}{w.asset_class.startsWith('crypto_iz') ? ' · Stays in' : ` · ${w.direction > 0 ? 'Up' : 'Down'}`}</Txt>
              <SignalBadge assetClass={w.asset_class} />
            </View>
          </View>
          <View style={styles.row}>
            <View style={{ flex: 1 }}><Button label={`Approve ${money(s.amount, accType)}`} height={44} loading={approve.isPending && approve.variables === w.id} onPress={() => approve.mutate(w.id)} /></View>
            <View style={{ flex: 1 }}><Button label="Skip" variant="secondary" height={44} onPress={() => setSkipped((v) => [...v, w.id])} /></View>
          </View>
        </View>
      ))}
    </View>
  );
}

// The demo auto-trader: what it did, why each trade ended as it did, and what it changed. Real prices, demo money.
function AiTab() {
  const { byId } = useAssets();
  const { columns } = useLayout();
  const q = useAiTrader();
  const [open, setOpen] = useState<string | null>(null);   // one detail row open at a time
  const a = q.data;
  if (q.error && !a) {
    return (
      <View style={{ gap: 12, paddingVertical: 24 }}>
        <Txt style={{ color: colors.muted, textAlign: 'center' }}>{(q.error as Error).message}</Txt>
        <Button variant="secondary" label="Try again" onPress={() => void q.refetch()} />
      </View>
    );
  }
  if (!a?.checklist) return <Spinner />;   // also while a server from before this page is still running
  const worst = a.lessons.filter((l) => l.avg_r < 0).slice(0, 6);
  const best = a.lessons.filter((l) => l.avg_r > 0).slice(-6).reverse();
  const lessonRow = (l: AiTrader['lessons'][number]) => (
    <View key={l.tag} style={styles.row}>
      <Txt style={{ flex: 1, fontSize: 14 }}>{l.label}</Txt>
      <Txt style={styles.meta}>{l.won} of {l.trades} won</Txt>
      <Txt style={{ width: 64, textAlign: 'right', fontSize: 13, fontFamily: font.semibold, fontVariant: ['tabular-nums'], color: l.avg_r > 0 ? colors.up : colors.down }}>{r(l.avg_r)}</Txt>
    </View>
  );
  const show = (key: string) => setOpen((v) => (v === key ? null : key));
  const clean = a.picks.clean;
  return (
    <View style={{ gap: 14 }}>
      <AutoCard />
      <View style={styles.card}>
        <Txt style={styles.meta}>Clean record, demo money on real prices</Txt>
        <Txt style={[styles.big, { color: clean.pnl > 0 ? colors.up : clean.pnl < 0 ? colors.down : colors.text }]}>{clean.pnl > 0 ? '+' : clean.pnl < 0 ? '-' : ''}α{Math.abs(clean.pnl).toFixed(2)}</Txt>
        <Txt style={styles.reason}>{clean.won} of {clean.finished} won. {a.open} open now.</Txt>
        {a.picks.too_few ? <Txt style={[styles.reason, { color: colors.demo }]}>Too few trades to judge yet.</Txt> : null}
        {a.last_100 ? <Txt style={styles.meta}>Last {a.last_100.finished} of 100 signals: {a.last_100.won} right, {a.last_100.lost} wrong{a.last_100.finished ? ` (${Math.round((a.last_100.won / a.last_100.finished) * 100)}%)` : ''}.</Txt> : null}
      </View>

      <Grid columns={columns}>{a.listening?.map((l) => <ListenCard key={l.mode} l={l} fill={columns > 1} />)}</Grid>
      {a.positions.length ? <Positions a={a} /> : null}

      <View style={[card, { overflow: 'hidden' }]}>
        <Row icon={Scale} title="Full record" subtitle={`${a.picks.finished} finished, ${clean.finished} clean`} open={open === 'record'} onPress={() => show('record')}>
          <Txt style={styles.reason}>Everything on record: {a.picks.pnl >= 0 ? '+' : '-'}α{Math.abs(a.picks.pnl).toFixed(2)} from {a.picks.finished} finished, {a.picks.won} won, {a.picks.lost} lost. {a.skipped} skipped by its rules. Each trade is α{a.stake}.</Txt>
          <Txt style={styles.reason}>Clean record: {clean.finished} trades matched what was tested, across {clean.moments} separate {clean.moments === 1 ? 'hour' : 'hours'}. It needs at least {a.needed} clean trades to judge, and even a profit can be luck.</Txt>
          {a.measured.finished ? <Txt style={styles.meta}>Not counted: {a.measured.finished} earlier test trades on setups it had marked don't enter ({a.measured.won} won, {a.measured.lost} lost, {a.measured.pnl >= 0 ? '+' : '-'}α{Math.abs(a.measured.pnl).toFixed(2)}).</Txt> : null}
          <Txt style={styles.meta}>{a.watching.scanned_at ? `Last checked ${time(a.watching.scanned_at)}: ${a.watching.markets} real markets. ${a.watching.signals} with a signal, ${a.watching.setups_skipped} with a setup marked don't enter, ${a.watching.waiting} waiting for a setup.` : 'Its first check is running.'}</Txt>
        </Row>
        <Row icon={Clock} title="When it trades" subtitle={a.timing?.sit_out.length ? `Sits out: ${a.timing.sit_out.join(', ')}` : 'All hours, on crypto'} open={open === 'when'} onPress={() => show('when')}>
          <Txt style={styles.reason}>Crypto never closes. Forex, indices and commodities get no signal while their market is closed. Public holidays are not known yet.</Txt>
          {a.timing ? <Txt style={styles.reason}>{a.timing.sit_out.length ? `It tested ${a.timing.tried} windows of time. These lost money in every test: ${a.timing.sit_out.join(', ')}.` : `It tested ${a.timing.tried} windows of time, by hour, day and session. None lost money reliably enough to avoid, so it trades at any hour.`}</Txt> : null}
        </Row>
        <Row icon={Wallet} title="Money checks" subtitle="Every 12 hours, and after each trade" open={open === 'money'} onPress={() => show('money')}>
          {a.checks_12h?.some((c) => c.change != null) ? a.checks_12h.filter((c) => c.change != null).map((c) => (
            <View key={c.at} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontSize: 14, fontFamily: font.semibold }}>{time(c.at)}</Txt>
                <Txt style={styles.meta}>{c.trades} trades, {c.won} won{c.balance != null ? ` · balance α${c.balance.toFixed(2)}` : ''}</Txt>
              </View>
              <Txt style={{ fontFamily: font.semibold, fontVariant: ['tabular-nums'], color: (c.change ?? 0) > 0 ? colors.up : (c.change ?? 0) < 0 ? colors.down : colors.muted }}>{(c.change ?? 0) >= 0 ? '+' : '-'}α{Math.abs(c.change ?? 0).toFixed(2)}</Txt>
            </View>
          )) : <Txt style={styles.meta}>The first 12-hour result appears 12 hours after its first check.</Txt>}
          <Txt style={styles.group}>After each trade</Txt>
          {a.after_trade?.length ? a.after_trade.map((t, i) => (
            <View key={`${t.at}${i}`} style={styles.row}>
              <AssetIcon id={t.asset} size={22} />
              <Txt style={{ flex: 1, fontSize: 13, fontFamily: font.semibold, fontVariant: ['tabular-nums'], color: t.won ? colors.up : colors.down }}>{t.pnl >= 0 ? '+' : '-'}α{Math.abs(t.pnl).toFixed(2)}</Txt>
              <Txt style={styles.meta}>Total {t.total >= 0 ? '+' : '-'}α{Math.abs(t.total).toFixed(2)}</Txt>
            </View>
          )) : <Txt style={styles.meta}>No finished trades yet.</Txt>}
        </Row>
        {a.market ? (
          <Row icon={Activity} title="The market now" subtitle={a.market.trend} open={open === 'market'} onPress={() => show('market')}>
            <Txt style={styles.reason}>{a.market.above} of {a.market.total} live coins are above their long-term average.{a.market.fear ? ` Market mood: ${a.market.fear.text} (${a.market.fear.value} of 100).` : ''}</Txt>
          </Row>
        ) : null}
        <Row icon={ListChecks} title="What it checks" subtitle="Before every trade" open={open === 'checks'} onPress={() => show('checks')}>
          {a.checklist.map((c) => (
            <View key={c.name} style={{ gap: 2 }}>
              <Txt style={{ fontSize: 14, fontFamily: font.semibold }}>{c.name}</Txt>
              <Txt style={styles.reason}>{c.state}</Txt>
            </View>
          ))}
        </Row>
        <Row icon={AiIcon} title="How it decides" subtitle="The rules it follows" open={open === 'method'} onPress={() => show('method')}>
          {a.method.map((m) => (
            <View key={m.name} style={{ gap: 2 }}>
              <Txt style={{ fontSize: 14, fontFamily: font.semibold }}>{m.name}</Txt>
              <Txt style={styles.reason}>{m.state}</Txt>
            </View>
          ))}
        </Row>
        {a.headlines.length ? (
          <Row icon={Newspaper} title="Latest news it read" subtitle={`${a.headlines.length} headlines`} open={open === 'news'} onPress={() => show('news')}>
            {a.headlines.map((h) => (
              <View key={h.url} style={styles.row}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: h.sentiment > 0 ? colors.up : h.sentiment < 0 ? colors.down : colors.muted }} />
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontSize: 13, lineHeight: 18 }}>{h.title}</Txt>
                  <Txt style={styles.meta}>{h.source} · read as {h.sentiment > 0 ? 'good' : h.sentiment < 0 ? 'bad' : 'neutral'}</Txt>
                </View>
              </View>
            ))}
          </Row>
        ) : null}
        <Row icon={ChartColumn} title="Compare strategies" subtitle={`${a.strategies.length} so far`} open={open === 'strategies'} onPress={() => show('strategies')}>
          <Txt style={styles.meta}>Every strategy it trades, side by side, on demo money. Past results do not promise future ones.</Txt>
          {a.strategies.length ? a.strategies.map((s) => (
            <View key={`${s.setup}${s.tf}`} style={{ gap: 2 }}>
              <View style={styles.row}>
                <Txt style={{ flex: 1, fontFamily: font.semibold }}>{s.label} · {s.tf === '1d' ? 'daily' : s.tf === '4h' ? '4-hour' : s.tf === '1m' ? '60-minute' : '1-hour'}</Txt>
                <Txt style={{ fontFamily: font.semibold, fontVariant: ['tabular-nums'], color: s.pnl > 0 ? colors.up : s.pnl < 0 ? colors.down : colors.text }}>{s.pnl > 0 ? '+' : s.pnl < 0 ? '-' : ''}α{Math.abs(s.pnl).toFixed(2)}</Txt>
              </View>
              <Txt style={styles.reason}>{s.won} of {s.trades} won · average {r(s.avg_r)} per trade</Txt>
              {s.status === 'keeping' ? <Txt style={[styles.meta, { color: colors.up }]}>Keeping: its live profit is clear, so it sticks with this.</Txt>
                : s.status === 'struggling' ? <Txt style={[styles.meta, { color: colors.down }]}>Struggling: live results are clearly negative.</Txt>
                : s.too_few ? <Txt style={styles.meta}>Too few trades to judge yet.</Txt> : null}
            </View>
          )) : <Txt style={styles.reason}>No finished trades yet.</Txt>}
        </Row>
        <Row icon={CircleHelp} title="Why trades ended" subtitle="Wins and losses, by cause" open={open === 'causes'} onPress={() => show('causes')}>
          {a.causes.length ? a.causes.map((c) => (
            <View key={c.cause} style={[styles.row, { alignItems: 'flex-start' }]}>
              {c.loss ? <CircleX size={16} color={colors.down} /> : <CircleCheck size={16} color={colors.up} />}
              <Txt style={[styles.reason, { flex: 1 }]}>{c.text}</Txt>
              <Txt style={{ fontSize: 14, fontFamily: font.semibold, fontVariant: ['tabular-nums'] }}>{c.count}</Txt>
            </View>
          )) : <Txt style={styles.meta}>Nothing has finished yet.</Txt>}
        </Row>
        <Row icon={Eye} title="What it has noticed" subtitle="Patterns, not proof" open={open === 'lessons'} onPress={() => show('lessons')}>
          <Txt style={styles.meta}>Patterns need at least 10 finished trades to appear here. Noticing is not proof.</Txt>
          {best.length ? <View style={{ gap: 8 }}><Txt style={styles.group}>Making money so far</Txt>{best.map(lessonRow)}</View> : null}
          {worst.length ? <View style={{ gap: 8 }}><Txt style={styles.group}>Losing money so far</Txt>{worst.map(lessonRow)}</View> : null}
        </Row>
        <Row icon={BookOpen} title="What it found online" subtitle={a.findings?.length ? `${a.findings.length} ideas to test` : 'It searches every week'} open={open === 'found'} onPress={() => show('found')}>
          <Txt style={styles.meta}>Ideas from new research papers. Reading one changes nothing: it must pass a test first.</Txt>
          {a.findings?.length ? a.findings.map((f) => (
            <View key={f.url} style={{ gap: 2 }}>
              <Txt style={{ fontSize: 14, fontFamily: font.semibold }}>{f.idea}</Txt>
              <Txt style={styles.meta}>{f.title}</Txt>
            </View>
          )) : <Txt style={styles.reason}>Nothing found yet.</Txt>}
        </Row>
        <Row icon={History} title="Changes to its rules" subtitle={`${a.log.length} entries`} open={open === 'log'} onPress={() => show('log')}>
          <Txt style={styles.meta}>One loss changes nothing. A rule needs 20 live trades with the pattern, and years of past prices must confirm it. A rule that turns out wrong is removed, and a strategy that is clearly working is kept. It reviews this every day and redoes its research every week on fresh data.</Txt>
          {a.log.length ? a.log.map((l, i) => (
            <View key={i} style={{ gap: 2 }}>
              <Txt style={{ fontSize: 13, fontFamily: font.semibold, color: l.kind === 'adopted' || l.kind === 'kept' ? colors.up : l.kind === 'retired' ? colors.demo : colors.muted }}>{{ adopted: 'New rule', retired: 'Rule removed', refused: 'Looked, changed nothing', kept: 'Sticking with it', review: 'Strategy review', trend: 'Market change', research: 'Weekly research', check: 'Self-check' }[l.kind]}</Txt>
              <Txt style={styles.reason}>{l.message}</Txt>
              <Txt style={styles.meta}>{time(l.at)}</Txt>
            </View>
          )) : <Txt style={styles.reason}>No changes yet.</Txt>}
        </Row>
        <Row icon={ScrollText} title="Latest trades" subtitle={`${a.recent.length} shown, and why`} last open={open === 'recent'} onPress={() => show('recent')}>
          {a.recent.map((t) => (
            <View key={t.id} style={{ gap: 4 }}>
              <View style={styles.row}>
                <AssetIcon id={t.asset} size={26} />
                <Txt style={{ flex: 1, fontFamily: font.medium }}>{byId.get(t.asset)?.name ?? t.asset}{t.tf === '1m' && t.why.startsWith('InZone') ? '' : ` · ${t.direction > 0 ? 'Up' : 'Down'}`}</Txt>
                <Txt style={{ fontFamily: font.semibold, fontVariant: ['tabular-nums'], color: t.won ? colors.up : colors.down }}>{t.pnl > 0 ? '+' : '-'}α{Math.abs(t.pnl).toFixed(2)}</Txt>
              </View>
              <Txt style={styles.reason}>{t.why}</Txt>
              {t.notes.length ? <Txt style={styles.meta}>Also: {t.notes.join('; ')}.</Txt> : null}
              <Txt style={styles.meta}>{time(t.at)}</Txt>
            </View>
          ))}
        </Row>
      </View>
    </View>
  );
}

// One trade type's state: trading or waiting, what it read last, and what it needs before it trades.
export function ListenCard({ l, fill }: { l: AiListening; fill?: boolean }) {   // fill: takes the row's height, so cards side by side match
  const { byId } = useAssets();
  const name = l.asset ? byId.get(l.asset)?.name ?? l.asset : null;
  return (
    <View testID={`listen-${l.mode}`} style={[styles.card, { gap: 4 }, fill ? { flex: 1 } : null]}>
      <View style={styles.row}>
        <Blink on={l.open > 0 || !!l.at} pulse={false}><AiIcon size={18} color={colors.text} /></Blink>
        <Txt style={{ flex: 1, fontFamily: font.semibold }}>{l.name}</Txt>
        <Txt style={{ fontSize: 13, fontFamily: font.semibold, color: l.open ? colors.up : colors.muted }}>{l.open ? `${l.open} trading` : 'Listening'}</Txt>
      </View>
      <Txt style={styles.meta}>
        {!l.at ? 'Its first reading is running.'
          : l.no_setup ? 'No chart setup right now.'
          : l.reading != null && l.needed != null
            ? `Strongest: ${name}, ${pct(l.reading)}. Trades from ${pct(l.needed)}.`
            : `Checks ${l.every}.`}
      </Txt>
    </View>
  );
}

// Its open trades as they run: live result from real prices, levels, and why it opened. The server settles them.
function Positions({ a }: { a: AiTrader }) {
  const { byId } = useAssets();
  const prices = useLivePrices([...new Set(a.positions.map((t) => t.asset_id))]);
  return a.positions.map((t) => {
    const asset = byId.get(t.asset_id);
    const dec = asset?.decimals ?? 5;
    const live = previewPnl(t, prices[t.asset_id]);
    return (
      <View key={t.id} style={[styles.card, { gap: 8 }]}>
        <View style={styles.row}>
          <AssetIcon id={t.asset_id} size={30} />
          <View style={{ flex: 1 }}>
            <Txt style={{ fontFamily: font.semibold }}>{asset?.name ?? t.asset_id}{t.mode === 'inzone' ? '' : ` · ${t.direction === 'up' ? 'Up' : 'Down'}`}</Txt>
          </View>
          <Txt style={{ fontSize: 16, fontFamily: font.bold, fontVariant: ['tabular-nums'], color: live == null ? colors.muted : pnlColor(live) }}>{live == null ? '...' : `${live > 0 ? '+' : live < 0 ? '-' : ''}α${Math.abs(live).toFixed(2)}`}</Txt>
        </View>
        <More>
        <Txt style={styles.meta}>{strategyLabel(t.strategy)} · opened {time(t.open_time)}</Txt>
        {t.mode === 'inzone' ? (
          <Txt style={styles.meta}>InZone from {fmtPrice(Number(t.open_quote), dec)}, within ±{Number(t.zone_pct).toFixed(3)}%. It ends by itself at {time(t.ends_at)}.</Txt>
        ) : t.mode === 'fixed_time' ? (
          <Txt style={styles.meta}>Fixed Time from {fmtPrice(Number(t.open_quote), dec)}. It ends by itself at {time(t.ends_at)}.</Txt>
        ) : (
          <>
            <View style={styles.levels}>
              <Level label="Entered" value={fmtPrice(Number(t.open_quote), dec)} />
              <Level label="Stop" value={fmtPrice(t.stop_price, dec)} color={colors.down} />
              <Level label="Target" value={fmtPrice(t.target_price, dec)} color={colors.up} />
            </View>
            <Txt style={styles.meta}>Closes by itself at the stop, the target or {time(t.ends_at)}.</Txt>
          </>
        )}
        <View style={{ gap: 2 }}>{t.reasons.map((x) => <Txt key={x} style={styles.reason}>• {x}</Txt>)}</View>
        {t.checked?.length ? <View style={{ gap: 2 }}><Txt style={[styles.meta, { fontFamily: font.semibold }]}>What it checked</Txt>{t.checked.map((x) => <Txt key={x} style={styles.meta}>{x}</Txt>)}</View> : null}
        {t.kind === 'avoid' ? <Txt style={[styles.meta, { color: colors.demo }]}>An earlier test trade on a setup it had marked don't enter. It no longer opens these.</Txt> : null}
        </More>
        {asset ? <Button variant="secondary" height={44} label="Watch it on the chart" onPress={() => router.navigate({ pathname: '/terminal', params: { asset: t.asset_id, mode: t.mode, tf: t.mode !== 'forex' ? '60' : t.tf === '4h' ? '14400' : '3600' } })} /> : null}
      </View>
    );
  });
}

function RecordTab({ perf, ideas, loading }: { perf?: IntelPerformance; ideas: IntelIdea[]; loading: boolean }) {
  const { byId } = useAssets();
  const evidence = useEvidence();
  const [shown, setShown] = useState(60);
  if (loading || !perf) return <Spinner />;
  const resolved = ideas.filter((i) => i.status !== 'open');
  const signals = resolved.filter((i) => i.kind === 'idea');
  const took = signals.filter((i) => i.taken);
  const tookWon = took.filter((i) => i.taken?.result === 'win').length;
  const tookLost = took.filter((i) => i.taken?.result === 'loss').length;
  return (
    <View style={{ gap: 14 }}>
      <View style={styles.statsRow}>
        <View style={[styles.card, { flex: 1 }]}>
          <Txt style={styles.meta}>Suggested trades</Txt>
          <Txt style={styles.big}>{pct(perf.ideas.hit_rate)}</Txt>
          <Txt style={styles.meta}>{perf.ideas.won} won · {perf.ideas.lost} lost · {perf.ideas.expired} timed out · avg {r(perf.ideas.avg_r)}</Txt>
        </View>
        <View style={[styles.card, { flex: 1 }]}>
          <Txt style={styles.meta}>Setups it said to skip</Txt>
          <Txt style={styles.big}>{pct(perf.avoided.hit_rate)}</Txt>
          <Txt style={styles.meta}>would have won · {perf.avoided.resolved} checked · avg {r(perf.avoided.avg_r)}</Txt>
        </View>
      </View>

      <Txt style={type.sectionTitle}>Your results</Txt>
      <View style={styles.card}>
        <Txt style={styles.reason}>
          {signals.length
            ? `Of ${signals.length} finished signal${signals.length === 1 ? '' : 's'}, you took ${took.length} (${tookWon} won, ${tookLost} lost) and skipped ${signals.length - took.length}.`
            : 'No signal has finished yet. Your results appear here once one does.'}
        </Txt>
      </View>

      <Txt style={type.sectionTitle}>Demo-money forward test</Txt>
      <View style={[styles.card, { gap: 8 }]}>
        <Txt style={styles.reason}>
          Every crypto setup is traded automatically with α{perf.paper.stake} at {perf.paper.leverage}x in the engine's own
          demo account (stop and target as suggested, closed at the time limit), so each strategy builds a live record.
        </Txt>
        {([['Suggested trades', perf.paper.ideas], ['Setups it said to skip', perf.paper.avoided]] as const).map(([label, p]) => (
          <View key={label} style={styles.row}>
            <Txt style={{ flex: 1, fontSize: 14 }}>{label}</Txt>
            <Txt style={[styles.meta, { textAlign: 'right' }]}>
              {p.opened ? `${p.closed} closed · ${p.open} open · ${pct(p.hit_rate)} won` : 'none yet'}
            </Txt>
            <Txt style={{ width: 80, textAlign: 'right', fontFamily: font.semibold, fontVariant: ['tabular-nums'],
              color: p.pnl > 0 ? colors.up : p.pnl < 0 ? colors.down : colors.muted }}>
              {p.pnl > 0 ? '+' : ''}α{p.pnl.toFixed(2)}
            </Txt>
          </View>
        ))}
      </View>

      <Txt style={type.sectionTitle}>The test each group had to face</Txt>
      <Txt style={styles.meta}>
        Real past prices, one trade per signal, in years the model had not seen.{evidence.data?.tested_at ? ` Last run ${time(evidence.data.tested_at)}.` : ''}
        {' '}These years also helped design the rules, so only live results are truly unseen.
      </Txt>
      {Object.entries(evidence.data?.groups ?? {}).map(([cls, g]) => (
        <View key={cls} style={[styles.card, { gap: 8 }]}>
          <View style={styles.row}>
            <Txt style={{ flex: 1, fontFamily: font.semibold }}>{g.label}</Txt>
            {g.status === 'experimental' || g.status === 'test' ? <FlaskConical size={15} color={colors.demo} /> : null}
            <Txt style={{ fontSize: 13, fontFamily: font.semibold, color: g.paused ? colors.down : g.status === 'proven' ? colors.up : g.status === 'blocked' ? colors.down : colors.demo }}>
              {g.paused ? 'Paused' : g.status === 'proven' ? 'Passed' : g.status === 'experimental' ? 'Experimental' : g.status === 'test' ? 'Test signals' : 'No signals'}
            </Txt>
          </View>
          <Txt style={styles.reason}>{testLine(g)}</Txt>
          <Txt style={styles.reason}>{liveLine(g)}</Txt>
          {g.paused ? <Txt style={[styles.reason, { color: colors.down }]}>{g.paused}</Txt> : null}
          {g.test.failed.length ? <Txt style={styles.meta}>Not met: {g.test.failed.join('; ')}.</Txt> : null}
        </View>
      ))}

      <Txt style={type.sectionTitle}>Every call, how it turned out</Txt>
      {resolved.length === 0 ? (
        <Txt style={styles.meta}>Nothing has finished yet. Each idea and skipped setup appears here once its stop, target or time limit is reached.</Txt>
      ) : resolved.slice(0, shown).map((i) => {
        const a = byId.get(i.asset_id);
        const good = (i.result_r ?? 0) > 0;
        const skipped = i.kind === 'avoid';
        const verdict = skipped
          ? good ? `Skipped, and it would have won (${r(i.result_r)})` : `Skipped, and it would have lost (${r(i.result_r)}), a good skip`
          : good ? `Idea won (${r(i.result_r)})` : `Idea lost (${r(i.result_r)})`;
        return (
          <View key={i.id} style={[styles.card, { gap: 6 }]}>
            <View style={styles.row}>
              <AssetIcon id={i.asset_id} size={26} />
              <Txt style={{ flex: 1, fontFamily: font.medium }}>{a?.name ?? i.asset_id} · {i.direction > 0 ? 'Up' : 'Down'}</Txt>
              {good ? <CircleCheck size={16} color={colors.up} /> : <CircleX size={16} color={colors.down} />}
            </View>
            <Txt style={{ fontSize: 14 }}>{verdict}</Txt>
            <Txt style={styles.meta}>
              {time(i.bar_time)} · {strategyLabel(i.strategy)} · {i.taken ? `You took this (${i.taken.result ?? i.taken.status})` : 'You did not take this'}
            </Txt>
          </View>
        );
      })}
      {resolved.length > shown ? <Button variant="secondary" label="Show more" height={44} onPress={() => setShown(shown + 60)} /> : null}
      <View style={[styles.row, { gap: 6 }]}>
        <Info size={14} color={colors.muted} />
        <Txt style={[styles.meta, { flex: 1 }]}>R = result in units of risk: +1R means the target was reached, -1R means the stop was hit.</Txt>
      </View>
    </View>
  );
}

function Level({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Txt style={styles.meta}>{label}</Txt>
      <Txt style={{ fontSize: 15, fontFamily: font.medium, color: color ?? colors.text, fontVariant: ['tabular-nums'] }}>{value}</Txt>
    </View>
  );
}

const styles = createStyles(() => ({
  page: { paddingHorizontal: SIDE, paddingBottom: 30, gap: 14 },
  notice: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border },
  noticeText: { flex: 1, fontSize: 12, color: colors.muted, lineHeight: 17 },
  card: { ...card, padding: 14, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  meta: { fontSize: 12, color: colors.muted },
  group: { fontSize: 13, fontFamily: font.semibold, color: colors.muted },
  dirChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderRadius: 15 },
  statsRow: { flexDirection: 'row', gap: 10 },
  levels: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  reason: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  big: { fontSize: 26, fontFamily: font.bold, fontVariant: ['tabular-nums'] },
}));
