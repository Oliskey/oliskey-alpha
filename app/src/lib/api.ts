// REST client for the Oliskey Alpha backend. Every call carries the signed-in user's token.
// On web the backend serves the app itself, so the API is the page's own origin (one port for everything).
// Native builds need EXPO_PUBLIC_API_URL (e.g. the computer's LAN address).
import { Platform } from 'react-native';
import { PREVIEW, PREVIEW_MESSAGE } from './preview';

export const API_URL = process.env.EXPO_PUBLIC_API_URL
  || (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3311');
export const WS_URL = process.env.EXPO_PUBLIC_WS_URL || API_URL.replace(/^http/, 'ws') + '/stream';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setApiToken(t: string | null) {
  token = t;
}

export function setOnUnauthorized(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (PREVIEW) throw new ApiError(PREVIEW_MESSAGE, 0);
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: init.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection.', 0);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(data?.error ?? 'Something went wrong.', res.status, data?.code);
  }
  return data as T;
}

// ── Shared response types ──
export type Account = { id: string; type: 'DEMO' | 'NGN' | 'USDT'; currency: string; balance: string; locked: string };
export type Profile = {
  id: string; email: string; full_name: string | null; phone: string | null;
  tier: 'starter' | 'smart' | 'alpha'; kyc_status: 'none' | 'pending' | 'verified' | 'rejected';
  active_account_id: string | null; is_admin: boolean;
  mfa_enabled: boolean;   // admin 2-step login is on
};
export type Me = { profile: Profile; accounts: Account[]; unreadNotifications: number };

export type Asset = {
  id: string; name: string; category: 'currency' | 'commodity' | 'index' | 'crypto' | 'stock';
  base_price: string; decimals: number; volatility: string; payout_fixed: string; payout_inzone: string;
  max_leverage: number; sort_order: number; price: number | null;
  price_source: 'sim' | 'binance';   // binance = live market price, sim = simulated
  source_symbol?: string | null;     // e.g. BTCUSDT for live assets
};

export type Candle = { time: number; open: number; high: number; low: number; close: number };

export type TradeMode = 'fixed_time' | 'inzone' | 'forex';
export type AutoMode = 'ask' | 'auto';
export type AutoChoice = { mode: AutoMode; amount: number; riskAccepted: boolean };
export type AutoState = {
  min: number; demo: AutoChoice; real: AutoChoice;
  waiting: { id: number; asset_id: string; asset_class: string; direction: 1 | -1; enter_until: string }[];
};

export type Trade = {
  auto?: boolean;   // the AI placed it for this person
  idea_id?: number | string | null;   // the AI signal it came from
  id: string; account_id: string; asset_id: string; mode: TradeMode; direction: 'up' | 'down' | null;
  amount: string; payout_pct: string | null; zone_pct: string | null; leverage: number | null;
  take_profit: string | null; stop_loss: string | null; duration_sec: number | null;
  open_quote: string; open_time: string; expires_at: string | null;
  close_quote: string | null; close_time: string | null; status: 'open' | 'closed';
  result: 'win' | 'loss' | 'refund' | null; pnl: string | null; return_amount: string | null;
  closed_early?: boolean;
  risk_free?: boolean;
};
export type TradeDetail = Trade & { ticks: { ts: string; price: string }[] };

export type Task = {
  id: string; title: string; kind: 'win_streak' | 'trade_count'; target: number; reward: string;
  asset_id: string | null; mode: TradeMode | null; time_limit_sec: number;
  status: 'available' | 'accepted' | 'completed' | 'expired'; progress: number; expires_at: string | null;
};

export type Notification = {
  id: string; category: 'rewards' | 'transactions' | 'activities' | 'platform' | 'education';
  title: string; body: string | null; link: string | null; read_at: string | null; created_at: string;
};

// ── Market Intelligence Engine ──
export type IntelIdea = {
  id: number; asset_id: string; asset_class: string; strategy: string; regime: string; direction: 1 | -1; tf: string;
  bar_time: string; created_at: string; enter_until: string; expires_at: string;
  entry: number; stop: number; target: number; reasons: string[];
  kind: 'idea' | 'avoid'; horizon_hours: number;
  status: 'open' | 'won' | 'lost' | 'expired'; result_r: number | null; exit_price: number | null; resolved_at: string | null;
  taken: { trade_id: string; status: string; result: string | null; pnl: string | null; amount: string } | null;
};
export type SignalPlan = {
  ideaId: number; assetId: string; direction: 'up' | 'down' | null; mode: 'forex' | 'fixed_time' | 'inzone'; durationSec?: number; payout?: number;
  status: 'start' | 'wait' | 'waiting_order' | 'hold' | 'done' | 'missed'; reason: 'expired' | 'passed_target' | 'passed_stop' | null;
  simulated: boolean; price: number; entry: number; stop: number; target: number; leverage: number;   // Fixed Time: stop, target and leverage are null
  suggestedAmount: number; amount: number; tooSmall: boolean; stopMoney: number; targetMoney: number; riskPct: number | null;
  enterUntil: string; holdUntil: string; tradeId: string | null; orderId: string | null; result: string | null; pnl: string | null;
};
export type IntelGroup = {
  label: string; status: 'proven' | 'experimental' | 'test' | 'blocked'; paused: string | null;
  test: { trades: number; wins: number; low: number; high: number; breakeven: number; avg_r: number; corrected_low: number; failed: string[] };
  live: { won: number; lost: number; open: number; finished: number; too_few: boolean };
};
export type IntelEvidence = { tested_at: string | null; groups: Record<string, IntelGroup> };
export type AiListening = { mode: 'fixed_time' | 'inzone' | 'forex'; name: string; open: number; plain: string; every: string; at?: string | null; markets?: number; asset?: string; reading?: number; needed?: number; no_setup?: boolean };
export type AiTrader = {
  listening: AiListening[];
  checklist: { name: string; state: string }[];
  headlines: { source: string; title: string; url: string; at: string; sentiment: -1 | 0 | 1; coins: string[] }[];
  market: { trend: 'rising' | 'falling' | 'mixed'; above: number; total: number; fear: { value: number; text: string } | null } | null;
  method: { name: string; state: string }[];
  findings?: { title: string; url: string; idea: string; type: string; free_data: boolean; at: string }[];
  after_trade?: { asset: string; at: string; pnl: number; won: boolean; total: number }[];
  checks_12h?: { at: string; balance: number | null; total: number; change: number | null; trades: number | null; won: number | null }[];
  picks: { finished: number; won: number; lost: number; pnl: number; too_few: boolean; clean: { finished: number; won: number; pnl: number; moments: number } };
  measured: { finished: number; won: number; lost: number; pnl: number };
  finished_trades: Trade[];
  positions: (Trade & { kind: 'idea' | 'avoid'; strategy: string; tf: string; reasons: string[]; checked: string[] | null; stop_price: number; target_price: number; ends_at: string })[];
  watching: { scanned_at: string | null; markets: number; signals: number; setups_skipped: number; waiting: number };
  finished: number; won: number; lost: number; open: number; skipped: number; avg_r: number | null; pnl: number; too_few: boolean; needed: number; stake: number; leverage: number;
  strategies: { setup: string; label: string; tf: string; trades: number; won: number; pnl: number; avg_r: number; too_few: boolean; status: 'keeping' | 'struggling' | 'unclear' | null }[];
  causes: { cause: string; text: string; count: number; loss: boolean }[];
  lessons: { tag: string; label: string; trades: number; won: number; avg_r: number }[];
  rules: { id: number; tag: string; label: string; status: 'active' | 'retired'; evidence: { live_trades: number; live_avg_r: number; past_trades: number; past_avg_r: number; others_avg_r: number }; created_at: string }[];
  log: { kind: 'adopted' | 'refused' | 'retired' | 'kept' | 'review' | 'trend' | 'research' | 'check'; message: string; at: string }[];
  recent: { id: number; kind: 'idea' | 'avoid'; asset: string; direction: 1 | -1; tf: string; won: boolean; result_r: number; pnl: number; why: string; notes: string[]; at: string }[];
};
export type IntelMarket = {
  asset: string; class: string; status: 'trade' | 'avoid' | 'wait'; reason: string; regime?: string;
  timeframe?: string; last_close?: number; strategy?: string; direction?: 1 | -1;
};
export type IntelPerformance = {
  ideas: { resolved: number; wins: number; hit_rate: number | null; avg_r: number | null; won: number; lost: number; expired: number };
  avoided: { resolved: number; wins: number; hit_rate: number | null; avg_r: number | null; won: number; lost: number; expired: number };
  paper: {
    stake: number; leverage: number;
    ideas: { opened: number; open: number; closed: number; wins: number; hit_rate: number | null; pnl: number };
    avoided: { opened: number; open: number; closed: number; wins: number; hit_rate: number | null; pnl: number };
  };
};

export type PromoCode ={ code: string; description: string; bonus_pct: string; max_bonus: string; min_deposit: string };
