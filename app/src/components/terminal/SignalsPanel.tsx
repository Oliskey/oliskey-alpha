// Signals panel: live signals from the Market Intelligence Engine, plus what it says about the asset on the chart right
// now. Signals are never certain; each shows its measured test range, its live record and where it is wrong (stop).
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronRight, RadioTower } from 'lucide-react-native';
import { api, type IntelIdea, type IntelMarket } from '@/lib/api';
import { useAssets } from '@/hooks/useMarket';
import { useSignals } from '@/hooks/useSignals';
import { colors, font, createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Press } from '@/ui/Press';
import { CountBadge, Spinner } from '@/ui/kit';
import { Txt } from '@/ui/Txt';
import { AssetIcon } from '../AssetIcon';
import { SignalBadge } from './SignalEvidence';
import { SignalTrade } from './SignalTrade';

const STATUS = { trade: 'Signal active', avoid: "Don't enter", wait: 'Wait' } as const;

export function SignalsPanel({ assetId, selectedId, onOpen, onBack, onSeeChart }: {
  assetId: string; selectedId: number | null;
  onOpen: (idea: IntelIdea) => void;   // show this signal's plan on the chart
  onBack: () => void; onSeeChart: () => void;
}) {
  const { markSeen } = useSignals();
  useEffect(() => { markSeen(); });   // opening the panel counts as seeing them, so the icon stops blinking
  const { byId } = useAssets();
  const ideas = useQuery({ queryKey: ['intel', 'ideas'], queryFn: () => api<IntelIdea[]>('/intel/ideas?limit=200'), refetchInterval: 60_000 });
  const scan = useQuery({ queryKey: ['intel', 'scan'], queryFn: () => api<{ scanned_at: string | null; markets: IntelMarket[] }>('/intel/scan'), refetchInterval: 60_000 });
  const active = (ideas.data ?? []).filter((i) => i.kind === 'idea' && i.status === 'open' && new Date(i.enter_until).getTime() > Date.now());
  const here = scan.data?.markets.find((m) => m.asset === assetId);
  const name = (id: string) => byId.get(id)?.name ?? id;

  const picked = selectedId != null ? (ideas.data ?? []).find((i) => i.id === selectedId) : undefined;
  if (picked) {
    return (
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>
        <SignalTrade idea={picked} onBack={onBack} onSeeChart={onSeeChart} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
      {here ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt style={[styles.h, { flex: 1, marginTop: 0 }]}>{name(assetId)} now</Txt>
          <Txt style={{ fontSize: 15, fontFamily: font.semibold, color: here.status === 'trade' ? colors.up : here.status === 'avoid' ? colors.down : colors.muted }}>{STATUS[here.status]}</Txt>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}><Txt style={[styles.h, { marginTop: 0 }]}>Active signals</Txt><CountBadge inline count={active.length} color={colors.upVivid} /></View>
      {ideas.isLoading ? <Spinner /> : active.length ? active.map((i) => {
        const up = i.direction === 1;
        const inApp = byId.has(i.asset_id);
        return (
          <Press key={i.id} haptic={false} style={styles.card} disabled={!inApp} onPress={() => onOpen(i)} accessibilityLabel={`${name(i.asset_id)} ${i.asset_class.startsWith('crypto_iz') ? 'InZone' : up ? 'up' : 'down'} signal. ${i.taken ? 'See your trade' : 'Set up this trade'}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <AssetIcon id={i.asset_id} size={32} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt style={{ fontSize: 15, fontFamily: font.semibold }}>{name(i.asset_id)}</Txt>
                {i.taken ? <Txt style={{ fontSize: 13, fontFamily: font.semibold, color: colors.accent }}>Your trade is running</Txt> : <SignalBadge assetClass={i.asset_class} />}
              </View>
              {i.asset_class.startsWith('crypto_iz') ? <Txt style={{ fontSize: 13, fontFamily: font.semibold, color: colors.accent }}>Stays in</Txt> : (
                <View style={[styles.dir, { backgroundColor: up ? colors.up : colors.down }]}>
                  {up ? <ArrowUp size={16} color={colors.dark} /> : <ArrowDown size={16} color={colors.dark} />}
                </View>
              )}
              {inApp ? <ChevronRight size={18} color={colors.muted} /> : null}
            </View>
          </Press>
        );
      }) : (
        <View style={[styles.card, { alignItems: 'center', gap: 6 }]}>
          <RadioTower size={24} color={colors.muted} />
          <Txt style={{ fontSize: 15, fontFamily: font.semibold }}>No signals right now</Txt>
        </View>
      )}
      <Button label="Open Market Scanner" variant="secondary" height={44} onPress={() => router.push({ pathname: '/scanner', params: { asset: assetId } })} />
    </ScrollView>
  );
}

const styles = createStyles(() => ({
  h: { fontSize: 16, fontFamily: font.semibold, marginTop: 4 },
  hint: { fontSize: 12, color: colors.muted },
  card: { padding: 12, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  dir: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
}));
