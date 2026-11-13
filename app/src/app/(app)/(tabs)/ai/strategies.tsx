// The four strategies: what each does in one line, a limited preview, and whether a tested version is approved.
// No payment is taken here: subscriptions open together with real-money trading, and never for an unapproved strategy.
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Clock3, Gauge, Lock } from 'lucide-react-native';
import { api } from '@/lib/api';
import type { Strategy } from '@/lib/aiTrading';
import { card, colors, font, type } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { EmptyState, Spinner } from '@/ui/kit';
import { Grid, Page } from '@/ui/Page';
import { useLayout } from '@/hooks/useLayout';
import { Txt } from '@/ui/Txt';

const APPROVAL: Record<string, { text: string; color: 'up' | 'demo' | 'muted' }> = {
  approved_live: { text: 'Approved', color: 'up' },
  approved_paper: { text: 'Approved for practice', color: 'demo' },
  testing: { text: 'Being tested', color: 'muted' },
  draft: { text: 'Not yet approved', color: 'muted' },
};

function StrategyCard({ s, price }: { s: Strategy; price: string }) {
  const a = s.version ? APPROVAL[s.version.status] ?? APPROVAL.draft : APPROVAL.draft;
  return (
    <View style={[card, { padding: 16, gap: 12, flex: 1 }]}>
      <View style={{ gap: 4 }}>
        <Txt style={{ fontSize: 18, fontFamily: font.bold }}>{s.name}</Txt>
        <View style={{ flexDirection: 'row', gap: 14 }}>
          <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
            <Clock3 size={14} color={colors.muted} />
            <Txt style={{ fontSize: 13, color: colors.muted }}>{s.style === 'scalping' ? 'Minutes to hours' : 'Hours to days'}</Txt>
          </View>
          <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
            <Gauge size={14} color={colors.muted} />
            <Txt style={{ fontSize: 13, color: colors.muted }}>{s.profile === 'strict' ? 'Fewer trades' : 'More trades'}</Txt>
          </View>
        </View>
      </View>
      <Txt style={{ fontSize: 15, lineHeight: 21 }}>{s.summary}</Txt>
      <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: colors[a.color] }}>
        <Txt style={{ fontSize: 12, fontFamily: font.semibold, color: colors[a.color] }}>{a.text}{s.version ? ` · v${s.version.version}` : ''}</Txt>
      </View>
      <Txt style={{ fontSize: 13, color: colors.muted }}>
        {s.preview?.trades != null ? `Tested on ${s.preview.trades} trades${s.preview.period ? ` · ${s.preview.period}` : ''}. Full results after you subscribe.` : 'No test results yet.'}
      </Txt>
      <Button label={`$${price}/month · Opens with live trading`} variant="secondary" height={44} disabled iconLeft={<Lock size={16} color={colors.text} />} />
    </View>
  );
}

export default function Strategies() {
  const { isPhone } = useLayout();
  const q = useQuery({ queryKey: ['trading', 'strategies'], queryFn: () => api<{ pricePerStrategyUsd: string; strategies: Strategy[] }>('/trading/strategies') });
  const list = q.data?.strategies ?? [];
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="regular" />
      <Page width="regular" gap={18}>
        <View style={{ gap: 6 }}>
          <Txt style={type.screenTitle}>Strategies</Txt>
          <Txt style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>Each trades BTC and ETH on your account. Buy and sell only, no borrowing.</Txt>
        </View>
        {q.isLoading ? <Spinner /> : q.error ? (
          <EmptyState title="Could not load" text={(q.error as Error).message}><Button label="Try again" variant="secondary" onPress={() => q.refetch()} /></EmptyState>
        ) : isPhone ? (
          <View style={{ gap: 14 }}>{list.map((s) => <StrategyCard key={s.id} s={s} price={q.data!.pricePerStrategyUsd} />)}</View>
        ) : (
          <Grid columns={2} gap={14}>{list.map((s) => <StrategyCard key={s.id} s={s} price={q.data!.pricePerStrategyUsd} />)}</Grid>
        )}
        <Txt style={{ color: colors.muted, fontSize: 12, lineHeight: 18, paddingHorizontal: 4 }}>
          A strategy trades only after its tested version is approved. Approval is not a promise of profit; any strategy can lose.
        </Txt>
      </Page>
    </SafeAreaView>
  );
}
