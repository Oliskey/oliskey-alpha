// AI Spot: long-only BTC/ETH and altcoin spot strategies, paper traded on live Binance prices.
// Shows the honest record: what passed its tests, the paper account, open positions and every recent trade.
// Read-only. No real money: the server has no real-money path for AI Spot.
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical, ShieldAlert } from 'lucide-react-native';
import { api } from '@/lib/api';
import { card, colors, font, radius, type, createStyles } from '@/theme';
import { Spinner } from '@/ui/kit';
import { Txt } from '@/ui/Txt';

type SpotStrategy = { id: string; version: string; symbol: string; coins: string[] | null; verdict: string; trades: number | null; expectancyR: number | null; expectancyLowR: number | null };
type PaperStrategy = { version: string; closed: number; open: number; wins: number; win_rate: number | null; expectancy_r: number | null; total_r: number; verdict: string; needed?: number };
type PaperOpen = { strategy: string; symbol: string; entry: number; stop: number; price: number; r_now: number; since: string };
type PaperTrade = { strategy: string; symbol: string; status: 'open' | 'closed'; entryAt: string; entry: number; exit: number | null; reason: string | null; r: number | null };
type SpotStatus = {
  mode: string; trading: 'paper' | 'no_trade'; reason: string; killSwitch: { on: boolean; reason: string | null };
  strategies: SpotStrategy[];
  paper: null | { started_at: string | null; updated_at: string; coins: string[]; errors: string[];
    strategies: Record<string, PaperStrategy>;
    account: { start: number; equity: number; realised: number; unrealised: number; taken: number; skipped: number; open: PaperOpen[] };
    recent: PaperTrade[] };
};

const NAME: Record<string, string> = { trend_breakout: 'Trend breakout', squeeze_breakout: 'Squeeze breakout', strict_swing: 'Strict swing',
  balanced_swing: 'Balanced swing', strict_scalp: 'Strict scalp', balanced_scalp: 'Balanced scalp', range_reversion: 'Range reversion' };
const name = (id: string) => NAME[id] ?? id;
const coin = (s: string) => s.replace('USDT', '');
const R = (v: number | null | undefined) => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(2)}R`);
const usdt = (v: number) => `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
const day = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
};
const EXIT: Record<string, string> = { stop: 'stopped out', trail: 'trailing stop', target: 'target hit', time: 'time limit', breakeven: 'break-even' };
const tone = (v: number | null | undefined) => (v == null || v === 0 ? colors.muted : v > 0 ? colors.up : colors.down);
const VERDICT: Record<string, string> = { NOT_YET_PROVEN: 'Not yet proven', PASSED_FORWARD: 'Proven on live prices', FAILED_FORWARD: 'Failed on live prices',
  APPROVED_FOR_PAPER: 'Passed its tests', REJECTED: 'Did not pass', MORE_DATA: 'Too few trades to judge' };

export function SpotPanel() {
  const q = useQuery({ queryKey: ['spot', 'status'], queryFn: () => api<SpotStatus>('/spot/status'), refetchInterval: 300_000 });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <Txt style={styles.meta}>{(q.error as Error | null)?.message ?? 'AI Spot is not available.'}</Txt>;
  const s = q.data;
  const p = s.paper;
  const passed = s.strategies.filter((x) => x.verdict === 'APPROVED_FOR_PAPER');
  const change = p ? p.account.equity - p.account.start : 0;

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.notice}>
        <ShieldAlert size={18} color={colors.demo} />
        <Txt style={styles.noticeText}>
          Paper trading on live Binance prices. No real money is used or at risk. A strategy counts as proven only after 100 closed
          trades pass the same fixed tests, and past results never promise future ones.
        </Txt>
      </View>
      {s.killSwitch.on && (
        <View style={[styles.card, { borderColor: colors.down }]}>
          <Txt style={{ color: colors.down, fontFamily: font.semibold }}>Stopped by the safety switch: {s.killSwitch.reason}</Txt>
        </View>
      )}

      <Txt style={type.sectionTitle}>Paper account</Txt>
      {!p ? (
        <View style={styles.card}>
          <Txt style={styles.reason}>Paper trading starts within 4 hours of this update, at the next 4-hour candle close. Results appear here then.</Txt>
        </View>
      ) : (
        <View style={styles.card}>
          <Txt style={styles.meta}>Virtual account · started {p.started_at ? day(p.started_at) : '–'} with {usdt(p.account.start)}</Txt>
          <Txt style={[styles.big, { color: tone(change) }]}>{usdt(p.account.equity)}</Txt>
          <Txt style={styles.meta}>
            {change >= 0 ? '+' : ''}{((change / p.account.start) * 100).toFixed(2)}% · realised {usdt(p.account.realised)} · open {usdt(p.account.unrealised)}
          </Txt>
          <Txt style={styles.reason}>
            1% of the account is risked per trade, with at most 3 trades open at once. {p.account.skipped} signal{p.account.skipped === 1 ? '' : 's'} came
            while 3 were open; they still count toward each strategy's record below.
          </Txt>
        </View>
      )}

      {p && (
        <>
          <Txt style={type.sectionTitle}>Strategies on live prices</Txt>
          {Object.entries(p.strategies).map(([id, v]) => (
            <View key={id} style={styles.card}>
              <View style={styles.row}>
                <Txt style={{ flex: 1, fontFamily: font.semibold, fontSize: 15 }}>{name(id)}</Txt>
                <Txt style={[styles.meta, { color: v.verdict === 'PASSED_FORWARD' ? colors.up : v.verdict === 'FAILED_FORWARD' ? colors.down : colors.muted }]}>
                  {VERDICT[v.verdict] ?? v.verdict}
                </Txt>
              </View>
              <Txt style={styles.meta}>
                {v.closed} of {v.needed ?? 100} closed trades · {v.open} open · {v.win_rate == null ? '–' : `${Math.round(v.win_rate * 100)}% won`} · average{' '}
                <Txt style={{ color: tone(v.expectancy_r), fontSize: 12 }}>{R(v.expectancy_r)}</Txt> · total{' '}
                <Txt style={{ color: tone(v.total_r), fontSize: 12 }}>{R(v.total_r)}</Txt>
              </Txt>
            </View>
          ))}

          <Txt style={type.sectionTitle}>Open now</Txt>
          <View style={styles.card}>
            {p.account.open.length ? p.account.open.map((o) => (
              <View key={`${o.strategy}${o.symbol}`} style={styles.row}>
                <Txt style={{ width: 54, fontFamily: font.semibold }}>{coin(o.symbol)}</Txt>
                <Txt style={[styles.meta, { flex: 1 }]}>{name(o.strategy)} · since {day(o.since)} · stop {o.stop}</Txt>
                <Txt style={{ color: tone(o.r_now), fontFamily: font.semibold, fontVariant: ['tabular-nums'] }}>{R(o.r_now)}</Txt>
              </View>
            )) : <Txt style={styles.reason}>No open position. When the market is falling these long-only strategies wait, by design.</Txt>}
          </View>

          <Txt style={type.sectionTitle}>Every recent trade</Txt>
          <View style={styles.card}>
            {p.recent.length ? p.recent.map((t) => (
              <View key={`${t.strategy}${t.symbol}${t.entryAt}`} style={styles.row}>
                <Txt style={{ width: 54, fontFamily: font.semibold }}>{coin(t.symbol)}</Txt>
                <Txt style={[styles.meta, { flex: 1 }]}>{name(t.strategy)} · {day(t.entryAt)}{t.reason ? ` · ${EXIT[t.reason] ?? t.reason}` : ''}</Txt>
                <Txt style={{ color: tone(t.r), fontFamily: font.semibold, fontVariant: ['tabular-nums'] }}>{t.status === 'open' ? 'open' : R(t.r)}</Txt>
              </View>
            )) : <Txt style={styles.reason}>No trade yet. These strategies trade a few times a month across all coins.</Txt>}
          </View>
          {p.errors.length > 0 && <Txt style={styles.meta}>Last update skipped {p.errors.length} coin{p.errors.length === 1 ? '' : 's'} (price data unavailable).</Txt>}
        </>
      )}

      <Txt style={type.sectionTitle}>Tests on past prices</Txt>
      <View style={styles.card}>
        <View style={styles.row}>
          <FlaskConical size={16} color={colors.muted} />
          <Txt style={[styles.reason, { flex: 1 }]}>
            {passed.length
              ? `${passed.map((x) => name(x.id)).join(', ')} passed every fixed test on coins it had never seen. The rules were written down before the test and were not changed after.`
              : 'No strategy has passed its tests yet, so nothing is traded.'}
          </Txt>
        </View>
        {[...s.strategies].sort((a, b) => Number(b.verdict === 'APPROVED_FOR_PAPER') - Number(a.verdict === 'APPROVED_FOR_PAPER')).map((x) => (
          <View key={`${x.id}${x.symbol}`} style={styles.testRow}>
            <View style={styles.row}>
              <Txt style={{ flex: 1, fontSize: 14, fontFamily: font.semibold }}>
                {name(x.id)} · {x.symbol === 'BASKET' ? `${x.coins?.length ?? 0} unseen coins` : coin(x.symbol)}
              </Txt>
              <Txt style={[styles.meta, { color: x.verdict === 'APPROVED_FOR_PAPER' ? colors.up : colors.muted }]}>{VERDICT[x.verdict] ?? x.verdict}</Txt>
            </View>
            <Txt style={styles.meta}>{x.trades ?? 0} trades · average {R(x.expectancyR)}{x.expectancyLowR != null ? ` · at worst ${R(x.expectancyLowR)}` : ''}</Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = createStyles(() => ({
  notice: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border },
  noticeText: { flex: 1, fontSize: 12, color: colors.muted, lineHeight: 17 },
  card: { ...card, padding: 14, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  testRow: { gap: 3, paddingTop: 10, borderTopWidth: 1, borderColor: colors.border },
  meta: { fontSize: 12, color: colors.muted },
  reason: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  big: { fontSize: 26, fontFamily: font.bold, fontVariant: ['tabular-nums'] },
}));
