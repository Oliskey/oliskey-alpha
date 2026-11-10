// Segmented control on glass (mode switches: Trades, Assets, Scanner, Terminal): one capsule track with a single
// glass lens that glides to the selected option. Selected and unselected labels share the same weight, so nothing
// shifts when the selection moves. Scrolls sideways when the options are wider than the screen.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, useWindowDimensions } from 'react-native';
import { colors, font, createStyles } from '@/theme';
import { glass, glassLens, MOTION } from '@/ui/glass';
import { Press } from '@/ui/Press';
import { CountBadge, SideScroll } from '@/ui/kit';
import { Txt } from '@/ui/Txt';

export function Segmented<K extends string>({ tabs, value, onChange, dot, stretch }: {
  tabs: readonly { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void; dot?: K;
  stretch?: boolean;   // fill the width, equal parts
}) {
  const { width: winW } = useWindowDimensions();
  const small = winW < 400 || (winW < 480 && (tabs.length > 4 || tabs.some((t) => t.count)));   // all four modes still fit on the smallest phones
  const [widths, setWidths] = useState<Partial<Record<K, number>>>({});
  const [x] = useState(() => new Animated.Value(0));
  const [w] = useState(() => new Animated.Value(0));
  const placed = useRef(false);
  // Added up from the widths: when a count appears on an earlier tab this one moves, and a move alone fires no layout event.
  const at = tabs.findIndex((t) => t.key === value);
  const measured = tabs.every((t) => widths[t.key] != null);
  const box = measured && at >= 0 ? { x: tabs.slice(0, at).reduce((s, t) => s + (widths[t.key] ?? 0), 0), w: widths[value] ?? 0 } : undefined;
  useEffect(() => {
    if (!box) return;
    if (!placed.current) { placed.current = true; x.setValue(box.x); w.setValue(box.w); return; }
    const cfg = { duration: MOTION.glideMs, easing: Easing.bezier(0.32, 0.72, 0, 1), useNativeDriver: false };
    Animated.parallel([Animated.timing(x, { toValue: box.x, ...cfg }), Animated.timing(w, { toValue: box.w, ...cfg })]).start();
  }, [box?.x, box?.w]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SideScroll fade={false} reveal={box} style={[styles.track, stretch && { alignSelf: 'stretch' }, glass('regular', { shadow: false })]} contentContainerStyle={{ padding: 4, flexGrow: stretch ? 1 : 0 }}>
      <View style={{ flexDirection: 'row', flex: stretch ? 1 : undefined }}>
        {box ? <Animated.View pointerEvents="none" style={[styles.lens, glassLens(), { left: x, width: w }]} /> : null}
        {tabs.map((t) => {
          const active = t.key === value;
          return (
            <Press key={t.key} onPress={() => onChange(t.key)} haptic={false} accessibilityRole="tab" accessibilityState={{ selected: active }}
              onLayout={(e) => { const { width } = e.nativeEvent.layout; setWidths((b) => (b[t.key] === width ? b : { ...b, [t.key]: width })); }}
              style={[styles.item, small && { paddingHorizontal: 9 }, stretch && { flex: 1, justifyContent: 'center' }]}>
              {dot === t.key ? <View style={styles.dot} /> : null}
              <Txt style={{ fontSize: small ? 14 : 15, fontFamily: font.semibold, color: active ? colors.text : colors.muted }}>{t.label}</Txt>
              <CountBadge inline count={t.count ?? 0} />
            </Press>
          );
        })}
      </View>
    </SideScroll>
  );
}

// Older name kept for the screens that import it.
export const UnderlineTabs = Segmented;

const styles = createStyles(() => ({
  track: { flexGrow: 0, alignSelf: 'flex-start', maxWidth: '100%', borderRadius: 22 },
  lens: { position: 'absolute', top: 0, bottom: 0, borderRadius: 18 },
  item: { height: 36, paddingHorizontal: 16, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.up },
}));
