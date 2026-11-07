// Accounts sheet: demo (reset), NGN and USDT wallets, "+ Add Account".
import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EllipsisVertical, RotateCcw } from 'lucide-react-native';
import { api, type Account, type ApiError } from '@/lib/api';
import { money } from '@/lib/format';
import { useAccount } from '@/context/AccountContext';
import { colors, font, radius, createStyles } from '@/theme';
import { Dialog } from '@/ui/Dialog';
import { Press } from '@/ui/Press';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';

const NAMES = { DEMO: 'Demo account', NGN: 'NGN Account', USDT: 'USDT Account' } as const;

export function AccountBadge({ type, size = 28 }: { type: Account['type']; size?: number }) {
  const cfg = { DEMO: { bg: colors.demo, t: 'α' }, NGN: { bg: '#15803D', t: '₦' }, USDT: { bg: '#177A5E', t: '₮' } }[type];
  return (
    <View style={{ width: size, height: size, borderRadius: type === 'DEMO' ? 7 : size / 2, backgroundColor: cfg.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Txt style={{ color: type === 'DEMO' ? colors.dark : '#FFFFFF', fontFamily: font.bold, fontSize: size * 0.55 }}>{cfg.t}</Txt>
    </View>
  );
}

export function AccountsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, activeAccount, switchAccount } = useAccount();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);

  const reset = useMutation({
    mutationFn: () => api('/accounts/demo/reset', { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); toast({ title: 'Demo balance restored', message: 'Your demo account is back to α10,000.' }); },
    onError: (e: ApiError) => toast({ title: 'Could not reset', message: e.message, tone: 'down' }),
  });

  return (
    <Sheet open={open} onClose={onClose}>
      <Txt style={styles.title}>Accounts</Txt>
      <View style={{ paddingHorizontal: 14, gap: 4 }}>
        {me?.accounts.map((a) => {
          const active = a.id === activeAccount?.id;
          return (
            <Press key={a.id} style={[styles.row, active && styles.activeRow]} onPress={() => { switchAccount(a.id); onClose(); }}>
              <AccountBadge type={a.type} />
              <View style={{ flex: 1 }}>
                <Txt style={styles.name}>{NAMES[a.type]}</Txt>
                <Txt style={styles.name}>{money(a.balance, a.type)}</Txt>
              </View>
              {a.type === 'DEMO' ? (
                <Press onPress={() => setConfirmReset(true)} hitSlop={10} accessibilityLabel="Reset demo balance">
                  <RotateCcw size={24} color={colors.text} />
                </Press>
              ) : (
                <EllipsisVertical size={24} color={colors.text} />
              )}
            </Press>
          );
        })}
      </View>
      <Dialog
        open={confirmReset}
        title="Reset your demo balance to α10,000?"
        onClose={() => setConfirmReset(false)}
        actions={[
          { label: 'Cancel', onPress: () => setConfirmReset(false), color: colors.muted },
          { label: 'Reset', onPress: () => { setConfirmReset(false); reset.mutate(); } },
        ]}
      />
    </Sheet>
  );
}

const styles = createStyles(() => ({
  title: { fontSize: 17, fontFamily: font.semibold, textAlign: 'center', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72, paddingHorizontal: 14 },
  activeRow: { backgroundColor: colors.surface2, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border },
  name: { fontSize: 16, fontVariant: ['tabular-nums'] },
}));
