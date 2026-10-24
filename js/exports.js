import { drawPowerCurve } from "./charts.js";
import { duration, number } from "./format.js";
import { ALTITUDE, routePosition } from "./route.js";

// The recap image always uses the light theme, whatever the page looks like
const LIGHT = { bg: "#f3f5f7", ink: "#14213d", muted: "#5b6475", line: "#d5dae2", red: "#d62828", blue: "#1d4ed8" };

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

  encoder.onMesg(MesgNum.FILE_ID, { type: "activity", manufacturer: "development", product: 0, timeCreated: first });
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

// A 1080×1350 picture (the portrait format of most social apps) with the key numbers and the power curve
export async function recapImage(ride, weight) {
  await Promise.all(["700 100px 'Barlow Condensed'", "500 100px 'Barlow Condensed'", "400 30px Barlow", "600 30px Barlow"]
    .map((font) => document.fonts.load(font)));
  const summary = ride.summary();
  const canvas = Object.assign(document.createElement("canvas"), { width: 1080, height: 1350 });
  const ctx = canvas.getContext("2d");
  const left = 80;
  const right = 1000;

  ctx.fillStyle = LIGHT.bg;
  ctx.fillRect(0, 0, 1080, 1350);
  for (const [color, y] of [[LIGHT.ink, 0], [LIGHT.red, 14], [LIGHT.blue, 28]]) {
    ctx.fillStyle = color;
    ctx.fillRect(0, y, 1080, 8);
  }

  ctx.fillStyle = LIGHT.ink;
  ctx.font = "700 56px 'Barlow Condensed'";
  ctx.fillText("Hometrainer", left, 140);
  ctx.textAlign = "right";
  ctx.fillStyle = LIGHT.muted;
  ctx.font = "400 30px Barlow";
  ctx.fillText(ride.startedAt.toLocaleDateString("fr", { weekday: "long", day: "numeric", month: "long", year: "numeric" }), right, 140);
  ctx.textAlign = "left";

  ctx.fillText("Puissance moyenne", left, 240);
  ctx.fillStyle = LIGHT.red;
  ctx.font = "700 240px 'Barlow Condensed'";
  ctx.letterSpacing = "10px";  // at this size the digits of the condensed face touch each other
  const power = number(summary.power);
  ctx.fillText(power, left - 8, 460);
  const powerWidth = ctx.measureText(power).width;
  ctx.letterSpacing = "0px";
  ctx.fillStyle = LIGHT.muted;
  ctx.font = "500 80px 'Barlow Condensed'";
  ctx.fillText(weight ? `W   ${number(summary.power / weight, 1)} W/kg` : "W", left + powerWidth + 8, 460);

  ctx.fillStyle = LIGHT.ink;
  ctx.fillRect(left, 520, right - left, 6);
  const stats = [
    ["Durée", duration(summary.time), ""],
    ["Distance", number(summary.distance, 2), "km"],
    ["Vitesse moyenne", number(summary.speed, 1), "km/h"],
    ["Cadence moyenne", number(summary.cadence), "rpm"],
    ["Puissance max", number(summary.maxPower), "W"],
    ["Calories", number(summary.calories), "kcal"],
  ];
  stats.forEach(([label, value, unit], i) => {
    const x = left + (i % 3) * 320;
    const y = 590 + Math.floor(i / 3) * 170;
    ctx.fillStyle = LIGHT.muted;
    ctx.font = "400 28px Barlow";
    ctx.fillText(label, x, y);
    ctx.fillStyle = LIGHT.ink;
    ctx.font = "700 76px 'Barlow Condensed'";
    ctx.fillText(value, x, y + 80);
    ctx.fillStyle = LIGHT.muted;
    ctx.font = "500 34px 'Barlow Condensed'";
    ctx.fillText(unit, x + measure(ctx, value, "700 76px 'Barlow Condensed'") + 10, y + 80);
  });

  ctx.fillStyle = LIGHT.muted;
  ctx.font = "400 28px Barlow";
  ctx.fillText("Meilleurs efforts", left, 960);
  if (summary.curve.length) drawPowerCurve(ctx, { x: left, y: 990, w: right - left, h: 270 }, summary.curve, LIGHT, 26);

  ctx.textAlign = "left";
  ctx.fillStyle = LIGHT.muted;
  ctx.font = "400 24px Barlow";
  ctx.fillText("hometrainer.vercel.app", left, 1310);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function measure(ctx, text, font) {
  const previous = ctx.font;
  ctx.font = font;
  const width = ctx.measureText(text).width;
  ctx.font = previous;
  return width;
}
