// level-utils.js — Owner: B (friend)
// Small helpers shared by levels.js and scenery.js.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export function addMesh(built, mesh) {
  built.scene.add(mesh);
  built.meshes.push(mesh);
}

// heading in degrees: 0 faces +Z, 90 faces +X.
export function headingToQuaternion(headingDeg) {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(headingDeg));
}

// A solid box that never moves (physics only). heading in degrees.
export function addFixedBoxCollider(built, x, y, z, w, h, d, headingDeg) {
  const desc = built.RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
    .setTranslation(x, y, z)
    .setRotation(headingToQuaternion(headingDeg || 0));
  const collider = built.world.createCollider(desc);
  built.fixedColliders.push(collider);
  return collider;
}

// Collects lots of flat painted rectangles (lane lines, parking lines...) into ONE mesh,
// so hundreds of lines cost the same to draw as one.
export class FlatPaint {
  constructor() {
    this.positions = [];
    this.colors = [];
  }

  // A rectangle centered at (x, z), width along its sideways direction, depth along its heading.
  add(x, z, width, depth, headingDeg, color, y) {
    const angle = THREE.MathUtils.degToRad(headingDeg || 0);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const corners = [
      [-width / 2, -depth / 2],
      [width / 2, -depth / 2],
      [width / 2, depth / 2],
      [-width / 2, depth / 2],
    ];
    const points = [];
    for (const corner of corners) {
      // Same rotation as headingToQuaternion: local +Z turns toward the heading.
      points.push(new THREE.Vector3(x + corner[0] * cos + corner[1] * sin, y || 0.02, z - corner[0] * sin + corner[1] * cos));
    }
    this.addQuad(points[0], points[1], points[2], points[3], color);
  }

  // Any four corners, in order around the shape (either direction).
  addQuad(a, b, c, d, color) {
    const tint = new THREE.Color(color);
    // The triangles must face up, or the lighting treats the paint as its dark underside.
    const edge1 = new THREE.Vector3().subVectors(b, a);
    const edge2 = new THREE.Vector3().subVectors(c, a);
    let order = [a, b, c, a, c, d];
    if (edge1.cross(edge2).y < 0) {
      order = [a, c, b, a, d, c];
    }
    for (const p of order) {
      this.positions.push(p.x, p.y, p.z);
      this.colors.push(tint.r, tint.g, tint.b);
    }
  }

  build(roughness) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    // Flat paint always faces up.
    const normals = [];
    for (let i = 0; i < this.positions.length / 3; i++) {
      normals.push(0, 1, 0);
    }
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: roughness || 0.85,
      side: THREE.DoubleSide,
      polygonOffset: true, // draw on top of the ground without flickering
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  }
}

// Collects lots of colored boxes (walls, posts, lamps...) into ONE mesh.
export class BoxBatch {
  constructor() {
    this.parts = [];
  }

  add(x, y, z, w, h, d, headingDeg, color) {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.applyQuaternion(headingToQuaternion(headingDeg || 0));
    geometry.translate(x, y, z);
    this.parts.push(paint(geometry, color));
  }

  addCylinder(x, y, z, radius, height, color) {
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 12);
    geometry.translate(x, y, z);
    this.parts.push(paint(geometry, color));
  }

  build() {
    if (this.parts.length === 0) {
      return null;
    }
    const geometry = mergeGeometries(this.parts);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

function paint(geometry, color) {
  const tint = new THREE.Color(color);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// A sign with text on it (drawn on a canvas). Returns a flat mesh whose text faces +Z; rotate as needed.
export function makeTextSign(lines, width, height, background, textColor) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = Math.round((512 * height) / width);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = textColor;
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lineHeight = canvas.height / (lines.length + 0.5);
  for (let i = 0; i < lines.length; i++) {
    ctx.font = "bold " + Math.round(lineHeight * 0.62) + "px -apple-system, 'Hiragino Sans', sans-serif";
    ctx.fillText(lines[i], canvas.width / 2, lineHeight * (i + 0.75));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture }));
  return mesh;
}
