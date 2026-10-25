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
const SLIDE_TIME = 250;  // ms a card or the bubble takes to slide to its new place

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
  $("bubble-text").textContent = text;
  $("bubble").hidden = !text;
  $("bubble").dataset.kind = kind;
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
// placed again once a card is dropped.
function placeGrips() {
  const live = $("live");
  for (const grip of live.querySelectorAll(".grip")) grip.remove();
  for (const card of live.querySelectorAll(".card")) addGrips(live, card);
}

function addGrips(live, card) {
  const column = card.parentElement;
  const inSide = column.classList.contains("side");
  const [top, bottom] = column.querySelectorAll(":scope > .card");
  // Corners, then edges, where "" leaves out a side: an edge only moves the border it lies on
  for (const v of ["top", "bottom", ""]) for (const h of ["left", "right", ""]) {
    const x = h !== "" && (h === "right") === inSide;
    const y = v !== "" && (v === "bottom") === (card === top);
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

// Pressing a live card lifts it out of its place, which stays empty, and the card follows the
// pointer at its own size. Passing over another card slides that card into the empty place, and
// dropping the card moves it into the place left empty. Sizes stay with the places, so a card
// takes the size of the place it lands in. While dragging, the card only moves by `translate`,
// and the slides only animate `transform`, so the page isn't laid out again on every frame.
function makeMovable(card) {
  let start = null;  // where the pointer pressed the card, while it's dragged
  let slot;          // the empty place the card will land in
  card.addEventListener("pointerdown", (event) => {
    if (!wide.matches || event.button !== 0 || event.target.closest(".grip, button")) return;
    const box = card.getBoundingClientRect();
    slot = document.createElement("div");
    slot.className = "slot";
    // The same padding as the card, so its place keeps the same share of the column
    slot.style.cssText = `flex: ${card.style.flex}; padding: ${getComputedStyle(card).padding}`;
    card.replaceWith(slot);
    Object.assign(card.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
    card.classList.add("dragged");
    // Out of the columns, so it doesn't count among their children; still in #live for its styles
    $("live").append(card);
    card.setPointerCapture(event.pointerId);
    start = { x: event.clientX, y: event.clientY };
  });
  card.addEventListener("pointermove", (event) => {
    if (!start) return;
    card.style.translate = `${event.clientX - start.x}px ${event.clientY - start.y}px`;
    // A card still sliding is skipped, or it would be found under the pointer on its way out and swapped back
    const other = document.elementsFromPoint(event.clientX, event.clientY)
      .find((el) => el !== card && el.matches("#live .card") && !el.getAnimations().length);
    if (!other) return;
    const from = other.getBoundingClientRect();
    swap(slot, other);
    render();
    slide(other, from);
  });
  const drop = () => {
    if (!start) return;
    start = null;
    const from = card.getBoundingClientRect();
    card.classList.remove("dragged");
    Object.assign(card.style, { left: "", top: "", width: "", height: "", translate: "", flex: slot.style.flex });
    slot.replaceWith(card);
    placeGrips();
    render();
    slide(card, from);
  };
  card.addEventListener("pointerup", drop);
  card.addEventListener("pointercancel", drop);
}

// Swaps two elements of the columns, and their sizes with them
function swap(a, b) {
  const mark = document.createComment("");
  a.replaceWith(mark);
  b.replaceWith(a);
  mark.replaceWith(b);
  [a.style.flex, b.style.flex] = [b.style.flex, a.style.flex];
}

// The element is drawn at its former box, then eased into its new one
function slide(el, from) {
  const to = el.getBoundingClientRect();
  const back = `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.width / to.width}, ${from.height / to.height})`;
  el.animate([{ transform: back }, { transform: "none" }], { duration: SLIDE_TIME, easing: "ease-out" });
}

// The bubble's button docks it, small, in the header; clicking it there brings it back. It stays
// docked whatever it says next.
function toggleDock() {
  const bubble = $("bubble");
  const from = bubble.getBoundingClientRect();
  const docked = bubble.classList.toggle("docked");
  if (docked) document.querySelector(".controls").prepend(bubble);
  else document.body.append(bubble);
  slide(bubble, from);
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
// Only its button takes clicks in the middle of the page, and all of it once docked
$("bubble").addEventListener("click", toggleDock);
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
