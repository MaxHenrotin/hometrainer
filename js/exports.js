import { drawBars } from "./charts.js";
import { number } from "./format.js";
import { ALTITUDE, route } from "./route.js";

export function download(blob, name) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function csv(ride) {
  const rows = ride.samples.map((s) => [s.time.toFixed(1), s.speed, s.cadence, s.power, s.heartRate ?? "", s.distance.toFixed(3)]);
  const lines = [["time_s", "speed_kmh", "cadence_rpm", "power_w", "heart_rate_bpm", "distance_km"], ...rows].map((row) => row.join(","));
  return new Blob([lines.join("\n") + "\n"], { type: "text/csv" });
}

// Loaded only when someone exports to Strava, since the SDK weighs about 440 KB
const FIT_SDK = "./vendor/fitsdk.js";
const semicircles = (degrees) => Math.round(degrees * 2 ** 31 / 180);

// Garmin FIT, the format Zwift sends to Strava, following the virtual route. As a virtual ride,
// Strava keeps the local time and the flat elevation written in the file, and never matches the
// ride against real segments. Pauses become timer stops, and the position stands still during
// them, which is how Strava tells moving time from elapsed time.
export async function fit(ride, drawing = "url") {
  const { Encoder, Profile, Utils } = await import(FIT_SDK);
  const { MesgNum } = Profile;
  const summary = ride.summary();
  const { samples } = ride;
  const first = new Date(samples[0].timestamp);
  const last = new Date(samples.at(-1).timestamp);
  const encoder = new Encoder();
  const position = route(drawing, summary.distance);

  // Strava may show the product name as the device under the activity
  encoder.onMesg(MesgNum.FILE_ID, { type: "activity", manufacturer: "development", product: 0, productName: "Wattamax", timeCreated: first });
  encoder.onMesg(MesgNum.DEVICE_INFO, { timestamp: first, deviceIndex: "creator", manufacturer: "development", product: 0, productName: "Wattamax" });
  encoder.onMesg(MesgNum.EVENT, { timestamp: first, event: "timer", eventType: "start" });
  samples.forEach((s, i) => {
    const previous = samples[i - 1];
    // A pause shows up as more clock time than riding time between two samples
    if (previous && (s.timestamp - previous.timestamp) / 1000 - (s.time - previous.time) > 1) {
      encoder.onMesg(MesgNum.EVENT, { timestamp: new Date(previous.timestamp), event: "timer", eventType: "stopAll" });
      encoder.onMesg(MesgNum.EVENT, { timestamp: new Date(s.timestamp), event: "timer", eventType: "start" });
    }
    const { lat, lon } = position(s.distance);
    encoder.onMesg(MesgNum.RECORD, {
      timestamp: new Date(s.timestamp),
      positionLat: semicircles(lat),
      positionLong: semicircles(lon),
      enhancedAltitude: ALTITUDE,
      distance: s.distance * 1000,
      enhancedSpeed: s.speed / 3.6,
      power: Math.max(0, s.power),
      cadence: Math.min(254, Math.round(s.cadence)),
      ...(s.heartRate !== null && { heartRate: s.heartRate }),
    });
  });
  encoder.onMesg(MesgNum.EVENT, { timestamp: last, event: "timer", eventType: "stopAll" });

  const totals = {
    timestamp: last,
    startTime: first,
    totalElapsedTime: (last - first) / 1000,
    totalTimerTime: summary.time,
    totalDistance: summary.distance * 1000,
    totalAscent: 0,
    totalDescent: 0,
    totalCalories: Math.round(summary.calories),
    avgSpeed: summary.speed / 3.6,
    avgPower: Math.round(summary.power),
    maxPower: summary.maxPower,
    avgCadence: Math.round(summary.cadence),
    ...(summary.heartRate !== null && { avgHeartRate: Math.round(summary.heartRate), maxHeartRate: summary.maxHeartRate }),
    sport: "cycling",
    subSport: "virtualActivity",
  };
  encoder.onMesg(MesgNum.LAP, { messageIndex: 0, event: "lap", eventType: "stop", ...totals });
  encoder.onMesg(MesgNum.SESSION, { messageIndex: 0, event: "session", eventType: "stop", firstLapIndex: 0, numLaps: 1, ...totals });
  // The computer's own clock, which Strava shows as the start time of a virtual ride
  const localTimestamp = Utils.convertDateToDateTime(last) - last.getTimezoneOffset() * 60;
  encoder.onMesg(MesgNum.ACTIVITY, {
    timestamp: last, localTimestamp, totalTimerTime: summary.time, numSessions: 1, type: "manual", event: "activity", eventType: "stop",
  });
  return new Blob([encoder.close()], { type: "application/vnd.ant.fit" });
}

// The summary screen as a 1280×720 window shows it, without its buttons, drawn at 1.5× into a
// 1920×1080 picture. `view` holds what the screen shows, `labels` the names of its record rows.
const PNG = { bg: "#F5F5F7", card: "#FFFFFF", ink: "#1D1D1F", secondary: "#6E6E73", tertiary: "#86868B", track: "#F2F2F5", red: "#FF3B30" };
const SCALE = 1.5;
const BIG = '"Barlow Semi Condensed"';

export async function recapImage(view, labels, colorOf) {
  await Promise.all([`600 100px ${BIG}`, "600 30px Barlow", "500 30px Barlow"].map((font) => document.fonts.load(font)));
  const [icon, wordmark] = await Promise.all(["assets/wattamax-icon-light.svg", "assets/wattamax-wordmark.svg"].map(async (src) => {
    const image = Object.assign(new Image(), { src });
    await image.decode();
    return image;
  }));
  const canvas = Object.assign(document.createElement("canvas"), { width: 1280 * SCALE, height: 720 * SCALE });
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";
  const font = (size, weight = 500, family = "Barlow") => { ctx.font = `${weight} ${size}px ${family}, sans-serif`; };
  const width = (value) => ctx.measureText(value).width;
  const text = (value, x, y, color) => {
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
    return width(value);
  };
  // Pieces of text one after the other, each [text, colour, weight], from x
  const runs = (pieces, x, y, size) => {
    for (const [value, color, weight] of pieces) {
      font(size, weight);
      x += text(value, x, y, color);
    }
  };
  const runsWidth = (pieces, size) => pieces.reduce((sum, [value, , weight]) => { font(size, weight); return sum + width(value); }, 0);
  // A big number and its unit in small grey type, as in .now and .totals
  const reading = (value, unit, x, y, size, color, unitScale) => {
    font(size, 600, BIG);
    ctx.letterSpacing = `${-size * 0.01}px`;
    x += text(value, x, y, color);
    ctx.letterSpacing = "0px";
    if (unit) {
      font(Math.max(size * unitScale, 10));
      text(unit, x + 6, y, PNG.tertiary);
    }
  };
  const readingWidth = (value, unit, size, unitScale) => {
    font(size, 600, BIG);
    ctx.letterSpacing = `${-size * 0.01}px`;
    let w = width(value);
    ctx.letterSpacing = "0px";
    font(Math.max(size * unitScale, 10));
    if (unit) w += 6 + width(unit);
    return w;
  };
  const shape = (x, y, w, h, radius, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
  };
  // Shadows ignore the scale, so they're given in the picture's pixels
  const card = (x, y, w, h, radius = 28) => {
    Object.assign(ctx, { shadowColor: "rgba(0, 0, 0, 0.12)", shadowBlur: 10 * SCALE, shadowOffsetY: 2 * SCALE });
    shape(x, y, w, h, radius, PNG.card);
    Object.assign(ctx, { shadowColor: "transparent", shadowBlur: 0, shadowOffsetY: 0 });
  };

  ctx.fillStyle = PNG.bg;
  ctx.fillRect(0, 0, 1280, 720);

  // Header: the logo, and the date in the pill on the right
  ctx.drawImage(icon, 44, 26, 38, 38);
  ctx.drawImage(wordmark, 92, 36, 112, 18);
  font(14);
  const pill = width(view.date) + 28;
  card(1236 - pill, 26, pill, 38, 19);
  text(view.date, 1250 - pill, 50, PNG.ink);

  // Left column: the averages with the zones under them, then the chart. The cards share 588 px
  // 30/70, or 40/60 with the zones, once the readings' padding is set aside, as flex does on screen.
  const zones = view.zones.length > 0;
  const heart = view.heartRate !== null;
  const readings = (588 - 48) * (zones ? 0.4 : 0.3);  // content height
  card(44, 82, 748, readings + 48);
  const f = Math.min((heart ? 0.08 : 0.105) * 692, zones ? (readings - 40) * 0.4 : 0.42 * readings);
  const line = Math.max(f * 0.3, 15);
  const legend = Math.max(f * 0.22, 13);
  const below = heart ? f * 0.53 : 0;  // the max heart rate, under the digits
  const content = f * 1.31 + below + f * 0.19 + Math.max(f * 0.44, line * 1.2) + (zones ? f * 0.3 + 20 + legend * 1.2 : 0);
  let y = 106 + (readings - content) / 2 + f * 1.23;
  const figures = [[view.power, "W", f * 1.38, view.zone.color || PNG.ink], [view.cadence, "rpm", f], [view.speed, "km/h", f]];
  if (heart) figures.push([view.heartRate.average, "", f]);
  // Columns as the grid lays them out: 1.3 shares for the power, 1 for each other figure, 24 px apart
  const share = (692 - 24 * (figures.length - 1)) / (figures.length + 0.3);
  const left = (i) => 72 + i * (share + 24) + (i && 0.3 * share);
  figures.forEach(([value, unit, size, color = PNG.ink], i) => reading(value, unit, left(i), y, size, color, 0.26 * f / size));
  if (heart) {
    // The heart stands on the baseline in place of a unit, as the inline SVG does on screen
    const icon = Math.max(f * 0.26, 10) * 0.8;
    const x = left(3) + readingWidth(view.heartRate.average, "", f, 0.26) + 6;
    ctx.save();
    ctx.translate(x, y - icon);
    ctx.scale(icon / 24, icon / 24);
    ctx.fillStyle = PNG.red;
    ctx.fill(new Path2D(document.querySelector("#heart-shape path").getAttribute("d")));
    ctx.restore();
    font(f * 0.38);
    text(`max ${view.heartRate.max}`, left(3), y + f * 0.555, PNG.secondary);
  }
  y += f * 0.02 + below + f * 0.19 + Math.max(f * 0.44, line * 1.2) / 2 + line * 0.35;
  // The zone and the W/kg, 22 px apart
  let x = 72;
  if (view.zone.name) {
    font(line, 600);
    x += text(view.zone.name, x, y, view.zone.color) + 22;
  }
  if (view.wkg) runs([[view.wkg, PNG.ink, 600], [" W/kg", PNG.ink, 500]], x, y, line);
  if (zones) {
    y += line * 0.5 + f * 0.3;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(72, y, 692, 10, 5);
    ctx.clip();
    let left = 72;
    const room = 692 - 2 * (view.zones.length - 1);
    for (const zone of view.zones) {
      ctx.fillStyle = zone.color;
      ctx.fillRect(left, y, zone.share * room, 10);
      left += zone.share * room + 2;
    }
    ctx.restore();
    y += 20 + legend;
    x = 72;
    view.zones.forEach((zone, i) => {
      const pieces = [[`Z${i + 1} `, PNG.secondary, 500], [zone.time, PNG.ink, 600]];
      shape(x, y - legend * 0.78, 10, 10, 3, zone.color);
      runs(pieces, x + 16, y, legend);
      x += 16 + runsWidth(pieces, legend) + 18;
    });
  }

  const chart = 82 + readings + 48 + 20;
  card(44, chart, 748, 690 - chart);
  ctx.textAlign = "left";
  drawBars(ctx, { x: 64, y: chart + 22, w: 704, h: 690 - chart - 40 }, view.bars.bars, Math.max(view.bars.slots, 1), colorOf, { grid: PNG.track, label: PNG.tertiary });
  ctx.textBaseline = "alphabetic";  // the chart leaves it on "middle"

  // Right column: the four totals, then the records. The cards share 514 px 30/70 once their
  // padding is set aside.
  const box = 514 * 0.3;  // the totals' content height
  card(816, 82, 420, box + 40);
  const size = Math.min((376 - 22) * 0.145, (box - 60) * 0.7);
  font(size, 600, BIG);
  const cap = ctx.measureText("0").actualBoundingBoxAscent;
  // One in each corner, in two columns as wide as their widest figure, the times with a word under them
  const cells = [[view.distance, "km"], [view.duration, "", "en mouvement"], [view.calories, "kcal"], [view.elapsed, "", "total"]];
  const columns = [0, 1].map((c) => Math.max(...[c, c + 2].map((i) => readingWidth(cells[i][0], cells[i][1], size, 0.38))));
  const spaceX = (376 - columns[0] - columns[1] - 22) / 3;
  const rowHeight = cap + 6 + 14 * 1.2;
  const spaceY = (box - 2 * rowHeight - 14) / 3;
  cells.forEach(([value, unit, word], i) => {
    const left = 838 + spaceX + (i % 2) * (columns[0] + 22 + spaceX);
    const rowTop = 102 + spaceY + Math.floor(i / 2) * (rowHeight + 14 + spaceY);
    reading(value, unit, left, rowTop + cap, size, PNG.ink, 0.38);
    if (word) {
      font(14);
      text(word, left, rowTop + cap + 6 + 13.5, PNG.tertiary);
    }
  });

  const records = 82 + box + 40 + 14;
  card(816, records, 420, 690 - records);
  const list = 690 - records - 40;  // the records' content height
  const row = Math.min(0.059 * 376, 0.07 * list);
  // The longest bar fills its track
  const top = Math.max(1, ...view.records.map((watts) => watts ?? 0));
  const bar = 376 - 4.6 * row - 3 * 0.55 * row - Math.max(1.6 * row, 22);
  view.records.forEach((watts, i) => {
    const middle = records + 20 + row * 0.6 + i * (list - row * 1.2) / (labels.length - 1);
    font(Math.max(row * 0.6, 10));
    text(labels[i], 838, middle + row * 0.21, PNG.secondary);
    const start = 838 + 2.3 * row + 0.55 * row;
    shape(start, middle - row * 0.225, bar, row * 0.45, row * 0.23, PNG.track);
    if (watts !== null) shape(start, middle - row * 0.225, Math.max(row * 0.45, watts / top * bar), row * 0.45, row * 0.23, colorOf(watts));
    font(row);
    ctx.textAlign = "right";
    text(watts === null ? "–" : number(watts), start + bar + 0.55 * row + 2.3 * row, middle + row * 0.35, PNG.ink);
    ctx.textAlign = "left";
  });

  font(13);
  ctx.textAlign = "right";
  text("wattamax.com", 1236, 709, PNG.tertiary);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
