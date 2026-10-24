"""Record speed, power and distance from a Bluetooth smart trainer (FTMS) to a CSV file.

Run it, pedal, and press Ctrl+C when you are done.
"""

import asyncio
import csv
import struct
import time
from datetime import datetime
from pathlib import Path

from bleak import BleakClient, BleakScanner

FTMS_SERVICE = "00001826-0000-1000-8000-00805f9b34fb"
INDOOR_BIKE_DATA = "00002ad2-0000-1000-8000-00805f9b34fb"
RIDES_DIR = Path(__file__).parent / "rides"


def parse_indoor_bike_data(data):
    """Decode speed, cadence and power from an FTMS Indoor Bike Data packet.

    Each flag bit says whether a field is in the packet. Fields we don't use
    still have to be skipped to find the offset of the next one.
    """
    flags = struct.unpack_from("<H", data)[0]
    offset = 2
    values = {}
    if not flags & 0x01:  # this bit is inverted: 0 means speed is present
        values["speed"] = struct.unpack_from("<H", data, offset)[0] / 100
        offset += 2
    if flags & 0x02:  # average speed
        offset += 2
    if flags & 0x04:
        values["cadence"] = struct.unpack_from("<H", data, offset)[0] / 2
        offset += 2
    if flags & 0x08:  # average cadence
        offset += 2
    if flags & 0x10:  # total distance, we compute our own from speed
        offset += 3
    if flags & 0x20:  # resistance level
        offset += 2
    if flags & 0x40:
        values["power"] = struct.unpack_from("<h", data, offset)[0]
    return values


class Ride:
    def __init__(self, path):
        self.path = path
        self.file = path.open("w", newline="")
        self.csv = csv.writer(self.file)
        self.csv.writerow(["time_s", "speed_kmh", "cadence_rpm", "power_w", "distance_km"])
        self.start = self.last = time.monotonic()
        self.speed = self.cadence = self.power = 0
        self.distance = 0.0
        self.energy = 0.0  # joules, gives the average power at the end

    def update(self, data):
        now = time.monotonic()
        dt = now - self.last
        self.distance += self.speed * dt / 3600
        self.energy += self.power * dt
        self.last = now

        values = parse_indoor_bike_data(data)
        self.speed = values.get("speed", self.speed)
        self.cadence = values.get("cadence", self.cadence)
        self.power = values.get("power", self.power)

        elapsed = now - self.start
        self.csv.writerow([round(elapsed, 1), self.speed, self.cadence, self.power, round(self.distance, 3)])
        print(
            f"\r{format_duration(elapsed)}  {self.speed:5.1f} km/h  {self.power:4d} W  "
            f"{self.cadence:5.1f} rpm  {self.distance:6.2f} km",
            end="",
            flush=True,
        )

    def finish(self):
        self.file.close()
        elapsed = self.last - self.start
        if elapsed == 0:
            self.path.unlink()
            print("\nNo data received, nothing saved.")
            return
        print(
            f"\n\nDuration       {format_duration(elapsed)}\n"
            f"Distance       {self.distance:.2f} km\n"
            f"Average speed  {self.distance / elapsed * 3600:.1f} km/h\n"
            f"Average power  {self.energy / elapsed:.0f} W\n"
            f"Saved to {self.path}"
        )


def format_duration(seconds):
    minutes, seconds = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}"


async def main():
    print("Looking for the trainer, pedal a bit to wake it up...")
    device = await BleakScanner.find_device_by_filter(
        lambda _, adv: FTMS_SERVICE in adv.service_uuids, timeout=30
    )
    if device is None:
        raise SystemExit("No trainer found. Is it awake, and closed in Zwift or the Elite app?")

    RIDES_DIR.mkdir(exist_ok=True)
    ride = Ride(RIDES_DIR / f"{datetime.now():%Y-%m-%d_%H-%M}.csv")
    disconnected = asyncio.Event()
    try:
        async with BleakClient(device, disconnected_callback=lambda _: disconnected.set()) as client:
            await client.start_notify(INDOOR_BIKE_DATA, lambda _, data: ride.update(data))
            print(f"Connected to {device.name}. Press Ctrl+C to stop.\n")
            await disconnected.wait()
            print("\nTrainer disconnected.")
    finally:
        ride.finish()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
