// Forgot password (owner 2026-11-08): the email holds a 6-digit code that works for 5 minutes. The person types it here with a new password,
// the server checks it with Supabase, saves the password and signs them in. The answer never says whether the email has an account.
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { AuthError, AuthField, AuthShell, SwitchLine } from '@/components/AuthShell';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { colors, font } from '@/theme';
import { Button } from '@/ui/Button';
import { Txt } from '@/ui/Txt';

const CODE_LIFE_S = 300;   // matches the email code expiry set in Supabase
const RESEND_AFTER_S = 60;

const send = (email: string) =>
  api('/auth/forgot', { method: 'POST', body: { email, from: typeof window !== 'undefined' ? window.location.origin : undefined } });

export default function Forgot() {
  const { setSession } = useAuth();
  const [email, setEmail] = useState('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!sentAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sentAt]);

  const ask = async () => {
    if (!email.trim()) return setError('Enter the email you signed up with.');
    setBusy(true); setError('');
    try { await send(email.trim()); setSentAt(Date.now()); setNow(Date.now()); setCode(''); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from the email.');
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== again) return setError('The two passwords are not the same.');
    setBusy(true); setError('');
    try {
      const r = await api<{ token: string }>('/auth/reset', { method: 'POST', body: { email: email.trim(), code, password } });
      await setSession(r.token);
      router.replace('/');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (sentAt) {
    const left = Math.max(0, CODE_LIFE_S - Math.floor((now - sentAt) / 1000));
    const resendIn = Math.max(0, RESEND_AFTER_S - Math.floor((now - sentAt) / 1000));
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    return (
      <AuthShell title="Enter your code" subtitle={`If an account uses ${email.trim()}, we sent it an email to reset the password.`}>
        {error ? <AuthError>{error}</AuthError> : null}
        <AuthField
          label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          placeholder="123456" keyboardType="number-pad" inputMode="numeric" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode"
          hint={left > 0 ? `The code works for ${clock} more.` : 'This code has expired. Send a new one.'}
        />
        <AuthField label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" placeholder="At least 8 characters" />
        <AuthField label="New password again" value={again} onChangeText={setAgain} secureTextEntry autoComplete="new-password" textContentType="newPassword" onSubmitEditing={save} />
        <Button label="Save new password" height={54} onPress={save} loading={busy} disabled={left === 0} />
        <Button label={resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'} variant="secondary" height={46} onPress={ask} disabled={resendIn > 0 || busy} />
        <Txt style={{ color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', fontFamily: font.regular }}>Email has a link instead of a code? Open the link to choose your new password. Nothing yet? Check your spam folder.</Txt>
        <SwitchLine text="Remembered it?" action="Sign in" onPress={() => router.replace('/login')} />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="Enter your email and we'll email you a way to choose a new one.">
      {error ? <AuthError>{error}</AuthError> : null}
      <AuthField label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" onSubmitEditing={ask} />
      <Button label="Send code" height={54} onPress={ask} loading={busy} />
      <SwitchLine text="Remembered it?" action="Sign in" onPress={() => router.replace('/login')} />
    </AuthShell>
  );
}
