// vehicles.js — Owner: B (friend)
// Cars, vans and trucks for parked cars and traffic, plus shoppers with carts.
// Generic shapes only, never real car models.
//
// Each vehicle body is built like the Roadster in car-model.js: we describe its side view
// (roof line, underside) and its width along the length, then build cross-sections from tail
// to nose and join them into one smooth skin. Each vertex gets a color: paint below the
// beltline, dark glass for the windows above it, black trim on the bumpers.
//
// Each vehicle is ONE mesh: all its parts are merged into a single geometry with the colors
// baked in, and every vehicle shares one material. That keeps a parking lot full of cars fast.
// Vehicles face +Z, with their origin on the ground at the center.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const CAR_SIZES = {
  compact: { length: 3.6, width: 1.8, height: 1.4 }, // small two-seat robotaxi
  sedan: { length: 4.8, width: 1.85, height: 1.45 },
  suv: { length: 4.9, width: 2.0, height: 1.8 },
  pickup: { length: 5.8, width: 2.05, height: 1.9 },
  van: { length: 5.2, width: 2.0, height: 2.2 },
  semi: { length: 16, width: 2.6, height: 4.0 },
};

export const CAR_COLORS = ["#c0392b", "#2c3e50", "#7f8c8d", "#1f6fb2", "#d4ac0d", "#ecf0f1", "#16a085", "#5b2c6f", "#1b1b1b", "#b9bec5"];

export function getCarSize(kind) {
  if (CAR_SIZES[kind]) {
    return CAR_SIZES[kind];
  }
  return CAR_SIZES.sedan;
}

// The shape of each kind. Lines are [position along the car, value] where position goes from
// -0.5 (rear) to 0.5 (front), and heights are fractions of the vehicle's height.
//   top: the roof line seen from the side      belt: where the windows start
//   clearance: gap under the body (m)          wheel: wheel radius (m)
//   front/rear: distance from the bumper to the axle (m)
const SHAPES = {
  compact: {
    top: [[-0.5, 0.42], [-0.485, 0.8], [-0.43, 0.97], [-0.1, 1.0], [0.12, 0.98], [0.3, 0.7], [0.44, 0.56], [0.5, 0.4]],
    belt: 0.6,
    clearance: 0.17,
    wheel: 0.31,
    front: 0.68,
    rear: 0.6,
  },
  sedan: {
    top: [[-0.5, 0.5], [-0.47, 0.6], [-0.38, 0.63], [-0.27, 0.68], [-0.14, 0.95], [0.04, 1.0], [0.14, 0.97], [0.27, 0.67], [0.4, 0.6], [0.48, 0.52], [0.5, 0.4]],
    belt: 0.65,
    clearance: 0.15,
    wheel: 0.33,
    front: 0.95,
    rear: 1.05,
  },
  suv: {
    top: [[-0.5, 0.5], [-0.485, 0.88], [-0.43, 0.98], [0.08, 1.0], [0.2, 0.95], [0.31, 0.7], [0.44, 0.63], [0.5, 0.47]],
    belt: 0.63,
    clearance: 0.24,
    wheel: 0.38,
    front: 0.95,
    rear: 1.0,
  },
  van: {
    top: [[-0.5, 0.36], [-0.49, 0.94], [-0.45, 1.0], [0.24, 1.0], [0.37, 0.86], [0.46, 0.56], [0.5, 0.42]],
    belt: 0.55,
    clearance: 0.2,
    wheel: 0.36,
    front: 0.85,
    rear: 1.0,
  },
  pickup: {
    // Cab in the middle; behind it the line drops to the bed floor (the bed is open).
    top: [[-0.5, 0.5], [-0.12, 0.5], [-0.1, 0.62], [-0.075, 0.98], [0.12, 1.0], [0.2, 0.95], [0.28, 0.66], [0.42, 0.6], [0.5, 0.45]],
    belt: 0.63,
    clearance: 0.3,
    wheel: 0.4,
    front: 1.0,
    rear: 1.15,
    bedEnd: -0.11, // the bed runs from the tailgate up to here
  },
  semi: {
    // Only the cab is a smooth loft; the trailer is a separate box.
    top: [[-0.5, 0.94], [0.08, 1.0], [0.3, 0.97], [0.42, 0.8], [0.48, 0.52], [0.5, 0.36]],
    belt: 0.62,
    clearance: 0.5,
    wheel: 0.52,
    front: 0.9,
    rear: 0.8,
    cabLength: 3.2,
    cabHeight: 3.1,
  },
};

// Underside bends up near the bumpers. Width tapers at both ends.
const BOTTOM_LINE = [[-0.5, 0.12], [-0.44, 0.02], [-0.3, 0.0], [0.3, 0.0], [0.44, 0.03], [0.5, 0.14]];
const WIDTH_LINE = [[-0.5, 0.84], [-0.46, 0.96], [-0.32, 1.0], [0.3, 1.0], [0.44, 0.96], [0.5, 0.82]];

const GLASS = new THREE.Color("#141a21");
const TRIM = new THREE.Color("#1c1d20");
const BED_LINER = new THREE.Color("#2a2c30");
const TIRE = new THREE.Color("#141414");
const HUB = new THREE.Color("#9aa0a8");
const HEADLIGHT = new THREE.Color("#f6f2dc");
const TAILLIGHT = new THREE.Color("#ff2a2a");

// One shared material: the colors live in the geometry. A little gloss, since the scene reflects.
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.3 });
const geometryCache = {};

export function makeCarMesh(kind, color) {
  const key = kind + color;
  if (!geometryCache[key]) {
    geometryCache[key] = buildVehicleGeometry(kind, color);
  }
  const mesh = new THREE.Mesh(geometryCache[key], material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildVehicleGeometry(kind, color) {
  let shape = SHAPES[kind];
  if (!shape) {
    shape = SHAPES.sedan;
    kind = "sedan";
  }
  const size = getCarSize(kind);
  const paint = new THREE.Color(color);
  const parts = [];

  if (kind === "semi") {
    // Rounded cab at the front, a long box trailer behind it.
    const cabCenter = size.length / 2 - shape.cabLength / 2;
    const cab = buildBody(shape, shape.cabLength, size.width, shape.cabHeight, paint, [shape.cabLength / 2 - shape.front]);
    cab.translate(0, 0, cabCenter);
    parts.push(cab);
    const trailerLength = size.length - shape.cabLength - 0.3;
    const trailerCenter = -size.length / 2 + trailerLength / 2;
    parts.push(box(size.width, size.height - 1.05, trailerLength, 0, 1.05 + (size.height - 1.05) / 2, trailerCenter, new THREE.Color("#dcdcdc")));
    parts.push(box(size.width * 0.9, 0.25, trailerLength, 0, 0.92, trailerCenter, TRIM)); // trailer chassis
    // Wheels: steer axle under the cab, drive axle at the back of the cab, two trailer axles.
    const axles = [size.length / 2 - shape.front, size.length / 2 - shape.cabLength + 0.6, -size.length / 2 + 2.2, -size.length / 2 + 3.6];
    addWheels(parts, axles, size.width, shape.wheel);
    addLights(parts, size.width, size.length / 2, 0.85, -size.length / 2, 1.2);
  } else {
    const axles = [size.length / 2 - shape.front, -size.length / 2 + shape.rear];
    parts.push(buildBody(shape, size.length, size.width, size.height, paint, axles));
    if (kind === "pickup") {
      // Open bed: side walls and a tailgate standing on the bed floor.
      const bedFloor = size.height * 0.5;
      const bedStart = -size.length / 2;
      const bedEnd = shape.bedEnd * size.length;
      const bedLength = bedEnd - bedStart;
      for (const side of [-1, 1]) {
        parts.push(box(0.08, 0.18, bedLength, side * (size.width / 2 - 0.06), bedFloor + 0.09, bedStart + bedLength / 2, paint));
      }
      parts.push(box(size.width - 0.04, 0.18, 0.08, 0, bedFloor + 0.09, bedStart + 0.05, paint));
    }
    addWheels(parts, axles, size.width, shape.wheel);
    const frontTop = curveValue(shape.top, 0.5) * size.height;
    const rearTop = curveValue(shape.top, -0.5) * size.height;
    addLights(parts, size.width, size.length / 2, Math.max(0.45, frontTop - 0.1), -size.length / 2, Math.max(0.55, rearTop - 0.1));
  }
  return mergeGeometries(parts);
}

// ---------- The smooth body ----------

// axles: the z positions of the wheels (for cutting the wheel arches).
function buildBody(shape, length, width, height, paint, axles) {
  const stations = 40;
  const ringSize = 32;
  const archRadius = shape.wheel + 0.08;
  const roofLine = height * 0.93;
  const positions = [];
  const colors = [];
  for (let k = 0; k <= stations; k++) {
    const u = -0.5 + k / stations;
    const z = u * length;
    const top = curveValue(shape.top, u) * height;
    const bottom = shape.clearance + curveValue(BOTTOM_LINE, u);
    const halfWidth = (width / 2) * curveValue(WIDTH_LINE, u);
    // The beltline can't be above the roof (on the hood and trunk the "roof" is the hood itself).
    const belt = Math.min(shape.belt * height, top - 0.03);
    // How high the wheel arch reaches here (0 if there's no wheel at this spot).
    let arch = 0;
    for (const axle of axles) {
      const dz = z - axle;
      if (Math.abs(dz) < archRadius) {
        arch = Math.max(arch, shape.wheel + Math.sqrt(archRadius * archRadius - dz * dz));
      }
    }
    const ring = bodySection(top, bottom, belt, halfWidth, arch, ringSize);
    for (const p of ring) {
      positions.push(p.x, p.y, z);
      colors.push(pickColor(shape, p.y, top, belt, bottom, u, paint, roofLine));
    }
  }
  return skin(positions, colors, stations + 1, ringSize);
}

// One cross-section: flat underneath, a step up for the wheel wells over a wheel, widest at
// the beltline, and the windows leaning in toward the roof.
function bodySection(top, bottom, belt, halfWidth, arch, count) {
  const well = smoothstep(bottom + 0.02, bottom + 0.2, arch); // 0 = no wheel well here, 1 = full
  const wellTop = Math.max(bottom + 0.08, Math.min(arch, belt - 0.06));
  const innerX = halfWidth - 0.38; // inside edge of the wheel well
  const stepX = innerX + (halfWidth - 0.08 - innerX) * (1 - well);
  let lean = 0.05 * halfWidth; // hood and trunk edges are just rounded
  if (top - belt > 0.15) {
    lean = 0.17 * halfWidth; // a greenhouse: side windows lean in
  }
  const crown = Math.min(0.05, (top - bottom) * 0.04);
  // Right half, from the bottom middle up to the top middle (mirrored for the left half).
  const half = [
    [0, bottom],
    [stepX - 0.04, bottom],
    [stepX, bottom + 0.04],
    [stepX, wellTop - 0.04],
    [stepX + 0.04, wellTop],
    [halfWidth - 0.03, wellTop],
    [halfWidth, wellTop + 0.04],
    [halfWidth, belt - 0.02],
    [halfWidth - 0.01, belt],
    [halfWidth - lean * 0.6, belt + (top - belt) * 0.55],
    [halfWidth * 0.8 - lean, top - 0.015],
    [halfWidth * 0.45, top + crown * 0.6],
    [0, top + crown],
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

// Paint below the beltline, glass for the windows, black trim on the bumpers.
// roofLine: above this height the top surface is the flat roof (painted). Lower down, the top
// of the greenhouse is the sloping windshield or rear window, which is glass.
function pickColor(shape, y, top, belt, bottom, u, paint, roofLine) {
  if (y > belt + 0.01 && top > belt + 0.08) {
    const onRoof = y > top - 0.05 && top > roofLine;
    if (!onRoof) {
      return GLASS;
    }
  }
  if (shape.bedEnd !== undefined && u < shape.bedEnd && y > top - 0.04) {
    return BED_LINER;
  }
  if (Math.abs(u) > 0.43 && y < bottom + 0.2) {
    return TRIM;
  }
  if (y < bottom + 0.05) {
    return TRIM; // dark sills and underside
  }
  return paint;
}

// Join rings of points into triangles, and close the nose and tail.
function skin(positions, colors, ringCount, ringSize) {
  const flatPositions = [];
  const flatColors = [];
  for (let i = 0; i < positions.length; i++) {
    flatPositions.push(positions[i]);
  }
  for (const c of colors) {
    flatColors.push(c.r, c.g, c.b);
  }
  const indices = [];
  for (let k = 0; k < ringCount - 1; k++) {
    for (let j = 0; j < ringSize; j++) {
      const a = k * ringSize + j;
      const b = k * ringSize + ((j + 1) % ringSize);
      const c = (k + 1) * ringSize + j;
      const d = (k + 1) * ringSize + ((j + 1) % ringSize);
      indices.push(a, b, c, b, d, c);
    }
  }
  for (const k of [0, ringCount - 1]) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let j = 0; j < ringSize; j++) {
      cx = cx + flatPositions[(k * ringSize + j) * 3];
      cy = cy + flatPositions[(k * ringSize + j) * 3 + 1];
      cz = cz + flatPositions[(k * ringSize + j) * 3 + 2];
    }
    const center = flatPositions.length / 3;
    flatPositions.push(cx / ringSize, cy / ringSize, cz / ringSize);
    flatColors.push(TRIM.r, TRIM.g, TRIM.b);
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
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(flatPositions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(flatColors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------- Wheels and lights ----------

function addWheels(parts, axles, width, radius) {
  for (const z of axles) {
    for (const side of [-1, 1]) {
      const x = side * (width / 2 - 0.16);
      const tire = new THREE.CylinderGeometry(radius, radius, 0.26, 18);
      tire.rotateZ(Math.PI / 2);
      parts.push(colored(tire, x, radius, z, TIRE));
      const hub = new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, 0.02, 14);
      hub.rotateZ(Math.PI / 2);
      parts.push(colored(hub, x + side * 0.13, radius, z, HUB));
    }
  }
}

// Two headlights at the front, two tail lights at the back, so you can tell which way traffic goes.
function addLights(parts, width, frontZ, frontY, rearZ, rearY) {
  for (const side of [-1, 1]) {
    parts.push(box(0.38, 0.1, 0.08, side * (width / 2 - 0.32), frontY, frontZ - 0.05, HEADLIGHT));
    parts.push(box(0.38, 0.1, 0.08, side * (width / 2 - 0.32), rearY, rearZ + 0.05, TAILLIGHT));
  }
}

// ---------- Shoppers ----------

// A person pushing a shopping cart (for the parking lot). Faces +Z.
const shopperCache = {};
export function makeShopperMesh(shirtColor) {
  if (!shopperCache[shirtColor]) {
    const shirt = new THREE.Color(shirtColor);
    const skinColor = new THREE.Color("#e0b48f");
    const pants = new THREE.Color("#2b3442");
    const metal = new THREE.Color("#c7ccd3");
    const parts = [];
    // Legs, body, head, and arms reaching forward to the cart handle.
    for (const side of [-1, 1]) {
      parts.push(cylinder(0.08, 0.07, 0.82, side * 0.1, 0.41, -0.4, pants));
    }
    parts.push(cylinder(0.2, 0.17, 0.62, 0, 1.12, -0.4, shirt));
    const head = new THREE.SphereGeometry(0.12, 12, 10);
    parts.push(colored(head, 0, 1.6, -0.4, skinColor));
    for (const side of [-1, 1]) {
      const arm = new THREE.CylinderGeometry(0.045, 0.04, 0.5, 8);
      arm.rotateX(-1.1);
      parts.push(colored(arm, side * 0.2, 1.16, -0.2, shirt));
    }
    // Cart: basket, handle, and four small wheels.
    parts.push(box(0.56, 0.42, 0.78, 0, 0.78, 0.38, metal));
    parts.push(box(0.6, 0.04, 0.04, 0, 1.0, -0.04, new THREE.Color("#c0392b")));
    for (const x of [-0.24, 0.24]) {
      for (const z of [0.08, 0.68]) {
        parts.push(cylinder(0.05, 0.05, 0.04, x, 0.05, z, TIRE));
      }
    }
    parts.push(box(0.5, 0.03, 0.7, 0, 0.32, 0.38, metal)); // bottom rack
    shopperCache[shirtColor] = mergeGeometries(parts);
  }
  const mesh = new THREE.Mesh(shopperCache[shirtColor], material);
  mesh.castShadow = true;
  return mesh;
}

// ---------- Small helpers ----------

function box(w, h, d, x, y, z, color) {
  return colored(new THREE.BoxGeometry(w, h, d), x, y, z, color);
}

function cylinder(radiusTop, radiusBottom, height, x, y, z, color) {
  return colored(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 12), x, y, z, color);
}

// Move a geometry into place and paint every vertex one color. The texture coordinates are
// removed so every part has the same attributes (needed to merge them into one geometry).
function colored(geometry, x, y, z, color) {
  geometry.deleteAttribute("uv");
  geometry.translate(x, y, z);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// Smoothly interpolate a list of [position, value] points (positions in increasing order).
function curveValue(points, u) {
  if (u <= points[0][0]) {
    return points[0][1];
  }
  for (let i = 1; i < points.length; i++) {
    if (points[i][0] >= u) {
      const a = points[i - 1];
      const b = points[i];
      const t = (u - a[0]) / Math.max(0.0001, b[0] - a[0]);
      // Ease between the points so the outline is smooth instead of kinked.
      const eased = t * t * (3 - 2 * t);
      return a[1] + (b[1] - a[1]) * eased;
    }
  }
  return points[points.length - 1][1];
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
