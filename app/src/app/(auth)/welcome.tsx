import { View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HeroPanel } from '@/components/AuthShell';
import { GoogleButton } from '@/components/GoogleButton';
import { useAuth } from '@/context/AuthContext';
import { useLayout } from '@/hooks/useLayout';
import { PREVIEW } from '@/lib/preview';
import { colors, font, createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Txt } from '@/ui/Txt';

export default function Welcome() {
  const { setSession } = useAuth();
  const { width } = useLayout();
  const wide = width >= 920;
  const actions = (
    <View style={styles.actions}>
      {wide ? (
        <View style={{ gap: 8, marginBottom: 10 }}>
          <Txt style={styles.title} accessibilityRole="header">Get started</Txt>
          <Txt style={styles.subtitle}>Free to join, and no card needed.</Txt>
        </View>
      ) : null}
      <Button label="Create free account" height={54} onPress={() => router.push('/register')} />
      <Button label="Sign in" variant="secondary" height={54} onPress={() => router.push('/login')} />
      <GoogleButton />
      {PREVIEW ? <Button label="Look around" variant="secondary" height={54} onPress={() => { void setSession('preview').then(() => router.replace('/')); }} /> : null}
      <Txt style={styles.note}>Demo prices are simulated except crypto. Trading involves risk.</Txt>
    </View>
  );
  if (wide) {
    return (
      <View style={styles.wide}>
        <View style={{ flex: 1, maxWidth: '50%' }}><HeroPanel /></View>
        <SafeAreaView style={styles.wideSide}>{actions}</SafeAreaView>
      </View>
    );
  }
  return (
    <View style={styles.page}>
      <View style={{ flex: 1 }}><HeroPanel compact /></View>
      <SafeAreaView edges={['bottom']} style={styles.phoneSide}>{actions}</SafeAreaView>
    </View>
  );
}

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: colors.bg },
  wide: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  wideSide: { flex: 1, justifyContent: 'center', padding: 24 },
  phoneSide: { padding: 20 },
  actions: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: 11 },
  title: { fontSize: 32, lineHeight: 38, fontFamily: font.bold, letterSpacing: -0.7 },
  subtitle: { fontSize: 16, lineHeight: 23, color: colors.muted },
  note: { color: colors.muted, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 5 },
}));
