# Wattamax logos

| File | Use |
| --- | --- |
| `wattamax-tt.svg` | The TT on its own, in orange |
| `wattamax-icon.svg` | Icon on a dark square |
| `wattamax-icon-light.svg` | Icon on a light square |
| `wattamax-icon-mono.svg` | One colour: the drawing is cut out of a `#111111` square |
| `wattamax-wordmark.svg` | Wordmark with black letters, for light backgrounds |
| `wattamax-wordmark-white.svg` | Wordmark with white letters, for dark backgrounds |
| `wattamax-wordmark-mono.svg` | One colour, all `#111111` |

## The idea

The orange TT is the brand mark. It's the double T in waTTamax, and it's also a road bike frame on a direct-drive trainer: the bar is the top tube, the left stem is the seat tube, the right stem is the fork. The bar's overhangs hint at the saddle and the handlebar. The TT is the only orange element, so everything else is black or off-white.

## One TT

There is a single TT, and `wattamax-tt.svg` is the reference. The wordmark uses it at full size and the icon at 40%, without any change to its proportions. On a cap height of 100, the stems are 28 wide, the bar is 25 thick, and the stems are 80 apart. The ends of the bar are cut along the outer edge of the As that sit on either side of the TT in the wordmark. Any new use of the brand should reuse this shape rather than redraw it.

## Slant

Everything leans 20 degrees. A real seat tube is about 17 degrees off vertical, so 20 keeps the frame believable while the word still reads as clearly italic. At 28 degrees the frame looked like it was falling over, and the word was harder to read. The letters are upright Barlow slanted by 20 degrees, not Barlow's italic, so the icon and the wordmark share exactly the same angle.

## The icon

The trainer is on the left and the wheel on the right. We tried flipping them so that the slant would match how a real frame leans, and kept this way round.

The wheel is drawn large on purpose (radius 18 for a TT that is 40 tall), because a small circle reads as an "o", not a wheel. It's a ring for the tyre and a hub where the fork ends, with no spokes: they disappear below 64 px.

The trainer is a flywheel on two splayed feet, which is roughly what a Suito or a Kickr looks like from the side. The disc is solid so it can't be mistaken for a second wheel. The feet are cut flat and sit 2 units above the bottom of the wheel. At the same height they looked lower than the tyre, because a round shape only touches the line at one point.

The hubs are exactly as wide as the stems, so they cover the flat ends of the TT.

## The wordmark

The letters are [Barlow Semi Condensed](https://fonts.google.com/specimen/Barlow+Semi+Condensed), Black weight, by Jeremy Tribby, under the SIL Open Font License. It's a grotesque based on Californian road signs. It stays plain and legible even this bold, which suits an app that is sporty but has no frills.

The TT stems double as the inner legs of the two As around them. Those two As are built from Barlow's A and are 4% wider than the original, which keeps their counters open next to the stems. The bar covers the top of each A, and the black leg carries on below it along the same line.

Without the orange, the TT would merge with the As, so the mono version leaves a 4-unit gap around it. We also tried that gap with the TT in orange, but it doesn't work: once the TT has its own colour, the gap only breaks the ligature.

All letters are converted to `<path>`, so the files don't depend on any installed font.

## Regenerating the files

The SVGs are generated, so don't edit them by hand. The scripts are in `logo/`:

- `tt.py` defines the TT and the slant. Everything else reads them from here.
- `icon.py` draws the icon around the TT.
- `wordmark.py` builds the wordmark from Barlow's outlines (the font and its licence are in `logo/fonts/`), plus the TT on its own.

To rebuild all seven files after a change:

```sh
pip install -r assets/logo/requirements.txt
python assets/logo/build.py
```

## Colours

| | Hex |
| --- | --- |
| Black | `#111111` |
| Off-white | `#FAFAF7` |
| Orange | `#F25C05` |
| Border of the light icon | `#DDDDD6` |
