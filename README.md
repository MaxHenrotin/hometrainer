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
4. Start pedalling. The clock only starts with your first pedal stroke, and the ride pauses by itself once the trainer has reported a cadence of 0 for a second. It picks up again as soon as you pedal. Some trainers take a while to notice you've stopped: the Suito keeps showing your last cadence for about 5 seconds, so its rides pause about 6 seconds after you stop.
5. Click **Terminer la séance** when you're done.

While you ride, the big number is your power averaged over 3 seconds, because the raw value jumps around too much to read. Under the main readings, a smaller section shows the session's average and max power and the calories burnt, your rolling average power over the last 15 s, 1, 2, 3, 5, 10, 20 and 45 min, and your best efforts so far. A chart shows the last 10 minutes.

Two fields at the top are optional. With your weight, the page adds watts per kilo. With your FTP (the power you can hold for about an hour), the big number and the chart take the colour of your power zone, from Z1 (recovery) to Z7 (sprint), and the summary shows the time spent in each zone. Your browser remembers both values, and they never leave it.

If the Bluetooth connection drops, the ride pauses and the page keeps trying to reconnect. The screen stays awake for the whole ride, and the page asks for confirmation if you try to close the tab before downloading your ride.

## After the ride

The summary shows moving time, distance, average speed, cadence and power, max power, calories, your best efforts over 5 s, 15 s, 1 min, 5 min, 10 min, 20 min and 1 h, and the time in each zone if you entered an FTP. You can download three files:

- **Télécharger l'image**: a PNG recap of the ride, sized for sharing on a phone.
- **Importer sur Strava**: downloads a `.fit` file with power, cadence and speed, and opens Strava's upload page in a new tab, where you pick the file. Strava files it as a **Virtual Ride**, which counts in your profile totals (pick "all rides" on the weekly widget to see it there).

  Getting the ride right on Strava took a few tries, because Strava fills in what an indoor file lacks on its own terms:
  - It only works out moving time from GPS data. Without a route, every pause counts as riding time, even with the pauses written in the file. So, like Zwift with its virtual worlds, the file gives the ride a made-up route: a 100 km organic loop around Isla Incahuasi on the Salar de Uyuni in Bolivia. The position stands still during pauses, which Strava counts as stopped.
  - For a regular ride, it takes the time zone and the elevation from the place on the map, so a ride in Bolivia would show up 6 hours early with made-up climbing. A virtual ride keeps the computer's local time and the flat elevation written in the file, and is never matched against real segments.
  - The Salar is the flattest place on Earth, and every point of the loop was checked against SRTM elevation data to stay on the salt.

  Strava uses the distance from the file, not the length of the route, so the made-up route never changes your kilometres. Power, cadence and speed stay exactly as measured.
- **Données CSV**: every reading, one row per update from the trainer (about one per second), without the paused parts:

```
time_s,speed_kmh,cadence_rpm,power_w,distance_km
1.0,30.12,90,205,0.008
```

`time_s` is moving time. Power, speed and cadence come straight from the trainer. Distance is computed from speed, so it starts at zero for each ride. The trainer's own odometer doesn't reset between rides, which is why the page doesn't use it.

## Running it yourself

It's plain HTML, CSS and JavaScript modules, with no build step and nothing to install. Because of the modules, opening `index.html` straight from the file system doesn't work. Clone the repo and serve the folder instead:

```
git clone https://github.com/MaxHenrotin/hometrainer.git
cd hometrainer
python3 -m http.server
```

Then open http://localhost:8000 in Chrome. Web Bluetooth only works on HTTPS pages and on localhost.

## How it works

Smart trainers expose the Bluetooth Fitness Machine Service (FTMS, UUID `0x1826`). The page subscribes to its Indoor Bike Data characteristic (`0x2AD2`). The trainer sends a small packet about once a second, with a flags field saying which values the packet contains. The page reads instant speed, cadence and power, and skips the rest.

The code is split by job:

- `js/trainer.js` handles the Bluetooth connection, decodes the packets and reconnects after a drop
- `js/ride.js` holds the ride logic: auto-pause, totals, 3-second power, rolling averages, best efforts
- `js/zones.js` defines the seven power zones and adds up the time spent in each
- `js/charts.js` draws the live chart and the best-efforts curve on a canvas
- `js/route.js` holds the virtual loop on the Salar de Uyuni
- `js/exports.js` builds the CSV, the FIT file (with Garmin's FIT SDK, loaded from a CDN on demand) and the recap image
- `js/app.js` wires all of it to the page
