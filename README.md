<h1>
  <img src="assets/wattamax-icon-light.svg" alt="" height="56">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wattamax-wordmark-white.svg">
    <img src="assets/wattamax-wordmark.svg" alt="Wattamax" height="28">
  </picture>
</h1>

A web page that connects to a smart bike trainer over Bluetooth and shows your power, speed and cadence while you ride. At the end you get a summary, a recap image, and files for Strava or your own analysis. You don't need an account or a subscription, and there's nothing to install.

**Use it here: https://wattamax.com**

I wrote it because I only wanted to see my watts on my Elite Suito, and paying for Zwift or Rouvy just for that felt silly. It has only been tested with a Suito, but it should work with any trainer that supports Bluetooth FTMS, which covers most smart trainers sold in the last few years (Wahoo Kickr, Tacx Neo and Flux, Elite Direto and Justo, Saris H3...).

## Which browser?

The page relies on Web Bluetooth, and only Chromium-based browsers implement it.

| Browser | Works? |
| --- | --- |
| Chrome, Edge or Opera on Windows, macOS, ChromeOS | Yes |
| Chrome on Linux | Yes, after enabling `chrome://flags/#enable-experimental-web-platform-features` |
| Chrome on Android | Should work, not tested yet |
| Firefox, Safari | No |
| Any browser on iPhone or iPad | No. The Bluefy browser app from the App Store is a workaround |

## Riding

1. Close Zwift, the Elite app or anything else connected to the trainer. It only accepts one Bluetooth connection at a time.
2. Pedal for a few seconds to wake the trainer up.
3. Click **Connecter le home-trainer** and pick your trainer in the list.
4. Start pedalling. The clock only starts with your first pedal stroke, and the ride pauses by itself once the trainer has reported a cadence of 0 for a second. It picks up again as soon as you pedal. Some trainers take a while to notice you've stopped: the Suito keeps showing your last cadence for about 5 seconds, so its rides pause about 6 seconds after you stop. Turn **Pause auto** off at the top if you'd rather keep the clock running.
5. Hold **Maintenir pour terminer** for 2 seconds when you're done. Holding the button replaces a confirmation dialog, so a stray click can't end your ride.

While you ride, the top row shows your power, cadence and speed, each with its average for the ride just below. The power is averaged over 3 seconds, because the raw value jumps around too much to read. The speed is the one you'd ride at on a flat road with that power (see [How it works](#how-it-works)). On the right are the distance, the moving time, and one row per duration (5 s, 15 s, 1, 2, 3, 5, 10, 20 and 45 min) with your rolling average power and, in a paler bar behind it, the best you've done over that duration so far. There's no 1 s row on this screen, because it flickered too much to read; your max power shows under the power figure instead, next to the zone and W/kg. The summary keeps the 1 s best. The chart shows the last 10 minutes in 5-second bars, or the whole ride if you pick **Total** in its corner.

On a computer you can rearrange the ride screen to taste. Drag the edge or corner between two cards to resize them: the numbers grow or shrink to fill the card, and stack on top of each other once the card is tall enough for that to make them bigger. Press a card and drag it over another one to swap them. Reloading the page brings the default layout back. Messages like "Pédale pour démarrer" or a lost connection float in the middle of the screen, and the small button in their corner tucks them into the top bar, where a click brings them back.

Two fields at the top are optional. With your weight, the page adds watts per kilo and uses it to simulate your speed (it assumes 75 kg otherwise). With your FTP (the power you can hold for about an hour), the bars and the power figure take the colour of your power zone, from Z1 (recovery) to Z7 (sprint), the zone name shows under the figures, and the summary shows the time spent in each zone. Both fields pulse red until you fill them in. Your browser remembers both values, along with the two switches, and nothing leaves it.

If the Bluetooth connection drops, the ride pauses and the page keeps trying to reconnect. The screen stays awake for the whole ride, and the page asks for confirmation if you try to close the tab before downloading your ride.

## After the ride

The summary mirrors the ride screen: average power, cadence and speed, a chart of the whole ride, the time in each zone if you entered an FTP, the distance, moving time, total time (pauses included) and calories, and your best effort over each duration. You can download three files, and holding **Maintenir pour recommencer** starts a new ride:

- **Image**: a PNG recap of the ride, sized for sharing on a phone.
- **Importer sur Strava**: downloads a `.fit` file with power, cadence and speed, and opens Strava's upload page in a new tab, where you pick the file. Strava files it as a **Virtual Ride**, which counts in your profile totals (pick "all rides" on the weekly widget to see it there).

  Getting the ride right on Strava took a few tries, because Strava fills in what an indoor file lacks on its own terms:
  - It only works out moving time from GPS data. Without a route, every pause counts as riding time, even with the pauses written in the file. So, like Zwift with its virtual worlds, the file gives the ride a made-up route on the Salar de Uyuni in Bolivia, centred on Isla Incahuasi. The route is a drawing scaled to the ride's length, so every ride draws it once from start to finish. For now it always writes WATTAMAX.COM. The other drawings in the code trace an organic loop, the TT, the wordmark, a bike or a heart. The position stands still during pauses, which Strava counts as stopped.
  - For a regular ride, it takes the time zone and the elevation from the place on the map, so a ride in Bolivia would show up 6 hours early with made-up climbing. A virtual ride keeps the computer's local time and the flat elevation written in the file, and is never matched against real segments.
  - The Salar is the flattest place on Earth. A drawing grows with the ride, so a very long ride can spill past the edge of the salt on the map, but the elevation always comes from the file and stays flat.

  Strava uses the distance from the file, not the length of the route, so the made-up route never changes your kilometres. Power, cadence and speed stay as recorded.
- **CSV**: every reading, one row per update from the trainer (about one per second), without the paused parts:

```
time_s,speed_kmh,cadence_rpm,power_w,distance_km
1.0,30.12,90,205,0.008
```

`time_s` is moving time. Power and cadence come straight from the trainer, speed is simulated from power, and distance is computed from speed, so it starts at zero for each ride. The trainer's own odometer doesn't reset between rides, which is why the page doesn't use it.

## Running it yourself

It's plain HTML, CSS and JavaScript modules, with no build step and nothing to install. Because of the modules, opening `index.html` straight from the file system doesn't work. Clone the repo and serve the folder instead:

```
git clone https://github.com/MaxHenrotin/wattamax.git
cd wattamax
python3 -m http.server
```

Then open http://localhost:8000 in Chrome. Web Bluetooth only works on HTTPS pages and on localhost.

## How it works

Smart trainers expose the Bluetooth Fitness Machine Service (FTMS, UUID `0x1826`). The page subscribes to its Indoor Bike Data characteristic (`0x2AD2`). The trainer sends a small packet about once a second, with a flags field saying which values the packet contains. The page reads cadence and power, and skips the rest.

It ignores the trainer's speed too. Without an app setting its resistance, the trainer only reports how fast its flywheel spins, which depends on your gear and cadence rather than your power: on one test ride, 161 W averaged 22.9 km/h, where a flat road gives about 30. Like Zwift, the page works out the speed from your power instead, using the model of Martin et al. (1998). On every packet, the power that reaches the wheel, minus rolling resistance and air drag, goes into kinetic energy. The speed therefore builds up and dies down over a few seconds, as on a real bike. The model assumes no wind and no slope, an 8 kg bike, a drag area of 0.32 m² (seated on the hoods), a rolling resistance of 0.004 and a drivetrain efficiency of 97.6 %. After a pause you set off again from standstill.

The code is split by job:

- `js/trainer.js` handles the Bluetooth connection, decodes the packets and reconnects after a drop
- `js/ride.js` holds the ride logic: auto-pause, simulated speed, totals, 3-second power, rolling averages, best efforts
- `js/zones.js` defines the seven power zones and adds up the time spent in each
- `js/charts.js` draws the bar charts on a canvas
- `js/route.js` holds the drawings the virtual route follows on the Salar de Uyuni (`js/outlines.js`, generated with the logos, holds the outlines of the TT and the wordmark)
- `js/exports.js` builds the CSV, the FIT file (with Garmin's FIT SDK, loaded from a CDN on demand) and the recap image
- `js/app.js` wires all of it to the page
