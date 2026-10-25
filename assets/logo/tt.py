"""The Wattamax TT: one shape, shared by the wordmark, the icon and the TT asset."""
import math

ANGLE = 20
K = math.tan(math.radians(ANGLE))
STEM, BAR, GAP = 28, 25, 80     # on a cap height of 100: stem width, bar thickness, distance between the stems
STEM_L = 380                    # font units: where the stem starts inside Barlow's A, which makes the A 4% wider
S = 100 / 700                   # Barlow's cap height -> 100
OR = "#F25C05"

def outer(y): return 21 + y * 0.2657   # outer edge of the left leg of Barlow's A (font units)

def f(v): return f"{round(v, 2):g}"

def path(pts):
    return "M" + " ".join(f"{f(x)} {f(y)}" for x, y in pts) + "Z"

def tt(d=0):
    """Upright outline grown by d: x from the first stem's left edge, y down, baseline at 100.
    The bar ends follow the outer edge of the As the stems belong to."""
    end = lambda y: S * (STEM_L - outer((100 - y) / S))
    r = GAP + STEM
    return [(-end(-d) - d, -d), (r + end(-d) + d, -d), (r + end(BAR + d) + d, BAR + d), (r + d, BAR + d),
            (r + d, 100), (GAP - d, 100), (GAP - d, BAR + d), (STEM + d, BAR + d), (STEM + d, 100),
            (-d, 100), (-d, BAR + d), (-end(BAR + d) - d, BAR + d)]

def skew(pts, dx=0, dy=0, scale=1):
    """Slant by ANGLE around the baseline, scale, then move."""
    return [(dx + scale * (x + (100 - y) * K), dy + scale * y) for x, y in pts]
