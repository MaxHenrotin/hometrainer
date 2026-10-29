"""Mountains and climbs drawn from real data: Copernicus GLO-30 elevation (1 arc-second tiles, downloaded once
into cache/) and roads from OpenStreetMap (kept in roads.json)."""
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

import networkx as nx
import numpy as np
import tifffile
from contourpy import contour_generator
from shapely import Point, Polygon

HERE = Path(__file__).parent
AGENT = {"User-Agent": "wattamax-drawings/1.0"}
_tiles = {}


def tile(lat, lon):
    """The elevation tile whose south-west corner is (lat, lon), its first row along its north edge."""
    if (lat, lon) not in _tiles:
        name = f"Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM"
        path = HERE / "cache" / f"{name}.tif"
        if not path.exists():
            path.parent.mkdir(exist_ok=True)
            request = urllib.request.Request(f"https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif", headers=AGENT)
            path.write_bytes(urllib.request.urlopen(request).read())
        _tiles[lat, lon] = tifffile.imread(path)
    return _tiles[lat, lon]


def elevation(lat, lon):
    """Metres above sea level, bilinear between the tile's points."""
    lat, lon = np.asarray(lat, float), np.asarray(lon, float)
    out = np.empty(lat.shape)
    for south, west in set(zip(np.floor(lat).astype(int).ravel(), np.floor(lon).astype(int).ravel())):
        t = tile(south, west)
        here = (np.floor(lat) == south) & (np.floor(lon) == west)
        r, c = (south + 1 - lat[here]) * 3600, (lon[here] - west) * 3600
        r0, c0 = np.clip(r.astype(int), 0, t.shape[0] - 2), np.clip(c.astype(int), 0, t.shape[1] - 2)
        fr, fc = r - r0, c - c0
        out[here] = (t[r0, c0] * (1 - fr) * (1 - fc) + t[r0 + 1, c0] * fr * (1 - fc)
                     + t[r0, c0 + 1] * (1 - fr) * fc + t[r0 + 1, c0 + 1] * fr * fc)
    return out


def metres(lat0):
    """Metres east and north per degree of longitude and latitude, around latitude lat0."""
    return 111320 * math.cos(math.radians(lat0)), 110700


def ridgelines(lat, lon, heading, half_width, near, far, lines, samples, rise=0.2):
    """The terrain around (lat, lon) seen from the side, looking towards `heading` (degrees from north): profiles
    from near to far, each lifted by `rise` times its distance, a far one running along the nearer ones where
    they hide it. Joined end to end, one line, in metres."""
    east, north = metres(lat)
    h = math.radians(heading)
    across = np.linspace(-half_width, half_width, samples)
    horizon = np.full(samples, -np.inf)
    line = []
    for k, depth in enumerate(np.linspace(near, far, lines)):
        e = depth * math.sin(h) + across * math.cos(h)
        n = depth * math.cos(h) - across * math.sin(h)
        horizon = np.maximum(elevation(lat + n / north, lon + e / east) + rise * (depth - near), horizon)
        profile = np.stack([across, horizon], 1)
        line.append(profile if k % 2 == 0 else profile[::-1])
    return np.vstack(line)


def contours(lat, lon, radius, levels):
    """The contour rings closed around the summit at (lat, lon) within `radius`, lowest first, each one entered
    and left at the point nearest to where the previous one was entered, in metres."""
    east, north = metres(lat)
    grid = np.linspace(-radius, radius, 400)
    e, n = np.meshgrid(grid, grid)
    rings = contour_generator(x=grid, y=grid, z=elevation(lat + n / north, lon + e / east))
    line, at = [], None
    for level in levels:
        around = [r for r in rings.lines(level) if len(r) > 3 and np.allclose(r[0], r[-1]) and Polygon(r).contains(Point(0, 0))]
        if not around:
            continue
        ring = around[0][:-1]
        if at is not None:
            ring = np.roll(ring, -int(np.argmin(np.linalg.norm(ring - at, axis=1))), axis=0)
        line += [ring, ring[:1]]
        at = ring[0]
    return np.vstack(line)


def road(query, bbox):
    """The longest path through the OSM roads matching `query` in bbox (south, west, north, east), as [lat, lon]."""
    data = urllib.parse.urlencode({"data": f"[out:json][timeout:60];way{query}{bbox};out geom;"}).encode()
    request = urllib.request.Request("https://overpass-api.de/api/interpreter", data, AGENT)
    ways = json.load(urllib.request.urlopen(request))["elements"]
    graph = nx.Graph()
    for way in ways:
        points = [(p["lat"], p["lon"]) for p in way["geometry"]]
        graph.add_edges_from((a, b, {"weight": math.dist(a, b)}) for a, b in zip(points, points[1:]))
    graph = graph.subgraph(max(nx.connected_components(graph), key=len))
    ends = [n for n in graph if graph.degree(n) == 1]
    paths = (nx.single_source_dijkstra(graph, u) for u in ends)
    return max(((d[v], p[v]) for d, p in paths for v in ends if v in d), key=lambda dp: dp[0])[1]


def oblique(road, azimuth, tilt, exaggerate=1.5):
    """A road given as [lat, lon] seen from the sky, looking towards `azimuth` (degrees from north) and down by
    `tilt` degrees, in metres: across the view, and depth foreshortened plus height."""
    road = np.asarray(road)
    east, north = metres(road[0, 0])
    k = np.linspace(0, len(road) - 1, len(road) * 8)  # points every few metres, so the height follows the slope
    lat, lon = np.interp(k, range(len(road)), road[:, 0]), np.interp(k, range(len(road)), road[:, 1])
    e, n, z = lon * east, lat * north, elevation(lat, lon) * exaggerate
    a, t = math.radians(azimuth), math.radians(tilt)
    return np.stack([e * math.cos(a) - n * math.sin(a), (e * math.sin(a) + n * math.cos(a)) * math.sin(t) + z * math.cos(t)], 1)
