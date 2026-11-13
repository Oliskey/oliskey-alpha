// Exchanges: which ones work today (Binance on testnet), which are coming, and the customer's own connections.
// Disconnecting wipes the stored key on our side; the customer is then sent to delete the key on the exchange too.
import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleAlert, Clock3, Plus, Trash2 } from 'lucide-react-native';
import { api } from '@/lib/api';
import { type Connection, type Exchange, BINANCE_TESTNET_URL, envLabel, statusWord } from '@/lib/aiTrading';
import { card, colors, font, type } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { EmptyState, Spinner } from '@/ui/kit';
import { Page } from '@/ui/Page';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: color }}>
      <Txt style={{ fontSize: 12, fontFamily: font.semibold, color }}>{text}</Txt>
    </View>
  );
}

export default function Exchanges() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['trading', 'exchanges'], queryFn: () => api<Exchange[]>('/trading/exchanges') });
  const [removing, setRemoving] = useState<{ conn: Connection; ex: Exchange } | null>(null);
  const [removed, setRemoved] = useState<Exchange | null>(null);
  const disconnect = useMutation({
    mutationFn: (id: string) => api(`/trading/exchanges/connections/${id}`, { method: 'DELETE' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['trading'] }); setRemoved(removing?.ex ?? null); setRemoving(null); },
    onError: (e) => toast({ title: 'Not disconnected', message: (e as Error).message, tone: 'down' }),
  });

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="narrow" />
      <Page width="narrow" gap={18}>
        <View style={{ gap: 6 }}>
          <Txt style={type.screenTitle}>Exchanges</Txt>
          <Txt style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>Connect with a key that can trade but never withdraw.</Txt>
        </View>
        {q.isLoading ? <Spinner /> : q.error ? (
          <EmptyState title="Could not load" text={(q.error as Error).message}><Button label="Try again" variant="secondary" onPress={() => q.refetch()} /></EmptyState>
        ) : (q.data ?? []).map((ex) => {
          const ready = ex.availability !== 'coming_soon';
          const conns = ex.connections.filter((c) => c.status !== 'revoked');
          return (
            <View key={ex.id} style={[card, { padding: 16, gap: 12, opacity: ready ? 1 : 0.75 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Txt style={{ fontSize: 17, fontFamily: font.semibold, flex: 1 }}>{ex.name}</Txt>
                {ex.availability === 'live' ? <Badge text="Live" color={colors.up} />
                  : ex.availability === 'testnet_only' ? <Badge text="Testnet" color={colors.demo} />
                  : <Badge text="Coming soon" color={colors.muted} />}
              </View>
              {conns.map((c) => (
                <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
                  {c.status === 'active' ? <CircleCheck size={18} color={colors.up} /> : <CircleAlert size={18} color={colors.down} />}
                  <View style={{ flex: 1 }}>
                    <Txt style={{ fontSize: 15, fontFamily: font.medium }}>{statusWord(c.status)} · {envLabel(c.environment)}</Txt>
                    <Txt style={{ fontSize: 13, color: colors.muted }}>Key ending {c.key_hint ?? '••••'}{c.status_detail ? ` · ${c.status_detail}` : ''}</Txt>
                  </View>
                  <Button label="Disconnect" variant="secondary" height={40} iconLeft={<Trash2 size={16} color={colors.text} />} onPress={() => setRemoving({ conn: c, ex })} />
                </View>
              ))}
              {ready ? (
                conns.length ? null : (
                  <Button label={`Connect ${ex.name} testnet`} height={46} iconLeft={<Plus size={18} color={colors.dark} />}
                    onPress={() => router.push({ pathname: '/ai/connect', params: { provider: ex.id } })} />
                )
              ) : (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Clock3 size={16} color={colors.muted} />
                  <Txt style={{ color: colors.muted, fontSize: 13 }}>Not available yet.</Txt>
                </View>
              )}
            </View>
          );
        })}
        <Txt style={{ color: colors.muted, fontSize: 12, lineHeight: 18, paddingHorizontal: 4 }}>
          Testnet uses test money from Binance, not your real account. Real-money connections open after legal approval.
        </Txt>
      </Page>

      <Dialog
        open={!!removing} title="Disconnect this key?"
        body="Oliskey stops trading on it at once and deletes the key from our side. Holdings stay in your exchange account."
        onClose={() => setRemoving(null)}
        actions={[
          { label: 'Cancel', onPress: () => setRemoving(null) },
          { label: disconnect.isPending ? 'Disconnecting…' : 'Disconnect', color: colors.down, onPress: () => removing && disconnect.mutate(removing.conn.id) },
        ]}
      />
      <Dialog
        open={!!removed} title="Disconnected"
        body={`Now delete the key on ${removed?.name ?? 'the exchange'} too, so it can never be used again.`}
        onClose={() => setRemoved(null)}
        actions={[
          { label: 'Later', onPress: () => setRemoved(null) },
          { label: 'Open key settings', onPress: () => { const url = removed?.id === 'binance' ? BINANCE_TESTNET_URL : removed?.key_settings_url; setRemoved(null); if (url) void WebBrowser.openBrowserAsync(url); } },
        ]}
      />
    </SafeAreaView>
  );
}
