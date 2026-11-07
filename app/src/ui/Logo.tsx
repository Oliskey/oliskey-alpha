// Placeholder Oliskey Alpha mark (gradient circle with "α") until the real logo is supplied.
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { font, gradient } from '@/theme';
import { Txt } from './Txt';

export function Logo({ size = 64, withName }: { size?: number; withName?: boolean }) {
  return (
    <View style={{ alignItems: 'center', gap: 12 }}>
      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
        <Txt style={{ color: '#FFFFFF', fontFamily: font.bold, fontSize: size * 0.55, lineHeight: size * 0.7 }}>α</Txt>
      </LinearGradient>
      {withName ? <Txt style={{ fontFamily: font.bold, fontSize: 26 }}>Oliskey Alpha</Txt> : null}
    </View>
  );
}
