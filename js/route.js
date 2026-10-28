// The made-up route Strava gets with each ride. Strava only works out moving time from GPS data,
// so like Zwift's worlds, the ride follows a drawing on the Salar de Uyuni (Bolivia), the flattest
// place on Earth. The drawing is scaled so that the whole ride draws it once, whatever its length.
import { ICON, TT, WORDMARK } from "./outlines.js";

// East of Isla Incahuasi, about 30 km from any shore or island, so even a long ride stays on flat salt
const CENTER = { lat: -20.36, lon: -67.35 };
export const ALTITUDE = 3656;  // metres, the level of the salt flat

const METERS_PER_DEGREE_LAT = 110700;
const METERS_PER_DEGREE_LON = 111320 * Math.cos(CENTER.lat * Math.PI / 180);
const SLANT = Math.tan(20 * Math.PI / 180);  // the logo's slant

// Points along an ellipse, from one angle to the other (degrees, either way round)
function arc(cx, cy, rx, ry, from, to) {
  const steps = Math.ceil(Math.abs(to - from) / 5);
  return Array.from({ length: steps + 1 }, (_, k) => {
    const a = (from + (to - from) * k / steps) * Math.PI / 180;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
}

// Letters drawn in one stroke on a cap height of 10, going back over their own lines where needed.
// Most start and end on the baseline, so the line goes from one letter to the next along it.
// ATTA is one letter, like in the logo: the TT's bar runs from one A's top to the other.
const GLYPHS = {
  W: [[1, 0], [0, 10], [1, 0], [3, 6], [5, 0], [6, 10], [5, 0]],
  A: [[0, 0], [3, 10], [6, 0], [5, 10 / 3], [1, 10 / 3], [5, 10 / 3], [6, 0]],
  ATTA: [[0, 0], [3, 10], [6, 0], [5, 10 / 3], [1, 10 / 3], [5, 10 / 3], [3, 10], [11, 10], [11, 0], [11, 10],
    [19, 10], [19, 0], [19, 10], [27, 10], [24, 0], [25, 10 / 3], [29, 10 / 3], [27, 10], [30, 0]],
  M: [[0, 0], [0, 10], [3, 4], [6, 10], [6, 0]],
  X: [[0, 0], [6, 10], [3, 5], [0, 10], [6, 0]],
  C: [...arc(3, 5, 3, 5, 270, 315), ...arc(3, 5, 3, 5, 315, 45), ...arc(3, 5, 3, 5, 45, 270)],
  O: arc(3, 5, 3, 5, 270, -90),
  ".": [[0, 0], [0, 1.2], [1.2, 1.2], [1.2, 0], [0, 0], [1.2, 0]],
};

// Upper-case text in one line, slanted like the logo
function text(string) {
  const line = [];
  let x = 0;
  for (const glyph of string.match(/ATTA|./g)) {
    const points = GLYPHS[glyph];
    line.push(...points.map(([px, py]) => [x + px + py * SLANT, py]));
    x += Math.max(...points.map(([px]) => px)) + 2;
  }
  return line;
}

// The organic loop: a circle with a few waves of decreasing size added to its radius, [frequency, amplitude, phase]
const WAVES = [[2, 0.16, 2.84], [3, 0.1, 3.52], [4, 0.06, 5.81], [5, 0.05, 2.93], [7, 0.03, 3.19], [9, 0.02, 3.69]];

function loop() {
  return Array.from({ length: 2001 }, (_, k) => {
    const t = 2 * Math.PI * k / 2000;
    const r = 1 + WAVES.reduce((sum, [n, a, phase]) => sum + a * Math.sin(n * t + phase), 0);
    return [r * Math.cos(t), r * 0.8 * Math.sin(t)];
  });
}

// A wheel from its hub and back: each spoke out and back, then the rim
function wheel(cx, cy, r, spokes) {
  const hub = [cx, cy];
  const spoke = (k) => [cx + r * Math.cos(2 * Math.PI * k / spokes), cy + r * Math.sin(2 * Math.PI * k / spokes)];
  return [...Array.from({ length: spokes }, (_, k) => [hub, spoke(k)]).flat(), hub, ...arc(cx, cy, r, r, 0, 360), hub];
}

// A road bike from the side, in decimetres: rear wheel, crank, pedal and chainring, saddle, frame,
// handlebar, fork, then the front wheel. The tubes meeting at a hub stay clear of its spokes.
function bike() {
  const [rear, bracket, seat, post, head, down, crown, front] =
    [[0, 3.4], [4, 2.7], [2.51, 7.75], [2.02, 9.4], [8.55, 8.35], [8.87, 7.24], [8.95, 6.95], [9.9, 3.4]];
  const pedal = [5.1, 1.4];
  const handlebar = [[8.45, 8.65], [9.35, 8.85], [9.85, 8.85], ...arc(9.85, 8.2, 0.65, 0.65, 90, -90), [9.45, 7.55]];
  return [
    ...wheel(...rear, 3.4, 8), bracket, pedal, [4.75, 1.4], [5.45, 1.4], pedal, ...arc(...bracket, 1.1, 1.1, -50, 310), bracket,
    seat, post, [1, 9.4], [3.5, 9.4], post, seat, rear, seat, head, ...handlebar, ...handlebar.slice(0, -1).reverse(), head,
    down, bracket, down, crown, ...wheel(...front, 3.4, 8),
  ];
}

function heart() {
  return Array.from({ length: 201 }, (_, k) => {
    const t = Math.PI + 2 * Math.PI * k / 200;
    return [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)];
  });
}

// A heart trace: two beats on a flat line
function ecg() {
  const beat = (x) => [[x, 0], ...arc(x + 1.6, 0, 0.6, 0.45, 180, 0), [x + 2.6, 0], [x + 2.9, -0.7], [x + 3.4, 5], [x + 3.9, -1.8],
    [x + 4.3, 0], [x + 5.2, 0], ...arc(x + 6.3, 0, 1.1, 0.8, 180, 0)];
  return [[-1, 0], ...beat(0), ...beat(9), [19.5, 0]];
}

// The Matterhorn from Zermatt: its foot, its outline, then the ridge facing Zermatt up to the summit
const MATTERHORN = [[9.4, 0], [0, 0], [2.5, 1.2], [4.5, 2.6], [5.8, 4.2], [6.8, 6.2], [7.4, 6.8], [7.7, 7.2], [7.9, 8.6], [7.95, 9.8],
  [7.8, 10.6], [8.1, 11], [8.6, 10.8], [8.9, 10.1], [9.1, 9], [9.4, 8], [9.9, 7.1], [10.3, 6.9], [10.6, 6.2], [11.6, 4.8], [13, 3.3],
  [14.5, 1.8], [16, 0.9], [16, 0], [9.4, 0], [9.2, 2.5], [8.9, 5.5], [8.6, 8], [8.3, 10], [8.1, 11]];

// A llama from the side, facing right, from a hind hoof round its outline
const LLAMA = [[1.2, 0], [1.3, 2.5], [1, 4.5], [0.7, 6.5], [0.3, 8], [0.4, 9.6], [0.9, 10.6], [0.5, 11], [0.6, 11.8], [1.3, 11.9],
  [1.7, 11.2], [4, 11.4], [8, 11.3], [10.2, 11.2], [11, 11.8], [11.5, 13], [11.7, 14.8], [11.8, 15.8], [11.6, 17.4], [11.9, 18.1],
  [12.3, 17.5], [12.3, 16.5], [12.7, 17.5], [13, 18], [13.3, 17.4], [13.1, 16.3], [13.6, 16.1], [15.2, 15.5], [15.6, 15],
  [15.3, 14.6], [14.4, 14.4], [13.6, 14.1], [13.4, 13.4], [13.5, 12], [13.4, 10.5], [13.1, 9.2], [12.8, 8.2], [12.7, 6.5],
  [12.6, 3.4], [12.7, 0.3], [12.8, 0], [11.7, 0], [11.6, 3.4], [11.6, 5.8], [11.3, 3.4], [11.2, 0], [10.1, 0], [10.2, 3.4],
  [10.1, 6.3], [8, 6], [5, 6], [3.8, 6.4], [3.6, 4.2], [3.7, 0], [2.6, 0], [2.6, 3.5], [2.7, 5.6], [2.3, 3.5], [2.3, 0], [1.2, 0]];

// A cup of coffee on its saucer: the saucer, the cup, each wisp of steam up and back, then the handle
function coffee() {
  const steam = (x) => [...arc(x, 6.75, 0.45, 0.75, -90, 90), ...arc(x, 8.25, 0.45, 0.75, -90, -270)];
  const [left, right] = [steam(4), steam(6)];
  return [[2, 0.6], [0, 0.6], [1, 0], [9, 0], [10, 0.6], [2, 0.6], [2, 6], ...left, ...left.slice(0, -1).reverse(), ...right,
    ...right.slice(0, -1).reverse(), [8, 6], [8, 5], ...arc(8, 3.6, 1.6, 1.4, 90, -90), [8, 0.6]];
}

// The drawings the route can follow, each one line of [x, y] points in any unit, with y going up.
// Adding one is adding a line here: the export window shows them all.
export const DRAWINGS = {
  url: text("WATTAMAX.COM"),
  loop: loop(),
  tt: TT,
  icon: ICON,
  wordmark: WORDMARK,
  bike: bike(),
  heart: heart(),
  ecg: ecg(),
  matterhorn: MATTERHORN,
  llama: LLAMA,
  coffee: coffee(),
};
// The one the export window puts first, as it makes Wattamax known to whoever sees the ride
export const SUPPORT = "wordmark";

// For a ride of `km` kilometres, the function giving the latitude and longitude after `distance` kilometres
export function route(drawing, km) {
  const points = DRAWINGS[drawing];
  const along = [0];
  for (let k = 1; k < points.length; k++) along.push(along[k - 1] + Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]));
  const scale = km * 1000 / along.at(-1);  // metres per unit
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const middle = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];

  return (distance) => {
    const target = distance / km * along.at(-1);
    let low = 0;
    let high = points.length - 2;
    while (low < high) {
      const m = Math.ceil((low + high) / 2);
      if (along[m] <= target) low = m;
      else high = m - 1;
    }
    const [x0, y0] = points[low];
    const [x1, y1] = points[low + 1];
    const f = (target - along[low]) / (along[low + 1] - along[low]) || 0;  // 0 on a retraced point or an empty ride
    return {
      lat: CENTER.lat + (y0 + (y1 - y0) * f - middle[1]) * scale / METERS_PER_DEGREE_LAT,
      lon: CENTER.lon + (x0 + (x1 - x0) * f - middle[0]) * scale / METERS_PER_DEGREE_LON,
    };
  };
}
