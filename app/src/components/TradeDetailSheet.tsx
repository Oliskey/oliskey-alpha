// Trade detail: header like the history card, mini chart, "Analyze with AI" (typing insight), detail rows.
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { CandlestickChart, Copy } from 'lucide-react-native';
import { AiIcon } from '@/ui/AiIcon';
import { api, type Trade, type TradeDetail } from '@/lib/api';
import { durationLong, price, timeWithMs, type AccountType } from '@/lib/format';
import { useAssets } from '@/hooks/useMarket';
import { colors, font, radius, createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { DottedRow, Skeleton } from '@/ui/kit';
import { Press } from '@/ui/Press';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';
import { MiniTradeChart } from './MiniTradeChart';
import { MoneySummary } from './MoneySummary';
import { TradeCard } from './TradeCard';

function Typing({ text }: { text: string }) {
  const words = text.split(' ');
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const id = setInterval(() => setN((v) => (v >= words.length ? v : v + 1)), 45);
    return () => clearInterval(id);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Txt style={{ fontSize: 15, lineHeight: 21 }}>{words.slice(0, n).join(' ')}</Txt>;
}

export function TradeDetailSheet({ trade, accountType = 'DEMO', onClose }: { trade: Trade | null; accountType?: AccountType; onClose: () => void }) {
  const { byId } = useAssets();
  const toast = useToast();
  const detail = useQuery({
    queryKey: ['trade', trade?.id],
    queryFn: () => api<TradeDetail>(`/trades/${trade!.id}`),
    enabled: !!trade && trade.status === 'closed',
  });
  const analyze = useMutation({
    mutationFn: () => api<{ source: 'ai' | 'rules'; points: string[] }>(`/trades/${trade!.id}/analyze`, { method: 'POST' }),
  });
  useEffect(() => { analyze.reset(); }, [trade?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = detail.data;
  const decimals = byId.get(trade?.asset_id ?? '')?.decimals ?? 5;
  const pnl = Number(t?.pnl ?? 0);
  const seconds = t?.close_time ? Math.round((new Date(t.close_time).getTime() - new Date(t.open_time).getTime()) / 1000) : 0;
  const closedText = t?.closed_early ? 'early, by you' : { win: 'with a profit', loss: 'with a loss', refund: 'refunded' }[t?.result ?? 'refund'];

  return (
    <Sheet half open={!!trade} onClose={onClose}>
      {trade ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 20, gap: 12 }}>
          <TradeCard trade={trade} accountType={accountType} />

          {t ? <MiniTradeChart trade={t} /> : <Skeleton width="100%" height={150} />}
          {t ? <MoneySummary amount={Number(t.amount)} pnl={pnl} accountType={accountType} final /> : null}
          {t && (t.auto || t.idea_id != null) ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} testID="ai-trade-note">
              <AiIcon size={16} color={colors.accent} />
              <Txt style={{ fontSize: 14, color: colors.muted }}>AI trade, from your balance. Its result changed your money.</Txt>
            </View>
          ) : null}

          {analyze.data ? (
            <View style={styles.insight}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <AiIcon size={18} color={colors.accent} />
                <Txt style={{ fontSize: 15, fontFamily: font.bold }}>Trade Insight</Txt>
              </View>
              <Typing text={analyze.data.points.join('\n\n')} />
              <Txt style={{ color: colors.muted, fontSize: 12 }}>Educational only, not financial advice.</Txt>
            </View>
          ) : analyze.isPending ? (
            <View style={[styles.insight, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
              <AiIcon size={18} color={colors.accent} />
              <Txt style={{ color: colors.muted }}>Analyzing trend activity...</Txt>
            </View>
          ) : (
            <Button
              variant="secondary" height={52} label="Analyze with AI" textColor={colors.accent}
              iconLeft={<AiIcon size={20} color={colors.accent} />}
              onPress={() => analyze.mutate(undefined, { onError: (e) => toast({ title: 'Analysis failed', message: e.message, tone: 'down' }) })}
            />
          )}
          <Button
            variant="secondary" height={52} label="Show on Chart"
            iconLeft={<CandlestickChart size={20} color={colors.text} />}
            onPress={() => {
              // Smallest candle timeframe whose 110-candle window still reaches back to this trade.
              const opened = new Date(trade.open_time).getTime();
              const ageSec = (Date.now() - opened) / 1000;
              const tf = [5, 15, 30, 60, 300].find((s) => s * 110 > ageSec) ?? 300;
              onClose();
              router.navigate({ pathname: '/terminal', params: { asset: trade.asset_id, mode: trade.mode, at: String(opened), tf: String(tf) } });
            }}
          />

          <View>
            {t ? (
              <>
                <DottedRow
                  label="Trade ID"
                  right={
                    <Press haptic={false} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}
                      onPress={async () => { await Clipboard.setStringAsync(t.id); toast({ title: 'Trade ID copied' }); }}>
                      <Txt style={{ fontSize: 16 }}>{t.id.slice(0, 8).toUpperCase()}</Txt>
                      <Copy size={16} color={colors.muted} />
                    </Press>
                  }
                />
                <DottedRow label="Closed" value={closedText} />
                <DottedRow label="Duration" value={durationLong(seconds)} />
                {t.mode === 'inzone' ? <DottedRow label="Zone" value={`±${Number(t.zone_pct).toFixed(3)}%`} /> : null}
                {t.mode === 'forex' ? <DottedRow label="Multiplier" value={`${t.leverage}x`} /> : null}
                <DottedRow label="Trade opened" value={timeWithMs(t.open_time)} />
                <DottedRow label="Trade closed" value={t.close_time ? timeWithMs(t.close_time) : '-'} />
                <DottedRow label="Opening quote" value={price(t.open_quote, decimals)} />
                <DottedRow label="Closing quote" value={t.close_quote ? price(t.close_quote, decimals) : '-'} />
              </>
            ) : (
              ['Amount', 'PnL', 'Trade ID', 'Closed', 'Duration', 'Trade opened', 'Trade closed'].map((l) => (
                <DottedRow key={l} label={l} right={<Skeleton width={90} height={14} />} />
              ))
            )}
          </View>

          <Txt style={{ fontSize: 16, marginTop: 4 }}>
            You can see every tick of this trade in the{' '}
            <Txt style={{ color: colors.accent, fontSize: 16 }} onPress={() => { onClose(); router.push({ pathname: '/quotes/[id]', params: { id: trade.id } }); }}>
              Quotes History
            </Txt>
          </Txt>
        </ScrollView>
      ) : null}
    </Sheet>
  );
}

const styles = createStyles(() => ({
  insight: { backgroundColor: colors.surface2, borderRadius: radius.card, padding: 14, gap: 10 },
}));
