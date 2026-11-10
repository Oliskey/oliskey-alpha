// Profile hub (tap the avatar): who you are, your status, your real trading numbers, and where to go next.
// The numbers come from the server for the active account; they stay "—" until there is a finished trade.
import { useEffect, useState } from 'react';
import { askToInstall, installSteps, isInstalled } from '@/lib/install';
import { pushState, turnOffPush, turnOnPush, type PushState } from '@/lib/push';
import { View, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Bell, BellOff, ChevronRight, Copy, Download, Gift, Settings as SettingsIcon, CircleHelp, Trophy, Sparkles, UserPlus, X } from 'lucide-react-native';
import { Toggle } from '@/ui/kit';
import { useAccount } from '@/context/AccountContext';
import { AiIcon } from '@/ui/AiIcon';
import { useInDock } from '@/hooks/useLayout';
import { api, type Task } from '@/lib/api';
import { money } from '@/lib/format';
import { card, colors, createStyles, font, tint, type } from '@/theme';
import { Avatar } from '@/ui/Avatar';
import { IconButton } from '@/ui/IconButton';
import { Row, Section } from '@/ui/List';
import { Page } from '@/ui/Page';
import { Press } from '@/ui/Press';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';

type Stats = { total: number; wins: number; decided: number; best: string | null; profit: string };
const TIER = { starter: 'Starter', smart: 'Smart', alpha: 'Alpha' } as const;
const TIER_PROGRESS = { starter: 0.04, smart: 0.5, alpha: 1 } as const;

const PUSH_TEXT: Record<PushState, string> = {
  unsupported: '',
  install: 'Add the app to your home screen first',
  blocked: 'Allow alerts in your browser settings',
  off: 'Off. Get an alert for new signals and your signal trades',
  on: 'On for this device. Tap to turn off',
};

export default function Profile() {
  const { me, activeAccount } = useAccount();
  const toast = useToast();
  const [push, setPush] = useState<PushState>('unsupported');
  useEffect(() => { void pushState().then(setPush).catch(() => {}); }, []);
  const togglePush = () => {
    if (push === 'install') return toast({ title: 'Add it to your home screen first', message: installSteps() });
    if (push === 'blocked') return toast({ title: 'Alerts are blocked', message: 'Allow notifications for this site in your browser settings, then come back.' });
    void (push === 'on' ? turnOffPush() : turnOnPush()).then(setPush)
      .catch((e: Error) => toast({ title: 'Could not change alerts', message: e.message, tone: 'down' }));
  };
  const inDock = useInDock();
  const pathname = usePathname();
  const p = me?.profile;
  const accType = activeAccount?.type ?? 'DEMO';
  const stats = useQuery({
    queryKey: ['stats', activeAccount?.id, pathname === '/profile'], enabled: !!activeAccount,
    queryFn: () => api<Stats>(`/stats?accountId=${activeAccount!.id}`),
  });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/tasks') });
  const openTasks = (tasks.data ?? []).filter((t) => t.status === 'available' || t.status === 'accepted').length;
  const s = stats.data;
  const shortId = p?.id ? p.id.replace(/-/g, '').slice(0, 10).toUpperCase() : null;
  const profit = s && s.total ? Number(s.profit) : null;
  const tier = p?.tier ?? 'starter';

  const numbers = [
    { label: 'Best trade', value: s?.best ? money(s.best, accType, { sign: true }) : '—', color: s?.best ? colors.up : colors.text },
    { label: 'Profit', value: profit == null ? '—' : money(profit, accType, { sign: true }), color: profit == null ? colors.text : profit > 0 ? colors.up : profit < 0 ? colors.down : colors.text },
    { label: 'Total trades', value: s?.total ? String(s.total) : '—', color: colors.text },
    { label: 'Success rate', value: s?.decided ? `${Math.round((s.wins / s.decided) * 100)}%` : '—', color: colors.text },
  ];

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Page width="narrow" gap={18} top={12}>
        <View style={[styles.top, inDock && { paddingRight: 48 }]}>
          <IconButton label="Notifications" size={40} onPress={() => router.navigate('/notifications')}>
            <Bell size={20} color={colors.text} strokeWidth={2.25} />
            {me?.unreadNotifications ? <View style={styles.bellBadge}><Txt style={{ fontSize: 10, fontFamily: font.bold, color: colors.dark }}>{me.unreadNotifications}</Txt></View> : null}
          </IconButton>
          {inDock ? null : (
            <IconButton label="Close profile" size={40} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
              <X size={20} color={colors.text} strokeWidth={2.25} />
            </IconButton>
          )}
        </View>

        <View style={{ alignItems: 'center', gap: 8 }}>
          <Avatar size={96} />
          <Txt style={[type.sectionTitle, { textAlign: 'center' }]}>{p?.full_name || 'Trader'}</Txt>
          {shortId ? (
            <Press haptic={false} style={styles.idRow} accessibilityLabel="Copy your ID"
              onPress={() => { void Clipboard.setStringAsync(shortId).then(() => toast({ title: 'ID copied', message: shortId })); }}>
              <Txt style={{ fontSize: 13, fontFamily: font.semibold, color: colors.muted, fontVariant: ['tabular-nums'] }}>ID {shortId}</Txt>
              <Copy size={14} color={colors.muted} />
            </Press>
          ) : null}
        </View>

        <Press haptic={false} style={[card, styles.status]} onPress={() => router.navigate('/rewards')} accessibilityLabel={`${TIER[tier]} status`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={[styles.statusIcon, { backgroundColor: tint(2).bg }]}><Sparkles size={16} color={tint(2).fg} /></View>
            <Txt style={{ flex: 1, fontSize: 16, fontFamily: font.semibold }}>{TIER[tier]} status</Txt>
            <ChevronRight size={18} color={colors.faint} />
          </View>
          <View style={styles.track}><View style={[styles.fill, { width: `${TIER_PROGRESS[tier] * 100}%` }]} /></View>
        </Press>

        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
            <Txt style={{ fontSize: 13, fontFamily: font.semibold, color: colors.muted }}>Rankings</Txt>
            <Press haptic={false} hitSlop={8} onPress={() => router.navigate('/history')} accessibilityLabel="Show all trades" style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Txt style={{ fontSize: 13, color: colors.accent }}>Show all</Txt>
              <ChevronRight size={14} color={colors.accent} />
            </Press>
          </View>
          <View style={styles.grid}>
            {numbers.map((n) => (
              <View key={n.label} style={[card, styles.stat]}>
                <Txt style={{ fontSize: 13, color: colors.muted }}>{n.label}</Txt>
                <Txt style={{ fontSize: 18, fontFamily: font.semibold, color: n.color, fontVariant: ['tabular-nums'] }} numberOfLines={1}>{n.value}</Txt>
              </View>
            ))}
          </View>
        </View>

        <Section title="Earn more">
          <Row icon={Gift} title="Tasks & Rewards" onPress={() => router.navigate('/rewards')}
            right={openTasks ? <View style={styles.count}><Txt style={{ fontSize: 11, fontFamily: font.bold, color: colors.dark }}>{openTasks}</Txt></View> : undefined} />
          <Row icon={Trophy} title="Funded" onPress={() => router.navigate('/funded')} />
          <Row icon={UserPlus} title="Invite friends" onPress={() => router.navigate('/invite')} last />
        </Section>

        <Section title="General">
          <Row icon={SettingsIcon} title="Settings" onPress={() => router.navigate('/settings')} />
          {Platform.OS === 'web' && !isInstalled() ? (
            <Row icon={Download} title="Download the app"
              onPress={() => { void askToInstall().then((shown) => { if (!shown) toast({ title: 'Download the app', message: installSteps() }); }); }} />
          ) : null}
          {Platform.OS === 'web' && push !== 'unsupported' ? (
            <Row icon={push === 'on' ? Bell : BellOff} title="Alerts" subtitle={push === 'install' || push === 'blocked' ? PUSH_TEXT[push] : undefined}
              right={<Toggle accessibilityLabel="Alerts for new signals" value={push === 'on'} onValueChange={togglePush} />} />
          ) : null}
          <Row icon={AiIcon} title="AI trading" onPress={() => router.push({ pathname: '/scanner', params: { tab: 'ai' } })} />
          <Row icon={CircleHelp} title="Help" onPress={() => router.navigate('/help')} last />
        </Section>
      </Page>
    </SafeAreaView>
  );
}

const styles = createStyles(() => ({
  top: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  bellBadge: { position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 8 },
  status: { padding: 14, gap: 10 },
  statusIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexBasis: '48%', flexGrow: 1, padding: 14, gap: 6 },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
}));
