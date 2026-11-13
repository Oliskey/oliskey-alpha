// AI Trading admin (admins with 2-step login): overview, the emergency stop and pause, and the approval centre.
// An approval needs a link to the evidence and a note; the database refuses it otherwise. Live trading for an exchange can only
// be switched on by the server once every required approval is in (REAL-MONEY GATE); there is no shortcut here.
import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OctagonAlert, OctagonPause, ShieldCheck } from 'lucide-react-native';
import { useAccount } from '@/context/AccountContext';
import { api, ApiError } from '@/lib/api';
import { decimal } from '@/lib/aiTrading';
import { dayLabel } from '@/lib/format';
import { card, colors, font, type } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Chip, DottedRow, Spinner, Toggle } from '@/ui/kit';
import { Grid, Page } from '@/ui/Page';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';
import { useLayout } from '@/hooks/useLayout';

type Overview = {
  customersWithExchange: number; activeSubscriptions: number; connections: { active: number; attention: number };
  orders24h: { total: number; problems: number }; revenueNgn: { subscriptions: string; commission: string };
  riskChecks24h: { rejected: number; total: number }; controls: { platform_paused: boolean; emergency_stop: boolean; live_trading_enabled: boolean; reason: string | null };
  alerts: { kind: string; severity: string; message: string; created_at: string }[]; waitlist: number;
};
type Approval = { id: string; area: string; subject: string; status: string; evidence_url: string | null; evidence_note: string | null; responsible: string | null; required_action: string | null; updated_at: string };

const AREA: Record<string, string> = {
  exchange_commercial: 'Exchange agreement', regulatory_legal: 'Legal sign-off', api_integration: 'API integration', security_assessment: 'Security review',
  penetration_test: 'Penetration test', payment_provider: 'Payment provider', production_environment: 'Production setup', live_trading_activation: 'Final activation',
};
const STATUSES = ['not_started', 'in_progress', 'submitted', 'approved', 'rejected'] as const;
const WORD: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected' };
const statusColor = (s: string) => (s === 'approved' ? colors.up : s === 'rejected' ? colors.down : s === 'not_started' ? colors.muted : colors.demo);

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <View style={[card, { padding: 14, gap: 4, flex: 1, minWidth: 140 }]}>
      <Txt style={{ fontSize: 13, color: colors.muted }}>{label}</Txt>
      <Txt style={[type.sectionTitle, warn ? { color: colors.down } : null]}>{value}</Txt>
    </View>
  );
}

function EditApproval({ a, onClose }: { a: Approval; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState(a.status);
  const [url, setUrl] = useState(a.evidence_url ?? '');
  const [note, setNote] = useState(a.evidence_note ?? '');
  const needsEvidence = status === 'approved' && (!/^https:\/\/\S+$/.test(url.trim()) || !note.trim());
  const save = useMutation({
    mutationFn: () => api(`/admin/trading/approvals/${a.id}`, { method: 'PATCH', body: { status, evidenceUrl: url.trim() || undefined, evidenceNote: note.trim() || undefined } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin-trading'] }); toast({ title: 'Saved' }); onClose(); },
    onError: (e) => toast({ title: 'Not saved', message: (e as Error).message, tone: 'down' }),
  });
  return (
    <View style={{ gap: 14, padding: 16 }}>
      <Txt style={type.sectionTitle}>{AREA[a.area] ?? a.area} · {a.subject}</Txt>
      {a.required_action ? <Txt style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>{a.required_action}</Txt> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {STATUSES.map((s) => <Chip key={s} label={WORD[s]} active={status === s} onPress={() => setStatus(s)} />)}
      </View>
      <Field label="Evidence link (https)" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} placeholder="https://…" />
      <Field label="Note: what the evidence shows" value={note} onChangeText={setNote} multiline placeholder="Who approved, what, and when" />
      {needsEvidence ? <Txt style={{ color: colors.down, fontSize: 13 }}>An approval needs an https evidence link and a note.</Txt> : null}
      <Button label="Save" height={48} loading={save.isPending} disabled={needsEvidence} onPress={() => save.mutate()} />
    </View>
  );
}

export default function AdminTrading() {
  const { me } = useAccount();
  const { isPhone } = useLayout();
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = !!me?.profile.is_admin;
  const ov = useQuery({ queryKey: ['admin-trading', 'overview'], queryFn: () => api<Overview>('/admin/trading/overview'), enabled: isAdmin, refetchInterval: 30_000 });
  const ap = useQuery({ queryKey: ['admin-trading', 'approvals'], queryFn: () => api<Approval[]>('/admin/trading/approvals'), enabled: isAdmin });
  const [editing, setEditing] = useState<Approval | null>(null);
  const [reason, setReason] = useState('');
  const control = useMutation({
    mutationFn: ({ path, body }: { path: string; body: object }) => api(`/admin/trading/${path}`, { method: 'POST', body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin-trading'] }); setReason(''); },
    onError: (e) => toast({ title: 'Not changed', message: (e as Error).message, tone: 'down' }),
  });

  if (!me) return <SafeAreaView style={{ flex: 1 }}><AppBar width="narrow" /><Spinner full /></SafeAreaView>;   // profile still loading
  if (!isAdmin) return <SafeAreaView style={{ flex: 1 }}><AppBar width="narrow" /><Page width="narrow"><Txt>Admins only.</Txt></Page></SafeAreaView>;
  if (ov.error instanceof ApiError && ov.error.code === 'ADMIN_2FA_REQUIRED') {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <AppBar width="narrow" />
        <Page width="narrow" gap={14}>
          <Txt style={{ fontSize: 16 }}>{ov.error.message}</Txt>
          <Button label="Go to Profile" onPress={() => router.replace('/profile')} />
        </Page>
      </SafeAreaView>
    );
  }
  const o = ov.data, ctl = o?.controls;
  const stats = o ? [
    <Stat key="c" label="Customers with an exchange" value={o.customersWithExchange} />,
    <Stat key="s" label="Active subscriptions" value={o.activeSubscriptions} />,
    <Stat key="w" label="Waiting for real money" value={o.waitlist} />,
    <Stat key="k" label="Keys needing attention" value={o.connections.attention} warn={o.connections.attention > 0} />,
    <Stat key="o" label="Order problems (24 h)" value={`${o.orders24h.problems} of ${o.orders24h.total}`} warn={o.orders24h.problems > 0} />,
    <Stat key="r" label="Risk refusals (24 h)" value={`${o.riskChecks24h.rejected} of ${o.riskChecks24h.total}`} />,
    <Stat key="n" label="Revenue NGN (plans + fees)" value={`${decimal(String(o.revenueNgn.subscriptions))} + ${decimal(String(o.revenueNgn.commission))}`} />,
  ] : [];

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="wide" />
      <Page width="wide" gap={22}>
        <View style={{ gap: 6 }}>
          <Txt style={type.screenTitle}>AI Trading admin</Txt>
          <Txt style={{ color: ctl?.live_trading_enabled ? colors.down : colors.demo, fontSize: 14, fontFamily: font.medium }}>
            {ctl?.live_trading_enabled ? 'Real-money trading is ON' : 'Real-money trading is off · it can only open when every approval below is in'}
          </Txt>
        </View>
        {ov.isLoading ? <Spinner /> : (
          <>
            {isPhone ? <View style={{ gap: 10 }}>{stats}</View> : <Grid columns={3} gap={12}>{stats}</Grid>}

            <View style={[card, { padding: 16, gap: 14 }]}>
              <Txt style={type.sectionTitle}>Controls</Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <OctagonPause size={20} color={colors.demo} />
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontSize: 16, fontFamily: font.semibold }}>Pause all trading</Txt>
                  <Txt style={{ fontSize: 13, color: colors.muted }}>No new orders for anyone. Holdings stay where they are.</Txt>
                </View>
                <Toggle accessibilityLabel="Pause all trading" value={!!ctl?.platform_paused} onValueChange={(v) => control.mutate({ path: 'pause', body: { on: v } })} />
              </View>
              <View style={{ height: 1, backgroundColor: colors.border }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <OctagonAlert size={20} color={colors.down} />
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontSize: 16, fontFamily: font.semibold }}>Emergency stop {ctl?.emergency_stop ? '· ON' : ''}</Txt>
                  <Txt style={{ fontSize: 13, color: colors.muted }}>{ctl?.emergency_stop ? `Reason: ${ctl.reason ?? '—'}` : 'Stops everything at once. A reason is required.'}</Txt>
                </View>
              </View>
              {ctl?.emergency_stop ? (
                <Button label="Turn emergency stop off" variant="secondary" height={46} loading={control.isPending} onPress={() => control.mutate({ path: 'emergency-stop', body: { on: false } })} />
              ) : (
                <View style={{ gap: 10 }}>
                  <Field label="Reason" value={reason} onChangeText={setReason} placeholder="What happened" />
                  <Button label="Emergency stop" variant="down" height={46} disabled={!reason.trim()} loading={control.isPending}
                    onPress={() => control.mutate({ path: 'emergency-stop', body: { on: true, reason: reason.trim() } })} />
                </View>
              )}
            </View>

            {o?.alerts.length ? (
              <View style={[card, { padding: 16, gap: 8 }]}>
                <Txt style={type.sectionTitle}>Alerts</Txt>
                {o.alerts.map((a, i) => <DottedRow key={`${a.created_at}${i}`} label={`${dayLabel(a.created_at)} · ${a.kind}`} value={a.message} valueColor={a.severity === 'critical' ? colors.down : colors.demo} />)}
              </View>
            ) : null}
          </>
        )}

        <View style={{ gap: 10 }}>
          <Txt style={type.sectionTitle}>Approval centre</Txt>
          <Txt style={{ color: colors.muted, fontSize: 14 }}>Each item needs evidence before it can be approved.</Txt>
          {ap.isLoading ? <Spinner /> : (
            <View style={[card, { overflow: 'hidden' }]}>
              {(ap.data ?? []).map((a, i, all) => (
                <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: i < all.length - 1 ? 1 : 0, borderColor: colors.border }}>
                  {a.status === 'approved' ? <ShieldCheck size={18} color={colors.up} /> : <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor(a.status) }} />}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt style={{ fontSize: 15, fontFamily: font.semibold }}>{AREA[a.area] ?? a.area} · {a.subject}</Txt>
                    <Txt style={{ fontSize: 13, color: statusColor(a.status) }}>{WORD[a.status] ?? a.status}{a.evidence_url ? ' · evidence linked' : ''}</Txt>
                  </View>
                  <Button label="Update" variant="secondary" height={38} onPress={() => setEditing(a)} />
                </View>
              ))}
            </View>
          )}
        </View>
      </Page>
      <Sheet open={!!editing} onClose={() => setEditing(null)}>{editing ? <EditApproval a={editing} onClose={() => setEditing(null)} /> : null}</Sheet>
    </SafeAreaView>
  );
}
