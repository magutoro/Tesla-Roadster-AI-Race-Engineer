// protocol.js — Owner: shared. AGREE WITH YOUR TEAMMATE BEFORE CHANGING THIS FILE.
// The message formats that the phone, server, game and coach send each other.
// Every message is a JSON object with a "type" field.

export const MSG = {
  HELLO: "hello", // anyone -> server, first message: { type, role: "phone" | "game" }
  STATUS: "status", // server -> everyone: { type, phones, games } (how many are connected)
  INPUT: "input", // phone -> game, about 30 times per second (see makeInput)
  MODE: "mode", // phone -> game: { type, mode } (one of DRIVE_MODES)
  STATE: "state", // game -> phone and coach (see makeState)
  TIP: "tip", // server -> game: { type, text, lang } (AI coach, later)
};

// The three trims from the reveal.
// performance = fans only, thrust = fans + rear thrusters, rocket = adds upward thrusters.
export const DRIVE_MODES = ["performance", "thrust", "rocket"];

// Controller input.
// steer: -1 = full left, +1 = full right.
// thrust: rear thrusters (held). lift: downward thrusters (held, Rocket mode).
// roll: barrel roll request: -1 = roll left, +1 = roll right, 0 = none (Rocket mode).
// pitch: -1 = phone tipped forward (lean the lift forward), +1 = tipped back.
export function makeInput() {
  return {
    type: MSG.INPUT,
    steer: 0,
    gas: 0,
    brake: 0,
    fans: false,
    thrust: false,
    lift: false,
    roll: 0,
    pitch: 0,
    reset: false,
  };
}

// Inputs arrive over the network, so check every field.
// A bad message should never be able to break the physics.
export function cleanInput(raw) {
  const input = makeInput();
  input.steer = clampNumber(raw.steer, -1, 1);
  input.gas = clampNumber(raw.gas, 0, 1);
  input.brake = clampNumber(raw.brake, 0, 1);
  input.pitch = clampNumber(raw.pitch, -1, 1);
  input.fans = raw.fans === true;
  input.thrust = raw.thrust === true;
  input.lift = raw.lift === true;
  input.roll = Math.round(clampNumber(raw.roll, -1, 1));
  input.reset = raw.reset === true;
  return input;
}

// Car state, sent by the game.
// events is a list of short names like "crash", "landing", "tank_empty", "first_thrust",
// "barrel_roll", "big_jump", "flip", "goal_reached".
export function makeState() {
  return {
    type: MSG.STATE,
    speedKmh: 0,
    steer: 0,
    fansOn: false,
    tankPercent: 100,
    mode: "thrust",
    airborne: false,
    altitude: 0,
    events: [],
    goalText: "",
  };
}

// A sample car state, so the coach can be tested without the game running.
export const SAMPLE_STATE = {
  type: MSG.STATE,
  speedKmh: 96,
  steer: 0.8,
  fansOn: false,
  tankPercent: 40,
  mode: "thrust",
  airborne: false,
  altitude: 0,
  events: ["turn_too_fast"],
  goalText: "Reach the green zone",
};

// A fake coach tip, so the game can be tested without the AI.
export const FAKE_TIP = {
  type: MSG.TIP,
  text: "Fans on before that corner. They give grip even at low speed.",
  lang: "en",
};

// Turn incoming text into a message object, or null if it isn't valid.
export function parseMessage(text) {
  try {
    const msg = JSON.parse(text);
    if (msg && typeof msg.type === "string") {
      return msg;
    }
  } catch (err) {
    // Not JSON. Ignore it.
  }
  return null;
}

// The WebSocket address for whatever host this page was loaded from.
// This way the same code works on localhost and through the HTTPS tunnel.
export function socketUrl() {
  let protocol = "ws:";
  if (location.protocol === "https:") {
    protocol = "wss:";
  }
  return protocol + "//" + location.host + "/ws";
}

function clampNumber(value, min, max) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.min(max, Math.max(min, value));
}
