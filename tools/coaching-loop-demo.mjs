// End-to-end graph verification using isolated synthetic data; never calls ai&.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { focusText } from "../public/shared/coaching-text.js";
import { RaceMemory, cleanLap } from "../server/memory.js";
import { MEMORY_DEMO_LAPS, MEMORY_DEMO_NEXT_LAP } from "../public/shared/memory-demo.js";
try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch {}
const memory = new RaceMemory();
const scope = { dataset: "demo", driverId: "loop-" + randomUUID(), sessionId: "loop-session", trackId: "suzuka", mode: "performance" };
function connected(result) { assert.equal(result.status, "connected", "Neo4j operation unavailable"); return result.data; }
try {
  for (const raw of MEMORY_DEMO_LAPS) connected(await memory.saveLap(scope, cleanLap(raw)));
  const before = connected(await memory.context(scope));
  assert.equal(before.coaching.focus.corner, "T4");
  const focus = connected(await memory.prepareRecommendation(scope, before.coaching.focus));
  assert.equal(focus.status, "proposed");
  const tip = { text: focusText(focus, "en", "demo"), source: "analysis", analysisId: focus.id, coaching: { focus } };
  connected(await memory.saveCoaching(scope, tip, ""));
  connected(await memory.saveCoaching(scope, tip, ""));
  assert.equal(connected(await memory.context(scope)).coaching.outcome, null);
  assert.equal(connected(await memory.acknowledgeRecommendation(scope, focus.id)).acknowledged, true);
  const next = cleanLap({ ...MEMORY_DEMO_NEXT_LAP, startedAt: Date.now(), completedAt: Date.now() });
  const saved = connected(await memory.saveLap(scope, next));
  assert.equal(saved.outcome.result, "improved");
  assert.equal(saved.outcome.metricChangeMeters, 2);
  assert.equal(saved.outcome.lossChangeSeconds, 0.06);
  const after = connected(await memory.context(scope));
  assert.equal(after.coaching.outcome.id, saved.outcome.id);
  // A duplicate lap must not produce a second evaluation.
  const retry = connected(await memory.saveLap(scope, next));
  assert.equal(retry.outcome.id, saved.outcome.id);
  const conflict = connected(await memory.saveLap(scope, { ...next, summary: "Conflicting correction using an old ID" }));
  assert.equal(conflict.stored, false);
  const proof = await memory.query(`MATCH (r:RaceRecommendation {id: $id})
    OPTIONAL MATCH (r)-[:SUPPORTED_BY]->(a:RaceCornerAttempt)
    WITH r, count(a) AS evidenceAttempts
    OPTIONAL MATCH (r)-[:HAS_OUTCOME]->(e:RaceEvaluation)-[:OBSERVED_ON]->(l:RaceLap)
    RETURN r.status AS status, evidenceAttempts, count(e) AS evaluations`, { id: focus.id }, true);
  const graph = proof.records[0].toObject();
  assert.equal(graph.evidenceAttempts, 3);
  assert.equal(graph.evaluations, 1);
  const tips = await memory.query(`MATCH (t:RaceCoaching)-[:COMMUNICATED]->(r:RaceRecommendation {id: $id}) RETURN count(t) AS total`, { id: focus.id }, true);
  assert.equal(tips.records[0].get("total"), 1);
  console.log(JSON.stringify({ status: "verified", dataset: "demo", graph: graph,
    focus: { corner: focus.corner, actionMeters: focus.actionMeters, confidence: focus.confidence }, outcome: saved.outcome }, null, 2));
} finally { await memory.close(); }
