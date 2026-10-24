import { drawPowerCurve } from "./charts.js";
import { duration, number } from "./format.js";

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

// Garmin TCX, which Strava imports with power and cadence. Pauses show up as gaps
// in the timestamps, so Strava works out the moving time by itself.
export function tcx(ride) {
  const summary = ride.summary();
  const start = ride.startedAt.toISOString();
  const points = ride.samples.map((s) => `
        <Trackpoint>
          <Time>${new Date(s.timestamp).toISOString()}</Time>
          <DistanceMeters>${(s.distance * 1000).toFixed(1)}</DistanceMeters>
          <Cadence>${Math.min(254, Math.round(s.cadence))}</Cadence>
          <Extensions><ns3:TPX><ns3:Speed>${(s.speed / 3.6).toFixed(2)}</ns3:Speed><ns3:Watts>${Math.max(0, s.power)}</ns3:Watts></ns3:TPX></Extensions>
        </Trackpoint>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>${start}</Id>
      <Lap StartTime="${start}">
        <TotalTimeSeconds>${summary.time.toFixed(0)}</TotalTimeSeconds>
        <DistanceMeters>${(summary.distance * 1000).toFixed(1)}</DistanceMeters>
        <Calories>${Math.round(summary.energy)}</Calories>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>${points}
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;
  return new Blob([xml], { type: "application/vnd.garmin.tcx+xml" });
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
    ["Énergie", number(summary.energy), "kJ"],
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
