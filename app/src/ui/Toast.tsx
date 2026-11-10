// Banner that drops in from the top (win: green border, loss: red border). It eases in while fading, stays long
// enough to read, and fades up and away. No spring: a bouncing banner looks unsure. Reduced motion: fade only.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, createStyles, isLight } from '@/theme';
import { EASE, MOTION } from './motion';
import { prefersReducedMotion } from './Press';
import { Txt } from './Txt';

type ToastData = { title: string; message?: string; tone?: 'up' | 'down' | 'neutral' };
const ToastContext = createContext<(t: ToastData) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastData | null>(null);
  const [v] = useState(() => new Animated.Value(0));   // 0 hidden, 1 shown
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((t: ToastData) => {
    setToast(t);
    clearTimeout(timer.current);
    const nd = Platform.OS !== 'web';
    Animated.timing(v, { toValue: 1, duration: MOTION.toastInMs, easing: EASE.glide, useNativeDriver: nd }).start();
    timer.current = setTimeout(() => {
      Animated.timing(v, { toValue: 0, duration: MOTION.toastOutMs, easing: EASE.exit, useNativeDriver: nd }).start();
    }, MOTION.toastHoldMs + Math.min(2000, ((t.message?.length ?? 0) + t.title.length) * 25));   // longer text stays longer
  }, [v]);
  const y = v.interpolate({ inputRange: [0, 1], outputRange: [prefersReducedMotion() ? 0 : -24, 0] });

  const border = toast?.tone === 'up' ? colors.up : toast?.tone === 'down' ? colors.down : colors.border;
  return (
    <ToastContext.Provider value={show}>
      {children}
      <Animated.View pointerEvents="none" style={[styles.wrap, { top: insets.top + 8, transform: [{ translateY: y }], opacity: v }]}>
        {toast ? (
          <View style={[styles.toast, { borderColor: border }]}>
            <Txt style={[styles.title, toast.tone === 'up' && { color: colors.up }, toast.tone === 'down' && { color: colors.down }]}>{toast.title}</Txt>
            {toast.message ? <Txt style={styles.message}>{toast.message}</Txt> : null}
          </View>
        ) : null}
      </Animated.View>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

const styles = createStyles(() => ({
  wrap: { position: 'absolute', left: 14, right: 14, alignItems: 'center' },
  toast: { maxWidth: 480, width: '100%', backgroundColor: colors.surface, borderWidth: 1, borderRadius: radius.card, padding: 14, shadowColor: '#000', shadowOpacity: isLight() ? 0.14 : 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
  title: { fontSize: 18, fontFamily: font.bold, fontVariant: ['tabular-nums'] },
  message: { color: colors.muted, fontSize: 13, marginTop: 2 },
}));
