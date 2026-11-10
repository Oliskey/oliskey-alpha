// Open trade detail: live card (green winning / red losing) plus the trade's facts.
// Forex trades can be closed here; Fixed Time trades can Close Early for an amount the server prices every second.
import { useEffect, useState } from 'react';
import { liveUpdate } from '@/lib/liveBatch';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { ChartCandlestick, CircleX, Copy } from 'lucide-react-native';
import { api, type Trade } from '@/lib/api';
import { clock12, countdown, durationLong, money, price, timeWithMs, type AccountType } from '@/lib/format';
import { useAssets, useLivePrices } from '@/hooks/useMarket';
import { colors, font } from '@/theme';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { DottedRow } from '@/ui/kit';
import { Press } from '@/ui/Press';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';
import { MoneySummary } from './MoneySummary';
import { previewPnl, TradeCard } from './TradeCard';

// Elapsed share of the trade's time, start and end clock times, and the time left.
function TimeProgress({ open, expires, now }: { open: string; expires: string; now: number }) {
  const start = new Date(open).getTime();
  const end = new Date(expires).getTime();
  const share = Math.min(1, Math.max(0, (now - start) / (end - start)));
  const clock = (t: number) => clock12(t, true);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt style={{ color: colors.muted, fontSize: 13 }}>Time left</Txt>
        <Txt style={{ fontSize: 13, fontFamily: font.semibold, fontVariant: ['tabular-nums'] }}>{countdown(end - now)}</Txt>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: 'hidden' }}>
        <View style={{ width: `${share * 100}%`, height: '100%', borderRadius: 3, backgroundColor: colors.accent }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt style={{ color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] }}>Start {clock(start)}</Txt>
        <Txt style={{ color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] }}>End {clock(end)}</Txt>
      </View>
    </View>
  );
}

export function ActiveTradeSheet({ trade, accountType = 'DEMO', onClose }: { trade: Trade | null; accountType?: AccountType; onClose: () => void }) {
  const { byId } = useAssets();
  const toast = useToast();
  const prices = useLivePrices(trade ? [trade.asset_id] : []);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => liveUpdate(() => setNow(Date.now()), setNow), 1000); return () => clearInterval(id); }, []);
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const fixed = trade?.mode === 'fixed_time';
  // Server-priced Close Early amount, refreshed every second while the sheet is open.
  const early = useQuery({
    queryKey: ['close-early', trade?.id],
    queryFn: () => api<{ available: boolean; amount?: number; reason?: string }>(`/trades/${trade!.id}/close-early`),
    enabled: !!trade && fixed,
    refetchInterval: 1000,
    retry: false,
  });
  const closeEarly = useMutation({
    mutationFn: (id: string) => api<Trade>(`/trades/${id}/close-early`, { method: 'POST' }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ['trades'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
      toast({ title: 'Trade closed early', message: `${money(t.return_amount ?? 0, accountType)} returned to your balance`, tone: Number(t.pnl) >= 0 ? 'up' : 'down' });
      onClose();
    },
    onError: (e) => toast({ title: 'Could not close early', message: e.message, tone: 'down' }),
  });
  const earlyLabel = early.data?.available ? `Close Early · ${money(early.data.amount ?? 0, accountType)}`
    : early.data?.reason === 'CLOSE_EARLY_TOO_SOON' ? 'Close Early opens in a moment'
    : early.data?.reason === 'CLOSE_EARLY_TOO_LATE' ? 'Too close to the end to close early'
    : 'Close Early';

  const close = useMutation({
    mutationFn: (id: string) => api(`/trades/${id}/close`, { method: 'POST' }),
    onSuccess: onClose,
    onError: (e) => toast({ title: 'Could not close', message: e.message, tone: 'down' }),
  });
  const decimals = byId.get(trade?.asset_id ?? '')?.decimals ?? 5;
  // Opens the Terminal on this trade's market and mode, where the trade is drawn on the live chart.
  const goToTrade = () => {
    if (!trade) return;
    onClose();
    router.navigate({ pathname: '/terminal', params: { asset: trade.asset_id, mode: trade.mode } });
  };

  return (
    <Sheet open={!!trade} onClose={onClose}>
      {trade ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 20, gap: 14 }}>
          <TradeCard trade={trade} accountType={accountType} livePrice={prices[trade.asset_id]} now={now} onPress={goToTrade} />
          <MoneySummary amount={Number(trade.amount)} pnl={previewPnl(trade, prices[trade.asset_id])} accountType={accountType}
            note={trade.mode === 'forex' ? 'If you closed it at this price now.' : undefined} />
          <Button variant="secondary" height={48} label="Go to trade" iconLeft={<ChartCandlestick size={18} color={colors.text} strokeWidth={2.25} />} onPress={goToTrade} />
          {trade.expires_at ? <TimeProgress open={trade.open_time} expires={trade.expires_at} now={now} /> : null}
          <View>
            {trade.duration_sec ? <DottedRow label="Duration" value={durationLong(trade.duration_sec)} /> : null}
            <DottedRow label="Amount" value={money(trade.amount, accountType)} />
            {trade.mode === 'inzone' ? <DottedRow label="Zone" value={`±${Number(trade.zone_pct).toFixed(3)}%`} /> : null}
            {trade.mode === 'forex' ? <DottedRow label="Multiplier" value={`${trade.leverage}x`} /> : null}
            <DottedRow label="Opening quote" value={price(trade.open_quote, decimals)} />
            <DottedRow
              label="Trade ID"
              right={
                <Press haptic={false} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}
                  onPress={async () => { await Clipboard.setStringAsync(trade.id); toast({ title: 'Trade ID copied' }); }}>
                  <Txt style={{ fontSize: 16 }}>{trade.id.slice(0, 8).toUpperCase()}</Txt>
                  <Copy size={16} color={colors.muted} />
                </Press>
              }
            />
            <DottedRow label="Time" value={timeWithMs(trade.open_time)} />
          </View>
          {trade.mode === 'forex' ? (
            <Button variant="secondary" height={52} label="Close trade" loading={close.isPending} onPress={() => close.mutate(trade.id)} />
          ) : fixed ? (
            <Button
              variant="secondary" height={52} label={earlyLabel} textColor={colors.down}
              iconLeft={<CircleX size={20} color={early.data?.available ? colors.down : colors.muted} />}
              disabled={!early.data?.available} loading={closeEarly.isPending} onPress={() => setConfirm(true)}
            />
          ) : null}
          {trade.mode !== 'forex' ? (
            <Txt style={{ color: colors.muted, fontSize: 13 }}>
              The live result is a preview at the current price. The trade settles at expiry on the server's closing quote.
              {fixed ? ' Close Early pays the win amount times the current chance of winning, minus a 10% fee (never more than 90% of the win).' : ''}
            </Txt>
          ) : null}
        </View>
      ) : null}
      <Dialog
        open={confirm}
        title="Are you sure?"
        body={(() => {
          const put = Number(trade?.amount ?? 0);
          const get = early.data?.amount ?? 0;
          const diff = get - put;
          return `You put in ${money(put, accountType)}. You get back about ${money(get, accountType)} `
            + `(${diff >= 0 ? 'profit' : 'loss'} ${money(diff, accountType, { sign: true })}). The final amount is priced by the server when you confirm.`;
        })()}
        onClose={() => setConfirm(false)}
        actions={[
          { label: 'Cancel', onPress: () => setConfirm(false), color: colors.muted },
          { label: 'Close trade', onPress: () => { setConfirm(false); if (trade) closeEarly.mutate(trade.id); } },
        ]}
      />
    </Sheet>
  );
}
