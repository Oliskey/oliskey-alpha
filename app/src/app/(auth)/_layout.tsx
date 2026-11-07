import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { colors } from '@/theme';

export default function AuthLayout() {
  const { token } = useAuth();
  if (token) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }} />;
}
