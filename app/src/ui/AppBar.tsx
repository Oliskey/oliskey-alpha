import type { ReactNode } from 'react';
import { View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useInDock, useLayout } from '@/hooks/useLayout';
import { colors, font } from '@/theme';
import { WIDTH } from './Page';
import { IconButton } from './IconButton';
import { Txt } from './Txt';

// Stack screen top bar: back arrow, centred title, optional right action. Aligned to the page's content column.
export function AppBar({ title, right, width = 'wide' }: { title?: string; right?: ReactNode; width?: keyof typeof WIDTH }) {
  const { gutter } = useLayout();
  const inDock = useInDock();
  const pathname = usePathname();
  if (inDock && pathname === '/funded') return <View style={{ height: 16 }} />;   // a main page: no back, only the ×
  return (
    <View style={{ height: 56, width: '100%', maxWidth: WIDTH[width], alignSelf: 'center', flexDirection: 'row',
      alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter }}>
      <IconButton label="Back" size={40} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
        <ArrowLeft size={20} color={colors.text} strokeWidth={2.25} />
      </IconButton>
      <Txt style={{ fontSize: 17, fontFamily: font.semibold }}>{title}</Txt>
      <View style={{ width: 44, alignItems: 'flex-end', marginRight: inDock ? 44 : 0 }}>{right}</View>
    </View>
  );
}
