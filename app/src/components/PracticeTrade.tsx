// The guided practice trade in the lessons (owner choice 2026-11-07, option 1). It looks like the trade screen and walks through it one part at a time,
// then plays two fixed rounds: one win and one loss, so both outcomes are seen before real demo trading opens.
// Practice only: no account, no balance and no server are involved. The amounts are fixed examples, not anyone's money.
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { ArrowDown, ArrowUp, Clock, Minus, Plus } from 'lucide-react-native';
import { colors, font, createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { prefersReducedMotion } from '@/ui/Press';
import { Txt } from '@/ui/Txt';

const W = 320, H = 150, STEPS = 40;
const PAYOUT = 0.8, STAKE = 10;     // the example shown: α10 at 80%
type Step = 'chart' | 'amount' | 'time' | 'up' | 'won' | 'down' | 'lost';
const NOTES: Record<Step, string> = {
  chart: 'This is the price chart. It moves all the time.',
  amount: 'This is the amount you put in. You lose it if the trade is wrong.',
  time: 'This is how long the trade lasts. It closes by itself at the end.',
  up: 'Think the price will be higher at the end? Tap Up.',
  won: `It finished higher, so this practice trade won α${(STAKE * PAYOUT).toFixed(2)}.`,
  down: 'Not every trade wins. Now tap Down.',
  lost: `It finished higher, so this practice trade lost the α${STAKE.toFixed(2)} put in. Real trades can lose like this.`,
};
const ORDER: Step[] = ['chart', 'amount', 'time', 'up', 'won', 'down', 'lost'];

// a calm, fixed start, so everyone sees the same thing
const START = Array.from({ length: 24 }, (_, i) => 100 + Math.sin(i / 2.3) * 0.6 + Math.sin(i / 5.1) * 0.4);

export function PracticeTrade({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('chart');
  const [prices, setPrices] = useState<number[]>(START);
  const [entry, setEntry] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // a fixed rise in both rounds: right for Up, wrong for Down
  const play = (next: Step) => {
    const from = prices[prices.length - 1];
    setEntry(from);
    const moves = Array.from({ length: 10 }, (_, i) => from + (i + 1) * 0.12 + Math.sin(i) * 0.05);
    if (prefersReducedMotion()) { setPrices((p) => [...p, ...moves].slice(-STEPS)); setStep(next); return; }
    let i = 0;
    setLeft(5);
    timer.current = setInterval(() => {
      const value = moves[i];   // read now: the update below runs later, after i has moved on
      setPrices((p) => [...p, value].slice(-STEPS));
      i++;
      setLeft(Math.max(0, 5 - Math.floor(i / 2)));
      if (i >= moves.length) { clearInterval(timer.current!); timer.current = null; setStep(next); }
    }, 500);
  };
  const running = left > 0 && (step === 'up' || step === 'down') && entry !== null;

  const lo = Math.min(...prices) - 0.3, hi = Math.max(...prices) + 0.3;
  const x = (i: number) => (i / (STEPS - 1)) * W;
  const y = (p: number) => H - ((p - lo) / (hi - lo)) * H;
  const path = prices.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  const lit = (s: Step | Step[]) => (Array.isArray(s) ? s : [s]).includes(step);
  const dim = (s: Step | Step[]) => ({ opacity: lit(s) ? 1 : 0.32 });
  const ring = (s: Step | Step[]) => (lit(s) ? styles.lit : null);
  const nextOf = () => ORDER[ORDER.indexOf(step) + 1];

  return (
    <View style={{ gap: 12 }} testID="practice-trade">
      <View style={styles.badge}><Txt style={styles.badgeText}>Practice, no money</Txt></View>

      <View style={[styles.box, ring('chart'), dim(['chart', 'up', 'won', 'down', 'lost'])]}>
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {entry !== null ? <Line x1={0} x2={W} y1={y(entry)} y2={y(entry)} stroke={colors.muted} strokeDasharray="4 4" strokeWidth={1} /> : null}
          <Path d={path} stroke={colors.zone} strokeWidth={2.5} fill="none" strokeLinejoin="round" />
        </Svg>
        {running ? <Txt style={styles.count}>{`0:0${left}`}</Txt> : null}
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={[styles.box, styles.control, { flex: 1 }, ring('amount'), dim('amount')]}>
          <Minus size={18} color={colors.muted} />
          <View style={{ alignItems: 'center' }}>
            <Txt style={styles.caption}>Amount</Txt>
            <Txt style={styles.value}>α{STAKE.toFixed(2)}</Txt>
          </View>
          <Plus size={18} color={colors.muted} />
        </View>
        <View style={[styles.box, styles.control, { width: 110, justifyContent: 'center', gap: 8 }, ring('time'), dim('time')]}>
          <Clock size={18} color={colors.muted} />
          <Txt style={styles.value}>5 s</Txt>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={[{ flex: 1 }, ring('down'), dim('down'), styles.round]}>
          <Button label="Down" variant="down" height={54} spread icon={<ArrowDown size={20} color="#000" />} disabled={step !== 'down' || running} onPress={() => play('lost')} />
        </View>
        <View style={[{ flex: 1 }, ring('up'), dim('up'), styles.round]}>
          <Button label="Up" variant="up" height={54} spread icon={<ArrowUp size={20} color="#000" />} disabled={step !== 'up' || running} onPress={() => play('won')} />
        </View>
      </View>

      <View style={[styles.note, step === 'won' ? { borderColor: colors.up } : step === 'lost' ? { borderColor: colors.down } : null]} accessibilityLiveRegion="polite">
        {step === 'won' || step === 'lost' ? (
          <Txt style={[styles.result, { color: step === 'won' ? colors.up : colors.down }]}>
            {step === 'won' ? `+α${(STAKE * PAYOUT).toFixed(2)} practice win` : `-α${STAKE.toFixed(2)} practice loss`}
          </Txt>
        ) : null}
        <Txt style={styles.noteText}>{running ? 'Waiting for the trade to end…' : NOTES[step]}</Txt>
        {step === 'chart' || step === 'amount' || step === 'time' || step === 'won' ? (
          <Button label="Next" variant="secondary" height={46} onPress={() => setStep(nextOf())} />
        ) : step === 'lost' ? (
          <Button label="I understand" variant="secondary" height={46} onPress={onDone} />
        ) : null}
      </View>
    </View>
  );
}

const styles = createStyles(() => ({
  badge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.demo },
  badgeText: { fontSize: 13, fontFamily: font.semibold, color: colors.demo },
  box: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  control: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, height: 60 },
  caption: { fontSize: 12, color: colors.muted },
  value: { fontSize: 17, fontFamily: font.bold, fontVariant: ['tabular-nums'] },
  count: { position: 'absolute', right: 10, top: 8, fontSize: 13, fontFamily: font.semibold, color: colors.text, fontVariant: ['tabular-nums'] },
  lit: { borderColor: colors.accent, borderWidth: 2 },
  round: { borderRadius: 999 },
  note: { gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface2 },
  noteText: { fontSize: 15, lineHeight: 22, color: colors.text },
  result: { fontSize: 22, fontFamily: font.bold, fontVariant: ['tabular-nums'] },
}));
