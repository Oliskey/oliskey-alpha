import { Redirect, Stack, usePathname } from 'expo-router';
import { useAccount } from '@/context/AccountContext';
import { useAuth } from '@/context/AuthContext';
import { colors } from '@/theme';

export default function AppLayout() {
  const { token } = useAuth();
  const { me } = useAccount();
  const path = usePathname();
  if (!token) return <Redirect href="/welcome" />;
  // new people go through the lessons first; the server holds their trades until then as well
  if (me && !me.profile.onboarded_at && path !== '/onboarding') return <Redirect href="/onboarding" />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false, animation: 'fade' }} />
    </Stack>
  );
}
