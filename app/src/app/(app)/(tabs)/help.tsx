import { useState } from 'react';
import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronDown, ChevronUp, GraduationCap, Mail, MessageCircle, ShieldAlert } from 'lucide-react-native';
import { card, colors, font, radius, SIDE, type, createStyles } from '@/theme';
import { Press } from '@/ui/Press';
import { Txt } from '@/ui/Txt';
import { Row, Section } from '@/ui/List';
import { Page } from '@/ui/Page';

// Support channels (owner, 2026-10-30). WhatsApp 0904 941 7103 in international form for wa.me.
const SUPPORT_EMAIL = 'support@oliskeylee.com';
const SUPPORT_WHATSAPP = 'https://wa.me/2349049417103';

const FAQ = [
  { q: 'Is the demo account free?', a: 'Yes. Every new account gets α10,000 in demo funds. You can reset it to α10,000 any time from the account menu when no demo trades are open.' },
  { q: 'Are the prices real?', a: 'Crypto prices are live market prices. Every other market uses simulated prices so you can practise; they are not live quotes and are marked "Simulated price" on the chart.' },
  { q: 'How is a Fixed Time trade decided?', a: 'The price when the trade closes is compared with the price when it opened. Only those two prices count. If they are equal, your amount is returned.' },
  { q: 'How does InZone work?', a: 'You win if the price is still inside the corridor shown on the chart when the time runs out. Longer trades get a wider corridor.' },
  { q: 'When can I deposit real money?', a: 'Real-money accounts open after Oliskey Alpha completes licensing. Until then, deposits and withdrawals are switched off.' },
  { q: 'Is the AI analysis financial advice?', a: 'No. Trade insights explain what happened in a finished trade. They are educational and never predict future prices.' },
];

export default function Help() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <Page top={40} gap={18}>
        <Txt style={type.screenTitle}>Help</Txt>
        <Section title="Talk to us">
          <Row icon={MessageCircle} title="WhatsApp" subtitle="0904 941 7103 · chat with support" onPress={() => { void Linking.openURL(SUPPORT_WHATSAPP); }} />
          <Row icon={Mail} title="Email" subtitle={SUPPORT_EMAIL} onPress={() => { void Linking.openURL(`mailto:${SUPPORT_EMAIL}`); }} />
          <Row icon={GraduationCap} title="Lessons" subtitle="Five-minute lessons in the Skill Hub" onPress={() => router.push('/skill-hub')} last />
        </Section>

        <Txt style={type.sectionTitle}>Questions</Txt>
        <View style={{ gap: 8 }}>
          {FAQ.map((f, i) => (
            <Press key={f.q} style={styles.faq} haptic={false} onPress={() => setOpen(open === i ? null : i)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                <Txt style={{ flex: 1, fontFamily: font.medium, fontSize: 16 }}>{f.q}</Txt>
                {open === i ? <ChevronUp size={20} color={colors.muted} /> : <ChevronDown size={20} color={colors.muted} />}
              </View>
              {open === i ? <Txt style={{ color: colors.muted, marginTop: 8, lineHeight: 21 }}>{f.a}</Txt> : null}
            </Press>
          ))}
        </View>

        <View style={styles.risk}>
          <ShieldAlert size={22} color={colors.demo} />
          <Txt style={{ flex: 1, color: colors.muted, fontSize: 13, lineHeight: 19 }}>
            Risk disclosure: trading carries a high risk of losing money. Only trade with money you can afford to lose. Past results do not predict future results.
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: 20, justifyContent: 'center' }}>
          <Press haptic={false} onPress={() => router.push('/terms')} accessibilityRole="link" accessibilityLabel="Terms of Service"><Txt style={styles.link}>Terms of Service</Txt></Press>
          <Press haptic={false} onPress={() => router.push('/privacy')} accessibilityRole="link" accessibilityLabel="Privacy Policy"><Txt style={styles.link}>Privacy Policy</Txt></Press>
        </View>
        <Txt style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>Oliskey Alpha by Oliskeylee Ltd.</Txt>
      </Page>
    </SafeAreaView>
  );
}

const styles = createStyles(() => ({
  page: { paddingHorizontal: SIDE, paddingTop: 40, paddingBottom: 30, gap: 18 },
  faq: { ...card, padding: 16 },
  risk: { flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14 },
  link: { color: colors.accent, fontSize: 14 },
}));
