// phone.js — Phone/server integration
// The phone yoke. Hold the phone sideways and tilt it left/right to steer. It works whether you
// hold it upright like a wheel or flat like a game controller. Tipping it forward/back leans
// the LIFT thrusters (Rocket mode). If tilt doesn't work, drag the yoke on screen instead.
// Sends the controls to the server about 30 times per second; the server passes them to the game.

import { PhoneRollGesture } from "./shared/phone-roll.js";
import { CONFIG } from "./config.js";
import { MSG, DRIVE_MODES, makeInput, parseMessage, socketUrl } from "./shared/protocol.js";

const input = makeInput(); // what we send
const game = { mode: "rocket", fansOn: false, tank: 100, airborne:false, upY:1, rolling:false, receivedAt:-Infinity }; // what the game last told us
const rollGesture=new PhoneRollGesture(CONFIG.phone);
let steeringDegrees=0;
let buttonRoll=0;
let lastFansTap = 0;
let layoutFlipped = false;
let controllerFrameAngle = getScreenAngle() + getLayoutAngle();

const ui = {
  startScreen: document.getElementById("startScreen"),
  startButton: document.getElementById("startButton"),
  startError: document.getElementById("startError"),
  dot: document.getElementById("dot"),
  statusText: document.getElementById("statusText"),
  yokeArea: document.getElementById("yokeArea"),
  wheel: document.getElementById("wheel"),
  readout: document.getElementById("readout"),
  tilt: document.getElementById("tilt"),
  tiltHelp: document.getElementById("tiltHelp"),
  controller: document.getElementById("controller"),
  flipView: document.getElementById("flipView"),
  rollHint: document.getElementById("rollHint"),
  speed: document.getElementById("speed"),
  tankFill: document.getElementById("tankFill"),
  fans: document.getElementById("fans"),
  lift: document.getElementById("lift"),
  roll: document.getElementById("roll"),
  thrust: document.getElementById("thrust"),
  mode: document.getElementById("mode"),
  flash: document.getElementById("flash"),
};

// ---------- Start: ask for motion permission (iPhone needs a tap for this) ----------

ui.startButton.addEventListener("click", async function () {
  ui.startError.textContent = "";
  if (!window.isSecureContext) {
    ui.startError.textContent =
      "Tilt steering needs HTTPS. Open the https:// link from the game screen instead. (You can still drag the yoke.)";
  }
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      const answer = await DeviceOrientationEvent.requestPermission();
      if (answer !== "granted") {
        ui.startError.textContent =
          "Motion access was denied. Close this tab, open the link again, and tap Allow. (Answer: " + answer + ")";
        return;
      }
    } catch (err) {
      ui.startError.textContent = "Couldn't turn on tilt steering: " + err.message;
      return;
    }
  }
  window.addEventListener("deviceorientation", onOrientation);

  // Android can go full screen. iPhone can't, which is fine.
  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(function () {});
  }
  keepScreenOn();
  ui.startScreen.style.display = "none";
  connectSocket();
  setInterval(sendInput, 1000 / CONFIG.phone.sendRateHz);
  setInterval(checkTiltIsWorking, 1000);
  // Use however the player is holding the phone right now as "straight ahead".
  setTimeout(calibrate, 400);
});

// ---------- Tilt steering ----------

const tilt = {
  lastOrientation: null,
  rawSteerDeg: 0,
  rawForwardDeg: 0,
  centerSteerDeg: 0,
  centerForwardDeg: 0,
  smoothSteer: 0,
  eventsThisSecond: 0,
  working: false,
};

function onOrientation(event) {
  if (event.beta === null || event.gamma === null) {
    return; // no tilt sensor (e.g. a laptop)
  }
  tilt.eventsThisSecond = tilt.eventsThisSecond + 1;
  tilt.lastOrientation = { beta: event.beta, gamma: event.gamma };
  tilt.receivedAt=performance.now();

  // Work out which way is "up" (away from gravity), measured in the phone's own axes.
  const beta = degToRad(event.beta);
  const gamma = degToRad(event.gamma);
  const upX = -Math.cos(beta) * Math.sin(gamma);
  const upY = Math.sin(beta);
  const upZ = Math.cos(beta) * Math.cos(gamma);

  // The page is sideways, so turn that into the screen's own right/up directions.
  // CSS supplies the sideways view when the OS display is locked in portrait.
  // Include that rotation so steering uses the controller's visible right edge.
  const screenAngle = degToRad(getScreenAngle() + getLayoutAngle());
  const screenRight = upX * Math.cos(screenAngle) - upY * Math.sin(screenAngle);

  // Steering = how far the phone's long edge is tilted from level. Right end down = steer right.
  // This works the same whether the phone is held upright, flat, or anywhere in between.
  tilt.rawSteerDeg = radToDeg(Math.asin(clamp(-screenRight, -1, 1)));
  // How far the screen faces up. Tipping the top edge away from you (forward) makes it bigger.
  tilt.rawForwardDeg = radToDeg(Math.asin(clamp(upZ, -1, 1)));
  updateSteering();
}

function updateSteering() {
  const settings = CONFIG.phone;
  let steerDeg = tilt.rawSteerDeg - tilt.centerSteerDeg;
  if (settings.invertSteer) {
    steerDeg = -steerDeg;
  }

  steeringDegrees=steerDeg;
  // Ignore tiny wobbles near the center, then scale so steerMaxDeg = full lock.
  let target = 0;
  if (Math.abs(steerDeg) > settings.steerDeadZoneDeg) {
    const amount = (Math.abs(steerDeg) - settings.steerDeadZoneDeg) / (settings.steerMaxDeg - settings.steerDeadZoneDeg);
    target = Math.min(1, amount) * Math.sign(steerDeg);
  }
  // Smooth out shaky hands.
  tilt.smoothSteer = tilt.smoothSteer + (target - tilt.smoothSteer) * settings.steerSmoothing;

  // Tipped forward = positive here, but pitch -1 means "forward" in the protocol (like pushing a stick).
  const forwardDeg = tilt.rawForwardDeg - tilt.centerForwardDeg;
  input.pitch = clamp(-forwardDeg / settings.pitchMaxDeg, -1, 1);

  if (!drag.active) {
    input.steer = tilt.smoothSteer;
    showSteering(steerDeg);
  }
}

function showSteering(degrees) {
  ui.wheel.style.transform = "rotate(" + clamp(degrees, -90, 90).toFixed(1) + "deg)";
  ui.readout.lastChild.textContent = " · steer " + Math.round(input.steer * 100) + "%";
}

function calibrate() {
  rollGesture.reset();
  tilt.centerSteerDeg = tilt.rawSteerDeg;
  tilt.centerForwardDeg = tilt.rawForwardDeg;
  tilt.smoothSteer = 0;
  updateSteering();
}

// Once a second: are tilt readings actually arriving? Show it, so problems are easy to spot.
function checkTiltIsWorking() {
  tilt.working = tilt.eventsThisSecond > 5;
  if (tilt.working) {
    ui.tilt.textContent = "tilt OK (" + tilt.eventsThisSecond + "/s)";
    ui.tilt.classList.add("ok");
    ui.tiltHelp.style.display = "none";
  } else {
    ui.tilt.textContent = "tilt: no data";
    ui.tilt.classList.remove("ok");
    ui.tiltHelp.style.display = "block";
    if (!window.isSecureContext) {
      ui.tilt.textContent = "tilt: HTTPS required";
      ui.tiltHelp.textContent = "Tilt is blocked on this HTTP connection. Open the HTTPS phone link from the game's QR code. Drag the yoke to steer meanwhile.";
    } else {
      ui.tiltHelp.textContent = "No motion readings yet. Reload, tap Start, then Allow motion access. Drag the yoke to steer meanwhile.";
    }
  }
  tilt.eventsThisSecond = 0;
}

// iPhones still support window.orientation (90 = turned left, -90 = turned right).
function getScreenAngle() {
  if (typeof window.orientation === "number") {
    return window.orientation;
  }
  if (screen.orientation && typeof screen.orientation.angle === "number") {
    return screen.orientation.angle;
  }
  return 0;
}

function getLayoutAngle() {
  let angle = window.innerHeight > window.innerWidth ? 90 : 0;
  if (layoutFlipped) angle = angle + 180;
  return angle;
}

function recenterControlFrame() {
  const angle = getScreenAngle() + getLayoutAngle();
  if (angle === controllerFrameAngle) return; // browser toolbars can resize without rotation
  controllerFrameAngle = angle;
  if (tilt.lastOrientation) {
    onOrientation(tilt.lastOrientation);
    calibrate();
  }
}

ui.flipView.addEventListener("click", function () {
  layoutFlipped = !layoutFlipped;
  ui.controller.classList.toggle("flipped", layoutFlipped);
  recenterControlFrame();
  ui.flipView.blur();
});
window.addEventListener("resize", recenterControlFrame);

// Pointer coordinates are in the browser's axes, even when CSS rotates the yoke.
function pointerAcrossYoke(event) {
  const angle = degToRad(getLayoutAngle());
  return event.clientX * Math.cos(angle) + event.clientY * Math.sin(angle);
}

// ---------- Drag the yoke to steer (backup when tilt doesn't work) ----------

const drag = { active: false, pointerId: null, startX: 0 };

ui.yokeArea.addEventListener("pointerdown", function (event) {
  event.preventDefault();
  ui.yokeArea.setPointerCapture(event.pointerId);
  drag.active = true;
  drag.pointerId = event.pointerId;
  drag.startX = pointerAcrossYoke(event);
});
ui.yokeArea.addEventListener("pointermove", function (event) {
  if (!drag.active || event.pointerId !== drag.pointerId) {
    return;
  }
  // Dragging half the yoke's width = full steering.
  const halfWidth = ui.yokeArea.clientWidth / 2;
  input.steer = clamp((pointerAcrossYoke(event) - drag.startX) / halfWidth, -1, 1);
  showSteering(input.steer * 90);
});
function endDrag(event) {
  if (event.pointerId !== drag.pointerId) {
    return;
  }
  drag.active = false;
  input.steer = tilt.smoothSteer;
  showSteering(0);
}
ui.yokeArea.addEventListener("pointerup", endDrag);
ui.yokeArea.addEventListener("pointercancel", endDrag);

// ---------- Buttons ----------

// A button that is "on" while any finger is on it. Several buttons can be held at once.
// minHoldMs keeps a very quick tap "on" long enough for the game to see it.
function holdButton(element, onChange, minHoldMs) {
  const fingers = new Set();
  let pressedAt = 0;
  function refresh() {
    const down = fingers.size > 0;
    element.classList.toggle("pressed", down);
    onChange(down);
  }
  element.addEventListener("pointerdown", function (event) {
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    fingers.add(event.pointerId);
    pressedAt = performance.now();
    refresh();
  });
  function letGo(event) {
    if (!fingers.has(event.pointerId)) {
      return;
    }
    fingers.delete(event.pointerId);
    const heldFor = performance.now() - pressedAt;
    if (minHoldMs && heldFor < minHoldMs) {
      setTimeout(refresh, minHoldMs - heldFor);
    } else {
      refresh();
    }
  }
  element.addEventListener("pointerup", letGo);
  element.addEventListener("pointercancel", letGo);
  element.addEventListener("lostpointercapture", letGo);
}

// A button that does something once per tap.
function tapButton(element, onTap) {
  element.addEventListener("pointerdown", function (event) {
    event.preventDefault();
    element.classList.add("pressed");
    onTap();
  });
  element.addEventListener("pointerup", function () {
    element.classList.remove("pressed");
  });
  element.addEventListener("pointercancel", function () {
    element.classList.remove("pressed");
  });
}

holdButton(document.getElementById("gas"), function (down) {
  input.gas = down ? 1 : 0;
});
holdButton(document.getElementById("brake"), function (down) {
  input.brake = down ? 1 : 0;
});
holdButton(ui.thrust, function (down) {
  if (down && !input.thrust) {
    buzz();
  }
  input.thrust = down;
});
holdButton(ui.lift, function (down) {
  if (down && !input.lift) {
    buzz();
  }
  input.lift = down;
});
// ROLL: rolls toward the side you're steering (right if you're going straight).
holdButton(
  ui.roll,
  function (down) {
    if (down && buttonRoll === 0) {
      buzz();
      if (input.steer < -0.15) {
        buttonRoll = -1;
      } else {
        buttonRoll = 1;
      }
    }
    if (!down) {
      buttonRoll = 0;
    }
  },
  150
);
holdButton(
  document.getElementById("reset"),
  function (down) {
    input.reset = down;
  },
  150
);
tapButton(ui.fans, function () {
  // We send the fan state we want. The game switches when this value changes.
  input.fans = !input.fans;
  lastFansTap = performance.now();
  ui.fans.classList.toggle("on", input.fans);
  buzz();
});
tapButton(ui.mode, function () {
  const next = DRIVE_MODES[(DRIVE_MODES.indexOf(game.mode) + 1) % DRIVE_MODES.length];
  game.mode = next;
  showMode(next);
  send({ type: MSG.MODE, mode: next });
  buzz();
});
tapButton(document.getElementById("center"), function () {
  calibrate();
  buzz();
});

// Stop iOS from zooming, scrolling, or opening menus while playing.
document.addEventListener("gesturestart", function (event) {
  event.preventDefault();
});
document.addEventListener("contextmenu", function (event) {
  event.preventDefault();
});

// Grey out the buttons this trim doesn't have.
function showMode(mode) {
  const names = { performance: "PERF", thrust: "THRUST", rocket: "ROCKET" };
  ui.mode.textContent = "MODE · " + names[mode];
  ui.thrust.classList.toggle("off", mode === "performance" || game.tank <= 0);
  ui.lift.classList.toggle("off", mode !== "rocket" || game.tank <= 0);
  ui.roll.classList.toggle("off", mode !== "rocket" || game.tank <= 0);
}

// ---------- Connection ----------

let socket = null;

function connectSocket() {
  setStatus(false, "Connecting...");
  socket = new WebSocket(socketUrl());
  socket.addEventListener("open", function () {
    send({ type: MSG.HELLO, role: "phone" });
  });
  socket.addEventListener("message", function (event) {
    const msg = parseMessage(event.data);
    if (msg) {
      handleMessage(msg);
    }
  });
  socket.addEventListener("close", function () {
    setStatus(false, "Disconnected. Retrying...");
    setTimeout(connectSocket, 1000);
  });
}

function handleMessage(msg) {
  if (msg.type === MSG.STATUS) {
    if (msg.games > 0) {
      setStatus(true, "Connected to game");
    } else {
      setStatus(false, "Game screen not open");
    }
  } else if (msg.type === MSG.STATE) {
    game.fansOn = msg.fansOn;
    game.mode = msg.mode;
    game.tank = msg.tankPercent;
    game.airborne=msg.airborne===true;
    game.upY=Number.isFinite(msg.stunt?.upY)?msg.stunt.upY:1;
    game.rolling=msg.stunt?.rolling===true;
    game.receivedAt=performance.now();
    // Follow the game's fan state (it may have been switched with the keyboard),
    // but not right after a tap, while our change is still on its way.
    if (performance.now() - lastFansTap > 800) {
      input.fans = msg.fansOn;
      ui.fans.classList.toggle("on", msg.fansOn);
    }
    ui.speed.textContent = String(msg.speedKmh);
    ui.tankFill.style.width = msg.tankPercent + "%";
    showMode(msg.mode);
    if (msg.events.includes("crash") || msg.events.includes("big_jump")) {
      flashScreen();
    }
  }
}

function sendInput() {
  const now=performance.now();
  const fresh=now-game.receivedAt<CONFIG.phone.timeoutMs;
  const eligible=fresh && game.mode==="rocket" && game.tank>0 && (game.airborne || game.upY < -0.5) && !drag.active && now-(tilt.receivedAt ?? -Infinity)<CONFIG.phone.timeoutMs;
  const gesture=rollGesture.update(steeringDegrees,eligible,game.rolling,now);
  input.roll=buttonRoll || gesture;
  ui.rollHint.textContent=!fresh ? "Tilt flips: waiting for game" : game.mode!=="rocket" ? "Tilt flips need Rocket mode" : game.rolling ? "Rolling · return phone to center" : eligible ? (rollGesture.armed ? "Tilt 45° left / right to barrel roll" : "Center phone to arm the next flip") : "In the air: tilt 45° to roll · ROLL also works on the ground";
  // Keep a committed stunt gesture from also yawing the car sideways in flight.
  send({...input,steer:eligible && (gesture || game.rolling || rollGesture.direction!==0 && !rollGesture.armed) ? 0 : input.steer});
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function setStatus(ok, text) {
  ui.dot.classList.toggle("ok", ok);
  ui.statusText.textContent = text;
}

// ---------- Feedback ----------

function flashScreen() {
  ui.flash.classList.add("on");
  buzz();
  setTimeout(function () {
    ui.flash.classList.remove("on");
  }, 120);
}

// A short vibration. Android has navigator.vibrate(). iPhone Safari doesn't, but tapping a
// hidden iOS "switch" checkbox makes a small haptic tick (only works right after a touch).
function buzz() {
  if (navigator.vibrate) {
    navigator.vibrate(15);
    return;
  }
  const label = document.createElement("label");
  label.ariaHidden = "true";
  label.style.display = "none";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.setAttribute("switch", "");
  label.appendChild(box);
  document.head.appendChild(label);
  label.click();
  document.head.removeChild(label);
}

// Keep the phone screen from going to sleep while driving.
async function keepScreenOn() {
  try {
    if (navigator.wakeLock) {
      await navigator.wakeLock.request("screen");
    }
  } catch (err) {
    // Not supported or not allowed. The game still works.
  }
}
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible") {
    keepScreenOn();
  }
});

// ---------- Small math helpers ----------

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
