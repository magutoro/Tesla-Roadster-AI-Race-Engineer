// tools/build-suzuka.mjs — builds levels/suzuka.json from open data. Run: node tools/build-suzuka.mjs
//
// Track layout: OpenStreetMap (© OpenStreetMap contributors, ODbL), the highway=raceway ways
//   that make up Suzuka's full international course, joined in driving order.
// Elevation: NASA SRTM 30 m, via the free OpenTopoData API (opentopodata.org).
//
// Steps: download the raceway ways -> find the longest loop through the main straight (that's
// the full course; pit lane, karts and the shortcut are left out) -> convert lat/lon to meters ->
// sample every ~20 m -> look up elevation -> smooth it -> raise the crossover so the bridge
// clears the road underneath -> write the level file.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OVERPASS = "https://overpass-api.de/api/interpreter";
const QUERY = '[out:json][timeout:60];way["highway"="raceway"](34.828,136.510,34.858,136.560);out tags geom;';
const MAIN_STRAIGHT = "Main straight";
const SPACING = 20; // meters between track points in the level file
const BRIDGE_CLEARANCE = 8; // meters between the two roads at the crossover

// The OpenStreetMap download is cached in tools/data so the level can be rebuilt offline.
const CACHE = path.join(ROOT, "tools/data/suzuka-raceway.osm.json");
if (!fs.existsSync(CACHE)) {
  const response = await fetch(OVERPASS + "?data=" + encodeURIComponent(QUERY), { headers: { "User-Agent": "roadster-sim-hackathon/0.1 (github.com/magutoro/Tesla-Roadster-AI-Race-Engineer)" } });
  const text = await response.text();
  if (!text.trim().startsWith("{")) {
    console.log("Overpass did not return JSON (busy?). Try again in a minute.\n" + text.slice(0, 300));
    process.exit(1);
  }
  fs.writeFileSync(CACHE, text);
}
const osm = JSON.parse(fs.readFileSync(CACHE, "utf8"));
console.log("raceway ways:", osm.elements.length);

// ----- Join the ways into the full course -----
function key(point) {
  return point.lat.toFixed(7) + "," + point.lon.toFixed(7);
}
const ways = [];
for (const way of osm.elements) {
  const tags = way.tags || {};
  if (tags.sport !== "motor" || !tags.oneway) {
    continue;
  }
  ways.push({ id: way.id, tags: tags, points: way.geometry, start: key(way.geometry[0]), end: key(way.geometry[way.geometry.length - 1]) });
}
let first = null;
for (const way of ways) {
  if (way.tags["name:en"] === MAIN_STRAIGHT) {
    first = way;
  }
}
// Depth-first search for the longest loop that starts and ends with the main straight.
let best = null;
function lengthOf(list) {
  let total = 0;
  for (const way of list) {
    total = total + way.points.length;
  }
  return total;
}
function search(route, used) {
  const last = route[route.length - 1];
  if (route.length > 1 && last.end === first.start) {
    if (!best || lengthOf(route) > lengthOf(best)) {
      best = route.slice();
    }
    return;
  }
  for (const way of ways) {
    if (way.start === last.end && !used.has(way.id) && way !== first) {
      used.add(way.id);
      route.push(way);
      search(route, used);
      route.pop();
      used.delete(way.id);
    }
  }
}
search([first], new Set([first.id]));
console.log("full course pieces:", best.length);

// ----- Lat/lon to meters (x = west, z = north, so the map isn't mirrored: facing +Z, +X is left) -----
const all = [];
const onBridge = [];
for (const way of best) {
  const bridge = way.tags.bridge === "yes";
  for (let i = 0; i < way.points.length; i++) {
    if (all.length > 0 && i === 0) {
      continue; // shared point with the previous way
    }
    all.push(way.points[i]);
    onBridge.push(bridge);
  }
}
const lat0 = all[0].lat;
const lon0 = all[0].lon;
const metersPerLat = 111320;
const metersPerLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
const raw = [];
for (let i = 0; i < all.length; i++) {
  raw.push({ x: -(all[i].lon - lon0) * metersPerLon, z: (all[i].lat - lat0) * metersPerLat, lat: all[i].lat, lon: all[i].lon, bridge: onBridge[i] });
}

// ----- Resample every SPACING meters along the loop -----
const loop = raw.concat([raw[0]]);
const samples = [];
let carry = 0;
for (let i = 0; i < loop.length - 1; i++) {
  const a = loop[i];
  const b = loop[i + 1];
  const segment = Math.hypot(b.x - a.x, b.z - a.z);
  let t = carry;
  while (t < segment) {
    const f = t / segment;
    samples.push({
      x: a.x + (b.x - a.x) * f,
      z: a.z + (b.z - a.z) * f,
      lat: a.lat + (b.lat - a.lat) * f,
      lon: a.lon + (b.lon - a.lon) * f,
      bridge: a.bridge && b.bridge,
    });
    t = t + SPACING;
  }
  carry = t - segment;
}
console.log("track length about", samples.length * SPACING, "m,", samples.length, "points");

// ----- Elevation (100 points per request, 1 request per second) -----
const heights = [];
for (let i = 0; i < samples.length; i = i + 100) {
  const batch = samples.slice(i, i + 100);
  let locations = "";
  for (const s of batch) {
    locations = locations + (locations ? "|" : "") + s.lat.toFixed(6) + "," + s.lon.toFixed(6);
  }
  const reply = await fetch("https://api.opentopodata.org/v1/srtm30m?locations=" + locations);
  const data = await reply.json();
  for (const result of data.results) {
    heights.push(result.elevation);
  }
  await new Promise(function (resolve) {
    setTimeout(resolve, 1100);
  });
}
// Satellite elevation is noisy (trees, buildings), so smooth it over ~140 m.
const smooth = [];
for (let i = 0; i < samples.length; i++) {
  let sum = 0;
  let count = 0;
  for (let k = -3; k <= 3; k++) {
    sum = sum + heights[(i + k + samples.length) % samples.length];
    count = count + 1;
  }
  smooth.push(sum / count);
}
let lowest = Infinity;
for (const h of smooth) {
  lowest = Math.min(lowest, h);
}
for (let i = 0; i < samples.length; i++) {
  samples[i].y = smooth[i] - lowest;
  samples[i].lift = 0; // how much this point was raised to make the bridge
}

// ----- The crossover: find where the track crosses itself, and lift the bridge side -----
function crossing(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.z - p3.z) - (p2.z - p1.z) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) {
    return false;
  }
  const t = ((p3.x - p1.x) * (p4.z - p3.z) - (p3.z - p1.z) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.z - p1.z) - (p3.z - p1.z) * (p2.x - p1.x)) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
}
const n = samples.length;
for (let i = 0; i < n; i++) {
  for (let j = i + 5; j < n; j++) {
    if (Math.abs(i - j) > n - 5) {
      continue;
    }
    if (!crossing(samples[i], samples[(i + 1) % n], samples[j], samples[(j + 1) % n])) {
      continue;
    }
    // Which pass is the bridge? The one OpenStreetMap marks as bridge=yes nearby.
    let iBridge = false;
    let jBridge = false;
    for (let k = -6; k <= 6; k++) {
      iBridge = iBridge || samples[(i + k + n) % n].bridge;
      jBridge = jBridge || samples[(j + k + n) % n].bridge;
    }
    let upper = j;
    let lower = i;
    if (iBridge && !jBridge) {
      upper = i;
      lower = j;
    }
    const lift = samples[lower].y + BRIDGE_CLEARANCE - samples[upper].y;
    console.log("crossover between points", i, "and", j, "- lifting point", upper, "by", lift.toFixed(1), "m");
    if (lift > 0) {
      // Ramp up and down smoothly over ~240 m each side.
      for (let k = -12; k <= 12; k++) {
        const amount = 0.5 + 0.5 * Math.cos((Math.PI * k) / 13);
        samples[(upper + k + n) % n].y = samples[(upper + k + n) % n].y + lift * amount;
        samples[(upper + k + n) % n].lift = samples[(upper + k + n) % n].lift + lift * amount;
      }
    }
  }
}

// ----- Write the level -----
const points = [];
let minX = Infinity;
let maxX = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
for (const s of samples) {
  // [x, z, height, how much of that height is bridge]
  points.push([Number(s.x.toFixed(1)), Number(s.z.toFixed(1)), Number(s.y.toFixed(2)), Number(s.lift.toFixed(2))]);
  minX = Math.min(minX, s.x);
  maxX = Math.max(maxX, s.x);
  minZ = Math.min(minZ, s.z);
  maxZ = Math.max(maxZ, s.z);
}
// Center the track on the world origin.
const cx = (minX + maxX) / 2;
const cz = (minZ + maxZ) / 2;
for (const p of points) {
  p[0] = Number((p[0] - cx).toFixed(1));
  p[1] = Number((p[1] - cz).toFixed(1));
}
const size = Math.ceil(Math.max(maxX - minX, maxZ - minZ) / 100) * 100 + 1200;
const level = {
  name: "Suzuka Circuit (real layout)",
  description: "The real 5.8 km Suzuka layout from OpenStreetMap, with real elevation from satellite data, the figure-8 crossover bridge, and a racing line that tells you when to brake.",
  credits: "Track layout © OpenStreetMap contributors (ODbL). Elevation: NASA SRTM via OpenTopoData.",
  spawn: { onTrack: true },
  ground: { type: "grass", size: size, terrain: true },
  model: null,
  props: [{ type: "track", width: 13, startAt: [points[Math.floor(points.length * 0.03)][0], points[Math.floor(points.length * 0.03)][1]], checkpoints: 16, racingLine: true, scenery: "suzuka", points: points }],
  cars: [],
  goal: { type: "lap", text: "Set a lap of Suzuka. Follow the racing line: green = go, yellow = lift, red = brake." },
  checkpoints: [],
};
fs.writeFileSync(path.join(ROOT, "levels/suzuka.json"), JSON.stringify(level));
console.log("wrote levels/suzuka.json, ground size", size, "m, height range 0 to", Math.max(...samples.map((s) => s.y)).toFixed(1), "m");
