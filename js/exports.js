import { duration, durationLabel, number } from "./format.js";
import { RECORD_DURATIONS } from "./ride.js";
import { ALTITUDE, routePosition } from "./route.js";

export function download(blob, name) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function csv(ride) {
  const rows = ride.samples.map((s) => [s.time.toFixed(1), s.speed, s.cadence, s.power, s.distance.toFixed(3)]);
  const lines = [["time_s", "speed_kmh", "cadence_rpm", "power_w", "distance_km"], ...rows].map((row) => row.join(","));
  return new Blob([lines.join("\n") + "\n"], { type: "text/csv" });
}

// Loaded only when someone exports to Strava, since the SDK weighs about 440 KB
const FIT_SDK = "https://cdn.jsdelivr.net/npm/@garmin/fitsdk@21.218.0/+esm";
const semicircles = (degrees) => Math.round(degrees * 2 ** 31 / 180);

// Garmin FIT, the format Zwift sends to Strava, following the virtual route. As a virtual ride,
// Strava keeps the local time and the flat elevation written in the file, and never matches the
// ride against real segments. Pauses become timer stops, and the position stands still during
// them, which is how Strava tells moving time from elapsed time.
export async function fit(ride) {
  const { Encoder, Profile, Utils } = await import(FIT_SDK);
  const { MesgNum } = Profile;
  const summary = ride.summary();
  const { samples } = ride;
  const first = new Date(samples[0].timestamp);
  const last = new Date(samples.at(-1).timestamp);
  const encoder = new Encoder();

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
    const { lat, lon } = routePosition(s.distance);
    encoder.onMesg(MesgNum.RECORD, {
      timestamp: new Date(s.timestamp),
      positionLat: semicircles(lat),
      positionLong: semicircles(lon),
      enhancedAltitude: ALTITUDE,
      distance: s.distance * 1000,
      enhancedSpeed: s.speed / 3.6,
      power: Math.max(0, s.power),
      cadence: Math.min(254, Math.round(s.cadence)),
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

// A 1080×1350 picture (the portrait format of most social apps) in the app's style:
// average power, cadence and speed, the totals, and the best effort on each duration
const PNG = { bg: "#F5F5F7", card: "#FFFFFF", ink: "#1D1D1F", secondary: "#6E6E73", tertiary: "#86868B", track: "#F2F2F5" };

export async function recapImage(ride, weight, colorOf) {
  await Promise.all(["600 100px Inter", "500 30px Inter", "400 30px Inter"].map((font) => document.fonts.load(font)));
  const [icon, wordmark] = await Promise.all(["assets/wattamax-icon-light.svg", "assets/wattamax-wordmark.svg"].map(async (src) => {
    const image = Object.assign(new Image(), { src });
    await image.decode();
    return image;
  }));
  const summary = ride.summary();
  const canvas = Object.assign(document.createElement("canvas"), { width: 1080, height: 1350 });
  const ctx = canvas.getContext("2d");
  const left = 80;
  const right = 1000;
  const text = (value, x, y, font, color, align = "left") => {
    ctx.font = `${font} Inter, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
    return ctx.measureText(value).width;
  };
  // A number followed by its unit in smaller grey type
  const reading = (value, unit, x, y, size) => {
    ctx.letterSpacing = `${-size * 0.04}px`;
    const width = text(value, x, y, `600 ${size}px`, PNG.ink);
    ctx.letterSpacing = "0px";
    if (unit) text(unit, x + width + size * 0.12, y, `500 ${Math.round(size * 0.32)}px`, PNG.tertiary);
  };
  const card = (y, height) => {
    ctx.fillStyle = PNG.card;
    ctx.beginPath();
    ctx.roundRect(48, y, 984, height, 44);
    ctx.fill();
  };

  ctx.fillStyle = PNG.bg;
  ctx.fillRect(0, 0, 1080, 1350);
  // Logo: the icon, then the wordmark sitting on the date's baseline
  ctx.drawImage(icon, left, 56, 60, 60);
  ctx.drawImage(wordmark, left + 76, 72, 28 * wordmark.width / wordmark.height, 28);
  text(ride.startedAt.toLocaleDateString("fr", { weekday: "long", day: "numeric", month: "long", year: "numeric" }), right, 100, "400 26px", PNG.secondary, "right");

  text("Puissance moyenne", left, 200, "400 26px", PNG.secondary);
  reading(number(summary.power), "W", left - 6, 400, 210);
  if (weight) text(`${number(summary.power / weight, 1)} W/kg`, right, 400, "500 34px", PNG.secondary, "right");

  text("Cadence moyenne", left, 480, "400 24px", PNG.secondary);
  reading(number(summary.cadence), "rpm", left, 566, 84);
  text("Vitesse moyenne", 560, 480, "400 24px", PNG.secondary);
  reading(number(summary.speed, 1), "km/h", 560, 566, 84);

  card(620, 190);
  [["Distance", number(summary.distance, 2), "km"], ["Durée", duration(summary.time), ""],
    ["Temps total", duration(summary.elapsed), ""], ["Calories", number(summary.calories), "kcal"]].forEach(([label, value, unit], i) => {
    const x = left + 30 + i * 230;
    text(label, x, 690, "400 22px", PNG.secondary);
    reading(value, unit, x, 768, 50);
  });

  card(840, 420);
  const records = RECORD_DURATIONS.map((d) => [durationLabel(d), ride.records.get(d) ?? null]);
  const top = Math.max(200, ...records.map(([, watts]) => watts ?? 0)) * 1.05;
  records.forEach(([label, watts], i) => {
    const y = 892 + i * 38;
    text(label, left + 30, y + 8, "400 22px", PNG.secondary);
    ctx.fillStyle = PNG.track;
    ctx.beginPath();
    ctx.roundRect(230, y - 6, 580, 12, 6);
    ctx.fill();
    if (watts !== null) {
      ctx.fillStyle = colorOf(watts);
      ctx.beginPath();
      ctx.roundRect(230, y - 6, Math.max(12, watts / top * 580), 12, 6);
      ctx.fill();
    }
    text(watts === null ? "–" : `${number(watts)} W`, right - 30, y + 10, "500 28px", PNG.ink, "right");
  });

  text("wattamax.com", left, 1305, "400 22px", PNG.tertiary);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
