# Oliskey Alpha design system and locked decisions

Source of truth for UI work (Liquid Glass skill §23/§32). Read before changing any screen. A **LOCKED** item changes only
with the owner's approval. Values are project decisions, not Apple specifications; the glass is a web approximation of
Apple's Liquid Glass, not Apple's renderer.

## Colour (LOCKED, owner 2026-10-29/30)
- Pure black background `#000000`; content surfaces `#0E0E10` with 1 px `#26262A` hairlines; inputs/pills `#1A1A1D`.
- Text white; secondary text `#A0A0A8` (8:1 on black). Faint `#6E6E76` only for non-essential marks.
- Primary action = solid white button with black text. Violet `#8B7BFF` only for links, focus and the selected state.
- Green `#00D27A` / red `#FF3D5A` only for up/down, profit/loss. Gold `#F5B942` for the demo badge and "under review".
- Brand gradient (violet to blue) only in the logo, mascot and the soft glow behind the logo on Welcome.

## White mode (owner 2026-11-05, replaces the tinted version the owner rejected)
- Profile > Settings: Dark / White / Device. With no saved choice the app follows the device. Dark keeps every rule above.
- Pure white page `#FFFFFF`, white cards with a `#E5E5EA` hairline, inputs `#F2F2F7`, text `#1D1D1F`, second text `#6E6E73`, one sharp violet `#5B2EFF`. No page tint, no glow behind content, no coloured shadows.
- Colour only on the main action, selection, Up/Down, profit/loss and feature shortcuts. Everything else is black, grey and white.
- Glass on white needs body: frosted white, fine dark hairline, bright top lip, soft neutral shadow. Selected tab = neutral grey capsule, colour only in the icon and label.
- Main buttons: violet with a slight same-colour shift (`primaryFrom` to `primaryTo`), never two different colours.
- Code: `colors` always reads the active theme; fixed styles use `createStyles`, never a bare `StyleSheet.create`, so they rebuild when the theme changes.

## Real liquid glass (owner 2026-11-05: "real liquid, not blur")
- Floating controls (phone pill, rail, selected drop, chart buttons): near-clear body, about 1.5 px of blur, and edges that really bend what is behind them (`ui/liquid.tsx`). Chromium only; Safari and Firefox get the same shape, rim and light frost. iPhones on iOS 26+ get Apple's own material through `GlassView` (`expo-glass-effect`) in `LiquidView`.
- Three layers, in this order: empty glass, selected drop, then icons and labels. Glass inside glass cannot bend, and a drop above the icons smears them.
- Controls inside a scrolling page keep the rim light but no filter, because nothing moves behind them. This is what keeps scrolling smooth; every glass button on a scrolling page having a filter measurably slowed it.
- Small floating glass and its icons flip light or dark with the background, with two thresholds so it cannot flicker. Large glass adapts its shadow but never flips. Shadow gets stronger over text.
- Regular only. Clear was removed; never mix them. No opacity below 1 on `GlassView` or its parents (Apple).
- Reduce Transparency: solid. Increase Contrast: solid with a 2 px border. Reduce Motion: no stretch, no shrink.

## Controls that appear on hover (owner 2026-11-05)
- × on asset tabs, Cancel and Close on order and trade rows: `HoverReveal` with `revealHost` (`ui/kit.tsx`). Shown on hover and keyboard focus, always on touch screens and on the selected tab, with space reserved.
- Sideways rows use `SideScroll`: round arrows on mouse hover, only on sides with more to see, soft fading edges. Touch screens swipe.

## Signals (owner 2026-11-05)
- The Signals icon blinks with a green dot while there is a new tradable signal, and stops once opened. Reduced motion: dot only.
- A signal opens one card: trade type, Start / Wait / Hold / Missed, suggested amount (about 1% of the balance at risk, changeable), stop, target, enter-before time. One press of Place trade sets everything. The server does every sum (`backend/src/signalPlan.js`).
- Forex is the type used, as the one with a stop and target. Far from entry on a live market: a waiting order, cancelled at the enter-before time.
- The chart shows the plan: green zone to take profit, red zone to stop loss, Start line, status chip.
- Simulated markets: practice only, with the label that the tested chance does not apply. Say "Suggested", never "best".

## Motion (owner 2026-11-05)
- Mouse over a control: grows 2% with a soft tint, about 160 ms, ease-out. Large rows and cards only tint. Press: 0.96, about 120 ms. No wobble or bounce. All in `ui/Press.tsx`, so every button gets it.
- Reduced motion: tint and dim only. Keyboard focus: a violet ring.
- Switches (`Toggle` in `ui/kit.tsx`, owner 2026-11-05): vivid green track (`upVivid`, at least 3:1 against the page), white pill knob wider than tall. While pressed or sliding, the knob becomes a clear glass drop that grows past the track, then settles back to white. Never the stock browser or system switch. Reduced motion: no glass or stretch.
- Motion system (2026-11-10): every duration and curve comes from `app/src/ui/motion.ts` (respond / glide / exit / standard).
  Sheets glide in 340 ms and leave in 240 ms with no overshoot; long sheets (assets, signals, chart tools, trades here, trade details) stop at the middle first and go to 90% on drag or scroll (300 ms); dialogs grow from 96%; banners fade and drop in, fade out;
  pages: main tabs switch at once, other pages rise 12 px fully opaque (no fades: they blinked) (`ScreenEnter` in the tabs layout, not the navigator's fade,
  which flashed the previous tab); the five most used pages are prepared after Home. Late content uses `ui/FadeIn.tsx`.
  Full reasoning: `docs/design/PRINCIPLES.md`.

## Mascot and feature tiles (owner 2026-11-04)
- `Mascot` is our own character in fixed brand colours, with poses: `hello`, `book` (learning), `trophy` (Funded), `face` (the avatar). Never copy another brand's character.
- The avatar is always the mascot face in the violet ring, with the unread count on it.
- `GlossIcon` tiles carry feature shortcuts: nearly flat, sharp colour in white mode, a richer gradient in dark mode (an exception to the dark rule "gradient only in the logo", for these tiles).

## Glass: where and how (owner request 2026-10-30, Liquid Glass skill)
- Glass is for the control/navigation layer only: tab bar, tablet rail, desktop sidebar, round icon buttons, secondary
  buttons, segmented tracks, chips, steppers, section links ("Open ›"), floating chart controls.
- Content stays solid: cards, lists, money, forms, sheets and dialogs (these get only the glass top lip).
- `app/src/ui/glass.ts`: `glass()` (Regular only; Clear was removed), `glassEdge()` for solid
  buttons (keeps colour solid for contrast, adds the rim), `glassLens()` for the selected item inside glass.
- Material (details under "Real liquid glass"): about 2 px blur + saturate 170%, near-clear tint, bright top lip, soft
  drop shadow. No backdrop-filter or "reduce transparency": solid `#1A1A1D` with the same rim.
- No glass on glass, except the neutral selection lens inside a glass track.

## Controls
- Every button is a capsule (height / 2 radius). Primary white + glass edge; secondary = clear glass; Up/Down solid green/red
  with black text + glass edge.
- Icon-only controls = `IconButton` (glass circle 40-44 px, accessible name required). No bare icon buttons.
- Stand-alone text links become small glass capsules with violet text; links inside sentences stay links.
- Segmented controls (`Segmented`): one glass track, one lens that glides to the selection; same font weight selected or not.
- Chip rows (`ChipRow`, owner 2026-11-04): Filter buttons and chips stay on one line and scroll sideways when they do not fit; never wrap them onto a second line (no flexWrap on chip rows, hide the scrollbar). Grids of cards or time-frame cells may wrap.
- Press: scale 0.96 for 120 ms + light dim, no wobble; none when the system asks for reduced motion.

## Navigation (owner 2026-10-30)
- Phone (< 768 px): floating glass pill at the bottom; neutral glass lens glides between tabs (420 ms, iOS deceleration curve). Its motion follows the finger: progress is the distance scrolled (170 px end to end), and if scrolling stops part-way it settles gently in that direction. Scrolling down parts it into two pieces of liquid in the middle, after Apple's joined drops: the selected page's lens becomes a round drop, the other four icons squeeze into a capsule (46 px per item, 54 px tall). They part and join like real water, as one body (owner 2026-11-06): the bridge covers the rims where it attaches, its colour flows from the drop into the capsule, and it thins until it is gone. That stage always takes about 520 ms, however fast the page is flicked. Nothing is left between the pieces, no circle or droplet at any point. At rest they sit apart with an 18 px space. It pours back on scrolling up, at the top or on a tap. A tap does not shake anything: no squash, wobble, press shrink or droplet under the finger, the selection simply moves (owner 2026-11-06). Hold and drag along it to change page. No hover effects on navigation (owner 2026-11-05). LOCKED (owner 2026-10-30: "use the old navigation, I like it"); a flat flush bar was tried and rejected.
- Phone, parting on scroll (owner 2026-11-07): the selected page's drop goes to the side it belongs to. Home and Trades left, Market and Help right, Terminal takes turns, one time left, the next right.
- Tablet (768-1023 px): floating glass capsule rail on the left, icon above label (LOCKED: "tab side bar, not mobile").
- Desktop (>= 1024 px): floating glass sidebar with logo, icon beside label.
- Selected tab: neutral lens, violet icon, white label. (The skill suggests a solid violet block on side navigation; white on
  violet is only ~3:1, so the lens + violet icon is used for contrast.)

## Chart (LOCKED decisions, owner 2026-10-30)
- Live candle at 70% of the chart width; the right 30% shows the trade window. Scrolled into the past, candles slide right to
  the price numbers (no empty space).
- "Back to now": icon-only round violet button, centred on the chart.
- Open trades: one marker per cluster with a count badge, glowing line to an end ring, time-left pill. Tap = trade sheet
  (or a list for a cluster).
- Price axis: drag up/down or wheel to zoom prices; double tap resets. Momentum bar labels say "up ticks / down ticks".
- 6 months of history: 15 m, 30 m, 1 h, 4 h, 1 D candles.

## Screens
- Profile (LOCKED layout, owner 2026-10-30): identity card (initials avatar in violet ring, badges), then grouped sections
  Personal details, Security, Admin, Account with icon rows that open in place.
- Money on trades: "You put in / Profit or You lose / You get back or You keep" card on open and finished trades.
- Empty states: icon in a soft circle + short title + one line of guidance (+ optional action).
- Avatar = user initials in a violet ring (Home header, Profile); the mascot is for lessons, banners and Welcome only.
