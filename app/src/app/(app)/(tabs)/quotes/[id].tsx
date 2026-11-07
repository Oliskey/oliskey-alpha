import { FlatList, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api, type TradeDetail } from '@/lib/api';
import { price, timeWithMs } from '@/lib/format';
import { useAssets } from '@/hooks/useMarket';
import { colors, type } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Spinner } from '@/ui/kit';
import { Txt } from '@/ui/Txt';
import { useColumn } from '@/ui/Page';

export default function QuotesHistory() {
  const column = useColumn('regular');
  const { id } = useLocalSearchParams<{ id: string }>();
  const { byId } = useAssets();
  const q = useQuery({ queryKey: ['trade', id], queryFn: () => api<TradeDetail>(`/trades/${id}`) });
  const decimals = byId.get(q.data?.asset_id ?? '')?.decimals ?? 5;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="regular" />
      <Txt style={[type.screenTitle, column]}>Quotes History</Txt>
      {q.isLoading ? <Spinner full /> : (
        <FlatList
          data={q.data?.ticks ?? []}
          keyExtractor={(t) => t.ts}
          contentContainerStyle={[column, { paddingVertical: 16 }]}
          ListEmptyComponent={<Txt style={{ color: colors.muted }}>No ticks were recorded for this trade.</Txt>}
          renderItem={({ item }) => (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', height: 32, alignItems: 'center', borderBottomWidth: 1, borderColor: colors.border }}>
              <Txt style={{ color: colors.muted, fontSize: 14 }}>{timeWithMs(item.ts)}</Txt>
              <Txt style={{ fontSize: 14, fontVariant: ['tabular-nums'] }}>{price(item.price, decimals)}</Txt>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
