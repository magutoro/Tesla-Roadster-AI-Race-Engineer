// sound.js — Owner: shared
// All sound is generated live with the Web Audio API (no sound files), driven by the car's state:
//   motor   - an electric hum and inverter whine that rise with speed and power
//   wind    - rushing air that grows with speed
//   tires   - squeal when the tires are near their grip limit (from the tire model)
//   fans    - a turbine whine that spins up and down
//   thrust  - the cold-gas roar of the rear ports, and the hiss of the corner thrusters
//   one-shots: crash, landing thump, barrel-roll whoosh, goal chime
// Browsers only allow sound after a click or key press, so call start() from one.

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
  }

  // Build the sound graph. Must be called from a click or key press.
  start() {
    if (this.ready) {
      if (this.ctx.state === "suspended") {
        this.ctx.resume();
      }
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }
    const ctx = new AudioContextClass();
    this.ctx = ctx;
    this.noise = makeNoiseBuffer(ctx);

    // Everything goes through a master volume and a compressor (so loud moments don't clip).
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    const compressor = ctx.createDynamicsCompressor();
    this.master.connect(compressor);
    compressor.connect(ctx.destination);

    // Motor: two detuned tones through a low-pass filter, plus a high inverter whine.
    this.motorGain = this.makeGain(0);
    this.motorFilter = ctx.createBiquadFilter();
    this.motorFilter.type = "lowpass";
    this.motorFilter.frequency.value = 900;
    this.motorFilter.connect(this.motorGain);
    this.motorA = this.makeOscillator("sawtooth", 60, this.motorFilter);
    this.motorB = this.makeOscillator("square", 61, this.motorFilter);
    this.whineGain = this.makeGain(0);
    this.whine = this.makeOscillator("sine", 800, this.whineGain);

    // Wind and road noise.
    this.windGain = this.makeGain(0);
    this.windFilter = this.makeFilter("lowpass", 500, 0.7, this.windGain);
    this.makeNoise(this.windFilter);

    // Tire squeal: narrow band of noise around 1.1 kHz.
    this.squealGain = this.makeGain(0);
    this.makeNoise(this.makeFilter("bandpass", 1150, 9, this.squealGain));

    // Fans: whooshy band of noise plus a blade tone that rises as they spin up.
    this.fanGain = this.makeGain(0);
    this.makeNoise(this.makeFilter("bandpass", 2600, 1.5, this.fanGain));
    this.fanToneGain = this.makeGain(0);
    this.fanTone = this.makeOscillator("triangle", 200, this.fanToneGain);

    // Rear thrusters: a deep roar. Corner thrusters: a lighter hiss.
    this.thrustGain = this.makeGain(0);
    this.thrustFilter = this.makeFilter("lowpass", 1600, 0.8, this.thrustGain);
    this.makeNoise(this.thrustFilter);
    this.liftGain = this.makeGain(0);
    this.makeNoise(this.makeFilter("bandpass", 900, 0.9, this.liftGain));

    this.ready = true;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ready) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  // Call every frame.
  update(car) {
    if (!this.ready) {
      return;
    }
    const now = this.ctx.currentTime;
    const tel = car.telemetry;
    const speed = car.speedKmh;
    const power = Math.min(1, Math.abs(tel.motorKW) / 600);

    // Motor hum: pitch follows speed (an EV's motor speed is tied to wheel speed).
    const motorPitch = 45 + speed * 1.4;
    this.motorA.frequency.setTargetAtTime(motorPitch, now, 0.05);
    this.motorB.frequency.setTargetAtTime(motorPitch * 1.5 + 1, now, 0.05);
    this.motorFilter.frequency.setTargetAtTime(500 + speed * 6 + power * 1500, now, 0.05);
    this.motorGain.gain.setTargetAtTime(0.02 + power * 0.1, now, 0.05);
    this.whine.frequency.setTargetAtTime(700 + speed * 22, now, 0.05);
    this.whineGain.gain.setTargetAtTime(Math.min(0.03, speed / 6000) + power * 0.02, now, 0.05);

    // Wind: grows with the square of speed, like real drag.
    const windAmount = Math.min(1, (speed / 300) * (speed / 300));
    this.windGain.gain.setTargetAtTime(windAmount * 0.45, now, 0.1);
    this.windFilter.frequency.setTargetAtTime(300 + speed * 7, now, 0.1);

    // Tires: squeal once a tire is using more than 85% of its grip.
    let squeal = 0;
    for (const wheel of tel.wheels) {
      if (wheel.contact && speed > 12) {
        squeal = Math.max(squeal, (wheel.usage - 0.85) * 4);
      }
    }
    this.squealGain.gain.setTargetAtTime(Math.min(0.22, Math.max(0, squeal) * 0.22), now, 0.04);

    // Fans: pitch rises as they spin up.
    this.fanGain.gain.setTargetAtTime(car.fanPower * 0.16, now, 0.08);
    this.fanTone.frequency.setTargetAtTime(150 + car.fanPower * 950, now, 0.1);
    this.fanToneGain.gain.setTargetAtTime(car.fanPower * 0.03, now, 0.08);

    // Thrusters.
    let roar = 0;
    if (car.thrusting) {
      roar = 0.55;
    }
    this.thrustGain.gain.setTargetAtTime(roar, now, 0.03);
    let hiss = 0;
    if (car.lifting || car.landingBurn || car.rolling || car.hopTime > 0) {
      hiss = 0.35;
    } else if (car.yawThrust !== 0) {
      hiss = 0.12;
    }
    this.liftGain.gain.setTargetAtTime(hiss, now, 0.03);
  }

  // Short sounds for events.
  play(name) {
    if (!this.ready || this.muted) {
      return;
    }
    if (name === "crash") {
      this.burst(0.5, 400, 0.6);
      this.thump(70, 0.5, 0.35);
    } else if (name === "landing") {
      this.thump(55, 0.45, 0.3);
    } else if (name === "barrel_roll") {
      this.sweep(300, 2400, 0.7, 0.25);
    } else if (name === "goal") {
      this.beep(880, 0.15, 0.12);
      this.beep(1320, 0.25, 0.12, 0.15);
    } else if (name === "fail") {
      this.beep(330, 0.3, 0.12);
      this.beep(220, 0.4, 0.12, 0.25);
    } else if (name === "click") {
      this.beep(1200, 0.05, 0.05);
    }
  }

  // ---------- Building blocks ----------

  makeGain(value) {
    const gain = this.ctx.createGain();
    gain.gain.value = value;
    gain.connect(this.master);
    return gain;
  }

  makeFilter(type, frequency, q, destination) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    filter.connect(destination);
    return filter;
  }

  makeOscillator(type, frequency, destination) {
    const oscillator = this.ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    oscillator.connect(destination);
    oscillator.start();
    return oscillator;
  }

  makeNoise(destination) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.connect(destination);
    source.start();
    return source;
  }

  burst(duration, frequency, volume) {
    const now = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.connect(this.master);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    const filter = this.makeFilter("lowpass", frequency, 0.7, gain);
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.connect(filter);
    source.start(now);
    source.stop(now + duration);
  }

  thump(frequency, duration, volume) {
    const now = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.connect(this.master);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    const oscillator = this.ctx.createOscillator();
    oscillator.frequency.setValueAtTime(frequency * 2, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency, now + 0.15);
    oscillator.connect(gain);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  sweep(from, to, duration, volume) {
    const now = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.connect(this.master);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + duration * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    const filter = this.makeFilter("bandpass", from, 2, gain);
    filter.frequency.setValueAtTime(from, now);
    filter.frequency.exponentialRampToValueAtTime(to, now + duration);
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.connect(filter);
    source.start(now);
    source.stop(now + duration);
  }

  beep(frequency, duration, volume, delay) {
    const start = this.ctx.currentTime + (delay || 0);
    const gain = this.ctx.createGain();
    gain.connect(this.master);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    const oscillator = this.ctx.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }
}

// Two seconds of random noise, looped for wind, tires, fans and thrusters.
function makeNoiseBuffer(ctx) {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}
