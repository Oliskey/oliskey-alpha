// Profitability Boost: the lightning button beside "+". Shows what a boost does and how many you have, and starts one.
// The server decides everything: it checks you have a boost, runs it for 1 hour and raises the payout when a trade opens.
import { useEffect, useState } from 'react';
import { liveUpdate } from '@/lib/liveBatch';
import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { X, Zap } from 'lucide-react-native';
import { BOOST_POINTS, useBoosts } from '@/hooks/useBoosts';
import { useLayout } from '@/hooks/useLayout';
import { api } from '@/lib/api';
import { countdown } from '@/lib/format';
import { colors, createStyles, font } from '@/theme';
import { Button } from '@/ui/Button';
import { glass } from '@/ui/glass';
import { Press } from '@/ui/Press';
import { Reveal } from '@/ui/Reveal';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { Txt } from '@/ui/Txt';

const POINTS = [
  `Adds ${BOOST_POINTS} points to the payout on every Fixed Time asset for 1 hour`,
  'Counts only for trades you open while it is running, on your demo account',
  'No limit on how many trades it covers',
  'Earn one by finishing a task or when a friend you invited finishes a first trade',
];

function Details({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { available, until } = useBoosts();
  const [now, setNow] = useState(() => Date.now());
  const running = until > now;
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => liveUpdate(() => setNow(Date.now()), setNow), 1000);
    return () => clearInterval(t);
  }, [running]);
  const start = useMutation({
    mutationFn: () => api('/boosts/activate', { method: 'POST' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['boosts'] }); setNow(Date.now()); toast({ title: 'Boost started', message: `+${BOOST_POINTS} points on Fixed Time for 1 hour` }); },
    onError: (e: Error) => toast({ title: 'Boost not started', message: e.message, tone: 'down' }),
  });
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt style={{ fontSize: 18, fontFamily: font.bold }}>Profitability Boost</Txt>
        <Press haptic={false} onPress={onClose} accessibilityLabel="Close Profitability Boost"><X size={20} color={colors.text} /></Press>
      </View>
      <View style={{ gap: 8 }}>
        {POINTS.map((p) => (
          <View key={p} style={{ flexDirection: 'row', gap: 8 }}>
            <View style={styles.bullet} />
            <Txt style={{ flex: 1, fontSize: 14, color: colors.muted, lineHeight: 20 }}>{p}</Txt>
          </View>
        ))}
      </View>
      {running ? (
        <View style={styles.state} accessibilityRole="text"><Txt style={{ fontSize: 15, fontFamily: font.semibold, color: colors.up, fontVariant: ['tabular-nums'] }}>{`Running · ${countdown(until - now)} left`}</Txt></View>
      ) : available > 0 ? (
        <Button height={44} label={`Start a boost (${available} available)`} loading={start.isPending} onPress={() => start.mutate()} />
      ) : (
        <Button variant="secondary" height={44} label="No boosts yet: earn one" onPress={() => { onClose(); router.navigate('/rewards'); }} />
      )}
    </View>
  );
}

export function BoostButton({ size = 40 }: { size?: number }) {
  const { isDesktop } = useLayout();
  const { available, until } = useBoosts();
  const [open, setOpen] = useState(false);
  const running = until > Date.now();
  return (
    <View>
      <Press style={[styles.btn, { width: size, height: size }, glass('regular', { shadow: false })]} onPress={() => setOpen((v) => !v)} accessibilityLabel="Profitability Boost" accessibilityState={{ expanded: open }}>
        <Zap size={18} color={running || open ? colors.demo : colors.text} fill={running ? colors.demo : 'transparent'} strokeWidth={2.25} />
        {available > 0 && !running ? <View style={styles.badge}><Txt style={{ fontSize: 10, fontFamily: font.bold, color: colors.dark }}>{available}</Txt></View> : null}
      </Press>
      {isDesktop ? (
        <View style={styles.popAnchor} pointerEvents="box-none">
          <Reveal show={open}>
            <View style={[styles.pop, glass('regular')]}><Details onClose={() => setOpen(false)} /></View>
          </Reveal>
        </View>
      ) : (
        <Sheet open={open} onClose={() => setOpen(false)}>
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}><Details onClose={() => setOpen(false)} /></View>
        </Sheet>
      )}
    </View>
  );
}

const styles = createStyles(() => ({
  btn: { borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  popAnchor: { position: 'absolute', top: 46, left: 0, width: 320, zIndex: 40 },
  pop: { borderRadius: 18, padding: 16 },
  bullet: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.muted, marginTop: 8 },
  state: { height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
}));
