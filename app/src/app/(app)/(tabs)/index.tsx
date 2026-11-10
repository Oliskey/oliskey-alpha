import { useEffect, useState } from 'react';
import { liveUpdate } from '@/lib/liveBatch';
import { RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronDown, Gift, GraduationCap, Trophy, Target, Zap } from 'lucide-react-native';
import { AiIcon } from '@/ui/AiIcon';
import { api, type Task } from '@/lib/api';
import { countdown, money } from '@/lib/format';
import { useAccount } from '@/context/AccountContext';
import { useFavorites } from '@/hooks/useFavorites';
import { AccountsSheet } from '@/components/AccountsSheet';
import { AssetIcon } from '@/components/AssetIcon';
import { AssetsList } from '@/components/AssetsList';
import { DepositSheet } from '@/components/DepositSheet';
import { Mascot } from '@/components/Mascot';
import { GlossIcon } from '@/ui/GlossIcon';
import { COURSES } from '@/content/lessons';
import { card, colors, font, SECTION_GAP, SIDE, type, createStyles } from '@/theme';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { SectionHeader, SideScroll } from '@/ui/kit';
import { Press } from '@/ui/Press';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';
import { pnlColor } from '@/components/TradeCard';
import { useAiTrader } from '@/hooks/useCounts';
import { useSignals } from '@/hooks/useSignals';
import { Page } from '@/ui/Page';

// Market Scanner shortcuts (Market Intelligence Engine, real market data).
const SCANNERS = (signals: number) => [
  { id: 'ideas', name: 'Trade ideas', tag: signals ? `${signals} active` : 'Real data', Icon: AiIcon, bg: '#7C5CFF', fg: '#fff', text: 'When to enter, stop, target and how long to hold' },
  { id: 'markets', name: 'Markets to skip', tag: 'Alerts', Icon: Zap, bg: '#F59E0B', fg: '#000000', text: 'Markets with setups the engine says to skip' },
  { id: 'record', name: 'Track record', tag: 'Honest', Icon: Target, bg: '#EEF2F7', fg: '#000000', text: 'How every idea and skipped setup turned out' },
];

export default function Home() {
  const { me, activeAccount, refresh } = useAccount();
  const signals = useSignals();
  const ai = useAiTrader();
  const { favorites, toggle } = useFavorites();
  const qc = useQueryClient();
  const toast = useToast();
  const [sheet, setSheet] = useState<null | 'accounts' | 'deposit'>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => liveUpdate(() => setNow(Date.now()), setNow), 1000); return () => clearInterval(id); }, []);

  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/tasks') });
  const accept = useMutation({
    mutationFn: (id: string) => api(`/tasks/${id}/accept`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); toast({ title: 'Task accepted', message: 'Trades you open from now on count towards it.' }); },
    onError: (e) => toast({ title: 'Could not accept', message: e.message, tone: 'down' }),
  });
  const openTasks = (tasks.data ?? []).filter((t) => t.status !== 'completed');
  const accType = activeAccount?.type ?? 'DEMO';

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <Page
        width="wide"
        gap={SECTION_GAP}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => { refresh(); void tasks.refetch(); }} tintColor={colors.muted} />}
      >
        {/* header */}
        <View style={styles.header}>
          <Press onPress={() => router.push('/profile')} accessibilityLabel="Profile" hitSlop={4}><Avatar /></Press>
          <Press style={{ alignItems: 'center' }} onPress={() => setSheet('accounts')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Txt style={{ fontSize: 15, fontFamily: font.medium, color: accType === 'DEMO' ? colors.demo : colors.text }}>
                {accType === 'DEMO' ? 'Demo account' : `${accType} account`}
              </Txt>
              <ChevronDown size={16} color={accType === 'DEMO' ? colors.demo : colors.text} />
            </View>
            <Txt style={type.balance}>{activeAccount ? money(activeAccount.balance, accType) : '...'}</Txt>
          </Press>
          <IconButton label="Notifications" onPress={() => router.push('/notifications')}>
            <Bell size={20} color={colors.text} strokeWidth={2.25} />
            {me?.unreadNotifications ? (
              <View style={styles.badge}><Txt style={styles.badgeText}>{me.unreadNotifications}</Txt></View>
            ) : null}
          </IconButton>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button style={{ flex: 1 }} height={42} variant="secondary" label="Withdraw" onPress={() => router.push('/withdraw')} />
          <Button style={{ flex: 1 }} height={42} label="Deposit" onPress={() => setSheet('deposit')} />
        </View>

        {/* story circles */}
        <SideScroll contentContainerStyle={{ gap: 12 }}>
          {[
            { label: 'Lessons', icon: <GlossIcon icon={GraduationCap} color="violet" size={58} />, go: () => router.push('/skill-hub') },
            { label: 'Bonus', icon: <GlossIcon icon={Gift} color="pink" size={58} />, go: () => router.push('/rewards') },
            { label: 'Funded', icon: <GlossIcon icon={Trophy} color="amber" size={58} />, go: () => router.navigate('/funded') },
          ].map((s) => (
            <Press key={s.label} onPress={s.go} style={{ width: 80, alignItems: 'center', gap: 8 }}>
              {s.icon}
              <Txt style={{ fontSize: 12, textAlign: 'center', color: colors.muted }} numberOfLines={3}>{s.label}</Txt>
            </Press>
          ))}
        </SideScroll>

        {/* promo banner (own copy; never shows invented winnings) */}
        <Press onPress={() => router.push('/skill-hub')} style={styles.banner}>
          <View style={{ flex: 1, gap: 6 }}>
            <Txt style={{ fontSize: 19, fontFamily: font.semibold, letterSpacing: -0.3 }}>Learn before you trade</Txt>
            <Txt style={{ fontSize: 14, color: colors.accent, fontFamily: font.medium, marginTop: 2 }}>Start a 5-minute lesson</Txt>
          </View>
          <Mascot size={92} pose="book" />
        </Press>

        {/* tasks */}
        <View style={{ gap: 12 }}>
          <SectionHeader title="Tasks & Rewards" action={`${openTasks.length} Available`} onAction={() => router.push('/rewards')} />
          <SideScroll snapToInterval={228} decelerationRate="fast" contentContainerStyle={{ gap: 8 }}>
            {openTasks.map((t) => {
              const accepted = t.status === 'accepted';
              const left = t.expires_at ? new Date(t.expires_at).getTime() - now : t.time_limit_sec * 1000;
              return (
                <View key={t.id} style={styles.task}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <View style={{ flex: 1, gap: 6 }}>
                      {accepted && left < 3600_000 ? <View style={styles.pill}><Txt style={styles.pillText}>Ends soon</Txt></View> : null}
                      <Txt style={{ fontSize: 15 }} numberOfLines={2}>{t.title}</Txt>
                    </View>
                    {t.asset_id ? <AssetIcon id={t.asset_id} size={40} /> : <View style={styles.reward}><Txt style={{ fontSize: 11, fontFamily: font.bold, color: colors.dark }}>+α{Number(t.reward)}</Txt></View>}
                  </View>
                  {accepted ? (
                    <View style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Txt style={{ color: colors.up, fontSize: 13 }}>{t.progress}/{t.target}</Txt>
                        <Txt style={{ color: colors.muted, fontSize: 13 }}>{countdown(left)}</Txt>
                      </View>
                      <View style={styles.progress}><View style={[styles.progressFill, { width: `${(t.progress / t.target) * 100}%` }]} /></View>
                    </View>
                  ) : (
                    <Press onPress={() => accept.mutate(t.id)} style={[styles.acceptRow, { minHeight: 44, justifyContent: 'center' }]}>
                      <Txt style={{ fontSize: 13, fontFamily: font.medium }}>{t.status === 'expired' ? 'Try again' : 'Accept Task'} · +α{Number(t.reward)}</Txt>
                    </Press>
                  )}
                </View>
              );
            })}
          </SideScroll>
        </View>

        {/* the demo auto-trader, so nobody has to go looking for it */}
        <Press style={styles.aiCard} onPress={() => router.push({ pathname: '/scanner', params: { tab: 'ai' } })} accessibilityLabel="See the AI trader">
          <View style={[styles.scanIcon, { backgroundColor: '#22C55E' }]}><AiIcon size={20} color="#000000" /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt style={{ fontSize: 15, fontFamily: font.bold }}>AI trader{ai.data ? ` · ${ai.data.open} open now` : ''}</Txt>
            <Txt style={{ fontSize: 13, color: colors.muted }} numberOfLines={1}>
              {ai.data?.picks ? `${ai.data.picks.won} won · ${ai.data.picks.lost} lost` : 'Watching the markets'}
            </Txt>
          </View>
          {ai.data?.picks ? <Txt style={{ fontSize: 15, fontFamily: font.bold, fontVariant: ['tabular-nums'], color: pnlColor(ai.data.picks.pnl) }}>{ai.data.picks.pnl > 0 ? '+' : ai.data.picks.pnl < 0 ? '-' : ''}α{Math.abs(ai.data.picks.pnl).toFixed(0)}</Txt> : null}
        </Press>

        {/* signal scanners */}
        <View style={{ gap: 12 }}>
          <SectionHeader title="Market Scanner" action="Open" onAction={() => router.push('/scanner')} />
          <SideScroll contentContainerStyle={{ gap: 8 }}>
            {SCANNERS(signals.active.length).map((s) => (
              <Press key={s.id} style={styles.scanner} onPress={() => router.push({ pathname: '/scanner', params: { tab: s.id } })}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={[styles.scanIcon, { backgroundColor: s.bg }]}><s.Icon size={20} color={s.fg} /></View>
                  <View style={styles.tag}><Txt style={{ fontSize: 12 }}>{s.tag}</Txt></View>
                </View>
                <Txt style={{ fontSize: 15, fontFamily: font.bold }}>{s.name}</Txt>
              </Press>
            ))}
          </SideScroll>
        </View>

        {/* skill hub */}
        <View style={{ gap: 12 }}>
          <SectionHeader title="Skill Hub" action="All" onAction={() => router.push('/skill-hub')} />
          <SideScroll contentContainerStyle={{ gap: 8 }}>
            {COURSES.filter((c) => !c.locked).map((c) => (
              <Press key={c.id} style={styles.course} onPress={() => router.push({ pathname: '/course/[id]', params: { id: c.id } })}>
                <View style={{ flex: 1, justifyContent: 'space-between' }}>
                  <Txt style={{ fontSize: 18, fontFamily: font.bold }} numberOfLines={2}>{c.title}</Txt>
                  <Txt style={{ fontSize: 11, color: colors.muted }}>{c.tag}</Txt>
                </View>
                <Mascot size={90} pose="book" />
              </Press>
            ))}
          </SideScroll>
        </View>

        <AssetsList favorites={favorites} onToggleFavorite={toggle} />
      </Page>

      <AccountsSheet open={sheet === 'accounts'} onClose={() => setSheet(null)} />
      <DepositSheet open={sheet === 'deposit'} onClose={() => setSheet(null)} />
    </SafeAreaView>
  );
}

const styles = createStyles(() => ({
  page: { paddingHorizontal: SIDE, paddingBottom: 30, gap: SECTION_GAP },
  header: { height: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { position: 'absolute', top: -5, right: -6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.up, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#fff', fontSize: 10, fontFamily: font.bold },
  banner: { ...card, minHeight: 112, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 8, overflow: 'hidden' },
  task: { ...card, width: 220, minHeight: 118, padding: 14, justifyContent: 'space-between', gap: 10 },
  pill: { alignSelf: 'flex-start', backgroundColor: colors.up, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { color: colors.dark, fontSize: 12, fontFamily: font.bold },
  reward: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  progress: { height: 3, borderRadius: 2, backgroundColor: colors.surface2 },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: colors.up },
  acceptRow: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, alignItems: 'center' },
  aiCard: { ...card, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  scanner: { ...card, width: 176, minHeight: 104, padding: 14, gap: 6 },
  scanIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tag: { backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 8, height: 22, justifyContent: 'center' },
  course: { ...card, width: 264, height: 124, padding: 16, flexDirection: 'row', overflow: 'hidden' },
}));
