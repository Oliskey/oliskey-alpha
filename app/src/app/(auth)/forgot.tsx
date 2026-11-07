import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';
import { AuthError, AuthField, AuthShell, SwitchLine } from '@/components/AuthShell';
import { api } from '@/lib/api';
import { colors, font } from '@/theme';
import { Button } from '@/ui/Button';
import { Txt } from '@/ui/Txt';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim()) return setError('Enter the email you signed up with.');
    setBusy(true); setError('');
    try {
      await api('/auth/forgot', { method: 'POST', body: { email: email.trim() } });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your inbox" subtitle={`If an account uses ${email.trim()}, a reset link is on its way.`}>
        <View style={{ alignItems: 'center', paddingVertical: 8 }}><CircleCheck size={52} color={colors.up} strokeWidth={1.6} /></View>
        <Button label="Back to sign in" height={54} onPress={() => router.replace('/login')} />
        <Txt style={{ color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', fontFamily: font.regular }}>Nothing yet? Check your spam folder, or try again in a few minutes.</Txt>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="Enter your email and we'll send you a link to choose a new one.">
      {error ? <AuthError>{error}</AuthError> : null}
      <AuthField label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" onSubmitEditing={submit} />
      <Button label="Send reset link" height={54} onPress={submit} loading={busy} />
      <SwitchLine text="Remembered it?" action="Sign in" onPress={() => router.replace('/login')} />
    </AuthShell>
  );
}
