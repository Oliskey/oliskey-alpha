// Risk disclosure for real-money AI Trading. Accepting is recorded on the server (append-only audit log) with the text's version;
// a real-money key is refused until it is accepted and the identity check is done. Draft text until the lawyer approves it
// (docs/ai-trading/legal/03-risk-disclosure.md).
import { View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CircleAlert } from 'lucide-react-native';
import { api } from '@/lib/api';
import { colors, font, type } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Spinner } from '@/ui/kit';
import { Page } from '@/ui/Page';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';

const POINTS = [
  'You can lose money, including all the money you give a strategy.',
  'No strategy is guaranteed. Test and practice results are not promises.',
  'Orders are placed for you automatically, within the limits you set. Pause stops new orders; it does not sell what you hold.',
  'Your money stays on your exchange. Its outages, rules, fees or failure are risks Oliskey cannot remove.',
  'The app, the internet or the exchange can be slow or fail, so an order can be late, refused or filled at a worse price.',
  'Anyone with your key can trade on your account. Use a key that cannot withdraw, and delete it on the exchange when you stop.',
  'Exchange fees, the subscription and the 15% fee on new counted profit all reduce what you keep. Taxes are yours.',
  'Laws can change and could limit or stop this service.',
  'Only use money you can afford to lose.',
];

type State = { version: string; accepted: boolean; acceptedAt: string | null; identityVerified: boolean };

export default function RiskDisclosure() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['trading', 'risk'], queryFn: () => api<State>('/trading/risk-disclosure') });
  const accept = useMutation({
    mutationFn: () => api('/trading/risk-disclosure/accept', { method: 'POST', body: { version: q.data?.version } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['trading', 'risk'] }); toast({ title: 'Accepted', message: 'Saved with today’s date.' }); },
    onError: (e) => toast({ title: 'Not saved', message: (e as Error).message, tone: 'down' }),
  });
  const s = q.data;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="narrow" />
      <Page width="narrow" gap={18}>
        <View style={{ gap: 6 }}>
          <Txt style={type.screenTitle}>Before real money</Txt>
          <Txt style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>Read this first. Real-money trading is not open yet; this is how it will work.</Txt>
        </View>
        {q.isLoading || !s ? <Spinner /> : (
          <>
            <View style={{ gap: 12 }}>
              {POINTS.map((p, i) => (
                <View key={p} style={{ flexDirection: 'row', gap: 10 }}>
                  <Txt style={{ fontFamily: font.bold, color: colors.accent, width: 20 }}>{i + 1}.</Txt>
                  <Txt style={{ flex: 1, fontSize: 15, lineHeight: 22 }}>{p}</Txt>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {s.identityVerified ? <BadgeCheck size={18} color={colors.up} /> : <CircleAlert size={18} color={colors.demo} />}
              <Txt style={{ flex: 1, fontSize: 14, color: s.identityVerified ? colors.up : colors.demo }}>
                {s.identityVerified ? 'Identity verified' : 'Identity not verified yet: needed before real money'}
              </Txt>
            </View>
            {!s.identityVerified ? <Button label="Verify identity" variant="secondary" height={44} onPress={() => router.push('/withdraw')} /> : null}
            {s.accepted ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <BadgeCheck size={18} color={colors.up} />
                <Txt style={{ color: colors.up, fontFamily: font.semibold }}>You accepted this on {new Date(s.acceptedAt!).toLocaleDateString()}.</Txt>
              </View>
            ) : (
              <Button label="I understand and accept" height={50} loading={accept.isPending} onPress={() => accept.mutate()} />
            )}
            <Txt style={{ color: colors.muted, fontSize: 12 }}>Version {s.version} · draft wording until legal review.</Txt>
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
