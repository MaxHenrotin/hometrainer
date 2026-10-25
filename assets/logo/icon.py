from tt import STEM, GAP, OR, f, path, tt, skew

HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <title>Wattamax</title>\n'
DARK_BG = '<rect width="100" height="100" rx="22" fill="#111111"/>'
LIGHT_BG = '<rect x="0.75" y="0.75" width="98.5" height="98.5" rx="22" fill="#FAFAF7" stroke="#DDDDD6" stroke-width="1.5"/>'


def circle(cx, cy, r, hole=False):
    """Clockwise like the polygons, so overlaps stay filled; counter-clockwise for a hole."""
    s = 0 if hole else 1
    return f"M{f(cx - r)} {f(cy)}a{f(r)} {f(r)} 0 1 {s} {f(2 * r)} 0a{f(r)} {f(r)} 0 1 {s} {f(-2 * r)} 0Z"


def icon(scale=0.4, R=18, tire=6.5, ground=82, fly=9.5, foot=14, leg=8, lift=2):
    """The TT scaled down, its stems ending on the axles: trainer on the left, wheel on the right.
    Returns {file name suffix: SVG}."""
    cy = ground - R
    frame = skew(tt(), 0, cy - 100 * scale, scale)      # stems end at the axle height
    sx = STEM * scale / 2                               # trainer axle under the first stem, wheel axle under the second
    cx = sx + GAP * scale
    xs = [x for x, _ in frame] + [sx - foot - leg / 2, cx + R]
    dx = round((50 - (min(xs) + max(xs)) / 2) * 2) / 2  # centre the bbox horizontally, on a half-unit grid
    frame, sx, cx = [(x + dx, y) for x, y in frame], sx + dx, cx + dx
    w = leg / 2
    feet = ground - lift                    # flat feet next to a round tyre look too low: lift them a bit
    inner = cy + (feet - cy) * w / foot     # where the inner edges of the legs cross
    legs = [(sx-w, cy), (sx+w, cy), (sx+foot+w, feet), (sx+foot-w, feet), (sx, inner),
            (sx-foot+w, feet), (sx-foot-w, feet)]
    below = path(legs) + circle(sx, cy, fly) + circle(cx, cy, R) + circle(cx, cy, R - tire, hole=True)   # trainer, tyre
    hub = STEM * scale / 2                              # hubs as wide as the stems, covering their flat ends
    above = circle(sx, cy, hub) + circle(cx, cy, hub)
    orange = path(frame)

    svgs = {}
    for suffix, bg, ink in (("", DARK_BG, "#FAFAF7"), ("-light", LIGHT_BG, "#111111")):
        svgs[suffix] = (f'{HEAD}  {bg}\n  <path d="{below}" fill="{ink}"/>\n  <path d="{orange}" fill="{OR}"/>\n'
                        f'  <path d="{above}" fill="{ink}"/>\n</svg>\n')
    # one colour: the drawing is cut out of the rounded square
    svgs["-mono"] = (f'{HEAD}  <mask id="cut">\n    <rect width="100" height="100" fill="#fff"/>\n'
                     f'    <path d="{below}{orange}{above}"/>\n  </mask>\n'
                     f'  <rect width="100" height="100" rx="22" fill="#111111" mask="url(#cut)"/>\n</svg>\n')
    return svgs
