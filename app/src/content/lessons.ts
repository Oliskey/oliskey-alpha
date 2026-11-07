// Skill Hub content. Edit freely: courses, lessons and their pages (intro / content / quiz).
export type Page =
  | { kind: 'intro'; title: string; body: string }
  | { kind: 'content'; title: string; body: string }
  | { kind: 'quiz'; title: string; question: string; answers: { text: string; correct: boolean; why: string }[] };

export type Lesson = { id: string; title: string; pages: Page[] };
export type Course = { id: string; title: string; tag: string; description: string; section: 'first' | 'beyond'; locked?: boolean; lessons: Lesson[] };

export const SECTIONS = {
  first: { title: 'First Steps', description: 'Short lessons that cover the basics before your first trade.' },
  beyond: { title: 'Beyond Basics', description: 'Go deeper once you are comfortable with the terminal.' },
} as const;

export const COURSES: Course[] = [
  {
    id: 'signals', title: 'What a signal is, and is not', tag: '#Signals', section: 'beyond',
    description: 'Why many signals lose, why a high win rate can still lose money, and what a stop does.',
    lessons: [
      {
        id: 'signals-1', title: 'Reading a signal',
        pages: [
          { kind: 'intro', title: 'A signal is an idea', body: 'A signal says a setup looks worth trying. It is never a promise. Nobody can honestly tell you a trade is sure, and anyone who does is a reason to be careful.' },
          { kind: 'content', title: 'Many signals lose', body: 'Losses are normal. A signal can win only about half the time and still be useful, as long as its wins pay enough to cover its losses. That is why each signal shows what it needs to break even.' },
          { kind: 'content', title: 'A high win rate can lose money', body: 'Set a tiny target and a very far stop and you can win almost every trade. Then one loss wipes out hundreds of wins. Always ask how much a win pays and how much a loss costs.' },
          { kind: 'content', title: 'What the stop does', body: 'The stop is the price where the idea is wrong. It closes the trade and limits the loss, so one bad trade cannot take much of your balance. A suggested amount risks about 1% of your balance at the stop.' },
          { kind: 'content', title: 'Tested, then live', body: 'Test results come from past prices and can flatter a method. The live record is the real check, and it takes many signals to mean anything. Experimental means the evidence is not strong enough yet.' },
          { kind: 'quiz', title: 'Check yourself', question: 'A service says its signals win 98% of the time. What should you ask first?', answers: [
            { text: 'How much does one loss cost compared with one win?', correct: true, why: 'Right. With a far stop and a tiny target, a 98% win rate can still lose money overall.' },
            { text: 'Nothing. 98% means it is safe', correct: false, why: 'No method is safe. A high win rate says nothing about how large the losses are.' },
            { text: 'How quickly I can add more money', correct: false, why: 'Be wary of this. First find out how much one loss costs compared with one win.' },
          ] },
        ],
      },
    ],
  },
  {
    id: 'forecast', title: 'How a forecast works', tag: '#Trading Basics', section: 'first',
    description: 'What you are predicting, how long for, and how the result is decided.',
    lessons: [
      {
        id: 'forecast-1', title: 'Up or Down',
        pages: [
          { kind: 'intro', title: 'Your first forecast', body: 'Every Fixed Time trade asks one question: will the price be higher or lower when the time runs out?' },
          { kind: 'content', title: 'The opening price', body: 'When you open a trade, the current price is locked in. Only the price at the very end is compared with it. What happens in between does not decide the result.' },
          { kind: 'content', title: 'The payout', body: 'If you are right you get your amount back plus the payout shown next to the asset, for example 85%. If you are wrong, the amount is lost. If the price ends exactly where it started, your amount is returned.' },
          {
            kind: 'quiz', title: 'Quick check', question: 'You chose Up. The price dips, then ends slightly above your opening price. What happens?',
            answers: [
              { text: 'The trade wins', correct: true, why: 'Only the closing price counts, and it ended above the opening price.' },
              { text: 'The trade loses because the price dipped', correct: false, why: 'Moves during the trade do not matter, only the closing price.' },
              { text: 'The amount is returned', correct: false, why: 'A refund only happens when the closing price equals the opening price.' },
            ],
          },
        ],
      },
      {
        id: 'forecast-2', title: 'Choosing a duration',
        pages: [
          { kind: 'intro', title: 'How long should a trade last?', body: 'Duration changes what you are really betting on.' },
          { kind: 'content', title: 'Short trades are mostly noise', body: 'Over a few seconds, prices wiggle randomly. Longer durations give a trend more time to show, but also more time for the unexpected.' },
          { kind: 'content', title: 'Pick it before you trade', body: 'Decide your duration as part of your plan, not in the moment. Keep it the same for several trades so you can compare results fairly.' },
        ],
      },
    ],
  },
  {
    id: 'risk', title: 'Managing your risk', tag: '#Trading Basics', section: 'first',
    description: 'How much to put on each trade so one bad run does not end your practice.',
    lessons: [
      {
        id: 'risk-1', title: 'Size every trade',
        pages: [
          { kind: 'intro', title: 'The 2% habit', body: 'Many traders keep each trade to a small share of their balance.' },
          { kind: 'content', title: 'Why it matters', body: 'Even a good approach loses several times in a row. With small trades, a losing streak is a dent, not the end.' },
          {
            kind: 'quiz', title: 'Quick check', question: 'Your balance is α10,000. Which amount follows a 2% limit?',
            answers: [
              { text: 'α200', correct: true, why: '2% of 10,000 is 200.' },
              { text: 'α2,000', correct: false, why: 'That is 20% of the balance.' },
              { text: 'α5,000', correct: false, why: 'That is half the balance on one trade.' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'inzone', title: 'Trading the corridor', tag: '#InZone', section: 'first',
    description: 'How InZone trades win when the price stays calm.',
    lessons: [
      {
        id: 'inzone-1', title: 'Inside or outside',
        pages: [
          { kind: 'intro', title: 'A different question', body: 'InZone does not ask about direction. It asks whether the price stays near where it started.' },
          { kind: 'content', title: 'The corridor', body: 'The blue band on the chart is the corridor. Longer trades get a wider corridor, because prices travel further over more time.' },
        ],
      },
    ],
  },
  {
    id: 'multipliers', title: 'Multipliers explained', tag: '#Forex', section: 'beyond', locked: true,
    description: 'How a multiplier scales both profit and loss.',
    lessons: [{ id: 'mult-1', title: 'Leverage basics', pages: [{ kind: 'intro', title: 'Coming soon', body: 'This course unlocks on live accounts.' }] }],
  },
  {
    id: 'patterns', title: 'Reading candles', tag: '#Analysis', section: 'beyond', locked: true,
    description: 'What candle shapes can and cannot tell you.',
    lessons: [{ id: 'pat-1', title: 'Candle anatomy', pages: [{ kind: 'intro', title: 'Coming soon', body: 'This course unlocks on live accounts.' }] }],
  },
];

export const courseById = (id: string) => COURSES.find((c) => c.id === id);
export const lessonById = (id: string) => {
  for (const c of COURSES) {
    const l = c.lessons.find((x) => x.id === id);
    if (l) return { course: c, lesson: l };
  }
  return undefined;
};
