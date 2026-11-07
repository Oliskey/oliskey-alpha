// A trade in plain money terms: amount put in, profit or loss, and the total the user gets back.
// Open trades show it live ("if it ended now"); finished trades show the final result.
import { View } from 'react-native';
import { money, type AccountType } from '@/lib/format';
import { colors, font } from '@/theme';
import { Txt } from '@/ui/Txt';
import { pnlColor } from './TradeCard';

export function MoneySummary({ amount, pnl, accountType, final = false, note }: {
  amount: number; pnl: number | null; accountType: AccountType; final?: boolean; note?: string;
}) {
  const total = pnl == null ? null : Math.max(0, amount + pnl);
  const losing = pnl != null && pnl < 0;
  const state = pnl == null ? 'Waiting for price'
    : final ? (pnl > 0 ? 'You won' : losing ? 'You lost' : 'Your amount was returned')
    : pnl > 0 ? 'Winning now' : losing ? 'Losing now' : 'Even now';
  const color = pnl == null ? colors.muted : pnlColor(pnl);
  const cell = (label: string, value: string, c: string = colors.text) => (
    <View style={{ flex: 1, gap: 4 }}>
      <Txt style={{ fontSize: 12, color: colors.muted }}>{label}</Txt>
      <Txt style={{ fontSize: 17, fontFamily: font.semibold, color: c, fontVariant: ['tabular-nums'] }}>{value}</Txt>
    </View>
  );
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: pnl == null ? colors.border : color }}>
      <Txt style={{ fontSize: 13, fontFamily: font.semibold, color }}>{state}</Txt>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {cell('You put in', money(amount, accountType))}
        {cell(losing ? (final ? 'You lost' : 'You lose') : 'Profit', pnl == null ? '...' : money(pnl, accountType, { sign: true }), color)}
        {cell(final ? 'You got back' : losing ? 'You keep' : 'You get back', total == null ? '...' : money(total, accountType))}
      </View>
      {final ? null : <Txt style={{ fontSize: 12, color: colors.muted }}>{note ?? 'If the trade ended at this price. It is decided at expiry.'}</Txt>}
    </View>
  );
}
