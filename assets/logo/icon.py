from tt import STEM, GAP, OR, f, path, tt, skew

HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <title>Wattamax</title>\n'
DARK_BG = '<rect width="100" height="100" rx="22" fill="#111111"/>'
LIGHT_BG = '<rect x="0.75" y="0.75" width="98.5" height="98.5" rx="22" fill="#FAFAF7" stroke="#DDDDD6" stroke-width="1.5"/>'


def circle(cx, cy, r, attrs):
    return f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" {attrs}/>'


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
    hub = STEM * scale / 2                  # hubs as wide as the stems, covering their flat ends

    def drawing(ink, orange):
        return [f'<path d="{path(legs)}" fill="{ink}"/>',
                circle(sx, cy, fly, f'fill="{ink}"'),
                circle(cx, cy, R - tire / 2, f'fill="none" stroke="{ink}" stroke-width="{f(tire)}"'),
                f'<path d="{path(frame)}" fill="{orange}"/>',
                circle(sx, cy, hub, f'fill="{ink}"'),
                circle(cx, cy, hub, f'fill="{ink}"')]

    svgs = {}
    for suffix, bg, ink in (("", DARK_BG, "#FAFAF7"), ("-light", LIGHT_BG, "#111111")):
        svgs[suffix] = HEAD + "".join(f"  {s}\n" for s in [bg, *drawing(ink, OR)]) + "</svg>\n"
    # one colour: the drawing is cut out of the rounded square
    svgs["-mono"] = (f'{HEAD}  <mask id="cut">\n    <rect width="100" height="100" fill="#fff"/>\n'
                     + "".join(f"    {s}\n" for s in drawing("#000", "#000"))
                     + '  </mask>\n  <rect width="100" height="100" rx="22" fill="#111111" mask="url(#cut)"/>\n</svg>\n')
    return svgs
