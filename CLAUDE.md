PROJECT: Oliskey Alpha, a trading app for Android, iOS and web by Oliskeylee Ltd.
It replicates the features, screen structure and flows of a fixed-time/forex trading app, under its OWN brand.
BRAND RULES: name "Oliskey Alpha"; own logo; icons from lucide-react-native only; own colour palette;
demo currency symbol "α"; all UI copy written fresh. Never copy another brand's name, logo, icons, illustrations or text.
PALETTE (pure black, owner decision 2026-10-29): bg #000000, surface #121212, surface2 #1E1E1E, border #2C2C2C, text #F2F2F2, muted #8E8E8E,
primary gradient #7C5CFF -> #3BA4FF, up #22C55E, down #F43F5E, demo gold #F5B942.
STACK: monorepo. app/ = Expo (SDK latest) + Expo Router + TypeScript + React Native Web, TanStack Query,
React Context, react-native-svg, lucide-react-native, @supabase/supabase-js, expo-secure-store, expo-web-browser.
backend/ = Node 20 + Express (ESM JS), ws, @supabase/supabase-js, helmet, cors, express-rate-limit,
@google/generative-ai, dotenv. Database = Supabase Postgres; schema in supabase/migrations (already written, do not change
without asking me).
CORE RULES: the server is the only source of prices and the only place trades are settled. The app never computes
wins/losses or balances. Balances change only via the Postgres functions open_trade, settle_trade, credit_deposit,
credit_bonus, request_withdrawal, resolve_withdrawal, reset_demo, called with the service-role key from the backend.
Live (real-money) trading stays OFF unless platform_settings.live_trading_enabled = true.
REAL-MONEY GATE (owner decision 2026-10-29): never switch live trading on while prices come from the in-house
simulator. Live trading requires (1) a licensed price/liquidity feed replacing priceEngine for live accounts and
(2) written sign-off from a Nigerian capital-markets lawyer that each mode (Fixed Time, InZone, Forex) may be offered.
The app labels demo prices "Simulated prices".
WORK STYLE: build one step at a time, run it, fix errors, then tell me what to test.

LOCAL DEVELOPMENT (until a hosted Supabase project exists; the free-plan org is at its 2-project limit):
- Database: Docker container `oliskey-alpha-app-db` (postgres:17-alpine) on 127.0.0.1:54330, database `oliskey_alpha`.
  Start: `npm run db:up`. Wipe + apply all migrations: `npm run db:reset`. Money-rule tests: `npm run db:test`.
- supabase/local/000_local_supabase_stub.sql recreates the small part of Supabase the schema relies on
  (auth.users, auth.uid(), roles anon/authenticated/service_role). It runs LOCALLY ONLY, never on hosted Supabase.
- ONE PORT (owner rule): everything runs on http://localhost:3311. The backend serves the API, the WebSocket and the built web app (app/dist). `npm run build` rebuilds the web app, `npm start` runs it. Never use 3000 (School App), 3300 or 3310 (old processes).
- The folder "Oliskey Alpha old" and the container `oliskey-alpha-db` belong to the previous app. Do not touch them.
- Secrets live in .env.local (root) and backend/.env / app/.env; all are gitignored. Never print key values.

MARKET INTELLIGENCE ENGINE (intel/, Python, added 2026-10-30):
- Internal FastAPI on 127.0.0.1:3312, started automatically by the backend (backend/src/intel.js); the app reaches it
  only through the backend at /intel/* (login required). Python env: %LOCALAPPDATA%\oliskey-alpha\intel-venv
  (outside OneDrive). Keys come from root .env.local and are never logged.
- Real data only: crypto 1 h bars from Binance; forex/indices/commodities daily bars from FMP (free plan: only the
  34 markets in intel/config/universe.yaml; intraday, news and calendar are blocked; max 250 calls/day).
- Fixed-rule strategies, walk-forward backtest (python intel/run_backtest.py -> docs/intel/RESULTS.md). The scanner
  publishes trade ideas only from strategies that pass out-of-sample; other setups are logged as "avoid".
  Every idea and avoided setup is resolved and kept as the track record. Never present ideas as certain.
- Crypto in the app now uses live Binance prices (assets.price_source = 'binance'); everything else is simulated.
- All 17 live coins are read every minute (owner decision 2026-11-06). The other 12 coins are their own groups ('crypto_ft_wide', 'crypto_iz_wide') with their own test numbers. InZone trains on all 17 with 4 years, the long view (intel/engine/longview.py), market and corridor inputs (intel/engine/marketview.py); Fixed Time still trains on 5 coins and gets no users' money.
- Tests before trust: intel/run_train_hard.py (contest), intel/run_harder_test.py (late entry, unseen coins), intel/run_wide_contest.py (all coins, 4 years), intel/run_wide_harder.py (last test before InZone money, reruns weekly). Why trades win or lose: intel/run_loss_causes.py, weekly; a warning sign joins the strategy only if it passes its rule. Pass rules are fixed before any result and never loosened.

AI GOAL (owner decision 2026-11-07): profit, not more trades. The AI trades only when the evidence says the trade should pay. A change that adds trades without adding profit is refused. Owner rule, same day: if the AI is not sure of a trade, it is better not to trade than to lose money; "sure" is set by intel/run_strength_test.py, weekly. Between trade lengths, longer only if really better.

AI TRADING FOR USERS (owner decisions 2026-11-06, backend/src/intel.js):
- Each user chooses Always ask or Auto trade, per kind of money. Demo starts on Auto trade, real money on Always ask. Minimum 100 per trade, user may raise it.
- A user's money only goes to groups whose tests earn and that are not paused. Hard limits: 15% of the money per trade, 50% open at once.
- Real-money auto trade only stores the user's choice. It must not run until the REAL-MONEY GATE above is met, and the lawyer's sign-off must cover it.

AI SPOT (added 2026-11-09, docs/spot/SPEC.md): long-only BTC/USDT and ETH/USDT spot research. PAPER ONLY.
- Engine: intel/engine/spot (data checks, Market Intelligence, strategies, cost-aware stop-first backtest, walk-forward,
  bootstrap, gates). Hypotheses are written in docs/intel/SPOT_HYPOTHESES.md and committed BEFORE any test; settings
  are never changed after seeing results. Results: docs/intel/SPOT_RESULTS.md and docs/intel/spot_registry.json.
- Commands: npm run spot:test (no network), npm run spot:fetch (Binance history), npm run spot:lab (tests all strategies).
- Backend: backend/src/spot (contracts, deterministic Risk Manager, kill switch in %LOCALAPPDATA%/oliskey-alpha or /data,
  paper exchange, pipeline). Only strategies the lab marks APPROVED_FOR_PAPER may trade, only on paper.
  GET /spot/status is read-only. There is NO real-money path for AI Spot; it falls under the REAL-MONEY GATE above.
- Batch 3 (2026-11-10): trend_breakout 0.1.0 passed every gate on 8 unseen coins (docs/intel/SPOT_UNSEEN.md) and is
  approved for PAPER. Re-run: npm run spot:fetch -- --unseen, then python intel/run_spot_unseen.py.
- Forward paper trading (intel/engine/spot/paper.py, loop in intel/api.py): every 4 h, 2 min after the bar closes, on the
  17 live coins; trend_breakout and squeeze_breakout, frozen. Tables intel.spot_paper_tracking / spot_paper_trades /
  spot_paper_summary (created by intel's ensure_schema). Closed trades are frozen; the verdict comes from the stored
  record. Proven only at 100+ closed live trades passing the batch-3 gates. App: Market Scanner -> AI Spot tab.
  Switch off with INTEL_SPOT_PAPER=off.
- Agents (2026-11-10, intel/engine/spot/agents.py): 14 deterministic agents (13 responsibilities + News & Event Risk) give a
  view on every closed bar of every live coin (4h swings; 15m scalps) and the decision is stored frozen in
  intel.spot_agent_decisions with every view. The paper account follows only TRADE decisions. All 7 strategies keep their own
  forward record; only lab-approved ones can reach the account. Risk limits mirror backend/src/spot/risk.js and trip the same
  kill switch file. Behaviour changes only through the improvement registry (intel/engine/spot/improvements.py,
  intel.spot_improvements): a rule acts only while "deployed"; cross-tests on each strategy's history; conflicts never promote;
  harmful vetoes roll back. Pre-registered in docs/intel/SPOT_HYPOTHESES.md (batch 4). App: Market Scanner -> AI Agents
  (GET /spot/agents, read-only). GET /health returns the running commit.
