# Wattamax logos

| File | Use |
| --- | --- |
| `wattamax-icon.svg` | Icon on a dark square |
| `wattamax-icon-light.svg` | Icon on a light square |
| `wattamax-icon-mono.svg` | One colour: the drawing is cut out of a `#111111` square |
| `wattamax-wordmark.svg` | Wordmark with black letters, for light backgrounds |
| `wattamax-wordmark-white.svg` | Wordmark with white letters, for dark backgrounds |
| `wattamax-wordmark-mono.svg` | One colour, all `#111111`, with a thin gap around the TT |
| `wattamax-wordmark-gap.svg` | Black letters and orange TT, with the same gap as the mono version |

## What changed from the first version

The idea stays the same. The orange TT is a bike frame sitting on a trainer in the icon, and the two Ts of WATTAMAX in the wordmark.

In the icon:
- The wheel is about 1.6 times bigger, so it reads as a bike wheel: a ring for the tyre and a hub where the fork ends.
- The box under the left leg became a trainer: a flywheel on two splayed feet. The feet sit 2 units (out of 100) above the bottom of the wheel. Flat feet next to a round tyre look lower than they are, and this lift makes them look level.
- The frame is a little thicker so it holds up at 16 px.
- The ends of the TT bar are cut at the same angle as in the wordmark, so both logos share the exact same TT top.

In the wordmark:
- The letters come from Barlow Semi Condensed Black instead of hand-drawn strokes, so W, M and X look like real letters.
- As before, the T stems are also legs of the As around them. These two As are cut from Barlow's A and made 4% wider, which opens up their counters.
- The ends of the TT bar follow the outer edge of each A, so the orange covers the top of the A exactly and the black leg carries on below it in the same line.
- Without the orange, the TT would merge with the As, so the mono version leaves a thin gap around it. The `-gap` file keeps that gap with the orange TT.

Both logos now lean 20 degrees instead of 28. The frame falls forward less, and the word is easier to read.

## Font

[Barlow Semi Condensed](https://fonts.google.com/specimen/Barlow+Semi+Condensed), Black weight, by Jeremy Tribby, under the SIL Open Font License. It's a grotesque based on Californian road signs: plain, a bit technical, and it stays legible when it's very bold. The upright letters are skewed 20 degrees rather than using the italic, so they match the icon's angle exactly. Every letter is converted to `<path>`, so the files don't need the font.

## Colours

| | Hex |
| --- | --- |
| Black | `#111111` |
| Off-white | `#FAFAF7` |
| Orange | `#F25C05` |
| Border of the light icon | `#DDDDD6` |

The colours haven't changed since the first version.
