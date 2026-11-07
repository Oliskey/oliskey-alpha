// Round glass icon button (back, close, bell, wallet, chart zoom). Always has an accessible name and a 40-44 px target.
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { glass } from './glass';
import { Press } from './Press';

export function IconButton({ label, onPress, children, size = 44, style, haptic }: {
  label: string; onPress?: () => void; children: ReactNode; size?: number;
  style?: StyleProp<ViewStyle>; haptic?: boolean;
}) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={label} haptic={haptic} hitSlop={size < 44 ? (44 - size) / 2 : 0}
      style={[{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }, glass(), style]}>
      {children}
    </Press>
  );
}
