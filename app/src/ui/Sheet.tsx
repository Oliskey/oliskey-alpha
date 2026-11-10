// Bottom sheet: top radius 22, grab handle, dimmed backdrop, swipe down or tap the backdrop to close.
// Motion (ui/motion.ts): glides up and stops without overshoot (an overshooting sheet reads as wobbly), leaves faster
// than it came, and a released drag eases to the nearest stop. Reduced motion: it fades instead of sliding.
//
// `half` (owner 2026-11-10, long lists and details): the sheet first stops with its top at the middle of the screen, so
// what is behind stays visible. Dragging the handle up, or scrolling the content (finger or mouse wheel), takes it to
// 90% first; once there the content scrolls. Dragging down goes back to the middle, then closes.
// Short sheets keep their own height and have one stop.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Dimensions, Modal, PanResponder, Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, createStyles, veil, isLight } from '@/theme';
import { EASE, MOTION } from './motion';
import { prefersReducedMotion } from './Press';

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  fullHeight?: boolean;
  half?: boolean;
  maxHeight?: number | `${number}%`;
  style?: ViewStyle;
};

const native = Platform.OS !== 'web';
const TALL = 0.9;   // the open-wide stop: 90% of the screen
const MID = 0.5;    // the first stop of a `half` sheet: its top at the middle

export function Sheet({ open, onClose, children, fullHeight, half, maxHeight = '90%', style }: Props) {
  const insets = useSafeAreaInsets();
  const height = Dimensions.get('window').height;
  const sheetH = Math.round(height * TALL);
  const midY = half ? sheetH - Math.round(height * MID) : 0;   // how far down the 90% sheet sits at the middle stop
  const [y] = useState(() => new Animated.Value(height));
  const [backdrop] = useState(() => new Animated.Value(0));
  const [visible, setVisible] = useState(open);
  const at = useRef(0);               // where it rests now (translateY)
  const startY = useRef(0);
  const node = useRef<View>(null);

  const go = (to: number, ms: number = MOTION.sheetSnapMs) => {
    at.current = to;
    Animated.timing(y, { toValue: to, duration: prefersReducedMotion() ? 0 : ms, easing: EASE.glide, useNativeDriver: native }).start();
  };

  useEffect(() => {
    if (open) {
      setVisible(true);
      const still = prefersReducedMotion();
      const to = half ? midY : 0;
      at.current = to;
      if (still) y.setValue(to);
      Animated.parallel([
        Animated.timing(y, { toValue: to, duration: still ? 0 : MOTION.sheetInMs, easing: EASE.glide, useNativeDriver: native }),
        Animated.timing(backdrop, { toValue: 1, duration: still ? MOTION.fadeMs : MOTION.sheetInMs * 0.7, easing: EASE.standard, useNativeDriver: native }),
      ]).start();
    } else if (visible) {
      const still = prefersReducedMotion();
      Animated.parallel([
        Animated.timing(y, { toValue: still ? at.current : height, duration: still ? 0 : MOTION.sheetOutMs, easing: EASE.exit, useNativeDriver: native }),
        Animated.timing(backdrop, { toValue: 0, duration: MOTION.sheetOutMs, easing: EASE.standard, useNativeDriver: native }),
      ]).start(() => setVisible(false));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where a released drag settles: a quick flick decides by its direction, a slow one by the nearest stop.
  const release = (dy: number, vy: number) => {
    const pos = startY.current + dy;
    if (!half) {
      if (dy > 120 || vy > 1) onClose();
      else go(0);
      return;
    }
    if (vy < -0.5) return go(0);
    if (vy > 0.5) return startY.current < midY / 2 ? go(midY) : onClose();
    if (pos > midY + (sheetH - midY) * 0.35) return onClose();
    go(pos < midY / 2 ? 0 : midY);
  };
  const follow = (dy: number) => {
    const pos = startY.current + dy;
    y.setValue(pos < 0 ? pos / 4 : pos);   // a little give past the top, never a hard stop
  };

  const handlePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
    onPanResponderGrant: () => { y.stopAnimation(); startY.current = at.current; },
    onPanResponderMove: (_e, g) => follow(g.dy),
    onPanResponderRelease: (_e, g) => release(g.dy, g.vy),
    onPanResponderTerminate: (_e, g) => release(g.dy, g.vy),
  })).current;
  // At the middle stop, an upward swipe on the content grows the sheet first instead of scrolling the list.
  const bodyPan = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_e, g) => !!half && at.current > 0 && g.dy < -8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => { y.stopAnimation(); startY.current = at.current; },
    onPanResponderMove: (_e, g) => follow(g.dy),
    onPanResponderRelease: (_e, g) => release(g.dy, g.vy),
    onPanResponderTerminate: (_e, g) => release(g.dy, g.vy),
  })).current;

  // Mouse wheel (web): at the middle stop, scrolling down grows the sheet first.
  useEffect(() => {
    if (!half || !visible || Platform.OS !== 'web') return;
    const el = node.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    const wheel = (e: WheelEvent) => {
      if (at.current > 0 && e.deltaY > 0) { e.preventDefault(); go(0); }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [half, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: veil.backdrop, opacity: backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <View style={styles.anchor} pointerEvents="box-none">
        <Animated.View
          ref={node as never}
          {...(half ? bodyPan.panHandlers : null)}
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + 14, transform: [{ translateY: y }] },
            prefersReducedMotion() ? { opacity: backdrop } : null,
            half ? { height: sheetH } : fullHeight ? { height: '94%' } : { maxHeight },
            style,
          ]}
        >
          <View {...handlePan.panHandlers} style={styles.handleArea} accessibilityLabel={half ? 'Drag to resize or close' : 'Drag down to close'}>
            <View style={styles.handle} />
          </View>
          {half ? <View style={{ flex: 1, minHeight: 0 }}>{children}</View> : children}
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
  handleArea: { alignItems: 'center', paddingTop: 8, paddingBottom: 10, ...(Platform.OS === 'web' ? ({ cursor: 'grab', touchAction: 'none' } as object) : null) },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.muted },
}));
