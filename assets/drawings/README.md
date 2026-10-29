# Generated GPS drawings

`build.py` writes `js/drawings.js`, the drawings made from pictures and real data. The ones simple enough to draw in code (the bike, the loop, the logo outlines) live in `js/route.js` instead.

Each drawing comes from one of three sources:

- **A picture drawn as dots**: `tsp.py` spreads dots like the picture's shadows and joins them with one short line (TSP art). The lit heart's picture is computed from a 3D heart formula, so it has no file here. The llama comes from an engraving, `sources/llama.jpg`.
- **Real terrain**: `terrain.py` reads elevation from the Copernicus DEM (30 m tiles, downloaded once into `cache/`, which git ignores). The climbs follow their roads from OpenStreetMap, saved in `sources/roads.json` so the build doesn't fetch them again.
- **An icon**: the lightning bolt is Lucide's `zap`, in `sources/zap.svg` with its licence.

The ECG is computed in `build.py` itself.

To add or remove a drawing, change its line at the bottom of `build.py`, then run it again:

```
pip install -r requirements.txt
python3 build.py
```

Drawings listed under `levels` come in three versions, simplest first. A ride follows the richest one its length can draw cleanly (`LEVEL_KM`), and the export window shows the simplest.

`gallery.png` shows every drawing the export window can offer, the hand-drawn ones included, styled like its tiles and named as in `js/route.js`. Refresh it with `node gallery.mjs` (needs Google Chrome) after changing the drawings.
