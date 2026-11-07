# Oliskey Alpha

Trading app for Android, iOS and web, by Oliskeylee Ltd. Version 0.0.1.

- The demo account (α10,000) works: live prices for 17 crypto markets, simulated prices for the rest, each labelled.
- An AI trades on real prices with demo money, and each user chooses Always ask or Auto trade, from α100 per trade.
- Real money (Paystack deposits, withdrawals, auto trade) is built but switched off. See "Real-money gate" in CLAUDE.md.
- The web preview at https://oliskey-alpha.vercel.app shows the screens only. Sign-in and trading need the backend, which runs on port 3311 until it is hosted.

| Folder | What |
|---|---|
| `backend/` | Node 22+ Express API, WebSocket price stream, settlement, and it serves the web app |
| `app/` | Expo (SDK 58) app: Android, iOS and web |
| `supabase/migrations/` | Database schema and seed data |
| `supabase/local/` | Local-only stand-in for Supabase auth (never run on hosted Supabase) |
| `supabase/tests/` | Money-rule tests (roll back after running) |

## Run locally (one port: http://localhost:3311)

Needs Docker Desktop and Node 22.13+ (Expo SDK 58 requirement).

```
npm install          # first time only
npm run db:up        # start the local database (Docker container oliskey-alpha-app-db)
npm run db:reset     # WIPES local data, then applies all migrations
npm run build        # build the web app into app/dist (after changing app code)
npm start            # app + API + live prices, all on http://localhost:3311
npm test             # end-to-end tests against the running server
npm run db:test      # check the money rules
```

Copy `backend/.env.example` to `backend/.env` before the first run. `SUPABASE_JWT_SECRET` must be a random
string of at least 32 characters. Make an admin with `npm run db:admin -- <email>`; admins must turn on 2-step login (Profile) before admin tools open.
On Render/Railway set `TRUST_PROXY=1`.
For live-reload while coding the app: `npm run app:dev` (Expo dev server; set `EXPO_PUBLIC_API_URL=http://localhost:3311` in app/.env).

Make yourself an admin (after registering in the app): `npm run db:admin -- you@example.com`

On a phone: install Expo Go, set `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_WS_URL` in `app/.env` to your
computer's LAN IP (e.g. `http://192.168.1.20:3311`), add that origin to `ALLOWED_ORIGINS`, then `npm start -w app`
and scan the QR code.

## Deploy

### Backend (Render or Railway: needs an always-on server for WebSockets, not serverless)
1. New Web Service from this repo, root directory `backend`, start command `npm start`, Node 22.13 or newer.
2. Environment: `DATABASE_URL` (hosted Supabase direct connection string), `SUPABASE_JWT_SECRET`
   (Supabase project's JWT secret), `ALLOWED_ORIGINS` (your web app URL), `PAYSTACK_*`, `GEMINI_*`.
3. Run `supabase/migrations/*.sql` in order in the Supabase SQL editor (NOT `supabase/local`).

### Web (Vercel)
1. `npx expo export -p web` inside `app/` produces `app/dist` (single-page app).
2. Vercel project: root directory `app`, build command `npx expo export -p web`, output directory `dist`,
   environment `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_WS_URL` pointing at the deployed backend.
3. Add a rewrite of all paths to `/index.html` so deep links work.

### Android / iOS (EAS)
1. `npx eas-cli@latest login`, then `npx eas-cli@latest build:configure` inside `app/` (links the project).
2. Test build: `npx eas-cli@latest build -p android --profile preview` (installable APK).
3. Store builds: `--profile production` (Android App Bundle / iOS archive), then
   `npx eas-cli@latest submit -p android` and `-p ios`. Needs a Google Play developer account and an Apple
   Developer account.
4. Before store release: replace the placeholder icon/splash in `app/assets/images` with the Oliskey Alpha logo.
