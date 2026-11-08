// The page the reset email links to. Supabase puts a one-time token in the address; it is kept only in memory, wiped from the address at once,
// and sent to our server with the new password. The server checks it with Supabase before changing anything.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { AuthError, AuthField, AuthShell, SwitchLine } from '@/components/AuthShell';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { Button } from '@/ui/Button';

const readToken = () => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const token = hash.get('type') === 'recovery' ? hash.get('access_token') : null;
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  return token;
};

export default function Reset() {
  const { setSession } = useAuth();
  const [token] = useState(readToken);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!token) setError('This reset link is not valid or has already been used. Ask for a new one.'); }, [token]);

  const submit = async () => {
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== again) return setError('The two passwords are not the same.');
    setBusy(true); setError('');
    try {
      const r = await api<{ token: string }>('/auth/reset', { method: 'POST', body: { accessToken: token, password } });
      await setSession(r.token);
      router.replace('/');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Choose a new password" subtitle="Use at least 8 characters. You will be signed in once it is saved.">
      {error ? <AuthError>{error}</AuthError> : null}
      {token ? (
        <>
          <AuthField label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" placeholder="At least 8 characters" />
          <AuthField label="New password again" value={again} onChangeText={setAgain} secureTextEntry autoComplete="new-password" textContentType="newPassword" onSubmitEditing={submit} />
          <Button label="Save new password" height={54} onPress={submit} loading={busy} />
        </>
      ) : (
        <Button label="Ask for a new link" height={54} onPress={() => router.replace('/forgot')} />
      )}
      <SwitchLine text="Remembered it?" action="Sign in" onPress={() => router.replace('/login')} />
    </AuthShell>
  );
}
