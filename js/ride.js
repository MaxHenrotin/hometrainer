// Seconds without pedalling before the ride pauses itself
const AUTO_PAUSE_DELAY = 1;
// Durations of the rolling averages and of the best efforts, the same on every screen
export const RECORD_DURATIONS = [1, 5, 15, 60, 120, 180, 300, 600, 1200, 2700];

// The speed is simulated from the power, as on a flat road with no wind (Martin et al., 1998).
// The trainer's own speed only follows the gear and the cadence, and comes out far too low.
const BIKE_WEIGHT = 8;      // kg, wheels included
const DEFAULT_WEIGHT = 75;  // kg, for a rider who hasn't entered their weight
const CDA = 0.32;           // m², drag area seated on the hoods
const CRR = 0.004;          // rolling resistance of road tyres on asphalt
const DRIVETRAIN = 0.976;   // share of the power that reaches the wheel
const AIR_DENSITY = 1.2;    // kg/m³, around 20 °C
const GRAVITY = 9.81;

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
  autoPause = true;  // off: the clock keeps running while the rider doesn't pedal
  weight = null;     // kg, the rider's
  records = new Map();  // duration in seconds → best average power
  samples = [];
  #last = null;
  #stoppedAt = null;
  #measuresCadence = false;  // some trainers don't measure cadence

  update(values, now = Date.now()) {
    if (this.state === "riding") {
      const dt = (now - this.#last) / 1000;
      this.time += dt;
      this.distance += this.speed * dt / 3600;
      this.energy += this.power * dt;
      this.revolutions += this.cadence * dt;
      this.#accelerate(dt);
    }
    this.#last = now;
    Object.assign(this, values);
    this.#measuresCadence ||= values.cadence !== undefined;

    // Pedalling means turning the cranks, and power alone can't tell: some trainers, like the Suito,
    // keep sending the last power for a few seconds after the rider stops. So no cadence means no
    // pedalling and no power. Trainers that don't measure cadence fall back on power.
    const pedalling = this.#measuresCadence ? this.cadence > 0 : this.power > 0;
    if (!pedalling) this.power = 0;

    if (pedalling) {
      this.#stoppedAt = null;
      this.state = "riding";
      this.startedAt ??= new Date(now);
    } else if (this.state === "riding" && this.autoPause) {
      this.#stoppedAt ??= now;
      if (now - this.#stoppedAt >= AUTO_PAUSE_DELAY * 1000) {
        this.state = "paused";
        this.speed = 0;  // the rider has stopped, and sets off again from standstill
      }
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

  // The work done in kJ is about the kcal the body burns: muscles turn roughly a quarter of the
  // food energy into work, and 1 kcal is 4.184 kJ, so the two factors cancel out
  get calories() {
    return this.energy / 1000;
  }

  get averagePower() {
    return this.time ? this.energy / this.time : 0;
  }

  get averageCadence() {
    return this.time ? this.revolutions / this.time : 0;
  }

  get averageSpeed() {
    return this.time ? this.distance / this.time * 3600 : 0;
  }

  // Clock time from the first pedal stroke to the last reading, pauses included
  get elapsed() {
    return this.samples.length ? (this.samples.at(-1).timestamp - this.samples[0].timestamp) / 1000 : 0;
  }

  // Average power over the last `seconds` of riding, or null until the ride is that long.
  // It comes from the energy counter, so it stays exact however irregularly the trainer sends data.
  average(seconds) {
    if (this.time < seconds) return null;
    return (this.energy - this.#energyAt(this.time - seconds)) / seconds;
  }

  // Average power over each `size`-second slice of riding time, from `from` to now.
  // The last slice is shorter while it fills up.
  powerBuckets(size, from = 0) {
    const buckets = [];
    for (let start = from; start < this.time; start += size) {
      const end = Math.min(start + size, this.time);
      buckets.push((this.#energyAt(end) - this.#energyAt(start)) / (end - start));
    }
    return buckets;
  }

  summary() {
    return {
      time: this.time,
      elapsed: this.elapsed,
      distance: this.distance,
      speed: this.averageSpeed,
      cadence: this.averageCadence,
      power: this.averagePower,
      maxPower: this.maxPower,
      calories: this.calories,
    };
  }

  // The power left after the drivetrain, rolling resistance and air drag goes into kinetic energy,
  // so the speed keeps its momentum like a real bike's: it builds up and dies down over seconds
  #accelerate(dt) {
    const mass = (this.weight ?? DEFAULT_WEIGHT) + BIKE_WEIGHT;
    const v = this.speed / 3.6;
    const resistance = (CRR * mass * GRAVITY + AIR_DENSITY * CDA * v * v / 2) * v;
    this.speed = Math.sqrt(Math.max(0, v * v + 2 * dt * (DRIVETRAIN * this.power - resistance) / mass)) * 3.6;
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

  // Energy at a given riding time. Between two samples, the power of the first one applies,
  // the same way the energy counter adds it up.
  #energyAt(time) {
    const sample = this.#lastSampleBefore(time);
    return sample.energy + sample.power * (time - sample.time);
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
