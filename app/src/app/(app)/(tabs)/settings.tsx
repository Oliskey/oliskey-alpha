// Settings: identity card, then grouped settings (personal details, security, admin, account). Rows open in place.
import { Segmented } from '@/components/UnderlineTabs';
import { useTheme } from '@/context/ThemeContext';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Copy, KeyRound, LayoutDashboard, LogOut, Mail, ShieldCheck, Trash2, type LucideIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useAccount } from '@/context/AccountContext';
import { card, colors, font, radius } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Field } from '@/ui/Field';
import { Press } from '@/ui/Press';
import { useToast } from '@/ui/Toast';
import { ChipRow } from '@/ui/kit';
import { Txt } from '@/ui/Txt';
import { Row, Section } from '@/ui/List';
import { Page } from '@/ui/Page';

const THEME_OPTIONS = [{ key: 'dark', label: 'Dark' }, { key: 'light', label: 'White' }, { key: 'system', label: 'Device' }] as const;

const KYC = () => ({
  none: { label: 'Identity not verified', color: colors.muted },
  pending: { label: 'Identity under review', color: colors.demo },
  verified: { label: 'Identity verified', color: colors.up },
  rejected: { label: 'Identity check failed', color: colors.down },
});
const TIER = { starter: 'Starter', smart: 'Smart', alpha: 'Alpha' } as const;

function Badge({ label, color, icon: Icon }: { label: string; color: string; icon?: LucideIcon }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 26, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2 }}>
      {Icon ? <Icon size={13} color={color} /> : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />}
      <Txt style={{ fontSize: 12, fontFamily: font.medium, color: colors.text }}>{label}</Txt>
    </View>
  );
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setCurrent(''); setNext('');
      toast({ title: 'Password changed' });
      onDone();
    } catch (e) {
      toast({ title: 'Password not changed', message: (e as Error).message, tone: 'down' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
      <Field label="New password (8+ characters)" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" />
      <Button label="Update password" loading={busy} disabled={!current || next.length < 8} onPress={submit} />
    </>
  );
}

// Admins only: authenticator-app codes are required before the admin tools open.
function TwoStepSetup() {
  const { setSession } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try { setSetup(await api('/auth/mfa/setup', { method: 'POST' })); }
    catch (e) { toast({ title: 'Could not start setup', message: (e as Error).message, tone: 'down' }); }
    finally { setBusy(false); }
  };
  const turnOn = async () => {
    setBusy(true);
    try {
      const r = await api<{ token: string }>('/auth/mfa/enable', { method: 'POST', body: { code } });
      await setSession(r.token);
      await qc.invalidateQueries({ queryKey: ['me'] });
      setSetup(null);
      toast({ title: '2-step login is on', message: 'You will be asked for a code each time you log in.' });
    } catch (e) {
      toast({ title: 'Code not accepted', message: (e as Error).message, tone: 'down' });
    } finally { setBusy(false); }
  };
  if (!setup) {
    return (
      <>
        <Txt style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>
          Admin tools stay locked until this is on. You need an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.
        </Txt>
        <Button label="Set up 2-step login" loading={busy} onPress={start} />
      </>
    );
  }
  return (
    <>
      <Txt style={{ fontSize: 14 }}>1. Add this key to your authenticator app, or open the link on this phone.</Txt>
      <Press onPress={async () => { await Clipboard.setStringAsync(setup.secret); toast({ title: 'Key copied' }); }}
        style={{ flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: colors.surface2, borderRadius: radius.md, padding: 12 }}>
        <Txt selectable style={{ flex: 1, fontFamily: font.semibold, letterSpacing: 1 }}>{setup.secret}</Txt>
        <Copy size={18} color={colors.muted} />
      </Press>
      <Txt style={{ color: colors.accent, fontSize: 14 }} onPress={() => { void Linking.openURL(setup.otpauthUrl); }}>Open in authenticator app</Txt>
      <Txt style={{ fontSize: 14 }}>2. Enter the 6-digit code it shows.</Txt>
      <Field label="Code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" />
      <Button label="Turn on 2-step login" loading={busy} disabled={code.length !== 6} onPress={turnOn} />
    </>
  );
}

// Delete account: allowed once real money is withdrawn and no trade is open (the server checks both).
// Trades and the ledger are kept; name, phone and email are removed.
function DeleteAccount({ onCancel }: { onCancel: () => void }) {
  const { signOut } = useAuth();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setConfirm(false); setBusy(true);
    try {
      await api('/me', { method: 'DELETE', body: { password } });
      toast({ title: 'Your account has been deleted' });
      await signOut();
    } catch (e) {
      toast({ title: 'Account not deleted', message: (e as Error).message, tone: 'down' });
    } finally { setBusy(false); }
  };
  return (
    <>
      <Txt style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>
        First withdraw all money from your NGN and USDT accounts and let open trades finish. Your name, phone and email are then
        removed and you can no longer log in. Trade and payment records are kept, as the law requires. Demo credits are removed.
      </Txt>
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button style={{ flex: 1 }} variant="secondary" label="Keep account" onPress={onCancel} />
        <Button style={{ flex: 1 }} variant="secondary" label="Delete" textColor={colors.down} loading={busy} disabled={!password} onPress={() => setConfirm(true)} />
      </View>
      <Dialog
        open={confirm}
        title="Delete your account?"
        body="This cannot be undone."
        onClose={() => setConfirm(false)}
        actions={[
          { label: 'Cancel', onPress: () => setConfirm(false), color: colors.muted },
          { label: 'Delete', onPress: run, color: colors.down },
        ]}
      />
    </>
  );
}

export default function Profile() {
  const { signOut } = useAuth();
  const { me } = useAccount();
  const qc = useQueryClient();
  const toast = useToast();
  const p = me?.profile;
  const [fullName, setFullName] = useState(p?.full_name ?? '');
  const [phone, setPhone] = useState(p?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [openRow, setOpenRow] = useState<null | 'password' | 'twostep' | 'delete'>(null);
  const toggle = (row: typeof openRow) => setOpenRow((r) => (r === row ? null : row));
  useEffect(() => { setFullName(p?.full_name ?? ''); setPhone(p?.phone ?? ''); }, [p?.full_name, p?.phone]);
  const changed = fullName.trim() !== (p?.full_name ?? '') || phone.trim() !== (p?.phone ?? '');

  const save = async () => {
    setBusy(true);
    try {
      await api('/me', { method: 'PATCH', body: { fullName: fullName.trim(), phone: phone.trim() } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast({ title: 'Profile saved' });
    } catch (e) {
      toast({ title: 'Could not save', message: (e as Error).message, tone: 'down' });
    } finally {
      setBusy(false);
    }
  };

  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const kyc = KYC()[p?.kyc_status ?? 'none'];
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar title="Settings" width="narrow" />
      <Page width="narrow" gap={24}>
        {/* identity */}
        <View style={[card, { padding: 20, alignItems: 'center', gap: 12 }]}>
          <Avatar size={76} />
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Txt style={{ fontSize: 22, fontFamily: font.bold, letterSpacing: -0.3 }}>{p?.full_name || 'Trader'}</Txt>
            <Txt style={{ color: colors.muted, fontSize: 14 }}>{p?.email}</Txt>
          </View>
          <ChipRow center>
            <Badge label={`${p ? TIER[p.tier] : 'Starter'} tier`} color={p?.tier === 'alpha' ? colors.demo : p?.tier === 'smart' ? colors.accent : colors.muted} />
            <Badge label={kyc.label} color={kyc.color} icon={p?.kyc_status === 'verified' ? BadgeCheck : undefined} />
            {p?.is_admin ? <Badge label="Admin" color={colors.accent} icon={ShieldCheck} /> : null}
          </ChipRow>
        </View>

        <Section title="Personal details">
          <View style={{ padding: 14, gap: 12 }}>
            <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" />
            <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="e.g. 0801 234 5678" />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2 }}>
              <Mail size={16} color={colors.muted} />
              <Txt style={{ flex: 1, fontSize: 14, color: colors.muted }} numberOfLines={1}>{p?.email}</Txt>
              <Txt style={{ fontSize: 12, color: colors.faint }}>Login email</Txt>
            </View>
            <Button label={changed ? 'Save changes' : 'Saved'} onPress={save} loading={busy} disabled={!changed} />
          </View>
        </Section>

        <Section title="Appearance">
          <View style={{ padding: 12 }}>
            <Segmented stretch tabs={THEME_OPTIONS} value={themeMode} onChange={setThemeMode} />
          </View>
        </Section>

        <Section title="Security">
          <Row icon={KeyRound} title="Password"
            onPress={() => toggle('password')} open={openRow === 'password'} last={!p?.is_admin}>
            <ChangePassword onDone={() => setOpenRow(null)} />
          </Row>
          {p?.is_admin ? (
            p.mfa_enabled ? (
              <Row icon={ShieldCheck} title="2-step login" subtitle="On"
                right={<Badge label="On" color={colors.up} />} last />
            ) : (
              <Row icon={ShieldCheck} title="2-step login" subtitle="Needed for admin tools"
                right={<Badge label="Off" color={colors.down} />} onPress={() => toggle('twostep')} open={openRow === 'twostep'} last>
                <TwoStepSetup />
              </Row>
            )
          ) : null}
        </Section>

        {p?.is_admin ? (
          <Section title="Admin">
            <Row icon={LayoutDashboard} title="Admin tools" onPress={() => router.push('/admin')} last />
          </Section>
        ) : null}

        <Section title="Account">
          <Row icon={LogOut} title="Log out" onPress={() => { void signOut(); }} />
          <Row icon={Trash2} title="Delete account" tone={colors.down}
            onPress={() => toggle('delete')} open={openRow === 'delete'} last>
            <DeleteAccount onCancel={() => setOpenRow(null)} />
          </Row>
        </Section>

        <Txt style={{ textAlign: 'center', color: colors.faint, fontSize: 12 }}>Oliskey Alpha by Oliskeylee Ltd.</Txt>
      </Page>
    </SafeAreaView>
  );
}
