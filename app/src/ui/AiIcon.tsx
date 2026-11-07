// The app's one mark for AI, drawn for Oliskey Alpha: the letters A and I in clean strokes. Owner decision 2026-11-06: stock
// sparkles and robots were rejected, and it had to be simple and unique. Everything about the AI uses this, so one edit here changes it
// everywhere. It takes the same size and colour props as the app's other icons.
import Svg, { Path } from 'react-native-svg';

export function AiIcon({ size = 24, color = 'currentColor', strokeWidth = 2.6 }: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M2.5 19.5 9 4.5l6.5 15" />
      <Path d="M5 14h8" />
      <Path d="M20.5 4.5v15" />
    </Svg>
  );
}
