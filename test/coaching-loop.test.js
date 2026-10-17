import test from "node:test";
import assert from "node:assert/strict";
import { chooseFocus, comparisonKey, evaluateFocus } from "../server/coaching-loop.js";
import { cleanLap } from "../server/memory.js";
import { getCoachTip } from "../server/ai.js";
import { MEMORY_DEMO_LAPS, MEMORY_DEMO_NEXT_LAP } from "../public/shared/memory-demo.js";
import { SAMPLE_STATE } from "../public/shared/protocol.js";

function laps() { return MEMORY_DEMO_LAPS.map(cleanLap).reverse(); }
function shownFocus() { return { ...chooseFocus(laps()), status: "pending", shownAt: 100 }; }
function nextLap() { return { ...cleanLap(MEMORY_DEMO_NEXT_LAP), startedAt: 150, completedAt: 190, createdAt: 200 }; }

test("one focus ranks repeated measured loss, cites evidence and bounds the adjustment", function () {
  const measured = laps();
  for (const lap of measured) lap.corners.push({ name: "T9", timeLostSeconds: 0.6, brakedEarlyMeters: 30 });
  const focus = chooseFocus(measured);
  assert.equal(focus.corner, "T9");
  assert.equal(focus.actionMeters, 5);
  assert.equal(focus.evidenceLapIds.length, 3);
  assert.equal(focus.confidence, "strong");
  assert.equal(focus.baselineLapId, "example-lap-3");
  assert.equal(focus.meanLossSeconds, 0.6);
  assert.equal(chooseFocus(laps()).actionMeters, 2);
});

test("a single outlier, legacy summary, invalid lap or changed conditions cannot establish a repeated issue", function () {
  assert.equal(chooseFocus([laps()[0]]), null);
  assert.equal(chooseFocus([{ id: "text-only", summary: "T4 slow" }, ...laps()]), null);
  assert.equal(chooseFocus([{ ...laps()[0], valid: false }, ...laps().slice(1)]), null);
  for (const field of ["referenceId", "trackVersion", "physicsVersion", "setupId"]) {
    const measured = laps();
    measured[0].comparisonKey = comparisonKey({ ...MEMORY_DEMO_LAPS[0].comparison, [field]: "different" });
    assert.equal(chooseFocus(measured), null, field + " must isolate comparisons");
  }
  const measured = laps();
  measured[0].corners[0].brakedEarlyMeters = null;
  assert.equal(chooseFocus(measured), null, "latest attempt must still exhibit the issue");
});

test("pending focus is retained, but marked inapplicable when conditions change", function () {
  const pending = shownFocus();
  assert.equal(chooseFocus(laps(), pending).comparableNow, true);
  assert.equal(chooseFocus([{ ...laps()[0], comparisonKey: "changed" }], pending).comparableNow, false);
});

test("evaluation measures both technique and time without making a causal claim", function () {
  const outcome = evaluateFocus(shownFocus(), nextLap());
  assert.equal(outcome.result, "improved");
  assert.equal(outcome.metricChangeMeters, 2);
  assert.equal(outcome.lossChangeSeconds, 0.06);
  assert.equal(outcome.causalClaim, false);
  assert.equal(outcome.baselineLapId, "example-lap-3");
  assert.equal(outcome.lapId, "example-lap-4");
});

test("evaluation ignores unshown advice, earlier attempts, invalid data and other conditions", function () {
  assert.equal(evaluateFocus({ ...shownFocus(), shownAt: null }, nextLap()), null);
  assert.equal(evaluateFocus(shownFocus(), { ...nextLap(), createdAt: 99 }), null);
  assert.equal(evaluateFocus(shownFocus(), { ...nextLap(), valid: false }), null);
  assert.equal(evaluateFocus(shownFocus(), { ...nextLap(), comparisonKey: "other-reference" }), null);
  assert.equal(evaluateFocus(shownFocus(), { ...nextLap(), id: "example-lap-3" }), null);
  assert.equal(evaluateFocus(shownFocus(), { ...nextLap(), corners: [] }), null);
  assert.equal(evaluateFocus(shownFocus(), { ...nextLap(), startedAt: 50 }), null, "late upload must not become a post-cue attempt");
  assert.equal(evaluateFocus(shownFocus(), { ...nextLap(), startedAt: null }), null, "receipt time alone is not driving time");
  const midLap = { ...nextLap(), startedAt: 50, corners: [{ ...nextLap().corners[0], observedAt: 150 }] };
  assert.equal(evaluateFocus(shownFocus(), midLap).result, "improved", "a timed corner after the cue is eligible even if the lap began earlier");
});

test("a faster result alone does not count as improving the targeted technique", function () {
  const lap = nextLap();
  lap.corners[0].brakedEarlyMeters = 8;
  const outcome = evaluateFocus(shownFocus(), lap);
  assert.equal(outcome.result, "time_improved_only");
  assert.equal(outcome.metricChangeMeters, -4);
  // Overshooting the reference by more than the original error is not improvement either.
  lap.corners[0].brakedEarlyMeters = -8;
  assert.equal(evaluateFocus(shownFocus(), lap).result, "time_improved_only");
});

test("measured automatic coaching uses no provider call; explicit questions still use the AI", async function () {
  let calls = 0;
  const request = { state: SAMPLE_STATE, question: "", lang: "en", memory: { dataset: "demo" },
    memoryContext: { coaching: { focus: chooseFocus(laps()), outcome: null } } };
  const options = { env: { AI_BASE_URL: "https://example.invalid", AI_API_KEY: "test", AI_MODEL: "test" },
    fetch: async function () { calls++; return { ok: true, json: async function () { return { choices: [{ message: { content: "Measured explanation" } }] }; } }; } };
  const cue = await getCoachTip(request, options);
  assert.equal(calls, 0);
  assert.equal(cue.source, "analysis");
  assert.match(cue.text, /Example data/);
  assert.match(cue.text, /2 m later/);
  await getCoachTip({ ...request, question: "Why T4?" }, options);
  assert.equal(calls, 1);
});
