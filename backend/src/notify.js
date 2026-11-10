// In-app notifications: one row per real event (trade closed, order opened, deposit, ...), plus a live "notification"
// event so the bell updates at once. A failure here is only logged: it must never affect money or the action behind it.
import { pool } from './db.js';
import { sendPush } from './webPush.js';

let push = null;
export const setNotifyPush = (fn) => { push = fn; };
// A live event with no notification row (e.g. the AI opened a trade for this person): their app refreshes trades and balance.
export const pushEvent = (userId, msg) => { try { push?.(userId, msg); } catch { /* the app also refreshes by itself */ } };

export const SYMBOL = { DEMO: 'α', NGN: '₦', USDT: 'USDT ' };
export const amountText = (type, value) => `${SYMBOL[type] ?? ''}${Math.abs(Number(value)).toFixed(2)}`;

// outside: also deliver it when the app is closed. Only for signals, so phones stay quiet otherwise.
export async function notify(userId, category, title, body = null, link = null, { outside = false } = {}) {
  try {
    await pool.query('insert into notifications (user_id, category, title, body, link) values ($1, $2, $3, $4, $5)', [userId, category, title, body, link]);
    push?.(userId, { type: 'notification' });
    if (outside) await sendPush(userId, { title, body, link });
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
    const opts = { outside: !!t.idea_id };   // a followed signal's result reaches them even with the app closed
    if (t.result === 'win') await notify(t.user_id, 'activities', `Trade won: +${amountText(type, t.pnl)}`, `${where}. You put in ${amountText(type, t.amount)} and got ${amountText(type, t.return_amount)} back.`, '/history', opts);
    else if (t.result === 'loss') await notify(t.user_id, 'activities', `Trade lost: -${amountText(type, t.pnl)}`, `${where}. Your balance is updated.`, '/history', opts);
    else await notify(t.user_id, 'activities', `Amount returned: ${amountText(type, t.amount)}`, `${where}. ${t.risk_free ? 'Your risk-free trade gave your amount back.' : 'The trade ended level, so nothing was won or lost.'}`, '/history', opts);
  } catch (err) {
    console.error('notify trade', err.message);
  }
}
