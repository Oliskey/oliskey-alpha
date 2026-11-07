// Result toast that slides in from the top (win: green border, loss: red border).
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, createStyles } from '@/theme';
import { Txt } from './Txt';

type ToastData = { title: string; message?: string; tone?: 'up' | 'down' | 'neutral' };
const ToastContext = createContext<(t: ToastData) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastData | null>(null);
  const [y] = useState(() => new Animated.Value(-140));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((t: ToastData) => {
    setToast(t);
    clearTimeout(timer.current);
    Animated.spring(y, { toValue: 0, damping: 18, useNativeDriver: Platform.OS !== 'web' }).start();
    timer.current = setTimeout(() => {
      Animated.timing(y, { toValue: -140, duration: 250, useNativeDriver: Platform.OS !== 'web' }).start();
    }, 2600);
  }, [y]);

  const border = toast?.tone === 'up' ? colors.up : toast?.tone === 'down' ? colors.down : colors.border;
  return (
    <ToastContext.Provider value={show}>
      {children}
      <Animated.View pointerEvents="none" style={[styles.wrap, { top: insets.top + 8, transform: [{ translateY: y }] }]}>
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
  toast: { maxWidth: 480, width: '100%', backgroundColor: colors.surface, borderWidth: 1, borderRadius: radius.card, padding: 14, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
  title: { fontSize: 18, fontFamily: font.bold, fontVariant: ['tabular-nums'] },
  message: { color: colors.muted, fontSize: 13, marginTop: 2 },
}));
