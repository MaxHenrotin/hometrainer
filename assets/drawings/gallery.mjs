// Draws every drawing the export window can offer into gallery.png, styled like its tiles, with each one's
// name in js/route.js below it. Run with `node gallery.mjs` after changing the drawings (needs Google Chrome).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DRAWINGS, SUPPORT } from "../../js/route.js";

const COLUMNS = 6;
const TILE = 150;

// The same SVG as the export window's (drawingSvg in js/app.js)
function svg(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const [left, top] = [Math.min(...xs), Math.max(...ys)];
  const [width, height] = [Math.max(...xs) - left, top - Math.min(...ys)];
  const scale = 100 / Math.max(width, height);
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${((x - left) * scale).toFixed(1)} ${((top - y) * scale).toFixed(1)}`).join("");
  return `<svg viewBox="-3 -3 ${width * scale + 6} ${height * scale + 6}" aria-hidden="true"><path d="${d}"></path></svg>`;
}

const tile = (name) => `<figure><button type="button"${name === SUPPORT ? ' class="support"' : ""}>${svg(DRAWINGS[name])}</button><figcaption>${name}</figcaption></figure>`;
const others = Object.keys(DRAWINGS).filter((name) => name !== SUPPORT);
const width = COLUMNS * TILE + (COLUMNS - 1) * 8;
const rows = Math.ceil(others.length / COLUMNS);
const height = 96 + 36 + 30 + rows * (TILE + 30 + 8) + 36;

const style = fileURLToPath(new URL("../../style.css", import.meta.url));
const page = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="file://${style}">
<style>
  body { margin: 0; padding: 36px; min-height: 0; background: var(--card); }
  .drawings { --columns: ${COLUMNS}; width: ${width}px; }
  .drawings figure { width: calc((100% - (var(--columns) - 1) * var(--gap)) / var(--columns)); margin: 0; }
  .drawings figure:first-child { width: 100%; }
  .drawings figure button { width: 100%; max-width: none; }
  figcaption { margin-top: 4px; font: 500 13px Barlow, sans-serif; color: var(--secondary); text-align: center; }
</style>
<body data-screen="summary"><div class="drawings">${[SUPPORT, ...others].map(tile).join("")}</div></body>`;

const dir = mkdtempSync(join(tmpdir(), "gallery-"));
writeFileSync(join(dir, "gallery.html"), page);
execFileSync("google-chrome", ["--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
  `--screenshot=${fileURLToPath(new URL("gallery.png", import.meta.url))}`, `--window-size=${width + 72},${height}`,
  `file://${join(dir, "gallery.html")}`], { stdio: "ignore" });
rmSync(dir, { recursive: true });
