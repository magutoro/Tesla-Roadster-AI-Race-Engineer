// environment.js — Owner: B (friend)
// The sky and the light: a physically based sky with clouds, a sun light that matches it,
// reflections taken from that same sky (so the car's paint reflects the real sky, not a studio),
// and a little haze in the distance.

import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";

const SKY_SETTINGS = {
  turbidity: 2.8, // how hazy the air is
  rayleigh: 1.1, // how blue the sky is
  mieCoefficient: 0.004,
  mieDirectionalG: 0.82,
  cloudCoverage: 0.38,
  cloudDensity: 0.45,
};

export function createEnvironment(scene, renderer) {
  const sunDirection = new THREE.Vector3();
  // Afternoon sun: 38 degrees up, coming from behind the start of most levels.
  sunDirection.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(215));

  const sky = makeSky(sunDirection, true);
  sky.scale.setScalar(4500);
  scene.add(sky);

  // Reflections: draw the sky once into a blurred "environment map" that every shiny
  // material (car paint, glass, metal) reflects. It leaves out the sun's disc: the sun light
  // below already lights everything, and blurred into the map it would light things twice
  // (trees and grass came out pale and washed out).
  const maker = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  skyScene.add(makeSky(sunDirection, false));
  scene.environment = maker.fromScene(skyScene, 0.02).texture;
  scene.environmentIntensity = 0.4;

  // Haze toward the horizon, the color of the sky near the ground.
  scene.fog = new THREE.FogExp2(new THREE.Color("#c7d3df"), 0.0005);

  // Sunlight and the light bouncing back from the sky and the ground.
  const hemisphere = new THREE.HemisphereLight(0xdfeaf7, 0x5a5546, 0.9);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xfff3e2, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  // Keep the sun's shadow box centered on the car (shadows only need to be sharp near it).
  function follow(position) {
    sun.position.copy(position).addScaledVector(sunDirection, 150);
    sun.target.position.copy(position);
  }

  return { sky: sky, sun: sun, sunDirection: sunDirection, follow: follow };
}

function makeSky(sunDirection, showSun) {
  const sky = new Sky();
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = SKY_SETTINGS.turbidity;
  uniforms.rayleigh.value = SKY_SETTINGS.rayleigh;
  uniforms.mieCoefficient.value = SKY_SETTINGS.mieCoefficient;
  uniforms.mieDirectionalG.value = SKY_SETTINGS.mieDirectionalG;
  uniforms.cloudCoverage.value = SKY_SETTINGS.cloudCoverage;
  uniforms.cloudDensity.value = SKY_SETTINGS.cloudDensity;
  uniforms.sunPosition.value.copy(sunDirection);
  uniforms.showSunDisc.value = showSun ? 1 : 0;
  return sky;
}
