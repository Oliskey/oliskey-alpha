// AI Agents: how the 14 AI Spot agents look at every coin, how they agree (or block) before a decision, and how they improve
// each other through the shared improvement registry. Read-only: nothing here can change a rule or place an order.
import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, ChartPie, ChevronDown, ChevronUp, FlaskConical, GraduationCap, HeartPulse, Hourglass, Lightbulb, ListChecks, LogOut,
  Newspaper, Send, ShieldAlert, ShieldCheck, Timer, Users, type LucideIcon,
} from 'lucide-react-native';
import { api } from '@/lib/api';
import { card, colors, font, radius, type, createStyles } from '@/theme';
import { Spinner } from '@/ui/kit';
import { Press } from '@/ui/Press';
import { Txt } from '@/ui/Txt';

type Verdict = 'PASS' | 'WAIT' | 'BLOCK' | 'INFO';
type AgentView = { agent: string; name: string; verdict: Verdict; says: string; data?: Record<string, unknown> };
type Decision = { id: string; symbol: string; timeframe: string; bar_at: string; decided_at: string; decision: 'TRADE' | 'WAIT' | 'NO_TRADE'; strategy: string | null; agents: AgentView[] };
type Card = { key: string; name: string; role: string; why: string; views: number; tally: Record<Verdict, number>; last: string | null; vetoes?: { n: number; avg_r: number } | null };
type Review = { by: string; verdict: string; n?: number; delta_r_per_trade?: number; baseline_total_r?: number; variant_total_r?: number; blocked_avg_r?: number };
type Improvement = { id: string; title: string; origin: string; affects: string[]; why: string; status: string; version: number;
  evidence: { summary?: string; blocked_closed?: number; blocked_avg_r?: number | null } | null; reviews: Review[]; history: { at: string; status: string; note: string }[] };
type Health = { state: 'ACTIVE' | 'WATCH' | 'PAUSED'; reason: string; closed: number; total_r: number; drawdown_r: number };
type AgentsData = {
  killSwitch: { on: boolean; reason: string | null };
  agents: null | { cards: Card[]; latest: Decision[]; recent: Decision[]; counts: Record<string, number>; rules: Record<string, boolean>;
    health: Record<string, Health>; improvements: Improvement[]; updatedAt: string;
    strategies?: Record<string, { closed: number; open: number; verdict: string; style?: string; timeframe?: string }> };
};

const ICON: Record<string, LucideIcon> = { market: Activity, news: Newspaper, discovery: Lightbulb, testing: FlaskConical, selection: ListChecks,
  allocation: ChartPie, entry: Timer, duration: Hourglass, exit: LogOut, risk: ShieldCheck, execution: Send, learning: GraduationCap,
  recovery: HeartPulse, collaboration: Users };
const AGENT_NAME: Record<string, string> = { market: 'Market Intelligence', news: 'News & Event Risk', discovery: 'Strategy Discovery', testing: 'Strategy Testing',
  selection: 'Strategy Selection', allocation: 'Strategy Allocation', entry: 'Entry Timing', duration: 'Trade Duration', exit: 'Exit Intelligence',
  risk: 'Risk Manager', execution: 'Execution', learning: 'Performance Learning', recovery: 'Strategy Recovery', collaboration: 'Collaborative Intelligence' };
const STRATEGY: Record<string, string> = { trend_breakout: 'Trend breakout', squeeze_breakout: 'Squeeze breakout', strict_swing: 'Strict swing',
  balanced_swing: 'Balanced swing', range_reversion: 'Range reversion', strict_scalp: 'Strict scalp', balanced_scalp: 'Balanced scalp' };
const coin = (s: string) => s.replace('USDT', '');
const vColor = (v: Verdict) => (v === 'PASS' ? colors.up : v === 'BLOCK' ? colors.down : v === 'WAIT' ? colors.demo : colors.faint);
const V_LABEL: Record<Verdict, string> = { PASS: 'Agrees', WAIT: 'Wait', BLOCK: 'Blocks', INFO: 'Info' };
const D_LABEL = { TRADE: 'TRADE', WAIT: 'WAIT', NO_TRADE: 'NO TRADE' } as const;
const dColor = (d: Decision['decision']) => (d === 'TRADE' ? colors.up : d === 'WAIT' ? colors.demo : colors.muted);
const STEPS = ['proposed', 'backtested', 'walk_forward_tested', 'paper_validating', 'approved', 'deployed'];
const STATUS: Record<string, { label: string; color: () => string }> = {
  proposed: { label: 'Proposed', color: () => colors.muted }, backtested: { label: 'Backtested', color: () => colors.accent },
  walk_forward_tested: { label: 'Walk-forward tested', color: () => colors.accent }, paper_validating: { label: 'Paper testing', color: () => colors.accent },
  approved: { label: 'Approved', color: () => colors.up }, deployed: { label: 'Working now', color: () => colors.up },
  rejected: { label: 'Rejected', color: () => colors.down }, deferred: { label: 'On hold', color: () => colors.demo },
  rolled_back: { label: 'Rolled back', color: () => colors.down },
};
const REVIEW: Record<string, string> = { accept: 'accepts', reject: 'rejects', defer: 'waits for more data', not_affected: 'not affected' };
const reviewColor = (v: string) => (v === 'accept' ? colors.up : v === 'reject' ? colors.down : colors.muted);
const R = (v: number | null | undefined) => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(2)}R`);
const time = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function AgentsPanel() {
  const q = useQuery({ queryKey: ['spot', 'agents'], queryFn: () => api<AgentsData>('/spot/agents'), refetchInterval: 120_000 });
  const [open, setOpen] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <Txt style={styles.muted}>{(q.error as Error | null)?.message ?? 'The agents are not available.'}</Txt>;
  const a = q.data.agents;
  if (!a) {
    return (
      <View style={styles.card}>
        <Txt style={styles.title}>The agents have not run yet</Txt>
        <Txt style={styles.muted}>They look at every coin after each candle closes: every 15 minutes for scalps and every 4 hours for swings.</Txt>
      </View>
    );
  }
  // most useful first: trades and waits, then coins with a signal, then the rest; 4h swings before 15m scalps
  const signalOf = (d: Decision) => (d.agents.find((x) => x.agent === 'selection')?.data?.signals as string[] | undefined)?.length ?? 0;
  const rank = (d: Decision) => (d.decision === 'TRADE' ? 0 : d.decision === 'WAIT' ? 1 : signalOf(d) ? 2 : 3) * 10 + (d.timeframe === '4h' ? 0 : 1);
  const decisions = [...a.latest].sort((x, y) => rank(x) - rank(y) || x.symbol.localeCompare(y.symbol));
  const shown = open ?? decisions[0]?.id ?? null;
  const trades = a.counts.TRADE ?? 0, waits = a.counts.WAIT ?? 0, none = a.counts.NO_TRADE ?? 0;

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.hero}>
        <Users size={22} color={colors.accent} />
        <View style={{ flex: 1, gap: 4 }}>
          <Txt style={styles.title}>14 agents decide together</Txt>
          <Txt style={styles.muted}>
            When a candle closes, every agent looks at the coin and gives its view. A paper trade happens only when the needed agents agree and none
            blocks it. They are fixed, written rules, not guesses, and none of them can use real money.
          </Txt>
        </View>
      </View>

      <View style={styles.stats}>
        <Stat label="Coins watched" value={String(new Set(a.latest.map((d) => d.symbol)).size)} />
        <Stat label="Trades" value={String(trades)} color={colors.up} />
        <Stat label="Waits" value={String(waits)} color={colors.demo} />
        <Stat label="No trade" value={String(none)} />
      </View>

      {q.data.killSwitch.on && (
        <View style={[styles.card, { borderColor: colors.down }]}>
          <View style={styles.row}><ShieldAlert size={18} color={colors.down} /><Txt style={{ color: colors.down, fontFamily: font.semibold, flex: 1 }}>Safety switch is ON: {q.data.killSwitch.reason}</Txt></View>
          <Txt style={styles.muted}>No agent can open a trade until a person clears it.</Txt>
        </View>
      )}

      <Txt style={type.sectionTitle}>Latest decision on each coin</Txt>
      <View style={styles.legend}>
        {(['PASS', 'WAIT', 'BLOCK', 'INFO'] as Verdict[]).map((v) => (
          <View key={v} style={styles.row}><View style={[styles.dot, { backgroundColor: vColor(v) }]} /><Txt style={styles.small}>{V_LABEL[v]}</Txt></View>
        ))}
      </View>
      <View style={{ gap: 8 }}>
        {decisions.map((d) => {
          const final = d.agents.find((x) => x.agent === 'collaboration');
          const isOpen = shown === d.id;
          return (
            <View key={d.id} style={[styles.card, isOpen && { borderColor: colors.accent }]}>
              <Press haptic={false} onPress={() => setOpen(isOpen ? '' : d.id)} style={{ gap: 8 }}>
                <View style={styles.row}>
                  <Txt style={styles.coin}>{coin(d.symbol)}</Txt>
                  <Txt style={styles.small}>{d.timeframe === '4h' ? 'Swing · 4h' : 'Scalp · 15m'}</Txt>
                  <View style={{ flex: 1 }} />
                  <View style={[styles.badge, { borderColor: dColor(d.decision) }]}>
                    <Txt style={[styles.badgeText, { color: dColor(d.decision) }]}>{D_LABEL[d.decision]}</Txt>
                  </View>
                  {isOpen ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}
                </View>
                <View style={styles.strip}>
                  {d.agents.map((x) => <View key={x.agent} style={[styles.bar, { backgroundColor: vColor(x.verdict) }]} />)}
                </View>
                <Txt style={styles.reason} numberOfLines={isOpen ? undefined : 2}>{final?.says ?? ''}</Txt>
              </Press>
              {isOpen && (
                <View style={styles.chain}>
                  <Txt style={styles.small}>How the agents decided · candle closed {time(new Date(new Date(d.bar_at).getTime() + (d.timeframe === '4h' ? 4 * 3600e3 : 900e3)).toISOString())}</Txt>
                  {d.agents.map((x, i) => {
                    const Icon = ICON[x.agent] ?? Users;
                    const last = i === d.agents.length - 1;
                    return (
                      <View key={x.agent} style={styles.step}>
                        <View style={{ alignItems: 'center', width: 28 }}>
                          <View style={[styles.stepIcon, { borderColor: vColor(x.verdict) }]}><Icon size={14} color={vColor(x.verdict)} /></View>
                          {!last && <View style={styles.line} />}
                        </View>
                        <View style={{ flex: 1, gap: 2, paddingBottom: last ? 0 : 12 }}>
                          <View style={styles.row}>
                            <Txt style={styles.stepName}>{x.name}</Txt>
                            <Txt style={[styles.verdict, { color: vColor(x.verdict) }]}>{V_LABEL[x.verdict]}</Txt>
                          </View>
                          <Txt style={styles.stepText}>{x.says}</Txt>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </View>

      <Txt style={type.sectionTitle}>The agents and their jobs</Txt>
      <View style={styles.card}>
        {a.cards.map((c, i) => {
          const Icon = ICON[c.key] ?? Users;
          const isOpen = agentOpen === c.key;
          const busy = c.tally.BLOCK + c.tally.WAIT;
          return (
            <Press key={c.key} haptic={false} onPress={() => setAgentOpen(isOpen ? null : c.key)} style={[styles.agentRow, i > 0 && styles.divider]}>
              <View style={styles.row}>
                <View style={styles.agentIcon}><Icon size={16} color={colors.accent} /></View>
                <View style={{ flex: 1 }}>
                  <Txt style={styles.stepName}>{c.name}</Txt>
                  <Txt style={styles.small} numberOfLines={isOpen ? undefined : 1}>{c.role}</Txt>
                </View>
                <Txt style={[styles.small, { color: busy ? colors.demo : colors.up }]}>{c.views ? (busy ? `${busy} stopped` : 'working') : 'idle'}</Txt>
              </View>
              {isOpen && (
                <View style={{ gap: 6, paddingLeft: 42 }}>
                  <Txt style={styles.stepText}><Txt style={styles.label}>Why it matters: </Txt>{c.why}</Txt>
                  {c.last ? <Txt style={styles.stepText}><Txt style={styles.label}>Last view: </Txt>{c.last}</Txt> : null}
                  <Txt style={styles.small}>On the latest bar: {c.tally.PASS} agree · {c.tally.WAIT} wait · {c.tally.BLOCK} block · {c.tally.INFO} info</Txt>
                  {c.vetoes ? <Txt style={styles.small}>Trades it stopped that have ended: {c.vetoes.n}, averaging {R(c.vetoes.avg_r)} (below zero means it saved money)</Txt> : null}
                </View>
              )}
            </Press>
          );
        })}
      </View>

      <Txt style={type.sectionTitle}>How they improve each other</Txt>
      <Txt style={styles.muted}>
        An agent can propose a change. Every agent it affects tests it on its own record and accepts, rejects or waits. A change works only after
        it passes; one that starts losing money is rolled back. No change reaches real money.
      </Txt>
      <View style={{ gap: 8 }}>
        {a.improvements.map((m) => {
          const st = STATUS[m.status] ?? { label: m.status, color: () => colors.muted };
          const step = STEPS.indexOf(m.status);
          return (
            <View key={m.id} style={styles.card}>
              <View style={styles.row}>
                <Txt style={[styles.stepName, { flex: 1 }]}>{m.title}</Txt>
                <View style={[styles.badge, { borderColor: st.color() }]}><Txt style={[styles.badgeText, { color: st.color() }]}>{st.label}</Txt></View>
              </View>
              <Txt style={styles.small}>Proposed by {AGENT_NAME[m.origin] ?? m.origin} · affects {m.affects.map((x) => AGENT_NAME[x] ?? x).join(', ')}</Txt>
              {step >= 0 && (
                <View style={styles.progress}>
                  {STEPS.map((s, i) => <View key={s} style={[styles.progStep, { backgroundColor: i <= step ? st.color() : colors.border }]} />)}
                </View>
              )}
              <Txt style={styles.stepText}>{m.why}</Txt>
              {m.evidence?.summary ? <Txt style={styles.stepText}><Txt style={styles.label}>Result: </Txt>{m.evidence.summary}</Txt> : null}
              {m.evidence?.blocked_closed != null ? (
                <Txt style={styles.small}>Trades it blocked that have ended: {m.evidence.blocked_closed}{m.evidence.blocked_avg_r != null ? `, averaging ${R(m.evidence.blocked_avg_r)}` : ''}. Rolled back if they average above +0.10R after 30.</Txt>
              ) : null}
              {m.reviews.length > 0 && (
                <View style={{ gap: 4 }}>
                  {m.reviews.map((r) => (
                    <View key={r.by} style={styles.row}>
                      <Txt style={[styles.small, { width: 120 }]}>{STRATEGY[r.by] ?? r.by}</Txt>
                      <Txt style={[styles.small, { color: reviewColor(r.verdict), flex: 1 }]}>
                        {REVIEW[r.verdict] ?? r.verdict}
                        {r.baseline_total_r != null && r.verdict !== 'not_affected' ? ` · ${R(r.baseline_total_r)} → ${R(r.variant_total_r)}` : ''}
                        {r.blocked_avg_r != null ? ` · blocked trades ${R(r.blocked_avg_r)}` : ''}
                      </Txt>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>

      <Txt style={type.sectionTitle}>Strategy health</Txt>
      <View style={styles.card}>
        {Object.entries(a.health).map(([sid, h], i) => {
          const s = a.strategies?.[sid];
          const fresh = h.closed === 0;
          const c = fresh ? colors.muted : h.state === 'ACTIVE' ? colors.up : h.state === 'WATCH' ? colors.demo : colors.down;
          return (
            <View key={sid} style={[{ gap: 2 }, i > 0 && styles.divider]}>
              <View style={styles.row}>
                <Txt style={[styles.stepName, { flex: 1 }]}>{STRATEGY[sid] ?? sid}</Txt>
                <Txt style={[styles.verdict, { color: c }]}>{fresh ? 'No trades yet' : h.state === 'ACTIVE' ? 'Healthy' : h.state === 'WATCH' ? 'On watch · half risk' : 'Paused'}</Txt>
              </View>
              <Txt style={styles.small}>
                {s?.style === 'scalp' ? 'Scalp · 15m' : 'Swing · 4h'} · {h.closed} closed paper trades · {R(h.total_r)}
                {s?.verdict ? ` · ${s.verdict === 'NOT_YET_PROVEN' ? 'not yet proven' : s.verdict.toLowerCase().replace(/_/g, ' ')}` : ''}
              </Txt>
            </View>
          );
        })}
      </View>
      <Txt style={styles.small}>Updated {time(a.updatedAt)}. Paper trading only: the server has no real-money path for these agents.</Txt>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Txt style={[styles.statValue, color ? { color } : null]}>{value}</Txt>
      <Txt style={styles.small}>{label}</Txt>
    </View>
  );
}

const styles = createStyles(() => ({
  hero: { ...card, flexDirection: 'row', gap: 12, padding: 14, borderColor: colors.accent },
  card: { ...card, padding: 14, gap: 10 },
  title: { fontSize: 16, fontFamily: font.semibold },
  muted: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  small: { fontSize: 12, color: colors.muted, lineHeight: 16 },
  label: { fontSize: 13, fontFamily: font.semibold, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { ...card, flex: 1, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 20, fontFamily: font.bold, fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  coin: { fontSize: 16, fontFamily: font.bold, minWidth: 48 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontFamily: font.bold, letterSpacing: 0.3 },
  strip: { flexDirection: 'row', gap: 3 },
  bar: { flex: 1, height: 6, borderRadius: 3 },
  reason: { fontSize: 13, color: colors.text, lineHeight: 19 },
  chain: { gap: 8, paddingTop: 10, borderTopWidth: 1, borderColor: colors.border },
  step: { flexDirection: 'row', gap: 10 },
  stepIcon: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  line: { flex: 1, width: 1.5, backgroundColor: colors.border, marginTop: 2 },
  stepName: { fontSize: 14, fontFamily: font.semibold },
  verdict: { fontSize: 12, fontFamily: font.bold, marginLeft: 'auto' },
  stepText: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  agentRow: { gap: 8, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderColor: colors.border },
  agentIcon: { width: 34, height: 34, borderRadius: radius.card, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  progress: { flexDirection: 'row', gap: 4 },
  progStep: { flex: 1, height: 4, borderRadius: 2 },
}));
