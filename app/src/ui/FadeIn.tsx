// Content that arrives later than its frame (loaded data replacing a loader, a page coming into view) fades in while
// rising a few pixels, so it never pops. `rise` 0 = fade only. Reduced motion: a plain fade.
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { EASE, MOTION } from './motion';
import { prefersReducedMotion } from './Press';

export function FadeIn({ children, rise = 6, duration = MOTION.enterMs, style, replay }: {
  children: ReactNode; rise?: number; duration?: number; style?: StyleProp<ViewStyle>;
  replay?: unknown;   // changing it plays the entrance again (e.g. each time a page comes into view)
}) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration, easing: EASE.glide, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [replay, v, duration]);
  const lift = prefersReducedMotion() ? 0 : rise;
  return (
    <Animated.View style={[{ flex: 1, opacity: v, transform: lift ? [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [lift, 0] }) }] : [] }, style]}>
      {children}
    </Animated.View>
  );
}
