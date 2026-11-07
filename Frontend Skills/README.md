# Frontend Skills

Three skills that make an app attractive, Apple-quality and consistent. Read them together before any UI work, and when generating a new app follow the **proven recipe** (vivid "shaped" colour, liquid-glass controls, the navigation look, follow-scroll headers). Updated 2026-11-05.

## The three skills

1. **oliskey-liquid-glass-complete-design-engineering.skill.md** — how to build Liquid Glass UI (buttons, icons, tab bar, rail/sidebar, sheets, motion) on the web.
   - **§33 Proven attractive recipe** is the default starting point for any new app:
     - 33.1 Vivid-but-shaped colour (one sharp accent against calm surfaces; graphite hero card)
     - 33.1b **Make the glass thick and visible** (strong frosted fill + ~16px blur — not a thin see-through film)
     - 33.2 Glass capsule controls (no bare text buttons)
     - 33.3 The phone navigation (glass pill + separate More, sliding drop, liquid non-overlapping merge)
     - 33.4 Collapsing header — follow the scroll, never move it
     - 33.5 Tablet rail & desktop sidebar (vivid accent selection, white label)
     - 33.6 Logo / app icon / SEO (no white plate; maskable icon; OG image; JSON-LD)
   - Its code reference is **oliskey-liquid-glass.reference.md** (React hooks, the liquid tab bar, sliding lens, CSS).

2. **oliskey-apple-quality-frontend.skill.v2.md** — the always-on master skill (spacing, hierarchy, buttons, forms, dashboards, accessibility, auditing). Its **§29 Proven attractive recipe** mirrors the above in short.

3. **apple-hig-research-and-frontend-reasoning.skill.md** — Apple HIG reasoning; keeps Apple-documented rules separate from web adaptations. Includes the **collapsing-header scroll boundary** (web headers follow scroll, never call `window.scrollTo` to snap).

## Start here for any new app or redesign
Read **oliskey-liquid-glass-complete-design-engineering.skill.md §35 Start-from-scratch recipe** first: dark mode, liquid glass, layout, fonts, speed and honest testing, with the owner's verdicts and measured values. §34 holds Apple's rules, and **references/research-2026-11.md** has every source and the owner's reference pictures described.

## How to use for a new app
- Keep the NAVIGATION look almost identical across apps (glass pill tab bar + round More, sliding selection drop, non-overlapping liquid merge; vivid-accent side rail/sidebar). You may vary the MOTION.
- Pick one vivid, saturated accent per role/section; everything else stays calm. Hero/balance card = deep graphite, accent only in a ring + link.
- Glass is a substantial frosted pane, not a thin transparent layer.
- Record every approved pattern in the app's `docs/design-system.md` and reuse it.

## Note
The copy Claude Code loads automatically lives at `~/.claude/skills/oliskey-liquid-glass/` and is kept in sync with the liquid-glass file here. These files are the readable source of truth.
