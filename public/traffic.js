// traffic.js — Owner: B (friend)
// Things that move by themselves: highway traffic, cars cruising a parking lot, a rival
// heading for your parking spot, and shoppers walking to the store.
// They are "kinematic" bodies: we move them ourselves every physics step, and the player's
// car bumps into them like solid objects. They watch the road and slow down or wait for the
// player, so they don't shove you around.
//
// Behaviors:
//   lane    - drives straight along a highway lane, keeps a safe gap to whatever is ahead
//   stopped - stands still (cars stuck in a jam)
//   path    - follows a list of points, looping (cars hunting for parking)
//   rival   - follows a path that ends in YOUR parking spot, then parks there
//   walker  - walks back and forth between two points, waits if you get close

import * as THREE from "three";
import { makeCarMesh, makeShopperMesh, getCarSize, CAR_COLORS } from "./vehicles.js";

const UP = new THREE.Vector3(0, 1, 0);

// options: { kind, color, x, z, heading (degrees), behavior, speedKmh, dir, lane, path: [[x, z], ...], loop }
export function addMover(built, options) {
  let size = null;
  let mesh = null;
  if (options.behavior === "walker") {
    size = { width: 0.7, length: 1.5, height: 1.75 };
    mesh = makeShopperMesh(options.color || "#3a7bd5");
  } else {
    size = getCarSize(options.kind);
    mesh = makeCarMesh(options.kind || "sedan", options.color || CAR_COLORS[built.movers.length % CAR_COLORS.length]);
  }
  const RAPIER = built.RAPIER;
  const body = built.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(options.x, size.height / 2, options.z));
  built.world.createCollider(RAPIER.ColliderDesc.cuboid(size.width / 2, size.height / 2, size.length / 2), body);
  built.scene.add(mesh);
  built.meshes.push(mesh);

  const heading = THREE.MathUtils.degToRad(options.heading || 0);
  const speed = ((options.speedKmh || 0) * 1000) / 3600;
  const mover = {
    behavior: options.behavior || "stopped",
    body: body,
    mesh: mesh,
    size: size,
    position: new THREE.Vector3(options.x, 0, options.z),
    heading: heading,
    speed: speed,
    targetSpeed: speed,
    dir: options.dir || 1, // lane cars: +1 drives toward +Z, -1 toward -Z
    lane: options.lane || 0,
    path: options.path || null,
    loop: options.loop === true,
    pathIndex: options.pathIndex || 0,
    parked: false,
    waitTime: 0,
    start: { x: options.x, z: options.z, heading: heading, speed: speed, pathIndex: options.pathIndex || 0 },
  };
  built.movers.push(mover);
  placeNow(mover);
  return mover;
}

// Called once per physics step, before world.step().
// player = { position: Vector3 } for the player's car.
export function stepMovers(built, dt, player) {
  for (let i = 0; i < built.movers.length; i++) {
    const mover = built.movers[i];
    if (mover.behavior === "lane") {
      stepLaneCar(built, mover, dt, player);
    } else if (mover.behavior === "path" || mover.behavior === "rival") {
      stepPathCar(built, mover, i, dt, player);
    } else if (mover.behavior === "walker") {
      stepWalker(mover, dt, player);
    }
    if (mover.behavior !== "stopped") {
      mover.body.setNextKinematicTranslation({ x: mover.position.x, y: mover.size.height / 2, z: mover.position.z });
      mover.body.setNextKinematicRotation(headingQuaternion(mover.heading));
    }
  }
}

// Called every frame: put each mesh where its body is.
export function syncMoverMeshes(built) {
  for (const mover of built.movers) {
    const p = mover.body.translation();
    const r = mover.body.rotation();
    mover.mesh.position.set(p.x, p.y - mover.size.height / 2, p.z);
    mover.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
}

// Put every mover back where it started (when the player resets).
export function resetMovers(built) {
  for (const mover of built.movers) {
    mover.position.set(mover.start.x, 0, mover.start.z);
    mover.heading = mover.start.heading;
    mover.speed = mover.start.speed;
    mover.pathIndex = mover.start.pathIndex;
    mover.parked = false;
    mover.waitTime = 0;
    placeNow(mover);
  }
}

// ---------- Highway lane cars ----------

function stepLaneCar(built, car, dt, player) {
  // How much room is there in front of us, in our lane?
  let gap = Infinity;
  for (const other of built.movers) {
    if (other === car || other.dir !== car.dir) {
      continue;
    }
    if (other.behavior !== "lane" && other.behavior !== "stopped") {
      continue;
    }
    if (Math.abs(other.position.x - car.position.x) > 2.2) {
      continue;
    }
    const ahead = (other.position.z - car.position.z) * car.dir;
    if (ahead > 0) {
      gap = Math.min(gap, ahead - (other.size.length + car.size.length) / 2);
    }
  }
  // The player counts too, if they're on the road in our lane, in front of us.
  if (Math.abs(player.position.x - car.position.x) < 2.4 && player.position.y < 3) {
    const ahead = (player.position.z - car.position.z) * car.dir;
    if (ahead > 0) {
      gap = Math.min(gap, ahead - (2.2 + car.size.length / 2));
    }
  }

  // Full speed with a big gap, slower as the gap shrinks, stop when very close.
  const safeGap = 6 + car.targetSpeed * 1.2;
  let wanted = car.targetSpeed;
  if (gap < safeGap) {
    wanted = car.targetSpeed * Math.max(0, (gap - 3) / (safeGap - 3));
  }
  if (car.speed < wanted) {
    car.speed = Math.min(wanted, car.speed + 3 * dt); // speed up gently
  } else {
    car.speed = Math.max(wanted, car.speed - 9 * dt); // brake hard
  }
  car.position.z = car.position.z + car.speed * car.dir * dt;

  if (built.highway) {
    recycleLaneCar(built, car, player);
  }
}

// Keep the highway busy around the player: cars far behind get moved to somewhere ahead.
function recycleLaneCar(built, car, player) {
  const road = built.highway;
  const farBehind = car.position.z < player.position.z - 170;
  const farAhead = car.position.z > player.position.z + 700;
  const offRoad = car.position.z < road.start + 10 || car.position.z > road.end - 10;
  if (!farBehind && !farAhead && !offRoad) {
    return;
  }
  // Try a few random spots ahead of the player.
  for (let attempt = 0; attempt < 6; attempt++) {
    const lanes = road.laneX[car.dir];
    const lane = Math.floor(Math.random() * lanes.length);
    const z = player.position.z + 140 + Math.random() * 280;
    if (z > road.end - 30 || (z > road.jamStart - 30 && z < road.jamEnd + 20)) {
      continue;
    }
    if (!laneIsClear(built, car, car.dir, lanes[lane], z, 22)) {
      continue;
    }
    car.position.set(lanes[lane], 0, z);
    car.lane = lane;
    car.targetSpeed = road.laneSpeeds[lane];
    car.speed = car.targetSpeed * 0.8;
    placeNow(car);
    return;
  }
}

function laneIsClear(built, self, dir, x, z, room) {
  for (const other of built.movers) {
    if (other === self || other.dir !== dir) {
      continue;
    }
    if (Math.abs(other.position.x - x) < 2.2 && Math.abs(other.position.z - z) < room) {
      return false;
    }
  }
  return true;
}

// ---------- Cars following a path (parking lot) ----------

function stepPathCar(built, car, index, dt, player) {
  if (car.parked || !car.path) {
    return;
  }
  const target = car.path[car.pathIndex];
  const dx = target[0] - car.position.x;
  const dz = target[1] - car.position.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  const lastPoint = car.pathIndex === car.path.length - 1;

  if (distance < 1.0) {
    if (!lastPoint) {
      car.pathIndex = car.pathIndex + 1;
    } else if (car.loop) {
      car.pathIndex = 0;
    } else {
      // Arrived: park here.
      car.parked = true;
      car.speed = 0;
      if (car.behavior === "rival") {
        built.events.push("rival_parked");
      }
    }
    return;
  }

  // Turn toward the next point a little at a time, like steering.
  const wantedHeading = Math.atan2(dx, dz);
  const turn = wrapAngle(wantedHeading - car.heading);
  const maxTurn = 1.4 * dt;
  car.heading = car.heading + Math.max(-maxTurn, Math.min(maxTurn, turn));

  // Slow down for sharp turns and when arriving.
  let wanted = car.targetSpeed * Math.max(0.15, Math.cos(Math.min(Math.abs(turn), Math.PI / 2)));
  if (lastPoint && !car.loop) {
    wanted = Math.min(wanted, 0.5 + distance * 0.5);
  }
  // Wait for the player or anyone else right in front of us.
  if (somethingInFront(built, car, index, player, 7)) {
    wanted = 0;
  }
  if (car.speed < wanted) {
    car.speed = Math.min(wanted, car.speed + 2.5 * dt);
  } else {
    car.speed = Math.max(wanted, car.speed - 6 * dt);
  }
  car.position.x = car.position.x + Math.sin(car.heading) * car.speed * dt;
  car.position.z = car.position.z + Math.cos(car.heading) * car.speed * dt;
}

function somethingInFront(built, car, index, player, range) {
  if (isInFront(car, player.position, range, 2.2) && player.position.y < 3) {
    return true;
  }
  for (let i = 0; i < built.movers.length; i++) {
    const other = built.movers[i];
    if (other === car || other.behavior === "lane") {
      continue;
    }
    if (!isInFront(car, other.position, range, 2.0)) {
      continue;
    }
    // Two cars facing each other would both wait forever, so the older one goes first.
    if (other.behavior !== "walker" && isInFront(other, car.position, range, 2.0) && i > index) {
      continue;
    }
    return true;
  }
  return false;
}

function isInFront(car, point, range, halfWidth) {
  const dx = point.x - car.position.x;
  const dz = point.z - car.position.z;
  const forwardX = Math.sin(car.heading);
  const forwardZ = Math.cos(car.heading);
  const ahead = dx * forwardX + dz * forwardZ;
  const side = Math.abs(dx * forwardZ - dz * forwardX);
  return ahead > 0 && ahead < range + car.size.length / 2 && side < halfWidth;
}

// ---------- Shoppers ----------

function stepWalker(person, dt, player) {
  if (!person.path) {
    return;
  }
  // Freeze if the player's car is close (they're careful people).
  const toPlayer = person.position.distanceTo(new THREE.Vector3(player.position.x, 0, player.position.z));
  if (toPlayer < 7) {
    return;
  }
  const target = person.path[person.pathIndex];
  const dx = target[0] - person.position.x;
  const dz = target[1] - person.position.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  if (distance < 0.5) {
    // Pause a moment, then walk to the other end.
    person.waitTime = person.waitTime + dt;
    if (person.waitTime > 2) {
      person.waitTime = 0;
      person.pathIndex = (person.pathIndex + 1) % person.path.length;
    }
    return;
  }
  person.heading = Math.atan2(dx, dz);
  const step = Math.min(distance, person.targetSpeed * dt);
  person.position.x = person.position.x + (dx / distance) * step;
  person.position.z = person.position.z + (dz / distance) * step;
}

// ---------- Helpers ----------

// Teleport a mover (used when placing, resetting and recycling).
function placeNow(mover) {
  mover.body.setTranslation({ x: mover.position.x, y: mover.size.height / 2, z: mover.position.z }, true);
  mover.body.setRotation(headingQuaternion(mover.heading), true);
  mover.mesh.position.set(mover.position.x, 0, mover.position.z);
  mover.mesh.quaternion.copy(headingQuaternion(mover.heading));
}

function headingQuaternion(radians) {
  return new THREE.Quaternion().setFromAxisAngle(UP, radians);
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
