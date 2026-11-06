/* FGRH v2: 12-byte header, then [elapsed uint32 LE, RSSI slots 0..7]. */
function decodeRaceTrace(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  if (bytes.length < 12 || String.fromCharCode(...bytes.slice(0, 4)) !== "FGRH" || bytes[4] !== 2) {
    throw new Error("Unsupported RSSI recording");
  }
  const intervalMs = view.getUint16(5, true);
  const count = view.getUint32(7, true);
  if (!intervalMs || count > 45000 || bytes.length !== 12 + count * 12) throw new Error("Incomplete RSSI recording");
  const times = [], channels = Array.from({ length: 8 }, () => []);
  for (let i = 0; i < count; ++i) {
    const at = 12 + i * 12, t = view.getUint32(at, true);
    if (i && t <= times[i - 1]) throw new Error("Invalid RSSI timestamps");
    times.push(t);
    for (let slot = 0; slot < 8; ++slot) channels[slot].push(bytes[at + 4 + slot]);
  }
  return { times, channels, intervalMs, truncated: !!bytes[11] };
}

function nearestTraceSample(times, ms) {
  if (!times.length) return 0;
  let lo = 0, hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < ms) lo = mid + 1; else hi = mid;
  }
  return lo > 0 && ms - times[lo - 1] <= times[lo] - ms ? lo - 1 : lo;
}

if (typeof module !== "undefined") module.exports = { decodeRaceTrace, nearestTraceSample };
