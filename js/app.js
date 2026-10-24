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

const $ = (id) => document.getElementById(id);
const css = getComputedStyle(document.documentElement);
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

// What the bubble over the chart says, and how it's marked: info, pause or error
function bubble() {
  if (message) return [message, "error"];
  if (!trainer?.active) return ["Pédale pour réveiller le home-trainer, puis connecte-le", "info"];
  if (reconnecting) return ["Bluetooth déconnecté. Reconnexion…", "error"];
  if (ride.state === "waiting") return ["Pédale pour démarrer", "info"];
  if (ride.state === "paused") return ["En pause. Pédale pour reprendre", "pause"];
  return ["", ""];
}

function renderZone(watts) {
  $("zone-box").hidden = !ftp();
  if (!ftp()) return;
  const zone = zoneIndex(watts, ftp());
  $("zone-scale").querySelectorAll("span").forEach((span, i) => {
    span.style.background = i <= zone ? ZONE_COLORS[i] : "";
    span.classList.toggle("current", i === zone);
  });
  $("zone-name").textContent = `Z${zone + 1} ${ZONES[zone].name}`;
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

$("zone-scale").innerHTML = "<span></span>".repeat(ZONES.length);
buildRows("rolling");
buildRows("records");
setAutoPause(autoPause);
setChartMode(chartMode);
reset();
if (!navigator.bluetooth) {
  $("connect").disabled = true;
  message = "Ce navigateur ne gère pas le Bluetooth. Ouvre cette page dans Google Chrome ou Microsoft Edge sur un ordinateur. Sous Linux, active d'abord l'option « Experimental Web Platform features » dans chrome://flags.";
  renderLive();
}
