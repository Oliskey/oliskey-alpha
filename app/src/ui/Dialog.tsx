// Centred confirm dialog: card width 300, radius 18, title 17/500, right-aligned text actions.
// Motion: the backdrop fades while the card grows from 96% and fades in; it leaves a little faster. Reduced motion: fade only.
import { useEffect, useState } from 'react';
import { Animated, Platform, Modal, Pressable, View } from 'react-native';
import { colors, font, radius, createStyles, veil, isLight } from '@/theme';
import { EASE, MOTION } from './motion';
import { prefersReducedMotion } from './Press';
import { Txt } from './Txt';

type Action = { label: string; onPress: () => void; color?: string };
const nd = Platform.OS !== 'web';

export function Dialog({ open, title, body, actions, onClose }: {
  open: boolean; title: string; body?: string; actions: Action[]; onClose: () => void;
}) {
  const [v] = useState(() => new Animated.Value(0));
  const [visible, setVisible] = useState(open);
  useEffect(() => {
    if (open) {
      setVisible(true);
      Animated.timing(v, { toValue: 1, duration: MOTION.dialogInMs, easing: EASE.glide, useNativeDriver: nd }).start();
    } else if (visible) {
      Animated.timing(v, { toValue: 0, duration: MOTION.dialogOutMs, easing: EASE.exit, useNativeDriver: nd }).start(() => setVisible(false));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [prefersReducedMotion() ? 1 : 0.96, 1] });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: v }]}>
        <Pressable style={styles.fill} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View style={[styles.card, { opacity: v, transform: [{ scale }] }]} accessibilityRole="alert">
          <Txt style={styles.title}>{title}</Txt>
          {body ? <Txt style={styles.body}>{body}</Txt> : null}
          <View style={styles.actions}>
            {actions.map((a) => (
              <Pressable key={a.label} onPress={a.onPress} hitSlop={8} accessibilityRole="button">
                <Txt style={[styles.action, { color: a.color ?? colors.accent }]}>{a.label}</Txt>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = createStyles(() => ({
  backdrop: { flex: 1, backgroundColor: veil.backdrop, alignItems: 'center', justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  card: { width: 300, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.dialog, padding: 22,
    ...(Platform.OS === 'web' ? ({ boxShadow: isLight() ? '0 16px 48px rgba(0,0,0,0.16)' : 'inset 0 1px 0 rgba(255,255,255,0.16), 0 24px 60px rgba(0,0,0,0.7)' } as object) : null) },
  title: { fontSize: 17, fontFamily: font.medium },
  body: { color: colors.muted, marginTop: 8, fontSize: 14 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 28, marginTop: 26 },
  action: { fontSize: 16, fontFamily: font.bold },
}));
