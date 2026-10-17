import test from "node:test";
import assert from "node:assert/strict";
import { RaceMemory, cleanLap, cleanMemoryScope, summarizeMemory, installMemoryRoutes } from "../server/memory.js";
import { cleanCoachRequest, installCoachRoutes } from "../server/ai.js";
import { SAMPLE_STATE } from "../public/shared/protocol.js";
import { MEMORY_DEMO_LAPS } from "../public/shared/memory-demo.js";

const scope = { dataset: "live", driverId: "driver-1", sessionId: "session-1", trackId: "suzuka", mode: "performance" };
const env = { NEO4J_URI: "neo4j+s://example.invalid", NEO4J_USERNAME: "neo4j", NEO4J_PASSWORD: "test" };
function fakeMemory(execute) {
  return new RaceMemory({ env: env, driver: { executeQuery: execute, close: async function () {} } });
}

test("memory validates scope and measured corners without fabricating missing metrics", function () {
  assert.throws(function () { cleanMemoryScope({ ...scope, dataset: "other" }); });
  assert.throws(function () { cleanMemoryScope({ ...scope, trackId: "'); MATCH (n) DETACH DELETE n" }); });
  assert.throws(function () { cleanLap({ id: "a", summary: "Measured", corners: [{ name: "T4", timeLostSeconds: NaN }] }); });
  assert.throws(function () { cleanLap({ id: "a", summary: "Measured", corners: [{ name: "T4" }, { name: "T4" }] }); });
  const lap = cleanLap({ id: "a", summary: "Measured", corners: [{ name: "T4", timeLostSeconds: 0.3 }] });
  assert.equal(lap.corners[0].brakedEarlyMeters, null);
  assert.equal(lap.lapTimeSeconds, null);
});

test("idempotent lap keys isolate driver, track, mode and synthetic examples", async function () {
  const calls = [];
  const memory = fakeMemory(async function (query, parameters, options) {
    calls.push({ query, parameters, options });
    return { records: [] };
  });
  const lap = cleanLap({ ...MEMORY_DEMO_LAPS[0], source: "live", summary: "Text ' is a parameter" });
  await memory.saveLap(scope, lap);
  await memory.saveLap(scope, lap);
  await memory.saveLap({ ...scope, dataset: "demo" }, { ...lap, source: "demo" });
  await memory.saveLap({ ...scope, mode: "rocket" }, lap);
  await memory.saveLap({ ...scope, driverId: "driver-2" }, lap);
  await memory.saveLap({ ...scope, trackId: "blank" }, lap);
  const writes = calls.filter(function (call) { return call.parameters.lapKey; });
  assert.equal(writes[0].parameters.lapKey, writes[1].parameters.lapKey);
  assert.equal(new Set(writes.map(function (call) { return call.parameters.lapKey; })).size, 5);
  assert.match(writes[0].query, /MERGE \(l:RaceLap/);
  assert.ok(!writes[0].query.includes(lap.summary));
  assert.equal(writes[0].parameters.summary, lap.summary);
  assert.equal(writes[0].options.routing, "WRITE");
  assert.equal(writes[0].options.database, "neo4j");
});

test("graph context is bounded, scoped and aggregates only measured positive losses", async function () {
  let captured;
  const memory = fakeMemory(async function (query, parameters) {
    if (!query.includes("RETURN laps, advice")) return { records: [] };
    captured = parameters;
    return { records: [{ get: function (key) { return key === "laps" ? MEMORY_DEMO_LAPS : [{ text: "Earlier advice", source: "ai" }]; } }] };
  });
  const result = await memory.context({ ...scope, dataset: "demo" });
  assert.equal(result.status, "connected");
  assert.equal(result.data.dataset, "demo");
  assert.equal(result.data.recentLaps.length, 3);
  assert.equal(result.data.recurringCorners[0].lapsWithLoss, 3);
  assert.ok(Math.abs(result.data.recurringCorners[0].totalLossSeconds - 0.67) < 0.00001);
  assert.equal(captured.driverKey, "demo:driver-1");
  assert.equal(captured.trackKey, "demo:suzuka");
  assert.equal(captured.historyLimit.toNumber(), 5);
  assert.equal(summarizeMemory([{ corners: [{ name: "T4", timeLostSeconds: -1 }] }], [], "live").recurringCorners.length, 0);
});

test("coaching can create its scoped session before the first lap", async function () {
  let saved;
  const memory = fakeMemory(async function (query, parameters) {
    if (query.includes("MERGE (tip:RaceCoaching")) saved = { query, parameters };
    return { records: [] };
  });
  await memory.saveCoaching(scope, { text: "Advice", source: "ai" }, "Question");
  assert.match(saved.query, /MERGE \(s:RaceSession/);
  assert.equal(saved.parameters.sessionKey, "live:driver-1:session-1:suzuka:performance");
});

test("missing credentials and graph failures degrade without exposing credentials", async function () {
  const missing = new RaceMemory({ env: {} });
  assert.deepEqual(await missing.health(), { status: "not_configured" });
  let count = 0;
  const failed = fakeMemory(async function () { count++; throw new Error("secret password"); });
  assert.deepEqual(await failed.context(scope), { status: "unavailable" });
  assert.deepEqual(await failed.context(scope), { status: "unavailable" });
  assert.equal(count, 1, "retry cooldown avoids hammering an unavailable database");
});

test("memory routes require explicit power and refuse example data in live scope", async function () {
  const routes = new Map();
  installMemoryRoutes({ get: function (path, callback) { routes.set(path, callback); }, post: function (path, callback) { routes.set(path, callback); } }, {});
  let status, result;
  const res = { status: function (n) { status = n; return this; }, json: function (value) { result = value; } };
  await routes.get("/api/memory/laps")({ body: { scope } }, res);
  assert.equal(status, 403);
  await routes.get("/api/memory/demo")({ body: { enabled: true, scope } }, res);
  assert.equal(status, 400);
  assert.match(result.error, /demo dataset/);
});

test("server passes recalled laps to AI and persists the resulting advice", async function () {
  const originalFetch = globalThis.fetch;
  const oldEnv = { AI_BASE_URL: process.env.AI_BASE_URL, AI_API_KEY: process.env.AI_API_KEY, AI_MODEL: process.env.AI_MODEL };
  Object.assign(process.env, { AI_BASE_URL: "https://example.invalid", AI_API_KEY: "test", AI_MODEL: "test" });
  let providerRequest, saved, handler;
  globalThis.fetch = async function (url, options) {
    providerRequest = JSON.parse(options.body);
    return { ok: true, json: async function () { return { choices: [{ message: { content: "T4 lost time in your previous laps." } }] }; } };
  };
  try {
    const memory = { context: async function (received) {
      assert.deepEqual(received, scope);
      return { status: "connected", data: summarizeMemory(MEMORY_DEMO_LAPS, [], "live") };
    }, saveCoaching: async function (received, tip) { saved = tip.text; } };
    installCoachRoutes({ post: function (path, callback) { handler = callback; } }, { memory });
    let tip;
    const res = { on: function () {}, removeListener: function () {}, json: function (value) { tip = value; } };
    await handler({ body: { enabled: true, state: { ...SAMPLE_STATE, mode: scope.mode }, memory: { enabled: true, scope } } }, res);
    const prompt = JSON.parse(providerRequest.messages[1].content);
    assert.equal(prompt.memoryContext.recentLaps.length, 3);
    assert.equal(tip.memory.laps, 3);
    assert.equal(saved, tip.text);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
