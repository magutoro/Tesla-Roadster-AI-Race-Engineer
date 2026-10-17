// trackside.js — Owner: B (friend)
// What makes a race track look like a real circuit:
//   - finding the corners (curbs only go in corners; straights just get a white line)
//   - gravel traps on the outside of corners (they slow you down, like real gravel)
//   - steel guardrails along both sides
//   - a pit lane with a pit wall, and grandstands with a crowd
//   - forested hills on the horizon
// Everything that sits on the ground asks groundAt(x, z) for the ground's height there.

import * as THREE from "three";
import { addMesh, headingToQuaternion } from "./level-utils.js";
import { surfaceMaterial, TILE_METERS } from "./materials.js";

// =====================================================================================
// Where the corners are
// =====================================================================================

// How quickly the track turns at each sample, in 1 / meters (that is, 1 / turning radius).
// Positive means it turns toward the sample's `right` side.
export function turnRates(samples, count) {
  const reach = 5; // compare the direction 5 samples (~10 m) before and after
  const spacing = samples[0].center.distanceTo(samples[1].center);
  const rates = [];
  for (let i = 0; i < count; i++) {
    const a = samples[(i - reach + count) % count].forward;
    const b = samples[(i + reach) % count].forward;
    const cross = a.x * b.z - a.z * b.x;
    const dot = a.x * b.x + a.z * b.z;
    rates.push(Math.atan2(cross, dot) / (2 * reach * spacing));
  }
  return rates;
}

// 0 on straights and gentle bends, rising to 1 in tight corners (radius under 150 m).
export function cornerAmounts(rates) {
  return rates.map(function (rate) {
    return THREE.MathUtils.clamp((Math.abs(rate) - 1 / 400) / (1 / 150 - 1 / 400), 0, 1);
  });
}

// Where to paint curbs: anywhere near a corner (1) or not (0).
export function curbPlaces(rates) {
  const inCorner = cornerAmounts(rates).map(function (amount) {
    if (amount > 0.05) {
      return 1;
    }
    return 0;
  });
  return widen(inCorner, 8);
}

// How much gravel trap goes on each side of each sample (0..1): only on the outside of corners,
// starting a little before the corner and running out past it (where cars slide off).
export function gravelAmounts(rates) {
  const corner = cornerAmounts(rates);
  const result = {};
  for (const side of [-1, 1]) {
    const raw = [];
    for (let i = 0; i < rates.length; i++) {
      let outside = 1;
      if (rates[i] > 0) {
        outside = -1;
      }
      if (outside === side) {
        raw.push(corner[i]);
      } else {
        raw.push(0);
      }
    }
    result[side] = soften(widen(raw, 14), 10);
  }
  return result;
}

// How far from the center line the gravel reaches, on each side of each sample (meters).
// Where there's no gravel this is just past the curbs.
export function gravelEdges(track, rates) {
  const amounts = gravelAmounts(rates);
  const start = track.width / 2 + track.shoulder + 2;
  const edges = {};
  for (const side of [-1, 1]) {
    edges[side] = amounts[side].map(function (amount) {
      return start + 20 * amount;
    });
  }
  return edges;
}

// How far out the ground must be graded flat (just under the road) on each side of each
// sample: the run-off, the gravel and the guardrails. extra(i, side) can ask for more
// (room for a pit lane or a grandstand).
export function flatWidths(track, rates, extra) {
  const gravel = gravelEdges(track, rates);
  const widths = {};
  for (const side of [-1, 1]) {
    widths[side] = [];
    for (let i = 0; i < track.count; i++) {
      let width = gravel[side][i] + 10;
      if (extra) {
        width = Math.max(width, extra(i, side));
      }
      widths[side].push(width);
    }
  }
  return widths;
}

// For each sample, the biggest value within `reach` samples either side (the track is a loop).
export function widen(values, reach) {
  const count = values.length;
  const result = [];
  for (let i = 0; i < count; i++) {
    let biggest = 0;
    for (let k = -reach; k <= reach; k++) {
      biggest = Math.max(biggest, values[(i + k + count) % count]);
    }
    result.push(biggest);
  }
  return result;
}

// For each sample, the average within `reach` samples either side.
export function soften(values, reach) {
  const count = values.length;
  const result = [];
  for (let i = 0; i < count; i++) {
    let total = 0;
    for (let k = -reach; k <= reach; k++) {
      total = total + values[(i + k + count) % count];
    }
    result.push(total / (2 * reach + 1));
  }
  return result;
}

// Quickly find the track near any spot. Track points are kept in 10 m buckets.
export function makeTrackFinder(samples, count) {
  const buckets = new Map();
  for (let i = 0; i < count; i++) {
    const key = Math.floor(samples[i].center.x / 10) + "," + Math.floor(samples[i].center.z / 10);
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(i);
  }
  // The closest track point within ~30 m that passes test(i). Returns { distance, index }.
  function nearest(x, z, test) {
    const bx = Math.floor(x / 10);
    const bz = Math.floor(z / 10);
    let best = Infinity;
    let bestIndex = -1;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const list = buckets.get(bx + dx + "," + (bz + dz));
        if (!list) {
          continue;
        }
        for (const i of list) {
          if (test && !test(i)) {
            continue;
          }
          const s = samples[i];
          const d2 = (s.center.x - x) * (s.center.x - x) + (s.center.z - z) * (s.center.z - z);
          if (d2 < best) {
            best = d2;
            bestIndex = i;
          }
        }
      }
    }
    return { distance: Math.sqrt(best), index: bestIndex };
  }
  // How close is (x, z) to a DIFFERENT part of the track than sample i? (Not counting the
  // stretch of track around sample i itself.)
  function distanceToOtherTrack(x, z, i) {
    return nearest(x, z, function (other) {
      const apart = Math.abs(other - i);
      return Math.min(apart, count - apart) > 40;
    }).distance;
  }
  return { nearest: nearest, distanceToOtherTrack: distanceToOtherTrack };
}

// Are sample indices a..b (going forward around the loop) covering sample i?
export function inRange(i, a, b, count) {
  const fromA = (i - a + count) % count;
  const length = (b - a + count) % count;
  return fromA <= length;
}

// =====================================================================================
// Gravel traps
// =====================================================================================

// Gravel on the outside of corners, from 2 m past the track edge out to ~20 m. It gets its own
// collider so the car can tell it's on gravel (less grip, lots of drag). Returns the collider.
export function addGravelTraps(built, track, rates, groundAt) {
  const samples = track.samples;
  const count = track.count;
  const half = track.width / 2;
  const edges = gravelEdges(track, rates);
  const finder = track.finder;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (const side of [-1, 1]) {
    const inner = new Array(count).fill(half + track.shoulder + 2);
    const outer = edges[side];
    const keep = function (i) {
      if (outer[i] - inner[i] < 2 || samples[i].raised > 0.3) {
        return false;
      }
      // Never spill onto another part of the track.
      for (const offset of [inner[i], outer[i]]) {
        const x = samples[i].center.x + samples[i].right.x * side * offset;
        const z = samples[i].center.z + samples[i].right.z * side * offset;
        if (finder.distanceToOtherTrack(x, z, i) < half + track.shoulder + 3) {
          return false;
        }
      }
      return true;
    };
    groundStrip(samples, count, side, inner, outer, keep, groundAt, 0.06, TILE_METERS.gravel, positions, uvs, indices);
  }
  if (indices.length === 0) {
    return null;
  }
  const geometry = stripGeometry(positions, uvs, indices);
  const mesh = new THREE.Mesh(geometry, onTopMaterial("gravel"));
  mesh.receiveShadow = true;
  addMesh(built, mesh);
  const desc = built.RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices)).setFriction(1.0);
  const collider = built.world.createCollider(desc);
  built.fixedColliders.push(collider);
  return collider;
}

// Adds a strip lying on the ground on one side of the track, from inner[i] to outer[i] meters
// from the center line, to the given lists. Samples where keep(i) is false are left out.
function groundStrip(samples, count, side, inner, outer, keep, groundAt, lift, tile, positions, uvs, indices) {
  const across = 8; // vertices across the strip, so it follows the shape of the ground
  let previousRow = -1; // first vertex of the previous row, or -1 if that row was left out
  let distance = 0;
  for (let n = 0; n <= count; n++) {
    const i = n % count;
    if (n > 0) {
      distance = distance + samples[n].center.distanceTo(samples[n - 1].center);
    }
    if (!keep(i)) {
      previousRow = -1;
      continue;
    }
    const s = samples[i];
    const row = positions.length / 3;
    for (let j = 0; j <= across; j++) {
      const offset = inner[i] + ((outer[i] - inner[i]) * j) / across;
      const x = s.center.x + s.right.x * side * offset;
      const z = s.center.z + s.right.z * side * offset;
      positions.push(x, groundAt(x, z) + lift, z);
      uvs.push(offset / tile, distance / tile);
    }
    if (previousRow >= 0) {
      for (let j = 0; j < across; j++) {
        const a = previousRow + j;
        const b = row + j;
        // Wind the triangles so they face up on either side of the track.
        if (side > 0) {
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        } else {
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    previousRow = row;
  }
}

// A ground material that wins against the grass under it (no flickering where they meet).
const onTopMaterials = {};
function onTopMaterial(name) {
  if (!onTopMaterials[name]) {
    const material = surfaceMaterial(name).clone();
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    onTopMaterials[name] = material;
  }
  return onTopMaterials[name];
}

function stripGeometry(positions, uvs, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// =====================================================================================
// Guardrails
// =====================================================================================

// Steel guardrails on both sides: ~10 m of run-off on straights, behind the gravel in corners.
// skip(i, side) can leave out stretches (where a pit wall or grandstand is already the barrier).
export function addGuardrails(built, track, rates, groundAt, skip) {
  const samples = track.samples;
  const count = track.count;
  const half = track.width / 2;
  const edges = gravelEdges(track, rates);
  const finder = track.finder;
  const rail = { positions: [], indices: [] };
  const posts = [];
  for (const side of [-1, 1]) {
    const wanted = [];
    for (let i = 0; i < count; i++) {
      wanted.push(Math.max(half + track.shoulder + 10, edges[side][i] + 4));
    }
    const offsets = soften(wanted, 8);
    let previousRow = -1;
    for (let n = 0; n <= count; n++) {
      const i = n % count;
      const s = samples[i];
      const x = s.center.x + s.right.x * side * offsets[i];
      const z = s.center.z + s.right.z * side * offsets[i];
      const blocked =
        (skip && skip(i, side)) ||
        s.raised > 1.0 ||
        finder.distanceToOtherTrack(x, z, i) < half + track.shoulder + 3;
      if (blocked) {
        previousRow = -1;
        continue;
      }
      const ground = groundAt(x, z);
      const row = rail.positions.length / 3;
      // Two rows of vertices: the bottom and top of the steel beam (0.35 m to 0.85 m up).
      rail.positions.push(x, ground + 0.35, z, x, ground + 0.85, z);
      if (previousRow >= 0) {
        rail.indices.push(previousRow, row, previousRow + 1, previousRow + 1, row, row + 1);
      }
      previousRow = row;
      if (i % 2 === 0) {
        posts.push([x + s.right.x * side * 0.2, ground, z + s.right.z * side * 0.2]);
      }
    }
  }
  if (rail.indices.length === 0) {
    return;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(rail.positions, 3));
  geometry.setIndex(rail.indices);
  geometry.computeVertexNormals();
  const steel = new THREE.MeshStandardMaterial({ color: 0xc3c8ce, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, steel);
  mesh.castShadow = true;
  addMesh(built, mesh);

  // Posts holding the rail up, one every ~4 m.
  const postGeometry = new THREE.BoxGeometry(0.12, 1.0, 0.12);
  postGeometry.translate(0, 0.45, 0);
  const postMesh = new THREE.InstancedMesh(postGeometry, new THREE.MeshStandardMaterial({ color: 0x8d939a, metalness: 0.5, roughness: 0.5 }), posts.length);
  const matrix = new THREE.Matrix4();
  for (let k = 0; k < posts.length; k++) {
    matrix.makeTranslation(posts[k][0], posts[k][1], posts[k][2]);
    postMesh.setMatrixAt(k, matrix);
  }
  addMesh(built, postMesh);

  // Physics: a taller invisible wall in the same place, so the car can't hop over the rail.
  const wall = [];
  for (let k = 0; k < rail.positions.length; k = k + 6) {
    wall.push(rail.positions[k], rail.positions[k + 1] - 1.0, rail.positions[k + 2]);
    wall.push(rail.positions[k + 3], rail.positions[k + 4] + 0.6, rail.positions[k + 5]);
  }
  const desc = built.RAPIER.ColliderDesc.trimesh(new Float32Array(wall), new Uint32Array(rail.indices));
  built.fixedColliders.push(built.world.createCollider(desc));
}

// =====================================================================================
// Pit lane
// =====================================================================================

// A pit lane beside the track from sample a to sample b on one side: a concrete pit wall with a
// fence on top, and an asphalt lane behind it in front of the garages.
export function addPitLane(built, track, a, b, side, groundAt) {
  const samples = track.samples;
  const count = track.count;
  const half = track.width / 2;
  const edge = half + track.shoulder;
  const keep = function (i) {
    return inRange(i, a, b, count);
  };
  // The lane, from just behind the wall to the garage doors.
  const inner = new Array(count).fill(edge + 1.2);
  const outer = new Array(count).fill(edge + 14);
  const positions = [];
  const uvs = [];
  const indices = [];
  groundStrip(samples, count, side, inner, outer, keep, groundAt, 0.05, TILE_METERS.asphalt, positions, uvs, indices);
  if (indices.length > 0) {
    const lane = new THREE.Mesh(stripGeometry(positions, uvs, indices), onTopMaterial("asphalt"));
    lane.receiveShadow = true;
    addMesh(built, lane);
  }

  // The wall: from below the ground up to 1.1 m above the track, and a fence above it.
  const wall = { positions: [], indices: [] };
  const fence = { positions: [], uvs: [], indices: [] };
  let previousRow = -1;
  let distance = 0;
  for (let n = a; n !== (b + 1) % count; n = (n + 1) % count) {
    const s = samples[n];
    const next = samples[(n + 1) % count];
    const x = s.center.x + s.right.x * side * (edge + 0.6);
    const z = s.center.z + s.right.z * side * (edge + 0.6);
    const bottom = Math.min(groundAt(x, z), s.center.y) - 1;
    const top = s.center.y + 1.1;
    const row = wall.positions.length / 3;
    wall.positions.push(x, bottom, z, x, top, z);
    fence.positions.push(x, top, z, x, top + 3, z);
    fence.uvs.push(distance / 2, 0, distance / 2, 1.5);
    if (previousRow >= 0) {
      wall.indices.push(previousRow, row, previousRow + 1, previousRow + 1, row, row + 1);
      fence.indices.push(previousRow, row, previousRow + 1, previousRow + 1, row, row + 1);
    }
    previousRow = row;
    distance = distance + s.center.distanceTo(next.center);
  }
  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute("position", new THREE.Float32BufferAttribute(wall.positions, 3));
  wallGeometry.setIndex(wall.indices);
  wallGeometry.computeVertexNormals();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xe2e4e6, roughness: 0.8, side: THREE.DoubleSide });
  const wallMesh = new THREE.Mesh(wallGeometry, concrete);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  addMesh(built, wallMesh);
  const fenceGeometry = new THREE.BufferGeometry();
  fenceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fence.positions, 3));
  fenceGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(fence.uvs, 2));
  fenceGeometry.setIndex(fence.indices);
  fenceGeometry.computeVertexNormals();
  addMesh(built, new THREE.Mesh(fenceGeometry, fenceMaterial()));
  const desc = built.RAPIER.ColliderDesc.trimesh(new Float32Array(wall.positions), new Uint32Array(wall.indices));
  built.fixedColliders.push(built.world.createCollider(desc));
}

// =====================================================================================
// Grandstands
// =====================================================================================

// A covered grandstand full of people. Its front (a wall with a fence on top) is at (x, z); it
// runs along headingDeg and the seats rise away from the track toward its local +X. Long stands
// are built in pieces that step down with the ground, like real ones on a slope.
export function addGrandstand(built, x, z, headingDeg, length, groundAt) {
  const rotation = headingToQuaternion(headingDeg);
  const along = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
  const pieces = Math.max(1, Math.round(length / 60));
  const pieceLength = length / pieces;
  for (let k = 0; k < pieces; k++) {
    const shift = -length / 2 + pieceLength * (k + 0.5);
    const px = x + along.x * shift;
    const pz = z + along.z * shift;
    const group = makeStandPiece(pieceLength - 0.6);
    group.position.set(px, groundAt(px, pz), pz);
    group.quaternion.copy(rotation);
    addMesh(built, group);
    // Physics: the solid wedge of the stand (the fence and roof are just for looks).
    const profile = [[0, -4], [0, STAND.wallHeight + 0.3], [STAND.depth + 0.5, STAND.wallHeight + STAND.rise + 0.6], [STAND.depth + 1.5, STAND.wallHeight + STAND.rise + 0.6], [STAND.depth + 1.5, -4]];
    const points = [];
    for (const end of [-pieceLength / 2, pieceLength / 2]) {
      for (const p of profile) {
        const local = new THREE.Vector3(p[0], p[1], end).applyQuaternion(rotation);
        points.push(px + local.x, group.position.y + local.y, pz + local.z);
      }
    }
    const desc = built.RAPIER.ColliderDesc.convexHull(new Float32Array(points));
    if (desc) {
      built.fixedColliders.push(built.world.createCollider(desc));
    }
  }
}

const STAND = {
  wallHeight: 2.4, // the wall in front of the first row
  depth: 22, // how far back the seats go
  rise: 12, // how much higher the last row is than the first
  rows: 26,
  roofHeight: 18,
};

function makeStandPiece(length) {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xd5d8dc, roughness: 0.85 });

  // Front wall, with advertising boards facing the track.
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, STAND.wallHeight + 4, length), concrete);
  wall.position.set(0.25, (STAND.wallHeight - 4) / 2, 0);
  group.add(wall);
  const boards = new THREE.Mesh(new THREE.PlaneGeometry(length, 1.2), boardMaterial(length));
  boards.rotation.y = -Math.PI / 2; // face the track (local -X)
  boards.position.set(-0.02, 1.0, 0);
  group.add(boards);

  // The seats: one sloped surface with rows of seats and people painted on it.
  const x0 = 0.5;
  const y0 = STAND.wallHeight;
  const x1 = x0 + STAND.depth;
  const y1 = y0 + STAND.rise;
  const seats = new THREE.BufferGeometry();
  seats.setAttribute("position", new THREE.Float32BufferAttribute([
    x0, y0, -length / 2,
    x0, y0, length / 2,
    x1, y1, length / 2,
    x1, y1, -length / 2,
  ], 3));
  const repeatRows = STAND.rows / SEAT_ROWS_PER_TILE;
  const repeatAlong = length / SEAT_TILE_METERS;
  seats.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, repeatAlong, 0, repeatAlong, repeatRows, 0, repeatRows], 2));
  seats.setIndex([0, 1, 2, 0, 2, 3]);
  seats.computeVertexNormals();
  const seatMesh = new THREE.Mesh(seats, seatMaterial());
  seatMesh.receiveShadow = true;
  group.add(seatMesh);

  // Back wall, holding up the roof.
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.0, STAND.roofHeight + 4, length), concrete);
  back.position.set(x1 + 1.0, (STAND.roofHeight - 4) / 2, 0);
  group.add(back);

  // Ends: the shape of the stand seen from the side.
  const shape = new THREE.Shape();
  shape.moveTo(0, -4);
  shape.lineTo(0, y0 + 0.6);
  shape.lineTo(x1, y1 + 0.6);
  shape.lineTo(x1 + 1.5, y1 + 0.6);
  shape.lineTo(x1 + 1.5, -4);
  shape.closePath();
  const endGeometry = new THREE.ExtrudeGeometry(shape, { depth: 0.4, bevelEnabled: false });
  for (const end of [-1, 1]) {
    const piece = new THREE.Mesh(endGeometry, concrete);
    piece.position.z = end * (length / 2) - 0.2;
    group.add(piece);
  }

  // Roof, sticking out over the back two-thirds of the seats.
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(17, 0.4, length + 1),
    new THREE.MeshStandardMaterial({ color: 0xf1f2f4, roughness: 0.5, metalness: 0.3 })
  );
  roof.position.set(x1 + 1.5 - 8.5, STAND.roofHeight, 0);
  roof.rotation.z = -0.06; // tilted slightly up toward the track
  group.add(roof);

  // Debris fence on top of the front wall, with posts.
  const fence = new THREE.Mesh(new THREE.PlaneGeometry(length, 3.6), fenceMaterial());
  fence.rotation.y = -Math.PI / 2;
  fence.position.set(0.25, STAND.wallHeight + 1.8, 0);
  const uv = fence.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * length) / 2, uv.getY(i) * 1.8);
  }
  group.add(fence);
  const postGeometry = new THREE.BoxGeometry(0.15, 3.8, 0.15);
  for (let zz = -length / 2; zz <= length / 2 + 0.01; zz = zz + 5) {
    const post = new THREE.Mesh(postGeometry, concrete);
    post.position.set(0.25, STAND.wallHeight + 1.9, zz);
    group.add(post);
  }

  group.traverse(function (child) {
    if (child.isMesh && child.material !== fenceMaterial()) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return group;
}

// ----- Textures drawn on canvases (made once, shared) -----

const SEAT_TILE_METERS = 16; // one copy of the seat texture covers 16 m along the stand...
const SEAT_ROWS_PER_TILE = 8; // ...and 8 rows of seats
let seatMaterialCache = null;
let fenceMaterialCache = null;
const boardMaterials = {};

function seatMaterial() {
  if (seatMaterialCache) {
    return seatMaterialCache;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  const random = makeRandom(4242);
  const rowHeight = canvas.height / SEAT_ROWS_PER_TILE; // 64 px per row
  const seatWidth = canvas.width / (SEAT_TILE_METERS * 2); // a seat every 0.5 m
  const shirts = ["#e94b3c", "#f2f2f2", "#1d1d1f", "#2f6fd6", "#f5c518", "#3aa655", "#ff7a1a", "#8a8f98", "#d63a7a"];
  for (let row = 0; row < SEAT_ROWS_PER_TILE; row++) {
    const top = row * rowHeight;
    // Concrete step (the front of the row), then the seats.
    ctx.fillStyle = "#8c9096";
    ctx.fillRect(0, top + rowHeight * 0.72, canvas.width, rowHeight * 0.28);
    ctx.fillStyle = "#24427a";
    ctx.fillRect(0, top, canvas.width, rowHeight * 0.72);
    for (let seat = 0; seat < canvas.width / seatWidth; seat++) {
      const left = seat * seatWidth;
      ctx.fillStyle = "#2c529a"; // seat back
      ctx.fillRect(left + 1, top + rowHeight * 0.1, seatWidth - 2, rowHeight * 0.5);
      if (random() < 0.62) {
        // Someone sitting here: a shirt and a head.
        ctx.fillStyle = shirts[Math.floor(random() * shirts.length)];
        ctx.fillRect(left + 2, top + rowHeight * 0.28, seatWidth - 4, rowHeight * 0.44);
        ctx.fillStyle = random() < 0.8 ? "#2a211c" : "#c9a27e";
        ctx.beginPath();
        ctx.arc(left + seatWidth / 2, top + rowHeight * 0.2, seatWidth * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  seatMaterialCache = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 });
  return seatMaterialCache;
}

// Chain-link fence: see-through, with a wire pattern.
function fenceMaterial() {
  if (fenceMaterialCache) {
    return fenceMaterialCache;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "rgba(200, 205, 210, 1)";
  ctx.lineWidth = 2;
  for (let k = -64; k <= 64; k = k + 8) {
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k + 64, 64);
    ctx.moveTo(k + 64, 0);
    ctx.lineTo(k, 64);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  fenceMaterialCache = new THREE.MeshStandardMaterial({
    map: texture,
    alphaTest: 0.25,
    side: THREE.DoubleSide,
    metalness: 0.6,
    roughness: 0.4,
  });
  return fenceMaterialCache;
}

// Advertising boards along a wall (made-up sponsors, no real brands).
function boardMaterial(length) {
  const key = Math.round(length);
  if (boardMaterials[key]) {
    return boardMaterials[key];
  }
  const boards = [
    ["ROADSTER SIM", "#111418", "#ffffff"],
    ["TOKYO AGENT HACKATHON", "#d63a3a", "#ffffff"],
    ["DRIVE THE IMPOSSIBLE", "#f2f2f2", "#111418"],
    ["GREEN = GO", "#1e8a4c", "#ffffff"],
  ];
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const boardWidth = canvas.width / boards.length;
  for (let k = 0; k < boards.length; k++) {
    ctx.fillStyle = boards[k][1];
    ctx.fillRect(k * boardWidth, 0, boardWidth, canvas.height);
    ctx.fillStyle = boards[k][2];
    ctx.font = "bold 34px Inter, Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(boards[k][0], k * boardWidth + boardWidth / 2, canvas.height / 2 + 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(Math.max(1, Math.round(length / 48)), 1); // one set of 4 boards per ~48 m
  texture.anisotropy = 8;
  boardMaterials[key] = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 });
  return boardMaterials[key];
}

// =====================================================================================
// Hills on the horizon
// =====================================================================================

// A ring of forested hills around (cx, cz), from innerRadius outward, starting at baseHeight.
// Put innerRadius ~40 m (or more) inside the edge of the ground.
// They're taller toward tallSideDeg (a compass-like angle: 0 = +X, 90 = +Z). The haze (fog)
// fades them naturally with distance. Also hides the edge of the ground.
export function addDistantHills(built, cx, cz, innerRadius, baseHeight, tallSideDeg) {
  const around = 240;
  const outward = 14;
  const span = 2600;
  const random = makeRandom(777);
  // A few waves of different sizes around the ring make ridges and valleys.
  const waves = [];
  for (const frequency of [3, 5, 8, 13, 21, 34]) {
    waves.push({ frequency: frequency, phase: random() * Math.PI * 2, size: 1 / Math.sqrt(frequency) });
  }
  const tallSide = THREE.MathUtils.degToRad(tallSideDeg || 0);
  // Closer hills are lower, so they don't tower over small levels.
  const scale = THREE.MathUtils.clamp(innerRadius / 1450, 0.4, 1);
  const positions = [];
  const colors = [];
  const indices = [];
  const near = new THREE.Color(0x2f4a2b);
  const far = new THREE.Color(0x4a6050);
  const color = new THREE.Color();
  for (let a = 0; a <= around; a++) {
    const angle = (a / around) * Math.PI * 2;
    for (let r = 0; r <= outward; r++) {
      const t = r / outward;
      const radius = innerRadius + span * t;
      let ridge = 0;
      for (const wave of waves) {
        ridge = ridge + wave.size * Math.sin(angle * wave.frequency + wave.phase + t * 2.5 * wave.size);
      }
      ridge = 0.55 + 0.35 * ridge; // roughly 0..1
      const side = 0.35 + 0.65 * Math.max(0, Math.cos(angle - tallSide));
      const rise = THREE.MathUtils.smoothstep(t, 0, 0.45);
      // A quick lip at the inner edge (from under the ground to above it within ~40 m), so the
      // hills always cover the edge of the ground; then the slow rise to the ridges.
      const lip = Math.min(1, t / 0.015) * 6;
      const height = baseHeight - 4 + lip + rise * scale * (40 + 300 * side * Math.max(0.15, ridge));
      positions.push(cx + Math.cos(angle) * radius, height, cz + Math.sin(angle) * radius);
      color.copy(near).lerp(far, t).multiplyScalar(0.85 + 0.3 * random());
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let a = 0; a < around; a++) {
    for (let r = 0; r < outward; r++) {
      const i = a * (outward + 1) + r;
      const j = (a + 1) * (outward + 1) + r;
      indices.push(i, j, i + 1, j, j + 1, i + 1); // facing up
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, reflectivity: 0 }));
  mesh.frustumCulled = false;
  addMesh(built, mesh);
}

function makeRandom(seed) {
  let state = seed || 12345;
  return function () {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
