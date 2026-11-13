// Connect an exchange, step by step. Testnet only while real-money trading is closed.
// The key and secret live only in this screen's memory: never saved on the device, never logged, cleared after sending.
// The server checks the key's permissions with the exchange and refuses any key that can withdraw or transfer.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, ExternalLink, Eye, PencilLine, ShieldCheck, ShieldX } from 'lucide-react-native';
import { api, ApiError } from '@/lib/api';
import { type Connection, BINANCE_TESTNET_URL } from '@/lib/aiTrading';
import { card, colors, font, type } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Page } from '@/ui/Page';
import { Txt } from '@/ui/Txt';

const STEPS = ['Make a key', 'Paste it', 'Done'] as const;

function Rule({ on, text }: { on: boolean; text: string }) {
  const Icon = on ? ShieldCheck : ShieldX;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Icon size={18} color={on ? colors.up : colors.down} />
      <Txt style={{ fontSize: 15, flex: 1 }}>{text}</Txt>
      <Txt style={{ fontSize: 13, fontFamily: font.bold, color: on ? colors.up : colors.down }}>{on ? 'ON' : 'OFF'}</Txt>
    </View>
  );
}

function Dots({ step }: { step: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }} accessibilityLabel={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
      {STEPS.map((s, i) => (
        <View key={s} style={{ flex: 1, gap: 6 }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: i <= step ? colors.accent : colors.border }} />
          <Txt style={{ fontSize: 12, color: i === step ? colors.text : colors.muted, fontFamily: i === step ? font.semibold : font.regular }}>{s}</Txt>
        </View>
      ))}
    </View>
  );
}

export default function Connect() {
  const { provider = 'binance' } = useLocalSearchParams<{ provider?: string }>();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [result, setResult] = useState<{ ok: true; conn: Connection } | { ok: false; message: string; forbidden?: string[] } | null>(null);
  // nothing typed here survives leaving the screen
  useEffect(() => () => { setApiKey(''); setApiSecret(''); }, []);

  const connect = useMutation({
    mutationFn: () => api<Connection>('/trading/exchanges/connect', { method: 'POST', body: { providerId: provider, environment: 'testnet', apiKey: apiKey.trim(), apiSecret: apiSecret.trim() } }),
    onSuccess: (conn) => { setResult({ ok: true, conn }); void qc.invalidateQueries({ queryKey: ['trading'] }); },
    onError: (e) => {
      const forbidden = e instanceof ApiError && Array.isArray(e.details?.forbidden) ? (e.details?.forbidden as string[]) : undefined;
      setResult({ ok: false, message: (e as Error).message, forbidden });
    },
    onSettled: () => { setApiKey(''); setApiSecret(''); setStep(2); },
  });
  const warnings = result?.ok ? ((result.conn.permissions?.warnings as string[] | undefined) ?? []) : [];

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar width="narrow" />
      <Page width="narrow" gap={20}>
        <View style={{ gap: 6 }}>
          <Txt style={type.screenTitle}>Connect Binance</Txt>
          <Txt style={{ color: colors.demo, fontSize: 14, fontFamily: font.medium }}>Testnet · test money only</Txt>
        </View>
        <Dots step={step} />

        {step === 0 ? (
          <View style={{ gap: 16 }}>
            <View style={[card, { padding: 16, gap: 12 }]}>
              <Txt style={{ fontSize: 16, fontFamily: font.semibold }}>1. Open the Binance testnet</Txt>
              <Txt style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>Sign in there, then choose "Generate HMAC_SHA256 Key" and give it a name.</Txt>
              <Button label="Open Binance testnet" variant="secondary" height={44} icon={<ExternalLink size={16} color={colors.text} />} onPress={() => void WebBrowser.openBrowserAsync(BINANCE_TESTNET_URL)} />
            </View>
            <View style={[card, { padding: 16, gap: 12 }]}>
              <Txt style={{ fontSize: 16, fontFamily: font.semibold }}>2. Check what the key may do</Txt>
              <Rule on text="Reading" />
              <Rule on text="Spot trading" />
              <Rule on={false} text="Withdrawals" />
              <Txt style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>A key that can withdraw or transfer is refused. Limiting it to one IP address makes it safer.</Txt>
            </View>
            <Button label="I have my key" height={50} onPress={() => setStep(1)} />
          </View>
        ) : step === 1 ? (
          <View style={{ gap: 16 }}>
            <Field label="API key" value={apiKey} onChangeText={setApiKey} autoCapitalize="none" autoCorrect={false} autoComplete="off" spellCheck={false} placeholder="Paste the API key" />
            <Field label="Secret key" value={apiSecret} onChangeText={setApiSecret} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" spellCheck={false} placeholder="Paste the secret" />
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Eye size={16} color={colors.muted} style={{ marginTop: 2 }} />
              <Txt style={{ color: colors.muted, fontSize: 13, lineHeight: 19, flex: 1 }}>Sent once over a secure connection and stored encrypted on our server. Never kept on this phone.</Txt>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label="Back" variant="secondary" height={50} style={{ flex: 1 }} onPress={() => setStep(0)} />
              <Button label="Connect" height={50} style={{ flex: 2 }} loading={connect.isPending} disabled={apiKey.trim().length < 16 || apiSecret.trim().length < 16} onPress={() => connect.mutate()} />
            </View>
          </View>
        ) : result?.ok ? (
          <View style={{ gap: 16 }}>
            <View style={[card, { padding: 20, gap: 10, alignItems: 'center' }]}>
              <CircleCheck size={44} color={colors.up} />
              <Txt style={{ fontSize: 18, fontFamily: font.bold }}>Connected</Txt>
              <Txt style={{ color: colors.muted, fontSize: 14, textAlign: 'center' }}>Key ending {result.conn.key_hint ?? '••••'} · reading and spot trading only</Txt>
            </View>
            {warnings.map((w) => (
              <Txt key={w} style={{ color: colors.demo, fontSize: 13, lineHeight: 19 }}>{w}</Txt>
            ))}
            <Button label="Done" height={50} onPress={() => router.replace('/ai/exchanges')} />
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            <View style={[card, { padding: 20, gap: 10, alignItems: 'center' }]}>
              <CircleX size={44} color={colors.down} />
              <Txt style={{ fontSize: 18, fontFamily: font.bold }}>Key refused</Txt>
              <Txt style={{ color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>{result?.message ?? 'Something went wrong.'}</Txt>
              {result && !result.ok && result.forbidden?.length ? (
                <Txt style={{ color: colors.down, fontSize: 13, textAlign: 'center' }}>Switch off: {result.forbidden.join(', ')}</Txt>
              ) : null}
            </View>
            <Button label="Try another key" height={50} iconLeft={<PencilLine size={18} color={colors.dark} />} onPress={() => { setResult(null); setStep(1); }} />
          </View>
        )}
      </Page>
    </SafeAreaView>
  );
}
