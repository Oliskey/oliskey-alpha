// One signal, ready to trade: which trade type, whether to start, wait, hold or skip, the suggested amount (changeable),
// and where it ends in profit or loss. All numbers come from the server. Placing needs one press, never a stray click.
import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronLeft, CircleAlert, CircleCheck, Clock, Hourglass, Target } from 'lucide-react-native';
import { useAccount } from '@/context/AccountContext';
import { useToast } from '@/ui/Toast';
import { api, type ApiError, type IntelIdea, type SignalPlan } from '@/lib/api';
import { price as fmtPrice, money } from '@/lib/format';
import { useAssets } from '@/hooks/useMarket';
import { colors, font, createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Stepper, Spinner } from '@/ui/kit';
import { More } from '@/ui/List';
import { Press } from '@/ui/Press';
import { Txt } from '@/ui/Txt';
import { AssetIcon } from '../AssetIcon';
import { EvidenceLines, SignalBadge } from './SignalEvidence';

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export function SignalTrade({ idea, onBack, onSeeChart }: { idea: IntelIdea; onBack: () => void; onSeeChart: () => void }) {
  const { activeAccount } = useAccount();
  const { byId } = useAssets();
  const qc = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState<number | null>(null);   // null: the suggested amount
  const accountId = activeAccount?.id;
  const q = useQuery({
    queryKey: ['signal-plan', idea.id, accountId, amount],
    queryFn: () => api<SignalPlan>(`/intel/signals/${idea.id}/plan?accountId=${accountId}${amount != null ? `&amount=${amount}` : ''}`),
    enabled: !!accountId, refetchInterval: 5000, placeholderData: (prev) => prev,
  });
  const take = useMutation({
    mutationFn: () => api<{ waiting: boolean }>(`/intel/signals/${idea.id}/take`, { method: 'POST', body: { accountId, amount: q.data?.amount } }),
    onSuccess: (r) => {
      toast({ title: r.waiting ? 'Order placed' : 'Trade placed', message: r.waiting ? 'It opens at the start price, with the stop and target set.' : idea.tf === '1m' ? 'It ends by itself when its time is up.' : 'The stop and target are set.' });
      for (const key of ['trades', 'orders', 'me', 'intel', 'signal-plan']) void qc.invalidateQueries({ queryKey: [key] });
      onSeeChart();
    },
    onError: (e: ApiError) => toast({ title: 'Not placed', message: e.message, tone: 'down' }),
  });

  const p = q.data;
  const a = byId.get(idea.asset_id);
  const dec = a?.decimals ?? 5;
  const accType = activeAccount?.type ?? 'DEMO';
  const up = idea.direction === 1;
  if (q.isError) return <View style={{ gap: 10 }}><Back onPress={onBack} /><Txt style={styles.note}>{(q.error as ApiError).message}</Txt></View>;
  if (!p) return <Spinner />;

  const step = Math.max(1, Math.round(p.suggestedAmount * 0.1));
  const fixed = p.mode !== 'forex';            // no stop or target: it just runs its time
  const inzone = p.mode === 'inzone';
  const mins = Math.round((p.durationSec ?? 3600) / 60);
  const STATUS: Record<SignalPlan['status'], { title: string; text: string; color: string; Icon: typeof Clock }> = {
    start: { title: 'Start now', text: `The price is at the start level. Enter before ${when(p.enterUntil)}.`, color: colors.up, Icon: CircleCheck },
    wait: { title: `Wait for ${fmtPrice(p.entry, dec)}`, text: `Don't chase the price. Place an order and it opens by itself at this price, or cancels at ${when(p.enterUntil)}.`, color: colors.demo, Icon: Hourglass },
    waiting_order: { title: 'Your order is waiting', text: `It opens at ${fmtPrice(p.entry, dec)} or cancels at ${when(p.enterUntil)}.`, color: colors.demo, Icon: Hourglass },
    hold: { title: 'Hold', text: fixed ? `Your trade is running. It ends by itself at ${when(p.holdUntil)}.` : `Your trade is running. It closes by itself at the stop, the target or the time limit (${when(p.holdUntil)}), so there is nothing to do.`, color: colors.accent, Icon: Target },
    done: { title: p.result === 'win' ? 'Finished in profit' : p.result === 'loss' ? 'Finished at a loss' : 'Finished', text: 'This trade has closed. See it in your trades.', color: p.result === 'loss' ? colors.down : colors.up, Icon: CircleCheck },
    missed: { title: 'Missed', text: p.reason === 'passed_target' ? "The price already reached the target. Don't chase it; wait for the next signal." : p.reason === 'passed_stop' ? 'The price already went past the stop, so this idea is over.' : 'The time to enter has passed. Wait for the next signal.', color: colors.muted, Icon: CircleAlert },
  };
  const s = STATUS[p.status];
  const canPlace = (p.status === 'start' || p.status === 'wait') && !p.tooSmall;
  const showMoney = p.status === 'start' || p.status === 'wait';

  return (
    <View style={{ gap: 12 }}>
      <Back onPress={onBack} />
      <View style={styles.row}>
        <AssetIcon id={idea.asset_id} size={32} />
        <Txt style={{ flex: 1, fontSize: 17, fontFamily: font.semibold }}>{a?.name ?? idea.asset_id}</Txt>
        {inzone ? (
          <View style={[styles.dir, { backgroundColor: colors.accent }]}><Txt style={{ fontSize: 14, fontFamily: font.bold, color: colors.bg }}>Stays in</Txt></View>
        ) : (
          <View style={[styles.dir, { backgroundColor: up ? colors.up : colors.down }]}>
            {up ? <ArrowUp size={15} color={colors.dark} /> : <ArrowDown size={15} color={colors.dark} />}
            <Txt style={{ fontSize: 14, fontFamily: font.bold, color: colors.dark }}>{up ? 'Up' : 'Down'}</Txt>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.row}><s.Icon size={18} color={s.color} /><Txt style={{ fontSize: 16, fontFamily: font.semibold, color: s.color }}>{s.title}</Txt></View>
        <Txt style={styles.note}>{s.text}</Txt>
      </View>

      <SignalBadge assetClass={idea.asset_class} />

      {showMoney ? (
        <View style={styles.card}>
          <Stepper label="Your amount" value={money(p.amount, accType)} onMinus={() => setAmount(Math.max(1, p.amount - step))} onPlus={() => setAmount(p.amount + step)} />
          <Line label={fixed ? 'If it ends the wrong way' : 'If the stop is hit'} value={`-${money(p.stopMoney, accType)}`} color={colors.down} />
          <Line label={fixed ? 'If it ends the right way' : 'If the target is hit'} value={`+${money(p.targetMoney, accType)}`} color={colors.up} />
          {p.tooSmall ? <Txt style={[styles.note, { color: colors.down }]}>Your balance is too small for this plan at a safe size.</Txt> : null}
        </View>
      ) : null}

      {canPlace ? <Button label={p.status === 'wait' ? 'Place waiting order' : 'Place trade'} loading={take.isPending} onPress={() => take.mutate()} /> : null}
      <Button label="See it on the chart" variant="secondary" height={44} onPress={onSeeChart} />

      <More>
        {fixed ? null : (
          <View style={styles.levels}>
            <Level label="Start" value={fmtPrice(p.entry, dec)} />
            <Level label="Stop" value={fmtPrice(p.stop, dec)} color={colors.down} />
            <Level label="Target" value={fmtPrice(p.target, dec)} color={colors.up} />
          </View>
        )}
        <EvidenceLines assetClass={idea.asset_class} />
        {p.simulated ? <Txt style={[styles.note, { color: colors.demo }]}>Practice only: these results are from the real market. This market's price in the app is simulated, so your result can differ. Stop and target keep the same distances.</Txt> : null}
        <Line label="Trade type" value={inzone ? `InZone, ${mins} minutes` : fixed ? `Fixed Time, ${mins} minutes` : `Forex, x${p.leverage}`} />
        <Txt style={styles.note}>{inzone ? `It wins if the price finishes inside the corridor after ${mins} minutes, and pays +${p.payout ?? 0}%. If not, the whole amount is lost.` : fixed ? `It wins if the price is ${up ? 'higher' : 'lower'} after ${mins} minutes, and pays +${p.payout ?? 0}%. If not, the whole amount is lost.` : 'Forex is the one trade type with a stop and a target. Fixed Time and InZone end within 4 hours and have neither; Stocks is not open yet.'}</Txt>
        {showMoney ? <Line label="Suggested amount" value={money(p.suggestedAmount, accType)} /> : null}
        {showMoney && p.riskPct != null ? <Line label="Share of balance at risk" value={`${p.riskPct}%`} color={p.riskPct > 2 ? colors.down : undefined} /> : null}
        <View style={[styles.row, { gap: 6 }]}>
          <Clock size={14} color={colors.muted} />
          <Txt style={[styles.note, { flex: 1 }]}>{fixed ? `Enter before ${when(p.enterUntil)}, or skip it: later is not the trade that was tested.` : `If neither the stop nor the target is reached, the trade closes by itself on ${when(p.holdUntil)}.`}</Txt>
        </View>
      </More>
    </View>
  );
}

function Back({ onPress }: { onPress: () => void }) {
  return (
    <Press haptic={false} onPress={onPress} accessibilityLabel="Back to signals" style={[styles.row, { alignSelf: 'flex-start', gap: 2, height: 32 }]}>
      <ChevronLeft size={18} color={colors.accent} />
      <Txt style={{ fontSize: 14, fontFamily: font.semibold, color: colors.accent }}>All signals</Txt>
    </Press>
  );
}

function Line({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={[styles.row, { justifyContent: 'space-between' }]}>
      <Txt style={styles.note}>{label}</Txt>
      <Txt style={{ fontSize: 14, fontFamily: font.semibold, fontVariant: ['tabular-nums'], color: color ?? colors.text }}>{value}</Txt>
    </View>
  );
}

function Level({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={[styles.card, { flex: 1, minWidth: 0, padding: 10, gap: 2 }]}>
      <Txt style={styles.note}>{label}</Txt>
      <Txt numberOfLines={1} style={{ fontSize: 14, fontFamily: font.semibold, fontVariant: ['tabular-nums'], color: color ?? colors.text }}>{value}</Txt>
    </View>
  );
}

const styles = createStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dir: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: 10, borderRadius: 15 },
  card: { padding: 12, gap: 8, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  levels: { flexDirection: 'row', gap: 8 },
  note: { fontSize: 12, lineHeight: 17, color: colors.muted },
  label: { fontSize: 13, fontFamily: font.medium, color: colors.text },
}));
