// The person's avatar: the Oliskey Alpha mascot in a violet ring (Home, Terminal, Profile), with the number of unread
// notifications on it when there are any.
import { View } from 'react-native';
import { Mascot } from '@/components/Mascot';
import { colors, font } from '@/theme';
import { Txt } from './Txt';

export function Avatar({ size = 44, badge }: { size?: number; badge?: number }) {
  const ring = Math.max(2, Math.round(size / 30));
  const badgeSize = Math.max(16, Math.round(size * 0.42));
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: ring, borderColor: colors.accent, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <Mascot size={Math.round(size * 0.9)} glow={false} pose="face" />
      </View>
      {badge ? (
        <View style={{ position: 'absolute', top: -4, right: -4, minWidth: badgeSize, height: badgeSize, borderRadius: badgeSize / 2, paddingHorizontal: 3, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.bg, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={`${badge} unread notifications`}>
          <Txt style={{ fontSize: Math.round(badgeSize * 0.55), fontFamily: font.bold, color: colors.dark }}>{badge > 99 ? '99+' : badge}</Txt>
        </View>
      ) : null}
    </View>
  );
}
