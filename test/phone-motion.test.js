import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { PhoneRollGesture } from "../public/shared/phone-roll.js";
import { CONFIG } from "../public/config.js";
import { MSG, DRIVE_MODES, makeInput } from "../public/shared/protocol.js";

// Exercise the phone's real sensor/status handlers with a small DOM substitute.
function controller(secure) {
  const elements = new Map();
  const document = {
    addEventListener: function () {},
    getElementById: function (id) {
      if (!elements.has(id)) elements.set(id, {
        textContent: "", style: {}, lastChild: { textContent: "" },
        clientWidth: 200,
        blur: function () {},
        setAttribute: function () {},
        addEventListener: function () {},
        classList: { add: function () {}, remove: function () {}, toggle: function () {} },
      });
      return elements.get(id);
    },
  };
  const context = vm.createContext({
    document: document, window: { isSecureContext: secure, orientation: 90, innerWidth: 800, innerHeight: 400, addEventListener: function () {} },
    performance:{now:()=>1000},PhoneRollGesture:PhoneRollGesture, CONFIG: CONFIG, MSG: MSG, DRIVE_MODES: DRIVE_MODES, makeInput: makeInput,
  });
  const source = readFileSync(new URL("../public/phone.js", import.meta.url), "utf8");
  vm.runInContext(source.replace(/^import .*;$/gm, ""), context);
  return { elements: elements, run: function (code) { return vm.runInContext(code, context); } };
}

test("HTTP phone controller keeps the HTTPS cause visible after Start is hidden", function () {
  const phone = controller(false);
  phone.elements.get("startScreen").style.display = "none";
  phone.run("checkTiltIsWorking()");
  assert.match(phone.elements.get("tilt").textContent, /HTTPS required/);
  assert.match(phone.elements.get("tiltHelp").textContent, /game's QR code/);
});

test("secure controller distinguishes missing permission from arriving sensor readings", function () {
  const phone = controller(true);
  phone.run("checkTiltIsWorking()");
  assert.match(phone.elements.get("tiltHelp").textContent, /Allow motion access/);
  phone.run("for (let i = 0; i < 10; i++) onOrientation({beta: 20, gamma: 0}); checkTiltIsWorking()");
  assert.match(phone.elements.get("tilt").textContent, /tilt OK/);
  assert.equal(phone.elements.get("tiltHelp").style.display, "none");
  assert.notEqual(phone.run("input.steer"), 0);
});

test("portrait rotation lock still permits steering both ways with a sideways grip", function () {
  const phone = controller(true);
  phone.run("window.orientation = 0; window.innerWidth = 400; window.innerHeight = 800; onOrientation({beta: 0, gamma: -60}); calibrate()");
  phone.run("for (let i = 0; i < 20; i++) onOrientation({beta: 25, gamma: -60})");
  const right = phone.run("input.steer");
  assert.ok(right > 0.7, "right tilt must steer right while the display stays portrait");
  phone.run("for (let i = 0; i < 20; i++) onOrientation({beta: -25, gamma: -60})");
  assert.ok(phone.run("input.steer") < -0.7, "left tilt must steer left");
});

test("locked portrait and native landscape produce equivalent steering", function () {
  const landscape = controller(true);
  const locked = controller(true);
  locked.run("window.orientation = 0; window.innerWidth = 400; window.innerHeight = 800");
  for (const phone of [landscape, locked]) {
    phone.run("onOrientation({beta: 0, gamma: -60}); calibrate(); for (let i = 0; i < 10; i++) onOrientation({beta: 20, gamma: -60})");
  }
  assert.ok(Math.abs(landscape.run("input.steer") - locked.run("input.steer")) < 0.001);
});

test("flipped sideways grip preserves steering direction and drag follows the rotated yoke", function () {
  const phone = controller(true);
  phone.run("window.orientation = 0; window.innerWidth = 400; window.innerHeight = 800; layoutFlipped = true; onOrientation({beta: 0, gamma: 60}); calibrate(); for (let i = 0; i < 20; i++) onOrientation({beta: -25, gamma: 60})");
  assert.ok(phone.run("input.steer") > 0.7);
  const down = phone.run("pointerAcrossYoke({clientX: 100, clientY: 200})");
  const up = phone.run("pointerAcrossYoke({clientX: 100, clientY: 100})");
  assert.ok(up > down, "dragging up is controller-right in the flipped layout");
});

test("a toolbar resize does not silently recenter a turn", function () {
  const phone = controller(true);
  phone.run("onOrientation({beta: 0, gamma: -60}); calibrate(); for (let i = 0; i < 10; i++) onOrientation({beta: 20, gamma: -60})");
  const before = phone.run("input.steer");
  phone.run("window.innerHeight = 390; recenterControlFrame()");
  assert.equal(phone.run("input.steer"), before);
});

test("real orientation events send a single airborne roll through the existing phone protocol",function(){
  const phone=controller(true);
  phone.run(`var WebSocket={OPEN:1}; var sent=[]; socket={readyState:1,send(message){sent.push(JSON.parse(message));}};
    onOrientation({beta:0,gamma:-60});calibrate();
    handleMessage({type:MSG.STATE,mode:'rocket',fansOn:false,tankPercent:100,airborne:false,speedKmh:50,events:[],stunt:{upY:1,rolling:false}});
    onOrientation({beta:50,gamma:-60});sendInput();`);
  assert.equal(phone.run('sent.at(-1).roll'),0,'road steering stays steering');
  phone.run(`handleMessage({type:MSG.STATE,mode:'rocket',fansOn:false,tankPercent:100,airborne:true,speedKmh:50,events:[],stunt:{upY:1,rolling:false}});
    sendInput();`);
  assert.equal(phone.run('sent.at(-1).roll'),0,'takeoff does not turn a held steering angle into a roll');
  phone.run('onOrientation({beta:0,gamma:-60});sendInput();onOrientation({beta:50,gamma:-60});sendInput();');
  assert.equal(phone.run('sent.at(-1).roll'),1);
  assert.equal(phone.run('sent.at(-1).steer'),0,'a roll gesture must not also yaw sideways');
  phone.run('performance.now=()=>1800;sendInput();');
  assert.equal(phone.run('sent.at(-1).roll'),0,'stale sensors/game state cannot keep firing rolls');
});

test("curl inversion allows tilt rolls before leaving the surface; other trims do not",function(){
  const phone=controller(true);
  phone.run(`var WebSocket={OPEN:1}; var sent=[]; socket={readyState:1,send(message){sent.push(JSON.parse(message));}};
    onOrientation({beta:0,gamma:-60});calibrate();
    handleMessage({type:MSG.STATE,mode:'rocket',fansOn:true,tankPercent:100,airborne:false,speedKmh:10,events:[],stunt:{upY:-1,rolling:false}});
    sendInput();onOrientation({beta:-50,gamma:-60});sendInput();`);
  assert.equal(phone.run('sent.at(-1).roll'),-1);
  phone.run(`handleMessage({type:MSG.STATE,mode:'performance',fansOn:true,tankPercent:100,airborne:true,speedKmh:10,events:[],stunt:{upY:1,rolling:false}});sendInput();`);
  assert.equal(phone.run('sent.at(-1).roll'),0);
});
