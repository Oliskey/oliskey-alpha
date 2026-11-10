// In-app notifications: one row per real event (trade closed, order opened, deposit, ...), plus a live "notification"
// event so the bell updates at once. A failure here is only logged: it must never affect money or the action behind it.
import { pool } from './db.js';
import { sendPush } from './webPush.js';

let push = null;
export const setNotifyPush = (fn) => { push = fn; };
// A live event with no notification row (e.g. the AI opened a trade for this person): their app refreshes trades and balance.
export const pushEvent = (userId, msg) => { try { push?.(userId, msg); } catch { /* the app also refreshes by itself */ } };

// green for a win, red for a loss; everything else plain
const toneOf = (title) => (/^Trade won/.test(title) ? 'up' : /^Trade lost/.test(title) ? 'down' : 'neutral');

export const SYMBOL = { DEMO: 'α', NGN: '₦', USDT: 'USDT ' };
export const amountText = (type, value) => `${SYMBOL[type] ?? ''}${Math.abs(Number(value)).toFixed(2)}`;

// The open app gets the alert at once (sound + banner). outside: also a browser/phone alert when the app is closed or in
// the background: for signals, the AI's trades and every trade result (owner decision 2026-11-10), nothing else.
// tag: a newer alert with the same tag replaces the older one instead of piling up.
export async function notify(userId, category, title, body = null, link = null, { outside = false, tag = null } = {}) {
  try {
    await pool.query('insert into notifications (user_id, category, title, body, link) values ($1, $2, $3, $4, $5)', [userId, category, title, body, link]);
    push?.(userId, { type: 'notification', alert: { category, title, body, link, tone: toneOf(title) } });
    if (outside) await sendPush(userId, { title, body, link, tag });
  } catch (err) {
    console.error('notify', err.message);
  }
}

const MODE = { fixed_time: 'Fixed Time', inzone: 'InZone', forex: 'Forex' };

// What a closed trade means for its owner, in one line.
export async function notifyTradeClosed(t) {
  try {
    const { rows } = await pool.query('select a.type, s.name from accounts a, assets s where a.id = $1 and s.id = $2', [t.account_id, t.asset_id]);
    const type = rows[0]?.type ?? 'DEMO';
    const timedOut = t.idea_ends_at && new Date(t.idea_ends_at).getTime() <= Date.now();
    const where = `${rows[0]?.name ?? t.asset_id} · ${MODE[t.mode] ?? t.mode}${timedOut ? ' · closed at the signal\'s time limit' : ''}`;
    const opts = { outside: true, tag: `trade-${t.id}` };   // every result reaches them, even with the app closed
    if (t.result === 'win') await notify(t.user_id, 'activities', `Trade won: +${amountText(type, t.pnl)}`, `${where}. You put in ${amountText(type, t.amount)} and got ${amountText(type, t.return_amount)} back.`, '/history', opts);
    else if (t.result === 'loss') await notify(t.user_id, 'activities', `Trade lost: -${amountText(type, t.pnl)}`, `${where}. Your balance is updated.`, '/history', opts);
    else await notify(t.user_id, 'activities', `Amount returned: ${amountText(type, t.amount)}`, `${where}. ${t.risk_free ? 'Your risk-free trade gave your amount back.' : 'The trade ended level, so nothing was won or lost.'}`, '/history', opts);
  } catch (err) {
    console.error('notify trade', err.message);
  }
}

// The AI opened a trade with this person's money (Auto trade): they hear about it at once, app open or closed.
export async function notifyAiTradeOpened(t) {
  try {
    const { rows } = await pool.query('select a.type, s.name from accounts a, assets s where a.id = $1 and s.id = $2', [t.account_id, t.asset_id]);
    const type = rows[0]?.type ?? 'DEMO';
    await notify(t.user_id, 'activities', `AI opened a trade: ${rows[0]?.name ?? t.asset_id}${t.direction === 'up' ? ' Up' : t.direction === 'down' ? ' Down' : ''}`,
      `${amountText(type, t.amount)} · ${MODE[t.mode] ?? t.mode}. It can lose. We will tell you the result.`, '/trades', { outside: true, tag: `trade-${t.id}` });
  } catch (err) {
    console.error('notify ai trade', err.message);
  }
}
