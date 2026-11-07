// Trade analysis: three short points (what happened, what drove it, one lesson).
// Uses Google Gemini when GEMINI_API_KEY and GEMINI_MODEL are set, otherwise a rule-based summary. Educational only.

const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(3)}%`;

export function tradeFacts(trade, ticks, assetName) {
  const open = Number(trade.open_quote);
  const close = Number(trade.close_quote);
  const prices = ticks.map((t) => Number(t.price));
  const durationSec = Math.round((new Date(trade.close_time) - new Date(trade.open_time)) / 1000);
  return {
    asset: assetName,
    mode: trade.mode,
    direction: trade.direction,
    amount: Number(trade.amount),
    leverage: trade.leverage,
    zonePct: trade.zone_pct == null ? null : Number(trade.zone_pct),
    durationSec,
    open,
    close,
    movePct: ((close - open) / open) * 100,
    maxMovePct: prices.length ? (Math.max(...prices.map((p) => Math.abs(p - open))) / open) * 100 : null,
    shareAboveOpen: prices.length ? prices.filter((p) => p > open).length / prices.length : null,
    result: trade.result,
    pnl: Number(trade.pnl),
  };
}

export function ruleBasedAnalysis(f) {
  const side = f.mode === 'inzone' ? 'InZone' : f.direction === 'up' ? 'Up' : 'Down';
  const outcome = f.result === 'win' ? 'a profit' : f.result === 'refund' ? 'a refund' : 'a loss';
  const happened = `You opened ${side} on ${f.asset} for ${f.durationSec} sec. The price went from ${f.open} to ${f.close} (${pct(f.movePct)}), so the trade closed with ${outcome}.`;

  let drove;
  if (f.mode === 'inzone') {
    drove = f.result === 'win'
      ? `The price stayed inside the ±${f.zonePct}% corridor at the close (largest move during the trade: ${pct(f.maxMovePct ?? 0)}).`
      : `The price finished outside the ±${f.zonePct}% corridor; the largest move during the trade was ${pct(f.maxMovePct ?? 0)}.`;
  } else if (f.mode === 'forex') {
    drove = `With a ${f.leverage}x multiplier, a ${pct(f.movePct)} move changed your result by ${f.pnl >= 0 ? '+' : ''}${f.pnl.toFixed(2)}.`;
  } else {
    const above = Math.round((f.shareAboveOpen ?? 0) * 100);
    drove = `The price spent ${above}% of the trade above your entry, but only the closing quote counts: it closed ${f.close > f.open ? 'above' : f.close < f.open ? 'below' : 'level with'} your entry.`;
  }

  let lesson;
  if (f.mode === 'forex') lesson = 'Set a stop loss before opening a multiplier trade so one move cannot take the whole stake.';
  else if (f.durationSec < 30) lesson = 'Results over a few seconds are mostly random price noise. Try longer durations and compare your results.';
  else lesson = 'Decide your stake before you open a trade and keep it a small share of your balance, win or lose.';

  return [happened, drove, lesson];
}

async function geminiAnalysis(f) {
  const model = process.env.GEMINI_MODEL;
  const prompt = [
    'You explain one finished practice trade to a beginner in the Oliskey Alpha demo app.',
    'Write exactly three short plain sentences, each on its own line, no markdown, no numbering:',
    '1) what happened, 2) what decided the result, 3) one practical habit for next time.',
    'Rules:',
    '- Use ONLY the facts below. Never invent causes (no "momentum", "news" or "sentiment" unless in the facts).',
    '- Money is demo credits written with the symbol α (for example α100). Never say dollars or any real currency.',
    '- Call the direction "Up" or "Down" (InZone trades have no direction). Never say "long" or "short".',
    '- Fixed Time: only the closing price versus the opening price decides the result. InZone: whether the',
    '  closing price stayed inside the ±zonePct corridor. Forex: profit scales with the multiplier (leverage).',
    '- Prices are simulated. The habit must be about process or risk (stake size, duration, a plan), never a',
    '  signal, prediction or advice to buy or sell.',
    `Facts: ${JSON.stringify(f)}`,
  ].join('\n');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const text = (await res.json()).candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) throw new Error('Gemini returned too few lines');
  return lines.slice(0, 3);
}

export async function analyzeTrade(facts) {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL) {
    try {
      return { source: 'ai', points: await geminiAnalysis(facts) };
    } catch (err) {
      console.error('gemini', err.message);
    }
  }
  return { source: 'rules', points: ruleBasedAnalysis(facts) };
}
