// Terms of Service and Privacy Policy shown in the app (/terms, /privacy).
// Written for the app as it is today: demo trading with α credits, real money switched off until licensing.
// Items marked [to confirm] need the owner's details; both documents should be reviewed by a Nigerian lawyer before
// real-money trading is switched on.

export type LegalDoc = { title: string; updated: string; intro: string; sections: { heading: string; body: string[] }[] };

const COMPANY = 'Oliskeylee Ltd';
const ADDRESS = '[registered address, to confirm]';
const RC = '[company registration number, to confirm]';
const EMAIL = 'support@oliskeylee.com';
const WHATSAPP = '0904 941 7103';

export const TERMS: LegalDoc = {
  title: 'Terms of Service',
  updated: '7 November 2026',
  intro:
    `Oliskey Alpha exists to help you understand markets, feel the weight of every decision before money is at stake, and grow `
    + `into a more deliberate trader. These terms explain how the app works, what we promise you, and what we ask of you in `
    + `return. Please read them carefully: by creating an account you agree to them.`,
  sections: [
    {
      heading: '1. Who we are',
      body: [
        `Oliskey Alpha is operated by ${COMPANY}, a company registered in Nigeria (${RC}), with its registered office at ${ADDRESS}. `
        + `"We", "us" and "our" mean ${COMPANY}. "You" means the person using the app.`,
        `You can reach us at ${EMAIL} or on WhatsApp at ${WHATSAPP}.`,
      ],
    },
    {
      heading: '2. Who may use Oliskey Alpha',
      body: [
        'You must be at least 18 years old and able to enter into a binding agreement. By creating an account you confirm that you are.',
        'You may hold one personal account. Accounts are personal and may not be sold, shared or used on behalf of someone else.',
        'You must give accurate information and keep it up to date. We may ask you to verify your identity before certain features, such as withdrawals, become available.',
      ],
    },
    {
      heading: '3. What the app is today',
      body: [
        'Oliskey Alpha currently offers a demo account funded with α (Alpha) credits. α credits are practice units only: they have no cash value, cannot be bought, sold, transferred or withdrawn, and may be reset at any time.',
        'Prices for cryptocurrencies come from a live market source. Prices for every other market in the app are simulated by us for practice and are not live market quotes. Each chart is labelled accordingly.',
        'Real-money accounts, deposits, withdrawals and live trading are built into the app but are switched off. They will only be offered after we hold the required licences and approvals. Until then, nothing in the app involves real money.',
      ],
    },
    {
      heading: '4. Trading products and how results are decided',
      body: [
        'Fixed Time: you forecast whether the price will be higher or lower when the trade ends. If you are right you receive your amount plus the payout shown before you trade; if you are wrong you lose the amount; if the price is unchanged your amount is returned.',
        'InZone: you win if the price is still inside the corridor shown on the chart when the trade ends.',
        'Forex (multiplier): your result moves with the price, multiplied by the multiplier you choose. You can never lose more than the amount you put in.',
        'Close Early: where available, you may end a Fixed Time trade before it expires for the amount shown, which we calculate from the current chance of the trade winning, less a 10% fee. It is never more than 90% of the full win and is not available in the first 2 seconds or the last 3 seconds of a trade.',
        'Every price, settlement and balance is calculated on our servers. The opening and closing quotes recorded by our servers are final. Payouts and conditions are shown before you open each trade.',
      ],
    },
    {
      heading: '5. Risk',
      body: [
        'Trading carries a high risk of losing money. Results in a demo account, in lessons, in the Market Scanner or in any past trade do not predict future results.',
        'Only trade with money you can afford to lose. If real-money trading becomes available, think carefully about whether it is right for you.',
      ],
    },
    {
      heading: '6. Education, AI insights and the Market Scanner',
      body: [
        'Lessons, the Skill Hub, AI trade insights and the Market Scanner are educational. They are not financial, investment, tax or legal advice and are not a recommendation to buy or sell anything.',
        'The Market Scanner reports measured test results and its own live track record, never certainties. Its signals can lose, are for demo accounts only, and are marked Experimental until the evidence is strong enough. It may show none at all.',
        'AI insights explain what happened in a trade you have already finished. They are generated automatically and can be incomplete or wrong.',
      ],
    },
    {
      heading: '7. The AI trading for you',
      body: [
        'You choose how the AI works with your account: Always ask, where it asks you to approve each trade, or Auto trade, where it places trades for you without asking. You can change this at any time on the AI trader page. Changing it does not affect trades already open.',
        'Demo accounts start on Auto trade. The AI may place trades with your α credits until you switch to Always ask. Real-money accounts start on Always ask, and only you can change that.',
        'Each trade the AI places uses the amount you set, at least 100 per trade. It skips a trade rather than change your amount if the trade would be more than 15% of your money, if its open trades would be more than half of your money, or if your balance is too low. Trades it places are marked with the AI mark in your trades and history.',
        'The AI can lose, and it can lose many trades in a row. Its test results and its record on demo accounts do not promise future results. It decides by fixed rules from market data, and it is not personal financial advice: it does not know your circumstances.',
        'Auto trade with real money is not available today, and no real money can be traded by the AI. It will only be offered after real-money trading opens, with the licences and approvals that requires. Choosing Auto trade for real money now only saves your choice. If it becomes available and you use it, you authorise the AI to place real-money trades for you without asking first, you accept that you can lose that money, and the risk is yours.',
        'We may pause the AI, for one market group or for everyone, at any time, for example when its live results fall below its tests or when market data is unavailable. If our servers cannot read fresh prices, the AI places no trades.',
      ],
    },
    {
      heading: '8. Your responsibilities',
      body: [
        'Keep your password private and your devices secure. You are responsible for activity on your account unless it results from our failure to protect it.',
        'Do not misuse the app: no outside automated trading tools (the AI described in these terms is part of the app), scraping, reverse engineering, exploiting bugs or delays, interfering with other users, or attempting to access data that is not yours.',
        'If you find a bug or a security weakness, tell us at the address above. Please do not use or share it.',
      ],
    },
    {
      heading: '9. Rewards, tasks and promotions',
      body: [
        'Tasks, rewards and promo codes may add α credits or, when real-money accounts exist, bonuses. Each offer has its own conditions, shown with the offer. Trades the AI places by itself do not count toward tasks or invite rewards, and do not use your boosts.',
        'We may end or change an offer at any time, and may withdraw rewards obtained through misuse, multiple accounts or errors.',
      ],
    },
    {
      heading: '10. Deposits and withdrawals (when available)',
      body: [
        'When real-money accounts are switched on, deposits and withdrawals will be processed by licensed payment partners. Your identity may need to be verified, and withdrawals are reviewed before they are paid.',
        'Funds must come from, and be paid to, accounts in your own name. We may refuse or delay a transaction to meet our legal duties, including anti-money-laundering rules.',
      ],
    },
    {
      heading: '11. Availability and changes to the app',
      body: [
        'We work hard to keep Oliskey Alpha available and accurate, but we cannot promise that it will always be uninterrupted or free of errors. If a price or settlement is clearly wrong because of a technical fault, we may correct it. If our servers are unavailable when a trade ends, it closes at the real market price at the moment it ended, as soon as that price can be read.',
        'We improve the app continually and may add, change or remove features. Where a change materially affects you, we will tell you in the app.',
      ],
    },
    {
      heading: '12. Closing your account',
      body: [
        'You may delete your account at any time from Profile. Before you do, all real money must be withdrawn and open trades must have finished.',
        'When you delete your account we remove your name, phone number and email, and you can no longer sign in. We keep trade and payment records for as long as the law requires.',
        'We may suspend or close an account that breaks these terms or the law. Where we can, we will tell you why.',
      ],
    },
    {
      heading: '13. Intellectual property',
      body: [
        `The Oliskey Alpha name, logo, design, lessons and software belong to ${COMPANY}. You may use the app for your own personal, non-commercial purposes; you may not copy, resell or build on it without our written permission.`,
      ],
    },
    {
      heading: '14. Liability',
      body: [
        'Nothing in these terms limits liability that cannot be limited by law.',
        'Because the demo account uses α credits with no cash value, we are not liable for any loss of α credits. To the extent the law allows, we are not liable for indirect or consequential losses, or for losses caused by events outside our reasonable control.',
      ],
    },
    {
      heading: '15. Changes to these terms',
      body: [
        'We may update these terms as the app and the law change. The date at the top shows the latest version. If a change is significant we will tell you in the app before it takes effect; continuing to use the app afterwards means you accept it.',
      ],
    },
    {
      heading: '16. Law and disputes',
      body: [
        'These terms are governed by the laws of the Federal Republic of Nigeria. If something goes wrong, please contact us first: most problems are solved quickly. If we cannot resolve it together, the courts of Nigeria will have jurisdiction.',
      ],
    },
    {
      heading: '17. Contact',
      body: [`${COMPANY} · ${EMAIL} · WhatsApp ${WHATSAPP}`],
    },
  ],
};

export const PRIVACY: LegalDoc = {
  title: 'Privacy Policy',
  updated: '7 November 2026',
  intro:
    'Your trust matters more to us than any feature. This policy explains, in plain words, what information Oliskey Alpha '
    + 'collects, why, who it is shared with, how long it is kept, and the choices you have. We collect only what we need to '
    + 'run the app well and keep it safe, and we never sell your personal data.',
  sections: [
    {
      heading: '1. Who is responsible for your data',
      body: [
        `${COMPANY} (${RC}), ${ADDRESS}, is the data controller for Oliskey Alpha under the Nigeria Data Protection Act 2023. `
        + `For any privacy question or request, contact us at ${EMAIL}.`,
      ],
    },
    {
      heading: '2. What we collect',
      body: [
        'Account details: your full name, email address, password (stored only as a secure one-way hash, never in readable form), and your phone number if you add it.',
        'Trading activity: the trades you open and close, amounts, results, balances and the price ticks around each trade, so we can settle trades fairly and show your history. This includes trades the AI places for you, and which signal a trade came from.',
        'Your AI trading choices: Always ask or Auto trade for each kind of money, your amount per trade, and the time you accepted the risk warning for real money.',
        'Notification details: if you switch on alerts when the app is closed, your browser gives us a delivery address and keys for that device, so we can send them. Switching them off removes it.',
        'Identity and payment details, only when real-money accounts are switched on: identity verification results and the bank accounts you save for withdrawals. Card and bank payments are handled by our payment partner; we do not store card numbers.',
        'Technical information: the device and browser type, log data (such as the time of a request and errors) and security events, used to keep the service reliable and protect accounts.',
        'Information stored on your device: your sign-in session, chart settings, favourite markets and chart drawings are kept in your browser or app storage so the app remembers your preferences. We do not use advertising cookies or trackers.',
      ],
    },
    {
      heading: '3. Why we use it',
      body: [
        'To provide the app: create your account, run the demo account, settle trades on our servers, place or ask about AI trades as you have chosen, and show your history and balances.',
        'To keep you and the platform safe: prevent fraud and misuse, secure accounts (including 2-step login for administrators) and investigate problems.',
        'To meet legal obligations: keeping transaction records, verifying identity and preventing money laundering when real-money accounts are available.',
        'To improve Oliskey Alpha: understand which features help people learn, and fix what does not work. The AI learns only from its own trades on its own practice account and from public market data, not from your personal trades.',
        'To talk to you: service messages, security alerts and replies to your questions. We will only send marketing if you agree, and you can stop it at any time.',
      ],
    },
    {
      heading: '4. Our legal bases',
      body: [
        'We process your data to perform our agreement with you (running your account), to meet legal obligations, for our legitimate interests in keeping the service secure and improving it, and with your consent where the law requires it. You can withdraw consent at any time.',
      ],
    },
    {
      heading: '5. Who we share it with',
      body: [
        'We share data only with service providers who help us run the app, under contracts that require them to protect it: hosting and database providers (the app\'s website is served by Vercel), our payment partner (Paystack, when real-money accounts are switched on), and Google, which generates the AI trade insights you request. For an insight we send the facts of that one finished trade (market, direction, amount, times and prices), not your name, email or phone number.',
        'The AI reads public information to do its work: market data from providers such as Binance, Financial Modeling Prep and alternative.me, public news feeds, and research papers from arXiv. It also uses Google to read news headlines and paper summaries. None of this includes your personal data, and your trades and choices are not sent to them.',
        'If you switch on alerts when the app is closed, your browser\'s own push service delivers them. The message says what happened, such as a new signal, and goes to that device.',
        'We may disclose information when the law requires it, to protect the rights and safety of our users, or as part of a sale or restructuring of our business, in which case this policy continues to protect it.',
        'We never sell your personal data.',
      ],
    },
    {
      heading: '6. International transfers',
      body: [
        'Some of our providers store or process data outside Nigeria. When that happens we make sure appropriate safeguards are in place, as the Nigeria Data Protection Act requires.',
      ],
    },
    {
      heading: '7. How long we keep it',
      body: [
        'We keep your account information while your account is open.',
        'When you delete your account we remove your name, phone number and email straight away. Trade and payment records are kept, without those details, for as long as the law requires (for financial records this can be several years), then deleted.',
        'Technical logs are kept for a short period and then deleted.',
      ],
    },
    {
      heading: '8. How we protect it',
      body: [
        'Passwords are stored as one-way hashes. Data travels over encrypted connections. Balances can only be changed by our servers through controlled database functions, and every user can see only their own records. Administrators must use 2-step login. We review and test our security regularly.',
        'No system is perfectly secure. If a breach affects your personal data we will tell you and the Nigeria Data Protection Commission as the law requires.',
      ],
    },
    {
      heading: '9. Your rights',
      body: [
        'You can ask to access the personal data we hold about you, correct it, delete it, restrict or object to how we use it, receive a copy in a portable format, and withdraw any consent you gave.',
        'You can update your name and phone number in Profile and delete your account there. For any other request, write to us; we will reply within 30 days.',
        'If you are not satisfied with our answer, you may complain to the Nigeria Data Protection Commission.',
      ],
    },
    {
      heading: '10. Children',
      body: ['Oliskey Alpha is for people aged 18 and over. We do not knowingly collect data from anyone younger; if we learn that we have, we delete it.'],
    },
    {
      heading: '11. Changes to this policy',
      body: ['We will update this policy when the app or the law changes. The date at the top shows the latest version, and we will tell you in the app about any significant change.'],
    },
    {
      heading: '12. Contact',
      body: [`Privacy questions and requests: ${EMAIL} · WhatsApp ${WHATSAPP} · ${COMPANY}, ${ADDRESS}`],
    },
  ],
};
