// AI Trading home: the customer's own exchange account, traded by Oliskey's strategies through a key that can never withdraw.
// Real-money trading is closed (REAL-MONEY GATE), so this is practice and testnet only and says so in one line.
import { View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, BarChart3, Bell, FileText, Link2, OctagonPause, Play, ShieldCheck, Sparkles } from 'lucide-react-native';
import { api } from '@/lib/api';
import type { Exchange, TradingMe } from '@/lib/aiTrading';
import { card, colors, font, type } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { More, Row, Section } from '@/ui/List';
import { Page } from '@/ui/Page';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';

export default function AiTradingHome() {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useQuery({ queryKey: ['trading', 'me'], queryFn: () => api<TradingMe>('/trading/me') });
  const ex = useQuery({ queryKey: ['trading', 'exchanges'], queryFn: () => api<Exchange[]>('/trading/exchanges') });
  const wait = useQuery({ queryKey: ['trading', 'waitlist'], queryFn: () => api<{ joined: boolean }>('/trading/waitlist') });
  const connected = (ex.data ?? []).flatMap((e) => e.connections).filter((c) => c.status === 'active').length;
  const paused = Boolean(me.data?.tradingPaused);
  const platform = me.data?.platform;
  const stopped = Boolean(platform?.emergency_stop || platform?.platform_paused);

  const setPaused = useMutation({
    mutationFn: (pause: boolean) => api<{ tradingPaused: boolean }>(`/trading/trading/${pause ? 'pause' : 'resume'}`, { method: 'POST' }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['trading'] }); toast({ title: r.tradingPaused ? 'Trading paused' : 'Trading on', message: r.tradingPaused ? 'No new orders are placed for you.' : 'Strategies may place orders again.' }); },
    onError: (e) => toast({ title: 'Not changed', message: (e as Error).message, tone: 'down' }),
  });
  const waitlist = useMutation({
    mutationFn: (join: boolean) => api<{ joined: boolean }>('/trading/waitlist', { method: join ? 'POST' : 'DELETE' }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['trading', 'waitlist'] }); toast({ title: r.joined ? "You're on the list" : 'Removed from the list', message: r.joined ? 'We will tell you when real-money trading opens.' : 'You will not get this alert.' }); },
    onError: (e) => toast({ title: 'Not changed', message: (e as Error).message, tone: 'down' }),
  });

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="narrow" />
      <Page width="narrow" gap={22}>
        <View style={{ gap: 6 }}>
          <Txt style={type.screenTitle}>AI Trading</Txt>
          <Txt style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>Our strategies trade on your own exchange account. Your money stays there.</Txt>
        </View>

        <View style={[card, { padding: 16, gap: 12 }]} accessibilityRole="summary">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: stopped || paused ? colors.demo : colors.up }} />
            <Txt style={{ fontSize: 16, fontFamily: font.semibold, flex: 1 }}>
              {platform?.emergency_stop ? 'Stopped by Oliskey' : platform?.platform_paused ? 'Paused by Oliskey' : paused ? 'Your trading is paused' : 'Practice trading is on'}
            </Txt>
          </View>
          <Txt style={{ color: colors.demo, fontSize: 13, fontFamily: font.medium }}>Practice and testnet only · real-money trading is not open yet</Txt>
          <Button
            label={paused ? 'Resume trading' : 'Pause trading'} variant="secondary" height={46}
            iconLeft={paused ? <Play size={18} color={colors.text} /> : <OctagonPause size={18} color={colors.text} />}
            loading={setPaused.isPending} disabled={!me.data} onPress={() => setPaused.mutate(!paused)}
          />
          <More label="What happens in an emergency">
            <Txt style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>
              Pause stops new orders for you at once. Anything you already hold stays in your exchange account: you can sell it there
              yourself at any time. If something goes wrong for everyone, Oliskey can stop all trading with one switch, and the app
              says so here. Your key can never withdraw money, so nobody can move it out of your account through Oliskey.
            </Txt>
          </More>
        </View>

        <Section title="Set up">
          <Row icon={Link2} title="Exchanges" subtitle={connected ? `${connected} connected` : 'Connect a Binance testnet key'} onPress={() => router.push('/ai/exchanges')} />
          <Row icon={Sparkles} title="Strategies" subtitle="Four ways to trade BTC and ETH" onPress={() => router.push('/ai/strategies')} last />
        </Section>
        <Section title="Results">
          <Row icon={BarChart3} title="Practice results" subtitle="Holdings, orders and history" onPress={() => router.push('/ai/results')} />
          <Row icon={FileText} title="Statement" subtitle="Profit counted and estimated" onPress={() => router.push('/ai/statement')} last />
        </Section>

        <View style={[card, { padding: 16, gap: 12 }]}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Bell size={20} color={colors.accent} />
            <Txt style={{ fontSize: 16, fontFamily: font.semibold, flex: 1 }}>Real-money trading</Txt>
          </View>
          <Txt style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>It opens only after legal approval and safety checks. Want an alert?</Txt>
          <Button label="Read the risks first" variant="secondary" height={44} onPress={() => router.push('/ai/risk')} />
          {wait.data?.joined ? (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <BadgeCheck size={18} color={colors.up} />
                <Txt style={{ color: colors.up, fontFamily: font.semibold, flex: 1 }}>You're on the list.</Txt>
              </View>
              <Button label="Remove me from the list" variant="secondary" height={44} loading={waitlist.isPending} onPress={() => waitlist.mutate(false)} />
            </View>
          ) : (
            <Button label="Notify me when it opens" height={48} loading={waitlist.isPending} disabled={!wait.data} onPress={() => waitlist.mutate(true)} />
          )}
        </View>

        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4 }}>
          <ShieldCheck size={16} color={colors.muted} style={{ marginTop: 2 }} />
          <Txt style={{ color: colors.muted, fontSize: 12, lineHeight: 18, flex: 1 }}>
            Oliskey never holds your money. Trading can lose money; past results do not promise future ones.
          </Txt>
        </View>
      </Page>
    </SafeAreaView>
  );
}
