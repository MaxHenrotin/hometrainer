from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

from tt import K, S, STEM, GAP, STEM_L, OR, outer, f, path, tt, skew

FONT = TTFont(Path(__file__).parent / "fonts" / "BarlowSemiCondensed-Black.ttf")
GS, CMAP = FONT.getGlyphSet(), FONT.getBestCmap()
A_ADV = GS[CMAP[ord("A")]].width


def inner(y): return 261 + (y - 246) * 0.2115    # counter edge of the left leg of Barlow's A


def half_a():
    """Left half of the A (font units): left leg and crossbar; the T stem starting at STEM_L is its right leg."""
    return [(outer(0), 0), (outer(700), 700), (STEM_L, 700), (STEM_L, 246 + (STEM_L - 261) / 0.2115),
            (inner(239), 239), (STEM_L, 239), (STEM_L, 95), (inner(95), 95), (inner(0), 0)]


def wordmark(kern=(-6, -1, -3), gap_mono=4):
    """WATTAMAX with the TT in orange. Returns {file name suffix: SVG}."""
    to_svg = lambda x, y, dx: (dx + S * x + S * y * K, 100 - S * y)   # font units -> slanted SVG units
    black, x = [], 0

    def glyph(ch):
        nonlocal x
        g = GS[CMAP[ord(ch)]]
        pen = SVGPathPen(GS, ntos=f)
        g.draw(TransformPen(pen, (S, 0, S * K, -S, x, 100)))
        black.append(pen.getCommands())
        x += g.width * S

    glyph("W")
    x += kern[0]
    a1 = x                                        # first A: its right leg is the first T stem
    black.append(path([to_svg(px, py, a1) for px, py in half_a()]))
    s1 = a1 + STEM_L * S                          # left edge of the first stem
    a2 = s1 + GAP + STEM - (A_ADV - STEM_L) * S   # second A, mirrored: its left leg is the second T stem
    black.append(path([to_svg(A_ADV - px, py, a2) for px, py in half_a()]))
    x = a2 + A_ADV * S + kern[1]
    glyph("M"); glyph("A"); x += kern[2]; glyph("X")
    width = x + 100 * K
    black, orange = "".join(black), path(skew(tt(), s1))

    head = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(width)} 100">\n  <title>Wattamax</title>\n'
    svgs = {}
    for ink, suffix in (("#111111", ""), ("#FAFAF7", "-white")):
        svgs[suffix] = f'{head}  <path d="{black}" fill="{ink}"/>\n  <path d="{orange}" fill="{OR}"/>\n</svg>\n'
    # one colour: without the orange, a thin gap keeps the TT apart from the A's
    svgs["-mono"] = (f'{head}  <mask id="gap">\n    <rect x="-5" y="-5" width="{f(width + 10)}" height="110" fill="#fff"/>\n'
                     f'    <path d="{path(skew(tt(gap_mono), s1))}"/>\n  </mask>\n'
                     f'  <path d="{black}" fill="#111111" mask="url(#gap)"/>\n  <path d="{orange}" fill="#111111"/>\n</svg>\n')
    return svgs


def tt_alone():
    """The TT on its own, in orange, cropped to its bounding box."""
    pts = skew(tt())
    left = min(x for x, _ in pts)
    width = max(x for x, _ in pts) - left
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(width)} 100">\n  <title>Wattamax</title>\n'
            f'  <path d="{path(skew(tt(), -left))}" fill="{OR}"/>\n</svg>\n')
