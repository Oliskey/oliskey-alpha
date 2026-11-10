// Invite friends: your code, how your invites are doing, and exactly what you can earn. A friend's first finished trade
// earns a Profitability Boost now. The USD 100 bonus is real money, so the server only pays it once live trading is on
// and the friend has verified their identity and made a real deposit. Until then it is shown as not available yet.
import { Platform, Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Copy, Share2, Users, Zap } from 'lucide-react-native';
import { api } from '@/lib/api';
import { card, colors, createStyles, font, tint, type } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Spinner } from '@/ui/kit';
import { Page } from '@/ui/Page';
import { Press } from '@/ui/Press';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';

type Referrals = { code: string; invited: number; traded: number; released: number; bonus_usd: number };
const SITE = 'https://oliskey-alpha.vercel.app';

export default function Invite() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['referrals'], queryFn: () => api<Referrals>('/referrals') });
  const r = q.data;
  const base = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : SITE;
  const link = r ? `${base}/register?invite=${r.code}` : '';
  const copy = (text: string, what: string) => { void Clipboard.setStringAsync(text).then(() => toast({ title: `${what} copied`, message: text })); };
  const share = async () => {
    const message = `Practise trading on Oliskey Alpha with a free demo account. Join with my code ${r?.code}: ${link}`;
    if (Platform.OS === 'web' && !(typeof navigator !== 'undefined' && 'share' in navigator)) { copy(message, 'Invite'); return; }
    try { await Share.share({ message }); } catch { copy(message, 'Invite'); }
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="narrow" />
      <Page width="narrow" gap={14}>
        <Txt style={type.screenTitle}>Invite friends</Txt>
        {q.isLoading ? <Spinner /> : q.isError ? (
          <Txt style={styles.muted}>{(q.error as Error).message}</Txt>
        ) : r ? (
          <>
            <View style={[card, styles.box]}>
              <Txt style={styles.muted}>Your invite code</Txt>
              <Press haptic={false} onPress={() => copy(r.code, 'Code')} accessibilityLabel="Copy your invite code" style={styles.codeRow}>
                <Txt style={styles.code}>{r.code}</Txt>
                <Copy size={18} color={colors.muted} />
              </Press>
              <Button label="Share invite" height={46} iconLeft={<Share2 size={18} color={colors.dark} />} onPress={() => { void share(); }} />
            </View>

            <View style={styles.statRow}>
              {[{ label: 'Invited', value: r.invited }, { label: 'Traded', value: r.traded }, { label: 'Bonuses paid', value: r.released }].map((s) => (
                <View key={s.label} style={[card, styles.stat]}>
                  <Txt style={{ fontSize: 20, fontFamily: font.semibold, fontVariant: ['tabular-nums'] }}>{s.value}</Txt>
                  <Txt style={[styles.muted, { fontSize: 12 }]}>{s.label}</Txt>
                </View>
              ))}
            </View>

            <Txt style={styles.h}>What you can earn</Txt>
            <View style={[card, styles.item]}>
              <View style={[styles.icon, { backgroundColor: tint(4).bg }]}><Zap size={18} color={tint(4).fg} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt style={styles.itemTitle}>A Profitability Boost</Txt>
                <Txt style={styles.muted}>A friend's first trade gives you +10 points on Fixed Time payouts for 1 hour.</Txt>
              </View>
            </View>
            <View style={[card, styles.item]}>
              <View style={[styles.icon, { backgroundColor: tint(2).bg }]}><Users size={18} color={tint(2).fg} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt style={styles.itemTitle}>{`A $${r.bonus_usd} trading bonus`}</Txt>
                <Txt style={styles.muted}>Coming with real money, after your friend's first deposit. Trade it; only the profit can be withdrawn.</Txt>
              </View>
            </View>
          </>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}

const styles = createStyles(() => ({
  box: { padding: 16, gap: 12 },
  muted: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 52, borderRadius: 14, backgroundColor: colors.surface2 },
  code: { fontSize: 24, fontFamily: font.bold, letterSpacing: 2, fontVariant: ['tabular-nums'] },
  statRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, padding: 12, gap: 2, alignItems: 'center' },
  h: { fontSize: 17, fontFamily: font.semibold, marginTop: 4 },
  item: { flexDirection: 'row', gap: 12, padding: 14 },
  itemTitle: { fontSize: 15, fontFamily: font.semibold },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
}));
