// Pressable with the app's feedback. Mouse over: grows 2% with a soft tint (large rows and cards only tint, because
// large things growing looks clumsy). Press: a quick 0.96 scale (~120 ms) and a light dim, no wobble; light haptic tap
// on native. Reduced motion: no scale, only the tint and dim.
import { useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { isLight, veil } from '@/theme';
import { EASE, MOTION } from './motion';
import { applyBend } from './liquid';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const native = Platform.OS !== 'web';
let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduceMotion = v; }).catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => { reduceMotion = v; });
/** True when the user asked the system for reduced motion (shared by every animated component). */
export const prefersReducedMotion = () => reduceMotion;

const MIN_TAP = 44;
const LARGE_H = 64;     // rows and cards from here up tint on hover instead of growing
const LARGE_W = 420;
const EASE_OUT = EASE.respond;

type Props = Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; haptic?: boolean; hoverable?: boolean; cursor?: 'pointer' | 'grab'; still?: boolean };   // still: no change in size or dim on press

export function Press({ style, haptic = true, hoverable = true, cursor = 'pointer', still = false, onPressIn, onPressOut, onPress, onHoverIn, onHoverOut, disabled, children, ...rest }: Props) {
  const [scale] = useState(() => new Animated.Value(1));
  const [opacity] = useState(() => new Animated.Value(1));
  const [tint] = useState(() => new Animated.Value(0));
  // small controls keep their look but get a 44 px tap area: invisible extension on web, hitSlop on phones
  const [reach, setReach] = useState({ x: 0, y: 0 });
  const large = useRef(false);
  const hovered = useRef(false);
  const pressed = useRef(false);
  // one place decides the size, so press and hover can overlap and it always settles on the right value
  const settle = () => {
    if (still) return;
    const target = reduceMotion ? 1 : pressed.current ? MOTION.pressScale : hovered.current && !large.current ? MOTION.hoverScale : 1;
    const duration = pressed.current ? MOTION.pressMs : MOTION.hoverMs;
    Animated.parallel([
      Animated.timing(scale, { toValue: target, duration, easing: EASE_OUT, useNativeDriver: native }),
      Animated.timing(opacity, { toValue: pressed.current ? 0.9 : 1, duration, easing: EASE_OUT, useNativeDriver: native }),
    ]).start();
  };
  const hover = (on: boolean) => {
    hovered.current = on;
    settle();
    Animated.timing(tint, { toValue: on ? 1 : 0, duration: MOTION.hoverMs, easing: EASE_OUT, useNativeDriver: native }).start();
  };
  const flat = StyleSheet.flatten(style) as (ViewStyle & { backdropFilter?: string }) | undefined;
  const radius = flat?.borderRadius;
  const node = useRef<unknown>(null);

  return (
    <AnimatedPressable
      {...rest}
      ref={node as never}
      hitSlop={rest.hitSlop ?? (reach.x || reach.y ? { left: reach.x, right: reach.x, top: reach.y, bottom: reach.y } : undefined)}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        // plain rows have no fill of their own; filled and glass buttons of the same width still grow
        large.current = height >= LARGE_H || width >= LARGE_W || (width >= 260 && !flat?.backgroundColor);
        // +1 covers a control's border, which the extension is measured inside
        const x = width < MIN_TAP ? Math.ceil((MIN_TAP - width) / 2) + 1 : 0, y = height < MIN_TAP ? Math.ceil((MIN_TAP - height) / 2) + 1 : 0;
        setReach((r) => (r.x === x && r.y === y ? r : { x, y }));
        // a glass button bends what is behind it (web); solid buttons have no backdrop filter and are left alone
        const el = node.current as HTMLElement | null;
        if (Platform.OS === 'web' && flat?.backdropFilter && el?.style) applyBend(el, { radius: typeof radius === 'number' ? radius : 12, tone: isLight() ? 'light' : 'dark', floating: false });
        rest.onLayout?.(e);
      }}
      disabled={disabled}
      style={[style, { transform: [{ scale }], opacity: disabled ? 0.45 : opacity }, Platform.OS === 'web' && !disabled ? ({ cursor } as object) : null]}
      onHoverIn={(e) => { if (!disabled && hoverable) hover(true); onHoverIn?.(e); }}
      onHoverOut={(e) => { if (hoverable) hover(false); onHoverOut?.(e); }}
      onPressIn={(e) => { pressed.current = true; settle(); onPressIn?.(e); }}
      onPressOut={(e) => { pressed.current = false; settle(); onPressOut?.(e); }}
      onPress={(e) => {
        if (haptic && native) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
    >
      {typeof children === 'function' ? children : (
        <>
          {Platform.OS === 'web' && (reach.x || reach.y) ? <View testID="tap-area" style={{ position: 'absolute', left: -reach.x, right: -reach.x, top: -reach.y, bottom: -reach.y }} /> : null}
          {Platform.OS === 'web' ? <Animated.View testID="hover-tint" pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: radius ?? 12, backgroundColor: veil.hover, opacity: tint }} /> : null}
          {children}
        </>
      )}
    </AnimatedPressable>
  );
}
