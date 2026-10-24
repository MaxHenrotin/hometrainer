import { drawPowerBars, drawPowerCurve, fitCanvas } from "./charts.js";
import { csv, download, fit, recapImage } from "./exports.js";
import { duration, durationLabel, number } from "./format.js";
import { RECORD_DURATIONS, Ride } from "./ride.js";
import { Trainer } from "./trainer.js";
import { ZONES, zoneIndex, zoneTimes } from "./zones.js";

const LIVE_WINDOW = 600;  // seconds of riding shown on the live chart
const ROLLING_DURATIONS = [15, 60, 120, 180, 300, 600, 1200, 2700];
const STRAVA_UPLOAD = "https://www.strava.com/upload/select";
const HINTS = {
  idle: "Pédale quelques secondes pour réveiller le home-trainer avant de te connecter.",
  riding: "La séance démarre au premier coup de pédale et se met en pause toute seule quand tu t'arrêtes.",
  summary: "« Importer sur Strava » télécharge le fichier .fit et ouvre la page d'import de Strava : il ne reste qu'à y choisir ce fichier.",
};

const $ = (id) => document.getElementById(id);
let trainer = null;
let ride = new Ride();
let reconnecting = false;
let wakeLock = null;

// Weight and FTP are optional, only remembered by this browser, and anything
// that depends on them stays hidden while they're empty
const settings = { weight: $("weight"), ftp: $("ftp") };
for (const [name, input] of Object.entries(settings)) {
  try { input.value = localStorage.getItem(name) ?? ""; } catch { /* storage blocked: the field just starts empty */ }
  input.addEventListener("input", () => {
    try { localStorage.setItem(name, input.value); } catch { /* the value just won't be remembered */ }
    render();
  });
}
const weight = () => Number(settings.weight.value) || null;
const ftp = () => Number(settings.ftp.value) || null;

function showWkg(id, power) {
  $(`${id}-box`).hidden = !weight();
  if (weight()) $(id).textContent = number(power / weight(), 1);
}

function colors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name) => style.getPropertyValue(`--${name}`).trim();
  return {
    ...Object.fromEntries(["bg", "ink", "muted", "line", "red"].map((name) => [name, read(name)])),
    zones: ZONES.map((_, i) => read(`z${i + 1}`)),
  };
}

// One small cell per duration for the rolling averages and the records, filled on every update
function buildCells(id, durations) {
  $(id).innerHTML = durations.map((d) => `<div><dt>${durationLabel(d)}</dt><dd><output></output><small>W</small></dd></div>`).join("");
}

function fillCells(id, durations, value) {
  $(id).querySelectorAll("output").forEach((output, i) => {
    const watts = value(durations[i]);
    output.textContent = watts === null ? "–" : number(watts);
  });
}

function status() {
  if (!trainer?.active) return "Pas connecté";
  return reconnecting ? "Déconnecté" : `Connecté à ${trainer.name}`;
}

// Why the clock isn't running, shown big above the power so it reads from the saddle
function banner() {
  if (!trainer?.active) return "";
  if (reconnecting) return "Bluetooth déconnecté. En attente de reconnexion pour reprendre…";
  return { waiting: "Pédale pour démarrer", riding: "", paused: "En pause. Pédale pour reprendre" }[ride.state];
}

function renderLive() {
  const palette = colors();
  const colorOf = (power) => (ftp() ? palette.zones[zoneIndex(power, ftp())] : palette.red);
  const power = ride.displayPower;
  $("power").textContent = number(power);
  $("power").style.color = ftp() ? colorOf(power) : "";
  showWkg("wkg", power);
  $("zone").hidden = !ftp();
  if (ftp()) {
    const zone = zoneIndex(power, ftp());
    $("zone").textContent = `Z${zone + 1} ${ZONES[zone].name}`;
    $("zone").style.color = palette.zones[zone];
  }
  $("speed").textContent = number(ride.speed, 1);
  $("cadence").textContent = number(ride.cadence);
  $("distance").textContent = number(ride.distance, 2);
  $("duration").textContent = duration(ride.time);
  $("avg").textContent = number(ride.averagePower);
  $("max").textContent = number(ride.maxPower);
  $("kcal").textContent = number(ride.calories);
  fillCells("rolling", ROLLING_DURATIONS, (d) => ride.average(d));
  fillCells("records", RECORD_DURATIONS, (d) => ride.records.get(d) ?? null);
  $("status").textContent = status();
  $("banner").textContent = banner();
  $("banner").classList.toggle("bluetooth", reconnecting);
  $("banner").classList.toggle("paused", !reconnecting && ride.state === "paused");
  document.body.dataset.state = reconnecting ? "paused" : ride.state;

  const { ctx, box } = fitCanvas($("live-chart"));
  const from = Math.max(0, ride.time - LIVE_WINDOW);
  drawPowerBars(ctx, box, ride.samples, palette, from, from + LIVE_WINDOW, colorOf);
}

function renderSummary() {
  const summary = ride.summary();
  $("s-power").textContent = number(summary.power);
  showWkg("s-wkg", summary.power);
  $("s-duration").textContent = duration(summary.time);
  $("s-distance").textContent = number(summary.distance, 2);
  $("s-speed").textContent = number(summary.speed, 1);
  $("s-cadence").textContent = number(summary.cadence);
  $("s-max").textContent = number(summary.maxPower);
  $("s-calories").textContent = number(summary.calories);
  $("status").textContent = "Séance terminée";

  // The curve starts at 5 s, so a shorter ride has nothing to draw
  $("curve-chart").hidden = $("curve-label").hidden = !summary.curve.length;
  if (summary.curve.length) {
    const { ctx, box } = fitCanvas($("curve-chart"));
    drawPowerCurve(ctx, box, summary.curve, colors());
  }

  $("zones-box").hidden = !ftp();
  if (ftp()) {
    const times = zoneTimes(ride.samples, ftp());
    const total = times.reduce((a, b) => a + b, 0) || 1;
    $("zones").innerHTML = ZONES.map((zone, i) => {
      const share = times[i] / total * 100;
      return `<li><span>Z${i + 1} ${zone.name}</span><span class="bar"><span style="width: ${share}%; background: var(--z${i + 1})"></span></span>`
        + `<span>${duration(times[i])}</span><span class="share">${Math.round(share)} %</span></li>`;
    }).join("");
  }
}

const render = () => ($("summary").hidden ? renderLive() : renderSummary());

function show(...ids) {
  for (const id of ["connect", "stop", "png", "strava", "csv", "restart"]) $(id).hidden = !ids.includes(id);
}

async function keepScreenOn() {
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch { /* not critical: the ride still records */ }
}

async function connect() {
  $("message").textContent = "";
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
      $("message").textContent = `Connexion impossible : ${error.message}. Vérifie que Zwift ou l'app Elite ne sont pas déjà connectés au home-trainer.`;
    }
    return;
  } finally {
    $("connect").disabled = false;
  }
  show("stop");
  $("hint").textContent = HINTS.riding;
  renderLive();
  keepScreenOn();
}

function finish() {
  trainer.disconnect();
  reconnecting = false;
  wakeLock?.release();
  if (ride.time < 1) {
    reset();
    $("message").textContent = "Aucune donnée enregistrée : la séance démarre au premier coup de pédale.";
    return;
  }
  $("live").hidden = true;
  $("summary").hidden = false;
  show("png", "strava", "csv", "restart");
  $("hint").textContent = HINTS.summary;
  document.body.dataset.state = "";
  renderSummary();
}

function reset() {
  trainer = null;
  ride = new Ride();
  $("summary").hidden = true;
  $("live").hidden = false;
  $("message").textContent = "";
  $("hint").textContent = HINTS.idle;
  show("connect");
  renderLive();
}

function fileName(extension) {
  const d = ride.startedAt;
  const pad = (n) => String(n).padStart(2, "0");
  return `hometrainer_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.${extension}`;
}

$("connect").addEventListener("click", connect);
// Both buttons throw away something that can't be brought back, so a stray click must not be enough.
// A ride with nothing recorded yet has nothing to lose.
$("stop").addEventListener("click", () => {
  if (ride.time < 1 || confirm("Terminer la séance ? Tu ne pourras plus la reprendre.")) finish();
});
$("restart").addEventListener("click", () => {
  if (confirm("Commencer une nouvelle séance ? Celle-ci disparaîtra de la page : télécharge d'abord les fichiers que tu veux garder.")) reset();
});
$("csv").addEventListener("click", () => download(csv(ride), fileName("csv")));
$("strava").addEventListener("click", async () => {
  // The tab opens first: after the wait for the SDK, the browser would no longer count it as a click and block it
  open(STRAVA_UPLOAD, "_blank", "noopener");
  download(await fit(ride), fileName("fit"));
});
$("png").addEventListener("click", async () => download(await recapImage(ride, weight()), fileName("png")));

addEventListener("resize", render);

// Ask before closing the tab during a ride or on its summary, so a ride isn't lost before it's downloaded
addEventListener("beforeunload", (event) => {
  if (ride.time > 0) event.preventDefault();
});

// The browser drops the wake lock when the tab is hidden; take it back when the person returns
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && trainer?.active && (!wakeLock || wakeLock.released)) keepScreenOn();
});

buildCells("rolling", ROLLING_DURATIONS);
buildCells("records", RECORD_DURATIONS);
reset();
if (!navigator.bluetooth) {
  $("connect").disabled = true;
  $("message").textContent = "Ce navigateur ne gère pas le Bluetooth. Ouvre cette page dans Google Chrome ou Microsoft Edge sur un ordinateur. Sous Linux, active d'abord l'option « Experimental Web Platform features » dans chrome://flags.";
}
