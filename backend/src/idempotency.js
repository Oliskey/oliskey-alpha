// Idempotency-Key for actions that must not happen twice (opening a trade, placing an order).
// On a weak connection the app may send the same request twice (double tap, a retry after a timeout whose request had
// in fact arrived). The same person + route + key gets the first answer again instead of a second trade.
// Concurrent duplicates wait for the first one to finish. Answers are remembered for 10 minutes on this server copy;
// a 5xx is not remembered, so a real failure can be retried. Requests without the header behave as before.
const TTL_MS = 10 * 60_000;
const STALE_MS = 60_000;        // a first request still unfinished after this is treated as gone
const MAX = 50_000;
const seen = new Map();         // `${user}|${method}|${path}|${key}` -> { at, result?, waiting? }

function sweep(now) {
  if (seen.size < MAX / 2) return;
  for (const [k, v] of seen) if (now - v.at > TTL_MS) seen.delete(k);
  if (seen.size > MAX) seen.clear();
}

export function idempotent(req, res, next) {
  const key = req.get('idempotency-key');
  if (key === undefined) return next();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) return res.status(400).json({ error: 'Invalid Idempotency-Key.' });
  const id = `${req.user.id}|${req.method}|${req.baseUrl}${req.path}|${key}`;
  const now = Date.now();
  sweep(now);
  const hit = seen.get(id);
  if (hit && now - hit.at < TTL_MS) {
    if (hit.result) return res.status(hit.result.status).set('Idempotent-Replay', 'true').json(hit.result.body);
    if (hit.waiting && now - hit.at < STALE_MS) {
      return hit.waiting.then((r) => res.status(r.status).set('Idempotent-Replay', 'true').json(r.body));
    }
  }
  let resolve;
  const waiting = new Promise((r) => { resolve = r; });
  seen.set(id, { at: now, waiting });
  const json = res.json.bind(res);
  res.json = (body) => {
    const result = { status: res.statusCode, body };
    if (res.statusCode >= 500) seen.delete(id);
    else seen.set(id, { at: Date.now(), result });
    resolve(result);
    return json(body);
  };
  next();
}
