// decor.js — Owner: B (friend)
// Scenery that makes levels feel like real places (no collisions unless noted):
//   addTrees      - hundreds of trees for the cost of a few (instanced meshes)
//   addBuildings  - city blocks with lit/unlit windows, all merged into one mesh
//   addFerrisWheel, addPitBuilding, addHangar - landmark pieces
// Every function takes heightAt(x, z) so things sit on hilly ground too.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { addMesh, addFixedBoxCollider } from "./level-utils.js";
import { addDistantHills } from "./trackside.js";

// spots: list of [x, z]. Trees get a random size and a slightly different green.
// sizeScale makes them all bigger (1.6 is about right for tall forest trees).
export function addTrees(built, spots, heightAt, seed, sizeScale) {
  if (spots.length === 0) {
    return;
  }
  const random = makeRandom(seed || 11);
  const trunkGeometry = new THREE.CylinderGeometry(0.25, 0.35, 3, 6);
  trunkGeometry.translate(0, 1.5, 0);
  // Two stacked cones look more like a real tree than one.
  const lower = new THREE.ConeGeometry(2.6, 5.5, 8);
  lower.translate(0, 5.2, 0);
  const upper = new THREE.ConeGeometry(1.9, 4.2, 8);
  upper.translate(0, 7.6, 0);
  const crownGeometry = mergeGeometries([lower, upper]);
  const trunks = new THREE.InstancedMesh(trunkGeometry, new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95 }), spots.length);
  // Matte leaves with no sky reflection (reflectivity 0): reflecting the bright sky made them pale.
  const crowns = new THREE.InstancedMesh(crownGeometry, new THREE.MeshLambertMaterial({ color: 0xffffff, reflectivity: 0 }), spots.length);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  for (let i = 0; i < spots.length; i++) {
    const x = spots[i][0];
    const z = spots[i][1];
    const scale = (0.7 + random() * 0.9) * (sizeScale || 1);
    matrix.makeRotationY(random() * Math.PI * 2);
    matrix.scale(new THREE.Vector3(scale, scale * (0.85 + random() * 0.4), scale));
    matrix.setPosition(x, heightAt(x, z) - 0.2, z);
    trunks.setMatrixAt(i, matrix);
    crowns.setMatrixAt(i, matrix);
    color.setHSL(0.28 + random() * 0.07, 0.3 + random() * 0.2, 0.11 + random() * 0.08); // dark, like cedar and pine
    crowns.setColorAt(i, color);
  }
  // Shadows only for small groups of trees near the road. A whole forest would be drawn a second
  // time into the shadow map every frame, and its shadows never reach the track anyway.
  const nearRoad = spots.length < 600;
  crowns.castShadow = nearRoad;
  trunks.castShadow = nearRoad;
  addMesh(built, trunks);
  addMesh(built, crowns);
}

// Random tree spots inside a rectangle, skipping anywhere keepClear(x, z) says no.
export function scatter(count, minX, maxX, minZ, maxZ, keepClear, seed) {
  const random = makeRandom(seed || 5);
  const spots = [];
  let tries = 0;
  while (spots.length < count && tries < count * 20) {
    tries = tries + 1;
    const x = minX + random() * (maxX - minX);
    const z = minZ + random() * (maxZ - minZ);
    if (!keepClear(x, z)) {
      spots.push([x, z]);
    }
  }
  return spots;
}

// buildings: list of { x, z, w, d, h, heading }. Window texture coordinates are in meters,
// so every window is the same size no matter how big the building is.
export function addBuildings(built, buildings, heightAt, solid) {
  if (buildings.length === 0) {
    return;
  }
  const parts = [];
  for (const b of buildings) {
    const geometry = new THREE.BoxGeometry(b.w, b.h, b.d);
    // Box faces: +x, -x, +y, -y, +z, -z (4 vertices each). Scale each face's texture to meters.
    const uv = geometry.attributes.uv;
    const faceSizes = [
      [b.d, b.h], [b.d, b.h], [b.w, b.d], [b.w, b.d], [b.w, b.h], [b.w, b.h],
    ];
    for (let face = 0; face < 6; face++) {
      for (let v = 0; v < 4; v++) {
        const index = face * 4 + v;
        uv.setXY(index, (uv.getX(index) * faceSizes[face][0]) / 8, (uv.getY(index) * faceSizes[face][1]) / 8);
      }
    }
    geometry.rotateY(THREE.MathUtils.degToRad(b.heading || 0));
    const ground = heightAt(b.x, b.z);
    geometry.translate(b.x, ground + b.h / 2 - 0.5, b.z);
    parts.push(geometry);
    if (solid) {
      addFixedBoxCollider(built, b.x, ground + b.h / 2, b.z, b.w, b.h, b.d, b.heading || 0);
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), windowMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  addMesh(built, mesh);
}

// A big Ferris wheel (Suzuka has a famous one next to the track).
export function addFerrisWheel(built, x, z, headingDeg, heightAt) {
  const group = new THREE.Group();
  const radius = 26;
  const hub = radius + 6;
  const steel = new THREE.MeshStandardMaterial({ color: 0xe8ecf0, metalness: 0.5, roughness: 0.4 });
  for (const side of [-1.5, 1.5]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.35, 8, 64), steel);
    rim.position.set(side, hub, 0);
    rim.rotation.y = Math.PI / 2;
    group.add(rim);
  }
  const spokes = [];
  for (let i = 0; i < 24; i++) {
    const spoke = new THREE.BoxGeometry(0.2, radius, 0.2);
    spoke.translate(0, radius / 2, 0);
    spoke.rotateX((i * Math.PI * 2) / 24);
    spokes.push(spoke);
  }
  const spokeMesh = new THREE.Mesh(mergeGeometries(spokes), steel);
  spokeMesh.position.set(0, hub, 0);
  group.add(spokeMesh);
  const colors = [0xe74c3c, 0xf1c40f, 0x3498db, 0x2ecc71, 0x9b59b6, 0xe67e22];
  for (let i = 0; i < 24; i++) {
    const angle = (i * Math.PI * 2) / 24;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 2.2), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.5 }));
    cabin.position.set(0, hub + Math.sin(angle) * radius - 1.5, Math.cos(angle) * radius);
    group.add(cabin);
  }
  for (const side of [-1, 1]) {
    for (const lean of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, hub * 1.08, 8), steel);
      leg.position.set(side * 3, hub / 2, lean * 7);
      leg.rotation.x = -lean * 0.22;
      group.add(leg);
    }
  }
  group.position.set(x, heightAt(x, z), z);
  group.rotation.y = THREE.MathUtils.degToRad(headingDeg || 0);
  group.traverse(function (child) {
    child.castShadow = true;
  });
  addMesh(built, group);
}

// A long pit building with garage doors and a control tower. Runs along its heading.
export function addPitBuilding(built, x, z, length, headingDeg, heightAt) {
  // Stand on the highest ground under it; a deep base fills in where the ground drops away.
  const along = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(headingDeg || 0));
  let ground = -Infinity;
  for (let k = -2; k <= 2; k++) {
    ground = Math.max(ground, heightAt(x + (along.x * k * length) / 4, z + (along.z * k * length) / 4));
  }
  const group = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0xa9b0b8, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2229, roughness: 0.4, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(14, 19, length), wall);
  body.position.set(0, 1.5, 0); // 8 m of it below the ground
  group.add(body);
  for (let zz = -length / 2 + 8; zz < length / 2 - 4; zz = zz + 12) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.5, 9), dark);
    door.position.set(-7.05, 2.25, zz);
    group.add(door);
  }
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, length - 6), dark);
  glass.position.set(-7.05, 8, 0);
  group.add(glass);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(12, 24, 16), wall);
  tower.position.set(4, 12, -length / 2 + 20);
  group.add(tower);
  group.position.set(x, ground, z);
  group.rotation.y = THREE.MathUtils.degToRad(headingDeg || 0);
  group.traverse(function (child) {
    child.castShadow = true;
    child.receiveShadow = true;
  });
  addMesh(built, group);
  addFixedBoxCollider(built, x, ground + 1.5, z, 14, 19, length, headingDeg || 0);
}

// A hangar, like at a test site. Solid.
export function addHangar(built, x, z, w, d, headingDeg) {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(w / 2, w / 2, d, 24, 1, false, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xb9bfc6, metalness: 0.6, roughness: 0.45 })
  );
  shell.rotation.z = Math.PI / 2;
  shell.rotation.y = Math.PI / 2;
  group.add(shell);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, w * 0.35), new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.7 }));
  door.position.set(0, w * 0.18, d / 2 + 0.05);
  group.add(door);
  group.position.set(x, 0, z);
  group.rotation.y = THREE.MathUtils.degToRad(headingDeg || 0);
  group.traverse(function (child) {
    child.castShadow = true;
    child.receiveShadow = true;
  });
  addMesh(built, group);
  addFixedBoxCollider(built, x, w / 4, z, w, w / 2, d, headingDeg || 0);
}

// One shared material for all city buildings: concrete with rows of windows, some lit.
let sharedWindowMaterial = null;
function windowMaterial() {
  if (sharedWindowMaterial) {
    return sharedWindowMaterial;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#9aa1a9";
  ctx.fillRect(0, 0, 256, 256);
  const random = makeRandom(3);
  // One texture = 8 x 8 m of facade: 3 floors, 3 windows per floor.
  for (let floor = 0; floor < 3; floor++) {
    for (let column = 0; column < 3; column++) {
      const lit = random() < 0.15;
      ctx.fillStyle = lit ? "#e9d9a6" : "#2b3a4a";
      ctx.fillRect(12 + column * 82, 14 + floor * 84, 66, 52);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(12 + column * 82, 14 + floor * 84, 66, 6);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  sharedWindowMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55, metalness: 0.2 });
  return sharedWindowMaterial;
}

function makeRandom(seed) {
  let state = seed;
  return function () {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// ---------- Level dressing ----------

// The open test site (like the reveal's): hangars along one side, a distant tree line.
export function dressTestSite(built) {
  const flat = function () {
    return 0;
  };
  addHangar(built, -120, -40, 34, 50, 90);
  addHangar(built, -120, 30, 34, 50, 90);
  addHangar(built, -120, 100, 28, 40, 90);
  const ring = [];
  const random = makeRandom(41);
  for (let i = 0; i < 700; i++) {
    const angle = random() * Math.PI * 2;
    const distance = 380 + random() * 110;
    ring.push([Math.cos(angle) * distance, Math.sin(angle) * distance]);
  }
  addTrees(built, ring, flat, 41);
  const buildings = [];
  for (let i = 0; i < 18; i++) {
    const angle = random() * Math.PI * 2;
    const distance = 470 + random() * 20;
    buildings.push({ x: Math.cos(angle) * distance, z: Math.sin(angle) * distance, w: 20 + random() * 30, d: 20 + random() * 30, h: 8 + random() * 14, heading: random() * 90 });
  }
  addBuildings(built, buildings, flat, false);
  addDistantHills(built, 0, 0, (built.level.ground.size || 1000) / 2 - 40, 0, 300);
}

// City blocks along both sides of a road running along Z (for the expressway).
// edge = distance from the road's center line to the first buildings.
export function addCityAlongRoad(built, startZ, endZ, edge, seed) {
  const random = makeRandom(seed || 9);
  const flat = function () {
    return 0;
  };
  const buildings = [];
  for (const side of [-1, 1]) {
    let z = startZ;
    while (z < endZ) {
      const depth = 14 + random() * 26;
      const width = 18 + random() * 30;
      const setback = edge + random() * 25;
      buildings.push({ x: side * (setback + width / 2), z: z + depth / 2, w: width, d: depth, h: 9 + random() * 45, heading: 0 });
      // A second row behind, taller.
      if (random() < 0.7) {
        buildings.push({ x: side * (setback + width + 20 + random() * 40), z: z + depth / 2, w: 20 + random() * 25, d: 16 + random() * 20, h: 20 + random() * 80, heading: 0 });
      }
      z = z + depth + 6 + random() * 18;
    }
  }
  // A skyline of towers far off, so the horizon isn't empty.
  for (let i = 0; i < 40; i++) {
    const side = random() < 0.5 ? -1 : 1;
    buildings.push({ x: side * (500 + random() * 700), z: startZ + random() * (endZ - startZ), w: 30 + random() * 30, d: 30 + random() * 30, h: 90 + random() * 170, heading: random() * 40 });
  }
  addBuildings(built, buildings, flat, false);
}

// Sound walls (concrete base and clear panels, like Japanese expressways) along both sides.
export function addSoundWalls(built, x, startZ, endZ) {
  const length = endZ - startZ;
  const middle = (startZ + endZ) / 2;
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.85 });
  const panel = new THREE.MeshStandardMaterial({ color: 0xbfd8e6, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  for (const side of [-1, 1]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, length), concrete);
    base.position.set(side * x, 0.6, middle);
    base.receiveShadow = true;
    addMesh(built, base);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(length, 2.6), panel);
    glass.rotation.y = Math.PI / 2;
    glass.position.set(side * x, 2.5, middle);
    addMesh(built, glass);
    const posts = [];
    for (let z = startZ; z < endZ; z = z + 4) {
      const post = new THREE.BoxGeometry(0.15, 2.8, 0.15);
      post.translate(side * x, 2.6, z);
      posts.push(post);
    }
    addMesh(built, new THREE.Mesh(mergeGeometries(posts), new THREE.MeshStandardMaterial({ color: 0x6e757d, metalness: 0.5, roughness: 0.5 })));
  }
}

// A road bridge crossing over the expressway. Solid, so flying into it hurts.
export function addOverpass(built, z, span) {
  const concrete = new THREE.MeshStandardMaterial({ color: 0xaab0b6, roughness: 0.8 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 1.4, 12), concrete);
  deck.position.set(0, 8.2, z);
  deck.castShadow = true;
  deck.receiveShadow = true;
  addMesh(built, deck);
  addFixedBoxCollider(built, 0, 8.2, z, span, 1.4, 12, 0);
  for (const side of [-1, 1]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(2, 8, 10), concrete);
    pier.position.set(side * (span / 2 - 1), 4, z);
    pier.castShadow = true;
    addMesh(built, pier);
    addFixedBoxCollider(built, side * (span / 2 - 1), 4, z, 2, 8, 10, 0);
  }
}
