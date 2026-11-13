// Oliskey AI Trading (exchange-connected, non-custodial): types for the /trading API and plain-language labels.
// Money arrives from the server as exact decimal strings and is only re-formatted here as text, never turned into a float.
// The server decides everything (risk, orders, profit, commission); the app only shows it.

export type Availability = 'live' | 'testnet_only' | 'coming_soon';
export type Connection = {
  id: string; provider_id: string; environment: 'testnet' | 'live'; label: string | null; key_hint: string | null;
  permissions: Record<string, unknown> | null; status: string; status_detail: string | null; last_verified_at: string | null; created_at: string;
};
export type Exchange = {
  id: string; name: string; phase: number; website_url: string; key_settings_url: string; requires_passphrase: boolean;
  availability: Availability; capabilities: string[]; connections: Connection[];
};
export type Strategy = {
  id: string; name: string; style: string; profile: string; summary: string;
  subscription: { status: string; current_period_end: string } | null;
  version: { version: string; status: string } | null;
  preview: { trades: number | null; period: string | null } | null;
  readyToTrade: boolean;
};
export type Controls = { platform_paused: boolean; emergency_stop: boolean; live_trading_enabled: boolean };
export type TradingMe = { tradingPaused: boolean; platform: Controls | null; twoStep: boolean };
export type Position = { strategy_id: string; environment: string; symbol: string; quantity: string; cost_basis: string; realised_pnl: string; fees_quote: string; status: string; opened_at: string; closed_at: string | null };
export type Order = { id: string; strategy_id: string; environment: string; symbol: string; side: 'buy' | 'sell'; type: string; quantity: string | null; quote_quantity: string | null; status: string; status_detail: string | null; created_at: string };
export type Fill = { strategy_id: string; environment: string; symbol: string; side: 'buy' | 'sell'; price: string; quantity: string; quote_quantity: string; fee: string; fee_asset: string; filled_at: string };
export type Statement = {
  startingCapital: string; exchangeBalance: string; realisedNetProfit: string; unrealisedProfitEstimate: string; tradingFees: string;
  alreadyCharged: string; eligibleNow: string; commissionNow: string; customerShareNow: string; commissionPaid: string; commissionOutstanding: string;
  notes: string[]; balanceReported: boolean;
  invoices: { number: string; commission: string; status: string; issued_at: string; paid_at: string | null }[];
};

export const STRATEGY_NAMES: Record<string, string> = {
  strict_scalping: 'Strict Scalping', balanced_scalping: 'Balanced Scalping', strict_swing: 'Strict Swing', balanced_swing: 'Balanced Swing',
};
export const strategyName = (id: string) => STRATEGY_NAMES[id] ?? id;
export const pair = (symbol: string) => symbol.replace(/USDT$/, '/USDT');
export const envLabel = (e: string) => (e === 'live' ? 'Real money' : e === 'testnet' ? 'Testnet' : 'Practice');

/** "1234.5" -> "1,234.50"; exact text formatting of a decimal string (rounded half up at `dp`). */
export function decimal(value: string | null | undefined, dp = 2): string {
  if (value === null || value === undefined || !/^-?\d+(\.\d+)?$/.test(String(value))) return '–';
  const s = String(value); const neg = s.startsWith('-');
  const [i0, f0 = ''] = (neg ? s.slice(1) : s).split('.');
  let digits = BigInt(i0 + (f0 + '0'.repeat(dp + 1)).slice(0, dp + 1));
  digits = (digits + 5n) / 10n;   // half up on the extra digit
  const all = digits.toString().padStart(dp + 1, '0');
  const int = all.slice(0, all.length - dp) || '0', frac = dp ? all.slice(-dp) : '';
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const zero = /^0*$/.test(int + frac);
  return `${neg && !zero ? '-' : ''}${grouped}${dp ? '.' + frac : ''}`;
}
export const usdt = (v: string | null | undefined, dp = 2) => `${decimal(v, dp)} USDT`;
/** green / red / plain for a signed decimal string */
export const tone = (v: string | null | undefined) => (!v || /^-?0*(\.0*)?$/.test(v) ? 'plain' : v.startsWith('-') ? 'down' : 'up');

export const STATUS_WORDS: Record<string, string> = {
  active: 'Connected', invalid: 'Key refused', error: 'Needs checking', revoked: 'Disconnected',
  filled: 'Done', partially_filled: 'Partly done', new: 'Sent', pending: 'Waiting', rejected: 'Refused', cancelled: 'Cancelled', failed: 'Failed', unknown: 'Checking',
  open: 'Open', closed: 'Closed',
};
export const statusWord = (s: string) => STATUS_WORDS[s] ?? s.replace(/_/g, ' ');

/** Where to make a Binance TESTNET key: test money only, separate from a real Binance account. */
export const BINANCE_TESTNET_URL = 'https://testnet.binance.vision/';
