import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Info } from 'lucide-react-native';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { useAccount } from '@/context/AccountContext';
import { useSettings } from '@/hooks/useSettings';
import { AccountBadge } from '@/components/AccountsSheet';
import { DepositSheet } from '@/components/DepositSheet';
import { WalletLoader } from '@/components/WalletLoader';
import { card, colors, font, radius, createStyles } from '@/theme';
import { AppBar } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Press } from '@/ui/Press';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';
import { Page } from '@/ui/Page';

type Withdrawal = { id: string; status: string; amount: string; created_at: string; fee: string | null; payout: string | null };

export default function Withdraw() {
  const { me } = useAccount();
  const settings = useSettings();
  const [loading, setLoading] = useState(true);
  const [deposit, setDeposit] = useState(false);
  useEffect(() => { const id = setTimeout(() => setLoading(false), 1000); return () => clearTimeout(id); }, []);
  const history = useQuery({ queryKey: ['withdrawals'], queryFn: () => api<Withdrawal[]>('/payments/withdrawals') });

  const ngn = me?.accounts.find((a) => a.type === 'NGN');
  const available = Number(ngn?.balance ?? 0);
  const live = settings.data?.live_trading_enabled;
  const feePct = Number(settings.data?.withdrawal_fee_pct ?? 0);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AppBar title="Withdraw" width="narrow" />
      {loading ? <WalletLoader /> : (
        <Page width="narrow" gap={12}>
          <View style={styles.from}>
            <AccountBadge type="NGN" />
            <View style={{ flex: 1 }}>
              <Txt style={{ color: colors.muted, fontSize: 14 }}>From NGN Account</Txt>
              <Txt style={{ fontSize: 20 }}>{money(available, 'NGN')}</Txt>
            </View>
            <ChevronRight size={20} color={colors.text} />
          </View>

          <View style={styles.notice}>
            <Info size={22} color={colors.muted} />
            <View style={{ flex: 1, gap: 6 }}>
              <Txt style={{ color: colors.muted, fontSize: 16 }}>
                {!live
                  ? 'Real-money trading is coming soon. Withdrawals open once Oliskey Alpha is licensed.'
                  : available <= 0
                    ? 'You have insufficient funds to make a withdrawal from this account'
                    : `Withdrawals need a verified identity and are approved by our team.${feePct > 0 ? ` A ${feePct}% withdrawal fee applies.` : ''}`}
              </Txt>
              {live && available <= 0 ? (
                <Press onPress={() => setDeposit(true)} haptic={false}>
                  <Txt style={{ color: colors.accent, fontSize: 16, fontFamily: font.bold }}>Make Deposit {'>'}</Txt>
                </Press>
              ) : null}
            </View>
          </View>

          {live && available > 0 && ngn ? <WithdrawForm accountId={ngn.id} max={available} feePct={feePct} onDone={() => void history.refetch()} /> : null}

          {history.data?.length ? (
            <View style={{ gap: 8, marginTop: 8 }}>
              <Txt style={{ fontSize: 17, fontFamily: font.bold }}>Past withdrawals</Txt>
              {history.data.map((w) => (
                <View key={w.id} style={styles.row}>
                  <View>
                    <Txt>{money(-Number(w.amount), 'NGN')}</Txt>
                    {w.fee != null && Number(w.fee) > 0 ? (
                      <Txt style={{ color: colors.muted, fontSize: 13 }}>Fee {money(Number(w.fee), 'NGN')} · to bank {money(Number(w.payout), 'NGN')}</Txt>
                    ) : null}
                  </View>
                  <Txt style={{ color: w.status === 'completed' ? colors.up : w.status === 'rejected' ? colors.down : colors.muted }}>{w.status}</Txt>
                </View>
              ))}
            </View>
          ) : null}
        </Page>
      )}
      <DepositSheet open={deposit} onClose={() => setDeposit(false)} />
    </SafeAreaView>
  );
}

type PayoutMethod = { id: string; bank_name: string; account_number: string; account_name: string };
type Bank = { name: string; code: string };

function WithdrawForm({ accountId, max, feePct, onDone }: { accountId: string; max: number; feePct: number; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const methods = useQuery({ queryKey: ['payout-methods'], queryFn: () => api<PayoutMethod[]>('/payments/payout-methods') });
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => api<Bank[]>('/payments/banks'), staleTime: Infinity });
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [bank, setBank] = useState<Bank | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [pickBank, setPickBank] = useState(false);
  const [busy, setBusy] = useState(false);
  // Shown before the user confirms; the server fixes the same rate on the request (round to kobo, as the database does).
  const asked = Number(amount) || 0;
  const fee = Math.round(asked * feePct) / 100;
  const toBank = Math.max(0, Math.round((asked - fee) * 100) / 100);

  const addBank = async () => {
    setBusy(true);
    try {
      const m = await api<PayoutMethod>('/payments/payout-methods', { method: 'POST', body: { bankCode: bank!.code, bankName: bank!.name, accountNumber } });
      await qc.invalidateQueries({ queryKey: ['payout-methods'] });
      setMethodId(m.id); setAdding(false); setAccountNumber('');
      toast({ title: 'Bank account added', message: m.account_name });
    } catch (e) { toast({ title: 'Could not add bank', message: (e as Error).message, tone: 'down' }); } finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true);
    try {
      await api('/payments/withdraw', { method: 'POST', body: { accountId, amount: Number(amount), payoutMethodId: methodId } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      setAmount(''); onDone();
      toast({ title: 'Withdrawal requested', message: 'Our team reviews it before the transfer is sent.' });
    } catch (e) { toast({ title: 'Withdrawal not sent', message: (e as Error).message, tone: 'down' }); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 10 }}>
      <Field label={`Amount (max ${money(max, 'NGN')})`} value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" />
      {(methods.data ?? []).map((m) => (
        <Press key={m.id} haptic={false} onPress={() => setMethodId(m.id)} style={[styles.row, methodId === m.id && { borderWidth: 1, borderColor: colors.accent }]}>
          <Txt>{m.bank_name} · {m.account_number}</Txt>
          <Txt style={{ color: colors.muted }}>{m.account_name}</Txt>
        </Press>
      ))}
      {adding ? (
        <View style={{ gap: 10 }}>
          <Press style={styles.row} onPress={() => setPickBank(true)}><Txt>{bank?.name ?? 'Choose bank'}</Txt><ChevronRight size={18} color={colors.text} /></Press>
          <Field label="Account number" value={accountNumber} onChangeText={(v) => setAccountNumber(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
          <Button variant="secondary" label="Verify and save" loading={busy} disabled={!bank || accountNumber.length !== 10} onPress={addBank} />
        </View>
      ) : (
        <Button variant="secondary" label="Add bank account" onPress={() => setAdding(true)} />
      )}
      {asked > 0 && feePct > 0 ? (
        <View style={styles.breakdown}>
          <View style={styles.line}><Txt style={{ color: colors.muted }}>You withdraw</Txt><Txt>{money(asked, 'NGN')}</Txt></View>
          <View style={styles.line}><Txt style={{ color: colors.muted }}>Withdrawal fee ({feePct}%)</Txt><Txt style={{ color: colors.down }}>-{money(fee, 'NGN')}</Txt></View>
          <View style={[styles.line, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }]}>
            <Txt style={{ fontFamily: font.bold }}>Sent to your bank</Txt><Txt style={{ fontFamily: font.bold, color: colors.up }}>{money(toBank, 'NGN')}</Txt>
          </View>
        </View>
      ) : null}
      <Button label={asked > 0 && feePct > 0 ? `Withdraw · receive ${money(toBank, 'NGN')}` : 'Withdraw'} height={52} loading={busy} disabled={!methodId || !(Number(amount) > 0) || Number(amount) > max} onPress={submit} />
      <Sheet open={pickBank} onClose={() => setPickBank(false)}>
        <ScrollView style={{ maxHeight: 460 }}>
          {(banks.data ?? []).map((b) => (
            <Press key={b.code} haptic={false} style={{ height: 48, justifyContent: 'center', paddingHorizontal: 20 }} onPress={() => { setBank(b); setPickBank(false); }}>
              <Txt>{b.name}</Txt>
            </Press>
          ))}
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = createStyles(() => ({
  from: { ...card, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, padding: 14 },
  notice: { flexDirection: 'row', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14 },
  row: { ...card, flexDirection: 'row', justifyContent: 'space-between', padding: 14 },
  breakdown: { ...card, gap: 8, padding: 14 },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
}));
