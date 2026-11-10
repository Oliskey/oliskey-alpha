// Notifications: real events only (trades closed, orders, deposits and withdrawals, rewards, account news), newest
// first and grouped by day. Tapping one goes to the page it is about. Opening this page marks everything as read;
// what was new stays marked until you leave, so you can see what changed.
import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { router, usePathname, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, BellOff, ChevronRight, GraduationCap, Gift, Info, Receipt, type LucideIcon } from 'lucide-react-native';
import { Segmented } from '@/components/UnderlineTabs';
import { api, type Notification } from '@/lib/api';
import { clock12, dayLabel } from '@/lib/format';
import { colors, font, radius, type, createStyles, tint } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { EmptyState, Spinner } from '@/ui/kit';
import { Page } from '@/ui/Page';
import { Press } from '@/ui/Press';
import { Txt } from '@/ui/Txt';

const ICONS: Record<Notification['category'], LucideIcon> = { activities: ArrowUpDown, transactions: Receipt, rewards: Gift, education: GraduationCap, platform: Info };
const FILTERS = [
  { key: 'all', label: 'All' }, { key: 'trades', label: 'Trades' }, { key: 'money', label: 'Money' },
  { key: 'rewards', label: 'Rewards' }, { key: 'news', label: 'News' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];
const inFilter = (n: Notification, f: Filter) => f === 'all'
  || (f === 'trades' && n.category === 'activities') || (f === 'money' && n.category === 'transactions')
  || (f === 'rewards' && n.category === 'rewards') || (f === 'news' && (n.category === 'platform' || n.category === 'education'));
const EMPTY: Record<Filter, string> = {
  all: 'Trades, deposits, rewards and account news will appear here.',
  trades: 'Closed trades and orders will appear here.',
  money: 'Deposits and withdrawals will appear here.',
  rewards: 'Finished tasks and bonuses will appear here.',
  news: 'Lessons and account news will appear here.',
};
const clock = (iso: string) => clock12(iso);
const day = (iso: string) => { const d = dayLabel(iso); return d.charAt(0) + d.slice(1).toLowerCase(); };

export default function Notifications() {
  const qc = useQueryClient();
  const pathname = usePathname();
  const here = pathname === '/notifications';   // on desktop this page stays mounted in the panel: only read while looking
  const [filter, setFilter] = useState<Filter>('all');
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<Notification[]>('/notifications') });
  useEffect(() => { if (here) void q.refetch(); }, [here]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (here && q.data?.some((n) => !n.read_at)) {
      api('/notifications/read', { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['me'] })).catch(() => {});
    }
  }, [q.data, here, qc]);

  const groups = useMemo(() => {
    const out: { day: string; items: Notification[] }[] = [];
    for (const n of (q.data ?? []).filter((x) => inFilter(x, filter))) {
      const d = day(n.created_at);
      if (out[out.length - 1]?.day === d) out[out.length - 1].items.push(n); else out.push({ day: d, items: [n] });
    }
    return out;
  }, [q.data, filter]);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="regular" />
      <Page gap={14} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); }} tintColor={colors.muted} />}>
        <Txt style={type.screenTitle}>Notifications</Txt>
        <Segmented tabs={FILTERS} value={filter} onChange={setFilter} />
        {q.isLoading ? <Spinner /> : !groups.length ? (
          <EmptyState icon={<BellOff size={26} color={colors.muted} />} title="You're all caught up" text={EMPTY[filter]} />
        ) : groups.map((g) => (
          <View key={g.day} style={{ gap: 8 }}>
            <Txt style={styles.day}>{g.day}</Txt>
            {g.items.map((n) => {
              const Icon = ICONS[n.category] ?? Info;
              return (
                <Press key={n.id} haptic={false} disabled={!n.link} onPress={() => n.link && router.navigate(n.link as Href)} style={styles.row} accessibilityLabel={n.title}>
                  <View style={[styles.icon, { backgroundColor: tint(n.category).bg }]}><Icon size={18} color={tint(n.category).fg} /></View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {!n.read_at ? <View style={styles.dot} accessibilityLabel="New" /> : null}
                      <Txt style={{ flex: 1, fontSize: 15, fontFamily: font.semibold }}>{n.title}</Txt>
                      <Txt style={{ fontSize: 12, color: colors.muted }}>{clock(n.created_at)}</Txt>
                    </View>
                    {n.body ? <Txt style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }} numberOfLines={1}>{n.body}</Txt> : null}
                  </View>
                  {n.link ? <ChevronRight size={16} color={colors.faint} style={{ alignSelf: 'center' }} /> : null}
                </Press>
              );
            })}
          </View>
        ))}
      </Page>
    </SafeAreaView>
  );
}

const styles = createStyles(() => ({
  day: { fontSize: 13, fontFamily: font.semibold, color: colors.muted, marginTop: 4 },
  row: { flexDirection: 'row', gap: 12, padding: 14, backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
}));
