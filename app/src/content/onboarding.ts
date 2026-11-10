// The lessons every new person goes through before they can trade (owner decision 2026-11-07). Short, plain, and honest that every trade can lose.
// The check's answers are verified by the server (backend/src/onboarding.js uses the same keys).
import { ArrowUpDown, ChartCandlestick, CircleDollarSign, ShieldAlert, Target, TrendingUp, type LucideIcon } from 'lucide-react-native';

export type Lesson = { icon: LucideIcon; color: 'violet' | 'teal' | 'blue' | 'amber' | 'pink'; title: string; lines: string[] };

export const LESSONS: Lesson[] = [
  { icon: CircleDollarSign, color: 'amber', title: 'Welcome to Oliskey Alpha', lines: [
    'Your demo account has α10,000 to practise with.',
    'α is practice money. It is not real money.',
    'A few short steps, then you can trade.',
  ] },
  { icon: ChartCandlestick, color: 'violet', title: 'How a trade works', lines: [
    'You choose a market, an amount and how long the trade lasts.',
    'If your trade is right when it ends, you earn the payout shown before you trade.',
    'If it is wrong, you lose the amount you put in.',
  ] },
  { icon: TrendingUp, color: 'teal', title: 'Fixed Time', lines: [
    'Will the price be higher or lower when the time runs out?',
    'Tap Up or Down. The trade closes by itself at the end.',
  ] },
  { icon: Target, color: 'blue', title: 'InZone', lines: [
    'Will the price finish inside the corridor shown on the chart?',
    'Quiet markets suit it. A sudden move takes the price outside, and the trade is lost.',
  ] },
  { icon: ArrowUpDown, color: 'violet', title: 'Forex', lines: [
    'Buy if you think the price will rise, Sell if it will fall.',
    'A multiplier makes every move bigger, the losses as well as the profits.',
    'You close it when you choose, or set a take profit and a stop loss.',
  ] },
  { icon: ShieldAlert, color: 'pink', title: 'Every trade can lose', lines: [
    'Nobody wins every trade, and many trades can lose in a row.',
    'Trade small amounts, and only what you can afford to lose.',
    'History shows each day and week: what you traded, won and lost.',
  ] },
];

export const AI_LESSON = {
  title: 'Your AI trader',
  lines: [
    'The AI can trade for you. Every AI trade uses your own account, at the amount you set.',
    'Its wins and its losses change your balance, and you see each one in your trades.',
    'It can lose. You can change this choice at any time.',
  ],
};

export const QUIZ = [
  { key: 'lose', question: 'A Fixed Time trade ends wrong. What happens?', choices: [
    { key: 'stake', label: 'I lose the amount I put in' }, { key: 'nothing', label: 'Nothing, it is refunded' }, { key: 'double', label: 'I lose twice the amount' },
  ] },
  { key: 'demo', question: 'What is α on the demo account?', choices: [
    { key: 'real', label: 'Real money I can withdraw' }, { key: 'practice', label: 'Practice money, not real' },
  ] },
  { key: 'ai', question: 'When the AI trades for you, whose money does it use?', choices: [
    { key: 'company', label: "The company's money" }, { key: 'mine', label: 'My own account' }, { key: 'none', label: 'None, it only practises' },
  ] },
] as const;
