import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, type, createStyles, isLight } from '@/theme';
import { glass, glassEdge } from './glass';
import { Press } from './Press';
import { Txt } from './Txt';

type Variant = 'primary' | 'secondary' | 'up' | 'down';

// Capsules. primary = the one main action with the glass edge (white with black text in dark mode, violet with white text
// in white mode); secondary = glass;
// up / down = solid trading colours with the glass edge (colour stays solid for contrast).
const FILL = (): Record<Variant, { bg: string; fg: string; border: string }> => ({
  primary: isLight() ? { bg: colors.primaryFrom, fg: '#FFFFFF', border: 'transparent' } : { bg: colors.text, fg: colors.dark, border: colors.text },
  secondary: { bg: colors.surface2, fg: colors.text, border: colors.border },
  up: { bg: colors.up, fg: colors.dark, border: colors.up },
  down: { bg: colors.down, fg: colors.dark, border: colors.down },
});

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  height?: number;
  icon?: ReactNode;          // shown after the label
  iconLeft?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textColor?: string;
  spread?: boolean;          // label left, icon right (Up/Down buttons)
};

export function Button({ label, onPress, variant = 'primary', height = 48, icon, iconLeft, disabled, loading, style, textColor, spread }: Props) {
  const f = FILL()[variant];
  const gradientFill = variant === 'primary' && isLight();   // white mode: violet with a slight same-colour shift
  const fg = textColor ?? f.fg;
  return (
    <Press
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.base, { height, borderRadius: height / 2 },
        variant === 'secondary' ? glass('regular', { shadow: false }) : [{ backgroundColor: f.bg, borderColor: f.border }, glassEdge(variant === 'primary')],
        style]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {gradientFill ? <LinearGradient colors={[colors.primaryFrom, colors.primaryTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: height / 2 }} /> : null}
      <View style={[styles.row, { justifyContent: spread ? 'space-between' : 'center', paddingHorizontal: spread ? 22 : 18 }]}>
        {loading ? <ActivityIndicator color={fg} /> : (
          <>
            {iconLeft}
            <Txt style={[type.button, { color: fg }, variant === 'up' || variant === 'down' ? { fontSize: 18, letterSpacing: -0.2 } : null]}>{label}</Txt>
            {icon}
          </>
        )}
      </View>
    </Press>
  );
}

const styles = createStyles(() => ({
  base: { borderWidth: 1, overflow: 'hidden', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
}));
