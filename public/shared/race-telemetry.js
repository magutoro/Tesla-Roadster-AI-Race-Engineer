// Browser telemetry contract. Engine RPM/gear are unavailable on this electric car.
export const CSV_FIELDS = ["sessionId", "trackId", "trackVersion", "physicsVersion", "setupId", "mode", "sequence", "timestampMs", "timeSeconds", "lapNumber", "lapTimeSeconds", "distanceMeters", "trackLengthMeters", "normalizedCarPosition", "lateralOffsetMeters", "trackWidthMeters", "speedKmh", "throttle", "brake", "steer", "steerDegrees", "gLat", "gLong", "airborne", "fansOn", "tankPercent", "absActive", "tractionControlActive", "tireFL", "tireFR", "tireRL", "tireRR", "crash", "gear", "rpm"];
const TEXT_FIELDS = new Set(["sessionId", "trackId", "trackVersion", "physicsVersion", "setupId", "mode"]);
const TRACK_FIELDS = new Set(["distanceMeters", "trackLengthMeters", "normalizedCarPosition", "lateralOffsetMeters", "trackWidthMeters"]);
const BOOL_FIELDS = new Set(["airborne", "fansOn", "absActive", "tractionControlActive", "crash"]);
export function stableId(value) {
  let hash = 2166136261;
  for (const char of JSON.stringify(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}
export function cleanTelemetrySample(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Telemetry sample required");
  const sample = {};
  for (const key of CSV_FIELDS) {
    const value = raw[key];
    if (TEXT_FIELDS.has(key)) {
      if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error("Invalid telemetry " + key);
      sample[key] = value;
    } else if (BOOL_FIELDS.has(key)) {
      if (typeof value !== "boolean") throw new Error("Invalid telemetry " + key);
      sample[key] = value;
    } else if (TRACK_FIELDS.has(key) && value === null) {
      sample[key] = null;
    } else if (key === "gear" || key === "rpm") {
      if (value !== null) throw new Error("Engine gear/RPM are unavailable");
      sample[key] = null;
    } else {
      if (!Number.isFinite(value) || Math.abs(value) > 1e15) throw new Error("Invalid telemetry " + key);
      sample[key] = value;
    }
  }
  const hasTrack=sample.trackLengthMeters !== null;
  if (Array.from(TRACK_FIELDS).some(function(key){return (sample[key]!==null)!==hasTrack;})) throw new Error("Incomplete track position");
  if (hasTrack && (sample.normalizedCarPosition < 0 || sample.normalizedCarPosition >= 1 || sample.trackLengthMeters<=0 || sample.trackWidthMeters<=0 || sample.distanceMeters<0 || sample.distanceMeters>=sample.trackLengthMeters || Math.abs(sample.normalizedCarPosition-sample.distanceMeters/sample.trackLengthMeters)>0.00001)) throw new Error("Invalid track position");
  if (!["performance", "thrust", "rocket"].includes(sample.mode) || !Number.isInteger(sample.lapNumber) || sample.lapNumber<0 || sample.lapTimeSeconds<0 || sample.speedKmh < 0 || sample.speedKmh > 1000 || sample.throttle < 0 || sample.throttle > 1 || sample.brake < 0 || sample.brake > 1 ||
      Math.abs(sample.steer) > 1 || sample.timeSeconds < 0 || sample.timestampMs < 0 || !Number.isInteger(sample.sequence) || sample.sequence < 0) throw new Error("Telemetry out of range");
  return sample;
}
export function telemetryCsv(samples, header = true) {
  const rows = samples.map(function (sample) { return CSV_FIELDS.map(function (key) { return sample[key] ?? ""; }).join(","); });
  return (header ? CSV_FIELDS.join(",") + "\n" : "") + rows.join("\n") + (rows.length ? "\n" : "");
}
export function parseTelemetryCsv(text, limit = 36000) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.shift() !== CSV_FIELDS.join(",")) throw new Error("Use a Roadster telemetry CSV with its original header");
  if (lines.length > limit) throw new Error("Replay exceeds sample limit");
  return lines.filter(Boolean).map(function (line) {
    const cells = line.split(",");
    if (cells.length !== CSV_FIELDS.length) throw new Error("Invalid CSV row");
    const sample = {};
    CSV_FIELDS.forEach(function (key, i) {
      const value = cells[i];
      if (BOOL_FIELDS.has(key) && !["true", "false"].includes(value)) throw new Error("Invalid CSV boolean");
      sample[key] = TEXT_FIELDS.has(key) ? value : BOOL_FIELDS.has(key) ? value === "true" : value === "" ? null : Number(value);
    });
    return cleanTelemetrySample(sample);
  });
}
// Segments include elevation: a bridge crossing must not project onto the road below.
export class TrackPosition {
  constructor(track) {
    const original = track.samples.slice(0, track.count).map(function (s) { return { x: s.center.x, y: s.center.y, z: s.center.z }; });
    const start = track.checkpoints[0].position;
    let startIndex = 0, nearest = Infinity;
    original.forEach(function (p, i) { const d = (p.x-start.x)**2 + (p.y-start.y)**2 + (p.z-start.z)**2; if (d < nearest) { nearest = d; startIndex = i; } });
    this.points = original.slice(startIndex).concat(original.slice(0, startIndex));
    this.offsets = [0];
    this.length = 0;
    this.width = track.width;
    for (let i = 0; i < this.points.length; i++) {
      const a = this.points[i], b = this.points[(i+1)%this.points.length];
      this.length += Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
      this.offsets.push(this.length);
    }
    this.version = "track-" + stableId({ points: this.points, width: this.width });
  }
  project(position) {
    let best = Infinity, distance = 0;
    for (let i = 0; i < this.points.length; i++) {
      const a = this.points[i], b = this.points[(i+1)%this.points.length];
      const dx=b.x-a.x, dy=b.y-a.y, dz=b.z-a.z;
      const length2=dx*dx+dy*dy+dz*dz;
      if(length2===0) continue;
      const t=Math.max(0,Math.min(1,((position.x-a.x)*dx+(position.y-a.y)*dy+(position.z-a.z)*dz)/length2));
      const error=(position.x-a.x-t*dx)**2+(position.y-a.y-t*dy)**2+(position.z-a.z-t*dz)**2;
      if (error < best) { best=error; distance=this.offsets[i]+t*(this.offsets[i+1]-this.offsets[i]); }
    }
    distance %= this.length;
    return { distanceMeters: distance, normalizedCarPosition: distance/this.length, lateralOffsetMeters: Math.sqrt(best) };
  }
}
