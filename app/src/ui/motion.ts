// The app's motion system. Every animation takes its duration and curve from here, so the whole app moves as one.
// Principles (docs/design/PRINCIPLES.md): motion explains a change; it never decorates. Quick to respond, calm to settle,
// no bounce on routine things (sheets, banners, pages). Only transform and opacity move. Reduced motion: fades only.
import { Easing } from 'react-native';

export const EASE = {
  respond: Easing.bezier(0.2, 0.8, 0.2, 1),   // press, hover, switches: starts at once, settles softly
  glide: Easing.bezier(0.32, 0.72, 0, 1),     // things that travel and arrive: sheets, selection, reveal (iOS deceleration)
  exit: Easing.bezier(0.3, 0, 0.8, 0.15),     // leaving: gathers speed and is gone, so it never lingers
  standard: Easing.bezier(0.4, 0, 0.2, 1),    // fades and colour changes
} as const;

export const MOTION = {
  pressScale: 0.96, pressMs: 120,             // press: a quick, small give; no wobble
  hoverScale: 1.02, hoverMs: 160,             // mouse over: grows 2% (small controls only)
  glideMs: 300,                               // selection drops and segment lenses (420 felt slow, owner 2026-11-10)
  fadeMs: 180,                                // cross-fades, colour
  enterMs: 260, enterRise: 12,                // a page arriving: rises 12 px, fully opaque (no fade: fading from nothing blinks)
  // main tabs switch at once: a fade from nothing showed the page background for a moment (a blink)
  sheetInMs: 340, sheetOutMs: 240, sheetSnapMs: 300,   // bottom sheets: no overshoot; snap = between the middle and 90% stops
  dialogInMs: 220, dialogOutMs: 160,
  toastInMs: 280, toastOutMs: 200, toastHoldMs: 3200,   // long enough to read two lines
} as const;
