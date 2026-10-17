// telemetry.js — Owner: shared
// A "pit wall" telemetry panel, like the screens racing teams watch. Press T to show or hide it.
// It reads car.telemetry (filled in by car.js every physics step) and shows:
//   - a G-G diagram (cornering and braking/acceleration g, with a trail)
//   - all four tires: load, slip angle, how much of their grip is used, temperature, suspension
//   - traces of speed, throttle, brake and steering over the last 10 seconds
//   - powertrain, aero, fans, and the thruster tank (pressure, air left, flow, thrust, delta-v)

const TRACE_SECONDS = 10;
const TRACE_RATE = 30; // samples per second
const TRAIL_POINTS = 60; // G-G trail length

export class TelemetryPanel {
  constructor(element) {
    this.element = element;
    this.visible = false;
    this.traces = { speed: [], throttle: [], brake: [], steer: [] };
    this.trail = [];
    this.sampleTimer = 0;
    this.textTimer = 0;
    this.build();
  }

  build() {
    const tires = ["FL", "FR", "RL", "RR"];
    let tireHtml = "";
    for (let i = 0; i < 4; i++) {
      tireHtml +=
        '<div class="tire" id="tire' + i + '">' +
        '<div class="tireName">' + tires[i] + '</div>' +
        '<div class="tireBar"><div class="tireFill"></div></div>' +
        '<div class="tireNums"></div>' +
        "</div>";
    }
    this.element.innerHTML =
      '<div class="telHead">TELEMETRY <span class="telKey">T to hide</span></div>' +
      '<div class="telTop">' +
      '<div><canvas id="ggCanvas" width="300" height="300"></canvas><div class="telCaption">G-G (lateral / long.)</div></div>' +
      '<div class="tireGrid">' + tireHtml + '<div class="telCaption tireCaption">bar = grip used · load · slip angle · temp · squash</div></div>' +
      "</div>" +
      '<canvas id="traceCanvas" width="1040" height="190"></canvas>' +
      '<div class="telCaption"><span style="color:#e6e9ee">speed</span> · <span style="color:#3ee08f">throttle</span> · <span style="color:#ff4d5e">brake</span> · <span style="color:#34d3ff">steer</span> (last 10 s)</div>' +
      '<div class="telGrid" id="telGrid"></div>';
    this.gg = this.element.querySelector("#ggCanvas");
    this.trace = this.element.querySelector("#traceCanvas");
    this.grid = this.element.querySelector("#telGrid");
    this.tireElements = [];
    for (let i = 0; i < 4; i++) {
      const tire = this.element.querySelector("#tire" + i);
      this.tireElements.push({
        fill: tire.querySelector(".tireFill"),
        nums: tire.querySelector(".tireNums"),
        box: tire,
      });
    }
  }

  toggle() {
    this.setVisible(!this.visible);
  }

  setVisible(visible) {
    this.visible = visible;
    this.element.style.display = visible ? "block" : "none";
  }

  // Call every frame with the car's telemetry.
  update(tel, dt) {
    // Always record, so the traces are full the moment you open the panel.
    this.sampleTimer = this.sampleTimer + dt;
    if (this.sampleTimer >= 1 / TRACE_RATE) {
      this.sampleTimer = 0;
      pushLimited(this.traces.speed, tel.speedKmh, TRACE_SECONDS * TRACE_RATE);
      pushLimited(this.traces.throttle, tel.throttle, TRACE_SECONDS * TRACE_RATE);
      pushLimited(this.traces.brake, tel.brake, TRACE_SECONDS * TRACE_RATE);
      pushLimited(this.traces.steer, tel.steerDeg, TRACE_SECONDS * TRACE_RATE);
      pushLimited(this.trail, { x: tel.gLat, y: tel.gLong }, TRAIL_POINTS);
    }
    if (!this.visible) {
      return;
    }
    this.drawGG(tel);
    this.drawTraces();
    // Text changes don't need 60 updates a second.
    this.textTimer = this.textTimer + dt;
    if (this.textTimer > 0.1) {
      this.textTimer = 0;
      this.updateTires(tel);
      this.updateNumbers(tel);
    }
  }

  drawGG(tel) {
    const ctx = this.gg.getContext("2d");
    const size = this.gg.width;
    const middle = size / 2;
    const perG = size / 2 / 3.5; // pixels per g (shows up to 3.5 g)
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "18px -apple-system, sans-serif";
    for (let g = 1; g <= 3; g++) {
      ctx.beginPath();
      ctx.arc(middle, middle, g * perG, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(g + "g", middle + g * perG * 0.71 + 4, middle - g * perG * 0.71);
    }
    ctx.beginPath();
    ctx.moveTo(0, middle);
    ctx.lineTo(size, middle);
    ctx.moveTo(middle, 0);
    ctx.lineTo(middle, size);
    ctx.stroke();
    // Trail: older points fade out. Right = turning right, up = speeding up.
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      ctx.fillStyle = "rgba(52, 211, 255," + ((i / this.trail.length) * 0.6).toFixed(2) + ")";
      ctx.beginPath();
      ctx.arc(middle + p.x * perG, middle - p.y * perG, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(middle + tel.gLat * perG, middle - tel.gLong * perG, 9, 0, Math.PI * 2);
    ctx.fill();
    const total = Math.sqrt(tel.gLat * tel.gLat + tel.gLong * tel.gLong);
    ctx.fillStyle = "#e6e9ee";
    ctx.font = "bold 26px -apple-system, sans-serif";
    ctx.fillText(total.toFixed(2) + " g", 12, 32);
  }

  drawTraces() {
    const ctx = this.trace.getContext("2d");
    const w = this.trace.width;
    const h = this.trace.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(0, (h * k) / 4);
      ctx.lineTo(w, (h * k) / 4);
      ctx.stroke();
    }
    const count = TRACE_SECONDS * TRACE_RATE;
    drawLine(ctx, this.traces.speed, count, w, h, 0, 350, "#e6e9ee");
    drawLine(ctx, this.traces.throttle, count, w, h, 0, 1, "#3ee08f");
    drawLine(ctx, this.traces.brake, count, w, h, 0, 1, "#ff4d5e");
    drawLine(ctx, this.traces.steer, count, w, h, -30, 30, "#34d3ff");
  }

  updateTires(tel) {
    for (let i = 0; i < 4; i++) {
      const wheel = tel.wheels[i];
      const parts = this.tireElements[i];
      const used = Math.min(1, wheel.usage);
      parts.fill.style.width = (used * 100).toFixed(0) + "%";
      let color = "#3ee08f";
      if (used > 0.9) {
        color = "#ff4d5e";
      } else if (used > 0.6) {
        color = "#f5c542";
      }
      parts.fill.style.background = color;
      let tempColor = "#3ee08f";
      if (wheel.tempC < 50) {
        tempColor = "#6aa9ff";
      } else if (wheel.tempC > 110) {
        tempColor = "#ff4d5e";
      }
      let surface = "";
      if (wheel.grass) {
        surface = ' <span class="grass">GRASS</span>';
      }
      if (!wheel.contact) {
        surface = ' <span class="air">AIR</span>';
      }
      parts.nums.innerHTML =
        (wheel.load / 1000).toFixed(1) + " kN · " +
        noMinusZero(wheel.slipAngleDeg).toFixed(1) + "°<br>" +
        '<span style="color:' + tempColor + '">' + wheel.tempC.toFixed(0) + "°C</span> · " +
        wheel.suspensionMm.toFixed(0) + " mm" + surface;
    }
  }

  updateNumbers(tel) {
    const kN = function (n) {
      return (n / 1000).toFixed(1) + " kN";
    };
    let thrusters = "";
    if (tel.airCapacityKg > 0) {
      thrusters =
        row("Tank pressure", tel.pressureBar.toFixed(0) + " bar") +
        row("Air left", tel.airKg.toFixed(0) + " / " + tel.airCapacityKg.toFixed(0) + " kg") +
        row("Air flow", tel.massFlowKgS.toFixed(0) + " kg/s") +
        row("Rear thrust", kN(tel.rearThrustN)) +
        row("Corner thrust", kN(tel.cornerThrustN) + (tel.rollActive ? " ROLL" : "")) +
        row("Boost left", tel.boostSecondsLeft.toFixed(1) + " s") +
        row("Δv left", (tel.deltaVLeft * 3.6).toFixed(0) + " km/h");
    } else {
      thrusters = row("Thrusters", "none (Performance)");
    }
    this.grid.innerHTML =
      section("Powertrain",
        row("Motors", tel.motorKW.toFixed(0) + " kW") +
        row("Assists", light("TC", tel.tractionControl) + light("ABS", tel.abs) + light("ESC", tel.esc)) +
        row("Steering", tel.steerDeg.toFixed(1) + "°")) +
      section("Aero + fans",
        row("Drag", kN(tel.dragN)) +
        row("Aero downforce", kN(tel.aeroDownN) + " · wing " + (tel.wing * 100).toFixed(0) + "%") +
        row("Fans", tel.fanRpm.toFixed(0) + " rpm · " + tel.fanKW.toFixed(0) + " kW") +
        row("Suction", tel.suctionKPa.toFixed(1) + " kPa · " + kN(tel.fanDownN))) +
      section("Thrusters", thrusters) +
      section("Vehicle",
        row("Mass", tel.massKg.toFixed(0) + " kg") +
        row("Vertical", tel.gVert.toFixed(2) + " g") +
        row("Yaw rate", tel.yawRateDeg.toFixed(0) + " °/s") +
        row("Roll · pitch", tel.rollDeg.toFixed(1) + "° · " + tel.pitchDeg.toFixed(1) + "°") +
        row("Altitude", tel.altitude.toFixed(1) + " m · " + tel.verticalSpeed.toFixed(1) + " m/s"));
  }
}

function section(title, rows) {
  return '<div class="telSection"><div class="telTitle">' + title + "</div>" + rows + "</div>";
}

function row(label, value) {
  return '<div class="telRow"><span>' + label + "</span><b>" + value + "</b></div>";
}

function light(name, on) {
  return '<span class="light' + (on ? " on" : "") + '">' + name + "</span>";
}

function drawLine(ctx, values, count, w, h, min, max, color) {
  if (values.length < 2) {
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < values.length; i++) {
    const x = (w * (count - values.length + i)) / count;
    const y = h - ((values[i] - min) / (max - min)) * (h - 8) - 4;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

// Show 0.0 instead of -0.0.
function noMinusZero(value) {
  if (Math.abs(value) < 0.05) {
    return 0;
  }
  return value;
}

function pushLimited(list, value, limit) {
  list.push(value);
  if (list.length > limit) {
    list.shift();
  }
}
