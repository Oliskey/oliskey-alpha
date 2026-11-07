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
