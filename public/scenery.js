// scenery.js — Owner: B (friend)
// "Generator" props: one small block of level JSON builds a whole scene.
//   track       - a race circuit from a list of points (can cross over itself on a bridge)
//   parking_lot - a full lot with one open spot, cars hunting for parking, shoppers, a store
//   highway     - a long divided highway with traffic and an accident jam
// Keeping levels this short also makes them easy for the AI scenario generator to write.

import * as THREE from "three";
import { addMesh, addFixedBoxCollider, headingToQuaternion, FlatPaint, BoxBatch, makeTextSign } from "./level-utils.js";
import { makeCarMesh, getCarSize, CAR_COLORS } from "./vehicles.js";
import { addMover } from "./traffic.js";
import { surfaceMaterial, makeGroundPatch, TILE_METERS } from "./materials.js";
import { RacingLine } from "./racing-line.js";
import { addTrees, scatter, addFerrisWheel, addPitBuilding, addBuildings, addCityAlongRoad, addSoundWalls, addOverpass } from "./decor.js";
import { turnRates, curbPlaces, makeTrackFinder, inRange, flatWidths, addGravelTraps, addGuardrails, addPitLane, addGrandstand, addDistantHills } from "./trackside.js";

// A random number generator that gives the same numbers every time for the same seed,
// so a level looks the same on every load.
function makeRandom(seed) {
  let state = seed || 12345;
  return function () {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// =====================================================================================
// Race track
// { "type": "track", "points": [[x, z, height, bridgeLift], ...], "width": 14, "startAt": [x, z],
//   "racingLine": true, "scenery": "suzuka" or "countryside", "barriers": true }
// The points are joined into a smooth closed loop. On flat ground, any height makes a bridge.
// With "ground": { "terrain": true } the heights are real elevation, the ground is shaped to match,
// and only the 4th number (how much a point was raised) makes a bridge.
// =====================================================================================

export function buildTrack(built, prop) {
  const width = prop.width || 14;
  const half = width / 2;
  const shoulder = 1.0; // a strip of asphalt past the white line (curbs go here in corners)
  const points = [];
  for (const p of prop.points) {
    points.push(new THREE.Vector3(p[0], p[2] || 0, p[1]));
  }
  const curve = new THREE.CatmullRomCurve3(points, true, "centripetal");
  const count = Math.ceil(curve.getLength() / 2); // one sample every ~2 m
  const centers = curve.getSpacedPoints(count); // count + 1 points; the last equals the first
  const terrain = built.level.ground && built.level.ground.terrain === true;

  // For every sample: the center, the direction of travel, and the left/right edges.
  const samples = [];
  for (let i = 0; i <= count; i++) {
    const tangent = curve.getTangentAt(i / count);
    const flat = new THREE.Vector3(tangent.x, 0, tangent.z).normalize();
    const right = new THREE.Vector3(-flat.z, 0, flat.x); // facing +Z, right is -X
    const center = centers[i].clone();
    center.y = Math.max(0, center.y) + 0.04; // a hair above the ground
    // How high this bit of road is above the ground under it (bridges need walls and pillars).
    let raised = center.y;
    if (terrain) {
      raised = liftAt(prop.points, curve.getUtoTmapping(i / count));
    }
    samples.push({
      center: center,
      raised: raised,
      forward: flat,
      right: right,
      left: center.clone().addScaledVector(right, -(half + shoulder)),
      rightEdge: center.clone().addScaledVector(right, half + shoulder),
      heading: THREE.MathUtils.radToDeg(Math.atan2(flat.x, flat.z)),
    });
  }

  // ----- Driving surface: physics and graphics share the same triangles -----
  const vertices = [];
  const triangles = [];
  for (let i = 0; i <= count; i++) {
    vertices.push(samples[i].left.x, samples[i].left.y, samples[i].left.z);
    vertices.push(samples[i].rightEdge.x, samples[i].rightEdge.y, samples[i].rightEdge.z);
  }
  for (let i = 0; i < count; i++) {
    const a = i * 2;
    triangles.push(a, a + 2, a + 1);
    triangles.push(a + 1, a + 2, a + 3);
  }
  const vertexArray = new Float32Array(vertices);
  const collider = built.RAPIER.ColliderDesc.trimesh(vertexArray, new Uint32Array(triangles)).setFriction(1.0);
  built.fixedColliders.push(built.world.createCollider(collider));
  // Texture coordinates in meters: across the road, and distance along it.
  const uvs = [];
  let distance = 0;
  for (let i = 0; i <= count; i++) {
    if (i > 0) {
      distance = distance + samples[i].center.distanceTo(samples[i - 1].center);
    }
    const along = distance / TILE_METERS.asphalt;
    uvs.push(0, along, (width + 2 * shoulder) / TILE_METERS.asphalt, along);
  }
  const roadGeometry = new THREE.BufferGeometry();
  roadGeometry.setAttribute("position", new THREE.BufferAttribute(vertexArray, 3));
  roadGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  roadGeometry.setIndex(triangles);
  roadGeometry.computeVertexNormals();
  const roadMaterial = surfaceMaterial("asphalt").clone(); // seen from below on bridges too
  roadMaterial.side = THREE.DoubleSide;
  // Always drawn over the ground just under it, even far away (where the depth buffer can't
  // tell 4 cm apart). Paint and curbs use a bigger offset, so they still go on top.
  roadMaterial.polygonOffset = true;
  roadMaterial.polygonOffsetFactor = -1;
  roadMaterial.polygonOffsetUnits = -1;
  const road = new THREE.Mesh(roadGeometry, roadMaterial);
  road.receiveShadow = true;
  addMesh(built, road);

  // ----- Paint: white edge lines, and red/white curbs in the corners -----
  const rates = turnRates(samples, count);
  const curbs = curbPlaces(rates);
  const paint = new FlatPaint();
  for (let i = 0; i < count; i++) {
    const s = samples[i];
    const next = samples[i + 1];
    for (const side of [-1, 1]) {
      // Edge line just inside the road edge.
      const a = s.center.clone().addScaledVector(s.right, side * (half - 0.4));
      const b = s.center.clone().addScaledVector(s.right, side * (half - 0.15));
      const c = next.center.clone().addScaledVector(next.right, side * (half - 0.15));
      const d = next.center.clone().addScaledVector(next.right, side * (half - 0.4));
      liftPoints([a, b, c, d], 0.01);
      paint.addQuad(a, b, c, d, "#f2f2f2");
      // Curb just outside the edge in corners, alternating red and white every 2 m.
      if (curbs[i] > 0 && s.raised < 0.5 && next.raised < 0.5) {
        const e = s.center.clone().addScaledVector(s.right, side * half);
        const f = s.center.clone().addScaledVector(s.right, side * (half + shoulder));
        const g = next.center.clone().addScaledVector(next.right, side * (half + shoulder));
        const h = next.center.clone().addScaledVector(next.right, side * half);
        liftPoints([e, f, g, h], 0.01);
        let curbColor = "#d63a3a";
        if (i % 2 === 0) {
          curbColor = "#f2f2f2";
        }
        paint.addQuad(e, f, g, h, curbColor);
      }
    }
  }
  addMesh(built, paint.build());

  // ----- Bridge: walls along raised parts, and pillars underneath -----
  const walls = new BoxBatch();
  for (let i = 0; i < count; i++) {
    const s = samples[i];
    const next = samples[i + 1];
    if (s.raised < 0.8 && next.raised < 0.8) {
      continue;
    }
    const length = s.center.distanceTo(next.center) + 0.2;
    for (const side of [-1, 1]) {
      const middle = s.center.clone().add(next.center).multiplyScalar(0.5).addScaledVector(s.right, side * (half + 0.25));
      const y = middle.y + 0.55;
      addFixedBoxCollider(built, middle.x, y, middle.z, 0.5, 1.1, length, s.heading);
      walls.add(middle.x, y, middle.z, 0.5, 1.1, length, s.heading, "#c4c8ce");
    }
  }
  // Pillars every ~14 m under the bridge, but never on the road that passes underneath.
  for (let i = 0; i < count; i = i + 7) {
    const s = samples[i];
    if (s.raised < 2.5) {
      continue;
    }
    let blocksRoad = false;
    for (const other of samples) {
      const dx = other.center.x - s.center.x;
      const dz = other.center.z - s.center.z;
      if (other.raised < 1.5 && Math.sqrt(dx * dx + dz * dz) < half + 4) {
        blocksRoad = true;
        break;
      }
    }
    if (blocksRoad) {
      continue;
    }
    const height = s.raised - 0.3;
    const base = s.center.y - s.raised;
    walls.addCylinder(s.center.x, base + height / 2, s.center.z, 0.9, height, "#9da3ab");
    const pillar = built.RAPIER.ColliderDesc.cylinder(height / 2, 0.9).setTranslation(s.center.x, base + height / 2, s.center.z);
    built.fixedColliders.push(built.world.createCollider(pillar));
  }
  const wallMesh = walls.build();
  if (wallMesh) {
    addMesh(built, wallMesh);
  }

  // ----- Start/finish line and lap checkpoints -----
  let startIndex = 0;
  if (prop.startAt) {
    let best = Infinity;
    for (let i = 0; i < count; i++) {
      const dx = samples[i].center.x - prop.startAt[0];
      const dz = samples[i].center.z - prop.startAt[1];
      if (dx * dx + dz * dz < best) {
        best = dx * dx + dz * dz;
        startIndex = i;
      }
    }
  }
  const start = samples[startIndex];
  const line = makeCheckeredLine(width, 3);
  line.position.set(start.center.x, start.center.y + 0.02, start.center.z);
  line.rotation.set(-Math.PI / 2, 0, THREE.MathUtils.degToRad(start.heading));
  addMesh(built, line);

  const checkpointCount = prop.checkpoints || 12;
  const checkpoints = [];
  for (let k = 0; k < checkpointCount; k++) {
    const s = samples[(startIndex + Math.round((k * count) / checkpointCount)) % count];
    checkpoints.push({ position: s.center.clone(), heading: s.heading });
  }
  // An arch over the track shows where the next checkpoint is.
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(half + 1, 0.35, 8, 32, Math.PI),
    new THREE.MeshBasicMaterial({ color: "#39ff88", transparent: true, opacity: 0.55 })
  );
  addMesh(built, arch);

  // Spawn a little before the start line, facing along the track.
  const spawnSample = samples[(startIndex - 25 + count) % count];
  built.trackSpawn = {
    x: spawnSample.center.x,
    y: spawnSample.center.y,
    z: spawnSample.center.z,
    heading: spawnSample.heading,
  };
  const finder = makeTrackFinder(samples, count);
  built.track = { samples: samples, count: count, width: width, shoulder: shoulder, finder: finder, checkpoints: checkpoints, arch: arch };

  let straight = null;
  if (prop.scenery === "suzuka") {
    straight = mainStraightLayout(built.track, startIndex);
  }
  if (terrain) {
    // Keep the ground flat beside the track: run-off, gravel, and room for the pits and stands.
    const flat = flatWidths(built.track, rates, function (i, side) {
      if (straight && straight.needsRoom(i, side)) {
        return half + shoulder + 45;
      }
      return 0;
    });
    buildTerrain(built, samples, count, width, finder, flat);
  }
  // The exact height of the ground anywhere (flat ground is at 0).
  const groundAt = built.groundAt || built.heightAt;
  let skipRails = null;
  if (straight) {
    skipRails = dressMainStraight(built, straight, groundAt);
  }
  if (prop.barriers !== false) {
    built.gravelCollider = addGravelTraps(built, built.track, rates, groundAt);
    addGuardrails(built, built.track, rates, groundAt, skipRails);
  }
  if (prop.racingLine) {
    built.racingLine = new RacingLine(built.scene, samples, count, width);
    built.meshes.push(built.racingLine.mesh);
  }
  if (prop.scenery === "suzuka") {
    dressSuzuka(built, samples, count, width, startIndex);
  } else if (prop.scenery === "countryside") {
    const size = built.level.ground.size || 1000;
    addCountryside(built, samples, count, { reach: size / 2 - 100, hillsAt: size / 2 - 60, tallSideDeg: 90 });
  }
  placeArch(built, 0);
}

// How much of the track's height at curve position t (0..1) is bridge (4th number in each point).
function liftAt(points, t) {
  const position = t * points.length;
  const a = Math.floor(position) % points.length;
  const b = (a + 1) % points.length;
  const f = position - Math.floor(position);
  const liftA = points[a][3] || 0;
  const liftB = points[b][3] || 0;
  return liftA + (liftB - liftA) * f;
}

// Hilly ground shaped around the track: near the road it sits just below the asphalt, farther away
// it blends between the heights of the nearby parts of the track. One trimesh for physics.
// flat[side][i]: how far from the center line the ground stays flat (see flatWidths).
function buildTerrain(built, samples, count, width, finder, flat) {
  const size = built.level.ground.size || 3000;
  const cells = 340; // ~9 m grid
  const half = width / 2;
  // A thinned-out list of track points with the natural ground height (bridges taken off),
  // used to blend the hills between parts of the track.
  const guide = [];
  for (let i = 0; i < count; i = i + 5) {
    const s = samples[i];
    guide.push({ x: s.center.x, z: s.center.z, h: s.center.y - s.raised - 0.04 });
  }
  function notBridge(i) {
    return samples[i].raised <= 1.5; // bridges don't hold the ground up
  }
  function heightAt(x, z) {
    let total = 0;
    let weights = 0;
    for (const g of guide) {
      const dx = g.x - x;
      const dz = g.z - z;
      const d2 = dx * dx + dz * dz;
      const w = 1 / ((d2 + 900) * (d2 + 900));
      total = total + g.h * w;
      weights = weights + w;
    }
    let h = total / weights;
    // Never above the road nearby: just under the asphalt out to the edge of the run-off,
    // then sloping up gently.
    const road = finder.nearest(x, z, notBridge);
    if (road.index >= 0) {
      const s = samples[road.index];
      let side = 1;
      if ((x - s.center.x) * s.right.x + (z - s.center.z) * s.right.z < 0) {
        side = -1;
      }
      const away = Math.max(0, road.distance - flat[side][road.index]);
      const cap = s.center.y - 0.04 - 0.25 + away * 0.3;
      if (h > cap) {
        h = cap;
      }
    }
    return h;
  }
  const geometry = new THREE.PlaneGeometry(size, size, cells, cells);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    position.setY(i, heightAt(position.getX(i), position.getZ(i)));
  }
  geometry.computeVertexNormals();
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * size) / TILE_METERS.grass, (uv.getY(i) * size) / TILE_METERS.grass);
  }
  const mesh = new THREE.Mesh(geometry, surfaceMaterial("grass"));
  mesh.receiveShadow = true;
  addMesh(built, mesh);
  const collider = built.RAPIER.ColliderDesc.trimesh(new Float32Array(position.array), new Uint32Array(geometry.index.array)).setFriction(1.0);
  built.groundCollider = built.world.createCollider(collider);
  built.fixedColliders.push(built.groundCollider);
  built.grassGround = true;

  // The exact height of the ground's triangles anywhere (what the car actually drives on).
  // Grid point (ix, iz) is at x = -size/2 + ix * step, z = -size/2 + iz * step. Each grid cell
  // is two triangles split along the diagonal from (ix, iz + 1) to (ix + 1, iz).
  const step = size / cells;
  const row = cells + 1;
  built.groundAt = function (x, z) {
    const gx = THREE.MathUtils.clamp((x + size / 2) / step, 0, cells - 0.0001);
    const gz = THREE.MathUtils.clamp((z + size / 2) / step, 0, cells - 0.0001);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const a = position.getY(iz * row + ix);
    const b = position.getY((iz + 1) * row + ix);
    const c = position.getY((iz + 1) * row + ix + 1);
    const d = position.getY(iz * row + ix + 1);
    if (fx + fz <= 1) {
      return a + (d - a) * fx + (b - a) * fz;
    }
    return c + (b - c) * (1 - fx) + (d - c) * (1 - fz);
  };
  built.heightAt = built.groundAt;

  // The road's edges, dropping a little into the ground, so there's never a gap under the asphalt.
  const edges = [];
  const edgeIndices = [];
  for (let i = 0; i <= count; i++) {
    const s = samples[i];
    for (const side of [-1, 1]) {
      const edge = s.center.clone().addScaledVector(s.right, side * (half + built.track.shoulder));
      edges.push(edge.x, edge.y - 0.02, edge.z, edge.x, edge.y - 0.9, edge.z);
    }
  }
  for (let i = 0; i < count; i++) {
    for (let side = 0; side < 2; side++) {
      const a = i * 4 + side * 2;
      const b = (i + 1) * 4 + side * 2;
      edgeIndices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edges, 3));
  edgeGeometry.setIndex(edgeIndices);
  edgeGeometry.computeVertexNormals();
  addMesh(built, new THREE.Mesh(edgeGeometry, new THREE.MeshStandardMaterial({ color: 0x3d4033, roughness: 1, side: THREE.DoubleSide })));
}

// Which side of sample i is the inside of the circuit (+1 = its right, -1 = its left)?
function insideSide(samples, count, i) {
  let cx = 0;
  let cz = 0;
  for (let k = 0; k < count; k = k + 10) {
    cx = cx + samples[k].center.x;
    cz = cz + samples[k].center.z;
  }
  cx = cx / Math.ceil(count / 10);
  cz = cz / Math.ceil(count / 10);
  const towardMiddle = (cx - samples[i].center.x) * samples[i].right.x + (cz - samples[i].center.z) * samples[i].right.z;
  if (towardMiddle < 0) {
    return -1;
  }
  return 1;
}

// Where things go on Suzuka's main straight: the pit lane on the inside from 260 m before the
// line to 300 m after it, and a 300 m grandstand opposite.
function mainStraightLayout(track, startIndex) {
  const count = track.count;
  const layout = {
    startIndex: startIndex,
    inside: insideSide(track.samples, count, startIndex),
    pitFrom: (startIndex - 130 + count) % count,
    pitTo: (startIndex + 150) % count,
    standIndex: (startIndex + 15) % count,
  };
  layout.standFrom = (layout.standIndex - 80 + count) % count;
  layout.standTo = (layout.standIndex + 80) % count;
  // Does sample i need flat ground on this side for the pits or the stands?
  layout.needsRoom = function (i, side) {
    if (side === layout.inside) {
      return inRange(i, (layout.pitFrom - 10 + count) % count, (layout.pitTo + 10) % count, count);
    }
    return inRange(i, layout.standFrom, layout.standTo, count);
  };
  return layout;
}

// Suzuka's main straight: the pit lane and garages on the inside, a long grandstand opposite.
// Returns which stretches don't need guardrails (the pit wall and the grandstand are the
// barriers there).
function dressMainStraight(built, layout, groundAt) {
  const track = built.track;
  const samples = track.samples;
  const count = track.count;
  const edge = track.width / 2 + track.shoulder;
  const start = samples[layout.startIndex];
  const inside = layout.inside;
  const pitFrom = layout.pitFrom;
  const pitTo = layout.pitTo;

  // The pit lane, and the garages behind it (doors facing the track).
  addPitLane(built, track, pitFrom, pitTo, inside, groundAt);
  const pit = start.center.clone().addScaledVector(start.right, inside * (edge + 22)).addScaledVector(start.forward, 60);
  let pitHeading = start.heading;
  if (inside > 0) {
    pitHeading = start.heading + 180;
  }
  addPitBuilding(built, pit.x, pit.z, 240, pitHeading, groundAt);

  // A 300 m grandstand across the track, its seats rising away from it.
  const s = samples[layout.standIndex];
  const front = s.center.clone().addScaledVector(s.right, -inside * (edge + 7));
  let standHeading = s.heading;
  if (inside < 0) {
    standHeading = s.heading + 180;
  }
  addGrandstand(built, front.x, front.z, standHeading, 300, groundAt);
  built.landmarks = [pit, front];

  return function (i, side) {
    if (side === inside) {
      return inRange(i, pitFrom, pitTo, count);
    }
    return inRange(i, layout.standFrom, layout.standTo, count);
  };
}

// The rest of Suzuka's surroundings: the famous Ferris wheel behind the grandstand, then woods
// and hills (taller to the north-west, like the Suzuka mountains).
function dressSuzuka(built, samples, count, width, startIndex) {
  const groundAt = built.groundAt || built.heightAt;
  const start = samples[startIndex];
  const inside = insideSide(samples, count, startIndex);
  const wheel = start.center.clone().addScaledVector(start.right, -inside * 170).addScaledVector(start.forward, -260);
  addFerrisWheel(built, wheel.x, wheel.z, start.heading, groundAt);
  const landmarks = (built.landmarks || []).concat([wheel]);
  addCountryside(built, samples, count, { reach: 1400, hillsAt: 1450, tallSideDeg: 45, landmarks: landmarks });
}

// Woods and hills around a circuit. options: reach (how far out the trees go, from the middle of
// the circuit), hillsAt (where the hills start), tallSideDeg (which way the hills are tallest),
// landmarks (spots to keep clear of trees).
function addCountryside(built, samples, count, options) {
  const groundAt = built.groundAt || built.heightAt;
  // The middle of the circuit.
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < count; i = i + 10) {
    cx = cx + samples[i].center.x;
    cz = cz + samples[i].center.z;
  }
  cx = cx / Math.ceil(count / 10);
  cz = cz / Math.ceil(count / 10);

  // Woods: patches of dense forest plus trees dotted around, all kept ~40 m from the track
  // (clear of the gravel and guardrails) and away from the landmarks.
  const reach = options.reach;
  const nearTrack = new Set();
  for (let i = 0; i < count; i = i + 3) {
    const s = samples[i];
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        nearTrack.add(Math.floor(s.center.x / 10 + dx) + "," + Math.floor(s.center.z / 10 + dz));
      }
    }
  }
  const landmarks = options.landmarks || [];
  function keepClear(x, z) {
    if (nearTrack.has(Math.floor(x / 10) + "," + Math.floor(z / 10))) {
      return true;
    }
    if ((x - cx) * (x - cx) + (z - cz) * (z - cz) > reach * reach) {
      return true;
    }
    for (const spot of landmarks) {
      if (Math.abs(spot.x - x) < 140 && Math.abs(spot.z - z) < 140) {
        return true;
      }
    }
    return false;
  }
  // Fewer trees for a smaller area (the numbers are right for Suzuka's 1400 m).
  const density = (reach * reach) / (1400 * 1400);
  const random = makeRandom(31);
  const dotted = scatter(Math.round(1500 * density), cx - reach, cx + reach, cz - reach, cz + reach, keepClear, 21);
  addTrees(built, dotted, groundAt, 21, 1);
  const forest = [];
  const patches = Math.round(60 * density);
  for (let patch = 0; patch < patches; patch++) {
    const px = cx - reach + random() * 2 * reach;
    const pz = cz - reach + random() * 2 * reach;
    const radius = 60 + random() * 120;
    const inPatch = scatter(60, px - radius, px + radius, pz - radius, pz + radius, function (x, z) {
      return keepClear(x, z) || (x - px) * (x - px) + (z - pz) * (z - pz) > radius * radius;
    }, 100 + patch);
    for (const spot of inPatch) {
      forest.push(spot);
    }
  }
  addTrees(built, forest, groundAt, 22, 1.6);

  // Hills, starting just inside the edge of the ground.
  let base = 0;
  for (let k = 0; k < 36; k++) {
    const angle = (k / 36) * Math.PI * 2;
    base = base + groundAt(cx + Math.cos(angle) * options.hillsAt, cz + Math.sin(angle) * options.hillsAt);
  }
  addDistantHills(built, cx, cz, options.hillsAt, base / 36, options.tallSideDeg);
}

// Move the green arch to checkpoint number k.
export function placeArch(built, k) {
  const checkpoint = built.track.checkpoints[k];
  built.track.arch.position.copy(checkpoint.position);
  // The torus is drawn in its own XY plane; turn it to stand across the track.
  built.track.arch.rotation.set(0, THREE.MathUtils.degToRad(checkpoint.heading), 0);
}

function liftPoints(points, extra) {
  for (const p of points) {
    p.y = p.y + extra;
  }
}

function makeCheckeredLine(width, depth) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  const squares = 16;
  for (let i = 0; i < squares; i++) {
    for (let row = 0; row < 2; row++) {
      if ((i + row) % 2 === 0) {
        ctx.fillStyle = "#ffffff";
      } else {
        ctx.fillStyle = "#111111";
      }
      ctx.fillRect(i * 16, row * 16, 16, 16);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ map: texture, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
  );
}

// =====================================================================================
// Parking lot
// { "type": "parking_lot", "x": 0, "z": 0, "pairs": 3, "spotsPerRow": 18,
//   "freeSpot": [pair, row, index], "rival": true, "cruisers": 3, "shoppers": 6, "carts": 8 }
// Rows of spots run along X. Each "pair" is two rows parked back to back, with an aisle
// on both sides. (x, z) is the middle of the lot's front edge; the store is at the back (+Z).
// =====================================================================================

export function buildParkingLot(built, prop) {
  const random = makeRandom(prop.seed || 7);
  const spotW = prop.spotWidth || 2.8;
  const spotD = prop.spotDepth || 5.6;
  const aisle = prop.aisleWidth || 8;
  const pairs = prop.pairs || 3;
  const perRow = prop.spotsPerRow || 18;
  const lotW = perRow * spotW;
  const pairDepth = 2 * spotD + aisle;
  const lotDepth = pairs * pairDepth + aisle;
  const ox = prop.x || 0;
  const oz = prop.z || 0;
  const sideLaneX = lotW / 2 + aisle / 2; // the lanes running along both sides of the lot

  // Turn lot coordinates (u across, v deep) into world coordinates.
  function world(u, v) {
    return [ox + u, oz + v];
  }
  function aisleV(k) {
    return k * pairDepth + aisle / 2;
  }

  // ----- Ground paint: asphalt, spot lines -----
  const paint = new FlatPaint();
  addMesh(built, makeGroundPatch("asphalt", ox, oz + lotDepth / 2 + 10, lotW + aisle * 2 + 10, lotDepth + 60, 0, 0.01));
  const spots = [];
  for (let p = 0; p < pairs; p++) {
    for (let row = 0; row < 2; row++) {
      const rowStart = p * pairDepth + aisle + row * spotD;
      const rowMiddle = rowStart + spotD / 2;
      for (let j = 0; j <= perRow; j++) {
        const u = -lotW / 2 + j * spotW;
        const spot = world(u, rowMiddle);
        paint.add(spot[0], spot[1], 0.14, spotD, 0, "#eeeeee", 0.05);
      }
      for (let j = 0; j < perRow; j++) {
        const u = -lotW / 2 + (j + 0.5) * spotW;
        const place = world(u, rowMiddle);
        // Row 0 opens onto the aisle in front (-Z), so cars park nose in, facing +Z. Row 1 faces -Z.
        let heading = 0;
        if (row === 1) {
          heading = 180;
        }
        spots.push({ pair: p, row: row, index: j, x: place[0], z: place[1], heading: heading });
      }
    }
    // The line where the two rows meet back to back.
    const back = world(0, p * pairDepth + aisle + spotD);
    paint.add(back[0], back[1], lotW, 0.14, 0, "#eeeeee", 0.05);
  }

  // ----- The open spot -----
  const want = prop.freeSpot || [pairs - 1, 1, Math.floor(perRow * 0.7)];
  let free = spots[0];
  for (const spot of spots) {
    if (spot.pair === want[0] && spot.row === want[1] && spot.index === want[2]) {
      free = spot;
    }
  }
  paint.add(free.x, free.z, spotW - 0.3, spotD - 0.3, 0, "#1f6b3f", 0.03);
  addMesh(built, paint.build());
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.8, 1.6, 4),
    new THREE.MeshBasicMaterial({ color: "#39ff88" })
  );
  arrow.rotation.x = Math.PI; // point down
  arrow.position.set(free.x, 4, free.z);
  addMesh(built, arrow);
  built.parkingSpot = {
    x: free.x,
    z: free.z,
    heading: THREE.MathUtils.degToRad(free.heading),
    width: spotW,
    depth: spotD,
    arrow: arrow,
  };

  // ----- Parked cars everywhere else (a few spots hold an abandoned cart instead) -----
  const kinds = ["sedan", "sedan", "suv", "suv", "compact", "van", "pickup"];
  let cartSpots = prop.cartSpots;
  if (cartSpots === undefined) {
    cartSpots = 2;
  }
  for (const spot of spots) {
    if (spot === free) {
      continue;
    }
    if (cartSpots > 0 && random() < 0.04) {
      cartSpots = cartSpots - 1;
      addCart(built, spot.x + (random() - 0.5), spot.z + (random() - 0.5));
      continue;
    }
    const kind = kinds[Math.floor(random() * kinds.length)];
    const color = CAR_COLORS[Math.floor(random() * CAR_COLORS.length)];
    // People never park perfectly straight.
    const heading = spot.heading + (random() - 0.5) * 8;
    const x = spot.x + (random() - 0.5) * 0.3;
    addParkedCar(built, kind, color, x, spot.z, heading);
  }

  // ----- Light poles at the row ends -----
  const poles = new BoxBatch();
  for (let p = 0; p < pairs; p++) {
    for (const side of [-1, 1]) {
      const place = world(side * (lotW / 2 + 0.8), p * pairDepth + aisle + spotD);
      poles.addCylinder(place[0], 4, place[1], 0.15, 8, "#7d838c");
      poles.add(place[0], 8, place[1], 0.4, 0.2, 1.6, 0, "#f4f4f4");
      const pole = built.RAPIER.ColliderDesc.cylinder(4, 0.15).setTranslation(place[0], 4, place[1]);
      built.fixedColliders.push(built.world.createCollider(pole));
    }
  }

  // ----- The store at the back -----
  const storeV = lotDepth + 22;
  const storeFront = world(0, storeV);
  const storeWidth = Math.max(120, lotW + 40);
  const storeDepth = 60;
  poles.add(storeFront[0], 6.5, storeFront[1] + storeDepth / 2, storeWidth, 13, storeDepth, 0, "#d8d2c4");
  poles.add(storeFront[0], 11.5, storeFront[1] - 0.2, storeWidth, 2, 0.4, 0, "#c0392b"); // red band
  poles.add(storeFront[0], 11.5 - 2.2, storeFront[1] - 0.2, storeWidth, 1.2, 0.4, 0, "#1f4e9c"); // blue band
  poles.add(storeFront[0], 2.6, storeFront[1] - 0.1, 14, 5.2, 0.3, 0, "#22272e"); // entrance
  poles.add(storeFront[0], 5.6, storeFront[1] - 3, 18, 0.4, 6, 0, "#e9e9e9"); // canopy
  addFixedBoxCollider(built, storeFront[0], 6.5, storeFront[1] + storeDepth / 2, storeWidth, 13, storeDepth, 0);
  const sign = makeTextSign(["WAREHOUSE CLUB"], 26, 3.2, "#c0392b", "#ffffff");
  sign.position.set(storeFront[0], 11.3, storeFront[1] - 0.5);
  sign.rotation.y = Math.PI; // face the lot (-Z)
  addMesh(built, sign);
  addMesh(built, poles.build());

  // ----- Trees around the lot, and the neighbours (other stores, offices) -----
  const flat = function () {
    return 0;
  };
  const edgeTrees = [];
  for (let v = -20; v < lotDepth + 10; v = v + 9) {
    for (const side of [-1, 1]) {
      const spot = world(side * (lotW / 2 + aisle + 5), v);
      edgeTrees.push(spot);
    }
  }
  for (let u = -lotW / 2 - aisle; u < lotW / 2 + aisle; u = u + 10) {
    edgeTrees.push(world(u, -16));
  }
  addTrees(built, edgeTrees, flat, 5);
  const neighbours = [];
  for (let i = 0; i < 10; i++) {
    let side = 1;
    if (i % 2 === 0) {
      side = -1;
    }
    neighbours.push({
      x: ox + side * (lotW / 2 + aisle + 45 + random() * 40),
      z: oz + (i - 5) * 30 + random() * 10,
      w: 25 + random() * 20,
      d: 20 + random() * 15,
      h: 6 + random() * 12,
      heading: 0,
    });
  }
  for (let i = 0; i < 24; i++) {
    neighbours.push({ x: ox + (random() - 0.5) * 900, z: oz + 260 + random() * 300, w: 25 + random() * 30, d: 25 + random() * 30, h: 15 + random() * 70, heading: 0 });
  }
  addBuildings(built, neighbours, flat, false);
  addDistantHills(built, 0, 0, (built.level.ground.size || 800) / 2 - 40, 0, 200);

  // ----- Loose shopping carts -----
  const cartCount = prop.carts || 0;
  for (let i = 0; i < cartCount; i++) {
    const k = Math.floor(random() * (pairs + 1));
    const place = world((random() - 0.5) * lotW, aisleV(k) + (random() - 0.5) * 3);
    addCart(built, place[0], place[1]);
  }

  // ----- A rival driver heading for YOUR spot -----
  const freeAisle = free.pair + free.row; // row 0 opens onto aisle "pair", row 1 onto aisle "pair + 1"
  const freeU = free.x - ox;
  if (prop.rival) {
    const path = [];
    path.push(world(-sideLaneX, -10));
    path.push(world(-sideLaneX, aisleV(freeAisle)));
    path.push(world(freeU, aisleV(freeAisle)));
    path.push([free.x, free.z]);
    addMover(built, {
      behavior: "rival",
      kind: "suv",
      color: "#8e44ad",
      x: ox - sideLaneX,
      z: oz - 30,
      heading: 0,
      speedKmh: prop.rivalSpeedKmh || 16,
      path: path,
    });
  }

  // ----- Other drivers circling, hunting for a spot -----
  const loop = [];
  for (let k = 0; k <= pairs; k++) {
    const leftToRight = k % 2 === 0;
    if (leftToRight) {
      loop.push(world(-sideLaneX, aisleV(k)));
      loop.push(world(sideLaneX, aisleV(k)));
    } else {
      loop.push(world(sideLaneX, aisleV(k)));
      loop.push(world(-sideLaneX, aisleV(k)));
    }
  }
  // Back to the start down the side lane that the last aisle ended on.
  const lastX = loop[loop.length - 1][0];
  loop.push([lastX, oz - 4]);
  loop.push(world(-sideLaneX, -4));
  const cruisers = prop.cruisers || 0;
  for (let i = 0; i < cruisers; i++) {
    const startIndex = Math.floor((i * loop.length) / cruisers);
    const startPoint = loop[startIndex];
    addMover(built, {
      behavior: "path",
      kind: kinds[i % kinds.length],
      color: CAR_COLORS[(i * 3) % CAR_COLORS.length],
      x: startPoint[0],
      z: startPoint[1],
      heading: 90,
      speedKmh: 13,
      path: loop,
      loop: true,
      pathIndex: (startIndex + 1) % loop.length,
    });
  }

  // ----- Shoppers: walking between the store doors and the front aisle, or along the side lanes -----
  const shoppers = prop.shoppers || 0;
  const shirts = ["#e74c3c", "#3498db", "#f1c40f", "#9b59b6", "#2ecc71", "#e67e22"];
  for (let i = 0; i < shoppers; i++) {
    let path = null;
    if (i % 2 === 0) {
      const door = world((random() - 0.5) * 12, storeV - 3);
      const inAisle = world((random() - 0.5) * lotW, aisleV(pairs));
      path = [door, inAisle];
    } else {
      let side = 1;
      if (random() < 0.5) {
        side = -1;
      }
      const x = side * (lotW / 2 + 1.6);
      path = [world(x, aisleV(0)), world(x, aisleV(pairs))];
    }
    addMover(built, {
      behavior: "walker",
      color: shirts[i % shirts.length],
      x: path[1][0],
      z: path[1][1],
      speedKmh: 4.5,
      path: path,
    });
  }
}

function addParkedCar(built, kind, color, x, z, headingDeg) {
  const size = getCarSize(kind);
  addFixedBoxCollider(built, x, size.height / 2, z, size.width, size.height, size.length, headingDeg);
  const mesh = makeCarMesh(kind, color);
  mesh.position.set(x, 0, z);
  mesh.quaternion.copy(headingToQuaternion(headingDeg));
  addMesh(built, mesh);
}

// A light shopping cart you can knock around.
function addCart(built, x, z) {
  const body = built.world.createRigidBody(built.RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.5, z));
  built.world.createCollider(built.RAPIER.ColliderDesc.cuboid(0.3, 0.5, 0.45).setMass(25).setFriction(0.6), body);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.9), new THREE.MeshStandardMaterial({ color: "#b9c0c8", metalness: 0.6, roughness: 0.4 }));
  mesh.castShadow = true;
  addMesh(built, mesh);
  built.movingProps.push({ mesh: mesh, body: body });
}

// =====================================================================================
// Highway
// { "type": "highway", "z": 0, "length": 2400, "lanesEachWay": 3, "laneWidth": 3.6,
//   "traffic": { "count": 34, "oncoming": 16, "speedsKmh": [120, 100, 80], "jam": { "z": 1300, "length": 150 } } }
// Like Japan, traffic drives on the LEFT: our side (toward +Z) is on the +X side of the median.
// Lane 0 is next to the median (the passing lane); the outside lane is the slow lane.
// =====================================================================================

export function buildHighway(built, prop) {
  const random = makeRandom(prop.seed || 3);
  const start = prop.z || 0;
  const length = prop.length || 2400;
  const end = start + length;
  const lanes = prop.lanesEachWay || 3;
  const laneW = prop.laneWidth || 3.6;
  const medianHalf = 0.9;
  const shoulder = 2.5;
  const carriageway = lanes * laneW;
  const railX = medianHalf + carriageway + shoulder;
  const middleZ = start + length / 2;

  // Lane centers for each direction.
  const laneX = { 1: [], "-1": [] };
  for (let i = 0; i < lanes; i++) {
    laneX[1].push(medianHalf + (i + 0.5) * laneW);
    laneX[-1].push(-(medianHalf + (i + 0.5) * laneW));
  }

  const traffic = prop.traffic || {};
  let jamStart = Infinity;
  let jamEnd = -Infinity;
  if (traffic.jam) {
    jamStart = traffic.jam.z;
    jamEnd = traffic.jam.z + (traffic.jam.length || 150);
  }

  // ----- Road paint -----
  const paint = new FlatPaint();
  addMesh(built, makeGroundPatch("asphalt", 0, middleZ, railX * 2 + 1, length, 0, 0.01));
  for (const dir of [1, -1]) {
    // Solid lines at the median side and the outer edge.
    paint.add(dir * (medianHalf + 0.15), middleZ, 0.15, length, 0, "#f2f2f2", 0.02);
    paint.add(dir * (medianHalf + carriageway), middleZ, 0.15, length, 0, "#f2f2f2", 0.02);
    // Dashed lines between lanes: 8 m painted, 12 m gap.
    for (let i = 1; i < lanes; i++) {
      const x = dir * (medianHalf + i * laneW);
      for (let z = start; z < end; z = z + 20) {
        paint.add(x, z + 4, 0.15, 8, 0, "#f2f2f2", 0.02);
      }
    }
  }
  addMesh(built, paint.build());

  // ----- Barriers: concrete median, guard rails on both sides (solid, so the only way past a jam is up) -----
  const parts = new BoxBatch();
  parts.add(0, 0.45, middleZ, medianHalf * 1.2, 0.9, length, 0, "#b8bcc2");
  addFixedBoxCollider(built, 0, 0.45, middleZ, medianHalf * 1.2, 0.9, length, 0);
  for (const side of [-1, 1]) {
    parts.add(side * railX, 0.7, middleZ, 0.3, 0.35, length, 0, "#d5d9de");
    addFixedBoxCollider(built, side * railX, 0.5, middleZ, 0.4, 1.0, length, 0);
  }
  // Street lamps along the median.
  for (let z = start + 25; z < end; z = z + 50) {
    parts.addCylinder(0, 5, z, 0.12, 10, "#8a9099");
    parts.add(0, 10, z, 7, 0.15, 0.3, 0, "#8a9099");
  }
  // Sign gantries over our side, counting down to the exit.
  for (let z = start + 400; z < end - 150; z = z + 500) {
    if (z > jamStart - 120 && z < jamEnd + 120) {
      continue; // don't hang a sign right over the jam you'll be flying across
    }
    const km = ((end - 80 - z) / 1000).toFixed(1);
    for (const x of [0, railX + 0.6]) {
      parts.add(x, 4, z, 0.4, 8, 0.4, 0, "#8a9099");
    }
    parts.add((railX + 0.6) / 2, 7.6, z, railX + 1.0, 0.4, 0.4, 0, "#8a9099");
    const board = makeTextSign(["出口 EXIT", km + " km"], 7, 2.6, "#0d6b3c", "#ffffff");
    board.position.set((railX + medianHalf) / 2, 6.3, z - 0.25);
    board.rotation.y = Math.PI; // face drivers coming toward +Z
    addMesh(built, board);
    addFixedBoxCollider(built, (railX + medianHalf) / 2, 6.3, z, 7, 2.6, 0.3, 0);
  }
  const exitBoard = makeTextSign(["出口 EXIT"], 7, 1.6, "#0d6b3c", "#ffffff");
  exitBoard.position.set((railX + medianHalf) / 2, 6.3, end - 80 - 0.25);
  exitBoard.rotation.y = Math.PI;
  addMesh(built, exitBoard);
  for (const x of [0, railX + 0.6]) {
    parts.add(x, 4, end - 80, 0.4, 8, 0.4, 0, "#8a9099");
  }
  parts.add((railX + 0.6) / 2, 7.3, end - 80, railX + 1.0, 0.4, 0.4, 0, "#8a9099");
  addMesh(built, parts.build());

  // ----- Surroundings: sound walls, bridges over the road, and the city -----
  addSoundWalls(built, railX + 1.2, start, end);
  for (let z = start + 650; z < end - 200; z = z + 700) {
    if (z > jamStart - 150 && z < jamEnd + 150) {
      continue;
    }
    addOverpass(built, z, railX * 2 + 10);
  }
  addCityAlongRoad(built, start - 100, end + 100, railX + 18, prop.seed || 3);

  // ----- Traffic -----
  const speeds = traffic.speedsKmh || [120, 100, 80];
  const laneSpeeds = [];
  for (let i = 0; i < lanes; i++) {
    laneSpeeds.push(((speeds[Math.min(i, speeds.length - 1)] || 90) * 1000) / 3600);
  }
  built.highway = { start: start, end: end, laneX: laneX, laneSpeeds: laneSpeeds, jamStart: jamStart, jamEnd: jamEnd };

  const kinds = ["sedan", "sedan", "suv", "compact", "van", "sedan", "suv"];
  // The accident jam: every lane blocked, stopped cars and trucks, cones at the front.
  if (traffic.jam) {
    for (let i = 0; i < lanes; i++) {
      let front = jamEnd;
      while (true) {
        let kind = kinds[Math.floor(random() * kinds.length)];
        if (i === lanes - 1 && random() < 0.35) {
          kind = "semi"; // trucks keep to the slow lane
        }
        const size = getCarSize(kind);
        const carZ = front - size.length / 2;
        if (carZ - size.length / 2 < jamStart) {
          break;
        }
        addMover(built, { behavior: "stopped", kind: kind, x: laneX[1][i] + (random() - 0.5) * 0.5, z: carZ, heading: (random() - 0.5) * 6, dir: 1 });
        front = front - size.length - 1.5 - random() * 1.5;
      }
    }
    // The crash at the front: two cars sideways, with cones around them.
    addMover(built, { behavior: "stopped", kind: "sedan", color: "#c0392b", x: laneX[1][0] + 1, z: jamEnd + 8, heading: 70, dir: 1 });
    addMover(built, { behavior: "stopped", kind: "suv", color: "#ecf0f1", x: laneX[1][lanes - 1] - 0.5, z: jamEnd + 11, heading: -40, dir: 1 });
    for (let x = medianHalf + 1; x < medianHalf + carriageway; x = x + 2) {
      addCone(built, x, jamEnd + 18);
    }
  }

  // Moving traffic, spread out ahead of the start (the player spawns near the start).
  const count = traffic.count || 0;
  let placed = 0;
  let tries = 0;
  while (placed < count && tries < count * 20) {
    tries = tries + 1;
    const lane = Math.floor(random() * lanes);
    const z = start + 40 + random() * 560;
    if (z > jamStart - 25 && z < jamEnd + 25) {
      continue;
    }
    if (!roomAt(built, 1, laneX[1][lane], z, 24)) {
      continue;
    }
    let kind = kinds[Math.floor(random() * kinds.length)];
    if (lane === lanes - 1 && random() < 0.4) {
      kind = "semi"; // trucks keep to the slow lane
    }
    addMover(built, { behavior: "lane", kind: kind, x: laneX[1][lane], z: z, heading: 0, dir: 1, lane: lane, speedKmh: (laneSpeeds[lane] * 3600) / 1000 });
    placed = placed + 1;
  }
  // Oncoming traffic on the other side of the median.
  const oncoming = traffic.oncoming || 0;
  placed = 0;
  tries = 0;
  while (placed < oncoming && tries < oncoming * 20) {
    tries = tries + 1;
    const lane = Math.floor(random() * lanes);
    const z = start + 50 + random() * 900;
    if (!roomAt(built, -1, laneX[-1][lane], z, 24)) {
      continue;
    }
    const kind = kinds[Math.floor(random() * kinds.length)];
    addMover(built, { behavior: "lane", kind: kind, x: laneX[-1][lane], z: z, heading: 180, dir: -1, lane: lane, speedKmh: (laneSpeeds[lane] * 3600) / 1000 });
    placed = placed + 1;
  }
}

function roomAt(built, dir, x, z, room) {
  for (const other of built.movers) {
    if (other.dir === dir && Math.abs(other.position.x - x) < 2.2 && Math.abs(other.position.z - z) < room) {
      return false;
    }
  }
  return true;
}

function addCone(built, x, z) {
  const body = built.world.createRigidBody(built.RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.35, z));
  built.world.createCollider(built.RAPIER.ColliderDesc.cone(0.35, 0.22).setMass(4).setFriction(0.8), body);
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 16), new THREE.MeshStandardMaterial({ color: "#ff6a1a", roughness: 0.6 }));
  mesh.castShadow = true;
  addMesh(built, mesh);
  built.movingProps.push({ mesh: mesh, body: body });
}
