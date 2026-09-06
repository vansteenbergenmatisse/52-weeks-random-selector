# Visual QA — reference comparison

The UI is a faithful adaptation of the supplied "case opening" reference
(`original-*.webp`). This log records the checklist, the comparison passes, and
the fixes applied.

## Reference checklist (extracted before build)

| # | Reference feature | Status |
|---|-------------------|--------|
| 1 | Teal→blue diagonal outer gradient | ✅ matched (`.app-backdrop`) |
| 2 | Centered near-black rounded app panel with border | ✅ |
| 3 | Slim dark header, centered letter-spaced yellow wordmark, top-right control | ✅ (wordmark + user menu / mute) |
| 4 | Large downward arch of rounded rectangular cards | ✅ (SVG-free CSS transforms along a circular arc) |
| 5 | Side cards descend toward edges & rotate tangent to the arc | ✅ |
| 6 | Card accents: red / blue / purple / charcoal (decorative only) | ✅ (do not affect odds) |
| 7 | Large date emoji / real movie artwork replacing weapons | ✅ |
| 8 | Fixed metallic selection frame at top center | ✅ (beveled steel bezel) |
| 9 | Bright yellow up-arrow marker inside the frame | ✅ |
| 10 | Small position markers along the arch | ➖ omitted (low value; kept composition clean) |
| 11 | Yellow primary action button centered below carousel | ✅ ("Spin / Reveal this week") |
| 12 | Status text under the button | ✅ |
| 13 | Legend (top-left) + info badges (top-right) | ✅ repurposed to activity language (legend + Week/Cycle/Pool) |
| 14 | Dense card grid below with small labels + colored corner | ✅ (2→7 cols responsive, colored bottom border) |
| 15 | Gambling copy replaced with activity copy | ✅ |

## Passes

### Pass 1 — first implementation (`02-app-desktop.png`)
Composition matched on first render: arch, metallic frame, marker, colors,
legend, stat chips, grid. **Largest defect:** the winning card was hidden — the
selection frame's center was opaque, so the pick wasn't visible in the frame.

### Pass 2 — frame + reveal (`06`, `07-settled-fixed.png`)
- Rebuilt the selection frame as a **transparent-center beveled steel bezel**
  (the gradient-border trick filled the center with metallic; switched to a
  bordered ring + inset bevel shadows). The winning card now reads clearly inside
  the frame with the yellow marker below it — matching the reference's "item in
  the frame".
- Added a **mystery card** in the frame before reveal so a saved result isn't
  spoiled; the winner only appears once revealed/settled.
- Narrowed the bezel so the card fills the opening snugly.

### Pass 3 — mid-width polish (`09-ref-800x600.png`)
At exactly 800×600 (the reference's own size) the top-right stat chips overlapped
the arch. Fixed by showing the legend/stats only at ≥1024px, so mid widths stay
clean while wide desktop keeps the reference's corner information blocks.

## States captured

| State | Desktop 1440×900 | Reference 800×600 | Mobile 390×844 |
|-------|------------------|-------------------|----------------|
| Login | `01-login.png` | — | — |
| Initial / reveal-pending | `04-reveal-pending.png` | — | — |
| Spinning | `05-spinning.png` | — | — |
| Settled (winner in frame) | `07-settled-fixed.png` | `09-ref-800x600.png` | `08-mobile.png` |

Mobile preserves the curved carousel and central marker with fewer visible cards
(7 vs 13) and no horizontal overflow.

**Movies** (`10-movies-settled.png`): with no TMDB key, movie cards use a 🎬
fallback and a collection-colored result tile; with a key, real posters/backdrops
replace them in cards and the result view.

## Honest gaps

- Not pixel-perfect and not claimed to be — this is a faithful *adaptation* with
  activity theming, not a copy.
- Reference feature #10 (small triangle position markers) intentionally omitted.
- Movie artwork requires a TMDB key; without one, movie cards use a 🎬 fallback,
  so the "real artwork" look in the grid/result is only visible once TMDB is
  configured.
