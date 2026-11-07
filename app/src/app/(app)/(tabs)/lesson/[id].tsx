import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronRight } from 'lucide-react-native';
import { lessonById } from '@/content/lessons';
import { Mascot } from '@/components/Mascot';
import { colors, font, radius, SIDE } from '@/theme';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Press } from '@/ui/Press';
import { Txt } from '@/ui/Txt';
import { Page } from '@/ui/Page';

export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const found = lessonById(id);
  const [page, setPage] = useState(0);
  const [answer, setAnswer] = useState<number | null>(null);
  const [quit, setQuit] = useState(false);
  if (!found) return null;
  const { lesson } = found;
  const p = lesson.pages[page];
  const last = page === lesson.pages.length - 1;
  const next = () => { setAnswer(null); if (last) router.back(); else setPage(page + 1); };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SIDE }}>
        <Press onPress={() => (page > 0 ? setQuit(true) : router.back())} accessibilityLabel="Back"><ArrowLeft size={24} color={colors.text} /></Press>
        <Txt style={{ fontSize: 12, color: colors.muted }}>Page {page + 1} of {lesson.pages.length}</Txt>
        <View style={{ width: 24 }} />
      </View>
      <Page width="narrow" gap={16} style={{ flexGrow: 1 }}>
        <Txt style={{ fontSize: p.kind === 'intro' ? 28 : 22, fontFamily: font.bold }}>{p.title}</Txt>
        {p.kind !== 'quiz' ? <Txt style={{ fontSize: 15, lineHeight: 22 }}>{p.body}</Txt> : null}
        <View style={{ alignItems: 'center', paddingVertical: 10 }}><Mascot size={p.kind === 'intro' ? 180 : 120} /></View>
        {p.kind === 'quiz' ? (
          <View style={{ gap: 8 }}>
            <Txt style={{ fontSize: 15 }}>{p.question}</Txt>
            {p.answers.map((a, i) => {
              const chosen = answer === i;
              return (
                <View key={a.text} style={{ gap: 4 }}>
                  <Press onPress={() => setAnswer(i)} disabled={answer !== null}
                    style={{ minHeight: 48, borderRadius: radius.md, backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, borderWidth: 1, borderColor: chosen ? (a.correct ? colors.up : colors.down) : 'transparent' }}>
                    <Txt style={{ fontSize: 14, flex: 1 }}>{a.text}</Txt>
                    <ChevronRight size={18} color={colors.text} />
                  </Press>
                  {chosen ? <Txt style={{ fontSize: 13, color: a.correct ? colors.up : colors.down }}>{a.why}</Txt> : null}
                </View>
              );
            })}
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        <Button height={52} label={p.kind === 'intro' ? 'Start' : last ? 'Finish' : p.kind === 'quiz' ? 'Continue' : 'Next'}
          disabled={p.kind === 'quiz' && answer === null} onPress={next} />
      </Page>
      <Dialog open={quit} title="Are you sure you want to quit?" onClose={() => setQuit(false)}
        actions={[{ label: 'No', onPress: () => setQuit(false) }, { label: 'Yes', onPress: () => { setQuit(false); router.back(); } }]} />
    </SafeAreaView>
  );
}
