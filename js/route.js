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

// A road bike from the side: rear wheel, frame, saddle, handlebar, fork, then the front wheel
function bike() {
  const [rear, bracket, seat, post, head, fork, front] = [[0, 3.4], [4.2, 3], [2.4, 9], [2.2, 9.6], [9, 8.6], [9.3, 7.6], [10, 3.4]];
  const handlebar = [[10, 9.4], [10.9, 9.1], [10.8, 8.4]];
  return [
    ...arc(0, 3.4, 3.4, 3.4, 270, -90), rear, bracket, seat, post, [1.2, 9.6], [3.4, 9.6], post, seat, rear, seat,
    head, ...handlebar, ...handlebar.slice(0, -1).reverse(), head, fork, bracket, fork, front, ...arc(10, 3.4, 3.4, 3.4, 270, -90),
  ];
}

function heart() {
  return Array.from({ length: 201 }, (_, k) => {
    const t = Math.PI + 2 * Math.PI * k / 200;
    return [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)];
  });
}

// The drawings the route can follow, each one line of [x, y] points in any unit, with y going up.
// Adding one is adding a line here.
const DRAWINGS = {
  name: text("WATTAMAX"),
  loop: loop(),
  tt: TT,
  icon: ICON,
  wordmark: WORDMARK,
  bike: bike(),
  heart: heart(),
};

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
