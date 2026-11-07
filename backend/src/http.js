// Turns the error codes raised by the database money functions into messages for the app.
const MESSAGES = {
  INSUFFICIENT_FUNDS: 'Not enough funds on this account.',
  LIVE_TRADING_DISABLED: 'Real-money trading is coming soon. Switch to your demo account to trade.',
  ACCOUNT_NOT_FOUND: 'Account not found.',
  ASSET_UNAVAILABLE: 'This asset is not available right now.',
  INVALID_AMOUNT: 'Enter an amount of at least 1 with no more than 2 decimals.',
  INVALID_QUOTE: 'No price is available right now. Try again.',
  INVALID_DURATION: 'Choose a duration between 5 seconds and 4 hours.',
  DIRECTION_REQUIRED: 'Choose Up or Down.',
  INVALID_LEVERAGE: 'That multiplier is above the maximum for this asset.',
  OPEN_TRADES_EXIST: 'Wait for your open demo trades to close before resetting.',
  TRADE_NOT_FOUND: 'Trade not found.',
  KYC_REQUIRED: 'Verify your identity before withdrawing.',
  PAYOUT_METHOD_NOT_FOUND: 'Choose a saved bank account.',
  DEMO_NOT_WITHDRAWABLE: 'Demo funds cannot be withdrawn.',
  BELOW_MIN_WITHDRAWAL: 'This is below the minimum withdrawal.',
  PROMO_UNAVAILABLE: 'This promo code is not available.',
  ALREADY_RESOLVED: 'This withdrawal has already been handled.',
  WITHDRAWAL_NOT_FOUND: 'Withdrawal not found.',
  DEPOSIT_NOT_FOUND: 'Deposit not found.',
  AMOUNT_MISMATCH: 'The paid amount does not match the deposit.',
  TRADE_ALREADY_CLOSED: 'This trade has already closed.',
  CLOSE_EARLY_NOT_ALLOWED: 'Only Fixed Time trades can be closed early.',
  CLOSE_EARLY_TOO_SOON: 'Close Early opens 2 seconds after the trade starts.',
  CLOSE_EARLY_TOO_LATE: 'Too close to the end: Close Early stops 3 seconds before expiry.',
  INVALID_EARLY_RETURN: 'The early close amount is out of range. Try again.',
  ACCOUNT_HAS_OPEN_TRADES: 'Wait for your open trades to close before deleting your account.',
  NO_PRICE: 'No price is available for this asset right now. Try again in a moment.',
  ZONE_UNAVAILABLE: 'InZone is not available for this asset right now. Try again in a little while.',
  NO_BOOST_AVAILABLE: 'You have no boosts yet. Finish a task or invite a friend to earn one.',
  BOOST_ALREADY_ACTIVE: 'A boost is already running.',
  BONUS_NOT_WITHDRAWABLE: 'A trading bonus can be traded but not withdrawn. You can withdraw the profit you make with it.',
  RISK_FREE_LIMIT: 'You have used your 3 risk-free trades for today. They come back tomorrow.',
  RISK_FREE_NOT_ALLOWED: 'Risk-free is available for demo Fixed Time and InZone trades.',
  WITHDRAW_FUNDS_FIRST: 'Withdraw all money from your NGN and USDT accounts (and wait for pending withdrawals) before deleting your account.',
};

// The app-facing message for a money-rule error code (used where the error is stored, e.g. a failed order).
export const messageFor = (code) => MESSAGES[code] ?? code;

// Express error handler: known money-rule errors become 400s, anything else is a logged 500.
export function errorHandler(err, _req, res, _next) {
  const message = MESSAGES[err?.message];
  if (message) return res.status(400).json({ error: message, code: err.message });
  // Body-parser errors are the client's fault: malformed JSON or a body over the size limit.
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'The request body is too large.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

export const isUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
