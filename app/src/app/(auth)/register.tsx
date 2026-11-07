import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { AuthError, AuthField, AuthShell, PasswordStrength, QuietButton, SwitchLine } from '@/components/AuthShell';
import { useAuth } from '@/context/AuthContext';
import { colors } from '@/theme';
import { Button } from '@/ui/Button';
import { Txt } from '@/ui/Txt';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Register() {
  const { register } = useAuth();
  const { invite } = useLocalSearchParams<{ invite?: string }>();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', inviteCode: typeof invite === 'string' ? invite : '' });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form | 'server', string>>>({});
  const [busy, setBusy] = useState(false);
  const [showInvite, setShowInvite] = useState(typeof invite === 'string' && !!invite);
  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] || e.server ? { ...e, [k]: undefined, server: undefined } : e));
  };

  const submit = async () => {
    const e: typeof errors = {};
    if (form.fullName.trim().length < 2) e.fullName = 'Enter your full name.';
    if (!EMAIL.test(form.email.trim())) e.email = 'Enter a valid email address.';
    if (form.password.length < 8) e.password = 'Use at least 8 characters.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try { await register(form.fullName.trim(), form.email.trim(), form.password, form.inviteCode.trim()); }
    catch (err) { setErrors({ server: (err as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <AuthShell title="Create your account" subtitle="You start with α10,000 in demo funds to practise with.">
      {errors.server ? <AuthError>{errors.server}</AuthError> : null}
      <AuthField label="Full name" value={form.fullName} onChangeText={set('fullName')} placeholder="Your name" autoComplete="name" textContentType="name" error={errors.fullName} />
      <AuthField label="Email" value={form.email} onChangeText={set('email')} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" error={errors.email} />
      <View style={{ gap: 8 }}>
        <AuthField label="Password" value={form.password} onChangeText={set('password')} placeholder="At least 8 characters" secureTextEntry autoComplete="new-password" textContentType="newPassword" error={errors.password} onSubmitEditing={submit} />
        <PasswordStrength value={form.password} />
      </View>
      {showInvite ? (
        <AuthField label="Invite code" value={form.inviteCode} onChangeText={set('inviteCode')} placeholder="Optional" autoCapitalize="characters" />
      ) : (
        <QuietButton label="I have an invite code" onPress={() => setShowInvite(true)} />
      )}
      <Button label="Create account" height={54} onPress={submit} loading={busy} />
      <Txt style={{ color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' }}>
        By continuing you confirm you are 18 or older, accept the{' '}
        <Txt style={{ color: colors.accent, fontSize: 12 }} onPress={() => router.push('/terms')} accessibilityRole="link">Terms of Service</Txt>
        {' '}and{' '}
        <Txt style={{ color: colors.accent, fontSize: 12 }} onPress={() => router.push('/privacy')} accessibilityRole="link">Privacy Policy</Txt>
        , and understand that trading involves risk.
      </Txt>
      <SwitchLine text="Already have an account?" action="Sign in" onPress={() => router.replace('/login')} />
    </AuthShell>
  );
}
