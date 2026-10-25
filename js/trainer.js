const FTMS_SERVICE = 0x1826;
const INDOOR_BIKE_DATA = 0x2ad2;
const RECONNECT_DELAY = 2000;

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

// A Bluetooth FTMS trainer. If the connection drops, it keeps trying to reconnect
// until disconnect() is called.
export class Trainer {
  active = false;

  constructor(onData, onConnectionChange) {
    this.onData = onData;
    this.onConnectionChange = onConnectionChange;
  }

  get name() {
    return this.device.name;
  }

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [FTMS_SERVICE] }] });
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
    const service = await server.getPrimaryService(FTMS_SERVICE);
    const characteristic = await service.getCharacteristic(INDOOR_BIKE_DATA);
    // Bluefy on iPhone and iPad ignores the oncharacteristicvaluechanged property, only listeners get the values
    characteristic.addEventListener("characteristicvaluechanged", this.#onValue);
    await characteristic.startNotifications();
  }

  // One shared function, so subscribing again after a reconnection doesn't add a second listener
  #onValue = (event) => this.onData(parseIndoorBikeData(event.target.value));

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
