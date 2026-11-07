// Bottom sheet: top radius 20, grab handle, 60% black backdrop, spring open, swipe down or tap backdrop to close.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Dimensions, Modal, PanResponder, Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, createStyles, veil, isLight } from '@/theme';

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  fullHeight?: boolean;
  maxHeight?: number | `${number}%`;
  style?: ViewStyle;
};

const native = Platform.OS !== 'web';

export function Sheet({ open, onClose, children, fullHeight, maxHeight = '90%', style }: Props) {
  const insets = useSafeAreaInsets();
  const height = Dimensions.get('window').height;
  const [y] = useState(() => new Animated.Value(height));
  const [backdrop] = useState(() => new Animated.Value(0));
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (open) {
      setVisible(true);
      Animated.parallel([
        Animated.spring(y, { toValue: 0, damping: 20, stiffness: 180, useNativeDriver: native }),
        Animated.timing(backdrop, { toValue: 1, duration: 300, useNativeDriver: native }),
      ]).start();
    } else if (visible) {
      Animated.parallel([
        Animated.timing(y, { toValue: height, duration: 250, useNativeDriver: native }),
        Animated.timing(backdrop, { toValue: 0, duration: 250, useNativeDriver: native }),
      ]).start(() => setVisible(false));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_e, g) => { if (g.dy > 0) y.setValue(g.dy); },
    onPanResponderRelease: (_e, g) => {
      if (g.dy > 120 || g.vy > 1) onClose();
      else Animated.spring(y, { toValue: 0, damping: 20, useNativeDriver: native }).start();
    },
  })).current;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: veil.backdrop, opacity: backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <View style={styles.anchor} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + 14, transform: [{ translateY: y }] },
            fullHeight ? { height: '94%' } : { maxHeight },
            style,
          ]}
        >
          <View {...pan.panHandlers} style={styles.handleArea}>
            <View style={styles.handle} />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = createStyles(() => ({
  anchor: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%', maxWidth: 520, backgroundColor: colors.surface, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border,
    ...(Platform.OS === 'web' ? ({ boxShadow: isLight() ? '0 -8px 32px rgba(0,0,0,0.12)' : 'inset 0 1px 0 rgba(255,255,255,0.16), 0 -12px 40px rgba(0,0,0,0.6)' } as object) : null),
    borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
  },
  handleArea: { alignItems: 'center', paddingTop: 8, paddingBottom: 10 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.muted },
}));
