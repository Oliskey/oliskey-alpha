// Screen content wrapper: centred column with a readable max width and gutters that grow with the screen.
import type { ReactNode } from 'react';
import { ScrollView, View, type RefreshControlProps, type StyleProp, type ViewStyle } from 'react-native';
import { onNavScroll, useTabBarSpace } from '@/components/TabBar';
import { useLayout } from '@/hooks/useLayout';

export const WIDTH = { narrow: 560, regular: 880, wide: 1200 } as const;

type Props = {
  children: ReactNode;
  width?: keyof typeof WIDTH;        // narrow = forms/reading, regular = lists, wide = dashboards
  gap?: number;
  top?: number;                      // extra top padding
  scroll?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  style?: StyleProp<ViewStyle>;
};

export function Page({ children, width = 'regular', gap = 16, top = 0, scroll = true, refreshControl, style }: Props) {
  const { gutter } = useLayout();
  const tabSpace = useTabBarSpace();   // content scrolls under the floating pill and can still clear it at the end
  const inner: ViewStyle = { width: '100%', maxWidth: WIDTH[width], alignSelf: 'center', paddingHorizontal: gutter, paddingTop: top, paddingBottom: 32 + tabSpace, gap };
  if (!scroll) return <View style={[inner, { flex: 1 }, style]}>{children}</View>;
  return (
    <ScrollView contentContainerStyle={[inner, style]} refreshControl={refreshControl} keyboardShouldPersistTaps="handled" onScroll={onNavScroll} scrollEventThrottle={16}>
      {children}
    </ScrollView>
  );
}

// The same centred column as <Page>, for screens that use their own FlatList or header rows.
export function useColumn(width: keyof typeof WIDTH = 'regular'): ViewStyle {
  const { gutter } = useLayout();
  return { width: '100%', maxWidth: WIDTH[width], alignSelf: 'center', paddingHorizontal: gutter };
}

// Lays children out in `columns` equal columns with a gap (1 column = plain stack).
export function Grid({ children, columns, gap = 12 }: { children: ReactNode; columns: number; gap?: number }) {
  if (columns <= 1) return <View style={{ gap }}>{children}</View>;
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : [children];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {items.map((child, i) => (
        <View key={i} style={{ flexBasis: `${100 / columns - 2}%`, flexGrow: 1, maxWidth: `${100 / columns}%` }}>{child}</View>
      ))}
    </View>
  );
}
