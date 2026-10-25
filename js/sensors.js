const FTMS_SERVICE = 0x1826;
const INDOOR_BIKE_DATA = 0x2ad2;
const HEART_RATE_SERVICE = 0x180d;
const HEART_RATE_MEASUREMENT = 0x2a37;
const RECONNECT_DELAY = 2000;
const HEART_RATE_TIMEOUT = 5000;  // a strap sends about once a second

// Decode cadence and power from an FTMS Indoor Bike Data packet.
// Each flag bit says whether a field is present; unused fields still have to be skipped.
function parseIndoorBikeData(view) {
  const flags = view.getUint16(0, true);
  let offset = 2;
  const values = {};
  if (!(flags & 0x01)) offset += 2;  // speed, the ride simulates its own (inverted bit: 0 means present)
  if (flags & 0x02) offset += 2;  // average speed
  if (flags & 0x04) { values.cadence = view.getUint16(offset, true) / 2; offset += 2; }
  if (flags & 0x08) offset += 2;  // average cadence
  if (flags & 0x10) offset += 3;  // total distance, the ride computes its own
  if (flags & 0x20) offset += 2;  // resistance level
  if (flags & 0x40) values.power = view.getInt16(offset, true);
  return values;
}

// Decode the beats per minute from a Heart Rate Measurement packet: the first flag bit says
// whether they take one byte or two. A strap taken off can keep sending packets, and the next two
// bits then say it detects skin contact but has none.
function parseHeartRate(view) {
  const flags = view.getUint8(0);
  if ((flags & 0x06) === 0x04) return { heartRate: null };
  return { heartRate: flags & 0x01 ? view.getUint16(1, true) : view.getUint8(1) };
}

// A Bluetooth device sending its readings on one characteristic. If the connection drops, it keeps
// trying to reconnect until disconnect() is called.
class Sensor {
  active = false;

  constructor(service, characteristic, parse, onData, onConnectionChange) {
    Object.assign(this, { service, characteristic, parse, onData, onConnectionChange });
  }

  get name() {
    return this.device.name;
  }

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [this.service] }] });
    await this.#subscribe();
    this.active = true;
    this.device.addEventListener("gattserverdisconnected", () => this.#reconnect());
  }

  disconnect() {
    this.active = false;
    if (this.device.gatt.connected) this.device.gatt.disconnect();
  }

  async #subscribe() {
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(this.service);
    const characteristic = await service.getCharacteristic(this.characteristic);
    // Bluefy on iPhone and iPad ignores the oncharacteristicvaluechanged property, only listeners get the values
    characteristic.addEventListener("characteristicvaluechanged", this.#onValue);
    await characteristic.startNotifications();
  }

  // One shared function, so subscribing again after a reconnection doesn't add a second listener
  #onValue = (event) => this.onData(this.parse(event.target.value));

  async #reconnect() {
    if (!this.active) return;
    this.onConnectionChange(false);
    while (this.active) {
      try {
        await this.#subscribe();
        if (this.active) this.onConnectionChange(true);
        else this.device.gatt.disconnect();  // the ride was ended while this attempt was running
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY));
      }
    }
  }
}

// A smart trainer, through the Fitness Machine Service
export class Trainer extends Sensor {
  constructor(onData, onConnectionChange) {
    super(FTMS_SERVICE, INDOOR_BIKE_DATA, parseIndoorBikeData, onData, onConnectionChange);
  }
}

// A heart rate strap, through the standard Heart Rate Service. Some straps taken off stay connected
// for a minute or two but stop sending, so the heart rate is lost after a few seconds of silence.
export class HeartRateMonitor extends Sensor {
  #silence;

  constructor(onData, onConnectionChange) {
    super(HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT, parseHeartRate, (values) => {
      clearTimeout(this.#silence);
      this.#silence = setTimeout(() => onData({ heartRate: null }), HEART_RATE_TIMEOUT);
      onData(values);
    }, onConnectionChange);
  }

  disconnect() {
    clearTimeout(this.#silence);
    super.disconnect();
  }
}
