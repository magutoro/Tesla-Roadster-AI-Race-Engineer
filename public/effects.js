// effects.js — Owner: B (friend)
// A tiny particle system for the thruster plumes and the fans' air rush.
// Particles are glowing dots that drift and fade out. Dead particles are just black,
// which is invisible with additive blending, so we never have to remove anything.

import * as THREE from "three";

export class Particles {
  constructor(scene, maxCount, color, size) {
    this.maxCount = maxCount;
    this.positions = new Float32Array(maxCount * 3);
    this.colors = new Float32Array(maxCount * 3);
    this.velocities = new Float32Array(maxCount * 3);
    this.life = new Float32Array(maxCount); // seconds left
    this.startLife = new Float32Array(maxCount);
    this.nextSlot = 0; // the oldest particle gets reused first
    this.color = new THREE.Color(color);
    this.drag = 2.5; // particles slow down as they spread

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    const material = new THREE.PointsMaterial({
      size: size,
      map: makeDotTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false; // the particles move every frame
    scene.add(this.points);
  }

  emit(position, velocity, life) {
    const i = this.nextSlot;
    this.nextSlot = (this.nextSlot + 1) % this.maxCount;
    this.positions[i * 3] = position.x;
    this.positions[i * 3 + 1] = position.y;
    this.positions[i * 3 + 2] = position.z;
    this.velocities[i * 3] = velocity.x;
    this.velocities[i * 3 + 1] = velocity.y;
    this.velocities[i * 3 + 2] = velocity.z;
    this.life[i] = life;
    this.startLife[i] = life;
  }

  update(dt) {
    const slowDown = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.maxCount; i++) {
      if (this.life[i] <= 0) {
        continue;
      }
      this.life[i] = this.life[i] - dt;
      let brightness = this.life[i] / this.startLife[i];
      if (brightness < 0) {
        brightness = 0;
      }
      for (let axis = 0; axis < 3; axis++) {
        this.velocities[i * 3 + axis] = this.velocities[i * 3 + axis] * slowDown;
        this.positions[i * 3 + axis] = this.positions[i * 3 + axis] + this.velocities[i * 3 + axis] * dt;
      }
      // Don't sink into the ground: spread out along it instead.
      if (this.positions[i * 3 + 1] < 0.15) {
        this.positions[i * 3 + 1] = 0.15;
        this.velocities[i * 3 + 1] = 0;
      }
      this.colors[i * 3] = this.color.r * brightness;
      this.colors[i * 3 + 1] = this.color.g * brightness;
      this.colors[i * 3 + 2] = this.color.b * brightness;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// A soft round dot, drawn once on a small canvas.
function makeDotTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.5)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
