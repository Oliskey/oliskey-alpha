// Settles open trades on the server. Fixed Time / InZone close at the quote in force at expiry;
// Forex closes on stop-out (loss reaches the stake), take profit or stop loss (both money amounts), or manually.
// The payout math itself lives in the settle_trade SQL function.
import { pool } from './db.js';
import { notify, notifyTradeClosed } from './notify.js';

const LOOP_MS = 100;
const MAX_CLOSE_GAP_MS = 30_000;   // a live price further than this from a trade's end is not its closing price
const SOURCE_RETRY_MS = 30_000;
const EARLY_MIN_AGE_MS = 2000;   // Close Early: not in the first 2 s...
const EARLY_MIN_LEFT_MS = 3000;  // ...or the last 3 s
const EARLY_FEE = 0.10;

// Standard normal CDF (Abramowitz-Stegun 7.1.26, error < 1.5e-7).
function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

export class Settlement {
  constructor(engine, push) {
    this.engine = engine;
    this.push = push;
    this.open = new Map();   // tradeId → trade row
  }

  async start() {
    const { rows } = await pool.query("select * from trades where status = 'open'");
    for (const t of rows) this.add(t);
    this.timer = setInterval(() => this.loop(), LOOP_MS);
    return rows.length;
  }

  stop() {
    clearInterval(this.timer);
  }

  add(trade) {
    this.open.set(trade.id, trade);
  }

  forexPnl(trade, price) {
    const dir = trade.direction === 'up' ? 1 : -1;
    const open = Number(trade.open_quote);
    return Number(trade.amount) * trade.leverage * ((price - open) / open) * dir;
  }

  loop() {
    const now = Date.now();
    for (const trade of this.open.values()) {
      if (trade.settling) continue;
      if (trade.mode === 'forex') {
        const tick = this.engine.getPrice(trade.asset_id);
        if (!tick) continue;
        const pnl = this.forexPnl(trade, tick.price);
        const amount = Number(trade.amount);
        // a trade from a signal also ends at the signal's time limit, as it did in testing
        if ((trade.idea_ends_at && new Date(trade.idea_ends_at).getTime() <= now)
            || pnl <= -amount
            || (trade.take_profit != null && pnl >= Number(trade.take_profit))
            || (trade.stop_loss != null && pnl <= -Number(trade.stop_loss))) {
          this.settle(trade, tick).catch((err) => console.error('settle', trade.id, err));
        }
      } else if (new Date(trade.expires_at).getTime() <= now) {
        const ends = new Date(trade.expires_at).getTime();
        const tick = this.engine.getPriceAt(trade.asset_id, ends);
        if (this.engine.isLive(trade.asset_id) && (!tick || Math.abs(ends - tick.ts) > MAX_CLOSE_GAP_MS)) {
          if (!(trade.retryAt > now)) void this.settleFromSource(trade, ends);
        } else {
          this.settle(trade, tick).catch((err) => console.error('settle', trade.id, err));
        }
      }
    }
  }

  // This server saw no price near the trade's end (it was asleep or off), so the last one it holds is old. The result comes
  // from the real market's price at that moment; until that can be read, the trade waits.
  async settleFromSource(trade, ends) {
    trade.settling = true;
    try {
      const tick = await this.engine.sourcePriceAt(trade.asset_id, ends);
      if (!tick) throw new Error('no market price for that moment');
      await this.settle(trade, tick);
    } catch (err) {
      trade.settling = false;
      trade.retryAt = Date.now() + SOURCE_RETRY_MS;
      console.error('settle from market', trade.id, err.message);
    }
  }

  // Closes a forex trade at the current price (manual close). Returns the closed trade.
  async closeNow(tradeId) {
    const trade = this.open.get(tradeId);
    if (!trade || trade.settling) return null;
    return this.settle(trade, this.engine.getPrice(trade.asset_id));
  }

  // What the server would pay to close a Fixed Time trade now: full win x chance of winning, minus a 10% fee,
  // capped at 90% of the full win. The chance treats the rest of the trade as a random walk whose size comes
  // from the last two minutes of real ticks. Returns { amount } or { reason } when closing is not allowed.
  earlyQuote(trade, now = Date.now()) {
    if (trade.mode !== 'fixed_time') return { reason: 'CLOSE_EARLY_NOT_ALLOWED' };
    const opened = new Date(trade.open_time).getTime();
    const expires = new Date(trade.expires_at).getTime();
    if (now < opened + EARLY_MIN_AGE_MS) return { reason: 'CLOSE_EARLY_TOO_SOON', availableInMs: opened + EARLY_MIN_AGE_MS - now };
    if (now > expires - EARLY_MIN_LEFT_MS) return { reason: 'CLOSE_EARLY_TOO_LATE' };
    const tick = this.engine.getPrice(trade.asset_id);
    if (!tick) return { reason: 'INVALID_QUOTE' };

    const open = Number(trade.open_quote);
    const dir = trade.direction === 'up' ? 1 : -1;
    const sigma = this.secondVolatility(trade.asset_id) * Math.sqrt((expires - now) / 1000);
    const z = (dir * Math.log(tick.price / open)) / sigma;
    const chance = Number.isFinite(z) ? normalCdf(z) : tick.price === open ? 0.5 : Number(dir * (tick.price - open) > 0);
    const full = Number(trade.amount) * (1 + Number(trade.payout_pct) / 100);
    const amount = Math.round(Math.min(Math.max(full * chance * (1 - EARLY_FEE), 0), full * 0.9) * 100) / 100;
    return { amount, chance, price: tick.price };
  }

  // Standard deviation of 1-second log returns over the last 2 minutes of ticks.
  secondVolatility(assetId) {
    const now = Date.now();
    const ticks = this.engine.getTicks(assetId, now - 120_000, now);
    const perSecond = [];
    let last = null;
    for (const t of ticks) {
      if (last && t.ts - last.ts >= 1000) { perSecond.push(Math.log(t.price / last.price)); last = t; }
      else if (!last) last = t;
    }
    if (perSecond.length < 10) return 1e-4;
    const mean = perSecond.reduce((s, v) => s + v, 0) / perSecond.length;
    const sd = Math.sqrt(perSecond.reduce((s, v) => s + (v - mean) ** 2, 0) / (perSecond.length - 1));
    return Math.max(sd, 1e-7);
  }

  // Closes a Fixed Time trade early at the server's price. The SQL function re-checks every rule and the row
  // lock makes it exclusive with expiry, so a trade closes exactly once.
  async closeEarly(tradeId, userId) {
    const trade = this.open.get(tradeId);
    if (!trade || trade.user_id !== userId) throw new Error('TRADE_ALREADY_CLOSED');
    if (trade.settling) throw new Error('TRADE_ALREADY_CLOSED');
    const quote = this.earlyQuote(trade);
    if (quote.reason) throw new Error(quote.reason);
    trade.settling = true;
    try {
      const { rows } = await pool.query('select * from close_trade_early($1, $2, $3, $4)', [trade.id, userId, quote.price, quote.amount]);
      return await this.finish(trade, rows[0], new Date(rows[0].close_time));
    } catch (err) {
      trade.settling = false;
      throw err;
    }
  }

  async settle(trade, tick) {
    trade.settling = true;
    try {
      const closeTime = new Date(trade.mode === 'forex' ? Date.now() : Math.min(Date.now(), new Date(trade.expires_at).getTime()));
      const { rows } = await pool.query('select * from settle_trade($1, $2, $3)', [trade.id, tick.price, closeTime]);
      return await this.finish(trade, rows[0], closeTime);
    } catch (err) {
      trade.settling = false;   // retried on the next loop
      throw err;
    }
  }

  // After the database closed a trade: save its ticks, count it for tasks and tell the owner.
  async finish(trade, closed, closeTime) {
    this.open.delete(trade.id);

    const ticks = this.engine.getTicks(trade.asset_id, new Date(trade.open_time).getTime(), closeTime.getTime());
    if (ticks.length) {
      await pool.query(
        `insert into quote_ticks (trade_id, ts, price)
         select $1, to_timestamp(t / 1000.0), p from unnest($2::float8[], $3::float8[]) as x(t, p)
         on conflict do nothing`,
        [trade.id, ticks.map((t) => t.ts), ticks.map((t) => t.price)],
      );
    }

    this.push(closed.user_id, { type: 'trade_closed', trade: closed });
    if (trade.auto) return closed;   // the AI's trade: it earns no task progress or invite reward, and sends no message each time
    await this.updateTasks(closed);
    void notifyTradeClosed(closed);
    // the friend's first finished trade earns whoever invited them a boost
    void pool.query('select referral_on_trade($1) as inviter', [closed.user_id]).then(({ rows }) => {
      if (rows[0]?.inviter) return notify(rows[0].inviter, 'rewards', 'You earned a boost', 'A friend you invited finished their first trade.', '/invite');
      return null;
    }).catch((err) => console.error('referral', err.message));
    return closed;
  }

  // Tasks accepted before this trade opened: count trades, and track win streaks (a loss resets, a refund doesn't).
  async updateTasks(trade) {
    const { rows } = await pool.query(
      `update user_tasks ut
       set progress = case when t.kind = 'trade_count' then ut.progress + 1
                           when $4 = 'win' then ut.progress + 1
                           when $4 = 'loss' then 0
                           else ut.progress end
       from tasks t
       where t.id = ut.task_id and ut.user_id = $1 and ut.status = 'accepted' and ut.expires_at > now()
         and ut.accepted_at <= $5
         and (t.asset_id is null or t.asset_id = $2) and (t.mode is null or t.mode = $3)
       returning ut.task_id, ut.progress, ut.accepted_at, t.target, t.reward, t.title`,
      [trade.user_id, trade.asset_id, trade.mode, trade.result, trade.open_time],
    );
    for (const task of rows.filter((r) => r.progress >= r.target)) {
      const done = await pool.query(
        `update user_tasks set status = 'completed', completed_at = now()
         where user_id = $1 and task_id = $2 and status = 'accepted' returning 1`, [trade.user_id, task.task_id]);
      if (!done.rowCount) continue;
      await pool.query(
        `select credit_bonus(a.id, $2, 'task_reward', $3) from accounts a where a.user_id = $1 and a.type = 'DEMO'`,
        [trade.user_id, task.reward, `task:${task.task_id}:${trade.user_id}:${new Date(task.accepted_at).getTime()}`],
      );
      await notify(trade.user_id, 'rewards', 'Task complete', `"${task.title}" is done. α${Number(task.reward)} and a Profitability Boost have been added to your demo account.`, '/rewards');
      await pool.query('select grant_boost($1, $2)', [trade.user_id, `task:${task.task_id}:${new Date(task.accepted_at).getTime()}`]);
      this.push(trade.user_id, { type: 'task_completed', taskId: task.task_id });
    }
  }
}
