import { Text, type TextProps } from 'react-native';
import { colors, font } from '@/theme';

// Text with the app font and colour as defaults.
export function Txt({ style, ...props }: TextProps) {
  return <Text {...props} style={[{ color: colors.text, fontFamily: font.regular, fontSize: 15 }, style]} />;
}
