// Size the canvas buffer to its CSS size and the screen density, return a context in CSS pixels
export function fitCanvas(canvas) {
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  const ctx = canvas.getContext("2d");
  ctx.scale(devicePixelRatio, devicePixelRatio);
  return { ctx, box: { x: 0, y: 0, w: width, h: height } };
}

// One rounded bar per value, in `slots` evenly spaced places from the left, so a chart that
// isn't full yet fills up from the left. `colorOf(watts)` picks each bar's colour.
// The box is any 2D context region, so the page and the PNG recap share this code.
export function drawBars(ctx, box, values, slots, colorOf, gridColor) {
  const top = Math.max(100, Math.ceil(Math.max(0, ...values) * 1.1 / 50) * 50);
  const slot = box.w / slots;
  const width = Math.max(1, slot * 0.62);

  ctx.fillStyle = gridColor;
  ctx.fillRect(box.x, Math.round(box.y + box.h / 2), box.w, 1);
  values.forEach((watts, i) => {
    const height = watts / top * box.h;
    if (height < 0.5) return;
    ctx.fillStyle = colorOf(watts);
    ctx.beginPath();
    ctx.roundRect(box.x + i * slot + (slot - width) / 2, box.y + box.h - height, width, height, Math.min(width / 2, height / 2));
    ctx.fill();
  });
}
