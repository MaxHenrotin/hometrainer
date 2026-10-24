import { drawPowerCurve, drawPowerLine, fitCanvas } from "./charts.js";
import { csv, download, recapImage, tcx } from "./exports.js";
import { duration, number } from "./format.js";
import { Ride } from "./ride.js";
import { Trainer } from "./trainer.js";

const LIVE_WINDOW = 600;  // seconds of riding shown on the live chart
const HINTS = {
  idle: "Pédale quelques secondes pour réveiller le home-trainer avant de te connecter.",
  riding: "La séance démarre au premier coup de pédale et se met en pause toute seule quand tu t'arrêtes.",
  summary: "Pour Strava : sur strava.com, clique sur + puis « Importer une activité » et choisis le fichier .tcx.",
};

const $ = (id) => document.getElementById(id);
let trainer = null;
let ride = new Ride();
let reconnecting = false;
let wakeLock = null;

// The weight is optional and only remembered by this browser
const weightInput = $("weight");
try { weightInput.value = localStorage.getItem("weight") ?? ""; } catch { /* storage blocked: the field just starts empty */ }
const weight = () => Number(weightInput.value) || null;
const wkg = (power) => (weight() ? number(power / weight(), 1) : "?");

function colors() {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(["bg", "ink", "muted", "line", "red"].map((name) => [name, style.getPropertyValue(`--${name}`).trim()]));
}

function status() {
  if (!trainer?.active) return "Pas connecté";
  if (reconnecting) return "Connexion perdue, reconnexion…";
  return { waiting: "Connecté. Pédale pour démarrer", riding: `Connecté à ${trainer.name}`, paused: "En pause. Pédale pour reprendre" }[ride.state];
}

function renderLive() {
  $("power").textContent = number(ride.displayPower);
  $("wkg").textContent = wkg(ride.displayPower);
  $("speed").textContent = number(ride.speed, 1);
  $("cadence").textContent = number(ride.cadence);
  $("distance").textContent = number(ride.distance, 2);
  $("duration").textContent = duration(ride.time);
  $("status").textContent = status();
  document.body.dataset.state = reconnecting ? "paused" : ride.state;

  const { ctx, box } = fitCanvas($("live-chart"));
  const from = Math.max(0, ride.time - LIVE_WINDOW);
  drawPowerLine(ctx, box, ride.samples, colors(), from, from + LIVE_WINDOW);
}

function renderSummary() {
  const summary = ride.summary();
  $("s-power").textContent = number(summary.power);
  $("s-wkg").textContent = wkg(summary.power);
  $("s-duration").textContent = duration(summary.time);
  $("s-distance").textContent = number(summary.distance, 2);
  $("s-speed").textContent = number(summary.speed, 1);
  $("s-cadence").textContent = number(summary.cadence);
  $("s-max").textContent = number(summary.maxPower);
  $("s-energy").textContent = number(summary.energy);
  $("status").textContent = "Séance terminée";

  // The curve starts at 5 s, so a shorter ride has nothing to draw
  $("curve-chart").hidden = $("curve-label").hidden = !summary.curve.length;
  if (summary.curve.length) {
    const { ctx, box } = fitCanvas($("curve-chart"));
    drawPowerCurve(ctx, box, summary.curve, colors());
  }
}

const render = () => ($("summary").hidden ? renderLive() : renderSummary());

function show(...ids) {
  for (const id of ["connect", "stop", "png", "tcx", "csv", "restart"]) $(id).hidden = !ids.includes(id);
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
  show("png", "tcx", "csv", "restart");
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
$("stop").addEventListener("click", finish);
$("restart").addEventListener("click", reset);
$("csv").addEventListener("click", () => download(csv(ride), fileName("csv")));
$("tcx").addEventListener("click", () => download(tcx(ride), fileName("tcx")));
$("png").addEventListener("click", async () => download(await recapImage(ride, weight()), fileName("png")));

weightInput.addEventListener("input", () => {
  try { localStorage.setItem("weight", weightInput.value); } catch { /* the weight just won't be remembered */ }
  render();
});
addEventListener("resize", render);

// Ask before closing the tab during a ride or on its summary, so a ride isn't lost before it's downloaded
addEventListener("beforeunload", (event) => {
  if (ride.time > 0) event.preventDefault();
});

// The browser drops the wake lock when the tab is hidden; take it back when the person returns
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && trainer?.active && (!wakeLock || wakeLock.released)) keepScreenOn();
});

reset();
if (!navigator.bluetooth) {
  $("connect").disabled = true;
  $("message").textContent = "Ce navigateur ne gère pas le Bluetooth. Ouvre cette page dans Google Chrome ou Microsoft Edge sur un ordinateur. Sous Linux, active d'abord l'option « Experimental Web Platform features » dans chrome://flags.";
}
