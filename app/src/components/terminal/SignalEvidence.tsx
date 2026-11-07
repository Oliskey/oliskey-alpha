// What a signal really rests on, in the same place every time: its measured test range and its live record. All numbers
// come from the server. There is no single "chance" figure: the harder test showed the model's percentage cannot be trusted.
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical, PauseCircle } from 'lucide-react-native';
import { api, type IntelEvidence, type IntelGroup } from '@/lib/api';
import { colors, font, createStyles } from '@/theme';
import { Txt } from '@/ui/Txt';

export const useEvidence = () => useQuery({
  queryKey: ['intel', 'evidence'], queryFn: () => api<IntelEvidence>('/intel/evidence'), refetchInterval: 5 * 60_000, retry: false,
});

const STRATEGY: Record<string, string> = { updown_60m: 'Fixed Time, 60 minutes', trend_pullback: 'Trend pullback', breakout: 'Breakout', mean_reversion: 'Mean reversion' };
// strategy ids may carry the target size, e.g. breakout_2r
export function strategyLabel(id: string) {
  const m = id.match(/^(.*)_(\d+(?:\.\d+)?)r$/);   // never matches updown_60m
  const iz = id.match(/^inzone_(\d+)m$/);
  if (iz) return `InZone, ${iz[1]} minutes`;
  const base = m ? m[1] : id;
  return `${STRATEGY[base] ?? base.replace(/_/g, ' ')}${m ? ` · target ${m[2]}x the stop` : ''}`;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
export const testLine = (g: IntelGroup) => `In testing it won ${pct(g.test.low)}-${pct(g.test.high)} of ${g.test.trades} trades. It needs ${pct(g.test.breakeven)} to break even.${g.test.avg_r <= 0 ? ` Even so, on average it lost ${pct(-g.test.avg_r)} of the amount risked per trade.` : ''}`;
export const liveLine = (g: IntelGroup) => `Live so far: ${g.live.won} won, ${g.live.lost} lost, ${g.live.open} open.${g.live.too_few ? ' Too few finished to judge yet.' : ''}`;

// The one line everyone sees: how far to trust this signal, and that it can lose.
export function SignalBadge({ assetClass }: { assetClass: string }) {
  const { data } = useEvidence();
  const g = data?.groups[assetClass];
  if (g?.paused) return <View style={styles.tag}><PauseCircle size={15} color={colors.down} /><Txt style={[styles.tagText, { color: colors.down }]}>Paused: {g.paused}</Txt></View>;
  const word = !g ? null : g.status === 'proven' ? 'Passed testing' : g.status === 'test' ? 'Test signal' : 'Experimental';
  return <View style={styles.tag}><FlaskConical size={15} color={colors.demo} /><Txt style={[styles.tagText, { color: colors.demo }]}>{word ? `${word} · it can lose` : 'It can lose'}</Txt></View>;
}

// The numbers behind that line, for anyone who asks.
export function EvidenceLines({ assetClass }: { assetClass: string }) {
  const { data } = useEvidence();
  const g = data?.groups[assetClass];
  if (!g) return <Txt style={styles.line}>Test results are not available right now.</Txt>;
  const label = g.status === 'proven' ? null : g.status !== 'test' ? 'Experimental: not yet proven' : g.test.avg_r > 0 ? 'Test signal: not proven' : 'Test signal: has not beaten break-even';
  return (
    <View style={{ gap: 4 }}>
      {label ? <Txt style={[styles.line, { fontFamily: font.semibold }]}>{label}</Txt> : null}
      <Txt style={styles.line}>{testLine(g)}</Txt>
      <Txt style={styles.line}>{liveLine(g)}</Txt>
    </View>
  );
}

const styles = createStyles(() => ({
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tagText: { flex: 1, fontSize: 13, fontFamily: font.semibold },
  line: { fontSize: 13, lineHeight: 18, color: colors.text },
}));
