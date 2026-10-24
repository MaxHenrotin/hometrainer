// The made-up route Strava gets with each ride. Strava only works out moving time from GPS data,
// so like Zwift's worlds, the ride follows a 100 km organic loop around Isla Incahuasi on the
// Salar de Uyuni (Bolivia), the flattest place on Earth. Every point was checked against SRTM
// elevation data to stay on the salt flat.
const CENTER = { lat: -20.242, lon: -67.625 };  // Isla Incahuasi
const LENGTH = 100000;  // metres
export const ALTITUDE = 3656;  // metres, the level of the salt flat

// A circle with a few waves of decreasing size added to its radius: [frequency, amplitude, phase]
const WAVES = [[2, 0.16, 2.84], [3, 0.1, 3.52], [4, 0.06, 5.81], [5, 0.05, 2.93], [7, 0.03, 3.19], [9, 0.02, 3.69]];
const POINTS = 2000;
const METERS_PER_DEGREE_LAT = 110700;
const METERS_PER_DEGREE_LON = 111320 * Math.cos(CENTER.lat * Math.PI / 180);

// Built once: the loop's points in metres around the island, scaled to exactly LENGTH,
// with the distance covered when reaching each point
const loop = (() => {
  const shape = Array.from({ length: POINTS + 1 }, (_, k) => {
    const t = 2 * Math.PI * k / POINTS;
    const r = 1 + WAVES.reduce((sum, [n, a, phase]) => sum + a * Math.sin(n * t + phase), 0);
    return [r * Math.cos(t), r * 0.8 * Math.sin(t)];
  });
  const along = [0];
  for (let k = 1; k <= POINTS; k++) along.push(along[k - 1] + Math.hypot(shape[k][0] - shape[k - 1][0], shape[k][1] - shape[k - 1][1]));
  const scale = LENGTH / along[POINTS];
  return { points: shape.map(([x, y]) => [x * scale, y * scale]), along: along.map((d) => d * scale) };
})();

// Latitude and longitude after `km` kilometres, going round the loop as many times as needed
export function routePosition(km) {
  const meters = km * 1000 % LENGTH;
  let low = 0;
  let high = POINTS - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (loop.along[middle] <= meters) low = middle;
    else high = middle - 1;
  }
  const [x0, y0] = loop.points[low];
  const [x1, y1] = loop.points[low + 1];
  const f = (meters - loop.along[low]) / (loop.along[low + 1] - loop.along[low]);
  return {
    lat: CENTER.lat + (y0 + (y1 - y0) * f) / METERS_PER_DEGREE_LAT,
    lon: CENTER.lon + (x0 + (x1 - x0) * f) / METERS_PER_DEGREE_LON,
  };
}
