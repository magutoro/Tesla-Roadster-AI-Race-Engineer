// car.js — Owner: B (friend)
// Car physics: tires, powertrain, aero, fan suction, the thruster air tank, drive modes,
// barrel roll, and landing assist. It also fills in `car.telemetry` for the telemetry panel.
//
// How it works:
// - Rapier's ray-cast vehicle handles the suspension: each wheel is a ray with a spring.
// - We do the tires ourselves, like racing sims do. For every wheel touching the ground we
//   work out how fast the tire is sliding sideways (the "slip angle"), how hard it's pressed
//   down (the "load"), and what the driver asks for (drive, brake, regen). A "magic formula"
//   curve turns slip into grip, and the "friction circle" stops a tire from braking and
//   cornering at full strength at the same time. The forces are applied at each contact patch.
//
// Pass scene = null to run the physics without any graphics (handy for testing in Node).

import * as THREE from "three";
import { CONFIG } from "./config.js";
import { buildCarModel } from "./car-model.js";
import { Particles } from "./effects.js";

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = CONFIG.physics.gravity;
// Distance from the body's center down to the ground when the car sits at rest.
const REST_HEIGHT = 0.7;
// Wheel order everywhere: 0 front-left, 1 front-right, 2 rear-left, 3 rear-right.
// +X is the car's LEFT side, because the car faces +Z.
const IS_FRONT = [true, true, false, false];
const IS_LEFT = [true, false, true, false];
const FLOOR_AREA = 4.0; // m^2 of floor sealed by the fan skirts (for the suction pressure readout)

export class Car {
  constructor(RAPIER, world, scene) {
    this.RAPIER = RAPIER;
    this.world = world;
    const c = CONFIG.car;

    // ----- Physics body -----
    // CCD stops a fast car from passing straight through thin things like the curl ramp.
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setCcdEnabled(true).setTranslation(0, 2, 0)
    );
    this.collider = world.createCollider(makeBodyShape(RAPIER).setFriction(0.5), this.body);
    this.appliedMass = 0;

    // ----- Wheels (suspension only: tire grip is ours, so Rapier's tire friction is off) -----
    this.vehicle = world.createVehicleController(this.body);
    this.vehicle.indexUpAxis = 1; // Y is up
    this.vehicle.setIndexForwardAxis = 2; // Z is forward (Rapier's setter really is named this)
    this.wheelSpots = [
      { x: c.wheelX, z: c.wheelFrontZ },
      { x: -c.wheelX, z: c.wheelFrontZ },
      { x: c.wheelX, z: c.wheelRearZ },
      { x: -c.wheelX, z: c.wheelRearZ },
    ];
    for (let i = 0; i < 4; i++) {
      this.vehicle.addWheel(
        { x: this.wheelSpots[i].x, y: c.wheelY, z: this.wheelSpots[i].z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        c.suspensionRestLength,
        c.wheelRadius
      );
      this.vehicle.setWheelSuspensionStiffness(i, c.suspensionStiffness);
      this.vehicle.setWheelSuspensionCompression(i, c.suspensionCompression);
      this.vehicle.setWheelSuspensionRelaxation(i, c.suspensionRelaxation);
      this.vehicle.setWheelMaxSuspensionForce(i, c.maxSuspensionForce);
      this.vehicle.setWheelFrictionSlip(i, 0);
      this.vehicle.setWheelSideFrictionStiffness(i, 0);
    }

    // ----- Gameplay state -----
    this.mode = "rocket";
    this.fansOn = false;
    this.fanPower = 0; // 0..1, follows fansOn with a short spin-up
    this.airCapacityKg = 0; // depends on the trim
    this.airKg = 0;
    this.mass = c.dryMass;
    this.tank = 100; // percent, for the HUD and phone
    this.tankCapacity = 0; // liters
    this.tankLiters = 0;
    this.refillTimer = 0;
    this.thrusting = false; // rear thrusters firing this step
    this.lifting = false; // corner thrusters firing this step, from LIFT
    this.landingBurn = false; // corner thrusters softening a landing by themselves
    this.tankEmptyPressed = false; // pressing a thruster button with an empty tank (HUD flashes)
    this.rolling = false;
    this.rollDirection = 1; // +1 = roll right, -1 = roll left
    this.rollTurned = 0;
    this.rollTime = 0;
    this.lastRollInput = 0;
    this.hopTime = 0;
    this.yawThrust = 0;
    this.braking = 0;
    this.steerAngle = 0; // the angle of an imaginary center front wheel
    this.steerInput = 0;
    this.wheelSteer = [0, 0, 0, 0]; // each front wheel's own angle (Ackermann steering)
    this.wheelSpinAngle = [0, 0, 0, 0];
    this.wheelSpinSpeed = [0, 0, 0, 0];
    this.wingDeploy = 0;
    this.speedKmh = 0;
    this.forwardSpeed = 0;
    this.airborne = false;
    this.airTime = 0;
    this.altitude = 0;
    this.upsideDownTime = 0;
    this.needsReset = false;
    this.usedThrustBefore = false;
    this.events = [];
    this.lastVelocity = new THREE.Vector3();
    this.lastFullVelocity = new THREE.Vector3();
    this.crashCooldown = 0;
    this.spawn = { x: 0, y: 0, z: 0, heading: 0 };
    // The game can set this to a function(collider) that returns a grip multiplier
    // for whatever a wheel is touching (for example less grip on grass).
    this.surfaceGrip = null;
    this.surfaceDrag = null;
    this.telemetry = makeTelemetry();

    // Physics runs at a fixed rate, but the screen may refresh faster.
    // We remember the last two physics poses and draw the car in between them.
    this.prevPosition = new THREE.Vector3();
    this.currPosition = new THREE.Vector3();
    this.prevQuaternion = new THREE.Quaternion();
    this.currQuaternion = new THREE.Quaternion();

    // ----- Graphics (skipped when testing without a scene) -----
    this.model = null;
    if (scene) {
      this.model = buildCarModel();
      scene.add(this.model.root);
      this.plume = new Particles(scene, 1400, 0xd8ecff, 1.0);
      this.plume.drag = 4.0;
      this.fanAir = new Particles(scene, 300, 0x3fc8ff, 0.3);
    }

    this.setMode("rocket");
  }

  // Put the car back at the spawn point, upright, with a full tank.
  reset(spawn) {
    if (spawn) {
      this.spawn = spawn;
    }
    const s = this.spawn;
    const heading = THREE.MathUtils.degToRad(s.heading || 0);
    const rotation = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, heading);
    this.body.setTranslation({ x: s.x, y: (s.y || 0) + CONFIG.car.spawnHeight, z: s.z }, true);
    this.body.setRotation(rotation, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.airKg = this.airCapacityKg;
    this.updateMass();
    this.updateTankNumbers();
    this.rolling = false;
    this.steerAngle = 0;
    this.airTime = 0;
    this.upsideDownTime = 0;
    this.needsReset = false;
    this.lastVelocity.set(0, 0, 0);
    this.lastFullVelocity.set(0, 0, 0);
    this.telemetry.gLat = 0;
    this.telemetry.gLong = 0;
    this.telemetry.gVert = 1;
    this.savePose();
    this.prevPosition.copy(this.currPosition);
    this.prevQuaternion.copy(this.currQuaternion);
  }

  // The three trims from the reveal. Switching trims gives you that trim's full air tank.
  // performance: fans only. thrust: fans + 4 rear thrusters (200 L).
  // rocket: all 10 thrusters: rear, 4 corner (lift and roll), 2 front (yaw) (600 L).
  setMode(mode) {
    this.mode = mode;
    const t = CONFIG.thrusters;
    if (mode === "rocket") {
      this.tankCapacity = t.tankLitersRocket;
    } else if (mode === "thrust") {
      this.tankCapacity = t.tankLitersThrust;
    } else {
      this.tankCapacity = 0;
    }
    this.airCapacityKg = this.tankCapacity * t.airKgPerLiter;
    this.airKg = this.airCapacityKg;
    this.rolling = false;
    this.updateMass();
    this.updateTankNumbers();
  }

  hasRearThrusters() {
    return this.mode === "thrust" || this.mode === "rocket";
  }

  hasCornerThrusters() {
    return this.mode === "rocket";
  }

  // One physics step. Call this BEFORE world.step().
  step(input, dt) {
    const c = CONFIG.car;
    const body = this.body;
    const vehicle = this.vehicle;
    const mass = this.mass;
    const weight = mass * GRAVITY;
    const tel = this.telemetry;

    // Rapier keeps added forces between steps, so clear last step's forces first.
    body.resetForces(true);
    body.resetTorques(true);

    const forward = this.getForward();
    const up = this.getUp();
    const velocity = toVector3(body.linvel());
    const speed = velocity.dot(forward); // along the car's nose, negative when reversing
    this.forwardSpeed = speed;
    this.speedKmh = Math.abs(speed) * 3.6;
    this.steerInput = input.steer;

    // ----- Steering: smaller angle at high speed, and the wheels turn smoothly -----
    const speedFactor = Math.min(1, this.speedKmh / c.highSpeedForSteerKmh);
    const maxAngle = c.maxSteerAngle + (c.highSpeedSteerAngle - c.maxSteerAngle) * speedFactor;
    // Rapier and three.js: a positive angle turns LEFT. Our input: +1 means RIGHT. So flip the sign.
    this.steerAngle = moveToward(this.steerAngle, -input.steer * maxAngle, c.steerSpeed * dt);
    this.setAckermann(this.steerAngle);

    // ----- What the driver asks the tires for (shared out per wheel in applyTires) -----
    let driveForce = 0; // total push from the motors (negative = reverse)
    let brakeForce = 0; // total from the brakes
    if (input.gas > 0) {
      // Motors are limited by force at low speed and by power (1 MW) at high speed.
      const byPower = (c.motorPowerKW * 1000) / Math.max(Math.abs(speed), 1);
      const topSpeed = c.topSpeedKmh[this.mode] || 338;
      const nearTopSpeed = clamp((topSpeed - this.speedKmh) / 4, 0, 1);
      driveForce = input.gas * Math.min(c.maxDriveForce, byPower) * nearTopSpeed;
    }
    if (input.brake > 0) {
      if (speed > 1 || input.gas > 0) {
        brakeForce = input.brake * c.maxBrakeG * weight;
        driveForce = 0; // brake pedal wins
      } else {
        driveForce = -input.brake * c.reverseForce; // stopped: the brake pedal means reverse
      }
    }
    // Lifting off the pedals: regen braking plus rolling resistance.
    let resistForce = c.rollingResistance * weight;
    const noPedals = input.gas === 0 && input.brake === 0;
    if (noPedals) {
      resistForce = resistForce + c.regenG * weight;
    }
    this.braking = 0;
    if (brakeForce > 0) {
      this.braking = 1;
    }

    // ----- Fans: suck the car onto whatever it's driving on -----
    let fanTarget = 0;
    if (this.fansOn) {
      fanTarget = 1;
    }
    this.fanPower = moveToward(this.fanPower, fanTarget, dt / CONFIG.fans.spinUpSeconds);
    const contacts = this.countWheelContacts();
    let fanForce = 0;
    // (Skipped during a barrel roll, so the fans don't fight the hop.)
    if (this.fanPower > 0 && contacts > 0 && !this.rolling) {
      // Pull along the car's own "down", so it also sticks to ramps, walls and ceilings.
      fanForce = this.fanPower * CONFIG.fans.downforceG * weight * (contacts / 4);
      body.addForce(scaled(up, -fanForce), true);
    }

    // ----- Aerodynamics: drag, and downforce from the body and the active rear wing -----
    // The wing rises above 90 km/h, lies flat again near top speed for less drag,
    // and stands up as an air brake when braking hard.
    let wingTarget = 0;
    const fastBraking = brakeForce > 0 && this.speedKmh > 100;
    if ((this.speedKmh > c.wingDeployKmh && this.speedKmh < c.wingRetractKmh) || fastBraking) {
      wingTarget = 1;
    }
    this.wingDeploy = moveToward(this.wingDeploy, wingTarget, dt * 1.5);
    const halfRhoV2 = 0.5 * c.airDensity * velocity.lengthSq();
    const dragForce = halfRhoV2 * (c.dragArea + c.wingDragArea * this.wingDeploy);
    if (dragForce > 0.1) {
      body.addForce(velocity.clone().normalize().multiplyScalar(-dragForce), true);
    }
    const downforce = 0.5 * c.airDensity * speed * speed * c.downforceArea * (0.4 + 0.6 * this.wingDeploy);
    const position = toVector3(body.translation());
    const frontAxle = position.clone().addScaledVector(forward, c.wheelFrontZ);
    const rearAxle = position.clone().addScaledVector(forward, c.wheelRearZ);
    body.addForceAtPoint(scaled(up, -downforce * c.aeroFrontShare), frontAxle, true);
    body.addForceAtPoint(scaled(up, -downforce * (1 - c.aeroFrontShare)), rearAxle, true);

    // ----- Thrusters and the air tank -----
    this.updateThrusters(input, dt, forward, up, velocity, weight);

    // ----- In the air (the barrel roll takes over the spin while it runs) -----
    this.yawThrust = 0;
    if (this.airborne && !this.rolling) {
      if (this.mode === "rocket") {
        // Flying: stay level like a drone, and turn with the front yaw thrusters.
        this.levelOut(-input.steer * CONFIG.rocket.yawRate, dt);
        if (Math.abs(input.steer) > 0.15) {
          this.yawThrust = Math.sign(input.steer);
        }
      } else if (this.altitude < CONFIG.air.landingAssistHeight) {
        // Landing assist: rotate back to level before touching down.
        this.levelOut(null, dt);
      }
    }

    // ----- Stability control, then suspension (Rapier), anti-roll bars, bump stops and tires (ours) -----
    driveForce = this.stabilityControl(speed, forward, up, velocity, driveForce, weight);
    vehicle.updateVehicle(dt);
    const extraLoad = this.applyAntiRollBars(up);
    this.applyBumpStops(up, extraLoad);
    this.applyTires(input, dt, driveForce, brakeForce, resistForce, noPedals, extraLoad, forward, up);

    // ----- Telemetry that doesn't depend on the tires -----
    tel.speedKmh = this.speedKmh;
    tel.throttle = input.gas;
    tel.brake = input.brake;
    tel.steerDeg = THREE.MathUtils.radToDeg(-this.steerAngle);
    tel.dragN = dragForce;
    tel.aeroDownN = downforce;
    tel.wing = this.wingDeploy;
    tel.fanDownN = fanForce;
    tel.fanRpm = this.fanPower * 18000;
    tel.fanKW = this.fanPower * 80; // reveal: four fans, ~20 kW each
    tel.suctionKPa = fanForce / FLOOR_AREA / 1000;
    tel.massKg = this.mass;
    let motorPower = driveForce * speed;
    if (noPedals && Math.abs(speed) > 1) {
      motorPower = -CONFIG.car.regenG * weight * Math.abs(speed); // regen charging the battery
    }
    tel.motorKW = motorPower / 1000;
  }

  // ----- Tires -----
  // The heart of the handling. For each wheel on the ground: how much load, how much it's sliding,
  // what the driver wants, then grip from the tire curve, limited by the friction circle.
  applyTires(input, dt, driveForce, brakeForce, resistForce, noPedals, extraLoad, forward, up) {
    const c = CONFIG.car;
    const body = this.body;
    const vehicle = this.vehicle;
    const tel = this.telemetry;
    const staticLoad = (this.mass * GRAVITY) / 4;
    const massPerWheel = this.mass / 4;
    tel.tractionControl = false;
    tel.abs = false;

    for (let i = 0; i < 4; i++) {
      const wheel = tel.wheels[i];
      let suspension = vehicle.wheelSuspensionLength(i);
      if (suspension === null) {
        suspension = c.suspensionRestLength;
      }
      wheel.suspensionMm = (c.suspensionRestLength - suspension) * 1000;
      wheel.contact = vehicle.wheelIsInContact(i);
      if (!wheel.contact) {
        // Free-spinning wheel in the air: slows down slowly.
        this.wheelSpinSpeed[i] = this.wheelSpinSpeed[i] * 0.995;
        wheel.load = 0;
        wheel.fx = 0;
        wheel.fy = 0;
        wheel.usage = 0;
        wheel.slipAngleDeg = 0;
        this.coolTire(i, 0, dt);
        continue;
      }

      const load = Math.max(0, vehicle.wheelSuspensionForce(i) + extraLoad[i]);
      const point = toVector3(vehicle.wheelContactPoint(i));
      const normal = toVector3(vehicle.wheelContactNormal(i));

      // Which way this tire points (steered), flattened onto the road.
      const angle = this.wheelSteer[i];
      const left = new THREE.Vector3().crossVectors(up, forward);
      const heading = scaled(forward, Math.cos(angle)).addScaledVector(left, Math.sin(angle));
      const tireForward = heading.addScaledVector(normal, -normal.dot(heading)).normalize();
      const tireLeft = new THREE.Vector3().crossVectors(normal, tireForward);

      // How fast the contact patch moves along and across the tire.
      const v = toVector3(body.velocityAtPoint(point));
      const vx = v.dot(tireForward);
      const vy = v.dot(tireLeft);

      // How grippy is this tire right now?
      let surface = 1;
      let surfaceDrag = 0;
      const ground = vehicle.wheelGroundObject(i);
      if (ground && this.surfaceGrip) {
        surface = this.surfaceGrip(ground);
      }
      if (ground && this.surfaceDrag) {
        surfaceDrag = this.surfaceDrag(ground) * load;
      }
      wheel.grass = surface < 1;
      const loadEffect = clamp(1 - c.tireLoadSensitivity * (load / staticLoad - 1), 0.7, 1.15);
      let axleGrip = 1;
      if (!IS_FRONT[i]) {
        axleGrip = c.rearGripBias;
      }
      const maxGrip = c.tireGrip * axleGrip * surface * loadEffect * load;

      // Sideways: slip angle -> grip, using the magic formula curve.
      // (Below ~3 m/s we pretend the car is going 3 m/s, which keeps parking smooth.)
      const slipAngle = Math.atan2(vy, Math.max(Math.abs(vx), 3));
      let fy = -maxGrip * magicFormula(slipAngle);
      // Never push harder than it takes to stop the sideways slide this step (keeps it stable).
      const stopSideways = (massPerWheel * Math.abs(vy)) / dt;
      fy = clamp(fy, -stopSideways, stopSideways);

      // Along the tire: motors, brakes, regen and rolling resistance.
      let share = (1 - c.frontDriveShare) / 2;
      let brakeShare = (1 - c.brakeFrontShare) / 2;
      if (IS_FRONT[i]) {
        share = c.frontDriveShare / 2;
        brakeShare = c.brakeFrontShare / 2;
      }
      // Brakes always push against the way the wheel is rolling; near zero speed they fade in
      // smoothly, so the car doesn't shudder when it stops.
      const against = (brakeForce * brakeShare + resistForce / 4 + surfaceDrag) * clamp(vx / 0.6, -1, 1);
      let fx = driveForce * share - against;
      // Stopped with no pedals: hold the car still (EVs do this), even on a slope.
      if (noPedals && Math.abs(vx) < 1.5 && Math.abs(this.forwardSpeed) < 1.5) {
        fx = clamp(-(massPerWheel * vx) / dt, -maxGrip, maxGrip);
      }

      // Traction control and ABS: never ask a tire for more than it can give.
      const limit = maxGrip * c.tractionLimit;
      if (fx > limit) {
        fx = limit;
        tel.tractionControl = true;
      } else if (fx < -limit) {
        fx = -limit;
        if (brakeForce > 0) {
          tel.abs = true;
        } else {
          tel.tractionControl = true;
        }
      }
      // Friction circle: what's used for driving/braking isn't available for cornering.
      const room = Math.sqrt(Math.max(0, maxGrip * maxGrip - fx * fx));
      fy = clamp(fy, -room, room);

      const force = scaled(tireForward, fx).addScaledVector(tireLeft, fy);
      body.addForceAtPoint(force, point, true);

      // Telemetry and the visual wheel spin.
      wheel.load = load;
      wheel.fx = fx;
      wheel.fy = fy;
      wheel.slipAngleDeg = THREE.MathUtils.radToDeg(slipAngle);
      wheel.usage = 0;
      if (maxGrip > 1) {
        wheel.usage = Math.sqrt(fx * fx + fy * fy) / maxGrip;
      }
      let spin = vx / c.wheelRadius;
      if (tel.tractionControl && fx > 0) {
        spin = spin * 1.08; // a little wheelspin
      }
      this.wheelSpinSpeed[i] = spin;
      // Tires heat up from sliding and cool down in the airflow (shown in telemetry).
      const slideHeat = Math.abs(fy * vy) + Math.abs(fx) * 2 * wheel.usage * wheel.usage;
      this.coolTire(i, slideHeat, dt);
    }
  }

  coolTire(i, heatWatts, dt) {
    const wheel = this.telemetry.wheels[i];
    const cooling = 0.03 * (1 + this.speedKmh / 110);
    wheel.tempC = wheel.tempC + (heatWatts / 4000 - (wheel.tempC - 25) * cooling) * dt;
  }

  // Anti-roll bars: when one side's spring is squashed more than the other, push that side of the
  // body up and the other side down. Less body roll, and it shifts load between the tires.
  applyAntiRollBars(up) {
    const c = CONFIG.car;
    const vehicle = this.vehicle;
    const extraLoad = [0, 0, 0, 0];
    const axles = [
      [0, 1, c.antiRollFront],
      [2, 3, c.antiRollRear],
    ];
    for (const axle of axles) {
      const leftWheel = axle[0];
      const rightWheel = axle[1];
      if (!vehicle.wheelIsInContact(leftWheel) || !vehicle.wheelIsInContact(rightWheel)) {
        continue;
      }
      const squashLeft = c.suspensionRestLength - vehicle.wheelSuspensionLength(leftWheel);
      const squashRight = c.suspensionRestLength - vehicle.wheelSuspensionLength(rightWheel);
      const force = axle[2] * (squashLeft - squashRight);
      this.body.addForceAtPoint(scaled(up, force), vehicle.wheelHardPoint(leftWheel), true);
      this.body.addForceAtPoint(scaled(up, -force), vehicle.wheelHardPoint(rightWheel), true);
      extraLoad[leftWheel] = force;
      extraLoad[rightWheel] = -force;
    }
    return extraLoad;
  }

  // Bump stops: rubber stops at the end of the suspension travel, so a huge load (fans + a fast
  // curve) can't bottom the car out onto the road.
  applyBumpStops(up, extraLoad) {
    const c = CONFIG.car;
    for (let i = 0; i < 4; i++) {
      if (!this.vehicle.wheelIsInContact(i)) {
        continue;
      }
      const squash = c.suspensionRestLength - this.vehicle.wheelSuspensionLength(i);
      const overlap = squash - c.bumpStopStart;
      if (overlap > 0) {
        const force = c.bumpStopStiffness * overlap * overlap;
        this.body.addForceAtPoint(scaled(up, force), this.vehicle.wheelHardPoint(i), true);
        extraLoad[i] = extraLoad[i] + force;
      }
    }
  }

  // Stability control (ESC): if the car turns faster or slower than the steering asks for
  // (it's spinning or sliding), nudge it back in line and ease off the motors.
  // Real cars do this by braking single wheels; we push the car's yaw directly.
  stabilityControl(speed, forward, up, velocity, driveForce, weight) {
    const c = CONFIG.car;
    const tel = this.telemetry;
    tel.esc = false;
    if (!c.stabilityControl || this.countWheelContacts() < 3 || Math.abs(speed) < 5 || this.rolling) {
      return driveForce;
    }
    const wheelbase = c.wheelFrontZ - c.wheelRearZ;
    const yawRate = toVector3(this.body.angvel()).dot(up);
    // The turn rate the driver is asking for (the "bicycle model"), limited by the grip available
    // (a little less than the tires' peak, to be safe).
    let wanted = (speed * Math.tan(this.steerAngle)) / wheelbase;
    const gripG = 0.85 * c.tireGrip * (1 + CONFIG.fans.downforceG * this.fanPower);
    const gripLimit = (gripG * GRAVITY) / Math.abs(speed);
    wanted = clamp(wanted, -gripLimit, gripLimit);
    // Also steer out of any sideways slide ("body slip"): the car should point where it's going.
    const left = new THREE.Vector3().crossVectors(up, forward);
    const bodySlip = Math.atan2(velocity.dot(left), Math.abs(speed));
    wanted = wanted + 3 * bodySlip;
    const error = yawRate - wanted;
    if (Math.abs(error) < 0.12 && Math.abs(bodySlip) < 0.08) {
      return driveForce;
    }
    tel.esc = true;
    const length = c.halfLength * 2;
    const width = c.halfWidth * 2;
    const yawInertia = (this.mass / 12) * (length * length + width * width);
    // About as much turning force as braking one wheel hard could make.
    const maxTorque = weight * c.tireGrip * 0.6 * (1 + CONFIG.fans.downforceG * this.fanPower);
    const torque = clamp(-error * yawInertia * c.stabilityStrength, -maxTorque, maxTorque);
    this.body.addTorque(scaled(up, torque), true);
    // Ease off the motors while the car is sliding.
    const ease = clamp(1 - (Math.abs(bodySlip) - 0.05) * 4, 0.3, 1);
    return driveForce * ease;
  }

  // Ackermann steering: the inside front wheel turns a little more than the outside one,
  // because it follows a tighter circle.
  setAckermann(angle) {
    const c = CONFIG.car;
    const wheelbase = c.wheelFrontZ - c.wheelRearZ;
    const track = c.wheelX * 2;
    let leftAngle = angle;
    let rightAngle = angle;
    if (Math.abs(angle) > 0.001) {
      const radius = wheelbase / Math.tan(Math.abs(angle));
      const inside = Math.atan(wheelbase / (radius - track / 2));
      const outside = Math.atan(wheelbase / (radius + track / 2));
      if (angle > 0) {
        // Turning left: the left wheel is on the inside.
        leftAngle = inside;
        rightAngle = outside;
      } else {
        leftAngle = -outside;
        rightAngle = -inside;
      }
    }
    this.wheelSteer = [leftAngle, rightAngle, 0, 0];
    this.vehicle.setWheelSteering(0, leftAngle);
    this.vehicle.setWheelSteering(1, rightAngle);
  }

  // ----- Thrusters -----
  updateThrusters(input, dt, forward, up, velocity, weight) {
    const t = CONFIG.thrusters;
    const rocket = CONFIG.rocket;
    const body = this.body;
    const tel = this.telemetry;
    this.thrusting = false;
    this.lifting = false;
    this.landingBurn = false;
    let airUsed = 0; // kg this step
    let rearThrust = 0;
    let cornerThrust = 0;
    const wantsThrust = input.thrust && this.hasRearThrusters();
    const wantsLift = input.lift && this.hasCornerThrusters();
    this.tankEmptyPressed = (wantsThrust || wantsLift) && this.airKg <= 0;
    // Thrust drops a little as the tank pressure falls.
    let fill = 0;
    if (this.airCapacityKg > 0) {
      fill = this.airKg / this.airCapacityKg;
    }
    const pressureFactor = 1 - t.pressureFade * (1 - fill);

    // BOOST: the 4 rear ports push the car forward.
    if (wantsThrust && this.airKg > 0) {
      this.thrusting = true;
      rearThrust = t.rearForce * pressureFactor;
      body.addForce(scaled(forward, rearThrust), true);
      airUsed = airUsed + (rearThrust / t.exhaustSpeed) * dt;
      if (!this.usedThrustBefore) {
        this.usedThrustBefore = true;
        this.addEvent("first_thrust");
      }
    }

    // LIFT: the four corner thrusters push up. Tipping the phone forward (pitch -1) leans the push forward.
    if (wantsLift && this.airKg > 0) {
      this.lifting = true;
      const lean = THREE.MathUtils.degToRad(-input.pitch * rocket.maxTiltDeg);
      const direction = scaled(up, Math.cos(lean)).addScaledVector(forward, Math.sin(lean));
      cornerThrust = rocket.liftG * weight;
      body.addForce(scaled(direction, cornerThrust), true);
      airUsed = airUsed + (cornerThrust / t.exhaustSpeed) * dt;
    }

    // Soft landing: if we're falling too fast to stop before the ground, the corner thrusters
    // brake the fall. They start just in time, like a rocket landing.
    const fallSpeed = -velocity.y;
    const brakeAcceleration = (rocket.landingBurnG - 1) * GRAVITY;
    const brakeDistance = (fallSpeed * fallSpeed - rocket.touchdownSpeed * rocket.touchdownSpeed) / (2 * brakeAcceleration);
    const fallingFast = fallSpeed > rocket.touchdownSpeed && this.altitude < brakeDistance + 0.5;
    if (this.hasCornerThrusters() && rocket.autoLandingBurn && this.airborne && fallingFast &&
        !this.lifting && !this.rolling && up.y > 0.5 && this.airKg > 0) {
      this.landingBurn = true;
      cornerThrust = rocket.landingBurnG * weight;
      body.addForce({ x: 0, y: cornerThrust, z: 0 }, true);
      airUsed = airUsed + (cornerThrust / t.exhaustSpeed) * dt;
    }

    // ROLL: start a barrel roll when the button is first pressed.
    const rollPressed = input.roll !== 0 && this.lastRollInput === 0;
    this.lastRollInput = input.roll;
    if (rollPressed && this.hasCornerThrusters() && !this.rolling) {
      this.startRoll(input.roll);
    }
    if (this.rolling) {
      this.continueRoll(dt);
    }
    if (this.hopTime > 0) {
      this.hopTime = this.hopTime - dt;
    }

    // Take the air out of the tank, or refill it when the thrusters are quiet.
    if (airUsed > 0) {
      this.airKg = this.airKg - airUsed;
      this.refillTimer = t.refillDelay;
      if (this.airKg <= 0) {
        this.airKg = 0;
        this.addEvent("tank_empty");
      }
    } else if (wantsThrust || wantsLift) {
      // Holding a thruster button on an empty tank does nothing, and doesn't refill either.
    } else if (this.refillTimer > 0) {
      this.refillTimer = this.refillTimer - dt;
    } else {
      this.airKg = Math.min(this.airCapacityKg, this.airKg + (this.airCapacityKg / t.refillSeconds) * dt);
    }
    this.updateTankNumbers();
    this.updateMass();

    // Telemetry: rocket-science numbers.
    tel.airKg = this.airKg;
    tel.airCapacityKg = this.airCapacityKg;
    tel.pressureBar = t.tankPressureBar * fill;
    tel.massFlowKgS = airUsed / dt;
    tel.rearThrustN = rearThrust;
    tel.cornerThrustN = cornerThrust;
    tel.rollActive = this.rolling;
    tel.yawThrustN = Math.abs(this.yawThrust) * 3000;
    tel.boostSecondsLeft = this.airKg / (t.rearForce / t.exhaustSpeed);
    // Rocket equation: how much more speed the remaining air could give the car.
    tel.deltaVLeft = 0;
    if (this.airKg > 0) {
      tel.deltaVLeft = t.exhaustSpeed * Math.log(this.mass / (this.mass - this.airKg));
    }
  }

  // ----- Barrel roll -----
  // Like the reveal car, the roll is computer-controlled: the player just asks for it.
  // On the ground, the four corner thrusters first kick the car up so it has room to spin.

  startRoll(direction) {
    const rocket = CONFIG.rocket;
    let airNeeded = rocket.rollAirKg;
    if (!this.airborne) {
      airNeeded = airNeeded + rocket.hopAirKg;
    }
    if (this.airKg < airNeeded) {
      this.addEvent("tank_empty");
      return;
    }
    this.airKg = this.airKg - airNeeded;
    this.refillTimer = CONFIG.thrusters.refillDelay;

    if (!this.airborne) {
      const v = this.body.linvel();
      this.body.setLinvel({ x: v.x, y: Math.max(v.y, 0) + rocket.rollHopSpeed, z: v.z }, true);
      this.hopTime = 0.25;
    }
    this.rolling = true;
    this.rollDirection = direction;
    this.rollTurned = 0;
    this.rollTime = 0;
    this.addEvent("barrel_roll");
  }

  continueRoll(dt) {
    this.rollTime = this.rollTime + dt;
    // Give the hop a moment to lift the wheels off the ground before spinning.
    if (!this.airborne && this.rollTime < 0.15) {
      return;
    }
    // Spin around the car's own nose-to-tail line. A positive spin around "forward" lifts the
    // left side (+X), which is a roll to the RIGHT. Any other spin is cancelled so the roll is clean.
    const rate = (2 * Math.PI) / CONFIG.rocket.rollSeconds;
    const spin = this.getForward().multiplyScalar(rate * this.rollDirection);
    this.body.setAngvel(spin, true);
    this.rollTurned = this.rollTurned + rate * dt;

    // Stop after most of a full turn, as soon as the car is upright again.
    // (Starting upside down, e.g. off the curl ramp, that's 1.5 turns, which looks great.)
    const upright = this.getUp().y > 0.97;
    if ((this.rollTurned > Math.PI * 1.5 && upright) || this.rollTime > 3) {
      this.rolling = false;
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  // The air in the tank weighs up to 250 kg, so the car gets lighter as it's used.
  updateMass() {
    this.mass = CONFIG.car.dryMass + this.airKg;
    if (Math.abs(this.mass - this.appliedMass) < 2) {
      return;
    }
    const c = CONFIG.car;
    this.collider.setMassProperties(
      this.mass,
      { x: 0, y: c.centerOfMassY, z: c.centerOfMassZ },
      boxInertia(this.mass, c.halfWidth * 2, c.halfHeight * 2, c.halfLength * 2),
      { x: 0, y: 0, z: 0, w: 1 }
    );
    this.body.recomputeMassPropertiesFromColliders();
    this.appliedMass = this.mass;
  }

  updateTankNumbers() {
    const t = CONFIG.thrusters;
    this.tankLiters = this.airKg / t.airKgPerLiter;
    if (this.airCapacityKg > 0) {
      this.tank = (this.airKg / this.airCapacityKg) * 100;
    } else {
      this.tank = 0;
    }
  }

  // Call this AFTER world.step(). Reads where the car ended up and detects events.
  afterStep(dt) {
    const body = this.body;
    const tel = this.telemetry;

    // Airborne = no wheel touching anything.
    const wasAirborne = this.airborne;
    this.airborne = this.countWheelContacts() === 0;
    if (this.airborne) {
      this.airTime = this.airTime + dt;
    } else {
      if (wasAirborne && this.airTime > 0.4) {
        this.addEvent("landing");
        if (this.airTime > 1.2) {
          this.addEvent("big_jump");
        }
      }
      this.airTime = 0;
    }

    // Altitude: cast a ray straight down, ignoring the car itself.
    const position = body.translation();
    const ray = new this.RAPIER.Ray(position, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 500, true, undefined, undefined, undefined, body);
    if (hit) {
      this.altitude = Math.max(0, hit.timeOfImpact - REST_HEIGHT);
    } else {
      this.altitude = 0;
    }

    // G-forces, like an accelerometer in the car (it feels 1 g down just sitting still).
    const fullVelocity = toVector3(body.linvel());
    const acceleration = fullVelocity.clone().sub(this.lastFullVelocity).divideScalar(dt);
    this.lastFullVelocity.copy(fullVelocity);
    acceleration.y = acceleration.y + GRAVITY;
    const forward = this.getForward();
    const up = this.getUp();
    const right = new THREE.Vector3().crossVectors(forward, up);
    const smooth = 0.15; // accelerometers are noisy, so smooth them a bit
    tel.gLong = tel.gLong + (acceleration.dot(forward) / GRAVITY - tel.gLong) * smooth;
    tel.gLat = tel.gLat + (acceleration.dot(right) / GRAVITY - tel.gLat) * smooth;
    tel.gVert = tel.gVert + (acceleration.dot(up) / GRAVITY - tel.gVert) * smooth;
    tel.yawRateDeg = THREE.MathUtils.radToDeg(toVector3(body.angvel()).dot(up));
    tel.rollDeg = THREE.MathUtils.radToDeg(Math.asin(clamp(-right.y, -1, 1)));
    tel.pitchDeg = THREE.MathUtils.radToDeg(Math.asin(clamp(forward.y, -1, 1)));
    tel.altitude = this.altitude;
    tel.verticalSpeed = fullVelocity.y;

    // Crash: the sideways/forward speed changed a lot in one step (thrusters can't do that).
    // We ignore up/down speed, so a normal landing doesn't count as a crash.
    const flat = fullVelocity.clone();
    flat.y = 0;
    const change = flat.distanceTo(this.lastVelocity);
    this.lastVelocity.copy(flat);
    this.crashCooldown = this.crashCooldown - dt;
    if (change > 6 && this.crashCooldown <= 0) {
      this.addEvent("crash");
      this.crashCooldown = 1.0;
    }

    // Upside down for a while = tell the player to reset. Driving upside down on a ramp with the
    // fans on is allowed (wheels still touching), so only count it when no wheel is touching.
    if (up.y < 0.1 && this.countWheelContacts() === 0) {
      this.upsideDownTime = this.upsideDownTime + dt;
    } else {
      this.upsideDownTime = 0;
    }
    if (this.upsideDownTime > CONFIG.air.flipResetSeconds && !this.needsReset) {
      this.needsReset = true;
      this.addEvent("flip");
    }
    if (this.upsideDownTime === 0) {
      this.needsReset = false;
    }

    // Spin the wheels (for drawing).
    for (let i = 0; i < 4; i++) {
      this.wheelSpinAngle[i] = this.wheelSpinAngle[i] + this.wheelSpinSpeed[i] * dt;
      tel.wheels[i].rpm = (this.wheelSpinSpeed[i] * 60) / (2 * Math.PI);
    }

    this.savePose();
  }

  // Draw the car. alpha (0..1) says how far we are between the last two physics steps.
  updateVisuals(alpha, dt, time) {
    if (!this.model) {
      return;
    }
    const model = this.model;
    model.root.position.lerpVectors(this.prevPosition, this.currPosition, alpha);
    model.root.quaternion.slerpQuaternions(this.prevQuaternion, this.currQuaternion, alpha);

    // Wheels: move with the suspension, turn with the steering, and roll.
    const c = CONFIG.car;
    for (let i = 0; i < 4; i++) {
      let suspension = this.vehicle.wheelSuspensionLength(i);
      if (suspension === null) {
        suspension = c.suspensionRestLength;
      }
      const wheel = model.wheels[i];
      wheel.steer.position.set(this.wheelSpots[i].x, c.wheelY - suspension, this.wheelSpots[i].z);
      wheel.steer.rotation.y = this.wheelSteer[i];
      wheel.spin.rotation.x = this.wheelSpinAngle[i];
    }

    // Which of the four corner thrusters are firing (order: front-left, front-right, rear-left, rear-right).
    // A roll to the right pushes the LEFT side up, so the left pair fires.
    let cornerFiring = [false, false, false, false];
    if (this.lifting || this.landingBurn || this.hopTime > 0) {
      cornerFiring = [true, true, true, true];
    } else if (this.rolling && this.rollDirection > 0) {
      cornerFiring = [true, false, true, false];
    } else if (this.rolling) {
      cornerFiring = [false, true, false, true];
    }

    model.setFans(this.fanPower, time);
    model.setThrust(this.thrusting, time);
    model.setCornerThrusters(cornerFiring, time);
    model.setYawThrusters(this.yawThrust, time);
    model.setBraking(this.braking);
    model.setWing(this.wingDeploy);
    model.setYoke(this.steerInput);
    model.updateScreens(this, time);

    // Particles: thruster plumes and air rushing out from under the car.
    model.root.updateMatrixWorld();
    const carVelocity = toVector3(this.body.linvel());
    const forward = this.getForward();
    const up = this.getUp();
    // Cold gas makes a white vapor cloud, not a flame. The puffs shoot out, slow down
    // quickly, and hang in the air, so a trail is left behind the car.
    if (this.thrusting) {
      for (const nozzle of model.rearNozzles) {
        for (let n = 0; n < 3; n++) {
          const spot = model.root.localToWorld(nozzle.clone());
          const push = scaled(forward, -(9 + Math.random() * 7)).add(randomVector(4));
          this.plume.emit(spot, push.add(carVelocity), 0.6 + Math.random() * 0.4);
        }
      }
    }
    for (let i = 0; i < 4; i++) {
      if (!cornerFiring[i]) {
        continue;
      }
      for (let n = 0; n < 3; n++) {
        const spot = model.root.localToWorld(model.liftNozzles[i].clone());
        const push = scaled(up, -(8 + Math.random() * 5)).add(randomVector(4));
        this.plume.emit(spot, push.add(carVelocity), 0.6 + Math.random() * 0.4);
      }
    }
    if (this.yawThrust !== 0) {
      // Turning right pushes the nose right, so the thruster on the left of the nose fires outward.
      let index = 0;
      if (this.yawThrust < 0) {
        index = 1;
      }
      const nozzle = model.yawNozzles[index];
      const outward = new THREE.Vector3(Math.sign(nozzle.x), 0, 0).applyQuaternion(model.root.quaternion);
      for (let n = 0; n < 2; n++) {
        const spot = model.root.localToWorld(nozzle.clone());
        this.plume.emit(spot, scaled(outward, 8 + Math.random() * 4).add(carVelocity), 0.4);
      }
    }
    if (this.fanPower > 0.2 && !this.airborne) {
      for (let n = 0; n < 3; n++) {
        // Air shoots out sideways from under the car.
        let side = 1;
        if (Math.random() < 0.5) {
          side = -1;
        }
        const local = new THREE.Vector3(side * 1.0, -0.6, (Math.random() - 0.5) * 3.6);
        const spot = model.root.localToWorld(local);
        const sideways = new THREE.Vector3(side * 6, 0.5, 0).applyQuaternion(model.root.quaternion);
        this.fanAir.emit(spot, sideways.add(carVelocity).add(randomVector(1)), 0.25);
      }
    }
    this.plume.update(dt);
    this.fanAir.update(dt);
  }

  // Events since the last call (crash, landing, tank_empty, ...). Reading them clears the list.
  takeEvents() {
    const list = this.events;
    this.events = [];
    return list;
  }

  addEvent(name) {
    this.events.push(name);
    if (this.events.length > 10) {
      this.events.shift();
    }
  }

  // ----- Helpers -----

  // Rotate the car back toward level by adjusting its spin, like a gyroscope.
  // yawTarget: how fast to turn left/right, or null to keep turning as it already is.
  levelOut(yawTarget, dt) {
    const up = this.getUp();
    // Spinning around (up x worldUp) rotates "up" toward the sky.
    const correction = new THREE.Vector3().crossVectors(up, WORLD_UP).multiplyScalar(CONFIG.air.levelSpeed);
    const spin = toVector3(this.body.angvel());
    let yaw = spin.dot(WORLD_UP);
    if (yawTarget !== null) {
      yaw = yawTarget;
    }
    const target = correction.addScaledVector(WORLD_UP, yaw);
    const blend = 1 - Math.exp(-CONFIG.air.levelBlend * dt);
    spin.lerp(target, blend);
    this.body.setAngvel(spin, true);
  }

  countWheelContacts() {
    let count = 0;
    for (let i = 0; i < 4; i++) {
      if (this.vehicle.wheelIsInContact(i)) {
        count = count + 1;
      }
    }
    return count;
  }

  getForward() {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(this.getQuaternion());
  }

  getUp() {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.getQuaternion());
  }

  getQuaternion() {
    const r = this.body.rotation();
    return new THREE.Quaternion(r.x, r.y, r.z, r.w);
  }

  getPosition() {
    return toVector3(this.body.translation());
  }

  savePose() {
    this.prevPosition.copy(this.currPosition);
    this.prevQuaternion.copy(this.currQuaternion);
    this.currPosition.copy(toVector3(this.body.translation()));
    this.currQuaternion.copy(this.getQuaternion());
  }
}

// The "magic formula" tire curve (Pacejka): grip rises with slip angle, peaks around 7-8 degrees,
// then drops a little as the tire slides. Returns -1..1 (times the tire's maximum grip).
function magicFormula(slipAngle) {
  const c = CONFIG.car;
  const b = c.tireStiffness;
  const shape = c.tireShape;
  const e = c.tireCurvature;
  const x = b * slipAngle;
  return Math.sin(shape * Math.atan(x - e * (x - Math.atan(x))));
}

function makeTelemetry() {
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    wheels.push({ contact: false, load: 0, fx: 0, fy: 0, usage: 0, slipAngleDeg: 0, suspensionMm: 0, tempC: 32, rpm: 0, grass: false });
  }
  return {
    wheels: wheels,
    gLat: 0,
    gLong: 0,
    gVert: 1,
    speedKmh: 0,
    throttle: 0,
    brake: 0,
    steerDeg: 0,
    yawRateDeg: 0,
    rollDeg: 0,
    pitchDeg: 0,
    altitude: 0,
    verticalSpeed: 0,
    motorKW: 0,
    tractionControl: false,
    abs: false,
    esc: false,
    dragN: 0,
    aeroDownN: 0,
    wing: 0,
    fanDownN: 0,
    fanRpm: 0,
    fanKW: 0,
    suctionKPa: 0,
    massKg: 0,
    airKg: 0,
    airCapacityKg: 0,
    pressureBar: 0,
    massFlowKgS: 0,
    rearThrustN: 0,
    cornerThrustN: 0,
    yawThrustN: 0,
    rollActive: false,
    boostSecondsLeft: 0,
    deltaVLeft: 0,
  };
}

// The physics shape of the body: a box with the nose and tail raised underneath, like a real
// car's approach and departure angles, so it doesn't scrape on curved ramps.
function makeBodyShape(RAPIER) {
  const c = CONFIG.car;
  const w = c.halfWidth;
  const top = c.halfHeight;
  const bottom = -c.halfHeight;
  const front = c.halfLength;
  const back = -c.halfLength;
  const points = [];
  for (const x of [-w, w]) {
    points.push(x, top, front - 0.15, x, top, back + 0.15);
    points.push(x, 0.15, front, x, 0.15, back);
    points.push(x, -0.06, front, x, -0.1, back);
    points.push(x, bottom, 1.0, x, bottom, -1.0);
  }
  return RAPIER.ColliderDesc.convexHull(new Float32Array(points));
}

// Rotational inertia of a solid box. Rapier needs this because we set the mass by hand.
function boxInertia(mass, width, height, length) {
  return {
    x: (mass / 12) * (height * height + length * length),
    y: (mass / 12) * (width * width + length * length),
    z: (mass / 12) * (width * width + height * height),
  };
}

function toVector3(v) {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function scaled(v, amount) {
  return v.clone().multiplyScalar(amount);
}

function randomVector(size) {
  return new THREE.Vector3((Math.random() - 0.5) * size, (Math.random() - 0.5) * size, (Math.random() - 0.5) * size);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function moveToward(current, target, maxChange) {
  if (current < target) {
    return Math.min(target, current + maxChange);
  }
  return Math.max(target, current - maxChange);
}
