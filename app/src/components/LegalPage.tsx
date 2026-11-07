// Renders a legal document (Terms, Privacy) as a calm reading page: title, last-updated date, intro, numbered sections.
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LegalDoc } from '@/content/legal';
import { colors, font, type } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Page } from '@/ui/Page';
import { Txt } from '@/ui/Txt';

export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="narrow" />
      <Page width="narrow" gap={22}>
        <View style={{ gap: 6 }}>
          <Txt style={type.screenTitle}>{doc.title}</Txt>
          <Txt style={{ color: colors.muted, fontSize: 13 }}>Last updated {doc.updated}</Txt>
        </View>
        <Txt style={{ fontSize: 16, lineHeight: 25 }}>{doc.intro}</Txt>
        {doc.sections.map((s) => (
          <View key={s.heading} style={{ gap: 8 }}>
            <Txt style={{ fontSize: 17, fontFamily: font.bold }}>{s.heading}</Txt>
            {s.body.map((p, i) => <Txt key={i} style={{ color: colors.muted, fontSize: 15, lineHeight: 23 }}>{p}</Txt>)}
          </View>
        ))}
      </Page>
    </SafeAreaView>
  );
}
