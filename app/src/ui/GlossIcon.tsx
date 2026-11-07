// A colourful icon tile for feature shortcuts, with a white icon. White mode: sharp, nearly flat colour and a fine top
// highlight. Dark mode: a richer gradient and a soft shine.
import type { LucideIcon } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';
import { isLight } from '@/theme';

export const GLOSS = {
  violet: ['#9B7BFF', '#4D30E6'], blue: ['#5AC0FF', '#1B6BE8'], teal: ['#3BE0C4', '#0A8F86'],
  pink: ['#FF8AC8', '#D02A86'], amber: ['#FFCF5C', '#E5840F'],
} as const;
const SHARP = {
  violet: ['#6A3DFF', '#5126F0'], blue: ['#1683FF', '#0066E0'], teal: ['#00A392', '#008A7C'],
  pink: ['#F01884', '#D1006C'], amber: ['#FF9500', '#E97F00'],
} as const;

export function GlossIcon({ icon: Icon, color = 'violet', size = 56 }: { icon: LucideIcon; color?: keyof typeof GLOSS; size?: number }) {
  const radius = Math.round(size * 0.32);
  const light = isLight();
  return (
    <LinearGradient colors={(light ? SHARP : GLOSS)[color]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
      style={{ width: size, height: size, borderRadius: radius, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {light
        ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: radius * 2, borderTopLeftRadius: radius, borderTopRightRadius: radius, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.4)' }} />
        : <View pointerEvents="none" style={{ position: 'absolute', top: 2, left: 3, right: 3, height: size * 0.42, borderRadius: radius, backgroundColor: 'rgba(255,255,255,0.28)' }} />}
      <Icon size={Math.round(size * 0.5)} color="#FFFFFF" strokeWidth={2.25} />
    </LinearGradient>
  );
}
