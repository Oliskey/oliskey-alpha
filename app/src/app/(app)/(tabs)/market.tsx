import { View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAiTrader } from '@/hooks/useCounts';
import { useFavorites } from '@/hooks/useFavorites';
import { AssetsList } from '@/components/AssetsList';
import { radius, type } from '@/theme';
import { SideScroll } from '@/ui/kit';
import { Press } from '@/ui/Press';
import { Txt } from '@/ui/Txt';
import { Page } from '@/ui/Page';
import { ListenCard } from './scanner';

export default function Market() {
  const { favorites, toggle } = useFavorites();
  const ai = useAiTrader();
  const listening = ai.data?.listening;
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <Page top={40}>
        <Txt style={type.screenTitle}>Market</Txt>
        {listening?.length ? (
          <View style={{ gap: 8 }}>
            <Txt style={type.sectionTitle}>AI is listening</Txt>
            <SideScroll contentContainerStyle={{ gap: 8 }}>
              {listening.map((l) => (
                <Press key={l.mode} haptic={false} style={{ width: 280, borderRadius: radius.card }} accessibilityLabel={`AI on ${l.name}: ${l.open ? `${l.open} trading` : 'listening'}. See why.`}
                  onPress={() => router.push({ pathname: '/scanner', params: { tab: 'ai' } })}>
                  <ListenCard l={l} fill />
                </Press>
              ))}
            </SideScroll>
          </View>
        ) : null}
        <AssetsList favorites={favorites} onToggleFavorite={toggle} showTitle={false} />
      </Page>
    </SafeAreaView>
  );
}
