// config.js — Owner: shared (small edits only, merge often)
// Every tunable physics and gameplay number lives here, so we can tweak the feel quickly.
// Units: meters, kilograms, seconds, newtons, radians (unless the name says Deg or Kmh).
// Numbers marked "reveal" are Tesla's claims from the Oct 15, 2026 event (not verified).

export const CONFIG = {
  liveCoaching: {
    intervalSeconds: 8,
    minimumSpeedKmh: 15,
    minimumTurnSeconds: 0.8,
    exitSettleSeconds: 0.4,
    overlapThreshold: 0.3,
    maximumAgeMs: 5000,
  },
  analysis: {
    sampleRateHz: 10,
    logBatchSamples: 20,
    maximumBufferedSamples: 36000,
    maximumLapSamples: 18000,
    maximumSampleGapSeconds: 0.5,
    maximumTravelFactor: 2,
    positionToleranceMeters: 5,
    reverseToleranceMeters: 2,
    trackLimitToleranceMeters: 1,
    minimumLapSeconds: 5,
    cornerMinimumSpeedKmh: 20,
    cornerSteerDegrees: 3,
    cornerLateralG: 0.35,
    cornerMergeGapMeters: 20,
    cornerMinimumLengthMeters: 10,
    brakeLookbackMeters: 80,
    cornerExitMeters: 30,
    brakeThreshold: 0.1,
    throttleThreshold: 0.5,
    coldTireC: 45,
    hotTireC: 115,
    calloutCooldownSeconds: 30,
  },
  coachingLoop: {
    clockSkewMs: 5000,
    minimumAttempts: 2,
    maximumStepSeconds: 0.3,
    strongEvidenceAttempts: 3,
    minimumLossSeconds: 0.03,
    meaningfulChangeMeters: 1,
    meaningfulChangeSeconds: 0.02,
    rules: [
      { metric: "brakedEarlyMeters", minimumErrorMeters: 3, maximumStepMeters: 5 },
      { metric: "brakedEarlyMeters", direction: -1, minimumErrorMeters: 3, maximumStepMeters: 5 },
      { metric: "throttlePickupLateMeters", minimumErrorMeters: 3, maximumStepMeters: 5 },
    ],
  },
  memory: {
    queryTimeoutMs: 1500,
    connectionTimeoutMs: 3000,
    retryDelayMs: 5000,
    maxConcurrentRequests: 2,
    maxCorners: 32,
    summaryChars: 600,
    historyLimit: 5,
    adviceLimit: 3,
    browserTimeoutMs: 12000,
  },
  coach: {
    language: "en",
    intervalMs: 8000,
    requestTimeoutMs: 15000, // Allow the reasoning model to finish a conversational reply.
    maxHistory: 5,
    conversationTurns: 4,
    maxQuestionLength: 400,
    maxSummaryLength: 3000,
    maxResponseLength: 350,
    maxTokens: 1024, // reasoning models need room to produce the final short tip
    maxConcurrentRequests: 2,
    straightSteer: 0.15,
    straightThrottle: 0.4,
    stoppedSpeedKmh: 5,
    tipLifetimeMs: 15000,
    demoCueLifetimeMs: 3000,
    speechRate: 1.05,
    pushToTalkKey: "KeyV",
    handsFreeRestartMs: 750,
    handsFreeListenWindowMs: 3000,
    observationLifetimeMs: 30000,
    maximumObservations: 3,
    lowTankPercent: 15,
    cornerSpeedKmh: 70,
    cornerSteer: 0.5,
  },
  physics: {
    gravity: 9.81,
    timestep: 1 / 120, // physics runs at a fixed 120 steps per second (tire forces need small steps)
    maxStepsPerFrame: 8, // if the laptop lags, don't try to catch up forever
  },

  car: {
    // Mass without the compressed air. The air in the tank adds up to 250 kg (Rocket trim),
    // and the car gets lighter as the thrusters use it. Reports range from ~1,700 to ~2,350 kg.
    dryMass: 1650,
    // Physics box for the body (half sizes). The 3D model is drawn to roughly match.
    halfWidth: 0.95,
    halfHeight: 0.3,
    halfLength: 2.15,
    centerOfMassY: -0.25, // lower center of mass = harder to flip over
    centerOfMassZ: -0.12, // a little behind the middle: about 46% front / 54% rear weight

    // Wheels. Positions are relative to the center of the body.
    wheelRadius: 0.36,
    wheelX: 0.83,
    wheelY: -0.1,
    wheelFrontZ: 1.25,
    wheelRearZ: -1.25,
    suspensionRestLength: 0.3,
    suspensionStiffness: 50, // higher = stiffer (Rapier multiplies this by the car's mass); ~2.3 Hz ride.
    // Fan cars need stiff springs: 2 g of suction plus a fast curve can be 5 g on the springs.
    suspensionCompression: 2.0, // damping while compressing
    suspensionRelaxation: 2.5, // damping while extending
    maxSuspensionForce: 200000, // high, so the fans can push the car down hard
    bumpStopStart: 0.2, // meters of squash where the rubber bump stops start pushing back
    bumpStopStiffness: 3000000, // they push back harder and harder (force = stiffness x overlap^2)
    antiRollFront: 26000, // anti-roll bars (newtons per meter of left/right difference): less body roll
    antiRollRear: 18000, // a stiffer front bar than rear = a little understeer, which feels safe

    // Tires (a simplified "magic formula" tire, the model racing sims use).
    tireGrip: 1.25, // peak friction: about how many g the car can corner with (fans off)
    rearGripBias: 1.1, // wider rear tires grip more, so at the limit the car runs wide instead of spinning
    tireLoadSensitivity: 0.08, // tires grip a bit less per kg when pressed down harder (real tires do this)
    tireStiffness: 18, // how quickly grip builds with slip angle (peak at about 7-8 degrees)
    tireShape: 1.35, // how much grip is left once the tire is fully sliding (~85% of peak)
    tireCurvature: 0,
    tractionLimit: 0.92, // traction control and ABS keep wheels just below the limit, leaving room to steer
    stabilityControl: true, // ESC: stops the car from spinning out (set false for drifting)
    stabilityStrength: 6, // how quickly ESC pulls the car back in line

    // Powertrain: three motors, one front and two rear (an EV has no gears).
    motorPowerKW: 1000, // reveal: "over 1 MW"
    maxDriveForce: 28000, // newtons at low speed (the tires limit it anyway)
    frontDriveShare: 0.33, // one of the three motors drives the front wheels
    reverseForce: 4000,
    // Reveal top speeds per trim: Performance 210 mph, Thrust 230 mph, Rocket "over 230 mph".
    // (The thrusters can push the car past these for a moment.)
    topSpeedKmh: { performance: 338, thrust: 370, rocket: 375 },
    maxBrakeG: 1.4, // brake request; the tires limit it (ABS)
    brakeFrontShare: 0.62,
    regenG: 0.12, // lifting off the gas slows the car (regenerative braking, like a real Tesla)
    rollingResistance: 0.012,

    // Aerodynamics (reveal: "active aero", a wing that deploys)
    airDensity: 1.2,
    dragArea: 0.6, // drag coefficient x frontal area (m^2)
    downforceArea: 1.1, // downforce coefficient x area (m^2), with the wing up
    wingDragArea: 0.15, // the raised wing adds drag too
    aeroFrontShare: 0.45,
    wingDeployKmh: 90, // the rear wing rises above this speed...
    wingRetractKmh: 260, // ...and lies flat again above this, for less drag at top speed (unless braking)

    // Steering gets smaller at high speed so the car stays drivable.
    maxSteerAngle: 0.5, // at a standstill
    highSpeedSteerAngle: 0.1, // at highSpeedForSteerKmh
    highSpeedForSteerKmh: 200,
    steerSpeed: 5, // how fast the wheels turn toward the target angle

    spawnHeight: 1.0, // drop the car from a little above the spawn point
  },

  fans: {
    // Four underbody fans suck the car onto whatever it's driving on. Works even when stopped.
    // Reveal: "up to two g's", enough to drive upside down (2 g suction - 1 g gravity = 1 g left).
    downforceG: 2.0, // extra force toward the road, as a multiple of the car's weight
    extraGrip: 1.0, // grip multiplier on top of the extra downforce (1 = no extra)
    spinUpSeconds: 0.35, // fans take a moment to spin up and down
  },

  thrusters: {
    // Cold-gas thrusters fed by a compressed-air tank. Reveal: 10 thrusters on the Rocket trim:
    // 4 rear (push forward), 4 pointing down at the corners (lift/roll), 2 at the front (yaw).
    rearForce: 80000, // newtons from the 4 rear ports (reveal: "over 80 kN", about 4 g here)
    exhaustSpeed: 600, // m/s of gas leaving the nozzle: air used per second = force / exhaustSpeed
    tankLitersThrust: 200, // reveal: Thrust trim stores 200 L
    tankLitersRocket: 600, // reveal: Rocket trim adds 400 L more (it replaces the passenger seat)
    tankPressureBar: 380, // reveal photos: 5,500 psi
    airKgPerLiter: 0.415, // air at 380 bar: 600 L holds ~250 kg (reveal: "about 250 kg")
    pressureFade: 0.35, // thrust drops as the tank empties: at empty, thrust is 35% lower
    refillSeconds: 10, // empty to full. The real car needs hours; this is a game.
    refillDelay: 0.6, // wait this long after thrusting before refilling
  },

  rocket: {
    // Rocket trim only.
    // LIFT (hold): the 4 corner thrusters push up. Tilt the phone to lean the push forward/back.
    liftG: 1.35, // more than 1 so you rise; tap it to hover
    maxTiltDeg: 35, // how far the push can lean forward/back
    yawRate: 1.6, // front yaw thrusters: how fast you can turn while flying (radians per second)

    // ROLL (tap): the corner thrusters on one side fire, spinning the car around its long axis.
    // It's automatic like the reveal car: it hops if needed, rolls, and stops upright.
    rollSeconds: 0.85, // time for one 360-degree roll
    rollHopSpeed: 7.5, // upward kick when rolling from the ground (about a 3 m hop)
    rollAirKg: 20, // air used by one roll
    hopAirKg: 16, // air used by the hop

    // Soft landing: when falling fast near the ground, the down thrusters fire on their own
    // (reveal: the car "eased itself to a landing").
    autoLandingBurn: true,
    landingBurnG: 2.5, // push of the burn, as a multiple of the car's weight
    touchdownSpeed: 3, // the burn aims to touch down at about this speed (m/s)
  },

  surfaces: {
    grassGrip: 0.55, // grip multiplier off the track on grass (fans still help)
    gravelGrip: 0.45, // grip multiplier in a gravel trap
    gravelDrag: 0.5, // gravel digs into the tires: a drag force of this times the weight on each wheel (~0.5 g)
  },

  air: {
    // Help the car land the right way up.
    landingAssistHeight: 4.0, // start leveling the car when this close to the ground
    levelSpeed: 3.0, // how strongly the car rotates back to level
    levelBlend: 4.0, // how quickly that correction takes over
    flipResetSeconds: 1.5, // upside down this long = show "press R"
  },

  camera: {
    defaultView: "chase",
    overheadDistance: 14,
    overheadHeight: 38,
    chaseDistance: 7.5,
    chaseHeight: 2.6,
    chaseLookAhead: 3.0,
    chaseSmoothing: 6.0, // higher = camera sticks closer to the car
    baseFov: 62,
    fastFov: 78, // the camera widens with speed to feel faster
    fastFovKmh: 220,
    shakeOnThrust: 0.06,
  },

  phone: {
    sendRateHz: 30, // how often the phone sends its controls
    timeoutMs: 600, // no phone message for this long = phone disconnected
    steerMaxDeg: 30, // tilting the phone's long edge this far from level = full steering
    steerDeadZoneDeg: 3, // small wobbles near center are ignored
    steerSmoothing: 0.35, // 0..1, lower = smoother but slower
    rollTiltDeg: 45, // deliberate airborne tilt beyond ordinary steering
    rollRearmDeg: 12, // return near center before the next flip
    rollPulseMs: 150, // several phone packets, one rising edge at the car
    rollCooldownMs: 1200, // longer than the automatic roll
    pitchMaxDeg: 25, // tilting the phone this far forward/back = full pitch
    invertSteer: false, // flip this if steering goes the wrong way on some phone
  },

  network: {
    stateRateHz: 5, // how often the game tells the phone its speed, tank, etc.
  },
};
