import { useState } from 'react';
import { router } from 'expo-router';
import { AuthError, AuthField, AuthShell, QuietButton, SwitchLine } from '@/components/AuthShell';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/ui/Button';

export default function Login() {
  const { signIn, signInWithCode } = useAuth();
  const [ticket, setTicket] = useState<string | null>(null);   // admin 2-step login: password done, code next
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true); setError('');
    try {
      const r = await signIn(email.trim(), password);
      if (r.mfaTicket) setTicket(r.mfaTicket);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const submitCode = async () => {
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from your authenticator app.');
    setBusy(true); setError('');
    try { await signInWithCode(ticket!, code); } catch (e) { setError((e as Error).message); setCode(''); } finally { setBusy(false); }
  };

  if (ticket) {
    return (
      <AuthShell title="Enter your code" subtitle="Open your authenticator app and enter the 6-digit code for Oliskey Alpha." onBack={() => { setTicket(null); setCode(''); setError(''); }}>
        {error ? <AuthError>{error}</AuthError> : null}
        <AuthField label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" autoFocus onSubmitEditing={submitCode} />
        <Button label="Verify" height={54} onPress={submitCode} loading={busy} />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your account.">
      {error ? <AuthError>{error}</AuthError> : null}
      <AuthField label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" onSubmitEditing={submit} />
      <AuthField label="Password" value={password} onChangeText={setPassword} placeholder="Your password" secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit}
        right={<QuietButton label="Forgot password?" onPress={() => router.push('/forgot')} />} />
      <Button label="Sign in" height={54} onPress={submit} loading={busy} />
      <SwitchLine text="New to Oliskey Alpha?" action="Create an account" onPress={() => router.replace('/register')} />
    </AuthShell>
  );
}
