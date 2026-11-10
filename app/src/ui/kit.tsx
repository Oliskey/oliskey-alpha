// Small shared pieces: Card, Stepper, Chip, DottedRow, EmptyState, Spinner, Skeleton, SectionHeader, Tooltip.
import { useEffect, useRef, type ReactNode, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, ScrollView, Text, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Minus, Plus } from 'lucide-react-native';
import { AiIcon } from './AiIcon';
import { card, colors, font, radius, type, createStyles, veil } from '@/theme';
import { glass, glassLens, MOTION } from './glass';
import { LiquidBox, useLiquidBend } from './liquid';
import { Press, prefersReducedMotion } from './Press';
import { Txt } from './Txt';

const useNative = Platform.OS !== 'web';

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const s = [{ ...card, padding: 14 }, style];
  return onPress ? <Press style={s} onPress={onPress}>{children}</Press> : <View style={s}>{children}</View>;
}

// A small dot while something is active, and blinking while it is also new. Reduced motion: the dot stays, no blinking.
// A live number on an icon or tab. Zero shows nothing; it never pads or invents a count.
export function CountBadge({ count, color, inline, testID }: { count: number; color?: string; inline?: boolean; testID?: string }) {
  if (count <= 0) return null;
  return (
    <View testID={testID} pointerEvents="none" style={[{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: color ?? colors.accent },
      inline ? { marginLeft: 6 } : { position: 'absolute', top: -8, right: -11, borderWidth: 1.5, borderColor: colors.bg, minWidth: 21, height: 21, borderRadius: 11 }]}>
      <Text style={{ fontSize: 11, lineHeight: 14, fontFamily: font.bold, color: colors.bg, fontVariant: ['tabular-nums'] }}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export function Blink({ on, pulse, count, children }: { on: boolean; pulse: boolean; count?: number; children: ReactNode }) {
  const [o] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!pulse || prefersReducedMotion()) { o.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 0.3, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: useNative }),
      Animated.timing(o, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: useNative }),
    ]));
    loop.start();
    return () => { loop.stop(); o.setValue(1); };
  }, [pulse, o]);
  return (
    <View>
      <Animated.View style={{ opacity: o }}>{children}</Animated.View>
      {on && count ? <CountBadge testID="signal-dot" count={count} color={colors.upVivid} /> : null}
      {on && !count ? <View testID="signal-dot" style={{ position: 'absolute', top: -2, right: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.upVivid, borderWidth: 1, borderColor: colors.bg }} /> : null}
    </View>
  );
}

// Controls that appear on hover (× on a tab, Cancel on a row). Put revealHost on the row and wrap the control in
// HoverReveal. CSS in ThemeContext shows it on hover or keyboard focus; touch screens and native always show it, and its
// space is always reserved. `always` keeps it visible, for example on the selected tab.
const webOnly = Platform.OS === 'web';
export const revealHost = (webOnly ? { dataSet: { revealHost: '1' } } : {}) as object;
export function HoverReveal({ children, always, style }: { children: ReactNode; always?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={style} {...((webOnly ? { dataSet: always ? { reveal: '1', revealOn: '1' } : { reveal: '1' } } : {}) as object)}>{children}</View>;
}

// A sideways row. A mouse cannot swipe, so on hover round arrows appear on sides that have more to see, and the edges
// fade softly. Touch screens swipe as usual. Items stay reachable by keyboard, so the arrows are mouse-only.
export function SideScroll({ children, style, fade = true, reveal, ...rest }: ScrollViewProps & { fade?: boolean; reveal?: { x: number; w: number } }) {
  const ref = useRef<{ scrollTo: (to: { x: number; animated: boolean }) => void } | null>(null);
  const size = useRef({ x: 0, w: 0, content: 0 });
  const [more, setMore] = useState({ left: false, right: false });
  const update = () => {
    const { x, w, content } = size.current;
    const next = { left: x > 2, right: x + w < content - 2 };
    setMore((m) => (m.left === next.left && m.right === next.right ? m : next));
  };
  const move = (dir: 1 | -1) => ref.current?.scrollTo({ x: Math.max(0, size.current.x + dir * size.current.w * 0.8), animated: true });
  // keep a chosen item (a selected tab) in view, e.g. when a screen opens on its last tab
  const [laidOut, setLaidOut] = useState(0);
  useEffect(() => {
    if (!reveal || !size.current.w) return;
    // only when the item is really cut off, and only as far as needed (4 = the track's inner padding)
    const { x, w } = size.current;
    const left = reveal.x + 4, right = reveal.x + 4 + reveal.w;
    if (left < x) ref.current?.scrollTo({ x: Math.max(0, left - 8), animated: true });
    else if (right > x + w + 1) ref.current?.scrollTo({ x: right - w + 8, animated: true });
  }, [reveal?.x, reveal?.w, laidOut]); // eslint-disable-line react-hooks/exhaustive-deps
  const mask = webOnly && fade && (more.left || more.right)
    ? { maskImage: `linear-gradient(to right, ${more.left ? 'transparent, #000 28px' : '#000'}, ${more.right ? '#000 calc(100% - 28px), transparent' : '#000'})` }
    : null;
  const arrow = (dir: 1 | -1) => (
    <View style={[styles.sideArrowBox, dir < 0 ? { left: 2 } : { right: 2 }]} {...({ dataSet: { reveal: '1', sideArrow: '1' } } as object)}>
      <Press haptic={false} focusable={false} accessibilityLabel={dir < 0 ? 'Scroll left' : 'Scroll right'} onPress={() => move(dir)} style={[styles.sideArrow, glass()]}>
        {dir < 0 ? <ChevronLeft size={18} color={colors.text} /> : <ChevronRight size={18} color={colors.text} />}
      </Press>
    </View>
  );
  return (
    <View style={{ flexShrink: 1, minWidth: 0 }} {...revealHost}>
      <ScrollView {...rest} ref={ref as never} horizontal showsHorizontalScrollIndicator={false} scrollEventThrottle={32}
        style={[style, mask as object]}
        onLayout={(e) => { size.current.w = e.nativeEvent.layout.width; setLaidOut(size.current.w); update(); rest.onLayout?.(e); }}
        onContentSizeChange={(w, h) => { size.current.content = w; update(); rest.onContentSizeChange?.(w, h); }}
        onScroll={(e) => { size.current.x = e.nativeEvent.contentOffset.x; update(); rest.onScroll?.(e); }}>
        {children}
      </ScrollView>
      {webOnly && more.left ? arrow(-1) : null}
      {webOnly && more.right ? arrow(1) : null}
    </View>
  );
}

// A row of filter buttons or chips: one line that moves sideways when it does not fit, never wrapped onto a second line.
export function ChipRow({ children, center }: { children: ReactNode; center?: boolean }) {
  return (
    <SideScroll style={{ flexGrow: 0 }}
      contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexGrow: center ? 1 : 0, justifyContent: center ? 'center' : 'flex-start' }}>
      {children}
    </SideScroll>
  );
}

// The app's on/off switch, in the liquid style: a vivid track and a white pill knob, wider than tall. While pressed or
// sliding the knob turns into a clear glass drop that grows past the track, then settles back to white. No wobble.
// Reduced motion: the knob moves and the colour changes, with no glass and no stretch.
const SWITCH = { w: 58, h: 28, knobW: 34, knobH: 22, inset: 3, tap: 44 } as const;
const SWITCH_EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

export function Toggle({ value, onValueChange, disabled, accessibilityLabel }: {
  value: boolean; onValueChange?: (next: boolean) => void; disabled?: boolean; accessibilityLabel?: string;
}) {
  const [pos] = useState(() => new Animated.Value(value ? 1 : 0));   // 0 off, 1 on
  const [drop] = useState(() => new Animated.Value(0));              // 0 white knob, 1 glass drop
  const [hover] = useState(() => new Animated.Value(0));
  const held = useRef(false);
  const seen = useRef(value);
  const toDrop = (to: number, duration: number, delay = 0) =>
    Animated.timing(drop, { toValue: prefersReducedMotion() ? 0 : to, duration, delay, easing: SWITCH_EASE, useNativeDriver: useNative });

  useEffect(() => {
    if (seen.current === value) return;
    seen.current = value;
    Animated.timing(pos, { toValue: value ? 1 : 0, duration: MOTION.glideMs, easing: SWITCH_EASE, useNativeDriver: useNative }).start();
    // keyboard and programmatic changes get the same drop as a press; it settles once the knob has arrived
    Animated.sequence([toDrop(1, 100), toDrop(held.current ? 1 : 0, 260, MOTION.glideMs - 200)]).start();
  }, [value]);

  const bend = useLiquidBend({ radius: SWITCH.knobH / 2, bezel: 7, thickness: 9 });
  const travel = SWITCH.w - SWITCH.knobW - SWITCH.inset * 2;
  const glassLayer = Platform.OS === 'web'
    ? { boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.3), inset 0 1px 1px rgba(255,255,255,0.85), inset 0 -1px 1px rgba(255,255,255,0.2), 0 0 0 0.5px rgba(0,0,0,0.12), 0 3px 10px rgba(0,0,0,0.18)', backdropFilter: 'blur(1.5px) saturate(160%)', WebkitBackdropFilter: 'blur(1.5px) saturate(160%)' } as object
    : { borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)' };
  const knobLayer = Platform.OS === 'web'
    ? { boxShadow: '0 1px 3px rgba(0,0,0,0.22), 0 0 0 0.5px rgba(0,0,0,0.06)' } as object
    : { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 };

  return (
    <Pressable
      role="switch"
      aria-checked={value}
      aria-label={accessibilityLabel}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onPress={() => {
        if (useNative) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onValueChange?.(!value);
      }}
      onPressIn={() => { held.current = true; toDrop(1, MOTION.pressMs).start(); }}
      onPressOut={() => { held.current = false; toDrop(0, 260, 180).start(); }}
      onHoverIn={() => { if (!disabled && !prefersReducedMotion()) Animated.timing(hover, { toValue: 1, duration: MOTION.hoverMs, easing: SWITCH_EASE, useNativeDriver: useNative }).start(); }}
      onHoverOut={() => { Animated.timing(hover, { toValue: 0, duration: MOTION.hoverMs, easing: SWITCH_EASE, useNativeDriver: useNative }).start(); }}
      style={{ width: SWITCH.w, height: SWITCH.tap, marginVertical: -(SWITCH.tap - SWITCH.h) / 2, justifyContent: 'center', opacity: disabled ? 0.45 : 1 }}
    >
      <Animated.View style={{ width: SWITCH.w, height: SWITCH.h, transform: [{ scale: hover.interpolate({ inputRange: [0, 1], outputRange: [1, MOTION.hoverScale] }) }] }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: SWITCH.h / 2, backgroundColor: veil.switchOff }} />
        <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: SWITCH.h / 2, backgroundColor: colors.upVivid, opacity: pos }} />
        <Animated.View testID="switch-knob" style={{
          position: 'absolute', left: SWITCH.inset, top: SWITCH.inset, width: SWITCH.knobW, height: SWITCH.knobH,
          transform: [
            { translateX: pos.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) },
            { scaleX: drop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.26] }) },
            { scaleY: drop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] }) },
          ],
        }}>
          <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: SWITCH.knobH / 2, backgroundColor: '#FFFFFF', opacity: drop.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }, knobLayer]} />
          <Animated.View ref={bend as never} style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: SWITCH.knobH / 2, backgroundColor: 'rgba(255,255,255,0.16)', opacity: drop }, glassLayer]} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

export function Stepper({ value, onMinus, onPlus, onPressValue, style, label, compact }: {
  value: string; onMinus: () => void; onPlus: () => void; onPressValue?: () => void; style?: StyleProp<ViewStyle>;
  label?: string;   // small caption above the value, inside the box
  compact?: boolean;   // narrower buttons, so two fit side by side on a phone
}) {
  const btn = compact ? [styles.stepBtn, { width: 34 }] : styles.stepBtn;
  return (
    <LiquidBox radius={24} style={[styles.stepper, style]}>
      <Press onPress={onMinus} style={btn} accessibilityLabel={`Less ${label ?? ''}`.trim()}><Minus size={compact ? 18 : 20} color={colors.text} /></Press>
      <Press onPress={onPressValue} style={{ flex: 1 }} haptic={false} hoverable={false}>
        {label ? <Txt style={styles.stepLabel} numberOfLines={1}>{label}</Txt> : null}
        <Txt style={[styles.stepValue, label ? { fontSize: 17 } : null]} numberOfLines={1}>{value}</Txt>
      </Press>
      <Press onPress={onPlus} style={btn} accessibilityLabel={`More ${label ?? ''}`.trim()}><Plus size={compact ? 18 : 20} color={colors.text} /></Press>
    </LiquidBox>
  );
}

export function Chip({ label, active, open, onPress, icon }: { label: string; active?: boolean; open?: boolean; onPress?: () => void; icon?: ReactNode }) {
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <Press onPress={onPress} style={[styles.chip, glass('regular', { shadow: false }), (active || open) && glassLens()]}>
      {icon}
      <Txt style={{ fontSize: 15 }}>{label}</Txt>
      <Chevron size={16} color={colors.text} />
    </Press>
  );
}

export function DottedRow({ label, value, valueColor, right }: { label: string; value?: string; valueColor?: string; right?: ReactNode }) {
  return (
    <View style={styles.dotted}>
      <Txt style={styles.dottedLabel}>{label}</Txt>
      <View style={styles.dots} />
      {right ?? <Txt style={[styles.dottedValue, valueColor ? { color: valueColor } : null]}>{value}</Txt>}
    </View>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.section}>
      <Txt style={type.sectionTitle}>{title}</Txt>
      {action ? (
        <Press onPress={onAction} style={[styles.sectionAction, glass('regular', { shadow: false })]} haptic={false} accessibilityRole="button" accessibilityLabel={action}>
          <Txt style={{ fontSize: 13, fontFamily: font.semibold }}>{action}</Txt>
          <ChevronRight size={15} color={colors.text} strokeWidth={2.25} />
        </Press>
      ) : null}
    </View>
  );
}

// Empty or missing content: an icon in a soft circle, a short title, one line of guidance, then an optional action.
export function EmptyState({ text, title, icon, children }: { text: string; title?: string; icon?: ReactNode; children?: ReactNode }) {
  return (
    <View style={{ paddingVertical: 28, gap: 14, alignItems: 'center' }}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      {title ? <Txt style={{ fontSize: 18, fontFamily: font.bold, textAlign: 'center' }}>{title}</Txt> : null}
      <Txt style={{ color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: 'center', maxWidth: 320 }}>{text}</Txt>
      {children ? <View style={{ alignSelf: 'stretch', marginTop: 4 }}>{children}</View> : null}
    </View>
  );
}

export function Spinner({ full }: { full?: boolean }) {
  const s = <ActivityIndicator size={24} color={colors.accent} />;
  return full ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>{s}</View> : s;
}

// Grey placeholder with a moving light band (1.2 s loop).
export function Skeleton({ width, height, style }: { width: number | `${number}%`; height: number; style?: StyleProp<ViewStyle> }) {
  const [x] = useState(() => new Animated.Value(-1));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: 1200, useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [x]);
  return (
    <View style={[{ width, height, borderRadius: 8, backgroundColor: colors.surface2, overflow: 'hidden' }, style]}>
      <Animated.View
        style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: '40%', backgroundColor: veil.shimmer,
          transform: [{ translateX: x.interpolate({ inputRange: [-1, 1], outputRange: [-120, 320] }) }],
        }}
      />
    </View>
  );
}

// Light coach-mark card with a pointer at the bottom-left.
export function Tooltip({ title, body, onDismiss }: { title: string; body: string; onDismiss: () => void }) {
  return (
    <Press onPress={onDismiss} style={styles.tooltip} haptic={false}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <AiIcon size={20} color={colors.dark} />
        <Txt style={{ color: colors.dark, fontSize: 18, fontFamily: font.bold, flex: 1 }}>{title}</Txt>
      </View>
      <Txt style={{ color: colors.dark, fontSize: 15, marginTop: 6 }}>{body}</Txt>
      <View style={styles.tooltipArrow} />
    </Press>
  );
}

const styles = createStyles(() => ({
  sideArrowBox: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', zIndex: 5 },
  sideArrow: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  stepper: {
    flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: 24,
  },
  stepBtn: { width: 44, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { fontSize: 11, color: colors.muted, textAlign: 'center', marginBottom: -2 },
  stepValue: { fontSize: 20, textAlign: 'center', fontFamily: font.medium, fontVariant: ['tabular-nums'] },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20,
  },
  dotted: { flexDirection: 'row', alignItems: 'flex-end', height: 32 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dottedLabel: { color: colors.muted, fontSize: 16 },
  dots: { flex: 1, marginHorizontal: 6, marginBottom: 5, borderBottomWidth: 1, borderStyle: 'dotted', borderColor: colors.border },
  dottedValue: { fontSize: 16 },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 32, paddingLeft: 12, paddingRight: 8, borderRadius: 16 },
  tooltip: { backgroundColor: colors.tooltipBg, borderRadius: radius.lg, padding: 16 },
  tooltipArrow: {
    position: 'absolute', bottom: -8, left: 140, width: 16, height: 16, backgroundColor: colors.tooltipBg,
    transform: [{ rotate: '45deg' }],
  },
}));
