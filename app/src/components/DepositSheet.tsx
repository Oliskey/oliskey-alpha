// Deposit (NGN via Paystack). While real money is switched off the form explains it is coming soon.
import { useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { ChevronRight, Diamond, Landmark, Lock, X } from 'lucide-react-native';
import { api, type PromoCode } from '@/lib/api';
import { money } from '@/lib/format';
import { useAccount } from '@/context/AccountContext';
import { useSettings } from '@/hooks/useSettings';
import { colors, font, radius, SIDE, type, createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Press } from '@/ui/Press';
import { SideScroll } from '@/ui/kit';
import { FadeIn } from '@/ui/FadeIn';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';
import { WalletLoader } from './WalletLoader';

const PRESETS = [5000, 10000, 20000, 50000, 100000];
const SMART_AT = 100000;

export function DepositSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useAccount();
  const settings = useSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const promos = useQuery({ queryKey: ['promos'], queryFn: () => api<PromoCode[]>('/promo-codes'), enabled: open });
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [promo, setPromo] = useState<string | null>(null);
  const [pickPromo, setPickPromo] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true); setAmount(''); setPromo(null); setError('');
    const id = setTimeout(() => setLoading(false), 1200);
    return () => clearTimeout(id);
  }, [open]);

  const ngn = me?.accounts.find((a) => a.type === 'NGN');
  const live = settings.data?.live_trading_enabled;
  const n = Number(amount) || 0;

  const close = () => (n > 0 ? setConfirmLeave(true) : onClose());

  const next = async () => {
    setError(''); setBusy(true);
    try {
      const r = await api<{ reference: string; authorizationUrl: string }>('/payments/deposit', {
        method: 'POST', body: { accountId: ngn!.id, amount: n, promoCode: promo ?? undefined },
      });
      await WebBrowser.openBrowserAsync(r.authorizationUrl);
      for (let i = 0; i < 40; i++) {
        const v = await api<{ status: string }>(`/payments/verify/${r.reference}`);
        if (v.status === 'completed') { toast({ title: 'Deposit received', message: money(n, 'NGN'), tone: 'up' }); qc.invalidateQueries({ queryKey: ['me'] }); onClose(); return; }
        if (v.status !== 'pending') { setError('The payment was not completed.'); return; }
        await new Promise((res) => setTimeout(res, 3000));
      }
      setError('We are still waiting for the bank. Your balance updates as soon as the payment is confirmed.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={close} fullHeight>
      {loading ? <WalletLoader /> : (
        <FadeIn rise={8}><ScrollView contentContainerStyle={{ paddingHorizontal: SIDE, gap: 14 }} keyboardShouldPersistTaps="handled">
          <View style={styles.titleRow}>
            <Txt style={type.screenTitle}>Deposit</Txt>
            <Press onPress={close} accessibilityLabel="Close"><X size={24} color={colors.text} /></Press>
          </View>

          {!live ? (
            <View style={styles.notice}>
              <Txt style={{ fontFamily: font.bold }}>Real-money trading is coming soon</Txt>
              <Txt style={{ color: colors.muted, fontSize: 14 }}>Deposits open once Oliskey Alpha is licensed. Until then, practise with your demo account.</Txt>
            </View>
          ) : null}

          <View style={styles.methodRow}>
            <Landmark size={28} color={colors.text} />
            <Txt style={{ flex: 1, fontSize: 17, fontFamily: font.bold }}>Bank transfer or card (Paystack)</Txt>
            <ChevronRight size={20} color={colors.text} />
          </View>

          <View style={styles.amountBox}>
            <Txt style={{ fontSize: 13, color: colors.muted }}>Amount</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Txt style={{ fontSize: 20 }}>₦ </Txt>
              <TextInput value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad"
                placeholder="0" placeholderTextColor={colors.muted}
                style={[{ flex: 1, color: colors.text, fontSize: 20, paddingVertical: 2 }, { outlineStyle: 'none' } as object]} />
            </View>
          </View>
          <SideScroll contentContainerStyle={{ gap: 8 }}>
            {PRESETS.map((p) => (
              <Press key={p} style={styles.preset} haptic={false} onPress={() => setAmount(String(p))}>
                <Txt>₦{p.toLocaleString()}</Txt>
              </Press>
            ))}
          </SideScroll>

          <View style={{ gap: 6 }}>
            <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.min(100, (n / SMART_AT) * 100)}%` }]} /></View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Txt style={{ color: colors.muted, fontSize: 14 }}>
                Deposit <Txt style={{ textDecorationLine: 'underline', color: colors.muted, fontSize: 14 }}>₦{SMART_AT.toLocaleString()}</Txt> to reach Smart
              </Txt>
              <Diamond size={16} color={colors.accent} />
            </View>
            {Number(settings.data?.withdrawal_fee_pct ?? 0) > 0 ? (
              <Txt style={{ color: colors.muted, fontSize: 13 }}>
                Withdrawals carry a {Number(settings.data?.withdrawal_fee_pct)}% fee, shown before you confirm.
              </Txt>
            ) : null}
          </View>

          <Press style={styles.methodRow} onPress={() => setPickPromo(true)}>
            <Txt style={{ flex: 1, fontSize: 17, fontFamily: font.bold }}>{promo ? `Promo: ${promo}` : 'Choose Promo Code'}</Txt>
            <Txt style={{ color: colors.muted }}>{promos.data?.length ?? 0}</Txt>
          </Press>

          {error ? <Txt style={{ color: colors.down }}>{error}</Txt> : null}
          <Button label="Next" height={52} disabled={!live || n <= 0} loading={busy} onPress={next} />

          <View style={{ alignItems: 'center', gap: 8, marginTop: 8 }}>
            <View style={styles.lock}><Lock size={22} color={colors.text} /></View>
            <Txt style={{ color: colors.muted, fontSize: 13, textAlign: 'center' }}>
              Payments are processed by Paystack over an encrypted connection. Oliskey Alpha never sees your card details.
            </Txt>
          </View>
        </ScrollView></FadeIn>
      )}

      <Sheet open={pickPromo} onClose={() => setPickPromo(false)}>
        <View style={{ paddingHorizontal: SIDE, gap: 8 }}>
          <Txt style={{ fontSize: 17, fontFamily: font.semibold, textAlign: 'center' }}>Promo codes</Txt>
          {(promos.data ?? []).map((p) => (
            <Press key={p.code} style={[styles.methodRow, promo === p.code && { borderWidth: 1, borderColor: colors.accent }]} haptic={false}
              onPress={() => { setPromo(promo === p.code ? null : p.code); setPickPromo(false); }}>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontFamily: font.bold }}>{p.code}</Txt>
                <Txt style={{ color: colors.muted, fontSize: 13 }}>{p.description}</Txt>
              </View>
            </Press>
          ))}
        </View>
      </Sheet>

      <Dialog
        open={confirmLeave} title="Sure you want to leave?" onClose={() => setConfirmLeave(false)}
        actions={[
          { label: 'Stay', onPress: () => setConfirmLeave(false) },
          { label: 'Leave', onPress: () => { setConfirmLeave(false); onClose(); } },
        ]}
      />
    </Sheet>
  );
}

const styles = createStyles(() => ({
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notice: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14, gap: 4 },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 14, borderRadius: radius.card, backgroundColor: colors.surface2 },
  amountBox: { minHeight: 72, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center' },
  preset: { height: 40, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surface2, justifyContent: 'center' },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.surface2, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: colors.accent },
  lock: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
}));
