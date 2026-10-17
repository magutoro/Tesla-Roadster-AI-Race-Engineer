import test from "node:test";
import assert from "node:assert/strict";
import { cleanPracticeGoal, inferPracticeGoal } from "../public/shared/practice-goal.js";
import { chooseFocus } from "../server/coaching-loop.js";
import { cleanLap, resolvePracticeContext } from "../server/memory.js";
import { cleanCoachRequest, getCoachTip } from "../server/ai.js";
import { focusText } from "../public/shared/coaching-text.js";
import { practiceReport } from "../server/practice-report.js";
import { MEMORY_DEMO_LAPS, LATE_BRAKING_DEMO_LAPS } from "../public/shared/memory-demo.js";
import { SAMPLE_STATE } from "../public/shared/protocol.js";
const speedGoal = { type: "corner_speed", corner: "T4" };
const scope = { dataset: "demo", driverId: "test", sessionId: "test", trackId: "suzuka", mode: "thrust" };

test("natural goal statements set a skill and optional corner; questions do not silently change goals", function () {
  assert.deepEqual(inferPracticeGoal("I wanna work on my corner speed at turn 4"), speedGoal);
  assert.deepEqual(inferPracticeGoal("I want to improve my braking"), { type: "braking", corner: "" });
  assert.equal(inferPracticeGoal("Why did you pick T4?"), null);
  assert.throws(function () { cleanPracticeGoal({ type: "made-up" }); });
});

test("goal selection filters unrelated cues and target corners", function () {
  const laps = MEMORY_DEMO_LAPS.map(cleanLap).reverse();
  for (const lap of laps) lap.corners.push({ name: "T8", timeLostSeconds: 1, throttlePickupLateMeters: 10 });
  assert.equal(chooseFocus(laps, null, speedGoal).corner, "T4");
  const allBraking = chooseFocus(laps, null, { type: "braking", corner: "" });
  const t4Braking = chooseFocus(laps, null, { type: "braking", corner: "T4" });
  assert.notEqual(allBraking.id, t4Braking.id, "changing the target must not reuse a recommendation with a different outcome scope");
  assert.equal(chooseFocus(laps, null, { type: "corner_exit", corner: "" }).corner, "T8");
  assert.equal(chooseFocus(laps, null, { type: "braking", corner: "T8" }), null);
});

test("late-braking evidence can support an earlier cue in seconds; metres are never converted to seconds", function () {
  const late = chooseFocus(LATE_BRAKING_DEMO_LAPS.map(cleanLap).reverse(), null, speedGoal);
  assert.match(focusText(late), /0.3 s earlier/);
  assert.equal(late.actionDirection, "earlier");
  const early = chooseFocus(MEMORY_DEMO_LAPS.map(cleanLap).reverse(), null, speedGoal);
  assert.match(focusText(early), /2 m later/);
  assert.equal(early.actionSeconds, null);
  const report = practiceReport(speedGoal, { focus: late }, [], "demo");
  assert.ok(report.evidence.some(function (line) { return line.includes("6 km/h below"); }));
  assert.ok(report.evidence.some(function (line) { return line.includes("12 m later"); }));
});

test("missing telemetry produces a collection plan instead of an invented adjustment", function () {
  const report = practiceReport(speedGoal, { focus: null }, [], "live");
  assert.match(report.text, /two valid comparable laps/);
  assert.ok(!report.text.includes("0.3"));
});

test("local measured laps can support a goal when Aura is unavailable; example data stays labeled", async function () {
  const memory = { context: async function () { return { status: "unavailable" }; } };
  const context = await resolvePracticeContext(memory, scope, speedGoal, LATE_BRAKING_DEMO_LAPS.map(cleanLap));
  assert.equal(context.status, "unavailable");
  assert.equal(context.data.coaching.focus.actionSeconds, 0.3);
  assert.match(context.data.practice.text, /Example data/);
});

test("explicit goals and bounded conversations reach the model as data", async function () {
  let body;
  const request = cleanCoachRequest({ state: SAMPLE_STATE, practiceGoal: speedGoal, question: "Why earlier?",
    conversation: [null, { question: "My goal?", answer: "Corner speed" }] });
  await getCoachTip(request, { env: { AI_BASE_URL: "https://example.invalid", AI_API_KEY: "test", AI_MODEL: "test" },
    fetch: async function (url, options) { body = JSON.parse(options.body); return { ok: true, json: async function () { return { choices: [{ message: { content: "Explanation" } }] }; } }; } });
  const data = JSON.parse(body.messages[1].content);
  assert.deepEqual(data.practiceGoal, speedGoal);
  assert.equal(data.conversation.length, 1);
  assert.match(body.messages[0].content, /Never convert metres to seconds/);
});
