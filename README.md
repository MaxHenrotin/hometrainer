# Hometrainer

A single web page that connects to a smart bike trainer over Bluetooth, shows your power, speed and cadence while you ride, and gives you the ride as a CSV file at the end. You don't need an account or a subscription, and there's nothing to install.

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
4. Ride. The page keeps the screen awake so the laptop doesn't go to sleep halfway through.
5. Click **Terminer la séance** to see your averages, then **Télécharger le CSV** to keep the ride.

The CSV has one row per update from the trainer, about one per second:

```
time_s,speed_kmh,cadence_rpm,power_w,distance_km
1.0,30.12,90,205,0.008
```

Power, speed and cadence come straight from the trainer. Distance is computed from speed, so it starts at zero for each ride. The trainer's own odometer doesn't reset between rides, which is why the page doesn't use it.

## Running it yourself

Everything is in `index.html`, with no build step and no dependencies. Clone the repo and serve the folder locally:

```
git clone https://github.com/MaxHenrotin/hometrainer.git
cd hometrainer
python3 -m http.server
```

Then open http://localhost:8000 in Chrome. Web Bluetooth only works on HTTPS pages and on localhost.

## Terminal version

`ride.py` does the same thing from a terminal: it prints a live line and saves each ride to `rides/`. I tested it on Ubuntu.

```
conda env create -f environment.yml
conda activate hometrainer
python ride.py
```

Press Ctrl+C to stop. The ride summary is printed and the CSV is written to `rides/`.

## How it works

Smart trainers expose the Bluetooth Fitness Machine Service (FTMS, UUID `0x1826`). The page subscribes to its Indoor Bike Data characteristic (`0x2AD2`). The trainer sends a small packet about once a second, with a flags field saying which values the packet contains. The page reads instant speed, cadence and power, and skips the rest.
