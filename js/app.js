import { drawBars, fitCanvas } from "./charts.js";
import { csv, download, fit, recapImage } from "./exports.js";
import { duration, durationLabel, number } from "./format.js";
import { RECORD_DURATIONS, Ride } from "./ride.js";
import { Trainer } from "./trainer.js";
import { ZONES, zoneIndex, zoneTimes } from "./zones.js";

const STRAVA_UPLOAD = "https://www.strava.com/upload/select";
const HOLD_TIME = 2000;  // ms, the same as the ring animation in style.css
const BUCKET = 5;        // seconds of riding behind each bar of the live chart
const LIVE_BARS = 120;   // 10 minutes of 5-second bars
const MAX_BARS = 120;    // whole-ride charts merge bars to never draw more than this
const COLUMN_MIN = 240;  // px, narrowest column when resizing the live cards
const CARD_MIN = 100;    // px, lowest live card
const SWAP_TIME = 250;   // ms a card takes to slide to its new place

const $ = (id) => document.getElementById(id);
const css = getComputedStyle(document.documentElement);
const wide = matchMedia("(min-width: 901px)");  // the live cards are only resized and moved on a large screen
const color = (name) => css.getPropertyValue(`--${name}`).trim();
const ZONE_COLORS = ZONES.map((_, i) => color(`z${i + 1}`));

let trainer = null;
let ride = new Ride();
let reconnecting = false;
let wakeLock = null;
let message = "";  // an error to show in the bubble until the next connection attempt

// Settings are remembered by this browser only, and nothing is remembered if storage is blocked
const load = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* not remembered */ } };

// Weight and FTP are optional, and what depends on them stays hidden while they're empty
const settings = { weight: $("weight"), ftp: $("ftp") };
for (const [name, input] of Object.entries(settings)) {
  input.value = load(name) ?? "";
  input.addEventListener("input", () => { save(name, input.value); render(); });
}
const weight = () => Number(settings.weight.value) || null;
const ftp = () => Number(settings.ftp.value) || null;
const colorOf = (watts) => (ftp() ? ZONE_COLORS[zoneIndex(watts, ftp())] : color("accent"));

let autoPause = load("autoPause") !== "off";
function setAutoPause(on) {
  autoPause = ride.autoPause = on;
  $("autopause").setAttribute("aria-checked", on);
  save("autoPause", on ? "on" : "off");
}

let chartMode = load("chart") === "all" ? "all" : "10min";
function setChartMode(mode) {
  chartMode = mode;
  for (const button of document.querySelectorAll("[data-chart]")) button.setAttribute("aria-pressed", button.dataset.chart === mode);
  save("chart", mode);
  render();
}

// One row per duration: rolling average and session record live, best effort in the summary
function buildRows(id) {
  $(id).innerHTML = RECORD_DURATIONS.map((d) => `<li><span class="label">${durationLabel(d)}</span>`
    + '<span class="bar"><span class="ghost"></span><span class="fill"></span></span><span class="watts"></span><span class="record"></span></li>').join("");
}

// `rows` holds, per duration, the watts to draw and the record behind them (null when there's none yet)
function fillRows(id, rows) {
  const top = Math.max(200, ...rows.flatMap((r) => [r.value ?? 0, r.record ?? 0])) * 1.05;
  $(id).querySelectorAll("li").forEach((li, i) => {
    const { value, record } = rows[i];
    const [ghost, fill] = li.querySelectorAll(".bar span");
    ghost.style.width = `${(record ?? 0) / top * 100}%`;
    fill.style.width = `${(value ?? 0) / top * 100}%`;
    fill.style.background = value === null ? "" : colorOf(value);
    li.querySelector(".watts").textContent = value === null ? "–" : number(value);
    li.querySelector(".record").textContent = record === null ? "" : number(record);
  });
}

// The whole ride, merged into at most MAX_BARS bars of a whole number of 5-second slices
function rideBars() {
  const size = Math.max(BUCKET, Math.ceil(ride.time / MAX_BARS / BUCKET) * BUCKET);
  const bars = ride.powerBuckets(size);
  return { bars, slots: bars.length };
}

// The last 10 minutes fill up from the left, then scroll
function lastBars() {
  const first = Math.max(0, Math.floor(ride.time / BUCKET) - (LIVE_BARS - 1));
  return { bars: ride.powerBuckets(BUCKET, first * BUCKET), slots: LIVE_BARS };
}

function drawChart(canvas, { bars, slots }) {
  const { ctx, box } = fitCanvas(canvas);
  drawBars(ctx, box, bars, Math.max(slots, 1), colorOf, { grid: color("track"), label: color("tertiary") });
}

function renderStatus(text, dot) {
  $("status").textContent = text;
  $("status-dot").className = `dot ${dot}`;
}

// What the bubble over the app says, and how it's marked: info, start, pause or error
function bubble() {
  if (message) return [message, "error"];
  if (!trainer?.active) return ["Pédale pour réveiller le home-trainer, puis connecte-le", "info"];
  if (reconnecting) return ["Bluetooth déconnecté. Reconnexion…", "error"];
  if (ride.state === "waiting") return ["Pédale pour démarrer", "start"];
  if (ride.state === "paused") return ["En pause. Pédale pour reprendre", "pause"];
  return ["", ""];
}

// The power figure takes the colour of its zone
function renderZone(watts) {
  $("zone").hidden = !ftp();
  $("power").style.color = "";
  if (!ftp()) return;
  const zone = zoneIndex(watts, ftp());
  $("power").style.color = ZONE_COLORS[zone];
  $("zone").textContent = `Z${zone + 1} ${ZONES[zone].name}`;
}

function renderLive() {
  const power = ride.displayPower;
  $("power").textContent = number(power);
  $("avg-power").textContent = number(ride.averagePower);
  $("cadence").textContent = number(ride.cadence);
  $("avg-cadence").textContent = number(ride.averageCadence);
  $("speed").textContent = number(ride.speed, 1);
  $("avg-speed").textContent = number(ride.averageSpeed, 1);
  $("distance").textContent = number(ride.distance, 2);
  $("duration").textContent = duration(ride.time);
  renderZone(power);
  $("wkg-box").hidden = !weight();
  if (weight()) {
    $("wkg").textContent = number(power / weight(), 1);
    $("avg-wkg").textContent = number(ride.averagePower / weight(), 1);
  }
  fillRows("rolling", RECORD_DURATIONS.map((d) => ({ value: ride.average(d), record: ride.records.get(d) ?? null })));

  if (!trainer?.active) renderStatus("Pas connecté", "");
  else if (reconnecting) renderStatus("Déconnecté", "lost");
  else renderStatus(trainer.name, "on");
  const [text, kind] = bubble();
  $("bubble").textContent = text;
  $("bubble").className = `bubble ${kind}`;
  document.body.dataset.state = reconnecting ? "paused" : ride.state;

  drawChart($("live-chart"), chartMode === "all" ? rideBars() : lastBars());
}

function renderSummary() {
  const summary = ride.summary();
  $("ride-date").textContent = ride.startedAt.toLocaleString("fr", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  $("s-power").textContent = number(summary.power);
  $("s-wkg-box").hidden = !weight();
  if (weight()) $("s-wkg").textContent = number(summary.power / weight(), 1);
  $("s-cadence").textContent = number(summary.cadence);
  $("s-speed").textContent = number(summary.speed, 1);
  $("s-distance").textContent = number(summary.distance, 2);
  $("s-duration").textContent = duration(summary.time);
  $("s-elapsed").textContent = duration(summary.elapsed);
  $("s-calories").textContent = number(summary.calories);
  fillRows("records", RECORD_DURATIONS.map((d) => ({ value: ride.records.get(d) ?? null, record: null })));
  drawChart($("summary-chart"), rideBars());

  $("zones-box").hidden = !ftp();
  if (ftp()) {
    const times = zoneTimes(ride.samples, ftp());
    const total = times.reduce((a, b) => a + b, 0) || 1;
    $("zone-bar").innerHTML = times.map((t, i) => `<span style="flex: ${t / total}; background: ${ZONE_COLORS[i]}"></span>`).join("");
    $("zone-legend").innerHTML = times.map((t, i) => `<li><i style="background: ${ZONE_COLORS[i]}"></i>Z${i + 1} <strong>${duration(t).replace(/^0:0?/, "")}</strong></li>`).join("");
  }
  renderStatus("Séance terminée", "");
}

const render = () => ($("summary").hidden ? renderLive() : renderSummary());

// A live card resizes from its corners that touch another card. Sideways moves the border between
// the two columns; up and down moves the border between the card and the one above or below it,
// by sharing the column's height between them. Grips depend on where the cards are, so they're
// placed again after a swap.
function placeGrips() {
  const live = $("live");
  for (const grip of live.querySelectorAll(".grip")) grip.remove();
  for (const card of live.querySelectorAll(".card")) addGrips(live, card);
}

function addGrips(live, card) {
  const column = card.parentElement;
  const inSide = column.classList.contains("side");
  const [top, bottom] = column.querySelectorAll(":scope > .card");
  for (const v of ["top", "bottom"]) for (const h of ["left", "right"]) {
    const x = (h === "right") === inSide;
    const y = (v === "bottom") === (card === top);
    if (!x && !y) continue;
    const grip = document.createElement("span");
    grip.className = `grip ${v} ${h}`;
    grip.style.cursor = x && y ? ((v === "top") === (h === "left") ? "nwse-resize" : "nesw-resize") : x ? "ew-resize" : "ns-resize";
    let start;
    grip.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      start = { x: event.clientX, y: event.clientY, column: live.querySelector(".column").offsetWidth, top: top.offsetHeight, bottom: bottom.offsetHeight };
    });
    grip.addEventListener("pointermove", (event) => {
      if (!grip.hasPointerCapture(event.pointerId)) return;
      if (x) {
        const widest = live.clientWidth - parseFloat(getComputedStyle(live).columnGap) - COLUMN_MIN;
        live.style.setProperty("--column", `${Math.min(Math.max(start.column - (event.clientX - start.x), COLUMN_MIN), widest)}px`);
      }
      if (y) {
        const total = start.top + start.bottom;
        const height = Math.min(Math.max(start.top + event.clientY - start.y, CARD_MIN), total - CARD_MIN);
        top.style.flex = `${height} 1 ${height}px`;
        bottom.style.flex = `${total - height} 1 ${total - height}px`;
      }
      render();
    });
    card.append(grip);
  }
}

// Pressing a live card lifts it and it follows the pointer. Passing over another card swaps their
// places at once, the other card sliding to the place the dragged one left. Sizes stay with the
// places, so each card takes the size of the place it moves to.
function makeMovable(card) {
  let grab = null;  // where the card is held, as a share of its width and height, while it's dragged
  card.addEventListener("pointerdown", (event) => {
    if (!wide.matches || event.button !== 0 || event.target.closest(".grip, button")) return;
    card.setPointerCapture(event.pointerId);
    const box = card.getBoundingClientRect();
    grab = { x: (event.clientX - box.x) / box.width, y: (event.clientY - box.y) / box.height };
    card.classList.add("lifted");
  });
  card.addEventListener("pointermove", (event) => {
    if (!grab) return;
    // A card still sliding away is skipped, or it would be found under the pointer and swapped back
    const other = document.elementsFromPoint(event.clientX, event.clientY)
      .find((el) => el !== card && el.matches("#live .card") && !el.getAnimations().length);
    if (other) swap(card, other);
    // The card keeps the same spot under the pointer, even when its size changes
    card.style.translate = "";
    const box = card.getBoundingClientRect();
    card.style.translate = `${event.clientX - box.x - grab.x * box.width}px ${event.clientY - box.y - grab.y * box.height}px`;
  });
  const drop = () => {
    if (!grab) return;
    grab = null;
    card.classList.remove("lifted");
    const from = card.style.translate;
    card.style.translate = "";
    if (from) card.animate([{ translate: from }, { translate: "0 0" }], { duration: SWAP_TIME, easing: "ease-out" });
  };
  card.addEventListener("pointerup", drop);
  card.addEventListener("pointercancel", drop);
}

// The other card slides from where it was to the dragged card's place
function swap(dragged, other) {
  const before = other.getBoundingClientRect();
  const mark = document.createComment("");
  dragged.replaceWith(mark);
  other.replaceWith(dragged);
  mark.replaceWith(other);
  [dragged.style.flex, other.style.flex] = [other.style.flex, dragged.style.flex];
  placeGrips();
  render();
  const after = other.getBoundingClientRect();
  const dx = before.x + before.width / 2 - after.x - after.width / 2;
  const dy = before.y + before.height / 2 - after.y - after.height / 2;
  other.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: SWAP_TIME, easing: "ease-out" });
}

// Hold-to-confirm: the action runs once the button has been held for HOLD_TIME while its ring fills.
// It replaces confirmation dialogs for actions that can't be undone.
function onHold(button, action) {
  let timer = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    button.classList.remove("holding");
  };
  const start = (event) => {
    event.preventDefault();
    if (timer) return;
    button.classList.add("holding");
    timer = setTimeout(() => { cancel(); action(); }, HOLD_TIME);
  };
  button.addEventListener("pointerdown", start);
  for (const type of ["pointerup", "pointerleave", "pointercancel"]) button.addEventListener(type, cancel);
  button.addEventListener("keydown", (event) => { if ((event.key === " " || event.key === "Enter") && !event.repeat) start(event); });
  button.addEventListener("keyup", (event) => { if (event.key === " " || event.key === "Enter") cancel(); });
}

async function keepScreenOn() {
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch { /* not critical: the ride still records */ }
}

async function connect() {
  message = "";
  $("connect").disabled = true;
  trainer = new Trainer(
    (values) => { ride.update(values); renderLive(); },
    (connected) => { reconnecting = !connected; if (!connected) ride.pause(); renderLive(); },
  );
  try {
    await trainer.connect();
  } catch (error) {
    // NotFoundError means the person closed the device picker
    if (error.name !== "NotFoundError") {
      message = `Connexion impossible : ${error.message}. Vérifie que Zwift ou l'app Elite ne sont pas déjà connectés au home-trainer.`;
    }
    renderLive();
    return;
  } finally {
    $("connect").disabled = false;
  }
  $("connect").hidden = true;
  $("stop").hidden = false;
  renderLive();
  keepScreenOn();
}

function finish() {
  trainer.disconnect();
  reconnecting = false;
  wakeLock?.release();
  if (ride.time < 1) {
    reset();
    message = "Aucune donnée enregistrée : la séance démarre au premier coup de pédale.";
    renderLive();
    return;
  }
  $("live").hidden = true;
  $("summary").hidden = false;
  document.body.dataset.screen = "summary";
  document.body.dataset.state = "";
  renderSummary();
}

function reset() {
  trainer = null;
  ride = new Ride();
  ride.autoPause = autoPause;
  message = "";
  $("summary").hidden = true;
  $("live").hidden = false;
  document.body.dataset.screen = "live";
  $("connect").hidden = false;
  $("stop").hidden = true;
  renderLive();
}

function fileName(extension) {
  const d = ride.startedAt;
  const pad = (n) => String(n).padStart(2, "0");
  return `hometrainer_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.${extension}`;
}

$("connect").addEventListener("click", connect);
onHold($("stop"), finish);
onHold($("restart"), reset);
$("autopause").addEventListener("click", () => setAutoPause(!autoPause));
for (const button of document.querySelectorAll("[data-chart]")) button.addEventListener("click", () => setChartMode(button.dataset.chart));
$("csv").addEventListener("click", () => download(csv(ride), fileName("csv")));
$("strava").addEventListener("click", async () => {
  // The tab opens first: after the wait for the SDK, the browser would no longer count it as a click and block it
  open(STRAVA_UPLOAD, "_blank", "noopener");
  download(await fit(ride), fileName("fit"));
});
$("png").addEventListener("click", async () => download(await recapImage(ride, weight(), colorOf), fileName("png")));
addEventListener("resize", render);

// Ask before closing the tab during a ride or on its summary, so a ride isn't lost before it's downloaded
addEventListener("beforeunload", (event) => {
  if (ride.time > 0) event.preventDefault();
});

// The browser drops the wake lock when the tab is hidden; take it back when the person returns
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && trainer?.active && (!wakeLock || wakeLock.released)) keepScreenOn();
});

buildRows("rolling");
buildRows("records");
placeGrips();
for (const card of $("live").querySelectorAll(".card")) makeMovable(card);
setAutoPause(autoPause);
setChartMode(chartMode);
reset();
if (!navigator.bluetooth) {
  $("connect").disabled = true;
  message = "Ce navigateur ne gère pas le Bluetooth. Ouvre cette page dans Google Chrome ou Microsoft Edge sur un ordinateur. Sous Linux, active d'abord l'option « Experimental Web Platform features » dans chrome://flags.";
  renderLive();
}
