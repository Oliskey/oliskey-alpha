import { prepareInstall } from '@/lib/install';
import { Fragment, useEffect } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
// One import per weight: importing from the package root ships all 18 font files, about 6 MB, when these 4 are the ones used.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AccountProvider } from '@/context/AccountContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { colors } from '@/theme';
import { ToastProvider } from '@/ui/Toast';
import { OfflineBanner } from '@/components/OfflineState';
import { subscribeEvents } from '@/lib/ws';

SplashScreen.preventAutoHideAsync();

// Web: a service worker keeps the app's files so it still opens without a connection (public/sw.js).
prepareInstall();
if (Platform.OS === 'web' && !__DEV__ && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  const register = () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); };
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register);
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function Root() {
  const { ready } = useAuth();
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const loaded = ready && fontsLoaded;

  useEffect(() => { if (loaded) SplashScreen.hideAsync(); }, [loaded]);
  // a new notification updates the bell and the list at once
  useEffect(() => subscribeEvents((e) => {
    if (e.type !== 'notification') return;
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    void queryClient.invalidateQueries({ queryKey: ['rewards'] });
  }), []);
  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
      <Stack.Screen name="(app)" />
      <Stack.Screen name="(auth)" />
    </Stack>
  );
}

// The key redraws every screen when the theme changes.
function Themed() {
  const { theme, ready } = useTheme();
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return (
    <Fragment key={theme}>
      <ToastProvider>
        <StatusBar style={theme === 'light' ? 'dark' : 'light'} />
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <OfflineBanner />
          <View style={{ flex: 1 }}><Root /></View>
        </View>
      </ToastProvider>
    </Fragment>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AccountProvider>
            <ThemeProvider><Themed /></ThemeProvider>
          </AccountProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
