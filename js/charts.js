// Size the canvas buffer to its CSS size and the screen density, return a context in CSS pixels.
// The layout size ignores transforms, so a card sliding to its place doesn't skew the drawing.
export function fitCanvas(canvas) {
  const { clientWidth: width, clientHeight: height } = canvas;
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  const ctx = canvas.getContext("2d");
  ctx.scale(devicePixelRatio, devicePixelRatio);
  return { ctx, box: { x: 0, y: 0, w: width, h: height } };
}

// The smallest round step that splits the chart into at most 5 lines
const STEPS = [50, 100, 200, 250, 500];

// One rounded bar per value, in `slots` evenly spaced places from the left, so a chart that
// isn't full yet fills up from the left. `colorOf(watts)` picks each bar's colour. The highest
// bar reaches the top, from 100 W up, and a scale on the left marks round values below it.
export function drawBars(ctx, box, values, slots, colorOf, colors) {
  const top = Math.max(100, ...values);
  const step = STEPS.find((s) => top / s <= 5) ?? 1000;
  const inset = 8;  // keeps a label at the very top from being cut in half
  const y = (watts) => box.y + box.h - watts / top * (box.h - inset);

  ctx.font = "500 13px Barlow, sans-serif";
  ctx.textBaseline = "middle";
  const gutter = ctx.measureText(`${Math.floor(top / step) * step} W`).width + 14;
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
