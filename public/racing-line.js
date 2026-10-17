// racing-line.js — Owner: B (friend)
// A racing line that adapts to your speed, like the driving line in racing games.
//
// 1. The line: start on the track's center line and repeatedly pull each point toward the middle
//    of its neighbors (which straightens the path), while keeping it inside the track. The result
//    cuts across corners from outside to apex to outside, like a real racing line.
// 2. Target speeds: in a corner, speed is limited by grip (v = sqrt(grip / curvature)). Before a
//    corner you must brake down to that speed in time, after it you can only speed up so fast.
//    The grip includes the fans and the aero downforce, so turning the fans on raises the speeds.
// 3. Colors, every few frames: for each point ahead, how hard would you have to brake from your
//    current speed to be at the target speed there? Hard = red (brake now), some = yellow (lift),
//    none = green (go).

import * as THREE from "three";
import { CONFIG } from "./config.js";

const SHOW_AHEAD = 320; // meters of line shown ahead of the car
const LINE_WIDTH = 0.7;

export class RacingLine {
  // samples: the track's points ({ center, right }), evenly spaced. width: track width.
  constructor(scene, samples, count, width) {
    this.count = count;
    this.visible = true;
    this.lastIndex = 0;
    this.frame = 0;
    this.points = makeLine(samples, count, width);
    this.spacing = this.points[0].distanceTo(this.points[1]);
    this.curvature = curvatures(this.points, count);
    this.profiles = {}; // target speeds, cached per fan setting

    // A ribbon along the line, colored per point (with transparency so only the part ahead shows).
    const positions = [];
    const colors = [];
    const indices = [];
    for (let i = 0; i < count; i++) {
      const p = this.points[i];
      const next = this.points[(i + 1) % count];
      const along = new THREE.Vector3().subVectors(next, p).normalize();
      const side = new THREE.Vector3(-along.z, 0, along.x).multiplyScalar(LINE_WIDTH / 2);
      positions.push(p.x - side.x, p.y + 0.05, p.z - side.z);
      positions.push(p.x + side.x, p.y + 0.05, p.z + side.z);
      colors.push(0, 0, 0, 0, 0, 0, 0, 0);
      const a = i * 2;
      const b = ((i + 1) % count) * 2;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.colors = new THREE.Float32BufferAttribute(colors, 4); // 4 = red, green, blue, alpha
    geometry.setAttribute("color", this.colors);
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  toggle() {
    this.visible = !this.visible;
    this.mesh.visible = this.visible;
  }

  // Target speed (m/s) at each point, for a car with this much fan suction (0..1).
  speedProfile(fanPower) {
    const fanKey = Math.round(fanPower * 4) / 4;
    if (this.profiles[fanKey]) {
      return this.profiles[fanKey];
    }
    const c = CONFIG.car;
    const g = CONFIG.physics.gravity;
    const mass = c.dryMass + 150;
    const grip = c.tireGrip * 0.95;
    const extraG = CONFIG.fans.downforceG * fanKey; // fan suction, in g
    const aero = (0.5 * c.airDensity * c.downforceArea) / mass; // downforce per (m/s)^2, in g-units of acceleration
    const top = 375 / 3.6;
    const speeds = [];
    for (let i = 0; i < this.count; i++) {
      // Corner speed: v^2 * curvature = grip * (g * (1 + fans) + aero * v^2)
      const k = this.curvature[i];
      let v = top;
      if (k > grip * aero) {
        v = Math.min(top, Math.sqrt((grip * g * (1 + extraG)) / (k - grip * aero)));
      }
      speeds.push(v);
    }
    // Braking zones (going backwards) and acceleration (going forwards), around the loop twice.
    const ds = this.spacing;
    for (let lap = 0; lap < 2; lap++) {
      for (let n = this.count - 1; n >= 0; n--) {
        const next = speeds[(n + 1) % this.count];
        const brake = grip * (g * (1 + extraG) + aero * next * next) * 0.9;
        speeds[n] = Math.min(speeds[n], Math.sqrt(next * next + 2 * brake * ds));
      }
      for (let n = 0; n < this.count; n++) {
        const previous = speeds[(n - 1 + this.count) % this.count];
        const byGrip = grip * g * (1 + extraG) * 0.9;
        const byPower = (c.motorPowerKW * 1000) / (mass * Math.max(previous, 5));
        const accel = Math.min(byGrip, byPower);
        speeds[n] = Math.min(speeds[n], Math.sqrt(previous * previous + 2 * accel * ds));
      }
    }
    this.profiles[fanKey] = speeds;
    return speeds;
  }

  // Call every frame with the car. Recolors the line ahead (every 3rd frame is plenty).
  update(car) {
    this.frame = this.frame + 1;
    if (!this.visible || this.frame % 3 !== 0) {
      return;
    }
    // Find where the car is on the line (search near where it was last time).
    const position = car.getPosition();
    let best = this.lastIndex;
    let bestDistance = Infinity;
    for (let k = -60; k <= 60; k++) {
      const i = (this.lastIndex + k + this.count) % this.count;
      const d = this.points[i].distanceToSquared(position);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    if (bestDistance > 60 * 60) {
      // Far away (just reset or off track): search the whole line.
      for (let i = 0; i < this.count; i++) {
        const d = this.points[i].distanceToSquared(position);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
    }
    // Hide the part we colored last time, then color the part ahead.
    const steps = Math.ceil(SHOW_AHEAD / this.spacing);
    for (let k = -2; k <= steps + 2; k++) {
      this.setColor((this.lastIndex + k + this.count) % this.count, 0, 0, 0, 0);
    }
    this.lastIndex = best;

    const speeds = this.speedProfile(car.fanPower);
    const now = Math.max(car.forwardSpeed, 0);
    const g = CONFIG.physics.gravity;
    const maxBrake = CONFIG.car.tireGrip * g * (1 + CONFIG.fans.downforceG * car.fanPower) * 0.9;
    for (let k = 1; k <= steps; k++) {
      const i = (best + k) % this.count;
      const distance = k * this.spacing;
      const target = speeds[i];
      // How hard would we need to brake from here to be at the target speed there?
      let needed = 0;
      if (now > target) {
        needed = (now * now - target * target) / (2 * distance) / maxBrake;
      }
      let alpha = 0.85;
      if (k < 4) {
        alpha = (k / 4) * 0.85; // fade in just ahead of the car
      } else if (k > steps - 20) {
        alpha = ((steps - k) / 20) * 0.85; // and fade out in the distance
      }
      if (needed > 0.8) {
        this.setColor(i, 1.0, 0.18, 0.2, alpha); // red: brake now
      } else if (needed > 0.35) {
        this.setColor(i, 1.0, 0.8, 0.15, alpha); // yellow: lift / get ready
      } else {
        this.setColor(i, 0.2, 0.95, 0.45, alpha); // green: go
      }
    }
    this.colors.needsUpdate = true;
  }

  setColor(i, r, g, b, a) {
    this.colors.setXYZW(i * 2, r, g, b, a);
    this.colors.setXYZW(i * 2 + 1, r, g, b, a);
  }

  remove(scene) {
    scene.remove(this.mesh);
  }
}

// Pull the line toward the inside of corners while keeping it on the track.
function makeLine(samples, count, width) {
  const margin = 1.6; // keep the car's wheels on the asphalt
  const limit = width / 2 - margin;
  const offsets = new Array(count).fill(0);
  const positions = [];
  for (let i = 0; i < count; i++) {
    positions.push(samples[i].center.clone());
  }
  const reach = 6; // look 6 points (~12 m) each way so the line is smooth, not wobbly
  for (let round = 0; round < 500; round++) {
    for (let i = 0; i < count; i++) {
      const before = positions[(i - reach + count) % count];
      const after = positions[(i + reach) % count];
      const middleX = (before.x + after.x) / 2;
      const middleZ = (before.z + after.z) / 2;
      const center = samples[i].center;
      const right = samples[i].right;
      const wanted = (middleX - center.x) * right.x + (middleZ - center.z) * right.z;
      offsets[i] = offsets[i] + (Math.max(-limit, Math.min(limit, wanted)) - offsets[i]) * 0.5;
      positions[i].x = center.x + right.x * offsets[i];
      positions[i].z = center.z + right.z * offsets[i];
    }
  }
  return positions;
}

// How sharply the line bends at each point (1 / turning radius).
function curvatures(points, count) {
  const result = [];
  const reach = 5;
  for (let i = 0; i < count; i++) {
    const a = points[(i - reach + count) % count];
    const b = points[i];
    const c = points[(i + reach) % count];
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const ca = Math.hypot(a.x - c.x, a.z - c.z);
    const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
    if (ab * bc * ca < 1e-6) {
      result.push(0);
    } else {
      result.push((4 * area) / (ab * bc * ca));
    }
  }
  return result;
}
