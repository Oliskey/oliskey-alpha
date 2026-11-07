---
name: oliskey-liquid-glass
description: Use when designing, building, auditing, polishing or debugging Liquid Glass-inspired UI (glass buttons, icons, tab bars, toolbars, sidebars, menus, popovers, sheets, floating actions, glass cards, page spacing, responsive layouts or transitions), or when glass looks milky or flat, text on glass is hard to read, glass animations stutter, or refraction smears or mirrors content.
---

# OLISKEY LIQUID GLASS — COMPLETE DESIGN & ENGINEERING SKILL
Version 1.9 | Reusable instructions for AI coding agents (1.1: proven web technique §31, decision record §32; 1.2: stable option groups and fixed-size multi-view cards; 1.3: sequential folding, directional settle, stable scroll handlers, narrow-row text; 1.4: concentric selection, liquid (metaball) joins, scroll-morph headers, glass switches; 1.7: Apple research rules §34, adaptive background, hover reveals; 1.8: real-liquid recipe, three-layer stack, filter budget, Apple's GlassView; 1.9: §35 start-from-scratch recipe for dark mode, liquid, layout, fonts, speed)

## 0. Purpose and authority

This skill is mandatory whenever an agent designs, implements, audits, polishes, refactors, or debugs Liquid Glass-inspired UI: buttons, icons, navigation, toolbars, sidebars, popovers, menus, floating actions, pages, spacing, responsive layouts, or transitions.

Read this with the repository's existing frontend, accessibility, and product skills. It does not authorize redesigning a previously approved screen.

**Evidence rule:** Apple’s public Human Interface Guidelines and developer documentation are authoritative for Apple’s documented principles. Web implementations are adaptations, not Apple’s proprietary renderer. Clearly distinguish (1) Apple-documented guidance, (2) a web technique inspired by it, and (3) an Oliskey-specific decision. Never invent an “Apple rule.” Check current official sources if the task depends on changing guidance.

## 1. What Liquid Glass is

Liquid Glass is not just `backdrop-filter: blur(...)`, a transparent fill, a gradient border, a shadow, or a glossy highlight. Apple describes a dynamic material that combines optical glass properties with fluidity, blurs content behind it, reflects surrounding color and light, and reacts to touch and pointer interactions.

Its visual and motion qualities work together:
- lensing/light bending
- translucent material and background blur
- adaptive tint, luminosity, and contrast
- geometry-aware highlights
- depth and shadows
- shape geometry
- responsive touch/pointer feedback
- morphing and transitions
- legibility protection
- deliberate placement in the interface hierarchy

Do not make every property visually obvious. The result should feel like one quiet, coherent material—not a stack of CSS tricks.

**Core product rule:** Liquid Glass should help important controls and navigation feel like a distinct, lightweight functional layer above content. It must not obscure content or compete with it. Oliskey’s goal is not “make everything glass”; it is to use selected glass elements where they improve clarity, depth, and interaction.

## 2. Apple-grounded principles

### 2.1 Lensing
Apple identifies lensing as a defining visual property: content beneath the glass subtly bends or warps, communicating presence, form, motion, and depth.

Web adaptation:
- Use subtle, localized distortion only when reliable and performant.
- If true backdrop refraction is unavailable or too costly, use a restrained approximation.
- Never distort essential text or controls enough to impair reading.
- Do not add obvious wavy distortion just to prove an effect exists.

### 2.2 Dynamic light and highlights
Highlights should relate to the shape’s geometry and suggest a curved, light-reactive surface; they should not look like a thick white outline.

Web adaptation:
- Use restrained edge lighting and carefully controlled highlights.
- Keep the treatment coherent across button, icon, and navigation variants.
- Avoid neon glows, bright uniform borders, and sticker-like edges.

### 2.3 Background adaptation
Apple describes tint, luminosity, contrast, and shadows adapting to what is behind the material so controls remain legible while content shows through.

Web adaptation:
- Test over light, dark, colorful, photographic, and busy backgrounds.
- Prefer a regular/legibility-first treatment over unpredictable content.
- Use highly transparent treatments only over suitable rich media with deliberate contrast protection.
- Do not assume one fixed translucent white value works everywhere.
- Provide a stable fallback when filters are unsupported or disabled.

### 2.4 Depth and separation
Shadows and tonal differences help separate controls from content without making the control heavy.

Web adaptation:
- Add shadow only when it improves separation.
- Adjust separation to the real background.
- Avoid strong repeated shadows around every element.
- Never use shadows as a substitute for clear geometry or sufficient contrast.

### 2.5 Fluid interaction
Apple designed appearance and motion together. Controls can respond with changes in light, depth, flexibility, and transitions between related states.

Web adaptation:
- Give immediate, restrained press feedback.
- Animate related menus from their trigger when practical.
- Use coherent timing and easing.
- Respect `prefers-reduced-motion`.
- Never make animation the only indication that an action succeeded.

### 2.6 The material stays subordinate to content
Apple recommends Liquid Glass primarily for the functional/navigation layer, not all content surfaces. Overuse competes with the content and weakens hierarchy.

Web adaptation:
- Reserve glass for a deliberate set of important controls and navigation.
- Use standard content surfaces for articles, forms, tables, lists, dashboards, and most cards.
- Avoid glass-on-glass layering.

## 3. Where to use it

**Strong candidates:** floating navigation, tab bars, toolbars, compact icon buttons over content, selected prominent actions, popovers, transient controls, media controls over photos/video, and compact menus that emerge from a glass control.

**Use cautiously:** text-heavy menus, alerts, sidebars, sheets, complex forms, expanded controls, dense desktop toolbars, and overlays over high-detail backgrounds. Legibility wins over transparency.

**Usually avoid:** every content card, every KPI, full-page glass behind paragraphs, tables with glass on each cell, form fields whose transparency hurts contrast, nested glass cards, decorative glass blobs without purpose, and wrapping every icon in its own glass bubble.

Before adding glass, ask:
1. Is this a control/navigation layer or content?
2. Does the effect improve hierarchy or interaction?
3. Is the background suitable?
4. Can content remain readable?
5. Would a normal surface be clearer?
6. Does it respect the approved design system?
7. Is the rendering cost justified?

If the effect does not improve the experience, do not add it.

## 4. Regular and Clear variants

Apple documents Regular and Clear variants with different behavior and intended use. Do not treat them as interchangeable or mix them randomly within a related control family.

### Regular-like
Use for general-purpose controls/navigation, text-bearing surfaces, and changing backgrounds. Prioritize adaptive legibility, controlled translucency, tonal adjustment, and separation.

Web adaptation: combine backdrop blur with a controlled translucent fill and a contrast layer when necessary. Check foreground contrast. Provide a fallback surface if transparency is unsupported or reduced.

### Clear-like
Use only when a component floats above visually rich media and the media should remain prominent. It is more transparent and requires deliberate contrast protection.

Web adaptation: inspect bright and dark regions behind every label and icon. Add local dimming when needed. Do not use Clear-like glass over arbitrary dashboard data or text. Re-test when scrolling changes the background.

Apple’s guidance mentions a 35% dark dimming layer as an example for bright content in its context. This is not a universal web constant; measure the actual composition.

### Variant consistency
Choose based on background, content, and interaction—not taste alone. Do not randomly alternate between clear-like and regular-like treatments among neighboring controls.

## 5. Material stack: web implementation model

This is an implementation model inspired by Apple’s documented visual properties, not a claim about Apple’s internal renderer:
1. Shape geometry
2. Background blur/sampling
3. Translucent fill
4. Adaptive/semantic tint
5. Optional subtle optical-edge/lensing approximation
6. Restrained specular highlight
7. Shadow/depth when needed
8. Clear foreground content
9. Interaction state
10. Fallback treatment

These layers should combine into one quiet impression, not look like ten separate effects.

Rules:
- Keep text and icons above material layers.
- Avoid opaque overlays that defeat transparency.
- Avoid intense gradients that look metallic or plastic.
- Avoid thick white borders.
- Ensure pseudo-elements do not intercept pointer events (`pointer-events: none` when appropriate).
- Manage stacking contexts and `z-index` intentionally.
- Do not blur a whole scrolling page when only a small control needs the effect.
- Check that focus rings and popovers are not clipped by overflow.

## 6. Shapes, radii, and concentricity

Apple’s design-system guidance emphasizes coherent geometry and concentricity: related shapes should fit together through deliberate relationships among radii, padding, and alignment.

- Use capsules when pill geometry suits the role.
- Use circles for genuinely compact icon controls.
- Use rounded rectangles for larger panels and controls that need a less pill-like silhouette.
- Do not force every element into a capsule.
- Avoid unrelated, arbitrary radii.
- Related controls should look like members of one family.

When a rounded control sits inside a rounded container, align centers deliberately, make inset/padding visually balanced, relate inner and outer radii, and inspect the actual rendered corners. A relationship such as inner radius ≈ outer radius minus inset can be a useful starting geometry, not a universal law. Optical balance matters too.

Inspect tiny icon buttons, standard buttons, large actions, floating toolbars, grouped controls, expanded menus, and responsive size changes. A shape that looks good at 64px may look awkward at 32px.

## 7. Liquid Glass buttons

A glass button remains a semantic, accessible button. Material never replaces meaning.

### 7.1 Decide its role first
Choose primary, secondary, tertiary/text, icon-only, destructive, selected/toggle, navigation, or floating action. Do not use glass to make every action equally prominent.

### 7.2 Shape and dimensions
- Choose capsule, circle, or rounded rectangle according to role and content.
- Give labels adequate horizontal/vertical padding.
- Align icon and label optically.
- Avoid oversized controls without a reason and tiny targets that are hard to tap.
- Maintain a consistent size scale within each context.
- Apple platform guidance often uses a 44×44 pt minimum hit region; treat this as a useful reference, not a direct CSS-pixel equivalence. Follow applicable platform and accessibility requirements and increase target size where needed.

### 7.3 Surface
- Use restrained translucency and blur.
- Use subtle edge lighting, not a thick border.
- Add shadow only when needed.
- Use semantic tint sparingly for primary/selected actions.
- Do not saturate every button.

### 7.4 Label and icon
- Prefer clear action verbs such as Save, Create, Continue, Close.
- Avoid unfamiliar icon-only actions unless meaning is clear and an accessible name is provided.
- Add visible text when an icon is ambiguous.
- Keep icon weight, size, alignment, and optical center consistent.
- Never bake essential text into an icon image.

### 7.5 Required states
Design and test default, hover where applicable, keyboard focus, pressed, disabled, loading, success/error feedback, and selected/toggled state when relevant.
- Default: calm and legible.
- Hover: restrained highlight/tonal shift; never required for mobile discovery.
- Focus: visible, high-contrast, not clipped or hidden by blur.
- Pressed: immediate brief feedback in highlight, scale, depth, or tint.
- Disabled: clearly inactive but still legible; opacity alone may be insufficient.
- Loading: communicate progress and prevent duplicate submission when appropriate.
- Success/error: communicate accessibly, not only through color.
- Selected: clear without overwhelming the material.

### 7.6 Placement
- Page-level primary action: predictable page/header area.
- Contextual action: near affected content.
- Form completion: near the end of the form.
- Long workflow: sticky action region only when it helps.
- Frequent single action: floating action only when discoverable and non-blocking.
- Rare/secondary action: menu/overflow.
- Destructive action: clearly separated and confirmed when consequences warrant it.

Never move an approved button just because another placement looks fashionable.

### 7.7 Button failure checklist
No illegible labels over changing backgrounds; no sticker-like white border; no glow-only focus indicator; no hover-only actions; no competing primary actions without reason; no random gradients; no decorative motion on every tap; no nested glass buttons by default; no control that looks clickable but does nothing.

## 8. Liquid Glass icons

Icons communicate before they decorate. Separate the icon artwork from its container. Most icons should not each become a glass bubble.

Identify whether the icon is a symbol on a glass control, a standalone glass icon button, a selected navigation symbol, or an illustration in content.

- Use one coherent icon family and consistent stroke/filled style.
- Prefer recognizable symbols.
- Add labels where symbols are ambiguous.
- Keep icon-label spacing consistent and align optically.
- Preserve recognizable silhouettes against translucent backgrounds.
- Avoid reflections crossing and obscuring the glyph.
- Keep symbols high contrast and simple at small sizes.

Every interactive icon-only control needs an accessible name, visible focus, adequate hit target, and a clear selected/pressed state where relevant. Desktop tooltips can supplement discovery but never replace accessible names or essential instructions. Do not confuse Liquid Glass controls with app-icon asset requirements; follow the current target-platform icon specifications for app icons.

## 9. Navigation, toolbars, sidebars, menus

### Floating navigation
- Keep its relationship to the page obvious.
- Leave enough breathing room.
- Let content show through only if readability remains strong.
- Do not cover important content, inputs, toasts, or the virtual keyboard.
- Respect safe areas and browser UI.
- Ensure the last scroll item can move fully above a bottom bar.

### Tab bars
- Keep primary destinations manageable.
- Use recognizable icons and labels when labels help comprehension.
- Make selection clear without relying only on color.
- Preserve touch target size.
- On narrow screens, rethink information architecture instead of squeezing every destination into one row.

### Toolbars
- Prioritize frequent, relevant commands.
- Avoid overcrowding.
- Keep action order predictable.
- Use overflow for rare commands when it reduces clutter without hiding important functionality.
- Make icon-only commands understandable.

### Sidebars
- Adapt to width and input method.
- Use a sidebar when it improves orientation on larger screens.
- Switch to a suitable drawer/navigation pattern on narrow screens.
- Keep selection, focus, hierarchy, and labels legible.

### Menus and popovers
- Anchor to the trigger.
- Preserve spatial continuity.
- Use motion that communicates the trigger-result relationship.
- Prevent offscreen rendering.
- Support keyboard navigation and focus management.
- Close with Escape where expected and restore focus to the trigger.
- Do not make text disappear into the background.

### Avoid glass-on-glass
Do not put a full glass surface on top of another full glass surface by default. For controls inside glass navigation, use restrained fills, vibrancy, contrast, or a distinct selected state rather than another obvious glass shell around every item.

## 10. Cards and content surfaces

Apple distinguishes Liquid Glass for functional/navigation layers from standard materials for content layers.

Default to readable standard surfaces for cards, tables, forms, settings rows, lists, articles, analytics, dashboard sections, learning content, and data-entry panels.

Cards are grouping tools, not default containers:
- avoid nested cards
- do not put every row in a card
- keep collection padding, radius, typography, actions, and alignment consistent
- let content determine the layout
- avoid excess shadows, giant radii, gradients, and floating panels without purpose
- preserve a clear distinction between content surfaces and floating navigation

If a product explicitly requires glass cards, treat this as a project-specific direction, not a universal Apple rule. Apply selectively, preserve contrast, reduce nested containers, test different backgrounds, and ask before changing an approved design system.

## 11. Pages, backgrounds, edge-to-edge content

Organize every page so people can identify the page context/title, primary task, main content, secondary information, navigation, and contextual actions. Glass must support this hierarchy.

Backgrounds:
- support content and controls
- avoid noisy decoration behind text
- do not blur the entire page by default
- use photos/video only when media is meaningful
- add local dimming when contrast needs it
- test as content scrolls beneath fixed controls

Edge-to-edge content can be useful when controls float above it, but implement only when it suits the product. Handle safe areas, browser chrome, and scroll boundaries. Use `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` where supported and relevant; do not assume every browser/device behaves identically.

When content scrolls behind a floating bar, preserve legibility at the edge. A gradient, mask, or subtle blur approximation may work on the web, but avoid hard seams and expensive full-screen effects.

## 12. Page padding, margins, and spacing

Apple does not prescribe one universal page margin. Use consistent relationships, adapt to available space, respect safe areas, and preserve readable content widths.

If the repository has spacing tokens, use them; do not create a competing scale. If none exists, an initial web scale could be `4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96` CSS px. These are project tokens, not official Apple values.

Example starting page gutters—not rigid Apple rules:
- compact mobile: 16px inline padding
- larger mobile: 20px
- tablet: 24–32px
- desktop: 32–40px
- wide desktop: centered max-width content with sensible gutters

Spacing relationships:
- related items closer; distinct sections farther apart
- controls get enough surrounding space
- text blocks have comfortable line length
- related screens share predictable page gutters
- empty space should establish hierarchy, not look accidental
- avoid cramped content and purposeless empty areas

Content width:
- do not stretch prose, forms, or reading content across ultra-wide screens
- dashboards can use more width than long-form prose
- tables may need horizontal scroll, prioritized columns, or a mobile-specific presentation
- input width should suit the data type where practical

CSS guidance:
- use design tokens and `box-sizing: border-box`
- use Grid/Flexbox, `minmax()`, `clamp()` where appropriate
- prefer logical properties such as `padding-inline` and `margin-block`
- use responsive container rules and safe-area variables where relevant
- avoid arbitrary one-off margins, fixed widths that break mobile, layout-wide absolute positioning, and many conflicting media-query overrides
- do not “fix” mobile by shrinking every font and gap without recomposing the layout

## 13. Responsive behavior

Responsive design is recomposition, not shrinking. Test narrow phones (~320 CSS px), typical phones (~375–430 CSS px), large phones, tablet portrait/landscape, laptop, desktop, wide desktop, and intermediate widths. These are test categories, not mandatory device specifications.

Requirements:
- floating controls do not cover essential content
- navigation transforms appropriately (e.g. sidebar to drawer/bottom navigation) when justified
- buttons wrap/reflow intentionally
- cards change columns based on available content width
- forms remain usable with the virtual keyboard open
- menus/popovers remain onscreen
- text wraps without clipping
- larger text/zoom do not break controls
- essential actions never depend on hover
- touch, keyboard, and pointer are all considered

Do not squeeze a four-column desktop dashboard into a narrow phone and call it responsive. Reorganize priority and hierarchy: decide what stacks, collapses, scrolls, moves, or becomes a separate step.

Sticky/floating elements must respect safe areas, avoid bottom-navigation and keyboard collisions, keep scroll padding, avoid colliding with toasts/dialogs/menus, and have a non-floating alternative if they block content.

## 14. Color, tint, contrast

Apple documents that Liquid Glass can take on color from the content behind it and that tint can emphasize selected controls. On the web, imitate carefully; do not add strong brand gradients everywhere.

Use existing semantic tokens for primary action, secondary action, text, secondary text, background, surface, elevated surface, border, focus, success, warning, error, and information.

Tint rules:
- tint primary/selected controls only when it strengthens hierarchy
- do not tint every icon, card, border, and label
- test the same tint over light, dark, photographic, and colorful backgrounds
- never communicate state by color alone
- test text/icons against the actual composed background, not only the nominal translucent fill
- keep focus indicators visible
- support increased contrast and reduced transparency where feasible
- use a local backing layer when needed

## 15. Typography and readability

Liquid Glass must not turn typography into decoration.
- use the existing type scale
- use concise, familiar labels
- preserve hierarchy among page title, section title, body, label, metadata, and helper text
- avoid tiny labels and excessive all-caps
- maintain contrast over variable backgrounds
- support browser zoom and larger text
- avoid fixed heights that clip text
- test long localized labels and RTL layouts if supported
- do not blindly imitate proprietary Apple typography; prioritize legibility and the approved product font stack

## 16. Motion and transitions

Motion should explain state, hierarchy, and relationships—not create decorative noise.

Suitable: immediate press response, restrained highlight/tint shift, gentle lift, menu expansion from trigger, coordinated morph between related controls, selected-state transition, and sheet/popover motion from a logical origin.

Use short coherent transitions tuned to the real interface. Do not claim a specific duration/easing is an official universal Apple value unless documented for that API. Respect `prefers-reduced-motion: reduce` and simplify nonessential movement. State changes must remain clear without animation.

Avoid constant floating/breathing effects, long springy movement for routine tasks, delayed input, layout shifts, motion that obscures focus, animation as the only feedback, and unrelated easing styles across one interface.

## 17. Accessibility and inclusive design

Accessibility is a first-class requirement:
- semantic HTML/native semantics
- keyboard navigation and logical focus order
- visible focus
- accessible names for icons
- form labels and error associations
- screen-reader announcements for dynamic state
- contrast over changing backgrounds
- adequate targets
- zoom and larger text
- reduced motion
- no color-only state
- correct dialog focus trap/restore
- Escape behavior where expected
- no hover-only actions
- no content hidden behind sticky/floating controls

**No-explanation test:** a young/inexperienced user, a typical adult, and an older/less technically experienced user should understand basic tasks without someone explaining the interface. If not, simplify language, strengthen hierarchy, use familiar controls, add labels to ambiguous icons, increase spacing/target size, remove unnecessary decisions, and use progressive disclosure. Keep the UI professional, not childish.

## 18. Performance and fallback

Large or numerous blur effects can be expensive. Limit the number and area of simultaneous backdrop filters. Prefer a small glass control over full-screen blur. Avoid continuous filter animation, layout reads/writes in animation loops, unnecessary compositing layers, and large dependencies for tiny effects. Profile low-powered phones, scrolling, and realistic backgrounds.

Fallback rules:
- provide a readable semi-opaque/solid surface if `backdrop-filter` is unsupported
- core navigation must not depend on a visual effect
- honor reduced motion/transparency settings where possible
- if distortion is unavailable, retain shape, tint, highlight, and readable depth
- fallback must look intentional and fit the design system

Progressive enhancement order:
1. accessible semantic component
2. correct layout/spacing
3. readable surface and contrast
4. basic blur/translucency
5. edge highlight and restrained depth
6. optional optical distortion
7. interaction motion
8. performance/accessibility fallback

Never sacrifice the first four to achieve distortion.

## 19. Web component architecture

Use the existing framework/conventions; do not migrate frameworks solely for a glass effect.

Potential reusable pieces (use existing equivalents if present): `GlassSurface`, `GlassButton`, `GlassIconButton`, `GlassNavigation`, `GlassPopover`, `GlassToolbar`, and shared glass tokens/fallbacks.

Keep the API small and controlled: variant (regular-like/clear-like), size, shape, semantic tint, interactive, disabled/loading/selected states. Avoid dozens of props that let each screen drift.

CSS architecture:
- centralize tokens
- isolate glass layers to components
- do not globally convert all buttons/cards to glass
- ensure pseudo-elements do not intercept input
- manage `z-index` deliberately
- verify focus-ring and popover clipping
- check stacking contexts and backdrop sampling
- keep foreground content above material layers

If using SVG displacement maps:
- keep displacement subtle
- test all supported browsers and busy backgrounds
- provide a fallback
- check filter-region clipping
- profile performance
- do not distort essential foreground text
- never claim it is Apple's internal implementation

## 20. Native Apple implementation boundary

For native Apple apps, prefer current official platform APIs rather than manually recreating the entire material. Apple's SwiftUI documentation includes `glassEffect(_:in:)`, `Glass.regular`, `Glass.clear`, `Glass.tint(_:)`, `Glass.interactive(_:)`, `GlassEffectContainer`, `glassEffectID(_:in:)`, `glassEffectUnion(id:namespace:)`, and `glassEffectTransition(_:)`. Follow current API availability and official examples; do not assume these SwiftUI APIs exist in CSS or React.

For web apps, describe the result honestly as a Liquid Glass-inspired approximation.

## 21. Example tokens and CSS foundation

Do not overwrite an existing approved design system. The values below are illustrative starting points only—not Apple values. Test before shipping.

```css
:root {
  --glass-radius-control: 999px;
  --glass-radius-panel: 20px;
  --glass-regular-fill: rgb(245 248 255 / 58%);
  --glass-clear-fill: rgb(245 248 255 / 22%);
  --glass-edge: rgb(255 255 255 / 42%);
  --glass-shadow: 0 8px 28px rgb(10 20 35 / 14%);
  --page-gutter-mobile: 16px;
  --page-gutter-tablet: 28px;
  --page-gutter-desktop: 36px;
  --glass-transition-fast: 140ms;
  --glass-transition-standard: 220ms;
}

.glass-surface {
  position: relative;
  isolation: isolate;
  color: var(--glass-foreground, #172033);
  background: var(--glass-regular-fill);
  border: 1px solid var(--glass-edge);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(18px) saturate(1.25);
  backdrop-filter: blur(18px) saturate(1.25);
}

@supports not ((backdrop-filter: blur(1px))) {
  .glass-surface {
    background: var(--glass-fallback, rgb(245 248 255 / 94%));
  }
}

.glass-surface::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(145deg, rgb(255 255 255 / 24%), transparent 42%, rgb(255 255 255 / 5%));
}

.glass-button {
  border-radius: var(--glass-radius-control);
  min-height: 44px;
  padding-inline: 18px;
  transition: background-color var(--glass-transition-fast) ease,
              box-shadow var(--glass-transition-fast) ease,
              transform var(--glass-transition-fast) ease;
}

.glass-button:focus-visible {
  outline: 3px solid var(--focus-color, #1769e0);
  outline-offset: 3px;
}

.glass-button:active { transform: scale(0.985); }

@media (prefers-reduced-motion: reduce) {
  .glass-button { transition: none; }
  .glass-button:active { transform: none; }
}
```

This foundation does not implement true dynamic lensing/refraction. The gradient is only a restrained highlight approximation. Tune fill, contrast, radius, blur, and shadow against real backgrounds. Test fallbacks, focus rings, zoom, and responsive behavior. Never apply the class globally to every card/button.

## 22. Existing frontend: adopt without needless rebuilding

Before implementation:
1. inventory routes and shared components
2. inspect current tokens/design system
3. identify approved/locked screens and components
4. inspect interaction and responsive behavior
5. classify each area as KEEP + POLISH, IMPROVE, REFACTOR, RECREATE, REBUILD, or REMOVE
6. choose one representative surface for a pilot
7. implement and verify it
8. update shared tokens only after the pattern is approved
9. roll out deliberately
10. audit all impacted routes and states

Do not convert every button/card automatically. Prove the pattern first. Preserve business logic, APIs, permissions, validation, route semantics, and existing workflows.

## 23. Oliskey approved-design lock and self-updating style

Mandatory product rule: when the user says they are satisfied with a page, button, card, color, spacing, typography, icon, navigation pattern, or visual treatment, mark it **LOCKED**. Do not change it for aesthetic reasons. Ask permission before changing its visual identity.

Only critical functional/security/accessibility problems or blocking technical constraints justify a change without prior visual approval. Explain the issue and preserve the approved appearance as closely as possible.

Learn from explicit user decisions, not guesses:
1. identify the approved pattern
2. determine the reusable rule actually supported by that decision
3. record it in the repository’s design source of truth
4. reuse it consistently
5. do not contradict it without permission

Do not infer a global rule from one isolated example. Use existing records if available; otherwise consider `docs/design-system.md`, `docs/approved-patterns.md`, or `docs/frontend-decisions.md`. Record glass usage, variants, tints, button shapes/sizes, icon rules, content surfaces, page gutters, responsive behavior, motion, accessibility, locked components, exceptions, and rationale.

## 24. Two-agent minimum: Builder + independent Verifier

For meaningful frontend work, use at least two coordinated agents.

**Builder:** reads this and relevant repository skills, inspects the target, plans, implements, preserves approved design, and records changes/uncertainties.

**Verifier:** independently tests the **same screen/task** against the same requirements. It checks visual quality, responsive behavior, interactions, accessibility, performance, runtime/build/tests, business behavior, and locked-design protection. It can reject the work; it must not merely trust the Builder’s summary.

Do not satisfy the agent requirement by having one agent build Screen A while another builds unrelated Screen B. For one task, both agents work on that same task/screen/feature slice.

Required loop: `PLAN → BUILD → VERIFY → FIX → VERIFY → PASS`.
For broad/high-risk work: `PLAN → BUILD → VERIFY → FIX → VERIFY → SECOND REVIEW → PASS`.
The Builder cannot self-certify. If verification fails, the task is not complete.

## 25. Required verification checklist

### Visual
- Does the surface read as a material rather than plain blur?
- Is lensing subtle and purposeful?
- Do highlights follow shape geometry?
- Are shadows restrained and useful?
- Does the surface adapt to light/dark/busy backgrounds?
- Is the variant appropriate?
- Is glass-on-glass avoided?
- Are buttons/icons/navigation consistent?
- Is hierarchy clear and approved design preserved?

### Interaction
- Do all controls work?
- Are focus/pressed/disabled/loading/success/error states correct?
- Are menus anchored and dismissible?
- Is keyboard focus restored correctly?
- Is selection clear?
- Is motion useful and reduced-motion-safe?

### Responsive
- phone, tablet, laptop, desktop, wide desktop, intermediate widths
- no unintended horizontal overflow
- chip rows: Filter buttons and chips stay on one line and scroll sideways when they do not fit; never wrap them onto a second line (no flexWrap on chip rows, hide the scrollbar). Grids of cards or time-frame cells may wrap.
- no clipped text/icons
- no hidden primary actions
- floating controls do not cover content
- popovers stay onscreen
- no keyboard collisions
- page padding adapts coherently

### Accessibility
- semantic elements and accessible names
- keyboard support and visible focus
- sufficient contrast
- larger text/zoom
- reduced motion
- no color-only state
- adequate target sizes
- screen-reader announcements when necessary

### Engineering
- build/typecheck/lint/tests as available
- no new runtime/console errors
- no broken imports
- no unnecessary dependencies
- no obvious rendering/scrolling regression
- fallback works
- business logic and permissions preserved

Final report: what was inspected, changed, tested, passed, failed, and remains; state limitations of the web approximation. Never claim completion without evidence.

## 26. Common failures — do not ship

- blur alone called Liquid Glass
- every card transparent
- glass-on-glass everywhere
- strong white outlines or excessive glow
- gradients dominating the UI
- distorted text or poor contrast over photos
- no fallback
- motion without reduced-motion support
- tiny tap targets or unlabeled icon buttons
- fixed-width mobile-breaking layouts
- sticky bars covering content
- arbitrary page padding
- changing approved UI without permission
- Builder declaring success without independent verification
- claiming parity with Apple’s proprietary renderer from CSS alone

## 27. New project implementation plan

1. Understand product, users, tasks, and constraints.
2. Inventory pages/routes.
3. Define content and navigation layers.
4. Identify where glass is genuinely useful.
5. Separate ordinary content surfaces from functional glass.
6. Establish shape, spacing, color, type, and motion tokens.
7. Build one representative glass control and navigation surface.
8. Test light, dark, busy, and media backgrounds.
9. Implement accessibility and fallback.
10. Validate responsive behavior and performance.
11. Get user approval.
12. Lock approved patterns and update design records.
13. Roll out deliberately.
14. Use Builder + Verifier for each meaningful task.
15. Reconcile routes/states before completion.

## 28. Existing project implementation plan

1. Read repository frontend skills/design system.
2. Map routes, layouts, shared components, tokens, and states.
3. Identify locked designs.
4. Audit buttons, icons, navigation, cards, gutters, and responsive behavior.
5. Do not rebuild automatically.
6. Choose one high-value, low-risk pilot.
7. Implement using existing conventions.
8. Have the independent Verifier test the exact same surface.
9. Fix and reverify.
10. Ask for approval before broad rollout if visual identity changes.
11. Record approved decisions.
12. Roll out only to suitable components.
13. Verify every affected route and viewport.

## 29. Official references

1. Apple — Meet Liquid Glass, WWDC25: https://developer.apple.com/videos/play/wwdc2025/219/
   Lensing, dynamic behavior, adaptation, layers, motion, variants, and usage principles.
2. Apple — Materials, HIG: https://developer.apple.com/design/human-interface-guidelines/materials
   Functional/navigation layer, standard content materials, limited use, Regular/Clear variants.
3. Apple — Applying Liquid Glass to custom views (SwiftUI): https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views
   `glassEffect`, shapes, tint, interactivity, containers, merging/morphing, transitions, performance.
4. Apple — Glass API: https://developer.apple.com/documentation/swiftui/glass
   Regular, Clear, tint, and interactive configuration.
5. Apple — Liquid Glass technology overview: https://developer.apple.com/documentation/technologyoverviews/liquid-glass
   Adoption and cross-platform design considerations.
6. Apple — Color HIG: https://developer.apple.com/design/human-interface-guidelines/color
   Liquid Glass color and tint behavior.
7. Apple — Layout HIG: https://developer.apple.com/design/human-interface-guidelines/layout
   Hierarchy, alignment, adaptable layout, and spacing.
8. Apple — Get to know the new design system, WWDC25: https://developer.apple.com/videos/play/wwdc2025/356/
   Shape geometry, concentricity, controls, information architecture, and adapting across platforms.

### 29.1 Research sources used for the Oliskey navigation and glass decisions (owner request, 2026-10-28)
Official Apple sources are authoritative; the rest are secondary (tutorials, forums, third-party libraries, an encyclopedia) — use them for orientation and confirm against Apple's docs before stating anything as Apple guidance.

9. Donny Wals — Exploring tab bars on iOS 26 with Liquid Glass: https://www.donnywals.com/exploring-tab-bars-on-ios-26-with-liquid-glass/
   Tab bar minimize behavior, the separate search tab.
10. Create with Swift — Making the tab bar collapse while scrolling: https://www.createwithswift.com/making-the-tab-bar-collapse-while-scrolling/
    `tabBarMinimizeBehavior(.onScrollDown)`: only the selected tab shows while scrolling down; it expands again on scrolling the other way.
11. Apple Developer Forums — iOS 26 Floating Search Tab in UIKit: https://developer.apple.com/forums/thread/793249
    A search-role tab (`UISearchTab`) is automatically separated from the tab bar (basis for the separate AI button).
12. Apple — Materials, HIG (markdown): https://developer.apple.com/design/human-interface-guidelines/materials.md
    No Liquid Glass in the content layer; use it sparingly; regular vs clear variants; dimming guidance.
13. Apple Developer Forums — A Summary of the WWDC25 Group Lab – Design: https://developer.apple.com/forums/thread/791070
    Regular glass is legible by default; clear glass needs more care; check contrast; adapts to Reduce Transparency / Increase Contrast / Reduce Motion.
14. Wikipedia — Liquid Glass: https://en.wikipedia.org/wiki/Liquid_Glass
    History: readability feedback in betas led Apple to raise navigation-bar opacity (secondary source).
15. flutter_liquid_glass_kit — LiquidGlassButton: https://pub.dev/documentation/flutter_liquid_glass_kit/1.0.6/flutter_liquid_glass_kit/LiquidGlassButton-class.html
    Reference press values: scale 0.96, ~120 ms (third-party, not Apple).
16. skills.sh — liquid glass skill guide: https://skills.sh/ahmed3elshaer/everything-claude-code-mobile/liquid-glass
    Glass answers touch with scaling, bouncing, shimmering and illumination; `.regular` / `.clear` / `.identity` variants (third-party summary).
17. Codrops — Creative Gooey Effects: https://tympanus.net/codrops/2015/03/10/creative-gooey-effects/
    The gooey SVG filter (blur + alpha threshold) behind the liquid join.
18. CSS-Tricks — The Gooey Effect: https://css-tricks.com/?p=195076
    Filter values (blur ~10, alpha 18/−7) and limits of CSS-only versions.

When stating an Apple recommendation, link to the relevant official source. Label CSS values, breakpoints, and web techniques as project recommendations or approximations—not official Apple specifications.

## 30. Non-negotiable rules

1. Liquid Glass is a coordinated material, not blur alone.
2. Use it primarily for functional/navigation layers, not every content card.
3. Keep content readable and hierarchy obvious.
4. Use Regular-like treatment for general legibility; Clear-like only over suitable rich media.
5. Avoid glass-on-glass unless there is a clear reason.
6. Geometry, spacing, color, and motion must be coherent.
7. Responsive behavior is structural, not optional.
8. Accessibility and performance are mandatory.
9. A web implementation is an approximation; do not claim Apple’s proprietary renderer.
10. Approved designs stay locked unless the user authorizes change.
11. Explicit preferences update the product design record.
12. Builder and independent Verifier work on the same task/screen.
13. Verifier can reject the work.
14. Follow PLAN → BUILD → VERIFY → FIX → VERIFY → PASS.
15. No skipping, silent redesign, or completion claims without evidence.

## 31. Proven web technique (Oliskey Fleet, 2026-10) — web approximation, not Apple's renderer

Learned by building and measuring the Oliskey navigation. Treat values as tested starting points.

### 31.1 Refraction (lensing) that looks like glass
- Make one displacement map **per element at its exact pixel size**, rebuilt on resize (never per frame).
- Rim profile: convex squircle `y = (1-(1-x)^4)^(1/4)` over a bezel of ~14–22px; follow a straight-down ray with Snell's law (n = 1.5); sideways shift = thickness · y(x) · tan(θ1 − θ2). Encode R/G = 128 ± 127 · vector, `scale = 2 · maxShift`.
- **Sample inward** (towards the centre). Sampling outward reads outside the element and makes the rim milky.
- Keep the rim ≤ ~35% of the element height; a steeper ramp **mirrors** text under the edge.
- Filter: `backdrop-filter: url(#map) blur(≈3px) saturate(170–180%) brightness(1.03–1.06)`. ~1px blur lets text behind fight the labels; ~20px looks like frosted plastic.
- Chromium only (detect via `navigator.userAgentData.brands`, set `html[data-refract]`); Safari/Firefox get the same shape, rim and blur without bending.

### 31.2 Light, tint and legibility
- Tint almost clear (light ≈ white 5–20%, dark ≈ navy 20–30%). Body comes from the rim and the bend, not opacity.
- Rim light = per-element canvas map (bright where the bevel faces top-left light, faint opposite) on its own `::after` layer so each theme sets its strength (dark ≈ 0.4).
- A soft dashboard-colour glow behind the page (one fixed layer, no blur/animation, off in print) gives glass something to catch. Glass over flat white is invisible by nature — accept it or give the element body.
- Labels/icons on glass: soft halo (`text-shadow`, `drop-shadow`) and one shade stronger colour.
- Selected item inside glass = a small neutral "lens" (glass-on-glass exception, see §9).

### 31.3 Motion that stays smooth on cheap phones
- Animate only `transform`/`opacity` of **fixed-size** glass. Never animate width/height of glass (layout + map rebuild per frame = stutter).
- "Resize" by scaling a fixed piece or cross-morphing two fixed pieces (full bar ↔ one drop).
- While glass moves, use the light filter (no `url()`), restore the bend at rest (`[data-moving]` flag; stylesheet `!important` custom property beats an inline var).
- Scroll-linked motion: one 0..1 value written straight to `style` per rAF; React state changes only at thresholds; settle to the nearer end ~140ms after scrolling stops, with a small overshoot.
- Never feed a measured size back into what it measures (a tucked bar measuring its own tab shrank to a sliver). Keep sizes from the stable state.
- Counter-scale text inside scaled glass; fade labels until the shape is nearly settled.
- Groups of options (segmented controls, chart switches, chips, choice cards): one glass drop behind the selected option, moved by transform; stretch across, then settle (~600ms, gentle ease). Selected and unselected labels use the **same font weight** so nothing shifts.
- Cards with several views (Numbers/Bars/Share, chart/table): stack all views in one grid cell so the card is always as tall as its tallest view; cross-fade with a slight settle. Switching must never change the card size or move what is below it.
- Put a view switch where the content changing above/below cannot push it (stack the views, or place the switch above them).
- Sequential folding of a row of glass items (tab bar): keep the items in a fixed-size layer moved only by transform/opacity, and put the glass shape in a separate layer whose **width** follows the packed items (one isolated element, light glass + rim-highlight fade while it moves, maps cached per size). Fold order and per-item progress come from one 0..1 value with overlapping stretches.
- Settle points for multi-step motion: settle to the nearest *step* in the direction the person was moving (a quarter into the next step completes it), never only to the two ends - otherwise short flicks undo themselves.
- Functions driven by scroll/rAF must keep a stable identity (read changing props from a ref); re-creating them on every render re-subscribes listeners and silently resets progress.
- Text inside narrow flex rows: give labels a real minimum (e.g. min-w 10rem, or their own row) — large-text modes that allow wrapping anywhere turn a 0-width flex child into letter-by-letter text.
- Separating/merging shapes (two drops parting): draw only the **web between them** as an SVG path from the metaball construction (tangent points at a spread of ~0.5 around each round end, cubic handles along the tangents, short inner arcs, sweep 1), filled ~85% white with a 1px bright edge on the two concave curves and a soft drop shadow; it thins with distance and disappears past ~3.2 radii. Never let two glass rims cross: crossing rims read as "overlapping", not liquid.

### 31.6 Selection, headers and switches
- **Concentric selection:** a selection drop inside a pill keeps the same inset on every side (e.g. 6px in a 68px bar → 56px drop, radius = outer radius − inset). Folded to one item, the pill becomes a circle with the drop centred — the same size as any neighbouring round button.
- Off-centre highlights (top-left radial shine, `inset 1.5px 1.5px` spec) on a small drop look like a second, offset circle. On small drops use a symmetric rim: thin even ring + top-edge light + soft bottom glow.
- **Measuring inside transform layers:** `offsetLeft/Top` of a child of a `will-change: transform` element are relative to that element (often 0). Measure with `getBoundingClientRect()` against the real container, with the item's own transform removed while measuring.
- Items folding into a shape are clipped to it (`clip-path: inset(... round r)` on the layer, updated with the shape's width) so nothing hangs outside the glass.
- **Scroll-morph header (iOS large title → slim bar):** one sticky header (`top: -(height − slim)`) and the page scrolls natively; measure each piece's start and end box once (resize / fonts ready), store `--dx/--dy/--s` per piece, and per frame write only `--p` (0..1). Decide per width who fits in the slim bar (logo + title, title alone, or the control alone) and fade the rest early; keep a moving control from covering text by recomputing the text's fade edge from the control's live position every frame.
- **Switch (required for every on/off control; never ship the stock browser or system switch):** coloured track (at least 3:1 against the page) + white pill knob (wider than tall); while pressed the knob becomes a clear glass drop (near-clear fill, bright inset rim, light backdrop blur) that grows ~12% past the track and stretches as it slides, settling back to white on release. Same drop for keyboard and programmatic changes. Keep a 44 px tap area and `role="switch"`. Reduced motion: no glass, no stretch. On React Native, animate the knob with transform and opacity only, and fall back to a white rim with no blur.

### 31.4 Verifying glass
- Playwright screenshots over colourful **and** white content, light **and** dark, phone/tablet/desktop.
- See mid-motion frames: CDP `Animation.setPlaybackRate` for CSS/WAAPI; for rAF-driven motion use fast low-DPR captures.
- Frame timing with CPU throttled 4× **compared with a baseline that has the motion switched off** — only extra long frames are the glass's fault.
- Large text 150/200%, no sideways scroll, no page errors, e2e passing. Builder + Verifier (§24).

### 31.5 Failure → fix
| Symptom | Cause → fix |
|---|---|
| Milky/white bar | too much tint, outward sampling → near-clear tint, inward map |
| Mirrored/doubled text at the rim | ramp too steep / scale too big → wider rim, smaller scale |
| Stutter opening/closing | animating size, rebuilding maps → transform only, light filter while moving |
| Invisible piece on white | clear glass over white → give it body (white ~85%, soft shadow) |
| Silver band in dark mode | rim light at light-mode strength → per-theme rim opacity |
| Old look after deploy | service-worker cache → reload / new build hash |
| Selection drop stuck to the top edge | offsetTop inside a transform layer → measure with bounding rects |
| Drop and its container look like overlapping circles | uneven inset / off-centre highlight → concentric inset, symmetric rim |
| Two drops overlap instead of joining | rims crossing → draw only the metaball web between them |

A working React reference (per-element map hook, liquid tab bar, sliding lens, CSS) is in `reference.md` next to this skill.

## 32. Oliskey decision record
Oliskey's approved and locked patterns live in `docs/design-system.md` in the repository. Read it before any UI change; update it when the user approves or rejects a pattern (§23).

## 33. Proven attractive recipe (default starting point when generating any new app)

Owner-approved, shipped patterns (2026-10). Use these as the attractive DEFAULT for a new app; adapt the specifics (hue, exact motion) per brand. Each is a web technique inspired by Apple, not an Apple rule.

### 33.1 Vivid-but-shaped colour
- Give each role/section ONE confident, saturated accent (a clean orange, indigo, violet…) used ONLY for: the header band, the primary action, selected states, and key icons. Everything else stays calm — neutral surfaces, near-black text. "Shape" = one sharp colour against quiet, not colour everywhere.
- The accent is a short two-stop gradient (`--g-accent`, ~15° lighter→base) for primary buttons/tiles; a flat accent for text/links. No brown, no yellow glow, no muddy mid-tones.
- The hero/balance card is NOT the accent: use a deep graphite/near-black card (`#0A0A0B → #000`, or `#2C2C30 → #1C1C1E`) with the accent only in a progress ring and a link. A dark card makes the accent read as premium and keeps big figures legible.
- Define colours as tokens on `:root`, redefine per role via `:root[data-role="…"]`, and provide dark-mode + reduced-transparency fallbacks.

### 33.1b Clear crystal glass — the owner's reference look (supersedes the old "thick frosted" advice, 2026-10-28)
- The owner's references (Apple Music tab bar, Control Center, WWDC25 glass, glass-shape sets) are CLEAR glass: the page shows through, softly; the body has almost no fill. What makes it read as glass is the EDGE, not opacity. A thick 55–65% white fill looks like frosted plastic / a milky slab — the owner rejected it ("not looking like liquid at all").
- Recipe (tokens): fill ≈ white 12–26% (light) / navy 24–30% (dark); `blur ≈ 3–4px` + `saturate 180–190%` + `brightness 1.04–1.06`. NEVER put a 10px+ blur after the refraction map — the blur erases the bending and the lens disappears (shipped bug: 14px blur, flat bar). Same low blur while moving.
- Edge light, three layers: (1) a 1–1.25px ring masked to the edge (`::before`, `padding:1.25px; mask: content-box exclude`) whose linear gradient is brightest on top; (2) two sharp GLINTS on that ring — radial spots at top-left (full white) and bottom-right (~75%) — the signature highlight in every reference; dark mode tints them faintly cyan; (3) a faint chromatic fringe — `inset 2px 0 3px -2px` cool (cyan) on the left, warm (magenta) on the right, ~0.35–0.45 alpha.
- Thicker lens on the navigation: `thickness ≈ 36–40px`, `bezel ≈ 22px` so the bent band is visible. Keep the canvas rim-light map soft in light mode (`--lg-rim-opacity ≈ 0.55`) — at 1.0 it whitens the whole bevel into haze. Keep the inner white glow low (≈ 0.16).
- Labels stay legible with the soft halo (§31.2), not with fill. Content surfaces (cards, tables, money) stay solid, never on glass.

### 33.2 Glass controls, never bare text
- Every button is a capsule (fully round ends). Primary = solid accent gradient + glass gloss + rim (`grad-accent glass-prominent`). Secondary / quiet / section actions = clear glass capsule with the label in the accent (`glass-control text-accent`). Round icon buttons (back, close, copy, bell) are glass circles.
- No bare coloured-text buttons anywhere ("View all", "Clear all", "Edit", "Attach", "Send a new code"… all become glass capsules). Text links inside sentences stay links.
- Segmented controls / chart switches / filter chips = one glass capsule track with a single sliding glass drop (`glass-lens`) under the selection; the chosen label shows in the accent. Make button icons a touch bolder (stroke ~2.25) so icon + label read as one.
- EVERY button carries the glass edge (owner, 2026-10-28: "make sure all button is using the liquid glass"). Secondary/quiet/icon buttons = clear glass (`glass`). Primary = TINTED glass: keep the accent body solid so white text stays ≥ 4.5:1, but give it the glass edge — `border:1px solid transparent` with padding-box accent layers and border-box glints (top-left white, bottom-right ~80%) over a top-bright rim, plus a faint inner bottom light. Stand-alone text links ("Forgot password?", "Back to sign in") become glass capsules; links inside sentences stay links.

### 33.3 The phone navigation — keep the look almost identical; the movement may differ
- Structure (reuse): tabs sit in ONE glass pill; "More" stands alone as a round glass button beside it; the selection is a neutral glass drop with even padding that stretches to the tapped tab with a small spring; tucked, the bar is one clean circle the size of More with the active icon glided to its centre (measure the glide distance so it is centred at every text size).
- Fold/merge: scrolling down folds tabs away one after another (right→left, current tab last); while two pieces touch they are ONE liquid (metaball) glass shape with a clearly concave waist and ONE rim — never two overlapping circles. Give the joined shape its own soft shadow + faint hairline so the waist reads on white pages. On release the waist thins to a thread, holds, snaps, and both ends recoil.
- NON-NEGOTIABLE: the bar's glass must never overlap or sit under More, at any width. Re-measure whenever the bar's space changes (ResizeObserver on the wrap/pill/list) — a scrollbar appearing after load silently narrows it and causes overlap otherwise.
- The MOTION is what you may vary per app (spring stiffness, fold length, detents/haptics). The look and the no-overlap rule stay constant.
- Owner update 2026-10-28 (supersedes the light-blue tint): the selected tab is a soft NEUTRAL glass capsule (grey ≈ 7–11% in light, white ≈ 10–16% in dark, hairline white inner rim) — like Apple Music — with the colour only in the icon and label. Tucked, the bar folds into ONE round drop centred at the bottom of the screen (scale around the centre, not the left).
- MOTION (owner: "very slow and professional"): scrolling only chooses the direction (≈24px of travel); the move itself is one ~1.2s ease-in-out glide, no overshoot. The selection drop glides ~0.9s on the iOS deceleration curve `cubic-bezier(.32,.72,0,1)` with a gentle squash (≤ 1.08×). Each tab it passes gives a detent tick (tiny icon nudge + `navigator.vibrate(6)` where supported — iOS Safari has no web haptics); the landing tab swells with a firmer tick (14ms).
- MEASUREMENT BUG (shipped, owner screenshot): measuring the selection with `getBoundingClientRect` while an ancestor is scaled (the folded bar) stores a shrunken box — the drop ends as a sliver at the far left after the bar reopens. Divide rect offsets and sizes by the group's scale (`rect.width / offsetWidth`) so the lens is always in the group's own unscaled coordinates. Regression test: navigate while folded, reopen, assert lens box == current tab box.
- FINAL owner decisions 2026-10-28 (supersede the timed glide, centred-drop-only and neck notes above): (1) AI is its own round glass button at the right end of the bar and NEVER moves (like Apple Music's separate search button; iOS 26 `Tab(role: .search)`); the bar holds the other four tabs. (2) Scrolling draws the bar in IN PROPORTION — one screen of scroll (or the page's whole scroll length if shorter, min 200px) = fully folded; half = half; scrolling up reverses at the same rate; the top is always open. (3) The other tabs are absorbed one after another (farthest first) into the current tab; folded, the bar is one round drop in the CENTRE showing the ICON ONLY (label fades, icon glides to centre) — matches iOS 26 `tabBarMinimizeBehavior(.onScrollDown)`, which shows only the selected tab. (4) Touch = Apple's: a quick 0.96 press scale (~120ms) + a light pooling under the finger. NO jelly wobble, NO hover lift, NO icon wiggle (owner: "shaking too much … very professional"); haptic ticks stay.
- Glass for navigation/controls = Apple's REGULAR variant (legible by default; Apple raised nav-bar opacity after beta feedback): fill ≈ white 32–50% (light) / navy ≈ 42–48% (dark), blur ≈ 8px, keep the edge light and refraction. Very clear glass (12–26%) made text and colour look soft ("colour is not very sharp"). Text on glass: a tight 1px halo at most — a 6px glow blurs glyph edges — and full-strength ink (not secondary grey) for unselected tabs.
- Testing tip: a chart (lightweight-charts) under the pointer swallows wheel events to zoom; scroll from the page gutter in tests.
- OWNER ANSWERS (2026-10-28, supersede earlier notes): at rest bar and AI button stand APART (small gap); scrolling, a liquid neck joins them, stretches as the bar pulls to the centre and SNAPS (folded: centre drop and AI separate, no string); back at the top it pinches off like a drop. Fold distance = one screen. Nav glass = BALANCED (Apple regular glass, not the very clear variant). On pages that aren't one of the tabs, the bar flows INTO the separate (search/AI) button, nearest tab first. Lay the open state out in CSS (bar `right-[button+gap]`, button `right-0`) so it is correct before the script runs — a JS-only layout put the AI button over Home while loading. Bump the service-worker cache version when the shell changes shape; old cached copies of the app otherwise show old navigation when the server is down.
- LIQUID JOIN, the root technique (2026-10-29): don't hand-draw a neck (masked ellipses read as a faint grey shape, invisible on white). Put a LIQUID LAYER behind the glass: solid copies of the pieces (same size/position, updated per frame) inside a container with an SVG gooey filter — feGaussianBlur stdDeviation≈7 → feColorMatrix alpha row `22 -9` → plus a rim (goo minus erode 1.6, flood white) and a dark refracted band (erode 1.6 minus erode 4, flood navy ~45%) and a soft drop-shadow. Shapes then truly fuse and pinch off. Control the join with each copy's REACH: pulled in at rest (−5px: apart), reaching out once scrolling (+11px: fused), retracting as the gap grows (the neck thins, snaps, and nothing pokes out beside the glass). Sources: Codrops "Creative Gooey Effects" https://tympanus.net/codrops/2015/03/10/creative-gooey-effects/ ; CSS-Tricks gooey https://css-tricks.com/?p=195076 .
- Fold rules (2026-10-29): bottom of the page ALWAYS = fully folded (a delta-only fold stops half way when the page grows or the drop was tapped there); a resting mouse opens the bar and leaving returns to the scroll's fold (debounce leave ~150ms — the piece under the mouse changes as the bar opens); tabs show while there's ROOM for them (~52px each: room for three → three), not by fold fraction; the current tab goes icon-only only when alone. Thick poured-glass edge for navigation: inset bright lip + dark refracted band + soft inner glow (`glass-thick`), stronger refraction (thickness ~58, bezel ~26).
- Testing traps: `page.waitForFunction(async () => …)` returns a Promise (truthy) immediately — poll with `expect.poll` instead; a chart under the pointer swallows wheel events.

### 33.4 Collapsing header — follow the scroll, never move it
- A large header may collapse into a slim bar as the user scrolls, driven entirely by `scrollY` (one `--p` 0→1 along an ease-out curve: most of the change early, settling gently). The slim bar keeps the brand mark + icons full size; greeting/date fade; the title glides in; the band's corners tighten and gain a soft shadow.
- CRITICAL LESSON (shipped bug): do NOT "snap" the header by calling `window.scrollTo` / scrolling the page for the user. On real phones, scroll events fire sparsely during momentum and the address bar resizes mid-scroll, so a programmatic snap runs at the wrong moment and yanks the page to the top. On native, the OS owns the scroll view; on the web, JS must only FOLLOW scroll and never fight it.

### 33.5 Tablet rail and desktop sidebar (the "side navigation")
- Both are floating rounded glass capsules (`glass`, radius ~28px) fixed a few px from the top/bottom/left edge, over the page — not flush panels. The brand mark sits at the top, primary nav below, a secondary/utility action near the bottom.
- The SELECTED item is a VIVID accent drop (`grad-accent` + glass gloss + a soft accent-tinted shadow) with a WHITE icon and label — the same drop on the rail (icon over label) and the sidebar (icon beside label), so the two read as one family. It slides between items with a short spring (measure the active item's box; animate transform/size).
- Unselected items are quiet (secondary/tertiary text, a faint hover fill). Keep the icon family and stroke identical to the phone tab bar. This differs from the phone tab bar on purpose: the phone selection is a neutral glass drop; the side navigation selection is the vivid accent (it has room and benefits from the stronger hierarchy).

### 33.6 App icon / logo from an uploaded image
- Never frame a logo in a white plate. Trim a flat border; fill a solid full-bleed logo edge to edge (zoom a rounded-icon source by its measured corner reach so old corners vanish); knock a WHITE background out to transparency (flood from the edges so inner white detail survives); keep a coloured background (it is design). For a maskable PWA icon, place the artwork in the ~80% safe area over the brand colour.
- SEO/sharing: a square favicon (48/96px) for search, a 1200×630 share image under 300 KB (WhatsApp limit) with declared dimensions, and JSON-LD (Organization / WebSite / SoftwareApplication) referencing the logo.

(Version 1.5: proven attractive recipe for new apps — vivid-but-shaped colour, glass capsule controls, the phone navigation look, follow-scroll headers, logo/icon handling.)
(Version 1.6: clear crystal glass (owner references), glints + fringe edge light, glass edge on every button incl. primary, neutral tab capsule, slow navigation motion with detent ticks, unscaled selection measurement.)


## 34. Apple research rules (2026-11, must all be applied)

Full list with sources and numbering: `references/research-2026-11.md`. Check every Liquid Glass change against this section. Web builds must implement these by hand, because they do not get Apple's renderer.

**Material and light**
- Lensing is what makes it glass: bend at the edges, and let objects appear by increasing the bend, not by a plain fade, where practical.
- Highlights follow the shape's geometry. Use thin rims with small glints, never a uniform white outline.
- Glass flexes with the interaction and lights up from within, starting at the pointer or finger and spreading through the element. Quiet at rest, alive on touch.
- Larger glass reads as thicker: deeper shadow, stronger lensing, softer light. A menu opens as the same bubble popping open.
- On desktop, glass recedes when its window loses focus.

**Adapting to the background**
- Glass has no fixed look; it adapts continuously to what is behind it.
- **Small elements flip** between light and dark (nav bars, tab bars, floating buttons), and their icons and labels flip with them.
- **Large elements adapt but never flip** (menus, sidebars, sheets).
- **Shadow reacts:** stronger over text, weaker over a plain light background, growing as text scrolls under.
- Web method: read the nearest opaque paint behind the element while it scrolls or the page changes, pick the tone by luminance, use hysteresis, ease the change, and never sample per frame when idle.

**Variants and tint**
- Regular is the default for any size over any content. Clear only when all three hold: over rich media, a dimming layer does no harm, and what sits on top is bold and bright. Clear always gets dimming.
- **Never mix Regular and Clear.**
- Tint only the primary action. If everything is tinted, nothing stands out. Bring colour in through the content layer.

**Layers**
- Glass is the navigation layer floating over content. Lists, tables, cards and money stay in the content layer.
- No glass on glass. Things on top of glass are thin fills. At rest, content should not intersect glass.
- Custom toolbars and tab bars have no background colour behind them.

**Scroll edges**
- Separate glass from content with a soft edge blur, not a hard divider, and only where floating UI exists. It never blocks or darkens like an overlay, except for subtle dimming over dark content.
- Soft is the default; hard is for macOS-style pinned headers. One per view, never mixed or stacked.
- **Oliskey exception:** the owner rejected any background behind the phone pill, so check with the owner before adding an edge effect there.

**Shape**
- Three shape types: fixed, capsule (half the height) and concentric (parent radius minus padding). Give concentric shapes a fallback radius. Watch for pinched or flared corners.
- Phones: a capsule with margin from the screen edge. Tablet and desktop: concentric with the window edge.

**Navigation**
- Tab bars, segmented controls and sidebars show selection the same way. Coloured glyph plus a highlighted shape.
- A tab bar may minimize on scroll and return. Keep every item reachable with at least a 44 px target, and do not change page spacing while it moves.
- Tab-bar accessories are for persistent features only; screen-specific actions stay with their content.

**Accessibility, required on the web**
- Reduce Transparency: solid or much frostier. Increase Contrast: mainly black or white with a clear border. Reduce Motion: no elastic stretch or shrink.
- Translucent surfaces have no fixed contrast ratio, so measure text against the worst-case backdrop. Apple's own screens were criticised for failing this; do not copy transparency for its own sake.

**Web limits**
- Bending with `backdrop-filter: url()` is Chromium only, and Firefox's `@supports` falsely passes, so gate by browser detection. Ladder: solid, then frosted, then refraction.
- At most 3–4 glass layers per viewport, under ~20px blur on large surfaces, never animate blur. Keep data-dense screens flat.

**Real liquid, not blur (owner verdict 2026-11-05; proven in Oliskey Alpha)**
- If it looks like frost, it is wrong. Near-clear body (white ~40%, dark ~30%), blur about 1.5px, and a real refraction map. Check it with bright stripes behind the glass: the stripes must visibly swell at the rim and stay sharp enough to recognise.
- **Stack three layers as siblings:** empty glass, the selected drop, then icons and labels. A drop nested inside glass cannot bend (the parent's filter is a backdrop root), and a drop above the icons smears them.
- Labels on near-clear glass: one shade stronger than the page's second text, plus a soft halo.
- **Filter only what floats over moving content.** A control inside a scrolling page sits on a flat surface: give it the rim map and no filter. Measured at 4× CPU throttle: 86 frames with filters everywhere, 197 with this rule, 189 with no glass at all.
- Put the bend in the shared button, deciding by whether its style has a backdrop filter, so every glass control gets it without touching call sites.
- On iOS 26+ use Apple's real material: `GlassView` from `expo-glass-effect`, guarded by `isGlassEffectAPIAvailable()` and `isLiquidGlassAvailable()`. Set `colorScheme` when the app has its own theme toggle, and keep opacity at 1 on it and its parents.
- Tab bar parting on scroll (after Apple's joined drops): the selected lens slides out and becomes a round drop, the glass narrows into a capsule of the other items, and a water bridge joins them while they move. Compute its path from the real gap every frame, never a fixed shape fading: draw the bridge with the standard metaball construction (tangent attachment points, handles along the tangents scaled by min(1.2, span / total radius) × min(1, 2d / total radius), closed by arcs along each round edge). Never a hand-drawn waist: the owner rejected kinks and crossing lines as "not real liquid". Pinch it off by sliding the attachment points toward the middle line (v from about 0.86 to 0.1). Give it a real backdrop blur clipped to the path, light along the top edge and fainter shade below. Icons crossing under each other go to about 22% opacity while moving. They must look as if they force themselves apart (owner): through a strain stretch of the scroll the gap opens only to about 8 px while the pieces lean about 3 px together and the waist thins on a power curve (about 1.5). Then it snaps: both pieces are thrown about 8 px apart on a loose spring, and a 12 px clear droplet, stretched at first, rounds up in the gap and shrinks away. Pouring back, the same bridge re-forms and merges. Drive the travel by scroll distance, not a timer (owner: "the more I scroll, the more it moves"): about 170 px end to end, then settle in the scroll direction after about 140 ms of stillness. No backdrop filter on the bridge. While the glass changes size, remove the rim image and the url() filter: a stretched rim or a fixed-size filter region shows as a flash at the moment of separation. Use a slight overrun and a brief flatten for the liquid feel, the light filter while moving, and the rim rebuilt once at rest. Keep every item at 44 px or more, every page one tap away, and page spacing unchanged. Pours back on scrolling up, at the top or on a tap.
- Liquid touch (owner rejected a subtle 2.5% squash as "not liquid"): under the finger a clear droplet (about 58 px, thick bending rim, 10-22% white fill) swells past the bar on a spring and sits between the glass and the icons so they stay sharp. The stack squashes +4% wide, -7% tall on a firm spring. On release the droplet bursts to 1.5× and fades in about 360 ms while the stack returns on a loose spring (tension ~170, friction ~5) so it wobbles once or twice. Skip all of it under Reduce Motion. No hover effects on navigation (owner's choice).

**Controls that appear on hover (Oliskey rule, based on WCAG 1.4.13)**
- Hover reveals such as × on a tab or Cancel on a row also appear on keyboard focus, and are always visible on touch screens. Reserve their space so nothing jumps, and let the pointer reach them.
- Rows that scroll sideways show round arrows at the edges on mouse hover, only on sides with more to see, because a mouse cannot swipe.

## 35. Start-from-scratch recipe (2026-11, proven on Oliskey Alpha)

Use this whenever a new app is designed or an app is redesigned from zero. Before designing anything, read the whole `Frontend Skills` folder in the project if it has one, then plan. Labels: **[Apple]** Apple's guidance, **[Research]** common design guidance, not a standard, so test it, **[Owner]** this owner's verdicts, **[Measured]** found by measuring on Oliskey Alpha. Sources: `references/research-2026-11.md`.

### 35.1 Order of work
1. Read the skills, then ask only what changes the result: theme default, base black, accent, what must never change.
2. Write tokens first, for both themes together. Build the shared parts next (button, field, glass, row), then the pages.
3. Look at real screenshots in both themes before saying anything is done. Use an independent verifier (§24). Expect it to find real defects.
4. Publish to where the owner actually looks, and tell them. Work that only exists in a test copy does not count. [Owner]

### 35.2 Dark mode
- Dark is designed, not inverted. Many colours change and some do not. [Apple]
- **Depth comes from lighter surfaces, not shadows.** Shadows barely show on dark. Apple uses a dimmer base set and a brighter elevated set. [Apple]
- Default ladder: page `#000000`, card `#0E0E10`, input and pill `#1A1A1D`, hairline `#26262A`, grid `#141416`. [Measured]
- Pure black or dark grey is a real choice: Material-style guidance prefers about `#121212`, because it leaves room for elevation; true black suits OLED and sharp colour. This owner chose pure black. Ask, do not assume. [Research] [Owner]
- Accents get lighter for dark: the same violet is `#5B2EFF` on white and `#8B7BFF` on black. Up and down get brighter too: `#00D27A`, `#FF3D5A`. Their white-mode versions are darker: `#007A46`, `#E0103A`. [Measured]
- Measure every text and icon colour on every surface it sits on, not only the page. Minimum 4.5:1 for text, 3:1 for shapes and large text. Second text `#A0A0A8` gives 8.3:1 on black and 7.4:1 on cards. [Measured]
- Text on filled controls flips: black on bright green and white capsules in dark, white on violet, green and red in white mode. Use one `onFill` token, and check it in both themes. A hard-coded white badge failed at 3.29:1 on the light dark-mode violet. [Measured]
- Pure white on pure black glows on long reading. Off-white (about `#F2F2F2`) and a little extra line height help for paragraphs. White is fine for short, sharp labels, figures and headings. [Research]
- Light text looks heavier on dark: use a slightly lighter weight for long text if the font allows it. [Research]
- Keep hairlines on cards: without them near-black cards vanish. A primary button can be white on black: it is the sharpest thing on screen.
- One bright thing per area. Colour only on the main action, selection, up/down and feature tiles.
- Glass in dark: fill about `rgba(24,24,28,0.3)`, rim light at about half strength, a top lip of white about 20%. Stronger rim reads as a silver band. [Measured]
- Soft violet light behind a logo or glass is fine. Do not put it behind content, and in white mode do not tint the page at all. The owner rejected lavender outright. [Owner]
- Follow the device by default and keep any saved choice. Test both ways on first visit. [Owner]
- Autofill: style it, or browsers paint inputs pale yellow on dark.

### 35.3 Liquid glass that reads as real
Rules are in §31 and §34. The owner's verdicts on what is and is not liquid:
- **Blur is not liquid.** Near-clear body, about 2px blur, a true edge bend. Check with bright stripes behind it: they must swell at the rim and stay recognisable. [Owner]
- **Layers as siblings:** empty glass, selected drop, then sharp icons on top. Nested glass cannot bend, and a drop above icons smears them. [Measured]
- **Separate with the metaball construction.** Tangent attachment, handles along tangents, pinch by sliding the attachment points to the middle. Hand-drawn waists have kinks and crossing lines. [Owner]
- **Motion follows the finger, not a timer.** Scroll distance drives it, and it settles in the scroll direction once still. [Owner]
- **Things force themselves apart:** strain over a long stretch while the gap barely opens, then snap, recoil, and leave a droplet. They must not simply drift. [Owner]
- **Pieces rest apart** with a visible gap (18px). The bridge exists only in motion. [Owner]
- **Touch is big enough to feel:** a 2.5% squash read as nothing. Use a clear droplet swelling past the bar, a 4%/7% squash, and a loose spring wobble on release. [Owner]
- **Navigation has no hover effects.** Other controls may grow 2% on hover. [Owner]
- **Moving content under glass:** icons crossing each other go to about 22% opacity while moving. [Owner]
- **Hide the rim image and the url() filter while glass changes size:** a stretched rim shows as a flash. [Owner]
- **Filter only what floats.** Controls inside a scrolling page get the rim and no filter: 86 frames with filters everywhere, 197 without on a throttled phone. [Measured]
- A sideways drag on a touch bar needs `touch-action: none`, on the pieces only, or the browser's back swipe steals it. On a full-width wrapper it blocks taps on the page. [Measured]
- iOS 26+: Apple's own `GlassView`. Use `GlassEffectContainer` for real merging when native is tested.
- Switches are liquid (§31.6). Never ship a stock one. [Owner]

### 35.4 Layout
- 4/8pt spacing. Page gutter 16 on phones. Tap targets 44px or more, by invisible extension if needed.
- Reading width: forms 420, text 560, lists 880, dashboards 1200.
- Breakpoints: phone under 768, tablet 768-1023, desktop 1024+. Test 2560, 1600, 1280, 1024, 820, 393, 360, in both themes.
- **Never let two fields squeeze.** Paired fields use `flex-wrap` with a real `min-width` (about 165px), so they sit side by side only with room and stack otherwise. Text breaking letter by letter is the signature bug of narrow columns, and it hides behind a toggle where sweeps miss it, so open every option while testing. [Measured]
- Sideways rows: one line, hidden scrollbar, soft edge fade, arrows on mouse hover only. Grids may wrap.
- Reveal-on-hover controls also show on focus and stay visible on touch, with their space reserved.
- Desktop: the main tool stays on screen, and other pages open in a side panel beside it.
- One primary action per area. Card only when grouping helps, and never a card inside a card.
- A sign-in page on large screens: brand panel beside the form. Phones: the form alone. A single focal image, true facts only, no decorative charts or fake numbers. Field label above, focus ring, inline errors, input kept after errors, password strength guide, show/hide, autofill names. [Owner]

### 35.5 Fonts
- One family used well: Inter 400, 500, 600, 700. Do not pair two near-identical fonts.
- Scale: 11-12 caption, 13-14 secondary, 15-16 body, 21 section, 30-32 page title, 44 hero. Never smaller than 11 for anything meaningful, 16 for phone inputs.
- Titles tighten (-0.3 to -1 letter spacing). Body stays at 0 and about 1.45 line height.
- Money, prices and timers use `tabular-nums` so they do not jump. Same weight for selected and unselected labels so nothing shifts. Icons one family only (lucide), stroke 1.9-2.25.

### 35.6 Speed and offline, from day one
- Compress built files and cache them for good, as their names carry a hash: 3.85 MB became 0.56 MB here. Check the response headers; a missing setting failed silently until a test measured it. [Measured]
- Save built files with a service worker, and activate it fast. Say honestly what offline can and cannot do: where the server is the source of truth, prices and trades stay locked. [Owner]
- Never keep `node_modules` or build from inside OneDrive or Dropbox: placeholder files make the bundler report that files do not exist. Keep projects in a plain folder such as `C:\dev`. [Measured]

### 35.7 Testing that does not lie
- Run one test at a time. A loaded machine produces false failures. Read frame counts first: very low numbers mean the machine, not the app.
- Keep headless pages rendering (`Emulation.setFocusEmulationEnabled`), or timers and layout stop and tap areas read wrong. [Measured]
- To inspect fast motion, step the scroll and slow the page clock, then look at frames. Numbers alone miss kinks and flashes.
- Test the real paths: wrong password, click-to-navigate from Home, touch drags (which exposed the browser's back swipe), and every toggle opened.

## 36. Live counts on navigation and tabs (2026-11, proven on Oliskey Alpha)

Requested by the owner: when something is running or available, the place that leads to it says how many. A count is a promise that the number is true right now.

**Where to count**
- A navigation item that leads to things in progress (Trades: open trades plus waiting orders on the active account).
- An icon that opens things available to act on (Signals: signals the person can still take, not ones already taken).
- Each tab of the list behind it, so the total can be traced (Fixed Time 2, Forex 1).
- A section heading and a home shortcut's tag, when a person would otherwise have to open it to find out.

**Rules**
- Count only what the person can act on or is waiting for. Never unread decoration, never anything invented to look busy.
- Same source as the list: read the same query key the screen uses, so badge and list can never disagree.
- Filter to the active account, or a demo trade shows up on the real account's badge.
- Zero shows nothing. Above 99 shows "99+". Use tabular figures.
- A number replaces a dot when the count matters; keep the dot only for "something changed" with no useful number. Motion stays separate: blink for new, steady for still active.
- Give the control an accessible name that includes the number ("Signals, signal active, 3 available"). Colour is never the only signal.

**Build**
- Size: 18 px high, 18 px minimum wide, 9 px radius, 11 px bold, 5 px side padding. One shared component with an absolute (on an icon) and an inline (in a tab) form.
- On an icon: top right, overlapping the corner (top -8, right -11), with a 1.5 px ring in the page background so it reads on any surface. Check it is not clipped by the button or bar.
- Text colour is the page background on the fill: dark on light violet in dark mode, white on deep violet in white mode. Measure the contrast in both.
- Tabs: put the number inline after the label, and let the moving selection measure the new width, so nothing jumps.
- Liquid nav: put the badge inside the same animated wrapper as its icon, so it moves, shrinks and fades with the icon and lands on the small drop correctly. Test with the bar collapsed.
- Poll gently (10 to 15 s) and refresh at once on the server's live events and after any action that changes the number.

**Test**
Open a trade: badge goes 0 to 1 on every layout (phone bar, collapsed drop, tablet rail, desktop rail), in white and dark. Close it: the badge disappears. Switch account: it follows. Compare the number with the list behind it.

**AI trades beside the person's own (added 2026-11).** When an automatic trader's trades share a list with the person's, each one carries a corner icon on the asset and the word "AI" in its first line, plus an accessible name that says it is not theirs. Keep them in their own titled section with one plain line saying whose money it is. Tapping explains the trade; it never opens the person's close controls. Count them in the badge only on the account type they belong to, and state that in the section.

## 37. Live updates always go through the hook (2026-11, owner rule)

Prices, candles, momentum and running clocks arrive several times a second. Every one goes through a shared hook and a shared batcher: collected, then applied together a few times a second when the browser has a free moment (`requestIdleCallback` with a timeout, inside `startTransition`), so the screen redraws once for many updates.

- Keep only the latest value where that is all that matters; keep every update where each one counts, such as candle highs and lows.
- A local timer in a component (a countdown) goes through the batcher too.
- A one-off server event (a trade closed, an order filled) stays normal priority: the person is waiting for it.
- Test trap: never measure drawing in a browser window placed off screen. Chromium throttles rendering for windows nobody can see, so layout events stop arriving, and charts and pages look blank. It looks exactly like a real bug. Use a headless browser with focus emulation, and repeat any "blank page" finding in a browser that draws normally before believing it.

**Row actions are icons, and hover follows the shape (added 2026-11).** A small action inside a row (close, cancel, delete) is an icon with an accessible name, not a word: 28 px round, with the tap area extended to 44 px. A hover highlight must take the shape of its control. Never paint a square highlight inside a rounded box: an inner area of a capsule gets no highlight of its own, and any control without a radius falls back to a rounded one.
