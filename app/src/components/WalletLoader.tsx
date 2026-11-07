// Loading state for money screens: bobbing wallet illustration + cross-fading status text.
import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import { Wallet } from 'lucide-react-native';
import { colors } from '@/theme';
import { Txt } from '@/ui/Txt';

const MESSAGES = ['Loading payment methods...', 'Setting up a secure connection...'];

export function WalletLoader() {
  const [y] = useState(() => new Animated.Value(0));
  const [i, setI] = useState(0);
  useEffect(() => {
    const native = Platform.OS !== 'web';
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(y, { toValue: -6, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: native }),
      Animated.timing(y, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: native }),
    ]));
    loop.start();
    const id = setInterval(() => setI((v) => (v + 1) % MESSAGES.length), 1400);
    return () => { loop.stop(); clearInterval(id); };
  }, [y]);
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 60, flex: 1 }}>
      <Animated.View style={{ transform: [{ translateY: y }] }}>
        <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' }}>
          <Wallet size={32} color={colors.dark} />
        </View>
      </Animated.View>
      <Txt style={{ color: colors.muted, fontSize: 15 }}>{MESSAGES[i]}</Txt>
    </View>
  );
}
