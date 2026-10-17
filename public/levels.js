// levels.js — Owner: B (friend)
// Loads level JSON files from /levels and builds them: ground, props, cars, and the goal.
// Never hard-code the world. Every map is a JSON file in levels/ (see levels/blank.json).
//
// Positions are in meters. heading is in degrees: 0 faces +Z, 90 faces +X.
// Ground types: flat (concrete), grass (less grip).
// Prop types: box, wall, ramp, curl (curves up and over, upside down), cone, checkpoint,
//   parking_spot, paint (flat color, no collision), grandstand,
//   and the big generators in scenery.js: track, parking_lot, highway.
// Car kinds: compact, sedan, suv, pickup, van, semi.
// Car behaviors: parked, stopped, path (with "path": [[x, z], ...], "loop"), rival.
// Goal types:
//   reach - get to the green zone (add "timeLimit": seconds for a countdown,
//           or "after": "barrel_roll" to only count it after a barrel roll)
//   lap   - drive a lap of the track through every checkpoint (needs a track prop)
//   park  - park in the open spot of a parking_lot before the rival does

import * as THREE from "three";
import { addMesh, headingToQuaternion, addFixedBoxCollider, BoxBatch } from "./level-utils.js";
import { makeCarMesh, getCarSize, CAR_COLORS } from "./vehicles.js";
import { addMover, stepMovers, syncMoverMeshes, resetMovers } from "./traffic.js";
import { buildTrack, buildParkingLot, buildHighway, placeArch } from "./scenery.js";
import { surfaceMaterial, uvInMeters } from "./materials.js";
import { dressTestSite } from "./decor.js";
import { addGrandstand } from "./trackside.js";

export async function fetchLevelList() {
  const response = await fetch("/levels/index.json");
  return await response.json();
}

export async function fetchLevel(file) {
  const response = await fetch("/levels/" + file + ".json");
  if (!response.ok) {
    throw new Error("Level not found: " + file);
  }
  return await response.json();
}

// Build a level into the scene and the physics world.
// Returns an object you pass to stepLevel() each physics step, updateLevel() each frame,
// resetLevel() when the player restarts, and removeLevel() when done.
export function buildLevel(level, scene, world, RAPIER) {
  const built = {
    level: level,
    scene: scene,
    world: world,
    RAPIER: RAPIER,
    meshes: [], // everything we added to the scene
    fixedColliders: [], // colliders that don't move
    movingProps: [], // { mesh, body } pairs, like cones you can knock over
    movers: [], // cars and people that drive or walk by themselves (traffic.js)
    events: [], // things that happened, like "rival_parked"
    goal: null,
    goalState: null,
    racingLine: null,
    groundCollider: null,
    grassGround: false,
    gravelCollider: null,
    spawn: level.spawn,
    time: 0,
  };

  // Levels with real elevation get hilly ground from the track builder instead.
  const ground = level.ground || { type: "flat", size: 1000 };
  built.heightAt = function () {
    return 0;
  };
  if (!ground.terrain) {
    buildGround(built, ground);
  }

  const props = level.props || [];
  for (const prop of props) {
    buildProp(built, prop);
  }

  const cars = level.cars || [];
  for (let i = 0; i < cars.length; i++) {
    buildCar(built, cars[i], i);
  }

  // A track can choose the spawn point for us (just before its start line).
  if (level.spawn && level.spawn.onTrack && built.trackSpawn) {
    built.spawn = built.trackSpawn;
  }

  if (level.decor === "testsite") {
    dressTestSite(built);
  }

  if (level.goal) {
    buildGoal(built, level.goal);
  }
  resetGoal(built);

  // TODO (Milestone 5): if level.model is set, load the .glb with GLTFLoader and
  // make a trimesh collider from it (for PLATEAU Tokyo chunks, race tracks, etc.).

  return built;
}

// Call once per physics step, BEFORE world.step(). Moves traffic and other movers.
export function stepLevel(built, dt, car) {
  if (built.movers.length > 0) {
    stepMovers(built, dt, { position: car.getPosition() });
  }
}

// Call every frame. car = { position, airborne, speedKmh, heading (radians) }.
// Returns { reached, failed, message, line }: reached/failed are true only on the frame it happens,
// message is a big on-screen message for that moment, line is the goal's live status for the HUD.
export function updateLevel(built, car, dt) {
  built.time = built.time + dt;

  // Cones, carts and other loose things: copy their physics pose onto their mesh.
  for (const item of built.movingProps) {
    const p = item.body.translation();
    const r = item.body.rotation();
    item.mesh.position.set(p.x, p.y, p.z);
    item.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
  syncMoverMeshes(built);

  const status = { reached: false, failed: false, message: "", line: "" };
  const goal = built.goal;
  const state = built.goalState;
  if (!goal || state.done || state.failed) {
    if (state && state.finalLine) {
      status.line = state.finalLine;
    }
    return status;
  }

  if (goal.type === "lap") {
    updateLapGoal(built, car, status);
  } else if (goal.type === "park") {
    updateParkGoal(built, car, dt, status);
  } else {
    updateReachGoal(built, car, status);
  }
  built.events = [];
  return status;
}

// Put the scenario back to the start: traffic, rival, timers.
export function resetLevel(built) {
  resetMovers(built);
  resetGoal(built);
}

export function removeLevel(built) {
  for (const mesh of built.meshes) {
    built.scene.remove(mesh);
  }
  for (const collider of built.fixedColliders) {
    built.world.removeCollider(collider, false);
  }
  for (const item of built.movingProps) {
    built.world.removeRigidBody(item.body);
  }
  for (const mover of built.movers) {
    built.world.removeRigidBody(mover.body);
  }
  built.meshes = [];
  built.fixedColliders = [];
  built.movingProps = [];
  built.movers = [];
}

// Is this collider the grass ground? (The car uses this to lose grip off the track.)
export function isGrass(built, collider) {
  return built.grassGround && built.groundCollider !== null && collider.handle === built.groundCollider.handle;
}

// Is this collider a race track's gravel traps? (Less grip than grass, and lots of drag.)
export function isGravel(built, collider) {
  return built.gravelCollider !== null && built.gravelCollider !== undefined && collider.handle === built.gravelCollider.handle;
}

// ---------- Goals ----------

function resetGoal(built) {
  built.goalState = {
    done: false,
    failed: false,
    finalLine: "",
    timerStart: null,
    unlocked: false, // for goals that need something done first (like a barrel roll)
    // lap goal
    lapStarted: false,
    nextCheckpoint: 0,
    lapStart: 0,
    bestLap: built.goalState ? built.goalState.bestLap : null,
    // park goal
    parkedFor: 0,
  };
  built.events = [];
  if (built.track) {
    placeArch(built, 0);
  }
}

// reach: drive into the green zone (optionally before time runs out).
function updateReachGoal(built, car, status) {
  const goal = built.goal;
  const state = built.goalState;
  goal.ring.material.opacity = 0.25 + 0.15 * Math.sin(built.time * 3);

  // The clock starts when the car starts moving.
  if (goal.timeLimit && state.timerStart === null && car.speedKmh > 3) {
    state.timerStart = built.time;
  }
  let elapsed = 0;
  if (state.timerStart !== null) {
    elapsed = built.time - state.timerStart;
  }
  if (goal.timeLimit) {
    status.line = "Time left " + formatTime(Math.max(0, goal.timeLimit - elapsed));
  }

  if (goal.after === "barrel_roll" && car.rolling) {
    state.unlocked = true;
  }
  const dx = car.position.x - goal.x;
  const dz = car.position.z - goal.z;
  const inside = Math.sqrt(dx * dx + dz * dz) < goal.radius;
  const allowed = goal.after === "" || state.unlocked;
  if (inside && !car.airborne && allowed) {
    state.done = true;
    status.reached = true;
    status.message = "Goal reached!";
    if (goal.timeLimit) {
      status.message = "Made it in " + formatTime(elapsed) + "!";
      state.finalLine = "Made it in " + formatTime(elapsed);
    }
  } else if (goal.timeLimit && elapsed > goal.timeLimit) {
    state.failed = true;
    status.failed = true;
    status.message = "Out of time! Press R to try again.";
    state.finalLine = "Out of time";
  }
}

// lap: pass every checkpoint in order and come back to the start line.
function updateLapGoal(built, car, status) {
  const state = built.goalState;
  const track = built.track;
  const checkpoints = track.checkpoints;
  const next = checkpoints[state.nextCheckpoint];
  const dx = car.position.x - next.position.x;
  const dz = car.position.z - next.position.z;
  const dy = Math.abs(car.position.y - next.position.y);
  // Close enough sideways, and on the same level (the bridge passes over the track).
  const passed = Math.sqrt(dx * dx + dz * dz) < track.width / 2 + 4 && dy < 4;

  if (passed) {
    if (state.nextCheckpoint === 0) {
      if (state.lapStarted) {
        const lapTime = built.time - state.lapStart;
        let best = "";
        if (state.bestLap === null || lapTime < state.bestLap) {
          state.bestLap = lapTime;
          best = " (best!)";
        }
        status.reached = true;
        status.message = "Lap " + formatTime(lapTime) + best;
      }
      state.lapStarted = true;
      state.lapStart = built.time;
    }
    state.nextCheckpoint = (state.nextCheckpoint + 1) % checkpoints.length;
    placeArch(built, state.nextCheckpoint);
  }

  if (!state.lapStarted) {
    status.line = "Cross the start line to begin";
  } else {
    let checkpointNumber = state.nextCheckpoint;
    if (checkpointNumber === 0) {
      checkpointNumber = checkpoints.length;
    }
    status.line = "Lap " + formatTime(built.time - state.lapStart) + "  ·  gate " + checkpointNumber + "/" + checkpoints.length;
  }
  if (state.bestLap !== null) {
    status.line = status.line + "  ·  best " + formatTime(state.bestLap);
  }
}

// park: stop inside the open spot, lined up, before the rival gets there.
function updateParkGoal(built, car, dt, status) {
  const state = built.goalState;
  const spot = built.parkingSpot;
  spot.arrow.position.y = 4 + Math.sin(built.time * 3) * 0.4;
  spot.arrow.rotation.y = built.time;
  if (state.timerStart === null) {
    state.timerStart = built.time;
  }

  if (built.events.includes("rival_parked")) {
    state.failed = true;
    status.failed = true;
    status.message = "Someone took your spot! Press R to try again.";
    state.finalLine = "Spot taken";
    return;
  }

  // Where is the car, measured along the spot and across it?
  const dx = car.position.x - spot.x;
  const dz = car.position.z - spot.z;
  const along = dx * Math.sin(spot.heading) + dz * Math.cos(spot.heading);
  const across = dx * Math.cos(spot.heading) - dz * Math.sin(spot.heading);
  // Nose in or nose out are both fine.
  let angle = Math.abs(wrapAngle(car.heading - spot.heading));
  angle = Math.min(angle, Math.PI - angle);
  const lined = Math.abs(across) < 0.8 && Math.abs(along) < 1.2 && angle < THREE.MathUtils.degToRad(25);
  if (lined && car.speedKmh < 3 && !car.airborne) {
    state.parkedFor = state.parkedFor + dt;
  } else {
    state.parkedFor = 0;
  }
  if (state.parkedFor > 1.0) {
    state.done = true;
    status.reached = true;
    const time = formatTime(built.time - state.timerStart);
    status.message = "Parked! " + time;
    state.finalLine = "Parked in " + time;
    return;
  }

  // Show how close the rival is to taking the spot.
  status.line = "Find the open spot (green arrow)";
  for (const mover of built.movers) {
    if (mover.behavior === "rival") {
      const rx = mover.position.x - spot.x;
      const rz = mover.position.z - spot.z;
      status.line = "Other driver is " + Math.round(Math.sqrt(rx * rx + rz * rz)) + " m from your spot";
    }
  }
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  let text = rest.toFixed(1);
  if (rest < 10) {
    text = "0" + text;
  }
  return minutes + ":" + text;
}

function wrapAngle(angle) {
  let result = angle;
  while (result > Math.PI) {
    result = result - Math.PI * 2;
  }
  while (result < -Math.PI) {
    result = result + Math.PI * 2;
  }
  return result;
}

// ---------- Builders ----------

function buildGround(built, ground) {
  const size = ground.size || 1000;
  built.grassGround = ground.type === "grass";
  // Photo-textured ground: grass for fields, concrete for the test pad ("flat").
  let surface = "concrete";
  if (built.grassGround) {
    surface = "grass";
  }
  const geometry = uvInMeters(new THREE.PlaneGeometry(size, size), size, size, surface);
  const mesh = new THREE.Mesh(geometry, surfaceMaterial(surface));
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  addMesh(built, mesh);

  // A thick slab, so fast cars can't tunnel through a thin floor.
  const collider = built.RAPIER.ColliderDesc.cuboid(size / 2, 0.5, size / 2).setTranslation(0, -0.5, 0).setFriction(1.0);
  built.groundCollider = built.world.createCollider(collider);
  built.fixedColliders.push(built.groundCollider);
}

function buildProp(built, prop) {
  if (prop.type === "box") {
    const w = prop.w || 2;
    const h = prop.h || 2;
    const d = prop.d || 2;
    addSolidBox(built, prop.x, (prop.y || 0) + h / 2, prop.z, w, h, d, prop.heading || 0, prop.color || "#8a8f98");
  } else if (prop.type === "wall") {
    // A wall runs along its heading direction.
    const height = prop.height || 3;
    addSolidBox(built, prop.x, height / 2, prop.z, prop.thickness || 0.6, height, prop.length || 20, prop.heading || 0, prop.color || "#a3a8b0");
  } else if (prop.type === "ramp") {
    buildRamp(built, prop);
  } else if (prop.type === "curl") {
    buildCurl(built, prop);
  } else if (prop.type === "cone") {
    buildCone(built, prop);
  } else if (prop.type === "checkpoint") {
    buildCheckpoint(built, prop);
  } else if (prop.type === "parking_spot") {
    buildParkingSpot(built, prop);
  } else if (prop.type === "grandstand") {
    buildGrandstand(built, prop);
  } else if (prop.type === "track") {
    buildTrack(built, prop);
  } else if (prop.type === "parking_lot") {
    buildParkingLot(built, prop);
  } else if (prop.type === "highway") {
    buildHighway(built, prop);
  } else if (prop.type === "paint") {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(prop.w || 10, prop.d || 10),
      new THREE.MeshStandardMaterial({ color: prop.color || "#2b2e33", roughness: 0.9 })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = THREE.MathUtils.degToRad(prop.heading || 0);
    mesh.position.set(prop.x, 0.01, prop.z);
    mesh.receiveShadow = true;
    addMesh(built, mesh);
  } else {
    console.warn("Unknown prop type, skipping:", prop.type);
  }
}

// A covered grandstand full of people, for the side of a race track. Runs along its heading;
// (x, z) is the middle of its front wall and the seats rise toward its local +X.
function buildGrandstand(built, prop) {
  addGrandstand(built, prop.x, prop.z, prop.heading || 0, prop.length || 80, built.heightAt);
}

// A wedge that rises toward its heading direction. (x, z) is the middle of its footprint.
function buildRamp(built, prop) {
  const width = prop.width || 8;
  const length = prop.length || 20;
  const angle = THREE.MathUtils.degToRad(prop.angle || 15);
  const height = length * Math.tan(angle);
  const rotation = headingToQuaternion(prop.heading || 0);

  // Physics: the six corners of the wedge.
  const halfW = width / 2;
  const halfL = length / 2;
  const corners = new Float32Array([
    -halfW, 0, -halfL,
    halfW, 0, -halfL,
    -halfW, 0, halfL,
    halfW, 0, halfL,
    -halfW, height, halfL,
    halfW, height, halfL,
  ]);
  const collider = built.RAPIER.ColliderDesc.convexHull(corners)
    .setTranslation(prop.x, 0, prop.z)
    .setRotation(rotation)
    .setFriction(1.0);
  built.fixedColliders.push(built.world.createCollider(collider));

  // Graphics: a triangle side view pushed out across the ramp's width.
  const side = new THREE.Shape();
  side.moveTo(-halfL, 0);
  side.lineTo(halfL, 0);
  side.lineTo(halfL, height);
  side.lineTo(-halfL, 0);
  const geometry = new THREE.ExtrudeGeometry(side, { depth: width, bevelEnabled: false });
  geometry.rotateY(-Math.PI / 2); // side view x -> world z, width -> world x
  geometry.translate(halfW, 0, 0);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: prop.color || "#e2a93b", roughness: 0.7, flatShading: true })
  );
  mesh.position.set(prop.x, 0, prop.z);
  mesh.quaternion.copy(rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  addMesh(built, mesh);
}

// The reveal's curved ramp: it starts flat on the ground and bends up and over, so a car
// driving in ends up upside down at the top (with the fans on, it sticks there).
// (x, z) is where the curve starts, and it bends toward the heading direction.
// radius = size of the curve, degrees = how far it bends (180 = fully upside down).
function buildCurl(built, prop) {
  const radius = prop.radius || 10;
  const width = prop.width || 8;
  const degrees = prop.degrees || 180;
  const steps = 60;
  const rotation = headingToQuaternion(prop.heading || 0);

  // Two points (left and right edge) for each step along the curve.
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const angle = THREE.MathUtils.degToRad((degrees * i) / steps);
    const z = radius * Math.sin(angle);
    const y = radius - radius * Math.cos(angle);
    points.push(-width / 2, y, z);
    points.push(width / 2, y, z);
  }
  // Two triangles per step make the driving surface.
  const triangles = [];
  for (let i = 0; i < steps; i++) {
    const a = i * 2;
    triangles.push(a, a + 2, a + 1);
    triangles.push(a + 1, a + 2, a + 3);
  }
  const vertices = new Float32Array(points);
  const indices = new Uint32Array(triangles);

  const collider = built.RAPIER.ColliderDesc.trimesh(vertices, indices)
    .setTranslation(prop.x, 0, prop.z)
    .setRotation(rotation)
    .setFriction(1.0);
  built.fixedColliders.push(built.world.createCollider(collider));

  // Graphics: a solid curved band. Its inside face is the driving surface; the outside gives it
  // thickness so it still looks solid when seen from the side.
  const group = new THREE.Group();
  const thickness = 0.6;
  const profile = new THREE.Shape();
  for (let i = 0; i <= steps; i++) {
    const angle = THREE.MathUtils.degToRad((degrees * i) / steps);
    const z = radius * Math.sin(angle);
    const y = radius - radius * Math.cos(angle);
    if (i === 0) {
      profile.moveTo(z, y);
    } else {
      profile.lineTo(z, y);
    }
  }
  for (let i = steps; i >= 0; i--) {
    const angle = THREE.MathUtils.degToRad((degrees * i) / steps);
    profile.lineTo((radius + thickness) * Math.sin(angle), radius - (radius + thickness) * Math.cos(angle));
  }
  const geometry = new THREE.ExtrudeGeometry(profile, { depth: width, bevelEnabled: false });
  geometry.rotateY(-Math.PI / 2); // side view x -> world z, width -> world x
  geometry.translate(width / 2, 0, 0);
  const band = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: prop.color || "#e2a93b", roughness: 0.7, flatShading: true })
  );
  band.position.y = 0.01; // a hair above the ground so they don't flicker
  band.receiveShadow = true;
  band.castShadow = true;
  group.add(band);

  // Rails along both edges so the shape reads clearly from far away.
  const railMaterial = new THREE.MeshStandardMaterial({ color: "#c9ced6", roughness: 0.5, metalness: 0.3 });
  for (const side of [-1, 1]) {
    const railPoints = [];
    for (let i = 0; i <= steps; i++) {
      railPoints.push(new THREE.Vector3(points[i * 6 + 3] * side, points[i * 6 + 4], points[i * 6 + 5]));
    }
    const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPoints), steps, 0.18, 8), railMaterial);
    rail.castShadow = true;
    group.add(rail);
  }

  // A support frame behind the curve (no collisions, it's out of the car's way).
  const top = radius * 2;
  for (const side of [-1, 1]) {
    const column = new THREE.Mesh(new THREE.BoxGeometry(0.5, top + 0.6, 0.5), railMaterial);
    column.position.set(side * (width / 2 + 0.6), (top + 0.6) / 2, radius + 1.5);
    column.castShadow = true;
    group.add(column);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(width + 1.7, 0.4, radius + 1.8), railMaterial);
  beam.position.set(0, top + 0.6, (radius + 1.5) / 2);
  group.add(beam);

  group.position.set(prop.x, 0, prop.z);
  group.quaternion.copy(rotation);
  addMesh(built, group);
}

// Cones are light and loose, so you can knock them flying.
function buildCone(built, prop) {
  const halfHeight = 0.35;
  const radius = 0.22;
  const bodyDesc = built.RAPIER.RigidBodyDesc.dynamic().setTranslation(prop.x, halfHeight, prop.z);
  const body = built.world.createRigidBody(bodyDesc);
  built.world.createCollider(built.RAPIER.ColliderDesc.cone(halfHeight, radius).setMass(4).setFriction(0.8), body);

  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(radius, halfHeight * 2, 16),
    new THREE.MeshStandardMaterial({ color: "#ff6a1a", roughness: 0.6 })
  );
  mesh.castShadow = true;
  addMesh(built, mesh);
  built.movingProps.push({ mesh: mesh, body: body });
}

function buildCheckpoint(built, prop) {
  const radius = prop.radius || 6;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.25, 8, 48),
    new THREE.MeshBasicMaterial({ color: "#3ad1ff", transparent: true, opacity: 0.6 })
  );
  ring.position.set(prop.x, radius + 0.5, prop.z);
  ring.rotation.y = THREE.MathUtils.degToRad(prop.heading || 0);
  addMesh(built, ring);
}

function buildParkingSpot(built, prop) {
  const w = prop.w || 2.8;
  const d = prop.d || 5.5;
  const group = new THREE.Group();
  const lineMaterial = new THREE.MeshBasicMaterial({ color: "#f5f5f5" });
  const lines = [
    { x: -w / 2, z: 0, sx: 0.12, sz: d },
    { x: w / 2, z: 0, sx: 0.12, sz: d },
    { x: 0, z: -d / 2, sx: w, sz: 0.12 },
  ];
  for (const line of lines) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(line.sx, line.sz), lineMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(line.x, 0.02, line.z);
    group.add(mesh);
  }
  group.position.set(prop.x, 0, prop.z);
  group.rotation.y = THREE.MathUtils.degToRad(prop.heading || 0);
  addMesh(built, group);
}

// A car from the level's "cars" list. Parked cars are solid and never move;
// any other behavior becomes a mover (see traffic.js).
function buildCar(built, car, index) {
  let color = car.color;
  if (!color) {
    color = CAR_COLORS[index % CAR_COLORS.length];
  }
  const behavior = car.behavior || "parked";
  if (behavior !== "parked") {
    addMover(built, {
      behavior: behavior,
      kind: car.kind,
      color: color,
      x: car.x,
      z: car.z,
      heading: car.heading || 0,
      speedKmh: car.speedKmh || 20,
      path: car.path,
      loop: car.loop,
    });
    return;
  }
  const size = getCarSize(car.kind);
  addFixedBoxCollider(built, car.x, size.height / 2, car.z, size.width, size.height, size.length, car.heading || 0);
  const mesh = makeCarMesh(car.kind || "sedan", color);
  mesh.position.set(car.x, 0, car.z);
  mesh.quaternion.copy(headingToQuaternion(car.heading || 0));
  addMesh(built, mesh);
}

function buildGoal(built, goal) {
  const type = goal.type || "reach";
  // "after": "barrel_roll" means the goal only counts once you've done a barrel roll.
  built.goal = { type: type, text: goal.text || "", timeLimit: goal.timeLimit || 0, after: goal.after || "" };
  if (type !== "reach") {
    return; // lap and park goals use the track's arch and the parking lot's arrow
  }
  const radius = goal.radius || 6;
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 3, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: "#39ff88", transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.position.set(goal.x, 1.5, goal.z);
  addMesh(built, ring);
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({ color: "#39ff88", transparent: true, opacity: 0.35, depthWrite: false })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(goal.x, 0.06, goal.z);
  addMesh(built, pad);
  built.goal.x = goal.x;
  built.goal.z = goal.z;
  built.goal.radius = radius;
  built.goal.ring = ring;
}

// ---------- Small helpers ----------

function addSolidBox(built, x, y, z, w, h, d, heading, color) {
  const rotation = headingToQuaternion(heading);
  const collider = built.RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z).setRotation(rotation);
  built.fixedColliders.push(built.world.createCollider(collider));
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: color, roughness: 0.8 }));
  mesh.position.set(x, y, z);
  mesh.quaternion.copy(rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  addMesh(built, mesh);
}
