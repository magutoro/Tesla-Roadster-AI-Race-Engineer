// car-model.js — Owner: B (friend)
// An original, sculpted hypercar inspired by the Roadster reveal: low and wide, a bubble canopy
// with gold-tinted glass (like a spacesuit visor), hidden headlights, a full-width taillight,
// fan skirts, a rear diffuser with 4 thruster ports, and an active rear wing.
// Not a Tesla asset. Kept in its own file so a .glb model could be swapped in later.
//
// How the body is made: we describe the car's outline with a few curves (top line, bottom line
// with the wheel arches, and width along the car), then build ~90 cross-sections from nose to
// tail and join them into one smooth skin. The canopy is built the same way.
//
// The car faces +Z, +X is the car's LEFT side, and Y is up. Coordinates are relative to the
// center of the physics body; the ground is GROUND_Y below it.

import * as THREE from "three";
import { CONFIG } from "./config.js";

const GROUND_Y = -0.71; // body center to the ground, at rest
const ARCH_RADIUS = 0.45;
const WHEEL_CENTER = 0.36; // wheel center height above the ground

// Side view of the top of the body (z, height above ground). The dip in the middle is the cockpit.
const TOP_LINE = [
  [2.22, 0.29], [2.17, 0.39], [2.03, 0.48], [1.7, 0.6], [1.25, 0.7], [0.95, 0.77], [0.74, 0.81],
  [0.64, 0.72], [0.56, 0.64], [0.0, 0.62], [-0.6, 0.62], [-0.7, 0.68], [-0.84, 0.8], [-1.0, 0.86],
  [-1.25, 0.89], [-1.7, 0.88], [-2.0, 0.87], [-2.12, 0.885], [-2.2, 0.74], [-2.22, 0.5],
];
// Side view of the underside (before cutting the wheel arches).
const BOTTOM_LINE = [
  [2.22, 0.26], [2.1, 0.17], [1.8, 0.14], [0.0, 0.13], [-1.8, 0.16], [-2.05, 0.27], [-2.22, 0.38],
];
// Half the car's width along its length (fender bulges over the wheels, narrower nose).
const WIDTH_LINE = [
  [2.22, 0.6], [2.12, 0.8], [1.95, 0.92], [1.6, 0.97], [1.25, 0.99], [0.8, 0.97], [0.0, 0.95],
  [-0.8, 0.97], [-1.25, 1.0], [-1.7, 0.99], [-2.0, 0.96], [-2.22, 0.88],
];
// Side view of the canopy top, and its half width at the bottom.
const CANOPY_TOP = [
  [0.76, 0.79], [0.55, 0.92], [0.25, 1.08], [-0.15, 1.165], [-0.45, 1.16], [-0.72, 1.06], [-0.92, 0.92], [-1.02, 0.84],
];

export function buildCarModel() {
  const root = new THREE.Group();
  const body = new THREE.Group(); // everything that doesn't move by itself
  body.position.y = GROUND_Y;
  root.add(body);

  const materials = makeMaterials();
  const topAt = makeCurve(TOP_LINE);
  const bottomAt = makeCurve(BOTTOM_LINE);
  const widthAt = makeCurve(WIDTH_LINE);
  const canopyTopAt = makeCurve(CANOPY_TOP);

  // ----- Body skin -----
  const skin = new THREE.Mesh(buildBodyGeometry(topAt, bottomAt, widthAt), materials.paint);
  skin.castShadow = true;
  skin.receiveShadow = true;
  body.add(skin);

  // Dark parts inside the body so you can't see through it under the arches.
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.36, 3.3), materials.dark);
  tub.position.set(0, 0.34, 0.0);
  body.add(tub);
  for (const z of [CONFIG.car.wheelFrontZ, CONFIG.car.wheelRearZ]) {
    for (const side of [1, -1]) {
      const liner = new THREE.Mesh(new THREE.CylinderGeometry(ARCH_RADIUS - 0.02, ARCH_RADIUS - 0.02, 0.42, 20, 1, true, 0, Math.PI), materials.dark);
      liner.rotation.z = Math.PI / 2; // half-cylinder over the wheel, axle along X
      liner.position.set(side * 0.78, WHEEL_CENTER, z);
      liner.material = materials.darkBothSides;
      body.add(liner);
    }
  }

  // ----- Canopy (gold-tinted, see-through) -----
  const canopy = new THREE.Mesh(buildCanopyGeometry(canopyTopAt, widthAt), materials.glass);
  canopy.renderOrder = 2;
  body.add(canopy);

  // ----- Lights -----
  const headlight = new THREE.Mesh(new THREE.BoxGeometry(widthAt(2.06) * 1.7, 0.022, 0.05), materials.headlight);
  headlight.position.set(0, topAt(2.06) - 0.035, 2.07);
  headlight.rotation.x = -0.45;
  body.add(headlight);
  const tailLight = new THREE.Mesh(new THREE.BoxGeometry(widthAt(-2.18) * 1.8, 0.035, 0.03), materials.tail);
  tailLight.position.set(0, 0.68, -2.215);
  body.add(tailLight);

  // ----- Aero and trim: splitter, fan skirts, diffuser with 4 thruster ports, camera mirrors -----
  addBox(body, 1.7, 0.03, 0.4, 0, 0.13, 2.02, materials.carbon);
  const skirtMaterial = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, emissive: 0x000000, roughness: 0.5 });
  for (const side of [1, -1]) {
    addBox(body, 0.05, 0.07, 1.5, side * (widthAt(0) - 0.01), 0.15, 0, skirtMaterial);
    const mirror = addBox(body, 0.16, 0.06, 0.12, side * 0.97, 0.79, 0.52, materials.carbon);
    mirror.rotation.y = side * 0.25;
  }
  addBox(body, 1.5, 0.16, 0.45, 0, 0.27, -1.98, materials.carbon);
  for (let i = -2; i <= 2; i++) {
    addBox(body, 0.02, 0.14, 0.42, i * 0.32, 0.25, -2.0, materials.carbon);
  }
  // Reveal: four rear ports push 80 kN. Positions are in body coordinates (for effects).
  const rearNozzles = [];
  const nozzleGeometry = new THREE.CylinderGeometry(0.075, 0.09, 0.12, 18, 1, true);
  nozzleGeometry.rotateX(Math.PI / 2);
  for (const x of [-0.55, -0.2, 0.2, 0.55]) {
    const nozzle = new THREE.Mesh(nozzleGeometry, materials.nozzle);
    nozzle.position.set(x, 0.36, -2.18);
    body.add(nozzle);
    rearNozzles.push(new THREE.Vector3(x, 0.36 + GROUND_Y, -2.24));
  }

  // Rocket trim: four downward thrusters under the corners, two yaw thrusters at the nose.
  const liftNozzles = [
    new THREE.Vector3(0.62, 0.12 + GROUND_Y, 1.82),
    new THREE.Vector3(-0.62, 0.12 + GROUND_Y, 1.82),
    new THREE.Vector3(0.62, 0.15 + GROUND_Y, -1.85),
    new THREE.Vector3(-0.62, 0.15 + GROUND_Y, -1.85),
  ];
  const yawNozzles = [new THREE.Vector3(0.86, 0.3 + GROUND_Y, 1.9), new THREE.Vector3(-0.86, 0.3 + GROUND_Y, 1.9)];
  for (const spot of yawNozzles) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.05, 12), materials.nozzle);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(spot.x, spot.y - GROUND_Y, spot.z);
    body.add(nozzle);
  }

  // ----- Active rear wing: flush with the deck when slow, rises at speed -----
  const wing = new THREE.Group();
  const wingBlade = addBox(wing, 1.55, 0.035, 0.3, 0, 0, 0, materials.carbon);
  wingBlade.castShadow = true;
  for (const side of [1, -1]) {
    addBox(wing, 0.03, 0.26, 0.12, side * 0.5, -0.13, 0.02, materials.carbon);
  }
  wing.position.set(0, 0.9, -1.88);
  body.add(wing);

  // ----- Cockpit -----
  const cockpit = buildCockpit(body, materials);

  // ----- Flames (simple glowing cones; car.js adds the vapor particles) -----
  const flameMaterial = new THREE.MeshBasicMaterial({
    color: 0xbfe8ff,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const rearFlameGeometry = new THREE.ConeGeometry(0.08, 1, 12, 1, true);
  rearFlameGeometry.rotateX(-Math.PI / 2);
  rearFlameGeometry.translate(0, 0, -0.5);
  const rearFlames = [];
  for (const spot of rearNozzles) {
    const flame = new THREE.Mesh(rearFlameGeometry, flameMaterial);
    flame.position.copy(spot);
    flame.visible = false;
    root.add(flame);
    rearFlames.push(flame);
  }
  const liftFlameGeometry = new THREE.ConeGeometry(0.09, 1, 12, 1, true);
  liftFlameGeometry.rotateX(Math.PI);
  liftFlameGeometry.translate(0, -0.5, 0);
  const liftFlames = [];
  for (const spot of liftNozzles) {
    const flame = new THREE.Mesh(liftFlameGeometry, flameMaterial);
    flame.position.copy(spot);
    flame.visible = false;
    root.add(flame);
    liftFlames.push(flame);
  }
  const yawFlameGeometry = new THREE.ConeGeometry(0.06, 0.6, 10, 1, true);
  yawFlameGeometry.rotateZ(-Math.PI / 2);
  yawFlameGeometry.translate(0.3, 0, 0);
  const yawFlames = [];
  for (const spot of yawNozzles) {
    const flame = new THREE.Mesh(yawFlameGeometry, flameMaterial);
    flame.position.copy(spot);
    if (spot.x < 0) {
      flame.rotation.y = Math.PI;
    }
    flame.visible = false;
    root.add(flame);
    yawFlames.push(flame);
  }

  // Fan glow under the car.
  const fanGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0x2fd2ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const fanGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 3.9), fanGlowMaterial);
  fanGlow.rotation.x = -Math.PI / 2;
  fanGlow.position.y = 0.06;
  body.add(fanGlow);

  // ----- Wheels. Order matches the physics: front-left, front-right, rear-left, rear-right. -----
  const wheelParts = makeWheelParts(materials);
  const wheels = [];
  const wheelX = [CONFIG.car.wheelX, -CONFIG.car.wheelX, CONFIG.car.wheelX, -CONFIG.car.wheelX];
  const wheelZ = [CONFIG.car.wheelFrontZ, CONFIG.car.wheelFrontZ, CONFIG.car.wheelRearZ, CONFIG.car.wheelRearZ];
  for (let i = 0; i < 4; i++) {
    const wheel = buildWheel(wheelParts, wheelX[i] > 0);
    wheel.steer.position.set(wheelX[i], WHEEL_CENTER + GROUND_Y, wheelZ[i]);
    root.add(wheel.steer);
    wheels.push(wheel);
  }

  // ----- Controls for car.js -----
  function setFans(power, time) {
    const pulse = 0.85 + 0.15 * Math.sin(time * 30);
    fanGlowMaterial.opacity = power * 0.5 * pulse;
    skirtMaterial.emissive.setRGB(0.1 * power, 0.6 * power, 0.9 * power);
  }

  function setThrust(on, time) {
    for (const flame of rearFlames) {
      flame.visible = on;
      flame.scale.set(1, 1, 0.9 + Math.random() * 0.5 + 0.1 * Math.sin(time * 50));
    }
  }

  // firing: four true/false values, one per corner thruster.
  function setCornerThrusters(firing, time) {
    for (let i = 0; i < 4; i++) {
      liftFlames[i].visible = firing[i];
      liftFlames[i].scale.set(1, 1.0 + Math.random() * 0.6 + 0.2 * Math.sin(time * 45), 1);
    }
  }

  // direction: +1 = turning right (left nozzle fires), -1 = turning left, 0 = off.
  function setYawThrusters(direction, time) {
    yawFlames[0].visible = direction > 0;
    yawFlames[1].visible = direction < 0;
    for (const flame of yawFlames) {
      flame.scale.set(1 + Math.random() * 0.5 + 0.1 * Math.sin(time * 40), 1, 1);
    }
  }

  function setBraking(amount) {
    materials.tail.emissiveIntensity = 1.6 + amount * 3;
  }

  // deploy: 0 = flush with the deck, 1 = fully up and angled.
  function setWing(deploy) {
    wing.position.y = 0.9 + deploy * 0.22;
    wing.rotation.x = deploy * 0.18;
  }

  // From inside, the visor tint is much lighter (like real tinted glass), so the road is easy to see.
  function setCockpitView(inside) {
    if (inside) {
      materials.glass.opacity = 0.12;
    } else {
      materials.glass.opacity = 0.62;
    }
  }

  // steer: -1..1 from the driver. The yoke turns up to ~120 degrees each way.
  function setYoke(steer) {
    cockpit.yoke.rotation.z = steer * 2.1;
  }

  return {
    root: root,
    wheels: wheels,
    rearNozzles: rearNozzles,
    liftNozzles: liftNozzles,
    yawNozzles: yawNozzles,
    cockpitEye: cockpit.eye,
    setFans: setFans,
    setThrust: setThrust,
    setCornerThrusters: setCornerThrusters,
    setYawThrusters: setYawThrusters,
    setBraking: setBraking,
    setWing: setWing,
    setYoke: setYoke,
    setCockpitView: setCockpitView,
    updateScreens: cockpit.updateScreens,
  };
}

// ---------- Body shape ----------

// Height of the wheel arch opening at position z (0 where there's no arch).
function archHeight(z) {
  let height = 0;
  for (const wheelZ of [CONFIG.car.wheelFrontZ, CONFIG.car.wheelRearZ]) {
    const dz = z - wheelZ;
    if (Math.abs(dz) < ARCH_RADIUS) {
      height = Math.max(height, WHEEL_CENTER + Math.sqrt(ARCH_RADIUS * ARCH_RADIUS - dz * dz));
    }
  }
  return height;
}

// The skin: cross-sections from tail to nose, joined into one smooth surface.
function buildBodyGeometry(topAt, bottomAt, widthAt) {
  const stations = 110;
  const ringPoints = 48;
  const positions = [];
  for (let k = 0; k <= stations; k++) {
    const z = -2.22 + (4.44 * k) / stations;
    const ring = bodySection(z, topAt(z), bottomAt(z), widthAt(z), ringPoints);
    for (const p of ring) {
      positions.push(p.x, p.y, z);
    }
  }
  return skinFromRings(positions, stations + 1, ringPoints, true);
}

// One cross-section of the body at position z. Between the wheels the body is a simple rounded
// shape. Over a wheel it becomes what a real car looks like there: a narrow lower body between
// the wheels, a fender "shelf" above the tire, and fender crests standing a little above the hood.
function bodySection(z, hood, bottom, halfWidth, count) {
  const innerX = 0.6; // inside edge of the wheel wells
  const arch = archHeight(z);
  // How much of a wheel well this section has (0 = none, 1 = full), so the shape changes smoothly.
  const well = smoothstep(bottom + 0.02, bottom + 0.2, arch);
  const wellTop = Math.max(bottom + 0.08, arch);
  const crest = Math.max(hood, wellTop + 0.05); // fenders rise over the wheels
  const crown = 0.035 * smoothstep(0.55, 0.75, hood); // the hood and deck are a bit rounded
  const lean = 0.1 * smoothstep(0.55, 0.9, crest) * halfWidth; // tumblehome: the sides lean in at the top
  const stepX = innerX + (halfWidth - 0.12 - innerX) * (1 - well); // where the underside steps up
  const sideHeight = crest - wellTop;
  // Right half, from the bottom middle up to the top middle (x is mirrored for the left half).
  const half = [
    [0, bottom],
    [stepX - 0.05, bottom],
    [stepX, bottom + 0.04],
    [stepX, wellTop - 0.04],
    [stepX + 0.04, wellTop],
    [halfWidth - 0.04, wellTop],
    [halfWidth, wellTop + 0.03],
    [halfWidth, wellTop + 0.3 * sideHeight],
    [halfWidth, wellTop + 0.62 * sideHeight],
    [halfWidth - lean * 0.6, wellTop + 0.86 * sideHeight],
    [halfWidth * 0.93 - lean, crest - 0.006],
    [halfWidth * 0.76 - lean, crest],
    [halfWidth * 0.45, hood + crown * 0.7],
    [0, hood + crown],
  ];
  const points = [];
  for (const p of half) {
    points.push(new THREE.Vector3(p[0], p[1], 0));
  }
  for (let i = half.length - 2; i >= 1; i--) {
    points.push(new THREE.Vector3(-half[i][0], half[i][1], 0));
  }
  const curve = new THREE.CatmullRomCurve3(points, true, "centripetal");
  return curve.getSpacedPoints(count).slice(0, count);
}

// The canopy: a bubble from the windshield to behind the seats, sitting on the beltline.
function buildCanopyGeometry(canopyTopAt, widthAt) {
  const stations = 48;
  const ringPoints = 24;
  const positions = [];
  const front = 0.76;
  const back = -1.02;
  const beltline = 0.6;
  for (let k = 0; k <= stations; k++) {
    const z = back + ((front - back) * k) / stations;
    const top = Math.max(beltline + 0.03, canopyTopAt(z));
    const halfWidth = widthAt(z) * 0.86;
    // Upper half of a rounded shape: from the right side at the beltline, over the top, to the left side.
    for (let j = 0; j <= ringPoints; j++) {
      const angle = (Math.PI * j) / ringPoints;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const x = Math.sign(c) * Math.pow(Math.abs(c), 0.8) * halfWidth;
      const y = beltline + Math.pow(s, 0.8) * (top - beltline);
      positions.push(-x, y, z);
    }
  }
  return skinFromRings(positions, stations + 1, ringPoints + 1, false);
}

// Join rings of points into triangles. closedRings = each ring loops around (the body).
function skinFromRings(positions, ringCount, ringSize, closedRings) {
  const indices = [];
  for (let k = 0; k < ringCount - 1; k++) {
    let segments = ringSize - 1;
    if (closedRings) {
      segments = ringSize;
    }
    for (let j = 0; j < segments; j++) {
      const a = k * ringSize + j;
      const b = k * ringSize + ((j + 1) % ringSize);
      const c = (k + 1) * ringSize + j;
      const d = (k + 1) * ringSize + ((j + 1) % ringSize);
      indices.push(a, b, c, b, d, c);
    }
  }
  if (closedRings) {
    // Close the nose and tail with a fan of triangles around the middle.
    for (const k of [0, ringCount - 1]) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let j = 0; j < ringSize; j++) {
        cx = cx + positions[(k * ringSize + j) * 3];
        cy = cy + positions[(k * ringSize + j) * 3 + 1];
        cz = cz + positions[(k * ringSize + j) * 3 + 2];
      }
      const center = positions.length / 3;
      positions.push(cx / ringSize, cy / ringSize, cz / ringSize);
      for (let j = 0; j < ringSize; j++) {
        const a = k * ringSize + j;
        const b = k * ringSize + ((j + 1) % ringSize);
        if (k === 0) {
          indices.push(center, b, a);
        } else {
          indices.push(center, a, b);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Turn a list of [z, value] points into a smooth function of z.
function makeCurve(points) {
  const vectors = [];
  for (const p of points) {
    vectors.push(new THREE.Vector3(p[0], p[1], 0));
  }
  const curve = new THREE.CatmullRomCurve3(vectors, false, "centripetal");
  const samples = curve.getPoints(400);
  samples.sort(function (a, b) {
    return a.x - b.x;
  });
  return function (z) {
    if (z <= samples[0].x) {
      return samples[0].y;
    }
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].x >= z) {
        const a = samples[i - 1];
        const b = samples[i];
        const t = (z - a.x) / Math.max(0.0001, b.x - a.x);
        return a.y + (b.y - a.y) * t;
      }
    }
    return samples[samples.length - 1].y;
  };
}

// ---------- Cockpit ----------

function buildCockpit(body, materials) {
  const group = new THREE.Group();
  body.add(group);
  // Dark floor over the whole cabin, so you can't see through the car from inside.
  addBox(group, 1.72, 0.02, 1.3, 0, 0.665, -0.05, materials.interior);
  // Dashboard and center console.
  const dash = addBox(group, 1.6, 0.12, 0.26, 0, 0.73, 0.52, materials.interior);
  dash.rotation.x = 0.2;
  addBox(group, 0.2, 0.06, 0.8, 0, 0.69, 0.0, materials.interior);
  // Two bucket seats (white backs, black cushions).
  for (const x of [0.36, -0.36]) {
    addBox(group, 0.46, 0.1, 0.46, x, 0.7, -0.26, materials.seat);
    const back = addBox(group, 0.46, 0.44, 0.08, x, 0.9, -0.52, materials.seatBack);
    back.rotation.x = -0.25;
  }
  // The yoke (steer-by-wire), in front of the driver on the left.
  const yokeMount = new THREE.Group();
  yokeMount.position.set(0.36, 0.88, 0.26);
  yokeMount.rotation.x = -0.35; // tilted toward the driver
  group.add(yokeMount);
  const yoke = new THREE.Group();
  yokeMount.add(yoke);
  for (const side of [1, -1]) {
    addBox(yoke, 0.035, 0.14, 0.035, side * 0.16, 0.0, 0, materials.yoke);
  }
  addBox(yoke, 0.36, 0.03, 0.03, 0, -0.065, 0, materials.yoke);
  addBox(yoke, 0.32, 0.025, 0.025, 0, 0.0, 0, materials.yoke);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), materials.yoke);
  hub.rotation.x = Math.PI / 2;
  yoke.add(hub);
  addBox(yokeMount, 0.05, 0.05, 0.18, 0, -0.02, 0.1, materials.interior); // column

  // Screens: a center touchscreen and two small displays behind the yoke (reveal interior).
  const center = makeScreen(512, 320);
  center.mesh.scale.set(0.32, 0.2, 1);
  center.mesh.position.set(0, 0.9, 0.42);
  center.mesh.rotation.set(-0.45, Math.PI, 0); // face the driver (-Z)
  group.add(center.mesh);
  const leftDisplay = makeScreen(256, 140);
  leftDisplay.mesh.scale.set(0.13, 0.07, 1);
  leftDisplay.mesh.position.set(0.5, 0.89, 0.44);
  leftDisplay.mesh.rotation.set(-0.45, Math.PI, 0);
  group.add(leftDisplay.mesh);
  const rightDisplay = makeScreen(256, 140);
  rightDisplay.mesh.scale.set(0.13, 0.07, 1);
  rightDisplay.mesh.position.set(0.22, 0.89, 0.44);
  rightDisplay.mesh.rotation.set(-0.45, Math.PI, 0);
  group.add(rightDisplay.mesh);

  // Driver's eye, in body coordinates (used by the cockpit camera).
  const eye = new THREE.Vector3(0.36, 1.09 + GROUND_Y, -0.4);

  let lastDraw = -1;
  function updateScreens(car, time) {
    if (time - lastDraw < 0.15) {
      return;
    }
    lastDraw = time;
    const tel = car.telemetry;
    // Center screen: speed, mode, air, fans, g.
    let ctx = center.ctx;
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, 512, 320);
    ctx.fillStyle = "#e9edf2";
    ctx.font = "bold 120px -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(String(Math.round(car.speedKmh)), 30, 140);
    ctx.font = "32px -apple-system, sans-serif";
    ctx.fillStyle = "#8a93a0";
    ctx.fillText("km/h", 34, 185);
    ctx.fillStyle = "#ff9a3c";
    ctx.font = "bold 34px -apple-system, sans-serif";
    ctx.fillText(car.mode.toUpperCase(), 300, 60);
    ctx.fillStyle = car.fansOn ? "#34d3ff" : "#5a636e";
    ctx.fillText("FANS " + (car.fansOn ? "ON" : "OFF"), 300, 110);
    ctx.fillStyle = "#8a93a0";
    ctx.font = "28px -apple-system, sans-serif";
    ctx.fillText("AIR " + Math.round(car.tankLiters) + " L", 300, 160);
    ctx.fillText("G " + Math.sqrt(tel.gLat * tel.gLat + tel.gLong * tel.gLong).toFixed(2), 300, 205);
    ctx.fillStyle = "#1c2129";
    ctx.fillRect(30, 250, 452, 22);
    ctx.fillStyle = "#ff9a3c";
    ctx.fillRect(30, 250, (452 * car.tank) / 100, 22);
    center.texture.needsUpdate = true;
    // Left display: speed. Right display: motor power.
    ctx = leftDisplay.ctx;
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, 256, 140);
    ctx.fillStyle = "#e9edf2";
    ctx.font = "bold 70px -apple-system, sans-serif";
    ctx.fillText(String(Math.round(car.speedKmh)), 20, 90);
    ctx.font = "22px -apple-system, sans-serif";
    ctx.fillStyle = "#8a93a0";
    ctx.fillText("km/h  D", 22, 125);
    leftDisplay.texture.needsUpdate = true;
    ctx = rightDisplay.ctx;
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, 256, 140);
    ctx.fillStyle = tel.motorKW < 0 ? "#3ee08f" : "#e9edf2";
    ctx.font = "bold 56px -apple-system, sans-serif";
    ctx.fillText(String(Math.round(tel.motorKW)), 20, 80);
    ctx.font = "22px -apple-system, sans-serif";
    ctx.fillStyle = "#8a93a0";
    ctx.fillText("kW", 22, 120);
    rightDisplay.texture.needsUpdate = true;
  }

  return { yoke: yoke, eye: eye, updateScreens: updateScreens };
}

function makeScreen(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texture }));
  return { mesh: mesh, ctx: canvas.getContext("2d"), texture: texture };
}

// ---------- Wheels ----------

function makeWheelParts(materials) {
  const radius = CONFIG.car.wheelRadius;
  // Tire: a rounded sidewall profile spun around the axle.
  const profile = [
    [0.27, -0.14], [0.33, -0.142], [0.352, -0.125], [radius, -0.085], [radius, 0.085],
    [0.352, 0.125], [0.33, 0.142], [0.27, 0.14],
  ];
  const points = [];
  for (const p of profile) {
    points.push(new THREE.Vector2(p[0], p[1]));
  }
  const tire = new THREE.LatheGeometry(points, 40);
  tire.rotateZ(Math.PI / 2); // axle along X
  const rim = new THREE.CylinderGeometry(0.265, 0.265, 0.24, 32, 1, true);
  rim.rotateZ(Math.PI / 2);
  const face = new THREE.CylinderGeometry(0.255, 0.255, 0.02, 32);
  face.rotateZ(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.03, 0.22, 0.045);
  spoke.translate(0, 0.13, 0);
  const cap = new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16);
  cap.rotateZ(Math.PI / 2);
  const disc = new THREE.CylinderGeometry(0.21, 0.21, 0.03, 32);
  disc.rotateZ(Math.PI / 2);
  const caliper = new THREE.BoxGeometry(0.06, 0.1, 0.16);
  return {
    tire: tire,
    rim: rim,
    face: face,
    spoke: spoke,
    cap: cap,
    disc: disc,
    caliper: caliper,
    materials: materials,
  };
}

// steer turns the wheel left/right; spin rolls it. The brake caliper doesn't spin.
function buildWheel(parts, isLeftSide) {
  const m = parts.materials;
  const steer = new THREE.Group();
  const spin = new THREE.Group();
  steer.add(spin);
  let outward = -1;
  if (isLeftSide) {
    outward = 1;
  }
  spin.add(shadowed(new THREE.Mesh(parts.tire, m.rubber)));
  spin.add(new THREE.Mesh(parts.rim, m.rim));
  const face = new THREE.Mesh(parts.face, m.rimFace);
  face.position.x = outward * 0.09;
  spin.add(face);
  // Ten twin spokes.
  for (let i = 0; i < 10; i++) {
    const spokeMesh = new THREE.Mesh(parts.spoke, m.rim);
    spokeMesh.position.x = outward * 0.105;
    spokeMesh.rotation.x = (i * Math.PI * 2) / 10;
    spin.add(spokeMesh);
  }
  const cap = new THREE.Mesh(parts.cap, m.rim);
  cap.position.x = outward * 0.11;
  spin.add(cap);
  const disc = new THREE.Mesh(parts.disc, m.disc);
  disc.position.x = -outward * 0.02;
  spin.add(disc);
  const caliper = new THREE.Mesh(parts.caliper, m.caliper);
  caliper.position.set(outward * 0.02, 0.15, -0.1);
  steer.add(caliper);
  return { steer: steer, spin: spin };
}

// ---------- Small helpers ----------

function makeMaterials() {
  return {
    // "Ano White" paint with a clear coat that reflects the sky.
    paint: new THREE.MeshPhysicalMaterial({ color: 0xf2f3f5, metalness: 0.15, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.08 }),
    // Gold-tinted canopy, like a spacesuit visor. See-through, so the cockpit shows.
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x8a6420,
      metalness: 0.7,
      roughness: 0.06,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.8 }),
    darkBothSides: new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.8, side: THREE.DoubleSide }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x17191c, metalness: 0.4, roughness: 0.38 }),
    nozzle: new THREE.MeshStandardMaterial({ color: 0x3a3e44, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf6ff, emissiveIntensity: 2.2 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1a1a, emissiveIntensity: 1.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x161617, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.85, roughness: 0.3 }),
    rimFace: new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.7, roughness: 0.4 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x6b7078, metalness: 0.9, roughness: 0.45 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xc0262d, metalness: 0.3, roughness: 0.4 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.8 }),
    seatBack: new THREE.MeshStandardMaterial({ color: 0xe8e8e6, roughness: 0.6 }),
    yoke: new THREE.MeshStandardMaterial({ color: 0x101113, roughness: 0.5, metalness: 0.2 }),
  };
}

function addBox(parent, w, h, d, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function shadowed(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
