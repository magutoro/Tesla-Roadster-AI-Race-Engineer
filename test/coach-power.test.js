import test from "node:test";
import assert from "node:assert/strict";
import { RaceEngineer } from "../public/coach.js";
import { SAMPLE_STATE } from "../public/shared/protocol.js";
import { installCoachRoutes, cleanCoachRequest, getCoachTip } from "../server/ai.js";
import { EngineerVoice } from "../public/voice.js";

class Element {
  constructor() { this.value = ""; this.dataset = {}; this.fields = new Map(); this.children = []; }
  querySelector(selector) {
    if (!this.fields.has(selector)) this.fields.set(selector, new Element());
    return this.fields.get(selector);
  }
  setAttribute() {}
  addEventListener() {}
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  blur() {}
}

test("engineer defaults off, requires explicit automatic tips, and ignores late replies after off", async function () {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let resolveRequest;
  let signal;
  globalThis.document = { createElement: function () { return new Element(); }, body: { appendChild: function () {} } };
  globalThis.window = { addEventListener: function () {}, speechSynthesis: { cancel: function () {}, getVoices: function () { return []; } } };
  globalThis.fetch = function (url, options) {
    calls++;
    signal = options.signal;
    assert.equal(JSON.parse(options.body).enabled, true);
    return new Promise(function (resolve) { resolveRequest = resolve; });
  };
  try {
    const engineer = new RaceEngineer({continuous:false});
    for (let i = 0; i < 30; i++) engineer.update(SAMPLE_STATE, 1, false);
    engineer.ask("Test question");
    await engineer.request();
    assert.equal(calls, 0);
    assert.equal(engineer.talk.disabled, true);
    engineer.setPower(true);
    engineer.update(SAMPLE_STATE, 1, false);
    assert.equal(calls, 0, "power on alone must not start recurring requests");
    engineer.autoTips.checked = true;
    engineer.update(SAMPLE_STATE, 1, false);
    await new Promise(setImmediate);
    assert.equal(calls, 1);
    engineer.setPower(false);
    assert.equal(signal.aborted, true);
    resolveRequest({ ok: true, json: async function () { return { text: "Stale paid reply", source: "ai" }; } });
    await new Promise(setImmediate);
    for (let i = 0; i < 30; i++) engineer.update(SAMPLE_STATE, 1, false);
    engineer.startConversation();
    assert.equal(calls, 1);
    assert.equal(engineer.tip.textContent, "Engineer is off.");
    assert.equal(engineer.voice.enabled, false);
    assert.equal(engineer.autoTips.checked, false);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.window;
    delete globalThis.document;
  }
});

test("server blocks old clients lacking explicit engineer opt-in", async function () {
  let handler;
  installCoachRoutes({ post: function (path, callback) { handler = callback; } });
  let status;
  let body;
  const res = { status: function (value) { status = value; return this; }, json: function (value) { body = value; } };
  await handler({ body: SAMPLE_STATE }, res);
  assert.equal(status, 403);
  assert.equal(body.error, "engineer_disabled");
});

test("disconnect cancellation reaches an in-flight provider request", async function () {
  const controller = new AbortController();
  const pending = getCoachTip(cleanCoachRequest(SAMPLE_STATE), {
    env: { AI_BASE_URL: "https://example.invalid", AI_API_KEY: "test", AI_MODEL: "test" },
    signal: controller.signal,
    fetch: function (url, options) {
      return new Promise(function (resolve, reject) {
        options.signal.addEventListener("abort", function () { reject(new Error("cancelled")); });
      });
    },
  });
  controller.abort();
  assert.equal((await pending).reason, "cancelled");
});

test("free voice preview uses the selected installed voice without calling an API", function () {
  const installed = { voiceURI: "mac-test", name: "Example enhanced voice", lang: "en-US" };
  let spoken;
  globalThis.window = { speechSynthesis: { cancel: function () {}, getVoices: function () { return [installed]; }, speak: function (speech) { spoken = speech; } } };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  try {
    const voice = new EngineerVoice(function () {}, function () {});
    voice.voiceName = installed.voiceURI;
    voice.preview("en");
    assert.equal(voice.enabled, false);
    assert.equal(spoken.voice, installed);
    assert.match(spoken.text, /Radio check/);
    voice.clear();
    assert.equal(voice.current, null);
  } finally {
    delete globalThis.window;
    delete globalThis.SpeechSynthesisUtterance;
  }
});

test("a measured cue is acknowledged only while visible and enabled; power off aborts the acknowledgment", async function () {
  const originalFetch = globalThis.fetch;
  let calls = 0, signal, finish;
  globalThis.document = { hidden: true, createElement: function () { return new Element(); }, body: { appendChild: function () {} } };
  globalThis.window = { addEventListener: function () {}, speechSynthesis: { cancel: function () {}, getVoices: function () { return []; } } };
  globalThis.fetch = function (url, options) {
    calls++;
    assert.equal(url, "/api/memory/focus/ack");
    assert.equal(JSON.parse(options.body).enabled, true);
    signal = options.signal;
    return new Promise(function (resolve) { finish = resolve; });
  };
  try {
    const engineer = new RaceEngineer({continuous:false});
    const focus = { id: "proposed-focus", status: "proposed", corner: "T4", metric: "brakedEarlyMeters", actionMeters: 2,
      evidenceLapIds: ["lap-1", "lap-2"], confidence: "moderate", meanLossSeconds: 0.2 };
    engineer.showCoaching({ focus });
    assert.equal(calls, 0);
    engineer.setPower(true);
    engineer.showCoaching({ focus });
    assert.equal(calls, 0, "a background document cannot mark the cue shown");
    document.hidden = false;
    engineer.showCoaching({ focus });
    assert.equal(calls, 1);
    assert.match(engineer.focusAction.textContent, /2 m later/);
    assert.equal(engineer.coachingPanel.hidden, false);
    engineer.setPower(false);
    assert.equal(signal.aborted, true);
    assert.equal(engineer.coachingPanel.hidden, true);
    finish({ ok: true, json: async function () { return { status: "connected", data: { acknowledged: true } }; } });
    await engineer.pendingAcknowledgment;
    assert.equal(engineer.memoryControllers.size, 0);
    assert.equal(engineer.enabled, false);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.document;
    delete globalThis.window;
  }
});

test("asking to practice a skill checks evidence then requests one AI explanation without enabling recurring AI", async function () {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.document = { hidden: false, createElement: function () { return new Element(); }, body: { appendChild: function () {} } };
  globalThis.window = { addEventListener: function () {}, speechSynthesis: { cancel: function () {}, getVoices: function () { return []; } } };
  globalThis.fetch = async function (url, options) {
    calls.push({ url, body: JSON.parse(options.body) });
    if(url==="/api/coach") return {ok:true,json:async function(){return {source:"ai",text:"Let's test one smooth entry and compare your exit.",latencyMs:10};}};
    return { ok: true, json: async function () { return { status: "not_configured", data: {
      focus: null, outcome: null, practice: { label: "Corner speed · T4", evidence: [], text: "Need two comparable measured laps." }
    } }; } };
  };
  try {
    const engineer = new RaceEngineer({continuous:false});
    engineer.ask("I want to work on corner speed at T4");
    assert.equal(calls.length, 0);
    engineer.setPower(true);
    engineer.ask("I want to work on corner speed at T4");
    await new Promise(setImmediate);
    assert.deepEqual(engineer.practiceGoal, { type: "corner_speed", corner: "T4" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/memory/focus");
    assert.equal(calls[0].body.practiceGoal.corner, "T4");
    assert.equal(engineer.autoTips.checked, false);
    assert.match(engineer.tip.textContent, /two comparable/);
    engineer.update(SAMPLE_STATE,1,false);
    await new Promise(setImmediate);
    assert.equal(calls.length,2);
    assert.equal(calls[1].url,"/api/coach");
    assert.equal(calls[1].body.question,"I want to work on corner speed at T4");
    assert.equal(engineer.autoTips.checked,false);
    assert.match(engineer.tip.textContent,/smooth entry/);
    engineer.setPower(false);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.document;
    delete globalThis.window;
  }
});

test("changing the practice goal preserves in-flight measured laps and waits for them before planning", async function () {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let finishLap, lapSignal;
  globalThis.document = { hidden: false, createElement: function () { return new Element(); }, body: { appendChild: function () {} } };
  globalThis.window = { addEventListener: function () {}, speechSynthesis: { cancel: function () {}, getVoices: function () { return []; } } };
  globalThis.fetch = function (url, options) {
    calls.push(url);
    if (url === "/api/memory/laps") {
      lapSignal = options.signal;
      return new Promise(function (resolve) { finishLap = resolve; });
    }
    return Promise.resolve({ ok: true, json: async function () { return { status: "connected", data: {
      focus: null, outcome: null, practice: { label: "Corner speed", evidence: [], text: "Measured plan" }
    } }; } });
  };
  try {
    const engineer = new RaceEngineer({continuous:false});
    engineer.setPower(true);
    engineer.addLapSummary({ id: "lap-1", summary: "Measured lap", corners: [] });
    await new Promise(setImmediate);
    engineer.ask("I want to work on corner speed");
    assert.equal(lapSignal.aborted, false);
    assert.deepEqual(calls, ["/api/memory/laps"]);
    finishLap({ ok: true, json: async function () { return { status: "connected", data: { stored: true } }; } });
    await new Promise(setImmediate);
    assert.deepEqual(calls, ["/api/memory/laps", "/api/memory/focus"]);
    assert.equal(engineer.tip.textContent, "Measured plan");
    engineer.setPower(false);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.document;
    delete globalThis.window;
  }
});

test("a captured spoken question is acknowledged before its data-backed answer", async function () {
  const originalFetch=globalThis.fetch,spoken=[];let recognition,requestBody;
  class Recognition {constructor(){recognition=this;}start(){}stop(){}abort(){}}
  globalThis.document={createElement:function(){return new Element();},body:{appendChild:function(){}}};
  globalThis.window={SpeechRecognition:Recognition,addEventListener:function(){},speechSynthesis:{cancel:function(){},getVoices:function(){return [];},speak:function(s){spoken.push(s);}}};
  globalThis.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
  globalThis.fetch=async function(url,options){requestBody=JSON.parse(options.body);return {ok:true,json:async function(){return {text:"I can see speed and steering, but no clean lap comparison yet.",source:"ai",latencyMs:20};}};};
  try {
    const engineer=new RaceEngineer({continuous:false});engineer.setPower(true);
    const stopped={...SAMPLE_STATE,speedKmh:0,steer:0,events:[]};engineer.update(stopped,0,false);
    engineer.startConversation();
    const result=[{transcript:"What data can you see?"}];result.isFinal=true;
    recognition.onresult({resultIndex:0,results:[result]});recognition.onend();
    assert.match(engineer.questionText.textContent,/What data can you see/);
    assert.ok(engineer.voice.acknowledgment);
    engineer.update(stopped,0,false);assert.match(spoken[0].text,/Copy/);
    await new Promise(setImmediate);
    assert.equal(requestBody.question,"What data can you see?");assert.equal(requestBody.memory.enabled,true);
    assert.match(engineer.tip.textContent,/no clean lap comparison/);
    spoken[0].onend();engineer.update(stopped,0,false);
    assert.match(spoken[1].text,/speed and steering/);
    engineer.setPower(false);
  } finally {globalThis.fetch=originalFetch;delete globalThis.window;delete globalThis.document;delete globalThis.SpeechSynthesisUtterance;}
});

test("one power switch enables ongoing AI and speech, while off cancels both", async function() {
  const originalFetch=globalThis.fetch;
  globalThis.document={createElement:()=>new Element(),body:{appendChild(){}}};
  globalThis.window={addEventListener(){},speechSynthesis:{cancel(){},getVoices(){return [];}}};
  let calls=0;
  globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>({text:'Let’s start with the ramp approach.',source:'ai'})};};
  try {
    const engineer=new RaceEngineer();
    assert.equal(engineer.enabled,false);
    engineer.setPower(true);
    assert.equal(engineer.autoTips.checked,true);
    assert.equal(engineer.voice.enabled,true);
    engineer.update({...SAMPLE_STATE,speedKmh:0,events:[]},0,false);
    await new Promise(setImmediate);
    assert.equal(calls,1,'initial conversational check-in works even while stopped');
    engineer.setPower(false);
    assert.equal(engineer.voice.enabled,false);
    assert.equal(engineer.voice.handsFree,false);
    assert.equal(engineer.autoTips.checked,false);
  } finally {globalThis.fetch=originalFetch;delete globalThis.window;delete globalThis.document;}
});
