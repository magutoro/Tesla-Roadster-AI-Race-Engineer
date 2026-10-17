// materials.js — Owner: B (friend)
// Realistic ground surfaces made from photo textures (CC0, from polyhaven.com):
//   asphalt  - race-track asphalt (roads, track, parking lot)
//   grass    - leafy grass (fields, verges)
//   concrete - worn concrete (the test pad)
//   gravel   - small stones (gravel traps on the outside of race-track corners)
// Each material is made once and shared. Geometry gets its texture coordinates in meters
// (see uvInMeters), so a texture tile is always the same real size, however big the surface.

import * as THREE from "three";

// How many meters one copy of each texture covers.
export const TILE_METERS = { asphalt: 6, grass: 5, concrete: 8, gravel: 4 };

const FOLDERS = { asphalt: "asphalt_track", grass: "leafy_grass", concrete: "concrete_floor_02", gravel: "gravel_floor_02" };
// The color each texture is multiplied by. The grass photo has a lot of dry leaves in it,
// so it gets a strong green tint to look like mown grass.
const TINTS = { asphalt: 0xb4b4b4, grass: 0x8fd88a, concrete: 0xd6d6d6, gravel: 0xb9aa90 };
const loader = new THREE.TextureLoader();
const materials = {};

export function surfaceMaterial(name) {
  if (!materials[name]) {
    const folder = "/textures/" + FOLDERS[name] + "/";
    materials[name] = new THREE.MeshStandardMaterial({
      map: loadTexture(folder + "color.jpg", true),
      normalMap: loadTexture(folder + "normal.jpg", false),
      roughnessMap: loadTexture(folder + "rough.jpg", false),
      color: TINTS[name],
      roughness: 1.0,
      metalness: 0.0,
    });
  }
  return materials[name];
}

// Scale a geometry's texture coordinates so one texture tile = TILE_METERS of the surface.
// width and depth are the surface size in meters (for a plane: its width and height).
export function uvInMeters(geometry, width, depth, name) {
  const tile = TILE_METERS[name];
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * width) / tile, (uv.getY(i) * depth) / tile);
  }
  uv.needsUpdate = true;
  return geometry;
}

// A flat textured rectangle lying on the ground. heading in degrees.
export function makeGroundPatch(name, x, z, width, depth, headingDeg, y) {
  const geometry = uvInMeters(new THREE.PlaneGeometry(width, depth), width, depth, name);
  const mesh = new THREE.Mesh(geometry, surfaceMaterial(name));
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = THREE.MathUtils.degToRad(headingDeg || 0);
  mesh.position.set(x, y || 0.01, z);
  mesh.receiveShadow = true;
  return mesh;
}

function loadTexture(path, isColor) {
  const texture = loader.load(path);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8; // stays sharp when seen at a low angle, like a road ahead
  if (isColor) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  return texture;
}
