# Inventory and purpose review (audit phases 1–2, 2026-10-30)

Every screen, sheet and control, what it does, the API it calls, and a verdict:
**KEEP** (clear purpose, works), **FIX** (purpose is right, something is wrong), **REMOVE?** (no reachable purpose; owner decides).
The automated press-every-button results are in [buttons.md](buttons.md).

## Auth

| Element | Does | API | Verdict |
|---|---|---|---|
| Welcome: Create free account / I already have an account | Opens Register / Login | – | KEEP |
| Register: Full name, Email, Password, Create account | Creates the user + 3 wallets (trigger) | POST /auth/register | FIX: add an 18+ confirmation (legal, see REPORT) |
| Login: Email, Password, Log in, Forgot password?, Create an account | Signs in; admins with 2-step login get a code step | POST /auth/login, /auth/login/mfa | KEEP |
| Login code step (new): Code, Verify, Back | 6-digit authenticator code for admins | POST /auth/login/mfa | KEEP |
| Forgot: Email, Send reset link | Explains reset email needs hosted Supabase Auth | POST /auth/forgot | FIX: works only after hosted Supabase (owner) |

## Home

| Element | Does | API | Verdict |
|---|---|---|---|
| Avatar | Opens Profile | – | KEEP |
| Account selector + balance | Opens Accounts sheet | GET /me | KEEP |
| Bell + unread badge | Opens Notifications | GET /me | KEEP |
| Withdraw / Deposit | Withdraw screen / Deposit sheet (both say "coming soon" while live is off) | – | KEEP |
| Story: Skill Hub | Opens Skill Hub | – | KEEP |
| Story: Your bonus benefits | Opens the Deposit sheet | – | FIX: label promises bonus info but opens Deposit; give it its own bonus explainer or rename |
| Promo banner "Learn before you trade" | Opens Skill Hub | – | KEEP (no invented winnings) |
| Tasks & Rewards: Accept Task / Try again | Accepts a demo task | POST /tasks/:id/accept | KEEP |
| Market Scanner cards + Open | Opens the Market Scanner (ideas / don't enter / track record) | – | KEEP |
| Skill Hub cards + All | Course / Skill Hub | – | KEEP |
| Assets list (search, sort, favorites, category, rows, star) | Filters assets; row opens Terminal | GET /assets | KEEP |
| "Signal scanners are available on live accounts" sheet | Could never be opened | – | REMOVED (dead code, no feature lost) |

## Accounts sheet

| Element | Does | API | Verdict |
|---|---|---|---|
| Demo / NGN / USDT rows | Switch active account | PATCH /me | KEEP |
| Reset demo (RotateCcw) + confirm | Restores α10,000 | POST /accounts/demo/reset | KEEP |
| + Add Account | Toast "More accounts are coming soon" | – | FIX: placeholder button; hide until it does something (owner) |

## Terminal

| Element | Does | API | Verdict |
|---|---|---|---|
| Account chip / wallet button | Accounts sheet / Deposit sheet | – | KEEP |
| Mode tabs (Fixed Time, InZone, Forex, Stocks) | Switch mode; Stocks shows "live accounts" | – | KEEP |
| Asset row → asset sheet (search, categories) | Change asset | GET /assets | KEEP |
| Drawing tools / chart type + time frame | Chart tools | – | KEEP |
| Chart: drag, pinch, + / −, Back to now | Navigate the chart | GET /candles | KEEP |
| Amount / duration / multiplier steppers + sheets | Order size and length | – | KEEP |
| Up / Down / Open Trade (InZone) | Opens a trade at the server price | POST /trades | KEEP |
| Settings (take profit / stop loss) | Forex auto-close | – | KEEP |
| How to trade | Explainer sheet | – | KEEP |
| Open-trade chips (live result, tap = detail, × = close forex) | Live P/L, open the trade sheet | POST /trades/:id/close | KEEP |
| Momentum bar (% left edge) | Share of up/down price ticks | WS momentum | FIXED: labels now read "% up ticks" / "% down ticks", not "traders" |
| Scanner mode | Was unreachable | – | REMOVED (owner decision) |

## Trades / History / detail sheets

| Element | Does | API | Verdict |
|---|---|---|---|
| Mode tabs, Active Trades total + P/L, live cards | Live green/red preview of open trades | GET /trades?status=open, WS ticks | KEEP |
| Open-trade sheet: Close Early (live amount, "Are you sure?") | Server-priced early close of Fixed Time | GET/POST /trades/:id/close-early | KEEP (new) |
| Open-trade sheet: Close trade (Forex) | Manual close | POST /trades/:id/close | KEEP |
| History cards → detail sheet (Analyze with AI, Show on Chart, Quotes History, copy ID) | Review a finished trade | GET /trades/:id, POST /trades/:id/analyze | KEEP |
| AI tooltip "Analyze your trades with AI" | One-time hint | – | KEEP |
| History: Back, Analytics, 4 filter chips + pickers, infinite list | Full history | GET /trades | KEEP |
| Quotes History | Tick list of a trade | GET /trades/:id | KEEP |

## Market Scanner, Skill Hub, Help, Profile, Admin, money screens

| Element | Does | API | Verdict |
|---|---|---|---|
| Scanner tabs (Ideas / All markets / Track record), Open in Terminal, Try again | Engine output with honest disclaimers | GET /intel/* | KEEP |
| Skill Hub, Course, Lesson (pages, quiz answers, quit dialog) | Lessons | – | KEEP |
| Help: WhatsApp tile | Opens WhatsApp chat with 0904 941 7103 | – | KEEP (fixed) |
| Help: Email tile | mailto support@oliskeylee.com | – | FIX: confirm the address exists (owner) |
| Help: Education tile, FAQ accordion | Lessons / answers | – | KEEP (FAQ "Are the prices real?" corrected: crypto is live) |
| Help: Terms of Service / Privacy Policy | Plain text, not links | – | FIX: need the documents (owner + lawyer) |
| Help: Risk disclosure | Always visible | – | KEEP |
| Profile: name/phone Save, Change password, Log out | Account details | PATCH /me, POST /auth/change-password | KEEP |
| Profile: 2-step login (admins) | Set up authenticator codes | POST /auth/mfa/setup, /auth/mfa/enable | KEEP (new) |
| Profile: Delete account (password + confirm) | Anonymises the person after real money is withdrawn and trades are closed | DELETE /me | KEEP (new) |
| Admin: live-trading switch, pending withdrawals Approve/Reject | Admin tools (now need 2-step login) | /admin/* | KEEP |
| Deposit sheet / Withdraw screen | Built; say "coming soon" while live is off | /payments/* | KEEP |
| Notifications | List, marks read | GET /notifications, POST /notifications/read | KEEP |

## Misleading-content check

- No fake activity or invented winnings found. Promo banner and tasks use demo rewards only.
- Demo vs real money: DEMO badge, gold "Demo account", α symbol, "Simulated price" note on the chart. KEEP.
- Fees: Close Early states its fee (10%) and cap (90%) next to the button. Payout % is shown on every asset.
- Risk warning: on Help only. FIX: also show a short risk line at sign-up and above the first trade (owner wording/lawyer).
- Market Scanner: every idea says probability not promise, educational not advice; the engine currently publishes no ideas because nothing passed out-of-sample. KEEP.
