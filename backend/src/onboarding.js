// The short check at the end of the lessons. The answers are checked here, never in the app, so trading cannot be unlocked by editing the app.
// The questions and choices themselves are in app/src/content/onboarding.ts, with the same keys.
export const ANSWERS = { lose: 'stake', demo: 'practice', ai: 'mine' };

/** The keys of the questions answered wrongly or not at all. */
export const wrongAnswers = (answers) => Object.entries(ANSWERS).filter(([q, a]) => answers?.[q] !== a).map(([q]) => q);
