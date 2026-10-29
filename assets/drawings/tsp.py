"""TSP art: a grey picture drawn by one line through dots spread like its shadows, and the lit 3D heart it draws."""
import numpy as np
from contourpy import contour_generator
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree


def stipple(img, n, iterations=30, seed=1):
    """n dots spread like the picture's darkness (0 black, 1 white), by weighted Lloyd relaxation (Secord 2002)."""
    rng = np.random.default_rng(seed)
    h, w = img.shape
    ys, xs = np.mgrid[0:h, 0:w]
    pixels = np.stack([xs.ravel(), ys.ravel()], 1).astype(float)
    weight = ((1 - img) ** 1.5).ravel()
    keep = weight > 1e-3
    pixels, weight = pixels[keep], weight[keep]
    dots = pixels[rng.choice(len(pixels), n, replace=False, p=weight / weight.sum())] + rng.random((n, 2))
    for _ in range(iterations):
        owner = cKDTree(dots).query(pixels)[1]
        mass = np.bincount(owner, weight, n)
        ok = mass > 0
        for axis in (0, 1):
            dots[ok, axis] = np.bincount(owner, weight * pixels[:, axis], n)[ok] / mass[ok]
    return dots


def tour(dots, start, end):
    """A short path through every dot from `start` to `end` (indices): nearest neighbour, then 2-opt."""
    n = len(dots)
    tree = cKDTree(dots)
    left = np.ones(n, bool)
    left[[start, end]] = False
    order = [start]
    for _ in range(n - 2):
        k = 8
        while not (near := [i for i in np.atleast_1d(tree.query(dots[order[-1]], min(k, n))[1]) if left[i]]):
            k *= 4
        order.append(near[0])
        left[near[0]] = False
    order = np.array(order + [end])
    improved = True
    while improved:
        improved = False
        for i in range(1, n - 2):
            p = dots[order]
            a, b, c, d = p[i - 1], p[i], p[i + 1:n - 1], p[i + 2:n]
            gain = (np.linalg.norm(a - c, axis=1) + np.linalg.norm(b - d, axis=1)
                    - np.linalg.norm(a - b) - np.linalg.norm(c - d, axis=1))
            j = int(np.argmin(gain))
            if gain[j] < -1e-9:
                order[i:i + j + 2] = order[i:i + j + 2][::-1]
                improved = True
    return dots[order]


def outline(img):
    """The picture's silhouette as a ring from its leftmost point back to it."""
    ring = max(contour_generator(z=gaussian_filter((img < 0.93).astype(float), 3)).lines(0.3), key=len)[:-1]
    ring = np.roll(ring, -int(np.argmin(ring[:, 0])), axis=0)
    return np.vstack([ring, ring[:1]])


def drawing(img, n):
    """The silhouette, then a tour through n dots from its left end to the dot furthest right. y goes up."""
    ring = outline(img)
    dots = stipple(img, n)
    inside = tour(dots, int(np.argmin(np.linalg.norm(dots - ring[0], axis=1))), int(np.argmax(dots[:, 0])))
    line = np.vstack([ring, inside])
    return line * [1, -1]


def heart(size=400):
    """Taubin's heart surface lit from the upper left, as seen from the front (1 white, 0 black)."""
    x, z = np.meshgrid(np.linspace(-1.35, 1.35, size), np.linspace(1.25, -1.45, size))
    surface = lambda y: (x**2 + 2.25 * y**2 + z**2 - 1) ** 3 - x**2 * z**3 - 0.1125 * y**2 * z**3
    ys = np.linspace(-1, 1, 300)
    inside = np.stack([surface(y) < 0 for y in ys], -1)
    hit = inside.any(-1)
    first = inside.argmax(-1)
    near, far = ys[np.maximum(first - 1, 0)], ys[first]
    for _ in range(30):  # the surface lies between the last point outside and the first inside
        mid = (near + far) / 2
        far, near = np.where(surface(mid) < 0, mid, far), np.where(surface(mid) < 0, near, mid)
    y = far
    a = x**2 + 2.25 * y**2 + z**2 - 1
    normal = np.stack([6 * x * a**2 - 2 * x * z**3, 13.5 * y * a**2 - 0.225 * y * z**3,
                       6 * z * a**2 - 3 * x**2 * z**2 - 0.3375 * y**2 * z**2], -1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True) + 1e-12
    light = np.array([-0.55, -0.6, 0.6]) / np.linalg.norm([-0.55, -0.6, 0.6])
    half = (light + [0, -1, 0]) / np.linalg.norm(light + [0, -1, 0])
    shade = 0.08 + 0.75 * np.clip(normal @ light, 0, 1) + 0.6 * np.clip(normal @ half, 0, 1) ** 40
    return np.where(hit, np.clip(shade, 0, 1), 1.0)
