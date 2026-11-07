// Admin (is_admin only): pending withdrawals and the live-trading switch.
import { View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { money } from '@/lib/format';
import { useAccount } from '@/context/AccountContext';
import { colors, font, radius, SIDE, type } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { useToast } from '@/ui/Toast';
import { Toggle } from '@/ui/kit';
import { Txt } from '@/ui/Txt';
import { Page } from '@/ui/Page';

type Pending = { id: string; amount: string; created_at: string; full_name: string; email: string; bank_name: string; account_number: string; account_name: string };

export default function Admin() {
  const { me } = useAccount();
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<{ live_trading_enabled: boolean }>('/admin/settings'), enabled: !!me?.profile.is_admin });
  const pending = useQuery({ queryKey: ['admin', 'withdrawals'], queryFn: () => api<Pending[]>('/admin/withdrawals?status=pending'), enabled: !!me?.profile.is_admin });
  const act = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => api(`/admin/withdrawals/${id}/${approve ? 'approve' : 'reject'}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
    onError: (e) => toast({ title: 'Action failed', message: e.message, tone: 'down' }),
  });
  const toggle = useMutation({
    mutationFn: (v: boolean) => api('/admin/settings', { method: 'POST', body: { live_trading_enabled: v } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin'] }); qc.invalidateQueries({ queryKey: ['settings'] }); },
  });

  if (!me?.profile.is_admin) return <SafeAreaView style={{ flex: 1 }}><AppBar /><Txt style={{ padding: SIDE }}>Admins only.</Txt></SafeAreaView>;
  if (settings.error instanceof ApiError && settings.error.code === 'ADMIN_2FA_REQUIRED') {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <AppBar title="Admin" width="narrow" />
        <Page width="narrow" gap={14}>
          <Txt style={{ fontSize: 16 }}>{settings.error.message}</Txt>
          <Button label="Go to Profile" onPress={() => router.replace('/profile')} />
        </Page>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar title="Admin" width="regular" />
      <Page gap={14}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Txt style={{ fontFamily: font.bold, fontSize: 16 }}>Live (real-money) trading</Txt>
            <Toggle accessibilityLabel="Live trading" value={!!settings.data?.live_trading_enabled} onValueChange={(v) => toggle.mutate(v)} />
          </View>
          <Txt style={{ color: colors.down, fontSize: 13 }}>
            Keep this off until a licensed price feed replaces the simulator and a lawyer has signed off every trading mode.
          </Txt>
        </View>
        <Txt style={type.sectionTitle}>Pending withdrawals</Txt>
        {(pending.data ?? []).length === 0 ? <Txt style={{ color: colors.muted }}>Nothing waiting.</Txt> : null}
        {(pending.data ?? []).map((w) => (
          <View key={w.id} style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: 14, gap: 6 }}>
            <Txt style={{ fontSize: 18, fontFamily: font.bold }}>{money(-Number(w.amount), 'NGN')}</Txt>
            <Txt>{w.full_name} · {w.email}</Txt>
            <Txt style={{ color: colors.muted }}>{w.bank_name} · {w.account_number} · {w.account_name}</Txt>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <Button style={{ flex: 1 }} variant="secondary" label="Reject" textColor={colors.down} onPress={() => act.mutate({ id: w.id, approve: false })} />
              <Button style={{ flex: 1 }} label="Approve & pay" onPress={() => act.mutate({ id: w.id, approve: true })} />
            </View>
          </View>
        ))}
      </Page>
    </SafeAreaView>
  );
}
