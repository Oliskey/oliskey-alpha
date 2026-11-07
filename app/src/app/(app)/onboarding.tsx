// First visit after sign-up: the welcome, the lessons, a 3-question check and the AI choice. Trading is locked by the server until it is done.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react-native';
import { PracticeTrade } from '@/components/PracticeTrade';
import { AI_LESSON, LESSONS, QUIZ } from '@/content/onboarding';
import { useAccount } from '@/context/AccountContext';
import { api, type ApiError } from '@/lib/api';
import { colors, font, createStyles } from '@/theme';
import { AiIcon } from '@/ui/AiIcon';
import { Button } from '@/ui/Button';
import { GlossIcon } from '@/ui/GlossIcon';
import { Press } from '@/ui/Press';
import { Txt } from '@/ui/Txt';
import { useColumn } from '@/ui/Page';

type AiMode = 'ask' | 'auto';
const STEPS = LESSONS.length + 3;   // the lessons, the practice trade, the AI, then the check

export default function Onboarding() {
  const column = useColumn('narrow');
  const qc = useQueryClient();
  const { me } = useAccount();
  const [step, setStep] = useState(0);
  const [aiMode, setAiMode] = useState<AiMode | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [wrong, setWrong] = useState<string[]>([]);
  const [practised, setPractised] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const first = me?.profile.full_name?.split(' ')[0];

  const finish = async () => {
    setBusy(true); setError(''); setWrong([]);
    try {
      await api('/me/onboarding', { method: 'POST', body: { answers, aiMode } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace('/');
    } catch (e) {
      const err = e as ApiError;
      setWrong(Array.isArray(err.details?.wrong) ? (err.details.wrong as string[]) : []);
      setError(err.message);
    } finally { setBusy(false); }
  };

  const lesson = step < LESSONS.length ? LESSONS[step] : null;
  const isPractice = step === LESSONS.length;
  const isAi = step === LESSONS.length + 1;
  const isQuiz = step === LESSONS.length + 2;
  const canGo = isPractice ? practised : isAi ? aiMode !== null : isQuiz ? QUIZ.every((q) => answers[q.key]) : true;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={[styles.progress, column]} accessibilityLabel={`Step ${step + 1} of ${STEPS}`}>
        {Array.from({ length: STEPS }, (_, i) => <View key={i} style={[styles.dot, { backgroundColor: i <= step ? colors.accent : colors.border }]} />)}
      </View>
      <ScrollView contentContainerStyle={[column, styles.body]}>
        {lesson ? (
          <>
            <GlossIcon icon={lesson.icon} color={lesson.color} size={64} />
            <Txt style={styles.title}>{step === 0 && first ? `Welcome, ${first}` : lesson.title}</Txt>
            {lesson.lines.map((l) => <Txt key={l} style={styles.line}>{l}</Txt>)}
          </>
        ) : isPractice ? (
          <>
            <Txt style={styles.title}>Try a practice trade</Txt>
            <Txt style={styles.line}>Follow the highlighted part. Nothing here uses your money.</Txt>
            <PracticeTrade onDone={() => { setPractised(true); setStep((s) => s + 1); }} />
          </>
        ) : isAi ? (
          <>
            <View style={styles.aiBadge}><AiIcon size={34} color={colors.accent} /></View>
            <Txt style={styles.title}>{AI_LESSON.title}</Txt>
            {AI_LESSON.lines.map((l) => <Txt key={l} style={styles.line}>{l}</Txt>)}
            <Txt style={[styles.line, { fontFamily: font.semibold, color: colors.text, marginTop: 6 }]}>How should the AI work with your demo account?</Txt>
            {([['ask', 'Always ask me', 'It asks before every trade. You approve or skip.'], ['auto', 'Auto trade', 'It trades by itself at your amount. It can lose.']] as const).map(([k, label, about]) => (
              <Choice key={k} label={label} about={about} chosen={aiMode === k} onPress={() => setAiMode(k)} />
            ))}
          </>
        ) : (
          <>
            <Txt style={styles.title}>Quick check</Txt>
            <Txt style={styles.line}>Three questions, then trading opens.</Txt>
            {QUIZ.map((q) => (
              <View key={q.key} style={{ gap: 8, marginTop: 8 }}>
                <Txt style={[styles.question, wrong.includes(q.key) ? { color: colors.down } : null]}>{q.question}</Txt>
                {q.choices.map((c) => (
                  <Choice key={c.key} label={c.label} chosen={answers[q.key] === c.key} onPress={() => { setAnswers((a) => ({ ...a, [q.key]: c.key })); setWrong((w) => w.filter((x) => x !== q.key)); }} />
                ))}
              </View>
            ))}
          </>
        )}
        {error ? <Txt style={{ color: colors.down, fontSize: 15 }} accessibilityRole="alert">{error}</Txt> : null}
      </ScrollView>
      <View style={[styles.actions, column]}>
        {step > 0 ? <View style={{ flex: 1 }}><Button label="Back" variant="secondary" height={52} onPress={() => { setError(''); setStep((s) => s - 1); }} /></View> : null}
        <View style={{ flex: 2 }}>
          <Button label={isQuiz ? 'Start trading' : step === 0 ? 'Get started' : 'Continue'} height={52} disabled={!canGo} loading={busy}
            onPress={() => (isQuiz ? finish() : setStep((s) => s + 1))} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Choice({ label, about, chosen, onPress }: { label: string; about?: string; chosen: boolean; onPress: () => void }) {
  return (
    <Press onPress={onPress} haptic={false} accessibilityRole="radio" accessibilityState={{ checked: chosen }} accessibilityLabel={label}
      style={[styles.choice, chosen ? { borderColor: colors.accent, backgroundColor: colors.surface2 } : null]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt style={{ fontSize: 16, fontFamily: font.semibold }}>{label}</Txt>
        {about ? <Txt style={{ fontSize: 14, color: colors.muted }}>{about}</Txt> : null}
      </View>
      <View style={[styles.radio, chosen ? { borderColor: colors.accent, backgroundColor: colors.accent } : null]}>{chosen ? <Check size={14} color={colors.bg} strokeWidth={3} /> : null}</View>
    </Press>
  );
}

const styles = createStyles(() => ({
  progress: { flexDirection: 'row', gap: 6, paddingTop: 16, paddingBottom: 8 },
  dot: { flex: 1, height: 4, borderRadius: 2 },
  body: { gap: 14, paddingTop: 28, paddingBottom: 24 },
  title: { fontSize: 28, fontFamily: font.bold, letterSpacing: -0.4, marginTop: 6 },
  line: { fontSize: 17, lineHeight: 25, color: colors.muted },
  question: { fontSize: 16, fontFamily: font.semibold },
  aiBadge: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 56, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 10, paddingBottom: 16 },
}));
