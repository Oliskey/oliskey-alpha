// Grouped list pieces for settings-style screens (Profile, Help): a titled card of rows. Each row has an icon tile,
// a title, one line of description, an optional status, and a chevron when it opens or navigates.
import { useState, type ComponentType, type ReactNode } from 'react';
import { View } from 'react-native';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react-native';
import { card, colors, font, tint } from '@/theme';
import { Chip } from './kit';
import { Press } from './Press';
import { Txt } from './Txt';

// Details on request: nothing extra shows until someone asks for it.
export function More({ label = 'Details', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ alignSelf: 'flex-start' }}><Chip label={label} open={open} onPress={() => setOpen((v) => !v)} /></View>
      {open ? <View style={{ gap: 10 }}>{children}</View> : null}
    </View>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Txt style={{ fontSize: 13, fontFamily: font.semibold, color: colors.muted, paddingHorizontal: 4 }}>{title}</Txt>
      <View style={[card, { overflow: 'hidden' }]}>{children}</View>
    </View>
  );
}

export function Row({ icon: Icon, title, subtitle, right, tone, onPress, open, children, last }: {
  icon: LucideIcon | ComponentType<{ size?: number; color?: string }>; title: string; subtitle?: string; right?: ReactNode; tone?: string;
  onPress?: () => void; open?: boolean; children?: ReactNode; last?: boolean;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  const t = tint(title);
  return (
    <View style={!last ? { borderBottomWidth: 1, borderColor: colors.border } : null}>
      <Press onPress={onPress} haptic={false} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 14 }}
        accessibilityRole="button" accessibilityLabel={title}>
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={18} color={tone ?? t.fg} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt style={{ fontSize: 15, fontFamily: font.semibold, color: tone ?? colors.text }}>{title}</Txt>
          {subtitle ? <Txt style={{ fontSize: 13, color: colors.muted }} numberOfLines={2}>{subtitle}</Txt> : null}
        </View>
        {right}
        {onPress ? <Chevron size={18} color={colors.faint} /> : null}
      </Press>
      {open && children ? <View style={{ paddingHorizontal: 14, paddingBottom: 16, gap: 12 }}>{children}</View> : null}
    </View>
  );
}
