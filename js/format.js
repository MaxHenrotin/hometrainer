// A point before the decimals and no thousands separator, in every language
export const number = (value, digits = 0) => value.toFixed(digits);

export function duration(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// Short labels for the power curve axis: "5 s", "1 min", "1 h"
export function durationLabel(seconds) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${seconds / 60} min`;
  return `${seconds / 3600} h`;
}
