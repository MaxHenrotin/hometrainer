// Seconds without pedalling before the ride pauses itself
const AUTO_PAUSE_DELAY = 3;
const CURVE_DURATIONS = [5, 15, 60, 300, 600, 1200, 3600];

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
  samples = [];
  #last = null;
  #stoppedAt = null;

  update(values, now = Date.now()) {
    if (this.state === "riding") {
      const dt = (now - this.#last) / 1000;
      this.time += dt;
      this.distance += this.speed * dt / 3600;
      this.energy += this.power * dt;
      this.revolutions += this.cadence * dt;
    }
    this.#last = now;
    Object.assign(this, values);

    if (this.power > 0 || this.cadence > 0) {
      this.#stoppedAt = null;
      this.state = "riding";
      this.startedAt ??= new Date(now);
    } else if (this.state === "riding") {
      this.#stoppedAt ??= now;
      if (now - this.#stoppedAt >= AUTO_PAUSE_DELAY * 1000) this.state = "paused";
    }

    if (this.state === "riding") {
      const { time, speed, cadence, power, distance } = this;
      this.samples.push({ timestamp: now, time, speed, cadence, power, distance, power3s: this.#average3s() });
    }
  }

  // Used when the trainer disconnects, so the gap isn't counted as riding time
  pause() {
    if (this.state === "riding") this.state = "paused";
  }

  // The big number on screen: smoothed while riding, as received otherwise
  get displayPower() {
    return this.state === "riding" ? this.samples.at(-1).power3s : this.power;
  }

  summary() {
    return {
      time: this.time,
      distance: this.distance,
      speed: this.distance / this.time * 3600,
      cadence: this.revolutions / this.time,
      power: this.energy / this.time,
      maxPower: this.samples.reduce((max, s) => Math.max(max, s.power), 0),
      energy: this.energy / 1000,
      curve: this.#powerCurve(),
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

  // Best average power over each duration. Samples are first resampled to one per second
  // of moving time, so the result doesn't depend on how often the trainer sends data.
  #powerCurve() {
    const perSecond = [];
    let i = 0;
    for (let second = 1; second <= this.time; second++) {
      while (i < this.samples.length - 1 && this.samples[i + 1].time <= second) i++;
      perSecond.push(this.samples[i].power);
    }
    return CURVE_DURATIONS.filter((d) => d <= perSecond.length).map((duration) => {
      let sum = perSecond.slice(0, duration).reduce((a, b) => a + b, 0);
      let best = sum;
      for (let j = duration; j < perSecond.length; j++) {
        sum += perSecond[j] - perSecond[j - duration];
        best = Math.max(best, sum);
      }
      return { duration, power: best / duration };
    });
  }
}
