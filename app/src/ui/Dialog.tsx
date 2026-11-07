// Centred confirm dialog: card width 300, radius 18, title 17/500, right-aligned text actions.
import { Platform, Modal, Pressable, View } from 'react-native';
import { colors, font, radius, createStyles, veil, isLight } from '@/theme';
import { Txt } from './Txt';

type Action = { label: string; onPress: () => void; color?: string };

export function Dialog({ open, title, body, actions, onClose }: {
  open: boolean; title: string; body?: string; actions: Action[]; onClose: () => void;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Txt style={styles.title}>{title}</Txt>
          {body ? <Txt style={styles.body}>{body}</Txt> : null}
          <View style={styles.actions}>
            {actions.map((a) => (
              <Pressable key={a.label} onPress={a.onPress} hitSlop={8} accessibilityRole="button">
                <Txt style={[styles.action, { color: a.color ?? colors.accent }]}>{a.label}</Txt>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = createStyles(() => ({
  backdrop: { flex: 1, backgroundColor: veil.backdrop, alignItems: 'center', justifyContent: 'center' },
  card: { width: 300, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.dialog, padding: 22,
    ...(Platform.OS === 'web' ? ({ boxShadow: isLight() ? '0 16px 48px rgba(0,0,0,0.16)' : 'inset 0 1px 0 rgba(255,255,255,0.16), 0 24px 60px rgba(0,0,0,0.7)' } as object) : null) },
  title: { fontSize: 17, fontFamily: font.medium },
  body: { color: colors.muted, marginTop: 8, fontSize: 14 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 28, marginTop: 26 },
  action: { fontSize: 16, fontFamily: font.bold },
}));
