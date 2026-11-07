// Tasks and rewards: tasks to accept with their progress, what has really been credited (task rewards, promo
// bonuses) and the promo codes open right now.
// Nothing here is invented: an empty account shows how to earn its first reward.
import { useMemo } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, TicketPercent } from 'lucide-react-native';
import { api, type PromoCode, type Task } from '@/lib/api';
import { countdown, dayLabel, money, type AccountType } from '@/lib/format';
import { colors, font, radius, type, createStyles, tint } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { EmptyState, Spinner } from '@/ui/kit';
import { Page } from '@/ui/Page';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';

type Reward = { id: string; type: 'bonus' | 'task_reward'; amount: string; created_at: string; account_type: AccountType };

export default function Rewards() {
  const qc = useQueryClient();
  const toast = useToast();
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/tasks') });
  const accept = useMutation({
    mutationFn: (id: string) => api(`/tasks/${id}/accept`, { method: 'POST' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tasks'] }); toast({ title: 'Task accepted', message: 'Trades you open from now on count towards it.' }); },
    onError: (e) => toast({ title: 'Could not accept', message: e.message, tone: 'down' }),
  });
  const openTasks = (tasks.data ?? []).filter((t) => t.status === 'available' || t.status === 'accepted');
  const rewards = useQuery({ queryKey: ['rewards'], queryFn: () => api<Reward[]>('/rewards') });
  const promos = useQuery({ queryKey: ['promos'], queryFn: () => api<PromoCode[]>('/promo-codes') });
  const totals = useMemo(() => {
    const t = new Map<AccountType, number>();
    for (const r of rewards.data ?? []) t.set(r.account_type, (t.get(r.account_type) ?? 0) + Number(r.amount));
    return [...t.entries()];
  }, [rewards.data]);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="regular" />
      <Page gap={14}>
        <Txt style={type.screenTitle}>Tasks & Rewards</Txt>
        {totals.length ? (
          <View style={styles.card}>
            <Txt style={styles.muted}>Earned so far</Txt>
            {totals.map(([acc, sum]) => <Txt key={acc} style={[type.balance, { fontSize: 28 }]}>{money(sum, acc)}</Txt>)}
          </View>
        ) : null}

        <Txt style={styles.h}>Tasks</Txt>
        {tasks.isLoading ? <Spinner /> : openTasks.length ? openTasks.map((t) => {
          const accepted = t.status === 'accepted';
          const left = t.expires_at ? new Date(t.expires_at).getTime() - Date.now() : 0;
          return (
            <View key={t.id} style={[styles.card, { gap: 10 }]}>
              <View style={styles.row}>
                <Txt style={{ flex: 1, fontSize: 15, fontFamily: font.semibold }}>{t.title}</Txt>
                <Txt style={{ fontSize: 14, fontFamily: font.semibold, color: colors.up }}>{`+α${Number(t.reward)}`}</Txt>
              </View>
              {accepted ? (
                <View style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Txt style={styles.muted}>{`${t.progress} of ${t.target} done`}</Txt>
                    <Txt style={styles.muted}>{countdown(left)}</Txt>
                  </View>
                  <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, (t.progress / t.target) * 100)}%` }]} /></View>
                </View>
              ) : <Button variant="secondary" height={40} label="Accept task" loading={accept.isPending} onPress={() => accept.mutate(t.id)} />}
            </View>
          );
        }) : <Txt style={styles.muted}>No tasks are open right now.</Txt>}

        <Txt style={styles.h}>History</Txt>
        {rewards.isLoading ? <Spinner /> : rewards.data?.length ? rewards.data.map((r) => (
          <View key={r.id} style={[styles.card, styles.row]}>
            <View style={[styles.icon, { backgroundColor: tint(0).bg }]}><Gift size={18} color={tint(0).fg} /></View>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontSize: 15, fontFamily: font.semibold }}>{r.type === 'task_reward' ? 'Task reward' : 'Promo bonus'}</Txt>
              <Txt style={styles.muted}>{dayLabel(r.created_at)}</Txt>
            </View>
            <Txt style={{ fontSize: 15, fontFamily: font.semibold, color: colors.up, fontVariant: ['tabular-nums'] }}>{money(r.amount, r.account_type, { sign: true })}</Txt>
          </View>
        )) : (
          <EmptyState icon={<Gift size={26} color={colors.muted} />} title="No rewards yet" text="Accept a task above and finish it to earn your first reward.">
            <Button variant="secondary" height={44} label="Open a trade" onPress={() => router.navigate('/terminal')} />
          </EmptyState>
        )}

        <Txt style={styles.h}>Promo codes</Txt>
        {promos.isLoading ? <Spinner /> : promos.data?.length ? promos.data.map((p) => (
          <View key={p.code} style={[styles.card, styles.row]}>
            <View style={[styles.icon, { backgroundColor: tint(3).bg }]}><TicketPercent size={18} color={tint(3).fg} /></View>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontSize: 15, fontFamily: font.semibold }}>{p.code}</Txt>
              <Txt style={styles.muted}>{p.description}</Txt>
              <Txt style={styles.muted}>{`Adds ${Number(p.bonus_pct)}% to a deposit of ₦${Number(p.min_deposit).toLocaleString()} or more, up to ₦${Number(p.max_bonus).toLocaleString()}`}</Txt>
            </View>
          </View>
        )) : <Txt style={styles.muted}>No promo codes are open right now. They apply to real-money deposits, which open once Oliskey Alpha is licensed.</Txt>}
      </Page>
    </SafeAreaView>
  );
}

const styles = createStyles(() => ({
  h: { fontSize: 17, fontFamily: font.semibold, marginTop: 6 },
  muted: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  card: { padding: 14, gap: 4, backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
}));
