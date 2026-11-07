import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BookX, ChevronRight } from 'lucide-react-native';
import { courseById } from '@/content/lessons';
import { Mascot } from '@/components/Mascot';
import { colors, font, radius } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { EmptyState } from '@/ui/kit';
import { Press } from '@/ui/Press';
import { Txt } from '@/ui/Txt';
import { Page } from '@/ui/Page';

export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const course = courseById(id);
  if (!course) return <SafeAreaView style={{ flex: 1 }}><AppBar /><EmptyState icon={<BookX size={26} color={colors.muted} />} title="Lesson not found" text="This course may have moved. Open the Skill Hub to see every lesson." /></SafeAreaView>;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="narrow" />
      <Page width="narrow" gap={12}>
        <View style={{ height: 220, alignItems: 'center', justifyContent: 'center' }}><Mascot size={190} /></View>
        <Txt style={{ fontSize: 24, fontFamily: font.bold }}>{course.title}</Txt>
        <Txt style={{ fontSize: 15 }}>{course.description}</Txt>
        <Txt style={{ fontSize: 12, color: colors.muted }}>{course.tag}</Txt>
        {course.lessons.map((l, i) => (
          <Press key={l.id} disabled={course.locked} onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: l.id } })}
            style={{ height: 44, borderRadius: radius.md, backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 }}>
            <Txt>{i + 1}. {l.title}</Txt>
            <ChevronRight size={18} color={colors.text} />
          </Press>
        ))}
      </Page>
    </SafeAreaView>
  );
}
