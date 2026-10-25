import { drawBars, fitCanvas } from "./charts.js";
import { csv, download, fit, recapImage } from "./exports.js";
import { duration, durationLabel, number } from "./format.js";
import { DEFAULT_WEIGHT, RECORD_DURATIONS, Ride } from "./ride.js";
import { Trainer } from "./trainer.js";
import { ZONES, zoneIndex, zoneTimes } from "./zones.js";

const STRAVA_UPLOAD = "https://www.strava.com/upload/select";
const OPEN_STRAVA = "Ouvrir Strava";  // the Strava button on iPhone and iPad, once the file is saved
const HOLD_TIME = 2000;  // ms, the same as the ring animation in style.css
const BUCKET = 5;        // seconds of riding behind each bar of the live chart
const LIVE_BARS = 120;   // 10 minutes of 5-second bars
const MAX_BARS = 120;    // whole-ride charts merge bars to never draw more than this
const COLUMN_MIN = 240;  // px, narrowest column when resizing the live cards
const CARD_MIN = 100;    // px, lowest live card
const SLIDE_TIME = 250;  // ms a card or the bubble takes to slide to its new place
const DEFAULT_FTP = 200; // W, until the rider enters their own

const $ = (id) => document.getElementById(id);
const css = getComputedStyle(document.documentElement);
const wide = matchMedia("(min-width: 901px), (orientation: landscape)");  // the live cards are only resized and moved in two columns
// iPadOS passes for a Mac, but a Mac has no touch screen
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
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

// Weight and FTP start at typical values. Clicking a field once keeps its value as the rider's own,
// since it may well be theirs. What depends on them stays hidden if the rider empties a field.
const settings = { weight: $("weight"), ftp: $("ftp") };
const defaults = { weight: DEFAULT_WEIGHT, ftp: DEFAULT_FTP };
for (const [name, input] of Object.entries(settings)) {
  const saved = load(name);
  input.value = saved ?? defaults[name];
  input.classList.toggle("default", saved === null);
  input.addEventListener("focus", () => { input.classList.remove("default"); save(name, input.value); });
  input.addEventListener("input", () => { save(name, input.value); ride.weight = weight(); render(); });
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

// The summary's rows: the max power, then the best effort on each duration
const RECORD_LABELS = ["Max", ...RECORD_DURATIONS.map(durationLabel)];

// One row per duration: rolling average and session record live, best effort in the summary
function buildRows(id, labels) {
  $(id).innerHTML = labels.map((label) => `<li><span class="label">${label}</span>`
    + '<span class="bar"><span class="ghost"></span><span class="fill"></span></span><span class="watts"></span><span class="record"></span></li>').join("");
}

// `rows` holds, per duration, the watts to draw and the record behind them (null when there's none yet).
// The longest bar fills its track, and the record's paler bar takes the colour of its zone.
function fillRows(id, rows) {
  const top = Math.max(1, ...rows.flatMap((r) => [r.value ?? 0, r.record ?? 0]));
  $(id).querySelectorAll("li").forEach((li, i) => {
    const { value, record } = rows[i];
    const [ghost, fill] = li.querySelectorAll(".bar span");
    ghost.style.width = `${(record ?? 0) / top * 100}%`;
    ghost.style.background = record === null ? "" : `color-mix(in srgb, ${colorOf(record)} 35%, transparent)`;
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
  $("status-pill").disabled = $("connect").hidden || $("connect").disabled;
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

// A power figure takes the colour of its zone, named under it in the same colour
function zoneOf(watts) {
  if (!ftp()) return { color: "", name: "" };
  const zone = zoneIndex(watts, ftp());
  return { color: ZONE_COLORS[zone], name: `Z${zone + 1} ${ZONES[zone].name}` };
}

function renderZone(figure, label, { color, name }) {
  $(figure).style.color = $(label).style.color = color;
  $(label).textContent = name;
  $(label).hidden = !name;
}

function renderLive() {
  const power = ride.displayPower;
  $("power").textContent = number(power);
  $("avg-power").textContent = number(ride.averagePower);
  $("max-power").textContent = number(ride.maxPower);
  $("cadence").textContent = number(ride.cadence);
  $("avg-cadence").textContent = number(ride.averageCadence);
  $("speed").textContent = number(ride.speed, 1);
  $("avg-speed").textContent = number(ride.averageSpeed, 1);
  $("distance").textContent = number(ride.distance, 2);
  $("duration").textContent = duration(ride.time);
  renderZone("power", "zone", zoneOf(power));
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

// Everything the summary shows, which the PNG recap draws the same way
function summaryView() {
  const summary = ride.summary();
  const times = ftp() ? zoneTimes(ride.samples, ftp()) : [];
  const total = times.reduce((a, b) => a + b, 0) || 1;
  return {
    date: ride.startedAt.toLocaleString("fr", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }),
    power: number(summary.power),
    cadence: number(summary.cadence),
    speed: number(summary.speed, 1),
    zone: zoneOf(summary.power),
    wkg: weight() ? number(summary.power / weight(), 1) : "",
    // Each zone's share of the ride, and its time written without the leading zero hours and minutes
    zones: times.map((t, i) => ({ share: t / total, color: ZONE_COLORS[i], time: duration(t).replace(/^0:0?/, "") })),
    distance: number(summary.distance, 2),
    duration: duration(summary.time),
    elapsed: duration(summary.elapsed),
    calories: number(summary.calories),
    records: [summary.maxPower, ...RECORD_DURATIONS.map((d) => ride.records.get(d) ?? null)],
    bars: rideBars(),
  };
}

function renderSummary() {
  const view = summaryView();
  $("s-power").textContent = view.power;
  renderZone("s-power", "s-zone", view.zone);
  $("s-wkg-box").hidden = !view.wkg;
  $("s-wkg").textContent = view.wkg;
  $("s-cadence").textContent = view.cadence;
  $("s-speed").textContent = view.speed;
  $("s-distance").textContent = view.distance;
  $("s-duration").textContent = view.duration;
  $("s-elapsed").textContent = view.elapsed;
  $("s-calories").textContent = view.calories;
  fillRows("records", view.records.map((value) => ({ value, record: null })));
  drawChart($("summary-chart"), view.bars);

  $("zones-box").hidden = !view.zones.length;
  $("zone-bar").innerHTML = view.zones.map((z) => `<span style="flex: ${z.share}; background: ${z.color}"></span>`).join("");
  $("zone-legend").innerHTML = view.zones.map((z, i) => `<li><i style="background: ${z.color}"></i>Z${i + 1} <strong>${z.time}</strong></li>`).join("");
  renderStatus(view.date, "");
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
  if (docked) document.querySelector(".top h1").after(bubble);
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
      message = "Connexion impossible. Vérifie que le home-trainer est allumé et tout près, et qu'aucune autre app (Zwift, Elite…) n'y est connectée, puis réessaie.";
    }
  } finally {
    $("connect").disabled = false;
  }
  if (trainer.active) {
    $("connect").hidden = true;
    $("stop").hidden = false;
    keepScreenOn();
  }
  renderLive();
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
  ride.weight = weight();
  message = "";
  $("summary").hidden = true;
  $("live").hidden = false;
  document.body.dataset.screen = "live";
  $("connect").hidden = false;
  $("stop").hidden = true;
  $("strava").textContent = IMPORT_STRAVA;
  renderLive();
}

function fileName(extension) {
  const d = ride.startedAt;
  const pad = (n) => String(n).padStart(2, "0");
  return `wattamax_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.${extension}`;
}

$("connect").addEventListener("click", connect);
$("status-pill").addEventListener("click", () => $("connect").click());
$("about-open").addEventListener("click", () => $("about").showModal());
$("about").querySelector(".close").addEventListener("click", () => $("about").close());
onHold($("stop"), finish);
onHold($("restart"), reset);
$("autopause").addEventListener("click", () => setAutoPause(!autoPause));
// Only its button takes clicks in the middle of the page, and all of it once docked
$("bubble").addEventListener("click", toggleDock);
for (const button of document.querySelectorAll("[data-chart]")) button.addEventListener("click", () => setChartMode(button.dataset.chart));
const IMPORT_STRAVA = $("strava").textContent;  // the label from index.html, given back for each new ride
// Browsers on iPhone and iPad, Bluefy included, ignore download links, so the file goes
// through the share sheet, where "Enregistrer dans Fichiers" keeps it
const saveFile = (blob, name) => ios ? navigator.share({ files: [new File([blob], name, { type: blob.type })] }) : download(blob, name);

$("csv").addEventListener("click", () => saveFile(csv(ride), fileName("csv")));
$("strava").addEventListener("click", async () => {
  const button = $("strava");
  if (!ios) {
    // The tab opens first: after the wait for the SDK, the browser would no longer count it as a click and block it
    open(STRAVA_UPLOAD, "_blank", "noopener");
    download(await fit(ride), fileName("fit"));
  } else if (button.textContent === OPEN_STRAVA) {
    open(STRAVA_UPLOAD, "_blank", "noopener");
  } else {
    // A tab opened before would hide the share sheet, and one opened after is blocked, as the press is long past.
    // So Strava opens on a second press. Closing the sheet without saving leaves the button as it was
    await saveFile(await fit(ride), fileName("fit"));
    button.textContent = OPEN_STRAVA;
  }
});
$("png").addEventListener("click", async () => saveFile(await recapImage(summaryView(), RECORD_LABELS, colorOf), fileName("png")));

// A chart is drawn again whenever its size changes: the window, or a card resized or moved
const resizes = new ResizeObserver(render);
for (const canvas of document.querySelectorAll("canvas")) resizes.observe(canvas);

// Ask before closing the tab during a ride or on its summary, so a ride isn't lost before it's downloaded
addEventListener("beforeunload", (event) => {
  if (ride.time > 0) event.preventDefault();
});

// The browser drops the wake lock when the tab is hidden; take it back when the person returns
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && trainer?.active && (!wakeLock || wakeLock.released)) keepScreenOn();
});

buildRows("rolling", RECORD_DURATIONS.map(durationLabel));
buildRows("records", RECORD_LABELS);
placeGrips();
for (const card of $("live").querySelectorAll(".card")) makeMovable(card);
setAutoPause(autoPause);
setChartMode(chartMode);
reset();
// What to do without Web Bluetooth, told for the browser at hand
function noBluetoothMessage() {
  const agent = navigator.userAgent;
  const useChrome = "Ouvre cette page dans Google Chrome ou Microsoft Edge.";
  if (ios) {
    return "Sur iPhone et iPad, Safari et les autres navigateurs ne gèrent pas le Bluetooth. Installe l'app gratuite Bluefy depuis l'App Store et ouvre cette page dedans.";
  }
  if (navigator.brave) {
    return "Brave coupe le Bluetooth par défaut. Copie brave://flags/#brave-web-bluetooth-api dans la barre d'adresse, passe l'option sur « Enabled » et relance Brave. Tu peux aussi ouvrir cette page dans Google Chrome ou Microsoft Edge.";
  }
  if (/Firefox\//.test(agent)) return `Firefox ne gère pas le Bluetooth. ${useChrome}`;
  if (!/Chrome|Chromium/.test(agent) && /Safari/.test(agent)) return `Safari ne gère pas le Bluetooth. ${useChrome}`;
  if (/Linux/.test(agent) && !/Android/.test(agent)) {
    return "Sous Linux, Chrome cache le Bluetooth derrière une option. Copie chrome://flags/#enable-experimental-web-platform-features dans la barre d'adresse, passe l'option sur « Enabled » et relance le navigateur.";
  }
  return "Ce navigateur ne gère pas le Bluetooth. Ouvre cette page dans Google Chrome ou Microsoft Edge sur un ordinateur, ou dans Chrome sur Android.";
}

if (!navigator.bluetooth) {
  $("connect").disabled = true;
  message = noBluetoothMessage();
  renderLive();
}
