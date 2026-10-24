// Size the canvas buffer to its CSS size and the screen density, return a context in CSS pixels
export function fitCanvas(canvas) {
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  const ctx = canvas.getContext("2d");
  ctx.scale(devicePixelRatio, devicePixelRatio);
  return { ctx, box: { x: 0, y: 0, w: width, h: height } };
}

// The smallest round step that splits the chart into at most 5 lines
const STEPS = [50, 100, 200, 250, 500];

// One rounded bar per value, in `slots` evenly spaced places from the left, so a chart that
// isn't full yet fills up from the left. `colorOf(watts)` picks each bar's colour. A scale on
// the left marks round values, and grows with the highest bar.
export function drawBars(ctx, box, values, slots, colorOf, colors) {
  const highest = Math.max(100, ...values) * 1.08;
  const step = STEPS.find((s) => highest / s <= 5) ?? 1000;
  const top = Math.ceil(highest / step) * step;
  const inset = 8;  // keeps the top label from being cut in half
  const y = (watts) => box.y + box.h - watts / top * (box.h - inset);

  ctx.font = "500 13px Inter, sans-serif";
  ctx.textBaseline = "middle";
  const gutter = ctx.measureText(`${top} W`).width + 14;
  const plot = { x: box.x + gutter, w: box.w - gutter };
  for (let watts = step; watts <= top; watts += step) {
    ctx.fillStyle = colors.grid;
    ctx.fillRect(plot.x, Math.round(y(watts)), plot.w, 1);
    ctx.fillStyle = colors.label;
    ctx.fillText(`${watts} W`, box.x, y(watts));
  }

  const slot = plot.w / slots;
  const width = Math.max(1, slot * 0.62);
  values.forEach((watts, i) => {
    const height = watts / top * (box.h - inset);
    if (height < 0.5) return;
    ctx.fillStyle = colorOf(watts);
    ctx.beginPath();
    ctx.roundRect(plot.x + i * slot + (slot - width) / 2, y(watts), width, height, Math.min(width / 2, height / 2));
    ctx.fill();
  });
}
