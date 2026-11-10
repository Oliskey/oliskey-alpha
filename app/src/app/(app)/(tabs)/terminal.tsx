import { useEffect, useMemo, useRef, useState } from 'react';
import { liveUpdate } from '@/lib/liveBatch';
import { ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown, Check, ArrowUp, ChartArea, ChartCandlestick, ChartNoAxesColumn, ChevronDown, CircleHelp, DraftingCompass, Radio, Search,
  SlidersHorizontal, Trash2, Undo2, Wallet, X,
} from 'lucide-react-native';
import { api, newActionKey, OUTCOME_UNKNOWN, type ApiError, type Trade, type TradeMode, type IntelIdea, type SignalPlan } from '@/lib/api';
import { countdown, duration, money, moneyShort } from '@/lib/format';
import { subscribeEvents } from '@/lib/ws';
import { useAccount } from '@/context/AccountContext';
import { useAssets, useLiveCandles, useMomentum } from '@/hooks/useMarket';
import { AccountsSheet } from '@/components/AccountsSheet';
import { ActiveTradeSheet } from '@/components/ActiveTradeSheet';
import { AssetIcon } from '@/components/AssetIcon';
import { AssetTabs } from '@/components/terminal/AssetTabs';
import { BoostButton } from '@/components/terminal/BoostButton';
import { ChartToolbar } from '@/components/terminal/ChartToolbar';
import { PhoneTradePanel } from '@/components/terminal/PhoneTradePanel';
import { ConnectionOverlay } from '@/components/OfflineState';
import { BOOST_POINTS, useBoosts } from '@/hooks/useBoosts';
import { useConnection } from '@/hooks/useConnection';
import { AnalysisPanel, type AnalysisTab } from '@/components/terminal/AnalysisPanel';
import { SignalsPanel } from '@/components/terminal/SignalsPanel';
import { indDef, type IndSetting, type VolumeBar } from '@/components/indicators';
import { PANE_H } from '@/components/CandleChart';
import { defaultTriggerAt, fmtTriggerDate, fmtTriggerTime, OPTION_HELP, TradeOptions, type TradeOptionsState } from '@/components/terminal/TradeOptions';
import { Avatar } from '@/ui/Avatar';
import { Dialog } from '@/ui/Dialog';
import { Segmented } from '@/components/UnderlineTabs';
import { OrderFlowSheet } from '@/components/OrderFlowSheet';
import { pnlColor, previewPnl, TradeCard } from '@/components/TradeCard';
import { CandleChart, type ChartType, type DrawTool, type Drawing } from '@/components/CandleChart';
import { makeDrawing, stepHint, toolInfo, TOOLS, type Pt } from '@/components/drawings';
import { getPref, setPref } from '@/lib/storage';
import { DepositSheet } from '@/components/DepositSheet';
import { colors, font, radius, SIDE, type, createStyles, isLight } from '@/theme';
import { Button } from '@/ui/Button';
import { Blink, HoverReveal, revealHost, SideScroll, Stepper, Toggle } from '@/ui/kit';
import { useSignals } from '@/hooks/useSignals';
import { glass, glassEdge } from '@/ui/glass';
import { LiquidBox } from '@/ui/liquid';
import { Press } from '@/ui/Press';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';
import { useLayout } from '@/hooks/useLayout';

type Mode = TradeMode | 'stocks';
const MODES: { key: Mode; label: string }[] = [
  { key: 'fixed_time', label: 'Fixed Time' }, { key: 'inzone', label: 'InZone' },
  { key: 'forex', label: 'Forex' }, { key: 'stocks', label: 'Stocks' },
];
const DURATIONS = [5, 10, 15, 30, 60, 120, 300, 900, 1800, 3600, 14400];
const LEVERAGES = [1, 10, 20, 50, 100, 200, 500];
// Candle/bar sizes (multiples of the server's 5 s candles) and Area chart windows (120 points each).
const indDefSafe = (k: unknown) => { try { return !!indDef(k as IndSetting['key']); } catch { return false; } };
const CANDLE_TFS = [5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1800, 3600, 14400, 86400, 604800, 2592000];
// History the server keeps: 12 h for candles under 15 min, 6 months for 15 min and longer (max 5000 candles).
const historyCount = (tf: number) => Math.min(5000, Math.ceil((tf >= 900 && tf % 900 === 0 ? 183 * 86400 : 12 * 3600) / tf));
const AREA_RANGES = [
  { sec: 600, label: '10m' }, { sec: 1800, label: '30m' }, { sec: 3600, label: '1h' },
  { sec: 21600, label: '6h' }, { sec: 43200, label: '12h' },
];
const CHART_TYPES: { key: ChartType; label: string }[] = [
  { key: 'area', label: 'Area' }, { key: 'candles', label: 'Candlestick' },
  { key: 'heikin', label: 'Heikin Ashi' }, { key: 'bar', label: 'Bar' },
];

function ChartTypeIcon({ type: t, size, color }: { type: ChartType; size: number; color: string }) {
  const Icon = t === 'area' ? ChartArea : t === 'bar' ? ChartNoAxesColumn : ChartCandlestick;
  return <Icon size={size} color={color} />;
}

const PICKER_CATEGORIES = [
  { key: 'all', label: 'All' }, { key: 'currency', label: 'Currencies' }, { key: 'crypto', label: 'Crypto' },
  { key: 'index', label: 'Indices' }, { key: 'commodity', label: 'Commodities' },
] as const;

const amountStep = (v: number) => (v < 10 ? 1 : v < 100 ? 10 : v < 1000 ? 100 : 1000);

// Desktop: the tabs layout keeps the Terminal mounted beside every panel, so the route itself shows nothing there.
export default function TerminalRoute() {
  const { width } = useWindowDimensions();
  return width >= 1024 ? null : <Terminal />;
}

export function Terminal() {
  // Wide screens: chart on the left, trade controls in a fixed column on the right.
  const layout = useLayout();
  const desk = layout.isDesktop;
  const side = desk || layout.contentW >= 900;
  const tight = layout.contentW < 860;   // a panel is open beside the chart: compact top bar and trade column   // desktop arrangement: asset tabs, chart toolbar, right trade panel
  const params = useGlobalSearchParams<{ asset?: string; mode?: Mode; at?: string; tf?: string; signal?: string }>();
  const { me, activeAccount } = useAccount();
  const { assets, byId } = useAssets();
  const qc = useQueryClient();
  const toast = useToast();

  const [assetId, setAssetId] = useState(params.asset ?? 'EURUSD');
  const [mode, setMode] = useState<Mode>(params.mode ?? 'fixed_time');
  const [tf, setTf] = useState(params.tf ? Number(params.tf) : 5);
  const [amount, setAmount] = useState(10);
  const [opts, setOpts] = useState<TradeOptionsState>({ riskFree: false, orderOn: false, trigger: null });
  const [help, setHelp] = useState<null | 'riskFree' | 'order'>(null);
  const [durationSec, setDurationSec] = useState(60);
  const [leverage, setLeverage] = useState(100);
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [sheet, setSheet] = useState<null | 'accounts' | 'deposit' | 'asset' | 'tf' | 'amount' | 'duration' | 'leverage' | 'settings' | 'how' | 'draw' | 'signals'>(null);
  // desktop: Signals and Technical analysis open as a panel docked left of the chart, in place of any page panel
  const [deskPanel, setDeskPanelState] = useState<null | 'signals' | 'analysis'>(null);
  const pathname = usePathname();
  useEffect(() => { if (pathname !== '/terminal') setDeskPanelState(null); }, [pathname]);
  const setDeskPanel = (next: typeof deskPanel | ((v: typeof deskPanel) => typeof deskPanel)) => {
    setDeskPanelState(next);
    if (pathname !== '/terminal') router.navigate('/terminal');
  };
  const [taSection, setTaSection] = useState<AnalysisTab | null>('indicator');
  const [editInd, setEditInd] = useState<string | null>(null);
  // indicators are the same on every asset, remembered on this device
  const [indicators, setIndicatorsState] = useState<IndSetting[]>([]);
  useEffect(() => { getPref('indicators').then((v) => { try { const l = JSON.parse(v ?? '[]'); if (Array.isArray(l)) setIndicatorsState(l.filter((x) => x && typeof x.id === 'string' && indDefSafe(x.key))); } catch { /* ignore bad data */ } }); }, []);
  const setIndicators = (l: IndSetting[]) => { setIndicatorsState(l); void setPref('indicators', JSON.stringify(l)); };
  const [assetQuery, setAssetQuery] = useState('');
  const [assetCategory, setAssetCategory] = useState<(typeof PICKER_CATEGORIES)[number]['key']>('all');
  const [now, setNow] = useState(Date.now());
  const [drawTool, setDrawTool] = useState<DrawTool>('none');
  const [drawingsByAsset, setDrawingsByAsset] = useState<Record<string, Drawing[]>>({});
  const [pendingPoints, setPendingPoints] = useState<Pt[]>([]);   // taps placed so far for the active tool

  useEffect(() => { if (params.asset) setAssetId(params.asset); }, [params.asset]);
  useEffect(() => { if (params.mode) setMode(params.mode); }, [params.mode]);
  useEffect(() => { if (params.tf) setTf(Number(params.tf)); }, [params.tf, params.at]);

  // A signal: its market, its trade type, a chart long enough to show the plan, and the plan on it.
  const signals = useSignals();
  const [signalId, setSignalId] = useState<number | null>(null);
  const [planOn, setPlanOn] = useState(false);
  const [signalTf, setSignalTf] = useState(3600);   // the chart the signal was made on
  const openSignal = (idea: Pick<IntelIdea, 'id' | 'asset_id' | 'tf'> & { asset_class?: string }) => {
    setSignalId(idea.id); setPlanOn(true); setAssetId(idea.asset_id);
    setMode(idea.tf !== '1m' ? 'forex' : idea.asset_class?.startsWith('crypto_iz') || params.mode === 'inzone' ? 'inzone' : 'fixed_time');
    const chart = idea.tf === '1m' ? 60 : idea.tf === '1h' ? 3600 : idea.tf === '4h' ? 14400 : 86400;
    setTf(chart);
    setSignalTf(chart);
  };
  const planQ = useQuery({
    queryKey: ['signal-plan', signalId, activeAccount?.id, null],
    queryFn: () => api<SignalPlan>(`/intel/signals/${signalId}/plan?accountId=${activeAccount?.id}`),
    enabled: signalId != null && planOn && !!activeAccount?.id, refetchInterval: 5000,
  });
  const plan = planOn && planQ.data?.assetId === assetId ? planQ.data : null;
  // the normal trade panel gets the same plan, once per signal, so it is ready either way
  const filled = useRef<number | null>(null);
  useEffect(() => {
    const d = planQ.data;
    if (!d || filled.current === d.ideaId || (d.status !== 'start' && d.status !== 'wait')) return;
    filled.current = d.ideaId;
    setAmount(d.amount);
    if (d.mode !== 'forex') { setDurationSec(d.durationSec ?? 3600); return; }
    setLeverage(d.leverage); setTakeProfit(String(d.targetMoney)); setStopLoss(String(d.stopMoney));
  }, [planQ.data]);

  // Chart type + time frame, remembered on this device.
  const [chartType, setChartType] = useState<ChartType>('candles');
  const [areaRange, setAreaRange] = useState(1800);
  useEffect(() => {
    getPref('chart').then((v) => {
      if (!v) return;
      const p = JSON.parse(v);
      if (CHART_TYPES.some((c) => c.key === p.chartType)) setChartType(p.chartType);
      if (AREA_RANGES.some((r) => r.sec === p.areaRange)) setAreaRange(p.areaRange);
      if (!params.tf && CANDLE_TFS.includes(p.tf)) setTf(p.tf);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const chooseChart = (next: { chartType?: ChartType; tf?: number; areaRange?: number }) => {
    const v = { chartType, tf, areaRange, ...next };
    setChartType(v.chartType); setTf(v.tf); setAreaRange(v.areaRange);
    void setPref('chart', JSON.stringify(v));
    if (next.tf || next.areaRange) setSheet(null);
  };
  // Area charts show a time window; each of its 120 points is one candle of range/120 seconds.
  const chartTf = chartType === 'area' ? areaRange / 120 : tf;

  const drawings = drawingsByAsset[assetId] ?? [];
  const [selectedDrawing, setSelectedDrawing] = useState<number | null>(null);
  const [keepTool, setKeepTool] = useState(false);   // stay in drawing mode: place several in a row
  const [magnet, setMagnet] = useState(true);        // snap taps to the nearest candle open/high/low/close
  useEffect(() => { getPref('drawPrefs').then((v) => { try { const o = JSON.parse(v ?? '{}'); if (typeof o.keepTool === 'boolean') setKeepTool(o.keepTool); if (typeof o.magnet === 'boolean') setMagnet(o.magnet); } catch { /* ignore */ } }); }, []);
  const saveDrawPrefs = (next: { keepTool: boolean; magnet: boolean }) => { setKeepTool(next.keepTool); setMagnet(next.magnet); void setPref('drawPrefs', JSON.stringify(next)); };
  // Drawings are kept per market on this device, so they are still there after a reload.
  const drawingsLoaded = useRef(false);
  useEffect(() => { getPref('drawings').then((v) => { if (v) { try { setDrawingsByAsset(JSON.parse(v)); } catch { /* ignore bad data */ } } drawingsLoaded.current = true; }); }, []);
  useEffect(() => { if (drawingsLoaded.current) void setPref('drawings', JSON.stringify(drawingsByAsset)); }, [drawingsByAsset]);
  useEffect(() => { setSelectedDrawing(null); setPendingPoints([]); setDrawTool('none'); }, [assetId]);
  const setDrawings = (f: (list: Drawing[]) => Drawing[]) => setDrawingsByAsset((m) => ({ ...m, [assetId]: f(m[assetId] ?? []) }));
  const addDrawing = (d: Drawing) => setDrawings((list) => [...list, d]);
  // One tap places 1-tap tools; 2-tap tools keep the first tap as a pending point. With "stay in drawing mode" the
  // tool stays active so several can be placed in a row.
  const onChartTap = (t: number, p: number) => {
    const info = toolInfo(drawTool);
    if (!info) return;
    const pts = [...pendingPoints, { t, p }];
    if (pts.length < info.taps) { setPendingPoints(pts); return; }
    const d = makeDrawing(drawTool, pts[0], pts[1], pts[2]);
    if (d) addDrawing(d);
    setPendingPoints([]);
    if (!keepTool) setDrawTool('none');
  };
  useEffect(() => { const id = setInterval(() => liveUpdate(() => setNow(Date.now()), setNow), 250); return () => clearInterval(id); }, []);   // see lib/liveBatch

  const asset = byId.get(assetId);
  const { candles, last } = useLiveCandles(assetId, chartTf, chartType === 'area' ? 120 : historyCount(chartTf));
  const momentum = useMomentum(assetId);
  // without the live connection there are no prices: the chart shows a calm reconnecting screen and trading locks
  const conn = useConnection();
  const locked = conn !== 'online';
  useEffect(() => {
    if (!params.signal) return;
    openSignal({ id: Number(params.signal), asset_id: params.asset ?? assetId, tf: params.tf === '60' ? '1m' : params.tf === '3600' ? '1h' : params.tf === '14400' ? '4h' : '1d' });
    if (desk) setDeskPanel('signals'); else setSheet('signals');
    // A link opens its signal once. The link's numbers stayed on the Terminal, so every later visit (tapping the Terminal
    // tab) opened the same missed signal again. Clearing them after use makes the next visit a plain Terminal.
    router.setParams({ signal: undefined, at: undefined });
  }, [params.signal]); // eslint-disable-line react-hooks/exhaustive-deps
  const needVolume = indicators.some((s) => indDef(s.key).needsVolume);
  const volumeQ = useQuery({
    queryKey: ['volume', assetId, chartTf], enabled: needVolume, refetchInterval: 10_000,
    queryFn: () => api<{ live: boolean; bars: VolumeBar[] }>(`/volume/${assetId}?tf=${chartTf}`),
  });
  const price = last?.price ?? (candles.length ? candles[candles.length - 1].close : null);
  const accType = activeAccount?.type ?? 'DEMO';
  const maxLev = asset?.max_leverage ?? 500;
  useEffect(() => { if (leverage > maxLev) setLeverage(maxLev); }, [maxLev]); // eslint-disable-line react-hooks/exhaustive-deps

  const openTrades = useQuery({
    queryKey: ['trades', 'open'],
    queryFn: () => api<{ trades: Trade[] }>('/trades?status=open&limit=100'),
    select: (d) => d.trades,
    refetchInterval: 5000,   // trades opened on another device or tab appear on this chart too
  });
  const onChart = (openTrades.data ?? []).filter((t) => t.asset_id === assetId && t.account_id === activeAccount?.id);
  // Finished trades on this asset, drawn on the chart (refreshed whenever a trade closes).
  const pastTrades = useQuery({
    queryKey: ['trades', 'chart', assetId, activeAccount?.id],
    queryFn: () => api<{ trades: Trade[] }>(`/trades?status=closed&assetId=${assetId}&accountId=${activeAccount!.id}&limit=50`),
    enabled: !!activeAccount,
    select: (d) => d.trades,
  });
  const focusTime = params.at ? Number(params.at) : undefined;

  // Result toast when the server closes one of our trades.
  useEffect(() => subscribeEvents((e) => {
    if (e.type !== 'order_update') return;
    const o = e.order as { status: string; fail_reason: string | null };
    void qc.invalidateQueries({ queryKey: ['orders'] });
    if (o.status === 'filled') { void qc.invalidateQueries({ queryKey: ['trades', 'open'] }); void qc.invalidateQueries({ queryKey: ['me'] }); toast({ title: 'Order filled', message: 'Your trade is open.', tone: 'up' }); }
    if (o.status === 'failed') toast({ title: 'Order could not open', message: o.fail_reason ?? '', tone: 'down' });
    if (o.status === 'expired') toast({ title: 'Order expired', message: 'The price did not reach your trigger in time.' });
  }), [qc, toast]);

  useEffect(() => subscribeEvents((e) => {
    if (e.type !== 'trade_closed') return;
    const t = e.trade as Trade;
    const pnl = Number(t.pnl);
    const type = me?.accounts.find((a) => a.id === t.account_id)?.type ?? 'DEMO';
    toast({
      title: t.result === 'refund' ? `${money(t.amount, type)} returned` : money(pnl, type, { sign: true }),
      message: `${byId.get(t.asset_id)?.name ?? t.asset_id} · ${t.result === 'win' ? 'closed with a profit' : t.result === 'loss' ? 'closed with a loss' : 'refunded'}`
        + ` · You put ${money(t.amount, type)}, got back ${money(t.return_amount ?? 0, type)}`,
      tone: pnl > 0 ? 'up' : pnl < 0 ? 'down' : 'neutral',
    });
  }), [me, byId, toast]);

  const riskAllowed = (mode === 'fixed_time' || mode === 'inzone') && accType === 'DEMO';
  const riskQ = useQuery({
    queryKey: ['risk-free', activeAccount?.id],
    queryFn: () => api<{ left: number }>(`/risk-free?accountId=${activeAccount!.id}`),
    enabled: !!activeAccount,
  });
  const pendingOrders = useQuery({
    queryKey: ['orders', 'pending'],
    queryFn: () => api<{ id: string; asset_id: string; direction: 'up' | 'down' | null; amount: string; trigger_price: string | null; trigger_when: 'above' | 'below' | 'time'; trigger_at: string | null }[]>('/orders?status=pending'),
  });
  const open = useMutation({
    // one key per press: a duplicate send of the same press can never open a second trade (server: idempotency.js)
    mutationFn: (direction: 'up' | 'down' | null) => {
      const key = newActionKey();
      const body = {
        accountId: activeAccount!.id, assetId, mode, direction, amount,
        ...(mode === 'forex'
          ? { leverage, takeProfit: Number(takeProfit) || undefined, stopLoss: Number(stopLoss) || undefined }
          : { durationSec }),
        riskFree: riskAllowed && opts.riskFree && (riskQ.data?.left ?? 0) > 0,
      };
      return opts.orderOn
        ? api<Trade>('/orders', { method: 'POST', idempotencyKey: key, body: opts.orderBy === 'time'
          ? { ...body, triggerAt: new Date(opts.triggerAt ?? defaultTriggerAt()).toISOString() }
          : { ...body, triggerPrice: opts.trigger ?? price } })
        : api<Trade>('/trades', { method: 'POST', body, idempotencyKey: key });
    },
    onSuccess: (t) => {
      if (opts.orderOn) {
        toast({ title: 'Order placed', message: opts.orderBy === 'time'
          ? `Opens at ${fmtTriggerTime(opts.triggerAt ?? defaultTriggerAt())}, ${fmtTriggerDate(opts.triggerAt ?? defaultTriggerAt())}`
          : `Opens when ${asset?.name ?? assetId} reaches ${(opts.trigger ?? price ?? 0).toFixed(asset?.decimals ?? 5)}` });
        void qc.invalidateQueries({ queryKey: ['orders'] });
        return;
      }
      qc.setQueryData<{ trades: Trade[] }>(['trades', 'open'], (old) => ({ trades: [t, ...(old?.trades ?? [])] }));
      qc.invalidateQueries({ queryKey: ['me'] });
      if (t.risk_free) void qc.invalidateQueries({ queryKey: ['risk-free'] });
    },
    onError: (e: ApiError) => {
      if (e.code === OUTCOME_UNKNOWN) {   // it may have opened: refresh so the person sees the truth before pressing again
        void qc.invalidateQueries({ queryKey: ['trades', 'open'] });
        void qc.invalidateQueries({ queryKey: ['orders'] });
        void qc.invalidateQueries({ queryKey: ['me'] });
        return toast({ title: 'Not sure it went through', message: e.message, tone: 'down' });
      }
      toast({ title: opts.orderOn ? 'Order not placed' : 'Trade not opened', message: e.message, tone: 'down' });
    },
  });
  const cancelOrder = useMutation({
    mutationFn: (id: string) => api(`/orders/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });

  const closeForex = useMutation({
    mutationFn: (id: string) => api<Trade>(`/trades/${id}/close`, { method: 'POST' }),
    onError: (e: ApiError) => toast({ title: 'Could not close', message: e.message, tone: 'down' }),
  });

  const boosts = useBoosts();
  // what you are shown matches what the server applies when the trade opens (apply_boost)
  const boosted = mode === 'fixed_time' && accType === 'DEMO' && boosts.until > now;
  const payout = (Number(mode === 'inzone' ? asset?.payout_inzone : asset?.payout_fixed) || 0) + (boosted ? BOOST_POINTS : 0);
  // Display only: the server computes the real corridor with the same formula when the trade opens.
  // Live markets: the server's corridor from real recent volatility. Simulated markets: the asset's fixed setting.
  const liveZone = useQuery({
    queryKey: ['zone', assetId, durationSec], enabled: mode === 'inzone' && asset?.price_source === 'binance', refetchInterval: 20_000,
    queryFn: () => api<{ zonePct: number | null }>(`/zone/${assetId}?durationSec=${durationSec}`),
  });
  const zonePct = !asset ? 0 : asset.price_source === 'binance' ? liveZone.data?.zonePct ?? 0 : Number(asset.volatility) * 0.6 * Math.sqrt(durationSec * 4) * 100;
  const filteredAssets = useMemo(
    () => assets.filter((a) => (assetCategory === 'all' || a.category === assetCategory)
      && a.name.toLowerCase().includes(assetQuery.toLowerCase())),
    [assets, assetQuery, assetCategory],
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const [groupIds, setGroupIds] = useState<string[] | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);   // buyers vs sellers details (tap the momentum bar)   // a tapped marker that stands for several trades
  const activeTrade = (openTrades.data ?? []).find((t) => t.id === activeId) ?? null;

  const drawingList = (
        <View>
          <Txt style={{ color: colors.muted, fontSize: 13, marginBottom: 4 }}>
            {drawings.length ? `${drawings.length} on ${asset?.name ?? assetId} · tap a line on the chart to select it` : 'Pick a tool, then tap the chart'}
          </Txt>
          <View>
            {TOOLS.map((d) => (
              <Press key={d.tool} style={styles.pickRow} haptic={false} accessibilityLabel={d.label}
                onPress={() => { setDrawTool(d.tool); setPendingPoints([]); setSelectedDrawing(null); setSheet(null); }}>
                <d.Icon size={22} color={drawTool === d.tool ? colors.demo : colors.text} />
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontSize: 16 }}>{d.label}</Txt>
                  <Txt style={{ fontSize: 12, color: colors.muted }}>{d.hint}</Txt>
                </View>
                {drawTool === d.tool ? <Check size={20} color={colors.demo} /> : null}
              </Press>
            ))}
          </View>
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />
          {[
            { key: 'keepTool' as const, label: 'Stay in drawing mode', hint: 'Place several drawings without reopening this menu' },
            { key: 'magnet' as const, label: 'Magnet', hint: 'Snap taps to the nearest candle open, high, low or close' },
          ].map((o) => (
            <View key={o.key} style={[styles.pickRow, { justifyContent: 'space-between' }]}>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontSize: 16 }}>{o.label}</Txt>
                <Txt style={{ fontSize: 12, color: colors.muted }}>{o.hint}</Txt>
              </View>
              <Toggle accessibilityLabel={o.label} value={o.key === 'keepTool' ? keepTool : magnet}
                onValueChange={(v) => saveDrawPrefs({ keepTool, magnet, [o.key]: v })} />
            </View>
          ))}
          {drawings.length ? (
            <>
              <Press style={styles.pickRow} haptic={false} accessibilityLabel="Undo last drawing"
                onPress={() => { setDrawings((list) => list.slice(0, -1)); setSelectedDrawing(null); setSheet(null); }}>
                <Undo2 size={22} color={colors.text} />
                <Txt style={{ fontSize: 16 }}>Undo last drawing</Txt>
              </Press>
              <Press style={styles.pickRow} haptic={false} accessibilityLabel="Remove all drawings"
                onPress={() => { setDrawings(() => []); setDrawTool('none'); setPendingPoints([]); setSelectedDrawing(null); setSheet(null); }}>
                <Trash2 size={22} color={colors.down} />
                <Txt style={{ fontSize: 16, color: colors.down }}>Remove all drawings</Txt>
              </Press>
            </>
          ) : null}
        </View>
  );
  const analysisPanel = (title: boolean) => (
    <AnalysisPanel indicators={indicators} onChange={setIndicators} drawing={drawingList} title={title}
      tab={taSection} onTab={setTaSection} editId={editInd} onEdit={setEditInd}
      notify={(t, m) => toast({ title: t, message: m })} liveCrypto={asset?.price_source === 'binance'} />
  );

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      {/* top bar */}
      {desk ? (
        <View style={styles.deskTop}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexShrink: 1 }}>
            <View style={{ flexShrink: 1 }}><Segmented tabs={MODES} value={mode} onChange={setMode} dot="inzone" /></View>
            {layout.contentW < 1040 ? null : <Txt style={styles.deskNote} numberOfLines={1}>
              {`${asset?.price_source === 'binance' ? 'Live price from Binance' : 'Simulated price'} · ${accType === 'DEMO' ? 'demo account, no real money' : 'real-money trading is not available yet'}`}
            </Txt>}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: tight ? 8 : 14, flexShrink: 0 }}>
            <Press onPress={() => setSheet('accounts')} style={{ alignItems: 'flex-end' }} accessibilityLabel="Accounts">
              <Txt style={[{ fontSize: 17, fontFamily: font.bold }, type.num]}>{activeAccount ? money(activeAccount.balance, accType) : '...'}</Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Txt style={{ fontSize: 13, color: accType === 'DEMO' ? colors.demo : colors.muted }}>{accType === 'DEMO' ? 'Demo account' : `${accType} account`}</Txt>
                <ChevronDown size={14} color={accType === 'DEMO' ? colors.demo : colors.muted} />
              </View>
            </Press>
            {tight ? (
              <Press onPress={() => setSheet('deposit')} accessibilityLabel="Payments" style={styles.walletBtn}><Wallet size={19} color={colors.dark} strokeWidth={2} /></Press>
            ) : <Button label="Payments" height={40} onPress={() => setSheet('deposit')} />}
            <Press onPress={() => router.push('/profile')} accessibilityLabel="Profile"><Avatar size={40} badge={me?.unreadNotifications} /></Press>
          </View>
        </View>
      ) : (
      <View style={styles.topBar}>
        <Press onPress={() => router.push('/profile')} accessibilityLabel="Profile"><Avatar size={36} badge={me?.unreadNotifications} /></Press>
        <Press style={{ alignItems: 'center' }} onPress={() => setSheet('accounts')} accessibilityLabel="Accounts">
          <Txt style={[{ fontSize: 16, fontFamily: font.bold }, type.num]}>{activeAccount ? money(activeAccount.balance, accType) : '...'}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Txt style={{ fontSize: 12, color: accType === 'DEMO' ? colors.demo : colors.muted }}>{accType === 'DEMO' ? 'Demo account' : `${accType} account`}</Txt>
            <ChevronDown size={13} color={accType === 'DEMO' ? colors.demo : colors.muted} />
          </View>
        </Press>
        <Press onPress={() => setSheet('deposit')} accessibilityLabel="Deposit" style={styles.walletBtn}>
          <Wallet size={19} color={colors.dark} strokeWidth={2} />
        </Press>
      </View>
      )}

      <View style={side ? styles.sideRow : { flex: 1 }}>
      {desk && deskPanel ? (
        <View style={styles.dock}>
          <View style={styles.dockHead}>
            <Txt style={styles.dockTitle}>{deskPanel === 'signals' ? 'Signals' : 'Technical analysis'}</Txt>
            <Press haptic={false} onPress={() => { setDeskPanel(null); setEditInd(null); }} accessibilityLabel="Close panel" style={styles.dockClose}>
              <X size={22} color={colors.text} />
            </Press>
          </View>
          {deskPanel === 'signals'
            ? <SignalsPanel assetId={assetId} selectedId={signalId} onOpen={openSignal} onBack={() => { setSignalId(null); setPlanOn(false); }} onSeeChart={() => setPlanOn(true)} />
            : analysisPanel(false)}
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
      {desk ? (
        <AssetTabs current={assetId} onSelect={setAssetId}
          payoutOf={(id) => { const a = byId.get(id); const pay = Number(mode === 'inzone' ? a?.payout_inzone : a?.payout_fixed); return mode === 'forex' || !pay ? null : `${pay}%`; }} />
      ) : (
      <>
      {/* mode pills */}
      <View style={styles.modes}>
        <Segmented tabs={MODES} value={mode} onChange={setMode} dot="inzone" />
      </View>

      {/* asset row (not in Stocks: there are no stock prices yet) */}
      {mode !== 'stocks' ? (<>
      <View style={styles.assetRow}>
          <BoostButton size={38} />
          <Press style={[styles.assetPick, glass('regular', { shadow: false })]} onPress={() => setSheet('asset')} accessibilityLabel="Choose asset">
            <AssetIcon id={assetId} size={24} />
            <Txt style={{ fontSize: 14, fontFamily: font.semibold, flexShrink: 1 }} numberOfLines={1}>{asset?.name ?? assetId}</Txt>
            {(mode === 'fixed_time' || mode === 'inzone') && payout > 0 ? <Txt numberOfLines={1} style={{ fontSize: 14, fontFamily: font.semibold, color: colors.up, flexShrink: 0 }}>{payout}%</Txt> : null}
            {mode === 'forex' ? <Txt style={{ fontSize: 13, color: colors.muted }}>• FX</Txt> : null}
          </Press>
        <LiquidBox radius={12} style={styles.toolGroup}>
          <Press style={styles.toolBtn} onPress={() => setSheet('signals')} accessibilityLabel={signals.alert ? `Signals, new signal, ${signals.active.length} available` : signals.hasActive ? `Signals, signal active, ${signals.active.length} available` : 'Signals'}>
            <Blink on={signals.hasActive} pulse={signals.alert} count={signals.active.length}><Radio size={20} color={signals.hasActive ? colors.upVivid : colors.text} /></Blink>
          </Press>
          <Press style={styles.toolBtn} onPress={() => setSheet('draw')} accessibilityLabel="Technical analysis">
            <DraftingCompass size={20} color={drawTool !== 'none' ? colors.accent : colors.text} />
            {drawings.length + indicators.length ? <View style={styles.drawBadge}><Txt style={{ fontSize: 10, color: colors.dark, fontFamily: font.bold }}>{drawings.length + indicators.length}</Txt></View> : null}
          </Press>
          <Press style={[styles.toolBtn, { width: 'auto', paddingHorizontal: 10 }]} onPress={() => setSheet('tf')} accessibilityLabel="Chart type and time frame">
            <Txt style={[{ fontSize: 15, fontFamily: font.semibold }, type.num]}>
              {chartType === 'area' ? AREA_RANGES.find((r) => r.sec === areaRange)?.label : duration(tf)}
            </Txt>
          </Press>
        </LiquidBox>
      </View>
      <Txt style={styles.simulated}>
        {asset?.price_source === 'binance' ? '● Live' : 'Simulated prices'}
      </Txt>
      </>) : null}
      </>
      )}

      {/* chart */}
      <View style={{ flex: 1, paddingLeft: 4 }}>
        {mode === 'stocks' ? (
          <View style={styles.stocks}>
            <Txt style={{ fontSize: 16, fontFamily: font.bold, textAlign: 'center' }}>Stocks are coming later</Txt>
            {desk ? <Txt style={{ color: colors.muted, textAlign: 'center' }}>Stock trading needs a licensed market-data provider and a live account.</Txt> : null}
          </View>
        ) : (
          <CandleChart
            candles={candles} chartType={chartType} decimals={asset?.decimals ?? 5} tf={chartTf} price={price} momentumUp={momentum}
            mode={mode} durationSec={durationSec} zonePct={zonePct} trades={onChart} now={now}
            pastTrades={pastTrades.data} focusTime={focusTime}
            drawings={drawings} pendingPoints={pendingPoints} drawTool={drawTool} onChartTap={onChartTap}
            selectedDrawing={selectedDrawing} onDrawingPress={setSelectedDrawing} magnet={magnet}
            indicators={indicators} volume={volumeQ.data?.live ? volumeQ.data.bars : null}
            onIndicatorPress={(id) => { setEditInd(id); if (desk) setDeskPanel('analysis'); else setSheet('draw'); }}
            crosshair={desk} onAddLevel={(lvl) => { addDrawing({ kind: 'hline', price: lvl }); toast({ title: 'Line added', message: `Horizontal line at ${lvl}` }); }}
            onTradesPress={(ids) => (ids.length === 1 ? setActiveId(ids[0]) : setGroupIds(ids))}
            onMomentumPress={() => setFlowOpen(true)}
            plan={plan && plan.mode === 'forex' ? { entry: plan.entry, stop: plan.stop, target: plan.target, muted: plan.status === 'missed' || plan.status === 'done' } : null}
            onShowTrade={() => { if (plan) setTf(signalTf); }}
          />
        )}
        {plan && mode !== 'stocks' ? (
          <View style={[styles.planChip, glass()]}>
            <Press haptic={false} style={{ flexShrink: 1 }} onPress={() => { if (desk) setDeskPanel('signals'); else setSheet('signals'); }} accessibilityLabel="Open this signal's plan">
              <Txt numberOfLines={1} style={{ fontSize: 13, fontFamily: font.semibold, color: plan.status === 'start' ? colors.up : plan.status === 'missed' ? colors.muted : plan.status === 'hold' ? colors.accent : colors.text }}>
                {{ start: 'Start now', wait: `Wait for ${plan.entry.toFixed(asset?.decimals ?? 5)}`, waiting_order: 'Your order is waiting', hold: plan.mode !== 'forex' ? 'Hold: it ends by itself' : 'Hold: stop and target are set', done: 'Finished', missed: "Missed: don't chase it" }[plan.status]}
              </Txt>
            </Press>
            <Press haptic={false} onPress={() => setPlanOn(false)} accessibilityLabel="Hide the plan"><X size={15} color={colors.muted} /></Press>
          </View>
        ) : null}
        {locked && mode !== 'stocks' ? <ConnectionOverlay state={conn} hasChart={candles.length > 0} /> : null}
        {desk && mode !== 'stocks' ? (
          <ChartToolbar tf={tf} tfs={chartType === 'area' ? [] : CANDLE_TFS} chartType={chartType} TypeIcon={ChartTypeIcon}
            areaLabel={chartType === 'area' ? AREA_RANGES.find((r) => r.sec === areaRange)?.label ?? null : null}
            onTf={(sec) => chooseChart({ tf: sec })} onType={(t) => chooseChart({ chartType: t })}
            onSignals={() => setDeskPanel((v) => (v === 'signals' ? null : 'signals'))} onTools={() => setDeskPanel((v) => (v === 'analysis' ? null : 'analysis'))}
            toolsBadge={drawings.length + indicators.length} toolsActive={drawTool !== 'none' || deskPanel === 'analysis'} signalCount={signals.active.length} signalsActive={deskPanel === 'signals'} signalAlert={signals.alert} signalOn={signals.hasActive}
            bottom={34 + indicators.filter((x) => indDef(x.key).pane).length * PANE_H} />
        ) : null}
        {drawTool !== 'none' || selectedDrawing != null ? (
          <View style={styles.drawBar} pointerEvents="box-none">
            <LiquidBox radius={22} shadow style={styles.drawPill}>
              <DraftingCompass size={16} color={colors.demo} strokeWidth={2.25} />
              <Txt style={{ fontSize: 13, fontFamily: font.semibold }}>
                {selectedDrawing != null ? 'Drawing selected' : stepHint(drawTool, pendingPoints.length)}
              </Txt>
              {selectedDrawing != null ? (
                <Press haptic={false} accessibilityLabel="Delete drawing" style={styles.drawAction}
                  onPress={() => { setDrawings((list) => list.filter((_, k) => k !== selectedDrawing)); setSelectedDrawing(null); }}>
                  <Trash2 size={17} color={colors.down} strokeWidth={2.25} />
                </Press>
              ) : null}
              <Press haptic={false} accessibilityLabel={selectedDrawing != null ? 'Done' : 'Cancel drawing'} style={styles.drawAction}
                onPress={() => { setDrawTool('none'); setPendingPoints([]); setSelectedDrawing(null); }}>
                <X size={15} color={colors.text} strokeWidth={2.25} />
              </Press>
            </LiquidBox>
          </View>
        ) : null}
      </View>

      {/* pending orders on this asset */}
      {(pendingOrders.data ?? []).filter((o) => o.asset_id === assetId).length ? (
        <SideScroll style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: SIDE, paddingBottom: 8 }}>
          {(pendingOrders.data ?? []).filter((o) => o.asset_id === assetId).map((o) => (
            <View key={o.id} {...revealHost} style={[styles.openChip, { borderStyle: 'dashed' }]}>
              {o.direction === 'up' ? <ArrowUp size={14} color={colors.up} /> : o.direction === 'down' ? <ArrowDown size={14} color={colors.down} /> : null}
              <Txt style={{ fontSize: 13 }}>{money(o.amount, accType)}</Txt>
              <Txt style={{ fontSize: 13, color: colors.muted }}>{o.trigger_when === 'time' && o.trigger_at ? `at ${fmtTriggerTime(new Date(o.trigger_at).getTime())}` : `at ${Number(o.trigger_price).toFixed(asset?.decimals ?? 5)}`}</Txt>
              <HoverReveal><Press onPress={() => cancelOrder.mutate(o.id)} hitSlop={8} accessibilityLabel="Cancel order" style={styles.rowIcon}><X size={16} color={colors.down} strokeWidth={2.5} /></Press></HoverReveal>
            </View>
          ))}
        </SideScroll>
      ) : null}

      {/* open trades on this asset */}
      {onChart.length ? (
        <SideScroll style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: SIDE, paddingBottom: 8 }}>
          {onChart.map((t) => {
            const pnl = previewPnl(t, price ?? undefined);
            return (
              <Press key={t.id} {...revealHost} style={styles.openChip} haptic={false} onPress={() => setActiveId(t.id)} accessibilityLabel="Trade details">
                {t.direction === 'up' ? <ArrowUp size={14} color={colors.up} /> : t.direction === 'down' ? <ArrowDown size={14} color={colors.down} /> : null}
                <Txt style={{ fontSize: 13 }}>{money(t.amount, accType)}</Txt>
                {t.mode !== 'forex' ? <Txt style={{ fontSize: 13, color: colors.muted, fontVariant: ['tabular-nums'] }}>{countdown(new Date(t.expires_at!).getTime() - now)}</Txt> : null}
                <Txt style={{ fontSize: 13, fontVariant: ['tabular-nums'], color: pnl == null ? colors.muted : pnlColor(pnl) }}>{pnl == null ? '...' : money(pnl, accType, { sign: true })}</Txt>
                {t.mode === 'forex' ? <HoverReveal><Press onPress={() => closeForex.mutate(t.id)} hitSlop={8} accessibilityLabel="Close trade" style={styles.rowIcon}><X size={16} color={colors.down} strokeWidth={2.5} /></Press></HoverReveal> : null}
              </Press>
            );
          })}
        </SideScroll>
      ) : null}

      </View>
      <View style={side ? [styles.sideCol, tight && { width: 264 }] : undefined}>
      {/* bottom panel (desktop: right column) */}
      {desk && mode !== 'stocks' ? (
        <View style={[styles.panel, styles.panelSide, { gap: 12 }]}>
          <View style={{ gap: 4 }}>
            <Txt style={styles.stepLabel}>Amount, {accType === 'DEMO' ? 'α' : accType}</Txt>
            <Stepper value={money(amount, accType, { decimals: 0 })} onPressValue={() => setSheet('amount')}
              onMinus={() => setAmount((v) => Math.max(1, v - amountStep(v - 1)))} onPlus={() => setAmount((v) => v + amountStep(v))} />
          </View>
          <View style={{ gap: 4 }}>
            <Txt style={styles.stepLabel}>{mode === 'forex' ? 'Multiplier' : 'Duration'}</Txt>
            {mode === 'forex' ? (
              <Stepper value={`${leverage}x`} onPressValue={() => setSheet('leverage')}
                onMinus={() => setLeverage((v) => [...LEVERAGES].reverse().find((l) => l < v) ?? v)}
                onPlus={() => setLeverage((v) => LEVERAGES.find((l) => l > v && l <= maxLev) ?? v)} />
            ) : (
              <Stepper value={duration(durationSec)} onPressValue={() => setSheet('duration')}
                onMinus={() => setDurationSec((v) => [...DURATIONS].reverse().find((d) => d < v) ?? v)}
                onPlus={() => setDurationSec((v) => DURATIONS.find((d) => d > v) ?? v)} />
            )}
          </View>
          <TradeOptions state={opts} onChange={setOpts} riskLeft={riskQ.data?.left ?? null} riskAllowed={riskAllowed}
            decimals={asset?.decimals ?? 5} price={price} onHelp={setHelp} />
          {mode === 'inzone' ? (
            <Button label={opts.orderOn ? 'Place order' : 'Open Trade'} height={56} loading={open.isPending} disabled={locked} onPress={() => open.mutate(null)} />
          ) : (
            <>
              <Button variant="up" height={56} spread label={opts.orderOn ? (mode === 'forex' ? 'Buy order' : 'Up order') : mode === 'forex' ? 'Buy' : 'Up'}
                icon={<ArrowUp size={24} color={colors.dark} />} onPress={() => open.mutate('up')} disabled={open.isPending || locked} />
              <Button variant="down" height={56} spread label={opts.orderOn ? (mode === 'forex' ? 'Sell order' : 'Down order') : mode === 'forex' ? 'Sell' : 'Down'}
                icon={<ArrowDown size={24} color={colors.dark} />} onPress={() => open.mutate('down')} disabled={open.isPending || locked} />
            </>
          )}
          <Txt style={{ textAlign: 'center', color: colors.muted, fontSize: 14 }}>
            {mode === 'forex' ? `Volume: ${moneyShort(amount * leverage, accType)}` : `Potential profit: +${moneyShort(amount * payout / 100, accType)}`}
          </Txt>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16 }}>
            <Press style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} onPress={() => setSheet('how')} haptic={false}>
              <Txt style={{ color: colors.accent, fontSize: 14 }}>How to trade</Txt>
              <CircleHelp size={16} color={colors.accent} />
            </Press>
            {mode === 'forex' ? (
              <Press style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} onPress={() => setSheet('settings')} haptic={false} accessibilityLabel="Trade settings">
                <SlidersHorizontal size={16} color={colors.accent} />
                <Txt style={{ color: colors.accent, fontSize: 14 }}>Take profit / stop loss</Txt>
              </Press>
            ) : null}
          </View>
        </View>
      ) : (
        <PhoneTradePanel mode={mode} accType={accType} balance={Number(activeAccount?.balance ?? 0)}
          amount={amount} setAmount={setAmount} amountStep={amountStep}
          durationSec={durationSec} stepDuration={(dir) => setDurationSec((v) => (dir > 0 ? DURATIONS.find((d) => d > v) : [...DURATIONS].reverse().find((d) => d < v)) ?? v)}
          leverage={leverage} payout={payout} zonePct={zonePct}
          opts={opts} setOpts={setOpts} riskLeft={riskQ.data?.left ?? null} riskAllowed={riskAllowed}
          decimals={asset?.decimals ?? 5} price={price} onHelp={setHelp}
          takeProfit={takeProfit} setTakeProfit={setTakeProfit} stopLoss={stopLoss} setStopLoss={setStopLoss}
          busy={open.isPending} locked={locked} onOpen={(d) => open.mutate(d)} onSheet={setSheet} onMode={setMode} />
      )}

      </View>
      </View>

      <Dialog open={!!help} title={help === 'order' ? 'Order' : 'Risk-free'} body={help ? OPTION_HELP[help] : ''}
        onClose={() => setHelp(null)} actions={[{ label: 'Got it', onPress: () => setHelp(null) }]} />

      {/* sheets */}
      <OrderFlowSheet assetId={assetId} tf={chartTf} open={flowOpen} onClose={() => setFlowOpen(false)} />
      <ActiveTradeSheet trade={activeTrade} accountType={accType} onClose={() => setActiveId(null)} />
      <Sheet half open={!!groupIds} onClose={() => setGroupIds(null)}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: SIDE, paddingBottom: 20, gap: 8 }}>
          <Txt style={{ fontSize: 17, fontFamily: font.bold, textAlign: 'center', marginBottom: 4 }}>{groupIds?.length} trades here</Txt>
          {(openTrades.data ?? []).filter((t) => groupIds?.includes(t.id)).map((t) => (
            <TradeCard key={t.id} trade={t} accountType={accType} livePrice={price ?? undefined} now={now}
              onPress={() => { setGroupIds(null); setActiveId(t.id); }} />
          ))}
        </ScrollView>
      </Sheet>
      <AccountsSheet open={sheet === 'accounts'} onClose={() => setSheet(null)} />
      <DepositSheet open={sheet === 'deposit'} onClose={() => setSheet(null)} />

      <Sheet half open={sheet === 'asset'} onClose={() => setSheet(null)}>
        <View style={{ paddingHorizontal: SIDE, gap: 8, flex: 1, minHeight: 0 }}>
          <View style={styles.search}>
            <Search size={18} color={colors.muted} />
            <TextInput value={assetQuery} onChangeText={setAssetQuery} placeholder="Search assets" placeholderTextColor={colors.muted}
              style={[{ flex: 1, color: colors.text, fontSize: 15 }, { outlineStyle: 'none' } as object]} />
          </View>
          <SideScroll contentContainerStyle={{ gap: 6 }}>
            {PICKER_CATEGORIES.map((c) => (
              <Press key={c.key} haptic={false} onPress={() => setAssetCategory(c.key)}
                style={[styles.catChip, assetCategory === c.key && { backgroundColor: colors.text, borderColor: colors.text }]}>
                <Txt style={{ fontSize: 14, fontFamily: font.medium, color: assetCategory === c.key ? colors.dark : colors.text }}>{c.label}</Txt>
              </Press>
            ))}
          </SideScroll>
          <ScrollView style={{ flex: 1 }}>
            {filteredAssets.map((a) => (
              <Press key={a.id} style={styles.pickRow} haptic={false} onPress={() => { setAssetId(a.id); setSheet(null); }}>
                <AssetIcon id={a.id} size={28} />
                <Txt style={{ flex: 1, fontSize: 16 }}>{a.name}</Txt>
                <Txt style={{ color: colors.up }}>{mode === 'inzone' ? a.payout_inzone : a.payout_fixed}%</Txt>
              </Press>
            ))}
          </ScrollView>
        </View>
      </Sheet>

      <Sheet half open={sheet === 'draw'} onClose={() => { setSheet(null); setEditInd(null); }}>
        <View style={{ paddingHorizontal: SIDE, flex: 1, minHeight: 0 }}>{analysisPanel(true)}</View>
      </Sheet>
      <Sheet half open={sheet === 'signals'} onClose={() => setSheet(null)}>
        <View style={{ paddingHorizontal: SIDE, flex: 1, minHeight: 0, gap: 8 }}>
          <Txt style={styles.sheetTitle}>Signals</Txt>
          <SignalsPanel assetId={assetId} selectedId={signalId} onOpen={openSignal} onBack={() => { setSignalId(null); setPlanOn(false); }} onSeeChart={() => { setPlanOn(true); setSheet(null); }} />
        </View>
      </Sheet>

      <Sheet open={sheet === 'tf'} onClose={() => setSheet(null)}>
        <View style={{ gap: 12, paddingBottom: 6 }}>
          <Txt style={styles.sectionLabel}>
            {chartType === 'area' ? 'Chart time frame' : chartType === 'bar' ? 'Bar time frame' : 'Candle time frame'}
          </Txt>
          <SideScroll contentContainerStyle={styles.chipRow}>
            {chartType === 'area'
              ? AREA_RANGES.map((r) => (
                <Press key={r.sec} haptic={false} onPress={() => chooseChart({ areaRange: r.sec })}
                  style={[styles.tfChip, areaRange === r.sec && styles.tfChipOn]}>
                  <Txt style={styles.tfChipText}>{r.label}</Txt>
                </Press>
              ))
              : CANDLE_TFS.map((s) => (
                <Press key={s} haptic={false} onPress={() => chooseChart({ tf: s })}
                  style={[styles.tfChip, tf === s && styles.tfChipOn]}>
                  <Txt style={styles.tfChipText}>{duration(s)}</Txt>
                </Press>
              ))}
          </SideScroll>
          <Txt style={styles.sectionLabel}>Chart type</Txt>
          <SideScroll contentContainerStyle={styles.chipRow}>
            {CHART_TYPES.map((c) => (
              <Press key={c.key} haptic={false} onPress={() => chooseChart({ chartType: c.key })}
                style={[styles.typeChip, chartType === c.key && styles.tfChipOn]}>
                <ChartTypeIcon type={c.key} size={20} color={colors.text} />
                <Txt style={styles.tfChipText}>{c.label}</Txt>
              </Press>
            ))}
          </SideScroll>
        </View>
      </Sheet>
      <OptionSheet open={sheet === 'duration'} title="Trade duration" onClose={() => setSheet(null)}
        options={DURATIONS.map((v) => ({ value: v, label: duration(v) }))} value={durationSec} onPick={setDurationSec} />
      <OptionSheet open={sheet === 'leverage'} title="Multiplier" onClose={() => setSheet(null)}
        options={LEVERAGES.filter((l) => l <= maxLev).map((v) => ({ value: v, label: `${v}x` }))} value={leverage} onPick={setLeverage} />
      <AmountSheet open={sheet === 'amount'} value={amount} onClose={() => setSheet(null)} onPick={setAmount} />

      <Sheet open={sheet === 'settings'} onClose={() => setSheet(null)}>
        <View style={{ paddingHorizontal: SIDE, gap: 12 }}>
          <Txt style={styles.sheetTitle}>Trade settings</Txt>
          <TradeOptions state={opts} onChange={setOpts} riskLeft={riskQ.data?.left ?? null} riskAllowed={riskAllowed}
            decimals={asset?.decimals ?? 5} price={price} onHelp={setHelp} compact />
          {mode === 'forex' ? (
            <>
              <Txt style={{ color: colors.muted }}>Close automatically when the trade reaches this profit or loss. A trade also closes if the loss reaches the full amount.</Txt>
              <MoneyInput label="Take profit" value={takeProfit} onChange={setTakeProfit} />
              <MoneyInput label="Stop loss" value={stopLoss} onChange={setStopLoss} />
            </>
          ) : (
            <Txt style={{ color: colors.muted }}>Choose the amount and duration with the steppers, then pick Up or Down. You win if the price at the end is on your side of the opening price.</Txt>
          )}
          <Button label="Done" onPress={() => setSheet(null)} />
        </View>
      </Sheet>

      <Sheet open={sheet === 'how'} onClose={() => setSheet(null)}>
        <View style={{ paddingHorizontal: SIDE, gap: 12 }}>
          <Txt style={styles.sheetTitle}>How it works</Txt>
          {(mode === 'inzone' ? [
            'Pick an amount and a duration. The blue corridor shows the price range for your trade.',
            'Open the trade. If the price is still inside the corridor when the time runs out, you win.',
            `A winning trade pays your amount plus ${payout}%.`,
          ] : mode === 'forex' ? [
            'Choose Buy if you expect the price to rise, Sell if you expect it to fall.',
            'The multiplier scales your result: at 100x, a 0.1% move changes your result by 10% of the amount.',
            'Close the trade any time. You can never lose more than the amount.',
          ] : [
            'Set how much to trade and for how long.',
            'Predict whether the price will be higher (Up) or lower (Down) when the time ends.',
            `If you are right, you get your amount back plus ${payout}%. If the price ends exactly where it started, your amount is returned.`,
          ]).map((line, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
              <Txt style={{ color: colors.accent, fontFamily: font.bold }}>{i + 1}</Txt>
              <Txt style={{ flex: 1 }}>{line}</Txt>
            </View>
          ))}
          <Txt style={{ color: colors.muted, fontSize: 12 }}>Demo prices are simulated. Trading involves risk.</Txt>
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

function OptionSheet<T extends number>({ open, title, options, value, onPick, onClose }: {
  open: boolean; title: string; options: { value: T; label: string }[]; value: T; onPick: (v: T) => void; onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose}>
      <Txt style={styles.sheetTitle}>{title}</Txt>
      <View style={styles.grid}>
        {options.map((o) => (
          <Press key={o.value} haptic={false} onPress={() => { onPick(o.value); onClose(); }}
            style={[styles.gridItem, o.value === value && { borderColor: colors.accent, backgroundColor: colors.surface2 }]}>
            <Txt style={{ fontSize: 16 }}>{o.label}</Txt>
          </Press>
        ))}
      </View>
    </Sheet>
  );
}

function AmountSheet({ open, value, onPick, onClose }: { open: boolean; value: number; onPick: (v: number) => void; onClose: () => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (open) setText(String(value)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = Math.floor(Number(text));
  return (
    <Sheet open={open} onClose={onClose}>
      <View style={{ paddingHorizontal: SIDE, gap: 12 }}>
        <Txt style={styles.sheetTitle}>Amount</Txt>
        <MoneyInput label="Amount" value={text} onChange={setText} autoFocus />
        <View style={styles.grid}>
          {[10, 50, 100, 500, 1000, 3000].map((v) => (
            <Press key={v} style={styles.gridItem} haptic={false} onPress={() => setText(String(v))}><Txt>{v.toLocaleString()}</Txt></Press>
          ))}
        </View>
        <Button label="Apply" disabled={!(n >= 1)} onPress={() => { onPick(n); onClose(); }} />
      </View>
    </Sheet>
  );
}

function MoneyInput({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <View style={styles.moneyInput}>
      <Txt style={{ fontSize: 13, color: colors.muted }}>{label}</Txt>
      <TextInput value={value} onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" autoFocus={autoFocus}
        placeholder="Off" placeholderTextColor={colors.muted}
        style={[{ color: colors.text, fontSize: 20, paddingVertical: 4 }, { outlineStyle: 'none' } as object]} />
    </View>
  );
}

const styles = createStyles(() => ({
  rowIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  page: { flex: 1, backgroundColor: colors.bg },
  topBar: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SIDE },
  accountChip: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  demoBadge: { backgroundColor: colors.demo, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 3 },
  demoText: { color: colors.dark, fontSize: 12, fontFamily: font.bold },
  walletBtn: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: isLight() ? colors.accent : colors.text, ...glassEdge(true) },
  modes: { paddingHorizontal: SIDE, paddingVertical: 4 },
  drawBar: { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center' },
  drawPill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingLeft: 14, paddingRight: 6, borderRadius: 20 },
  drawAction: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: 10, borderRadius: 15, backgroundColor: colors.surface2 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.up },
  assetRow: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: SIDE },
  assetPick: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, height: 38, paddingHorizontal: 8, borderRadius: 12 },
  tfBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6 },
  simulated: { color: colors.muted, fontSize: 11, paddingHorizontal: SIDE, marginTop: -2 },
  drawBadge: { position: 'absolute', top: 0, right: 0, minWidth: 14, height: 14, borderRadius: 7, backgroundColor: colors.demo, alignItems: 'center', justifyContent: 'center' },
  planChip: { position: 'absolute', top: 8, alignSelf: 'center', maxWidth: '90%', flexDirection: 'row', alignItems: 'center', gap: 10, height: 34, paddingHorizontal: 12, borderRadius: 17 },
  stocks: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  openChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 10, height: 32 },
  panel: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
    borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border,
    paddingHorizontal: SIDE, paddingBottom: 12, gap: 12,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.muted, alignSelf: 'center', marginTop: 8 },
  sideRow: { flex: 1, flexDirection: 'row' },
  dock: { width: 340, borderRightWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16, gap: 12 },
  dockHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dockTitle: { fontSize: 22, fontFamily: font.bold },
  dockClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  toolGroup: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, overflow: 'hidden' },
  toolBtn: { width: 40, height: 38, alignItems: 'center', justifyContent: 'center' },
  sideCol: { width: 320, borderLeftWidth: 1, borderColor: colors.border },
  deskTop: { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: 1, borderColor: colors.border },
  deskNote: { fontSize: 12, color: colors.faint, flexShrink: 1 },
  stepLabel: { fontSize: 12, color: colors.muted, paddingHorizontal: 6 },
  optChip: { fontSize: 12, fontFamily: font.semibold, color: colors.demo, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
  panelSide: { flex: 1, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderWidth: 0, paddingTop: 20, justifyContent: 'flex-start' },
  settingsBtn: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.surface2 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 52 },
  catChip: { height: 34, paddingHorizontal: 14, borderRadius: 17, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  sectionLabel: { fontSize: 13, fontFamily: font.semibold, color: colors.muted, paddingHorizontal: SIDE, letterSpacing: 0.2 },
  chipRow: { gap: 8, paddingHorizontal: SIDE },
  tfChip: { minWidth: 56, height: 44, paddingHorizontal: 14, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  tfChipOn: { backgroundColor: colors.surface2, borderColor: colors.border },
  tfChipText: { fontSize: 16, fontFamily: font.medium, fontVariant: ['tabular-nums'] },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent' },
  sheetTitle: { fontSize: 17, fontFamily: font.semibold, textAlign: 'center', marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: SIDE, justifyContent: 'center' },
  gridItem: { minWidth: 70, height: 44, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  moneyInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 8 },
}));
