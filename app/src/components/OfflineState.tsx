// What the app shows without a connection. The app keeps working with what it already loaded; only live prices and
// trading pause. ConnectionOverlay covers the chart; OfflineBanner is a small note at the top of every screen.
import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloudOff, Lock } from 'lucide-react-native';
import { useConnection, type Connection } from '@/hooks/useConnection';
import { colors, font, createStyles, veil } from '@/theme';
import { glass } from '@/ui/glass';
import { Logo } from '@/ui/Logo';
import { prefersReducedMotion } from '@/ui/Press';
import { Txt } from '@/ui/Txt';

// a slow breathing pulse (opacity + scale); still when the user asked for reduced motion
function usePulse() {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return v;
}

// With a chart to show (the last candles kept on this device), only a small note sits at the top and the chart stays readable
// and scrollable underneath (owner 2026-11-08: users see their chart offline). With nothing to show, the full card.
export function ConnectionOverlay({ state, hasChart = false }: { state: Connection; hasChart?: boolean }) {
  if (hasChart && state !== 'preview') return <ConnectionNote offline={state === 'offline'} />;
  return <ConnectionCard state={state} />;
}

function ConnectionNote({ offline }: { offline: boolean }) {
  return (
    <View style={styles.noteWrap} pointerEvents="box-none">
      <View style={[styles.notePill, glass('regular')]} accessibilityRole="alert" accessibilityLabel={offline ? 'You are offline. Showing the last saved chart.' : 'Reconnecting'}>
        <CloudOff size={15} color={colors.demo} />
        <View style={{ flexShrink: 1 }}>
          <Txt style={{ fontSize: 13, fontFamily: font.semibold }} numberOfLines={1}>{offline ? 'Offline · last saved chart' : 'Reconnecting…'}</Txt>
          <Txt style={{ fontSize: 12, color: colors.muted }} numberOfLines={2}>Trading resumes when you are back online. Open trades keep running on the server.</Txt>
        </View>
      </View>
    </View>
  );
}

function ConnectionCard({ state }: { state: Connection }) {
  const pulse = usePulse();
  const ring = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });
  const offline = state === 'offline';
  const preview = state === 'preview';
  return (
    <View style={styles.overlay} accessibilityRole="alert" accessibilityLabel={preview ? 'Preview: server not connected' : offline ? 'You are offline' : 'Reconnecting'}>
      <View style={styles.center}>
        <View style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={[styles.ring, { opacity: ringOpacity, transform: [{ scale: ring }] }]} />
          <Logo size={56} />
        </View>
        <Txt style={styles.title}>{preview ? 'Preview of Oliskey Alpha' : offline ? 'You’re offline' : 'Reconnecting…'}</Txt>
        <Txt style={styles.body}>
          {preview ? 'This is a look at the screens. Live prices, sign-in and trading turn on once the server is connected.' : offline
            ? 'Live prices and trading are paused. Everything resumes by itself when you are back online.'
            : 'Getting live prices again. Trading resumes the moment the connection is back.'}
        </Txt>
        <View style={[styles.note, glass('regular', { shadow: false })]}>
          <Lock size={14} color={colors.muted} />
          <Txt style={{ fontSize: 12, color: colors.muted }}>{preview ? 'No real or demo trades can be placed here' : 'Open trades keep running safely on the server'}</Txt>
        </View>
      </View>
    </View>
  );
}

export function OfflineBanner() {
  const state = useConnection();
  const insets = useSafeAreaInsets();
  const show = state === 'offline' || state === 'preview';
  const [h] = useState(() => new Animated.Value(show ? 1 : 0));
  useEffect(() => {
    Animated.timing(h, { toValue: show ? 1 : 0, duration: prefersReducedMotion() ? 0 : 280, easing: Easing.bezier(0.32, 0.72, 0, 1), useNativeDriver: false }).start();
  }, [show, h]);
  const full = 30 + insets.top;
  return (
    <Animated.View style={[styles.strip, { height: h.interpolate({ inputRange: [0, 1], outputRange: [0, full] }), paddingTop: insets.top }]} accessibilityRole="alert">
      <CloudOff size={14} color={colors.demo} />
      <Txt style={{ fontSize: 12, fontFamily: font.semibold }}>{state === 'preview' ? 'Preview' : 'Offline'}</Txt>
      <Txt style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>{state === 'preview' ? 'server not connected' : 'showing what was already loaded'}</Txt>
    </Animated.View>
  );
}

const styles = createStyles(() => ({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: veil.scrim, alignItems: 'center', justifyContent: 'center', zIndex: 30 },
  center: { alignItems: 'center', gap: 10, paddingHorizontal: 28, maxWidth: 380 },
  ring: { position: 'absolute', width: 72, height: 72, borderRadius: 22, borderWidth: 2, borderColor: colors.primaryFrom },
  title: { fontSize: 19, fontFamily: font.bold, marginTop: 6 },
  body: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, marginTop: 6 },
  noteWrap: { position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center', zIndex: 30, paddingHorizontal: 16 },
  notePill: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, maxWidth: 440 },
  strip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden', backgroundColor: colors.surface2 },
}));
