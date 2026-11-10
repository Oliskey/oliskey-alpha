# Oliskey Design Principles

Written 2026-11-10 from building Oliskey Alpha and recording how every screen, button and page moved. Reusable for any
new app: keep the structure, change the brand colour and the content. Shared copy (editable): https://claude.ai/artifact/68Tm18bMXq8tgtn1FNfvzL
Locked project decisions stay in `docs/design-system.md`; the engineering detail is in `Frontend Skills/`.

## The ten rules

1. **One job per screen.** Each area has one main action. Everything else is quieter or folded away behind "More".
2. **Show, don't explain.** Icons with short labels beat sentences. If a 12-year-old needs it explained, simplify it.
3. **Colour carries meaning, never decoration.** Green = up or profit, red = down or loss, one accent = selection and links. Everything else is black, grey and white.
4. **Design dark and white mode together.** Dark is designed, not inverted: surfaces get lighter for depth, accents get brighter.
5. **Glass is for controls that float, content stays solid.** Tab bar, round buttons and switches are glass; cards, lists and money are not.
6. **Every button is a capsule with a clear role.** Primary, secondary, up, down, icon. No bare text buttons.
7. **Motion explains a change.** It never decorates. Quick to respond, calm to settle, no bounce on routine things.
8. **One motion system.** Every animation takes its time and curve from one file of tokens, so the whole app moves as one.
9. **Nothing pops and nothing jumps.** Content that arrives late fades in; a page never shows a blank frame or the wrong screen.
10. **Watch it before you ship it.** Record the real interaction, look at the frames in both themes, fix what you see.

## Simplicity and layout

A screen is simple when a first-time user knows in two seconds what it is for and what to tap. Extra steps are fine; a crowded screen is not.

- **Order every screen the same way:** title, the one number or status that matters, the main action, then details.
- **Fold the rest.** Long detail goes behind "More details", "Past tests" or a sheet.
- **One line beats a paragraph.** Notices are one sentence. Empty states are an icon, a short title, one line, one button.
- **Never leave a screen silent.** If something is off on purpose, say why in one line ("AI auto trade: off · Prices here are simulated").
- **Never hide real conditions to look simpler.** Fees, limits and risk stay visible, just short.

| Token | Value | Use |
| --- | --- | --- |
| Side gutter | 16 px | every phone screen |
| Section gap | 28 px | between sections on a page |
| Spacing grid | 4 / 8 px | all padding and gaps |
| Tap target | 44 px minimum | invisible extension if the control is smaller |
| Reading width | forms 420, text 560, lists 880, dashboards 1200 px | wider screens centre the column |
| Breakpoints | phone < 768, tablet 768–1023, desktop ≥ 1024 px | test 360, 393, 820, 1280, 2560 |
| Font | Inter 400 / 500 / 600 / 700 | one family only |
| Type scale | 12 caption, 14 secondary, 16 body, 20–21 section, 30–32 page title | never below 11 px |
| Numbers | tabular figures | money, prices and timers never jitter |

Always check: two fields side by side squeezing text letter by letter (wrap them with a minimum width), and chip rows wrapping onto a second line (scroll them sideways).

## Buttons and controls

Every button is a capsule (radius = half its height), and its role decides its look. One primary button per area.

| Kind | Dark mode | White mode | When |
| --- | --- | --- | --- |
| Primary | solid white, black text | violet, white text | the one main action |
| Secondary | glass or light grey, white text | light grey, dark text | the other choice beside it |
| Up / Down | solid green / red, dark text | solid green / red, white text | trading direction only |
| Icon button | round glass, 40–44 px | round glass, 40–44 px | close, bell, more; always named |
| Switch | green track, white knob that turns to a glass drop while pressed | same | every on/off; never the stock switch |
| Segmented | one glass track, one lens gliding to the choice | same | 2–4 modes |

- Pairs side by side, main action on the right (Withdraw | Deposit, Down | Up). Steppers that belong together share a row.
- Icons over words where the icon is obvious; keep a short label under navigation icons.
- Same font weight selected or not; only the colour moves.
- Disabled = 45% opacity, never hidden.
- Stand-alone text links are small glass capsules; links inside a sentence stay links.
- Cards only when grouping helps, never a card inside a card.

## Colour in dark and white mode

Same roles, different values. Text at least 4.5:1, shapes 3:1, measured on every surface.

| Role | Dark | White | Rule |
| --- | --- | --- | --- |
| Page | #000000 | #FFFFFF | no tint, no glow behind content |
| Card / sheet | #0E0E10 + #26262A hairline | #FFFFFF + #E6E8EE hairline | keep hairlines |
| Input / pill | #1A1A1D | #F4F5F8 | quiet second surface |
| Text | #FFFFFF | #0F172A | 17:1 in white mode |
| Second text | #A0A0A8 | #5B6475 | 8.3:1 / 5.9:1 |
| Accent | #8B7BFF | #5B3DF5 | selection, links, focus only |
| Up / profit | #00D27A | #0A8449 text, #12B76A shapes | 4.7:1 on white |
| Down / loss | #FF3D5A | #E11D48 | 4.7:1 on white |
| Demo / warning | #F5B942 | #B45309 | 5:1 on white |

- Dark mode gets depth from lighter surfaces, not shadows.
- Accents brighter in dark, deeper in white. Text on filled buttons flips with the theme.
- Shapes may be more vivid than text. One bright thing per area.
- Follow the device theme by default, keep the saved choice, load it before the first paint.

## Liquid glass

Glass is the navigation layer floating over content: liquid that bends light, not frost.

- Where: tab bar, rail, sidebar, round icon buttons, segmented tracks, chips, steppers, floating chart controls, pressed switch knobs.
- Not: cards, lists, money, forms. Sheets and dialogs get only a bright top lip.
- Material: near-clear body (~40% white / ~30% dark), 1.5–2 px blur, real edge bend; check over bright stripes.
- Three sibling layers: empty glass, selected drop, then icons and labels.
- Filter only what floats over moving content (86 → 197 smooth frames on a slowed phone).
- Small glass flips with what is behind it (two thresholds); large glass never flips.
- No glass on glass (except the selection lens in a track). Never mix clear and regular.
- Reduce Transparency = solid; Increase Contrast = solid + 2 px border; Reduce Motion = no stretch.
- iOS 26+: Apple's `GlassView` (`expo-glass-effect`).

## Motion (tokens: `app/src/ui/motion.ts`)

| Curve | Bezier | Use |
| --- | --- | --- |
| respond | 0.2, 0.8, 0.2, 1 | press, hover, switches |
| glide | 0.32, 0.72, 0, 1 | sheets in, selection lens, pages, banners in |
| exit | 0.3, 0, 0.8, 0.15 | sheets, banners, dialogs out |
| standard | 0.4, 0, 0.2, 1 | fades and colour |

| Moment | Duration | What moves |
| --- | --- | --- |
| Press | 120 ms | scale 0.96, dim to 90% |
| Hover (mouse) | 160 ms | small controls grow 2%; large rows only tint |
| Main tab switch | 140 ms | fade only |
| Other page opens | 260 ms | fades in rising 10 px |
| Sheet in / out | 380 / 240 ms | no overshoot; backdrop fades |
| Dialog in / out | 220 / 160 ms | grows from 96% while fading |
| Banner in / out | 280 / 200 ms | drops 24 px while fading; stays 3.2 s + reading time |
| Selection lens | 420 ms | glides; label darkens as it arrives |
| Late content | 260 ms | fades in rising 6–8 px (`ui/FadeIn.tsx`) |

- Only transform and opacity move; never width, height or blur of glass.
- No bounce on routine things; springs only for the liquid tab bar.
- Leaving is faster than arriving.
- The control that moves is the feedback (segment labels don't shrink under a still lens).
- Nothing pops: loaded content fades in.
- Reduced motion: fades and colour only.

Fixed on 2026-11-10 (seen in recorded frames): page open flashed the last tab then a black frame → own fade-in + the five
most used pages prepared after Home; first Trades visit blank ~0.3 s → one frame; sheets overshot ~0.6 s → glide and stop;
banners sprang and vanished → fade in and out; segment labels shrank and lit early → still, lit on arrival; Deposit content
popped → fades in.

## Navigation and page movement

| Device | Width | Navigation | Selected |
| --- | --- | --- | --- |
| Phone | < 768 px | floating glass pill, 5 tabs | neutral glass drop, accent icon |
| Tablet | 768–1023 px | floating glass rail, left | same drop, vertical |
| Desktop | ≥ 1024 px | slim rail; main tool stays, pages open in a side panel | panel slides in 280 ms |

- Main tabs switch almost at once (140 ms fade); other pages fade in rising 10 px.
- Prepare likely next pages after the first screen is up, one every 0.6 s.
- Tab bar follows the finger: parts on scroll (~170 px end to end), settles after ~140 ms still, pours back on scroll up or tap.
- A tap on navigation shakes nothing; the selection glides 420 ms. No hover effects on navigation.
- Sheets for a task on top of the page; dialogs only for an urgent yes/no; banners at the top, never blocking taps.

## Checklist before shipping

1. Record real interactions in both themes at 390 × 844 (Playwright `recordVideo`).
2. Cut each into frame strips (`ffmpeg -vf fps=12`, `montage`) and look at every frame.
3. Look for blank or wrong screens, overshoot, content jumps, labels changing early, unreadable mid-fade text.
4. Tap at the centre of the element actually on top (prepared hidden pages repeat the same words).
5. Repeat with Reduce Motion on.

- [ ] One main action per area
- [ ] Capsule buttons with known roles; named icons
- [ ] Contrast measured on every surface, both themes
- [ ] Glass only on floating controls
- [ ] Every animation uses the motion tokens
- [ ] No bounce on sheets, banners or pages
- [ ] No blank frame, no wrong-screen flash, no content pop
- [ ] Reduce Motion, Reduce Transparency, large text checked
- [ ] Recorded frames looked at in dark and white mode
