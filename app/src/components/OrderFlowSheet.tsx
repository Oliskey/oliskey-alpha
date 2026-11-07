// Details behind the momentum bar. Live crypto: real buyer- vs seller-initiated volume from Binance.
// Simulated markets have no buyers or sellers, so only their up/down price ticks are shown (and said so).
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAssets } from '@/hooks/useMarket';
import { colors, font, radius } from '@/theme';
import { Sheet } from '@/ui/Sheet';
import { Txt } from '@/ui/Txt';

type Flow = {
  asset: string; live: boolean;
  timeframe: string;
  ticks: { label: string; up: number; down: number; unit: string }[];
  orders: { label: string; buyVolume: number; sellVolume: number; buyTrades: number; sellTrades: number }[] | null;
};

const compact = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0));

// One window: green (buy / up) vs red (sell / down) split bar with the numbers under it.
function Split({ label, left, right, leftText, rightText }: { label: string; left: number; right: number; leftText: string; rightText: string }) {
  const total = left + right;
  const share = total ? left / total : 0.5;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt style={{ fontSize: 13, color: colors.muted }}>{label}</Txt>
        <Txt style={{ fontSize: 13, fontFamily: font.semibold, color: total ? (share >= 0.5 ? colors.up : colors.down) : colors.muted }}>
          {total ? `${Math.round(share * 100)}% / ${Math.round((1 - share) * 100)}%` : 'No activity'}
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.surface2 }}>
        {total ? <View style={{ flex: share, backgroundColor: colors.up }} /> : null}
        {total ? <View style={{ flex: 1 - share, backgroundColor: colors.down, marginLeft: share > 0 && share < 1 ? 2 : 0 }} /> : null}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt style={{ fontSize: 12, color: colors.up, fontVariant: ['tabular-nums'] }}>{leftText}</Txt>
        <Txt style={{ fontSize: 12, color: colors.down, fontVariant: ['tabular-nums'] }}>{rightText}</Txt>
      </View>
    </View>
  );
}

export function OrderFlowSheet({ assetId, tf, open, onClose }: { assetId: string; tf: number; open: boolean; onClose: () => void }) {
  const { byId } = useAssets();
  const q = useQuery({ queryKey: ['flow', assetId, tf], queryFn: () => api<Flow>(`/flow/${assetId}?tf=${tf}`), enabled: open, refetchInterval: 2000 });
  const f = q.data;
  const quote = byId.get(assetId)?.source_symbol?.endsWith('USDT') ? 'USDT' : '';
  return (
    <Sheet open={open} onClose={onClose}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 24, gap: 16 }}>
        <View style={{ gap: 4 }}>
          <Txt style={{ fontSize: 18, fontFamily: font.bold }}>{f?.live ? 'Buyers vs sellers' : 'Price moves'} · {byId.get(assetId)?.name ?? assetId} · {f?.timeframe}</Txt>
          <Txt style={{ fontSize: 13, color: colors.muted }}>
            {f?.live
              ? 'Live from Binance: every trade is counted as a buy or a sell by who started it. Updates every 2 seconds.'
              : 'This market uses simulated prices, so there are no real buyers or sellers. Forex has no central exchange either, so nobody publishes real buy/sell volume for it. These are the up and down price moves.'}
          </Txt>
        </View>

        {f?.orders ? (
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: 14, gap: 14 }}>
            <Txt style={{ fontSize: 15, fontFamily: font.semibold }}>Volume bought vs sold</Txt>
            {f.orders.map((o) => (
              <Split key={o.label} label={o.label} left={o.buyVolume} right={o.sellVolume}
                leftText={`Bought ${compact(o.buyVolume)} ${quote} · ${o.buyTrades.toLocaleString()} trades`}
                rightText={`Sold ${compact(o.sellVolume)} ${quote} · ${o.sellTrades.toLocaleString()} trades`} />
            ))}
          </View>
        ) : null}

        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: 14, gap: 14 }}>
          <Txt style={{ fontSize: 15, fontFamily: font.semibold }}>Price moves up vs down</Txt>
          {(f?.ticks ?? []).map((t) => (
            <Split key={t.label} label={`${t.label} · ${t.unit}`} left={t.up} right={t.down}
              leftText={`${t.up.toLocaleString()} up`} rightText={`${t.down.toLocaleString()} down`} />
          ))}
        </View>

        <Txt style={{ fontSize: 12, color: colors.muted }}>
          Past buying and selling does not tell you where the price goes next. Educational, not financial advice.
        </Txt>
      </View>
    </Sheet>
  );
}
