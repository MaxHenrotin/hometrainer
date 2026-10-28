// Coggan's seven power zones, each up to a share of FTP. Their names are in the language files.
export const ZONES = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5, Infinity];

export const zoneIndex = (power, ftp) => ZONES.findIndex((upTo) => power <= upTo * ftp);

// Seconds of riding spent in each zone. Like the energy counter, each interval
// between two samples counts at the power of the sample that opens it.
export function zoneTimes(samples, ftp) {
  const times = ZONES.map(() => 0);
  for (let i = 1; i < samples.length; i++) {
    times[zoneIndex(samples[i - 1].power, ftp)] += samples[i].time - samples[i - 1].time;
  }
  return times;
}
