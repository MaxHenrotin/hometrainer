// Seconds without pedalling before the ride pauses itself
const AUTO_PAUSE_DELAY = 3;
// km/h lost between two readings that, with the power frozen, means the rider stopped pedalling.
// Coasting loses 2 to 3 km/h a second, while pedalling rarely changes speed by more than 0.5.
const COASTING_SPEED_DROP = 1;
// Durations of the best efforts, shown live and in the summary
export const RECORD_DURATIONS = [5, 15, 60, 300, 600, 1200, 3600];

// A ride waits for the first pedal stroke, then switches between riding and paused.
// Time, distance and energy only add up while riding.
export class Ride {
  state = "waiting";
  startedAt = null;
  time = 0;         // moving time, seconds
  distance = 0;     // km
  energy = 0;       // joules
  revolutions = 0;  // rpm × seconds, gives the average cadence
  speed = 0;
  cadence = 0;
  power = 0;
  maxPower = 0;
  records = new Map();  // duration in seconds → best average power
  samples = [];
  #last = null;
  #stoppedAt = null;
  #history = [{ speed: 0, cadence: 0, power: 0 }, { speed: 0, cadence: 0, power: 0 }];  // last two readings as received
  #frozenPower = null;  // the power the trainer keeps repeating while the rider coasts

  update(values, now = Date.now()) {
    // After the rider stops pedalling, the Suito keeps sending the last power, frozen, until its
    // flywheel has spun down, which takes about 10 seconds (the cadence drops to 0 a bit earlier).
    // The same power on three readings in a row while the speed clearly drops at each one means
    // nobody is pedalling. Asking for two drops keeps a noisy speed reading from faking it. From
    // then on, power and cadence count as zero for as long as that frozen value keeps coming back,
    // even once the flywheel slows down too gently to tell, and any new value means pedalling again.
    const [before, previous] = this.#history;
    const received = { ...previous, ...values };
    const falling = (a, b) => a.power === b.power && a.speed < b.speed - COASTING_SPEED_DROP;
    if (received.power !== this.#frozenPower) this.#frozenPower = null;
    if (falling(received, previous) && falling(previous, before)) this.#frozenPower = received.power;
    const coasting = this.#frozenPower !== null;
    this.#history = [previous, received];

    if (this.state === "riding") {
      const dt = (now - this.#last) / 1000;
      this.time += dt;
      this.distance += this.speed * dt / 3600;
      this.energy += this.power * dt;
      this.revolutions += this.cadence * dt;
    }
    this.#last = now;
    Object.assign(this, received, coasting ? { power: 0, cadence: 0 } : {});

    if (this.power > 0 || this.cadence > 0) {
      this.#stoppedAt = null;
      this.state = "riding";
      this.startedAt ??= new Date(now);
    } else if (this.state === "riding") {
      this.#stoppedAt ??= now;
      if (now - this.#stoppedAt >= AUTO_PAUSE_DELAY * 1000) this.state = "paused";
    }

    if (this.state === "riding") {
      const { time, speed, cadence, power, distance, energy } = this;
      this.samples.push({ timestamp: now, time, speed, cadence, power, distance, energy, power3s: this.#average3s() });
      this.maxPower = Math.max(this.maxPower, power);
      for (const duration of RECORD_DURATIONS) {
        const average = this.average(duration);
        if (average !== null && average > (this.records.get(duration) ?? -1)) this.records.set(duration, average);
      }
    }
  }

  // Used when the trainer disconnects, so the gap isn't counted as riding time
  // and the last readings don't stay on screen as if they were current
  pause() {
    if (this.state === "riding") this.state = "paused";
    this.speed = this.cadence = this.power = 0;
  }

  // The big number on screen: smoothed while riding, as received otherwise
  get displayPower() {
    return this.state === "riding" ? this.samples.at(-1).power3s : this.power;
  }

  get averagePower() {
    return this.time ? this.energy / this.time : 0;
  }

  // Average power over the last `seconds` of riding, or null until the ride is that long.
  // It comes from the energy counter, so it stays exact however irregularly the trainer sends data.
  average(seconds) {
    if (this.time < seconds) return null;
    const from = this.#lastSampleBefore(this.time - seconds);
    return (this.energy - from.energy) / (this.time - from.time);
  }

  summary() {
    return {
      time: this.time,
      distance: this.distance,
      speed: this.distance / this.time * 3600,
      cadence: this.revolutions / this.time,
      power: this.averagePower,
      maxPower: this.maxPower,
      energy: this.energy / 1000,
      curve: [...this.records].map(([duration, power]) => ({ duration, power })),
    };
  }

  #average3s() {
    let sum = this.power;
    let count = 1;
    for (let i = this.samples.length - 1; i >= 0 && this.samples[i].time > this.time - 3; i--) {
      sum += this.samples[i].power;
      count++;
    }
    return sum / count;
  }

  // Binary search, since a long ride holds thousands of samples
  #lastSampleBefore(time) {
    let low = 0;
    let high = this.samples.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.samples[middle].time <= time) low = middle;
      else high = middle - 1;
    }
    return this.samples[low];
  }
}
