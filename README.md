# Hometrainer

A web page that connects to a smart bike trainer over Bluetooth and shows your power, speed and cadence while you ride. At the end you get a summary, a recap image, and files for Strava or your own analysis. You don't need an account or a subscription, and there's nothing to install.

**Use it here: https://hometrainer.vercel.app**

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
4. Start pedalling. The clock only starts with your first pedal stroke, and the ride pauses by itself when you stop pedalling for 3 seconds. It picks up again as soon as you pedal.
5. Click **Terminer la séance** when you're done.

While you ride, the big number is your power averaged over 3 seconds, because the raw value jumps around too much to read. Below it there's a chart of the last 10 minutes. If you enter your weight at the top, the page also shows watts per kilo. The weight is remembered by your browser and never leaves it.

If the Bluetooth connection drops, the ride pauses and the page keeps trying to reconnect. The screen stays awake for the whole ride, and the page asks for confirmation if you try to close the tab before downloading your ride.

## After the ride

The summary shows moving time, distance, average speed, cadence and power, max power, energy, and your best efforts over 5 s, 15 s, 1 min, 5 min, 10 min and 20 min. You can download three files:

- **Télécharger l'image**: a PNG recap of the ride, sized for sharing on a phone.
- **Importer sur Strava**: downloads a `.tcx` file with power, cadence and speed, and opens Strava's upload page in a new tab, where you pick the file. Pauses show up as gaps, so Strava gets the moving time right.
- **Données CSV**: every reading, one row per update from the trainer (about one per second), without the paused parts:

```
time_s,speed_kmh,cadence_rpm,power_w,distance_km
1.0,30.12,90,205,0.008
```

`time_s` is moving time. Power, speed and cadence come straight from the trainer. Distance is computed from speed, so it starts at zero for each ride. The trainer's own odometer doesn't reset between rides, which is why the page doesn't use it.

## Running it yourself

It's plain HTML, CSS and JavaScript modules, with no build step and no dependencies. Because of the modules, opening `index.html` straight from the file system doesn't work. Clone the repo and serve the folder instead:

```
git clone https://github.com/MaxHenrotin/hometrainer.git
cd hometrainer
python3 -m http.server
```

Then open http://localhost:8000 in Chrome. Web Bluetooth only works on HTTPS pages and on localhost.

## Terminal version

`ride.py` is the first version of the project, a simpler recorder for the terminal. It prints a live line and saves each ride as a CSV in `rides/`, but it has no auto-pause and none of the exports. I tested it on Ubuntu.

```
conda env create -f environment.yml
conda activate hometrainer
python ride.py
```

Press Ctrl+C to stop. The ride summary is printed and the CSV is written to `rides/`.

## How it works

Smart trainers expose the Bluetooth Fitness Machine Service (FTMS, UUID `0x1826`). The page subscribes to its Indoor Bike Data characteristic (`0x2AD2`). The trainer sends a small packet about once a second, with a flags field saying which values the packet contains. The page reads instant speed, cadence and power, and skips the rest.

The code is split by job:

- `js/trainer.js` handles the Bluetooth connection, decodes the packets and reconnects after a drop
- `js/ride.js` holds the ride logic: auto-pause, totals, 3-second power, best efforts
- `js/charts.js` draws the live chart and the best-efforts curve on a canvas
- `js/exports.js` builds the CSV, the TCX and the recap image
- `js/app.js` wires all of it to the page
