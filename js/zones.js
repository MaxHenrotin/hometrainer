// Coggan's seven power zones, each up to a share of FTP
export const ZONES = [
  { name: "Récupération", upTo: 0.55 },
  { name: "Endurance", upTo: 0.75 },
  { name: "Tempo", upTo: 0.9 },
  { name: "Seuil", upTo: 1.05 },
  { name: "VO2 max", upTo: 1.2 },
  { name: "Anaérobie", upTo: 1.5 },
  { name: "Neuromusculaire", upTo: Infinity },
];

export const zoneIndex = (power, ftp) => ZONES.findIndex((zone) => power <= zone.upTo * ftp);

// Seconds of riding spent in each zone. Like the energy counter, each interval
// between two samples counts at the power of the sample that opens it.
export function zoneTimes(samples, ftp) {
  const times = ZONES.map(() => 0);
  for (let i = 1; i < samples.length; i++) {
    times[zoneIndex(samples[i - 1].power, ftp)] += samples[i].time - samples[i - 1].time;
  }
  return times;
}
