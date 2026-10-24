import { durationLabel, number } from "./format.js";

// Both charts draw into a box { x, y, w, h } of any 2D context, with colours passed in,
// so the same code renders the page (current theme) and the PNG recap (always light).

// Size the canvas buffer to its CSS size and the screen density, return a context in CSS pixels
export function fitCanvas(canvas) {
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  const ctx = canvas.getContext("2d");
  ctx.scale(devicePixelRatio, devicePixelRatio);
  return { ctx, box: { x: 0, y: 0, w: width, h: height } };
}

// 3-second power over moving time, between `from` and `to` seconds
export function drawPowerLine(ctx, box, samples, colors, from, to, font = 13) {
  const visible = samples.filter((s) => s.time >= from);
  const top = Math.max(100, Math.ceil(Math.max(0, ...visible.map((s) => s.power3s)) * 1.1 / 50) * 50);
  const inner = { ...box, y: box.y + font * 1.5, h: box.h - font * 1.5 };  // room for the top label
  const x = (time) => inner.x + (time - from) / (to - from) * inner.w;
  const y = (power) => inner.y + inner.h - power / top * inner.h;

  if (visible.length > 1) powerArea(ctx, visible, colors, font, x, y, inner);
  gridLines(ctx, inner, colors, font, [top / 2, top], y);
}

function powerArea(ctx, visible, colors, font, x, y, box) {
  ctx.beginPath();
  visible.forEach((s, i) => (i ? ctx.lineTo(x(s.time), y(s.power3s)) : ctx.moveTo(x(s.time), y(s.power3s))));
  ctx.strokeStyle = colors.red;
  ctx.lineWidth = font / 6.5;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.lineTo(x(visible.at(-1).time), box.y + box.h);
  ctx.lineTo(x(visible[0].time), box.y + box.h);
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = colors.red;
  ctx.fill();
  ctx.globalAlpha = 1;
}

// Best average power for each duration. Durations are evenly spaced rather than on a time
// scale, otherwise 5, 10 and 20 min would sit on top of each other.
export function drawPowerCurve(ctx, box, curve, colors, font = 13) {
  const top = Math.ceil(Math.max(...curve.map((p) => p.power)) * 1.25 / 50) * 50;
  const inner = { ...box, y: box.y + font * 1.8, h: box.h - font * 3.6 };  // room for the labels above and below
  const x = (i) => inner.x + (i + 0.5) / curve.length * inner.w;
  const y = (power) => inner.y + inner.h - power / top * inner.h;

  gridLines(ctx, inner, colors, font, [], y);
  ctx.beginPath();
  curve.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.power)) : ctx.moveTo(x(i), y(p.power))));
  ctx.strokeStyle = colors.red;
  ctx.lineWidth = font / 6.5;
  ctx.stroke();

  ctx.textAlign = "center";
  curve.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(p.power), font / 3, 0, 2 * Math.PI);
    ctx.fillStyle = colors.red;
    ctx.fill();
    ctx.fillStyle = colors.ink;
    ctx.font = `600 ${font}px Barlow`;
    ctx.fillText(`${number(p.power)} W`, x(i), y(p.power) - font * 0.8);
    ctx.fillStyle = colors.muted;
    ctx.font = `400 ${font}px Barlow`;
    ctx.fillText(durationLabel(p.duration), x(i), box.y + box.h);
  });
}

// Baseline plus a labelled line for each value in `levels`. Labels get a halo
// in the background colour so they stay readable when the curve runs through them.
function gridLines(ctx, box, colors, font, levels, y) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.line;
  ctx.fillStyle = colors.muted;
  ctx.font = `400 ${font}px Barlow`;
  ctx.textAlign = "left";
  for (const level of [0, ...levels]) {
    ctx.beginPath();
    ctx.moveTo(box.x, Math.round(y(level)) + 0.5);
    ctx.lineTo(box.x + box.w, Math.round(y(level)) + 0.5);
    ctx.stroke();
    if (!level) continue;
    ctx.strokeStyle = colors.bg;
    ctx.lineWidth = 4;
    ctx.strokeText(`${level} W`, box.x, y(level) - font * 0.4);
    ctx.fillText(`${level} W`, box.x, y(level) - font * 0.4);
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
  }
}
