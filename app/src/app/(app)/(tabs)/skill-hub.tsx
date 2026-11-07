import { View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COURSES, SECTIONS, type Course } from '@/content/lessons';
import { Mascot } from '@/components/Mascot';
import { card, colors, font, type, createStyles } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Press } from '@/ui/Press';
import { Txt } from '@/ui/Txt';
import { Page } from '@/ui/Page';
import { useLayout } from '@/hooks/useLayout';

function Tile({ c, featured, basis }: { c: Course; featured?: boolean; basis?: `${number}%` }) {
  return (
    <Press
      disabled={c.locked}
      onPress={() => router.push({ pathname: '/course/[id]', params: { id: c.id } })}
      style={[featured ? styles.featured : [styles.square, basis ? { flexBasis: basis, maxWidth: basis } : null], c.locked && { opacity: 0.4 }]}
    >
      {c.locked ? <View style={styles.locked}><Txt style={{ fontSize: 11, fontFamily: font.bold }}>Locked</Txt></View> : null}
      {featured ? (
        <>
          <View style={{ flex: 1, justifyContent: 'space-between' }}>
            <Txt style={{ fontSize: 20, fontFamily: font.bold }}>{c.title}</Txt>
            <Txt style={{ fontSize: 11, color: colors.muted }}>{c.tag}</Txt>
          </View>
          <Mascot size={110} pose="book" />
        </>
      ) : (
        <>
          <View style={{ alignItems: 'center', flex: 0.6, justifyContent: 'center' }}><Mascot size={70} /></View>
          <Txt style={{ fontSize: 14, fontFamily: font.medium }} numberOfLines={2}>{c.title}</Txt>
          <Txt style={{ fontSize: 11, color: colors.muted }}>{c.tag}</Txt>
        </>
      )}
    </Press>
  );
}

export default function SkillHub() {
  // Course tiles per row: 2 on phones, 3 on tablets, 4 on desktop.
  const { device } = useLayout();
  const perRow = device === 'desktop' ? 4 : device === 'tablet' ? 3 : 2;
  const basis = `${Math.floor(100 / perRow) - 2}%` as `${number}%`;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="regular" />
      <Page gap={14}>
        <Txt style={type.screenTitle}>Skill Hub</Txt>
        {(['first', 'beyond'] as const).map((s) => {
          const list = COURSES.filter((c) => c.section === s);
          return (
            <View key={s} style={{ gap: 10, marginTop: 8 }}>
              <Txt style={{ fontSize: 20, fontFamily: font.bold }}>{SECTIONS[s].title}</Txt>
              <Txt style={{ color: colors.muted, fontSize: 14 }}>{SECTIONS[s].description}</Txt>
              {s === 'first' ? <Tile c={list[0]} featured /> : null}
              <View style={styles.grid}>
                {(s === 'first' ? list.slice(1) : list).map((c) => <Tile key={c.id} c={c} basis={basis} />)}
              </View>
            </View>
          );
        })}
      </Page>
    </SafeAreaView>
  );
}

const styles = createStyles(() => ({
  featured: { ...card, height: 150, padding: 16, flexDirection: 'row' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  square: { ...card, flexBasis: '48%', flexGrow: 1, aspectRatio: 1, padding: 14, gap: 4 },
  locked: { position: 'absolute', top: 8, right: 8, zIndex: 1, backgroundColor: colors.surface2, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
}));
