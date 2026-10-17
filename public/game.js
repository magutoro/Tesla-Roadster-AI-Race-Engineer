// game.js — Owner: B (friend)
// The laptop screen: 3D scene, camera, game loop, HUD, level menu, and keyboard controls.
// Phone input arrives over WebSocket. The keyboard always works too.

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { CONFIG } from "./config.js";
import { Car } from "./car.js";
import { fetchLevelList, fetchLevel, buildLevel, stepLevel, updateLevel, resetLevel, removeLevel, isGrass, isGravel } from "./levels.js";
import { MSG, DRIVE_MODES, makeInput, cleanInput, makeState, parseMessage, socketUrl } from "./shared/protocol.js";
import { createEnvironment } from "./environment.js";
import { TelemetryPanel } from "./telemetry.js";
import { SoundEngine } from "./sound.js";
import { Tour } from "./tour.js";


// ---------- Renderer, scene, lights ----------

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.camera.baseFov, window.innerWidth / window.innerHeight, 0.1, 6000);
// Sky with clouds, a matching sun, sky reflections and haze (environment.js).
renderer.toneMappingExposure = 0.62;
const environment = createEnvironment(scene, renderer);


window.addEventListener("resize", function () {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Physics and the car ----------

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -CONFIG.physics.gravity, z: 0 });
world.timestep = CONFIG.physics.timestep;
const car = new Car(RAPIER, world, scene);
car.surfaceGrip = function (collider) {
  if (level && isGrass(level, collider)) {
    return CONFIG.surfaces.grassGrip;
  }
  if (level && isGravel(level, collider)) {
    return CONFIG.surfaces.gravelGrip;
  }
  return 1;
};
car.surfaceDrag = function (collider) {
  if (level && isGravel(level, collider)) {
    return CONFIG.surfaces.gravelDrag;
  }
  return 0;
};

// ---------- HUD elements ----------

const hud = {
  speed: document.getElementById("speed"),
  fans: document.getElementById("fans"),
  tankBar: document.getElementById("tankBar"),
  tankFill: document.getElementById("tankFill"),
  tankLiters: document.getElementById("tankLiters"),
  altitude: document.getElementById("altitude"),
  source: document.getElementById("source"),
  levelSelect: document.getElementById("levelSelect"),
  cameraSelect: document.getElementById("cameraSelect"),
  goalText: document.getElementById("goalText"),
  timer: document.getElementById("timer"),
  help: document.getElementById("help"),
  phoneCard: document.getElementById("phoneCard"),
  qr: document.getElementById("qr"),
  phoneUrl: document.getElementById("phoneUrl"),
  phoneStatus: document.getElementById("phoneStatus"),
  message: document.getElementById("message"),
  loading: document.getElementById("loading"),
};
const telemetry = new TelemetryPanel(document.getElementById("telemetry"));
const sound = new SoundEngine();
const tourBar = document.getElementById("tourBar");
const tour = new Tour({
  loadLevel: async function (file) {
    for (let i = 0; i < levelList.length; i++) {
      if (levelList[i].file === file) {
        await loadLevel(i);
      }
    }
  },
  setTelemetry: function (visible) {
    telemetry.setVisible(visible);
  },
  showCaption: function (title, text, footer) {
    document.getElementById("tourTitle").textContent = title;
    document.getElementById("tourText").textContent = text;
    document.getElementById("tourFooter").textContent = footer;
    tourBar.classList.add("show");
    document.body.classList.add("touring");
  },
  hideCaption: function () {
    tourBar.classList.remove("show");
    document.body.classList.remove("touring");
  },
});

// ---------- Title screen ----------

function showTitle() {
  document.getElementById("title").classList.remove("hidden");
  document.body.classList.add("atTitle");
  selectCamera("showroom", false);
}

function hideTitle() {
  document.getElementById("title").classList.add("hidden");
  document.body.classList.remove("atTitle");
  selectCamera(drivingCameraMode, false);
}

document.getElementById("tourButton").addEventListener("click", function (event) {
  event.currentTarget.blur();
  sound.start();
  hideTitle();
  tour.start();
});
document.getElementById("freeButton").addEventListener("click", function (event) {
  event.currentTarget.blur();
  sound.start();
  hideTitle();
});
const modeButtons = document.querySelectorAll("#modes button");
for (const button of modeButtons) {
  button.addEventListener("click", function () {
    setMode(button.dataset.mode);
    button.blur(); // so Space doesn't "click" it again
  });
}

let messageTimer = null;
function showMessage(text, seconds) {
  hud.message.textContent = text;
  hud.message.classList.add("show");
  clearTimeout(messageTimer);
  messageTimer = setTimeout(function () {
    hud.message.classList.remove("show");
  }, seconds * 1000);
}

// ---------- Keyboard ----------

const keys = {}; // which keys are held down right now

// Called once everything has loaded.
function listenToKeyboard() {
  window.addEventListener("keydown", function (event) {
    if (event.target.tagName === "INPUT" || event.target.tagName === "SELECT") {
      return;
    }
    sound.start(); // browsers only allow sound after a key press or click
    if (!event.repeat) {
      handleKeyPress(event.code);
    }
    keys[event.code] = true;
    if (event.code === "Space" || event.code.startsWith("Arrow")) {
      event.preventDefault(); // don't scroll the page
    }
  });
  window.addEventListener("keyup", function (event) {
    keys[event.code] = false;
  });
  window.addEventListener("blur", function () {
    // Switching windows can swallow keyup events, so let go of everything.
    for (const code of Object.keys(keys)) {
      keys[code] = false;
    }
  });
}

function handleKeyPress(code) {
  if (code === "KeyF") {
    car.fansOn = !car.fansOn;
  } else if (code === "KeyR") {
    restartScenario();
  } else if (code === "KeyC") {
    if (document.body.classList.contains("atTitle")) return;
    selectCamera(CAMERA_MODES[(cameraModeIndex + 1) % CAMERA_MODES.length]);
  } else if (code === "Digit1") {
    setMode("performance");
  } else if (code === "Digit2") {
    setMode("thrust");
  } else if (code === "Digit3") {
    setMode("rocket");
  } else if (code === "KeyL") {
    loadLevel((currentLevelIndex + 1) % levelList.length);
  } else if (code === "Escape") {
    tour.stop();
    showTitle();
  } else if (code === "KeyN") {
    tour.next();
  } else if (code === "KeyG") {
    if (level && level.racingLine) {
      level.racingLine.toggle();
      showMessage(level.racingLine.visible ? "Racing line on" : "Racing line off", 1.2);
    }
  } else if (code === "KeyM") {
    const muted = sound.toggleMute();
    showMessage(muted ? "Sound off" : "Sound on", 1);
  } else if (code === "KeyP") {
    document.body.classList.toggle("presenting");
    showMessage(document.body.classList.contains("presenting") ? "Presentation mode" : "Presentation mode off", 1.2);
  } else if (code === "KeyT") {
    telemetry.toggle();
    if (telemetry.visible) {
      hud.help.classList.add("hidden");
    }
  } else if (code === "KeyH") {
    hud.help.classList.toggle("hidden");
  }
}

function readKeyboard() {
  const input = makeInput();
  if (keys.KeyA || keys.ArrowLeft) {
    input.steer = input.steer - 1;
  }
  if (keys.KeyD || keys.ArrowRight) {
    input.steer = input.steer + 1;
  }
  if (keys.KeyW) {
    input.gas = 1;
  }
  if (keys.KeyS) {
    input.brake = 1;
  }
  if (keys.Space) {
    input.thrust = true;
  }
  if (keys.ShiftLeft || keys.ShiftRight) {
    input.lift = true;
  }
  if (keys.KeyQ) {
    input.roll = -1;
  }
  if (keys.KeyE) {
    input.roll = 1;
  }
  // Arrow up = "push the stick forward" (lean forward), like the phone tilted forward.
  if (keys.ArrowUp) {
    input.pitch = input.pitch - 1;
  }
  if (keys.ArrowDown) {
    input.pitch = input.pitch + 1;
  }
  return input;
}

// ---------- Phone (over WebSocket) ----------

const phone = {
  input: makeInput(),
  lastMessageTime: -100000,
  lastFans: false,
  lastReset: false,
  wasActive: false,
  count: 0,
};
let socket = null;

function connectSocket() {
  socket = new WebSocket(socketUrl());
  socket.addEventListener("open", function () {
    socket.send(JSON.stringify({ type: MSG.HELLO, role: "game" }));
  });
  socket.addEventListener("message", function (event) {
    const msg = parseMessage(event.data);
    if (msg) {
      handleSocketMessage(msg);
    }
  });
  socket.addEventListener("close", function () {
    // The server restarted or the network blipped. Try again shortly.
    setTimeout(connectSocket, 1500);
  });
}

function handleSocketMessage(msg) {
  if (msg.type === MSG.INPUT) {
    const input = cleanInput(msg);
    // FANS on the phone is a toggle, so only react when it changes.
    if (input.fans !== phone.lastFans) {
      car.fansOn = input.fans;
      phone.lastFans = input.fans;
    }
    if (input.reset && !phone.lastReset) {
      restartScenario();
    }
    phone.lastReset = input.reset;
    phone.input = input;
    phone.lastMessageTime = performance.now();
  } else if (msg.type === MSG.MODE) {
    if (DRIVE_MODES.includes(msg.mode)) {
      setMode(msg.mode);
    }
  } else if (msg.type === MSG.STATUS) {
    phone.count = msg.phones;
    updatePhoneStatus();

  }
}

function phoneIsActive() {
  return performance.now() - phone.lastMessageTime < CONFIG.phone.timeoutMs;
}

// Phone input when a phone is connected, with the keyboard still working on top.
function readControls() {
  const keyboard = readKeyboard();
  const active = phoneIsActive();
  if (phone.wasActive && !active) {
    // The phone stopped sending (locked screen, Wi-Fi drop...). Inputs go to zero, so the car coasts to a stop.
    showMessage("Phone disconnected", 2);
  }
  phone.wasActive = active;
  if (!active) {
    hud.source.textContent = "Controls: keyboard";
    return keyboard;
  }
  hud.source.textContent = "Controls: phone (steer " + Math.round(phone.input.steer * 100) + "%)";
  const input = makeInput();
  input.steer = phone.input.steer;
  if (keyboard.steer !== 0) {
    input.steer = keyboard.steer;
  }
  input.gas = Math.max(phone.input.gas, keyboard.gas);
  input.brake = Math.max(phone.input.brake, keyboard.brake);
  input.thrust = phone.input.thrust || keyboard.thrust;
  input.lift = phone.input.lift || keyboard.lift;
  input.roll = phone.input.roll;
  if (keyboard.roll !== 0) {
    input.roll = keyboard.roll;
  }
  input.pitch = phone.input.pitch;
  if (keyboard.pitch !== 0) {
    input.pitch = keyboard.pitch;
  }
  return input;
}

// Send the car state to the phone controller.
let lastStateSent = 0;
let pendingEvents = [];
function sendStateIfDue(now) {
  if (now - lastStateSent < 1000 / CONFIG.network.stateRateHz) {
    return;
  }
  lastStateSent = now;
  const state = makeState();
  state.speedKmh = Math.round(car.speedKmh);
  state.steer = Math.round(lastInput.steer * 100) / 100;
  state.fansOn = car.fansOn;
  state.tankPercent = Math.round(car.tank);
  state.mode = car.mode;
  state.airborne = car.airborne;
  state.altitude = Math.round(car.altitude * 10) / 10;
  state.events = pendingEvents;
  state.goalText = hud.goalText.textContent;
  // The phone uses orientation and roll state for its tilt-flip gesture.
  state.stunt={upY:car.getUp().y,rolling:car.rolling};
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(state));
  }
  pendingEvents = [];
}

function updatePhoneStatus() {
  const titleStatus = document.getElementById("titlePhoneStatus");
  if (phone.count > 0) {
    hud.phoneStatus.textContent = "Phone connected";
    hud.phoneStatus.classList.add("ok");
    hud.phoneCard.classList.add("connected");
    titleStatus.textContent = "Phone connected";
    titleStatus.classList.add("ok");
  } else {
    hud.phoneStatus.textContent = "Waiting for phone...";
    hud.phoneStatus.classList.remove("ok");
    hud.phoneCard.classList.remove("connected");
    titleStatus.textContent = "Waiting for phone...";
    titleStatus.classList.remove("ok");
  }
}

// The QR code shows the tunnel's HTTPS address once the server knows it.
let shownPhoneUrl = "";
async function refreshPhoneInfo() {
  try {
    const response = await fetch("/api/info");
    const info = await response.json();
    if (info.phoneUrl !== shownPhoneUrl) {
      shownPhoneUrl = info.phoneUrl;
      hud.qr.src = "/api/qr.svg?t=" + Date.now();
      document.getElementById("titleQr").src = hud.qr.src;
      hud.phoneUrl.textContent = info.phoneUrl;
      document.getElementById("titlePhoneUrl").textContent = info.phoneUrl;
      if (!info.tunnel) {
        hud.phoneUrl.textContent = info.phoneUrl + " (iPhone needs HTTPS: run npm run phone)";
      } else if (info.tunnelTool === "ngrok") {
        hud.phoneUrl.textContent = info.phoneUrl + " (on the ngrok warning page, tap Visit Site)";
      }
    }
    if (!info.tunnel) {
      setTimeout(refreshPhoneInfo, 4000); // keep checking until the tunnel is up
    }
  } catch (err) {
    setTimeout(refreshPhoneInfo, 4000);
  }
}

// ---------- Modes and levels ----------

function setMode(mode) {
  car.setMode(mode);
  for (const button of modeButtons) {
    button.classList.toggle("active", button.dataset.mode === mode);
  }
  const names = {
    performance: "Performance: fans only",
    thrust: "Thrust: fans + 4 rear thrusters (200 L air)",
    rocket: "Rocket: all 10 thrusters (600 L air). LIFT to fly, ROLL to barrel roll",
  };
  showMessage(names[mode], 1.6);
}

let levelList = [];
let currentLevelIndex = 0;
let level = null;

async function loadLevel(index) {
  currentLevelIndex = index;
  const entry = levelList[index];
  const data = await fetchLevel(entry.file);
  if (level) {
    removeLevel(level);
  }
  level = buildLevel(data, scene, world, RAPIER);
  car.reset(level.spawn);
  snapCamera = true;
  hud.timer.textContent = "";
  hud.levelSelect.value = String(index);
  if (data.goal && data.goal.text) {
    hud.goalText.textContent = data.goal.text;
  } else {
    hud.goalText.textContent = data.description || "";
  }
  showMessage(data.name, 1.8);
}

// Put the car back at the start, and restart the level's traffic, rival and timers.
function restartScenario() {
  car.reset();
  if (level) {
    resetLevel(level);
  }
  snapCamera = true;
}

hud.levelSelect.addEventListener("change", function () {
  loadLevel(Number(hud.levelSelect.value));
  hud.levelSelect.blur(); // give the keyboard back to the game
});

// ---------- Camera ----------

const CAMERA_MODES = ["chase", "cockpit", "overhead", "showroom"];
let drivingCameraMode = CONFIG.camera.defaultView;
try {
  const saved = window.localStorage.getItem("roadster-camera-view");
  if (CAMERA_MODES.includes(saved)) drivingCameraMode = saved;
} catch {}
let cameraModeIndex = CAMERA_MODES.indexOf(drivingCameraMode);
hud.cameraSelect.value = drivingCameraMode;
let snapCamera = true; // jump straight to the right spot (after a reset or level load)
const cameraOffset = new THREE.Vector3(); // camera spot, relative to the car
const lookAheadOffset = new THREE.Vector3(); // where it looks, relative to the car
const flatForward = new THREE.Vector3(0, 0, 1);
const TURN_AROUND = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const COCKPIT_TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.08); // look slightly down
let showroomAngle = 0.8;

function selectCamera(mode, remember = true) {
  if (!CAMERA_MODES.includes(mode)) return;
  cameraModeIndex = CAMERA_MODES.indexOf(mode);
  hud.cameraSelect.value = mode;
  snapCamera = true;
  if (remember) {
    drivingCameraMode = mode;
    try { window.localStorage.setItem("roadster-camera-view", mode); } catch {}
    showMessage("Camera: " + mode, 1.2);
  }
}

hud.cameraSelect.addEventListener("change", function () {
  selectCamera(hud.cameraSelect.value);
  hud.cameraSelect.blur(); // return steering and camera shortcuts to the game
});

function updateCamera(dt) {
  const carPosition = car.model.root.position;
  const carRotation = car.model.root.quaternion;

  // The direction the car points, flattened onto the ground. If the car points straight up
  // (mid-flip), keep the last good direction so the camera doesn't spin.
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(carRotation);
  forward.y = 0;
  if (forward.lengthSq() > 0.05) {
    flatForward.copy(forward.normalize());
  }

  const mode = CAMERA_MODES[cameraModeIndex];
  const settings = CONFIG.camera;
  car.model.setCockpitView(mode === "cockpit");
  if (mode === "cockpit") {
    // The driver's seat: you see the yoke, the screens, the hood and the fenders.
    // The head leans a little with the g-forces, like a real driver's.
    const eye = car.model.cockpitEye.clone();
    eye.x = eye.x - car.telemetry.gLat * 0.025;
    eye.z = eye.z - car.telemetry.gLong * 0.02;
    camera.position.copy(eye.applyQuaternion(carRotation).add(carPosition));
    camera.quaternion.copy(carRotation).multiply(TURN_AROUND).multiply(COCKPIT_TILT); // cameras look down -Z, the car faces +Z
    snapCamera = true;
  } else if (mode === "showroom") {
    // Slowly circle the car, like a car show.
    showroomAngle = showroomAngle + dt * 0.25;
    const around = new THREE.Vector3(Math.sin(showroomAngle) * 6.2, 1.5, Math.cos(showroomAngle) * 6.2);
    camera.position.copy(carPosition).add(around);
    camera.lookAt(carPosition.x, carPosition.y - 0.1, carPosition.z);
    snapCamera = true;
  } else {
    let distance = settings.chaseDistance;
    let height = settings.chaseHeight;
    if (mode === "overhead") {
      distance = settings.overheadDistance;
      height = settings.overheadHeight;
    }
    // We smooth the camera's direction around the car, not its position in the world.
    // That way the camera swings smoothly in turns but never falls behind at high speed.
    const wantedOffset = flatForward.clone().multiplyScalar(-distance);
    wantedOffset.y = height;
    const wantedLookAhead = flatForward.clone().multiplyScalar(settings.chaseLookAhead);

    if (snapCamera) {
      cameraOffset.copy(wantedOffset);
      lookAheadOffset.copy(wantedLookAhead);
      snapCamera = false;
    } else {
      const blend = 1 - Math.exp(-settings.chaseSmoothing * dt);
      cameraOffset.lerp(wantedOffset, blend);
      lookAheadOffset.lerp(wantedLookAhead, blend);
    }
    const eye = carPosition.clone().add(cameraOffset);
    // Never let the camera dip under the ground.
    eye.y = Math.max(eye.y, 0.5);
    const lookTarget = carPosition.clone().add(lookAheadOffset);
    lookTarget.y = lookTarget.y + 0.8;

    camera.position.copy(eye);
    if (car.thrusting || car.lifting) {
      const shake = settings.shakeOnThrust;
      camera.position.x = camera.position.x + (Math.random() - 0.5) * shake;
      camera.position.y = camera.position.y + (Math.random() - 0.5) * shake;
    }
    camera.lookAt(lookTarget);
  }

  // Widen the view at speed so it feels fast.
  const speedFactor = Math.min(1, car.speedKmh / settings.fastFovKmh);
  let fov = settings.baseFov + (settings.fastFov - settings.baseFov) * speedFactor;
  if (mode === "cockpit") {
    fov = fov + 10;
  }
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  // Keep the sun's shadow box around the car, and the sky around the camera.
  environment.follow(carPosition);
  environment.sky.position.copy(camera.position);
}

// ---------- HUD ----------

function updateHud() {
  hud.speed.firstChild.textContent = String(Math.round(car.speedKmh));
  if (car.fansOn) {
    hud.fans.textContent = "ON";
    hud.fans.classList.add("on");
  } else {
    hud.fans.textContent = "OFF";
    hud.fans.classList.remove("on");
  }
  hud.tankFill.style.width = car.tank.toFixed(1) + "%";
  hud.tankBar.classList.toggle("empty", car.tankEmptyPressed);
  hud.tankBar.classList.toggle("off", car.mode === "performance");
  hud.tankLiters.textContent = Math.round(car.tankLiters) + " L";
  hud.altitude.textContent = car.altitude.toFixed(1) + " m";
}

// Turn car events into on-screen messages, and save them for the phone.
function handleCarEvents() {
  const events = car.takeEvents();
  for (const name of events) {
    pendingEvents.push(name);
    if (name === "tank_empty") {
      showMessage("Air tank empty. Let it refill.", 1.8);
    } else if (name === "flip") {
      showMessage("Flipped! Press R (or RESET on the phone)", 3);
    } else if (name === "barrel_roll") {
      showMessage("Barrel roll!", 1.5);
      sound.play("barrel_roll");
    } else if (name === "landing") {
      sound.play("landing");
    } else if (name === "big_jump") {
      showMessage("Big air!", 1.5);
    } else if (name === "crash") {
      snapShake = 0.25;
      sound.play("crash");
    }
  }
}
let snapShake = 0;

// ---------- Game loop ----------

let lastInput = makeInput();
let lastFrameTime = performance.now();
let elapsed = 0;
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  if (dt > 0.1) {
    dt = 0.1; // the tab was in the background; don't simulate a huge jump
  }
  if (dt < 0) {
    dt = 0;
  }
  elapsed = elapsed + dt;

  const input = readControls();
  lastInput = input;

  // Physics at a fixed rate, no matter the screen's refresh rate.
  const step = CONFIG.physics.timestep;
  accumulator = accumulator + dt;
  let steps = 0;
  while (accumulator >= step && steps < CONFIG.physics.maxStepsPerFrame) {
    car.step(input, step);
    if (level) {
      stepLevel(level, step, car);
    }
    world.step();
    car.afterStep(step);
    accumulator = accumulator - step;
    steps = steps + 1;
  }
  if (steps === CONFIG.physics.maxStepsPerFrame) {
    accumulator = 0;
  }
  car.updateVisuals(accumulator / step, dt, elapsed);

  if (level) {
    const forward = car.getForward();
    const status = updateLevel(level, {
      position: car.getPosition(),
      airborne: car.airborne,
      speedKmh: car.speedKmh,
      heading: Math.atan2(forward.x, forward.z),
      rolling: car.rolling,
    }, dt);
    if (status.reached) {
      showMessage(status.message, 3);
      pendingEvents.push("goal_reached");
      sound.play("goal");
    }
    if (status.failed) {
      showMessage(status.message, 4);
      pendingEvents.push("goal_failed");
      sound.play("fail");
    }
    hud.timer.textContent = status.line;
    tour.update(dt, { car: car, level: level, status: status });
    if (level.racingLine) {
      level.racingLine.update(car);
    }
  }

  // Fell off the edge of the world.
  if (car.getPosition().y < -30) {
    restartScenario();
  }

  handleCarEvents();
  updateCamera(dt);
  if (snapShake > 0) {
    camera.position.y = camera.position.y + (Math.random() - 0.5) * snapShake;
    snapShake = Math.max(0, snapShake - dt);
  }
  updateHud();
  telemetry.update(car.telemetry, dt);
  sound.update(car);
  sendStateIfDue(now);
  renderer.render(scene, camera);
}

// ---------- Start ----------

levelList = await fetchLevelList();
for (let i = 0; i < levelList.length; i++) {
  const option = document.createElement("option");
  option.value = String(i);
  option.textContent = levelList[i].name;
  hud.levelSelect.appendChild(option);
}
// ?level=tesla-event in the address bar picks a level directly.
const wantedLevel = new URLSearchParams(location.search).get("level");
let startIndex = 0;
for (let i = 0; i < levelList.length; i++) {
  if (levelList[i].file === wantedLevel) {
    startIndex = i;
  }
}
await loadLevel(startIndex);
setMode("rocket");
listenToKeyboard();
showTitle();
connectSocket();
refreshPhoneInfo();
hud.loading.style.display = "none";
requestAnimationFrame(frame);

// Handy for poking at things from the browser console, e.g. game.car.tank = 100
// game.frame(time) runs one frame by hand, for testing when the tab is in the background.
window.game = { car: car, world: world, camera: camera, scene: scene, CONFIG: CONFIG, frame: frame, keys: keys, getLevel: function () { return level; } };
