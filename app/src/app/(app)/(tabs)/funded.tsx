// Funded programme (coming after licensing): what it will be, and a real "Notify me" sign-up.
import { Mascot } from '@/components/Mascot';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ChartLine, ShieldCheck, Trophy } from 'lucide-react-native';
import { api } from '@/lib/api';
import { card, colors, font, type } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Page } from '@/ui/Page';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';

const STEPS = [
  { Icon: ChartLine, title: 'Pass a challenge', text: 'Reach a profit goal on demo without big losses.' },
  { Icon: ShieldCheck, title: 'Get verified', text: 'Confirm who you are.' },
  { Icon: Trophy, title: 'Trade our money', text: 'Keep a share of the profit.' },
];

export default function Funded() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['funded'], queryFn: () => api<{ interested: boolean }>('/funded') });
  const join = useMutation({
    mutationFn: () => api('/funded/interest', { method: 'POST' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['funded'] }); toast({ title: "You're on the list", message: 'We will let you know as soon as Funded opens.' }); },
  });
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="narrow" />
      <Page width="narrow" gap={20}>
        <View style={{ gap: 8 }}>
          <View style={{ alignItems: 'center' }}><Mascot size={120} pose="trophy" /></View>
          <Txt style={type.screenTitle}>Funded</Txt>
          <Txt style={{ color: colors.muted, fontSize: 16, lineHeight: 23 }}>
            Trade with our money when you are good enough. Coming soon.
          </Txt>
        </View>
        <View style={[card, { padding: 16, gap: 18 }]}>
          {STEPS.map(({ Icon, title, text }, i) => (
            <View key={title} style={{ flexDirection: 'row', gap: 14 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={20} color={colors.accent} strokeWidth={2.25} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Txt style={{ fontSize: 16, fontFamily: font.bold }}>{i + 1}. {title}</Txt>
                <Txt style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>{text}</Txt>
              </View>
            </View>
          ))}
        </View>
        {q.data?.interested ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
            <BadgeCheck size={18} color={colors.up} />
            <Txt style={{ color: colors.up, fontFamily: font.semibold }}>You're on the list. We'll tell you when it opens.</Txt>
          </View>
        ) : (
          <Button label="Notify me when it opens" height={52} loading={join.isPending} onPress={() => join.mutate()} />
        )}
        <Txt style={{ color: colors.faint, fontSize: 12, textAlign: 'center' }}>Trading involves risk. Funded accounts will have their own terms.</Txt>
      </Page>
    </SafeAreaView>
  );
}
