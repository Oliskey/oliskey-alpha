# Liquid Glass research record (November 2026)

Read this with SKILL.md §34. Each rule says where it came from, because SKILL.md §0 requires Apple guidance, web technique and Oliskey decisions to stay separate.

- **[Apple 219]** WWDC25 "Meet Liquid Glass": https://developer.apple.com/videos/play/wwdc2025/219/
- **[Apple 356]** WWDC25 "Get to know the new design system": https://developer.apple.com/videos/play/wwdc2025/356/
- **[Apple docs]** SwiftUI Glass, clear variant: https://developer.apple.com/documentation/swiftui/glass/clear.md
- **[Web]** BuildMVPFast, "Liquid Glass on the Web" (one practitioner's advice, not measurements): https://www.buildmvpfast.com/blog/liquid-glass-css-backdrop-filter-recipes-2026
- **[MDN]** backdrop-filter: https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter
- **[WCAG]** 1.4.13 Content on Hover or Focus: https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus
- **[Infinum]** accessibility review: https://infinum.com/blog/apples-ios-26-liquid-glass-sleek-shiny-and-questionably-accessible/
- **[MacStories]** iOS 26 review, buttons, toolbars and tab bars: https://www.macstories.net/stories/ios-and-ipados-26-the-macstories-review/3
- **[STRV]** How to apply Liquid Glass (secondary): https://www.strv.com/blog/how-to-apply-liquid-glass-to-your-app

**What could not be read:** Apple's HIG pages (Materials, Tab bars) and "Adopting Liquid Glass" returned only their titles to the fetch tool, and the Medium/ekino article returned 403. Re-check those in a browser when a task depends on their exact wording. The sessions are from 2025 and guidance may have changed.

## Apple: what the material is [Apple 219]
1. Lensing is the main way the material defines itself: it bends and concentrates light in real time, where older materials scattered it.
2. Objects materialize by gradually changing how much they bend light. They do not simply fade in and out.
3. Highlights respond to the shape's geometry, and the lights move in space during some interactions. Lighting can also respond to device motion.
4. The material has a gel-like flexibility and moves with the interaction.
5. It responds by flexing and lighting up at once. The glow starts under the finger and spreads through the element and onto nearby glass.
6. Elements can lift into glass temporarily while being used, and stay quiet at rest.
7. A menu opens as the same bubble popping open to reveal its content.
8. On Mac and iPad, glass recedes visually when its window loses focus.

## Apple: adapting to what is behind [Apple 219]
9. Each layer adapts continuously to what is behind it. There is no fixed light or dark look.
10. Small elements (nav bars, tab bars) adapt and also flip between light and dark based on the background.
11. Large elements (menus, sidebars) adapt but do not flip: the area is too big and the change would distract.
12. Symbols and glyphs flip too, mirroring the glass, to maximise contrast.
13. Shadow reacts to content: stronger over text, weaker over a solid light background. It grows as text scrolls underneath.
14. As glass grows larger it simulates thicker material: deeper shadows, stronger lensing and softer light scattering.

## Apple: variants and tint [Apple 219, Apple docs]
15. Regular is the default: any size, over any content, anything on top.
16. Clear never adapts and is permanently more transparent, so it needs a dimming layer.
17. Use Clear only when all three hold: it sits over media-rich content, a dimming layer won't harm that content, and what sits on top is bold and bright.
18. For a small Clear element, use localized dimming so the content keeps more of its colour.
19. Regular and Clear should never be mixed.
20. Tint comes from a chosen colour mapped to tones by the brightness underneath, like coloured glass. Solid fills break the character of the material.
21. Tint only primary elements and actions. If everything is tinted, nothing stands out. Bring colour in through the content layer instead.

## Apple: layering [Apple 219]
22. Glass belongs to the navigation layer that floats above content. Lists and tables stay in the content layer.
23. Avoid glass on glass. For things on top of glass, use fills, transparency and vibrancy as a thin overlay.
24. At rest, avoid content intersecting glass. Reposition or scale the content to keep it separate.

## Apple: scroll edges [Apple 219, Apple 356]
25. Glass needs clear separation from content. Scroll edge effects replace hard dividers with a subtle blur.
26. They are not decorative, and they do not block or darken like overlays. Use them only where floating UI exists.
27. Soft is the default, especially on iOS and iPadOS. Hard is mainly for macOS: interactive text, controls without backgrounds, pinned table headers.
28. Never mix or stack the two styles. Use one per view; split-view panes may each have one at a consistent height.
29. Over dark content the effect becomes a subtle dimming.

## Apple: shape [Apple 356]
30. Shapes nest through concentricity: radii and margins align around a shared centre.
31. Three shape types: fixed (constant radius), capsule (half the container height), concentric (parent radius minus padding).
32. Phone layouts: a capsule with extra margin near the screen edge. iPad and Mac: a concentric shape aligned with the window edge.
33. Use a concentric shape with a fallback radius for when a component stands alone.
34. Watch for corners that look pinched or flared.
35. macOS sizes: mini, small and medium controls stay rounded rectangles; large and extra-large use capsules.

## Apple: navigation and controls [Apple 356, MacStories, Apple 219]
36. Remove background colours from custom toolbars and tab bars.
37. Tab bars organise the app's sections. iOS adds a dedicated Search tab.
38. Accessories on a tab bar are for persistent features such as playback. Screen-specific actions belong with their content.
39. Tab bars, segmented controls and sidebars signal selection and state in the same way, whatever their form.
40. Glass lifts navigation controls off the content and reinforces that they can be used.
41. Tab bars can minimize on scroll (`tabBarMinimizeBehavior`) and expand again. [MacStories] The active tab has a coloured glyph and a highlighted shape; a long press turns it into a selection bubble with lensing.
42. A tinted primary action stands out, such as one red "View Bag" button.

## Apple: accessibility [Apple 219]
43. Reduce Transparency makes glass frostier and hides more of what is behind.
44. Increase Contrast makes elements mainly black or white with a contrasting border.
45. Reduce Motion lowers some effects and removes elastic behaviour.
46. Apple's material gets these automatically. **A web build must add all three itself.**

## Web technique [Web, MDN; not Apple guidance]
47. Base stack: a translucent fill, `backdrop-filter: blur(12–30px) saturate(140–200%)`, a brighter top border, an inset top light and a soft drop shadow.
48. Refraction: `backdrop-filter: url(#lens) blur(2px) saturate(160%)`, with `feDisplacementMap` fed by a map.
49. `url()` in backdrop-filter works in Chromium only. Firefox parses it, passes `@supports` and renders nothing, so gate it by browser detection, not `@supports`. Safari falls back to plain blur.
50. Fallback ladder: solid and readable first, then frosted inside `@supports`, then refraction for Chromium only.
51. Budget: at most 3–4 glass layers per viewport, blur under about 20px on large surfaces, never animate the blur radius (animate opacity), sparing `will-change`, no scroll-linked animation on a heavily filtered surface.
52. Solid-by-default with glass inside `@media (prefers-reduced-transparency: no-preference)`, and `@media (prefers-contrast: more)` with a 2px border. Browser support is uneven, so test it.
53. Glass is for chrome: nav bars, sidebars, command palettes, modals, floating players. Keep data-dense screens flat, because a table over glass changes contrast with every scroll.
54. Translucent surfaces have no fixed contrast ratio. Check against the worst-case backdrop.

## Reading the background on the web [search results; technique]
55. Walk up from the point behind the control to the nearest opaque background, or sample a low-resolution snapshot, then choose foreground by luminance. Canvas sampling needs cross-origin permission. Add hysteresis so it cannot flicker.

## Hover and focus [WCAG, with Oliskey's inference marked]
56. Content revealed by hover or focus must be dismissible, hoverable and persistent.
57. Oliskey inference, not stated by WCAG: a control shown only on hover is a weak fit for keyboard and touch. Reveal it on focus too, and always show it on touch screens.

## Known criticism [Infinum, Apple forums]
58. Testers found some iOS 26 screens below WCAG minimum contrast, and reports of eye fatigue over transparent surfaces. Apple raised opacity during the betas and later added a more opaque setting. Lesson: do not copy transparency for its own sake; measure legibility.

## Apple's renderer on iPhone [Expo docs]
58a. `expo-glass-effect` gives real Liquid Glass through `GlassView` and `GlassContainer` on iOS 26+, and a plain View elsewhere: https://docs.expo.dev/versions/v58.0.0/sdk/glass-effect/
58b. Check `isGlassEffectAPIAvailable()` first, because some iOS 26 betas lack the API and can crash. `isLiquidGlassAvailable()` can still be true when accessibility settings limit the effect. Apple does not recommend opacity below 1 on `GlassView` or its parents.

## Liquid joins [web technique; Apple tool noted]
58c. Metaball bridge between two circles: tangent points, handles along tangents, handle length capped and shrunk when circles close so it never twists: https://varun.ca/metaballs and https://deepwiki.com/dodola/MetaballLoading/2.1-metaball-rendering-algorithm
58d. Gooey filter alternative (blur then a threshold on alpha): works for flat shapes, heavy on CPU, and does not carry glass: https://css-tricks.com/?p=195076 and https://www.visualcinnamon.com/2015/05/gooey-effect/
58e. On iOS 26 the same behaviour comes from `GlassEffectContainer` with `spacing`, `glassEffectID` and `glassEffectUnion` (third-party summaries; check Apple's docs before use).

## Dark mode and type [mostly secondary sources; treat numbers as starting points]
58f. Apple: base and elevated background sets add depth, dark colours are not simple inversions, and greater perceptual contrast may be used: https://developer.apple.com/design/human-interface-guidelines/dark-mode.md
58g. Elevation by lighter surfaces, dark grey such as #121212 over black, desaturated accents, off-white text. These are widely quoted Material-style guidance: https://uxcel.com/blog/12-principles-of-dark-mode-design-627 and https://muz.li/blog/dark-mode-design-systems-a-complete-guide-to-patterns-tokens-and-hierarchy/ and https://blog.prototypr.io/how-to-design-a-dark-theme-for-your-android-app-3daeb264637
58h. Light text looks heavier on dark (irradiation, halation); lighter weight and a little more line height help: https://nerdy.dev/adjust-perceived-typepace-weight-for-dark-mode-without-layout-shift and https://designshack.net/articles/typography/dark-mode-typography
The Material documents themselves were not read directly, and sources disagree on exact values, so measure on real screens.

## The owner's reference pictures (2026-11-05)
Sent through chat. Add originals to `references/images/` if they should be kept. They are study material only and never ship in a product (brand rule).
- **Green switch:** vivid green track with a white pill knob wider than tall; a second version shows the knob as a clear lens with a green-tinted rim, offset from the track.
- **Physical acrylic models:** thick clear pills and circles on a table, with bright, sharp edges and a metaball "neck" where two shapes join.
- **Outline shapes on dark navy:** thin rims with small bright glints at corners, almost no body.
- **A pill over a flower:** frosted, with colour blurring through and clear white text.
- **Controls over an autumn forest:** round and tall pills taking on the colours behind, with white icons.
- **WWDC25 shape on grey:** two drops joined by a neck, very subtle rim, a tiny coloured glint at the lower edge.
- **Lab sheet on white:** lens over a green fill, drops over a blue-to-pink bar, a "+" in a clear circle. Shows glass bending colour at its rim while staying clear.
- **Menu over dark mountains:** rounded rectangle, frosted, white icons and labels, one divider above Delete.
- **Owner's verdict on their own screens:** stock switch and always-visible × rejected; tinted lavender white mode rejected.
