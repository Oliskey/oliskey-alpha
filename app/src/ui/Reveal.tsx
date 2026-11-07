// Shows or hides content with a smooth height + fade (the app's glide curve). The content is measured off-screen,
// so it works with any height. Reduced motion: no slide, it just appears.
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';
import { prefersReducedMotion } from './Press';

export function Reveal({ show, children, style }: { show: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const [p] = useState(() => new Animated.Value(show ? 1 : 0));
  const [h, setH] = useState(0);
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) setMounted(true);
    const anim = Animated.timing(p, {
      toValue: show ? 1 : 0, duration: prefersReducedMotion() ? 0 : show ? 300 : 200,
      easing: Easing.bezier(0.32, 0.72, 0, 1), useNativeDriver: false,
    });
    anim.start(({ finished }) => { if (finished && !show) setMounted(false); });
    return () => anim.stop();
  }, [show, p]);
  if (!mounted) return null;
  return (
    <Animated.View style={[{ overflow: 'hidden', height: h ? p.interpolate({ inputRange: [0, 1], outputRange: [0, h] }) : undefined, opacity: p }, style]}>
      <View onLayout={(e) => setH(e.nativeEvent.layout.height)} style={h ? { position: 'absolute', left: 0, right: 0, top: 0 } : null}>
        {children}
      </View>
    </Animated.View>
  );
}
