// Trade card: icon, "Asset · 85%" (forex: "· 100x"), amount + direction arrow, then the result.
// Closed trades show the server's PnL; open trades show a live preview (green winning, red losing).
import { View } from 'react-native';
import { ArrowDown, ArrowUp, User } from 'lucide-react-native';
import { AiIcon } from '@/ui/AiIcon';
import type { Trade } from '@/lib/api';
import { countdown, durationLong, money, type AccountType } from '@/lib/format';
import { useAssets } from '@/hooks/useMarket';
import { card as cardStyle, colors, font, createStyles } from '@/theme';
import { Press } from '@/ui/Press';
import { Txt } from '@/ui/Txt';
import { AssetIcon } from './AssetIcon';

// What the trade would return if it closed at `price` right now. Display only: it mirrors settle_trade,
// but the server alone settles the trade and moves money.
export function previewPnl(t: Trade, price: number | undefined): number | null {
  if (price == null) return null;
  const o = Number(t.open_quote);
  const amount = Number(t.amount);
  const profit = amount * Number(t.payout_pct ?? 0) / 100;
  const dir = t.direction === 'up' ? 1 : -1;
  if (t.mode === 'fixed_time') return price === o ? 0 : Math.sign(price - o) === dir ? profit : -amount;
  if (t.mode === 'inzone') return (Math.abs(price - o) / o) * 100 <= Number(t.zone_pct) ? profit : -amount;
  return Math.max(-amount, amount * (t.leverage ?? 1) * ((price - o) / o) * dir);
}

export const pnlColor = (v: number) => (v > 0 ? colors.up : v < 0 ? colors.down : colors.muted);

export function TradeCard({ trade, accountType = 'DEMO', onPress, livePrice, now, ai, showOwner }: {
  trade: Trade; accountType?: AccountType; onPress?: () => void; livePrice?: number; now?: number;
  ai?: boolean;   // the AI trader's own trade, not this person's
  showOwner?: boolean;   // also mark the person's own trades, where they are listed together with the AI's
}) {
  const { byId } = useAssets();
  const name = byId.get(trade.asset_id)?.name ?? trade.asset_id;
  // the AI's mark shows wherever a trade came from the AI: placed by it, or placed by the person from its signal
  const fromAi = ai || !!trade.auto || trade.idea_id != null;
  const tag = trade.mode === 'forex' ? `${trade.leverage}x` : `${Math.round(Number(trade.payout_pct))}%`;
  const open = trade.status === 'open';
  const pnl = open ? previewPnl(trade, livePrice) : Number(trade.pnl ?? 0);
  const seconds = trade.close_time
    ? Math.round((new Date(trade.close_time).getTime() - new Date(trade.open_time).getTime()) / 1000)
    : trade.duration_sec ?? 0;
  const corner = !open ? durationLong(seconds)
    : trade.mode === 'forex' ? 'open' : countdown(new Date(trade.expires_at!).getTime() - (now ?? Date.now()));
  const Arrow = trade.direction === 'up' ? ArrowUp : trade.direction === 'down' ? ArrowDown : null;

  return (
    <Press onPress={onPress} style={styles.card} accessibilityLabel={ai ? `AI trade, ${name}, ${trade.direction === 'up' ? 'up' : 'down'}. Not your trade.` : fromAi ? `AI trade, ${name}, ${trade.direction === 'up' ? 'up' : trade.direction === 'down' ? 'down' : 'InZone'}.` : showOwner ? `Your own trade, ${name}.` : undefined}>
      <View>
        <AssetIcon id={trade.asset_id} size={32} />
        {fromAi ? <View testID="ai-trade" style={styles.aiMark}><AiIcon size={13} color={colors.bg} strokeWidth={3} /></View>
          : showOwner ? <View testID="own-trade" style={[styles.aiMark, { backgroundColor: colors.muted }]}><User size={12} color={colors.bg} strokeWidth={2.5} /></View> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Txt style={styles.meta} numberOfLines={1}>{name}{trade.mode === 'inzone' ? ' · InZone' : ''} · {tag}</Txt>
        <View style={styles.amountRow}>
          <Txt style={styles.amount}>{money(trade.amount, accountType)}</Txt>
          {Arrow ? <Arrow size={16} color={trade.direction === 'up' ? colors.up : colors.down} /> : null}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Txt style={[styles.meta, open && { fontVariant: ['tabular-nums'] }]}>{corner}</Txt>
        <Txt style={[styles.amount, { color: pnl == null ? colors.muted : pnlColor(pnl) }]}>
          {pnl == null ? '...' : money(pnl, accountType, { sign: true })}
        </Txt>
      </View>
    </Press>
  );
}

const styles = createStyles(() => ({
  card: { ...cardStyle, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, padding: 14 },
  meta: { color: colors.muted, fontSize: 13 },
  aiMark: { position: 'absolute', right: -6, bottom: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.surface },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  amount: { fontSize: 17, fontFamily: font.semibold, marginTop: 2, fontVariant: ['tabular-nums'], letterSpacing: -0.2 },
}));
