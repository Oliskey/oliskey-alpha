// Only one copy of the server settles trades, fills orders, runs the AI and sends alerts: the leader. Any number of copies can serve the website and API.
// Leadership is a Postgres advisory lock held on its own connection: if the leader stops or loses its connection, the lock is released and another copy
// takes over within RETRY_MS. Settling twice is already impossible in the database (settle_trade locks the row and ignores a closed trade); this stops
// the work itself from running twice, such as the AI placing the same trade twice or two alerts for one event.
import pg from 'pg';

const KEY = 33110001;          // one number for "the Oliskey Alpha leader"
const RETRY_MS = Number(process.env.LEADER_RETRY_MS || 10_000);

export const leader = { is: false };

/** Calls start() once, when this copy becomes the leader. Resolves at once; leadership may come later. */
export function whenLeader(start, { connectionString = process.env.DATABASE_URL, log = console } = {}) {
  let stopped = false;
  const attempt = async () => {
    if (stopped) return;
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      const { rows } = await client.query('select pg_try_advisory_lock($1) as got', [KEY]);
      if (!rows[0].got) { await client.end(); setTimeout(attempt, RETRY_MS).unref(); return; }
      // the lock lives as long as this connection: losing it means another copy may now lead, so this one must stop leading at once
      client.on('error', (err) => { log.error('leader connection lost, stopping so another copy can lead:', err.message); process.exit(1); });
      client.on('end', () => { if (!stopped) { log.error('leader connection ended, stopping so another copy can lead'); process.exit(1); } });
      leader.is = true;
      leader.release = async () => { stopped = true; leader.is = false; await client.end().catch(() => {}); };
      log.log('This copy is the leader: it settles trades, fills orders and runs the AI.');
      await start();
    } catch (err) {
      await client.end().catch(() => {});
      if (leader.is) throw err;
      log.error('leader check failed, trying again:', err.message);
      setTimeout(attempt, RETRY_MS).unref();
    }
  };
  void attempt();
}
