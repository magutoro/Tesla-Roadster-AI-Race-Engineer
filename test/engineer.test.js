import test from "node:test";
import assert from "node:assert/strict";
import { cleanCoachRequest, getCoachTip } from "../server/ai.js";
import { SAMPLE_STATE } from "../public/shared/protocol.js";
import { CONFIG } from "../public/config.js";
import { EngineerVoice, instantCallout } from "../public/voice.js";

test("reject invalid telemetry; bound and isolate supplied lap history", function () {
  assert.throws(function () { cleanCoachRequest({ state: { speedKmh: "fast" } }); });
  const request = cleanCoachRequest({ state: { ...SAMPLE_STATE, speedKmh: 999, steer: -9 }, history: Array(9).fill("lap summary"), apiKey: "must not forward" });
  assert.equal(request.state.speedKmh, 500);
  assert.equal(request.state.steer, -1);
  assert.equal(request.history.length, 5);
  assert.equal(JSON.stringify(request).includes("must not forward"), false);
});

test("unconfigured and failed AI return labeled practice tips", async function () {
  const request = cleanCoachRequest(SAMPLE_STATE);
  const tip = await getCoachTip(request, { env: {} });
  assert.equal(tip.source, "fallback");
  assert.match(tip.text, /fans/);
  const failed = await getCoachTip(request, { env: { AI_BASE_URL: "https://example.invalid/v1", AI_API_KEY: "test", AI_MODEL: "test" }, fetch: async function () { throw new Error("offline"); } });
  assert.equal(failed.reason, "provider_error");
  const question = await getCoachTip(cleanCoachRequest({ state: SAMPLE_STATE, question: "Where did I lose time?", lang: "ja" }), { env: {} });
  assert.match(question.text, /AI/);
});

test("AI receives measured summaries and question, with server-only authentication", async function () {
  const request = cleanCoachRequest({ state: SAMPLE_STATE, history: ["T4 lost 0.35 s"], question: "Where am I losing time?" });
  const tip = await getCoachTip(request, {
    env: { AI_BASE_URL: "https://example.invalid/v1/", AI_API_KEY: "server-secret", AI_MODEL: "test-model" },
    fetch: async function (url, options) {
      assert.equal(url, "https://example.invalid/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer server-secret");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "test-model");
      assert.match(body.messages[1].content, /T4 lost 0.35 s/);
      assert.equal(body.messages[1].content.includes("server-secret"), false);
      return { ok: true, json: async function () { return { choices: [{ message: { content: "Focus on T4." } }] }; } };
    },
  });
  assert.equal(tip.source, "ai");
  assert.equal(tip.text, "Focus on T4.");
  assert.equal(JSON.stringify(tip).includes("server-secret"), false);
});

test("a hung provider aborts and releases its request slot", async function () {
  const previous = CONFIG.coach.requestTimeoutMs;
  CONFIG.coach.requestTimeoutMs = 20;
  try {
    const result = await getCoachTip(cleanCoachRequest(SAMPLE_STATE), {
      env: { AI_BASE_URL: "https://example.invalid", AI_API_KEY: "test", AI_MODEL: "test" },
      fetch: function (url, options) {
        return new Promise(function (resolve, reject) {
          options.signal.addEventListener("abort", function () { reject(new Error("aborted")); });
        });
      },
    });
    assert.equal(result.reason, "timeout");
  } finally { CONFIG.coach.requestTimeoutMs = previous; }
});

test("speech waits for a straight, pauses in corners, expires, and never grows a backlog", function () {
  const spoken = [];
  globalThis.window = { speechSynthesis: { speak: function (speech) { spoken.push(speech); }, cancel: function () {} } };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  try {
    const voice = new EngineerVoice(function () {}, function () {});
    voice.setEnabled(true);
    voice.queue({ text: "First", lang: "en" });
    voice.queue({ text: "Latest", lang: "en" });
    voice.update(SAMPLE_STATE, 1, false);
    assert.equal(spoken.length, 0);
    voice.update({ ...SAMPLE_STATE, steer: 0 }, 1, false);
    assert.equal(spoken[0].text, "Latest");
    voice.update(SAMPLE_STATE, 1, false);
    assert.equal(voice.current, null);
    assert.equal(voice.pending.text, "Latest");
    voice.pending.expires = -1;
    voice.update({ ...SAMPLE_STATE, steer: 0 }, 1, false);
    assert.equal(spoken.length, 1);
    voice.queue({ text: "Paused", lang: "en" });
    voice.update({ ...SAMPLE_STATE, speedKmh: 0 }, 0, true);
    assert.equal(spoken.length, 1);
    voice.setEnabled(false);
    assert.equal(voice.pending, null);
  } finally {
    delete globalThis.window;
    delete globalThis.SpeechSynthesisUtterance;
  }
});

test("critical driving events can interrupt routine speech without waiting for AI", function () {
  assert.match(instantCallout(["tank_empty"], "en").text, /Thrusters are unavailable/);
  assert.match(instantCallout(["crash"], "ja").text, /衝突/);
  assert.equal(instantCallout(["landing"], "en"), null);
});

test("microphone captures one question, waits for final transcription, and cancels safely", function () {
  let recognition;
  const questions = [];
  const statuses = [];
  class Recognition {
    constructor() { recognition = this; this.stops = 0; }
    start() {}
    stop() { this.stops++; }
    abort() {}
  }
  globalThis.window = { SpeechRecognition: Recognition, speechSynthesis: { cancel: function () {} } };
  try {
    const voice = new EngineerVoice(function (text) { questions.push(text); }, function (text) { statuses.push(text); });
    voice.setEnabled(true);
    assert.equal(voice.startListening("en"), true);
    assert.equal(recognition.lang, "en-US");
    assert.equal(recognition.continuous, false);
    assert.equal(recognition.interimResults, true);
    voice.stopListening();
    voice.stopListening();
    assert.equal(recognition.stops, 1);
    assert.equal(voice.stopping, true);
    const result = [{ transcript: "How should I take this corner?" }];
    result.isFinal = true;
    recognition.onresult({ resultIndex: 0, results: [result] });
    recognition.onend();
    assert.deepEqual(questions, ["How should I take this corner?"]);
    assert.equal(voice.listening, false);
    assert.equal(voice.stopping, false);
    voice.startListening("ja");
    voice.setEnabled(false);
    recognition.onresult({ resultIndex: 0, results: [result] });
    recognition.onend();
    assert.equal(questions.length, 1, "turning voice off must discard late microphone results");
    voice.startListening("en");
    recognition.onerror({ error: "not-allowed" });
    recognition.onend();
    assert.equal(questions.length, 1);
    assert.match(statuses.at(-1), /denied/);
  } finally { delete globalThis.window; }
});

test("radio acknowledgment survives a fast answer and both wait for a straight", function () {
  const spoken=[];
  globalThis.window={speechSynthesis:{speak:function(s){spoken.push(s);},cancel:function(){},getVoices:function(){return [];}}};
  globalThis.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
  try {
    const voice=new EngineerVoice(function(){},function(){});voice.setEnabled(true);
    voice.acknowledge("en");voice.queue({text:"T1: brake 5 m later, based on two matching laps.",lang:"en"});
    voice.update(SAMPLE_STATE,1,false);assert.equal(spoken.length,0);
    const straight={...SAMPLE_STATE,steer:0};voice.update(straight,1,false);
    assert.match(spoken[0].text,/Copy/);
    spoken[0].onend();voice.update(straight,1,false);
    assert.match(spoken[1].text,/two matching laps/);
    voice.acknowledge("en");voice.setEnabled(false);assert.equal(voice.acknowledgment,null);
  } finally {delete globalThis.window;delete globalThis.SpeechSynthesisUtterance;}
});

test('hands-free listens again between replies, avoids its own speech, and stops on service errors',function(){
 let recognition,starts=0;const questions=[];
 class Recognition {constructor(){recognition=this;}start(){starts++;}stop(){}abort(){}}
 globalThis.window={SpeechRecognition:Recognition,speechSynthesis:{cancel:function(){},getVoices:function(){return [];},speak:function(){}}};
 globalThis.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
 try {
  const voice=new EngineerVoice(t=>questions.push(t),function(){});voice.setEnabled(true);assert.equal(voice.setHandsFree(true),true);
  voice.pollHandsFree('en',false);assert.equal(starts,1);
  const result=[{transcript:'How can I improve the next turn?'}];result.isFinal=true;
  recognition.onresult({resultIndex:0,results:[result]});recognition.onend();assert.equal(questions.length,1);
  voice.lastListenAttempt=-Infinity;voice.pollHandsFree('en',true);assert.equal(starts,1);
  voice.acknowledge('en');voice.pollHandsFree('en',false);assert.equal(starts,1);
  voice.update({...SAMPLE_STATE,speedKmh:0},0,false);voice.pollHandsFree('en',false);assert.equal(starts,1);
  voice.utterance.onend();voice.pollHandsFree('en',false);assert.equal(starts,2);
  recognition.onerror({error:'network'});recognition.onend();voice.lastListenAttempt=-Infinity;voice.pollHandsFree('en',false);
  assert.equal(voice.handsFree,false);assert.equal(voice.handsFreeError,'network');assert.equal(starts,2,'no repeated failure loop');
  voice.setHandsFree(true);voice.setEnabled(false);assert.equal(voice.handsFree,false);
 }finally{delete globalThis.window;delete globalThis.SpeechSynthesisUtterance;}
});

test('automatic AI coaching explains measured evidence rather than returning the template',async function(){
 const request=cleanCoachRequest({state:SAMPLE_STATE,explain:true,recentCoaching:['Try smoother brake release.']});
 request.memoryContext={coaching:{focus:{corner:'T1',metric:'brakedEarlyMeters',actionMeters:5,actionDirection:'later',comparableNow:true}},practice:{text:'Template plan'}};
 let payload;
 const tip=await getCoachTip(request,{env:{AI_BASE_URL:'https://example.invalid',AI_API_KEY:'test',AI_MODEL:'test'},fetch:async function(url,options){payload=JSON.parse(options.body);return {ok:true,json:async function(){return {choices:[{message:{content:'You braked earlier on both laps. Try the bounded adjustment and compare your exit.'}}]};}};}});
 assert.equal(tip.source,'ai');assert.notEqual(tip.text,'Template plan');
 assert.match(payload.messages[0].content,/not a dashboard narrator/);
 assert.match(payload.messages[1].content,/smoother brake release/);
 assert.match(payload.messages[1].content,/T1/);
});

test('spoken API replies stop at a complete sentence rather than the character-limit fragment',async function(){
 const {naturalReply}=await import('../public/shared/coaching-text.js');
 const first='Switch the fans on before the curl; they add grip while touching the road.';
 assert.equal(naturalReply(first+' '+('extra words '.repeat(50)),150),first);
 assert.equal(naturalReply('Try a smoother brake release.',150),'Try a smoother brake release.');
});
