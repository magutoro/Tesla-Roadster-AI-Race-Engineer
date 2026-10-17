// Neo4j memory. Queries and labels are fixed; client input is always a parameter.
import neo4j from "neo4j-driver";
import { randomUUID, createHash } from "node:crypto";
import { CONFIG } from "../public/config.js";
import { cleanPracticeGoal } from "../public/shared/practice-goal.js";
import { practiceReport } from "./practice-report.js";
import { chooseFocus, comparisonKey, evaluateFocus } from "./coaching-loop.js";
import { MEMORY_DEMO_LAPS, MEMORY_DEMO_NEXT_LAP } from "../public/shared/memory-demo.js";

const LABELS = ["RaceDriver", "RaceSession", "RaceTrack", "RaceLap", "RaceCorner", "RaceCornerAttempt", "RaceCoaching", "RaceRecommendation", "RaceEvaluation"];

function identifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error("Invalid " + label);
  return value;
}

export function cleanMemoryScope(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Memory scope is required");
  if (!["live", "demo"].includes(raw.dataset)) throw new Error("Invalid memory dataset");
  if (!["performance", "thrust", "rocket"].includes(raw.mode)) throw new Error("Invalid car mode");
  return { driverId: identifier(raw.driverId, "driver ID"), sessionId: identifier(raw.sessionId, "session ID"),
    trackId: identifier(raw.trackId, "track ID"), dataset: raw.dataset, mode: raw.mode };
}

function metric(value, min, max) {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value) || value < min || value > max) throw new Error("Invalid corner measurement");
  return value;
}

export function cleanLap(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Lap is required");
  if (typeof raw.summary !== "string" || !raw.summary.trim()) throw new Error("Lap summary is required");
  const corners = [];
  const names = new Set();
  if (raw.corners !== undefined && (!Array.isArray(raw.corners) || raw.corners.length > CONFIG.memory.maxCorners)) throw new Error("Invalid corners");
  for (const corner of raw.corners || []) {
    const name = identifier(corner?.name, "corner name");
    if (names.has(name)) throw new Error("Duplicate corner name");
    names.add(name);
    corners.push({ name: name, timeLostSeconds: metric(corner.timeLostSeconds, -600, 600),
      brakedEarlyMeters: metric(corner.brakedEarlyMeters, -1000, 1000),
      brakedEarlySeconds: metric(corner.brakedEarlySeconds, -30, 30),
      minimumSpeedDifferenceKmh: metric(corner.minimumSpeedDifferenceKmh, -500, 500),
      throttlePickupLateMeters: metric(corner.throttlePickupLateMeters, -1000, 1000),
      observedAt: metric(corner.observedAt, 0, Date.now() + CONFIG.coachingLoop.clockSkewMs) });
  }
  let comparison = null;
  if (raw.comparison !== undefined && raw.comparison !== null) {
    comparison = {};
    for (const field of ["referenceId", "trackVersion", "physicsVersion", "setupId"]) {
      comparison[field] = identifier(raw.comparison?.[field], field);
    }
  }
  const startedAt = metric(raw.startedAt, 0, Date.now() + CONFIG.coachingLoop.clockSkewMs);
  const completedAt = metric(raw.completedAt, 0, Date.now() + CONFIG.coachingLoop.clockSkewMs);
  if (startedAt !== null && completedAt !== null && completedAt < startedAt) throw new Error("Lap completion precedes its start");
  for (const corner of corners) {
    if (corner.observedAt !== null && ((startedAt !== null && corner.observedAt < startedAt) ||
        (completedAt !== null && corner.observedAt > completedAt))) throw new Error("Corner timestamp is outside the lap");
  }
  if (raw.lapNumber != null && !Number.isInteger(raw.lapNumber)) throw new Error("Invalid lap number");
  if (raw.source !== undefined && !["live", "demo", "replay"].includes(raw.source)) throw new Error("Invalid lap source");
  return { ...(raw.source ? {source: raw.source} : {}), id: identifier(raw.id, "lap ID"), summary: raw.summary.trim().slice(0, CONFIG.coach.maxSummaryLength),
    lapNumber: metric(raw.lapNumber, 1, 100000), lapTimeSeconds: metric(raw.lapTimeSeconds, 0.01, 86400), corners: corners,
    startedAt: startedAt, completedAt: completedAt, valid: raw.valid === true, comparison: comparison, comparisonKey: comparisonKey(comparison) };
}

export function cleanScopedLap(raw, scope) {
  const lap=cleanLap(raw);
  if (scope?.dataset === "live" && ["demo", "replay"].includes(lap.source)) throw new Error("Example/replay data cannot enter live memory");
  if (scope?.dataset === "demo" && lap.source === "live") throw new Error("Live data cannot enter example memory");
  return lap;
}

function keys(scope) {
  const driverKey = scope.dataset + ":" + scope.driverId;
  return { ...scope, driverKey: driverKey, trackKey: scope.dataset + ":" + scope.trackId,
    sessionKey: driverKey + ":" + scope.sessionId + ":" + scope.trackId + ":" + scope.mode };
}

export function summarizeMemory(laps, advice, dataset) {
  const byCorner = new Map();
  for (const lap of laps) {
    for (const corner of lap.corners || []) {
      if (!corner.name || !(corner.timeLostSeconds > 0)) continue;
      if (!byCorner.has(corner.name)) byCorner.set(corner.name, { name: corner.name, lapsWithLoss: 0, totalLossSeconds: 0 });
      const item = byCorner.get(corner.name);
      item.lapsWithLoss++;
      item.totalLossSeconds += corner.timeLostSeconds;
    }
  }
  const recurringCorners = Array.from(byCorner.values());
  recurringCorners.sort(function (a, b) { return b.totalLossSeconds - a.totalLossSeconds; });
  return { dataset: dataset, recentLaps: laps.slice(0, CONFIG.memory.historyLimit),
    recurringCorners: recurringCorners.slice(0, 3), previousAdvice: advice.slice(0, CONFIG.memory.adviceLimit) };
}

function lapHash(lap) {
  // Keep legacy retry hashes stable when optional new measurements are absent.
  const payload = { ...lap, corners: lap.corners.map(function (corner) {
    const item = { ...corner };
    if (item.brakedEarlySeconds == null) delete item.brakedEarlySeconds;
    return item;
  }) };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function resolvePracticeContext(memory, scope, rawGoal, laps = []) {
  const goal = cleanPracticeGoal(rawGoal);
  laps = laps.map(function(lap){return cleanScopedLap(lap,scope);});
  const result = memory ? await memory.context(scope, goal) : { status: "not_configured" };
  if (result.status === "connected") return result;
  // Browser history is validated measurements, never inferred from prose summaries.
  const recent = laps.slice(-CONFIG.memory.historyLimit).reverse();
  const data = summarizeMemory(recent, [], scope.dataset);
  data.coaching = { focus: chooseFocus(recent, null, goal), outcome: null };
  data.practice = practiceReport(goal, data.coaching, recent, scope.dataset);
  return { status: result.status, data: data };
}

export class RaceMemory {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.driver = options.driver || null;
    this.ready = null;
    this.retryAfter = 0;
    this.active = 0;
  }

  get configured() { return Boolean(this.env.NEO4J_URI && this.env.NEO4J_USERNAME && this.env.NEO4J_PASSWORD); }

  getDriver() {
    if (!this.driver) this.driver = neo4j.driver(this.env.NEO4J_URI, neo4j.auth.basic(this.env.NEO4J_USERNAME, this.env.NEO4J_PASSWORD), {
      connectionTimeout: CONFIG.memory.connectionTimeoutMs,
      connectionAcquisitionTimeout: CONFIG.memory.connectionTimeoutMs,
      maxTransactionRetryTime: 0, maxConnectionPoolSize: 4, disableLosslessIntegers: true,
    });
    return this.driver;
  }

  query(cypher, parameters = {}, read = false) {
    return this.getDriver().executeQuery(cypher, parameters, {
      database: this.env.NEO4J_DATABASE || "neo4j", routing: read ? "READ" : "WRITE",
      transactionConfig: { timeout: CONFIG.memory.queryTimeoutMs },
    });
  }

  async initialize() {
    if (!this.ready) this.ready = (async function () {
      for (const label of LABELS) {
        // Labels are constants above, never taken from requests.
        await this.query("CREATE CONSTRAINT " + label.toLowerCase() + "_id IF NOT EXISTS FOR (n:" + label + ") REQUIRE n.id IS UNIQUE");
      }
    }.bind(this))();
    await this.ready;
  }

  async perform(action) {
    if (!this.configured) return { status: "not_configured" };
    if (Date.now() < this.retryAfter) return { status: "unavailable" };
    if (this.active >= CONFIG.memory.maxConcurrentRequests) return { status: "busy" };
    this.active++;
    try {
      await this.initialize();
      return { status: "connected", data: await action() };
    } catch {
      this.ready = null;
      this.retryAfter = Date.now() + CONFIG.memory.retryDelayMs;
      // Do not expose credentials, hostnames, or private database errors.
      console.warn("[memory] Neo4j unavailable; continuing without persistent memory");
      return { status: "unavailable" };
    } finally { this.active--; }
  }

  async health() {
    return this.perform(async function () { await this.query("RETURN 1 AS ok", {}, true); return true; }.bind(this));
  }

  async saveLap(scope, lap) {
    lap = cleanScopedLap(lap, scope);
    const p = keys(scope);
    return this.perform(async function () {
      const saved = await this.query(`
        MERGE (d:RaceDriver {id: $driverKey}) SET d.dataset = $dataset
        MERGE (t:RaceTrack {id: $trackKey}) SET t.name = $trackId, t.dataset = $dataset
        MERGE (s:RaceSession {id: $sessionKey}) SET s.mode = $mode, s.dataset = $dataset
        MERGE (d)-[:DROVE]->(s) MERGE (s)-[:ON_TRACK]->(t)
        MERGE (l:RaceLap {id: $lapKey})
        ON CREATE SET l.createdAt = $now, l.payloadHash = $payloadHash, l.summary = $summary, l.lapNumber = $lapNumber, l.lapTimeSeconds = $lapTimeSeconds, l.dataset = $dataset,
          l.source = $source, l.valid = $valid, l.comparisonKey = $comparisonKey, l.startedAt = $startedAt, l.completedAt = $completedAt
        MERGE (s)-[:HAS_LAP]->(l)
        WITH l, t WHERE l.payloadHash = $payloadHash
        CALL {
        WITH l, t UNWIND $corners AS item
        MERGE (c:RaceCorner {id: $trackKey + ':' + item.name}) SET c.name = item.name
        MERGE (t)-[:HAS_CORNER]->(c)
        MERGE (a:RaceCornerAttempt {id: $lapKey + ':' + item.name}) ON CREATE SET a += item
        MERGE (l)-[:HAS_CORNER]->(a) MERGE (a)-[:AT_CORNER]->(c)
        RETURN count(a) AS attempts
        }
        RETURN l.id AS id`,
      { ...p, ...lap, source: lap.source || scope.dataset, lapKey: p.sessionKey + ":" + lap.id,
        payloadHash: lapHash(lap), now: Date.now() });
      if (!saved.records.length) return { lapId: lap.id, stored: false, reason: "lap_id_conflict" };
      return { lapId: lap.id, stored: true, outcome: await this.evaluateRecommendation(scope) };
    }.bind(this));
  }

  async context(scope, rawGoal) {
    const goal = cleanPracticeGoal(rawGoal);
    return this.perform(async function () {
      await this.evaluateRecommendation(scope);
      const result = await this.query(`
        MATCH (:RaceDriver {id: $driverKey})-[:DROVE]->(s:RaceSession)-[:ON_TRACK]->(:RaceTrack {id: $trackKey})
        WHERE s.mode = $mode
        WITH collect(s) AS sessions
        CALL {
          WITH sessions UNWIND sessions AS s MATCH (s)-[:HAS_LAP]->(l:RaceLap)
          WITH l ORDER BY l.createdAt DESC, l.id DESC LIMIT $historyLimit
          OPTIONAL MATCH (l)-[:HAS_CORNER]->(a:RaceCornerAttempt)-[:AT_CORNER]->(c:RaceCorner)
          WITH l, collect(CASE WHEN c IS NOT NULL THEN {name: c.name, timeLostSeconds: a.timeLostSeconds,
            brakedEarlyMeters: a.brakedEarlyMeters, brakedEarlySeconds: a.brakedEarlySeconds, minimumSpeedDifferenceKmh: a.minimumSpeedDifferenceKmh,
            throttlePickupLateMeters: a.throttlePickupLateMeters, observedAt: a.observedAt} END) AS corners
          ORDER BY l.createdAt DESC, l.id DESC
          RETURN collect({id: l.id, summary: left(l.summary, $summaryChars), lapNumber: l.lapNumber,
            createdAt: l.createdAt, startedAt: l.startedAt, completedAt: l.completedAt, valid: l.valid, comparisonKey: l.comparisonKey, corners: corners}) AS laps
        }
        CALL {
          WITH sessions UNWIND sessions AS s MATCH (s)-[:RECEIVED]->(tip:RaceCoaching)
          WITH tip ORDER BY tip.createdAt DESC, tip.id DESC LIMIT $adviceLimit
          RETURN collect({text: tip.text, source: tip.source}) AS advice
        }
        RETURN laps, advice`, { ...keys(scope), historyLimit: neo4j.int(CONFIG.memory.historyLimit),
        summaryChars: neo4j.int(CONFIG.memory.summaryChars), adviceLimit: neo4j.int(CONFIG.memory.adviceLimit) }, true);
      const record = result.records[0];
      const data = summarizeMemory(record ? record.get("laps") : [], record ? record.get("advice") : [], scope.dataset);
      const coaching = await this.loadCoaching(scope);
      const outcome = coaching.outcome && (coaching.outcome.goalType || "general") === goal.type && (coaching.outcome.goalCorner || "") === goal.corner ? coaching.outcome : null;
      data.coaching = { focus: chooseFocus(data.recentLaps, coaching.focus, goal), outcome: outcome };
      data.practice = practiceReport(goal, data.coaching, data.recentLaps, scope.dataset);
      return data;
    }.bind(this));
  }

  async loadCoaching(scope) {
    const result = await this.query(`
      MATCH (:RaceDriver {id: $driverKey})-[:DROVE]->(s:RaceSession)-[:ON_TRACK]->(:RaceTrack {id: $trackKey})
      WHERE s.mode = $mode
      WITH collect(s) AS sessions
      CALL {
        WITH sessions UNWIND sessions AS s MATCH (s)-[:HAS_RECOMMENDATION]->(r:RaceRecommendation)
        WHERE r.status = 'pending' AND r.shownAt IS NOT NULL
        WITH DISTINCT r ORDER BY r.shownAt ASC, r.id ASC LIMIT 1
        RETURN head(collect(properties(r))) AS focus
      }
      CALL {
        WITH sessions UNWIND sessions AS s
        MATCH (s)-[:HAS_RECOMMENDATION]->(:RaceRecommendation)-[:HAS_OUTCOME]->(e:RaceEvaluation)
        WITH DISTINCT e ORDER BY e.createdAt DESC, e.id DESC LIMIT 1
        RETURN head(collect(properties(e))) AS outcome
      }
      RETURN focus, outcome`, keys(scope), true);
    const row = result.records[0];
    return { focus: row?.get("focus") || null, outcome: row?.get("outcome") || null };
  }

  async prepareRecommendation(scope, focus) {
    if (!focus) return { status: "connected", data: null };
    if (focus.status === "pending") return { status: "connected", data: focus };
    return this.perform(async function () {
      // Neo4j properties contain scalars; evidence is linked to its original lap and attempt nodes.
      const properties = { ...focus, status: "proposed", createdAt: Date.now() };
      delete properties.evidence;
      const result = await this.query(`
        MERGE (d:RaceDriver {id: $driverKey}) SET d.dataset = $dataset
        MERGE (t:RaceTrack {id: $trackKey}) SET t.name = $trackId, t.dataset = $dataset
        MERGE (s:RaceSession {id: $sessionKey}) SET s.mode = $mode, s.dataset = $dataset
        MERGE (d)-[:DROVE]->(s) MERGE (s)-[:ON_TRACK]->(t)
        WITH s, t, d
        OPTIONAL MATCH (d)-[:DROVE]->(oldSession:RaceSession)-[:ON_TRACK]->(t)
        WHERE oldSession.mode = $mode
        OPTIONAL MATCH (oldSession)-[:HAS_RECOMMENDATION]->(old:RaceRecommendation)
        WHERE old.status IN ['pending', 'proposed'] AND old.id <> $id
        WITH s, t, collect(DISTINCT old) AS superseded
        FOREACH (previous IN superseded | SET previous.status = 'dismissed', previous.dismissalReason = 'focus_changed')
        WITH s, t MATCH (baseline:RaceLap {id: $baselineLapId})
        MERGE (r:RaceRecommendation {id: $id}) ON CREATE SET r += $properties
        MERGE (s)-[:HAS_RECOMMENDATION]->(r) MERGE (r)-[:BASED_ON]->(baseline)
        WITH r, t
        MATCH (t)-[:HAS_CORNER]->(c:RaceCorner {name: $corner})
        MERGE (r)-[:TARGETS]->(c)
        WITH r UNWIND $evidenceLapIds AS lapId
        MATCH (l:RaceLap {id: lapId})-[:HAS_CORNER]->(a:RaceCornerAttempt {name: $corner})
        MERGE (r)-[:SUPPORTED_BY]->(a)
        RETURN DISTINCT properties(r) AS focus`, { ...keys(scope), ...focus, properties: properties });
      const saved = result.records[0]?.get("focus");
      return saved && ["proposed", "pending"].includes(saved.status) ? saved : null;
    }.bind(this));
  }

  async acknowledgeRecommendation(scope, id) {
    return this.perform(async function () {
      const result = await this.query(`
        MATCH (:RaceDriver {id: $driverKey})-[:DROVE]->(s:RaceSession)-[:ON_TRACK]->(:RaceTrack {id: $trackKey})
        MATCH (s)-[:HAS_RECOMMENDATION]->(r:RaceRecommendation {id: $id})
        WHERE s.mode = $mode AND r.status IN ['proposed', 'pending']
        SET r.status = 'pending', r.shownAt = coalesce(r.shownAt, $now)
        RETURN r.id AS id`, { ...keys(scope), id: id, now: Date.now() });
      return { acknowledged: result.records.length > 0 };
    }.bind(this));
  }

  async dismissRecommendation(scope, id) {
    return this.perform(async function () {
      const result = await this.query(`
        MATCH (:RaceDriver {id: $driverKey})-[:DROVE]->(s:RaceSession)-[:ON_TRACK]->(:RaceTrack {id: $trackKey})
        MATCH (s)-[:HAS_RECOMMENDATION]->(r:RaceRecommendation {id: $id})
        WHERE s.mode = $mode AND r.status IN ['proposed', 'pending']
        SET r.status = 'dismissed', r.dismissedAt = $now RETURN r.id AS id`, { ...keys(scope), id: id, now: Date.now() });
      return { dismissed: result.records.length > 0, focus: null };
    }.bind(this));
  }

  async evaluateRecommendation(scope) {
    const coaching = await this.loadCoaching(scope);
    const focus = coaching.focus;
    if (!focus) return coaching.outcome;
    // Select the FIRST subsequent comparable attempt, even if several laps arrived before a request.
    const result = await this.query(`
      MATCH (:RaceDriver {id: $driverKey})-[:DROVE]->(s:RaceSession)-[:ON_TRACK]->(:RaceTrack {id: $trackKey})
      MATCH (s)-[:HAS_LAP]->(l:RaceLap)-[:HAS_CORNER]->(a:RaceCornerAttempt {name: $corner})
      WHERE s.mode = $mode AND l.valid = true AND l.comparisonKey = $comparisonKey
        AND l.createdAt > $shownAt AND l.id <> $baselineLapId AND a[$metric] IS NOT NULL AND a.timeLostSeconds IS NOT NULL
        AND (a.observedAt > $shownAt OR (a.observedAt IS NULL AND l.startedAt > $shownAt))
      WITH l, a ORDER BY coalesce(a.observedAt, l.startedAt) ASC, l.createdAt ASC, l.id ASC LIMIT 1
      RETURN {id: l.id, valid: l.valid, comparisonKey: l.comparisonKey, createdAt: l.createdAt, startedAt: l.startedAt,
        corners: [properties(a)]} AS lap`, { ...keys(scope), ...focus }, true);
    const lap = result.records[0]?.get("lap");
    const outcome = evaluateFocus(focus, lap);
    if (!outcome) return coaching.outcome;
    const saved = await this.query(`
      MATCH (r:RaceRecommendation {id: $recommendationId}), (l:RaceLap {id: $lapId})
      WHERE r.status = 'pending'
      MERGE (e:RaceEvaluation {id: $id}) ON CREATE SET e += $outcome, e.createdAt = $now
      SET r.status = 'evaluated'
      MERGE (r)-[:HAS_OUTCOME]->(e) MERGE (e)-[:OBSERVED_ON]->(l)
      RETURN properties(e) AS outcome`, { ...outcome, outcome: outcome, now: Date.now() });
    return saved.records[0]?.get("outcome") || coaching.outcome;
  }

  async saveCoaching(scope, tip, question) {
    return this.perform(async function () {
      await this.query(`MERGE (d:RaceDriver {id: $driverKey}) SET d.dataset = $dataset
        MERGE (t:RaceTrack {id: $trackKey}) SET t.name = $trackId, t.dataset = $dataset
        MERGE (s:RaceSession {id: $sessionKey}) SET s.mode = $mode, s.dataset = $dataset
        MERGE (d)-[:DROVE]->(s) MERGE (s)-[:ON_TRACK]->(t)
        MERGE (tip:RaceCoaching {id: $id})
        ON CREATE SET tip.text = $text, tip.source = $source, tip.question = $question, tip.createdAt = $now
        MERGE (s)-[:RECEIVED]->(tip)
        WITH tip OPTIONAL MATCH (r:RaceRecommendation {id: $recommendationId})
        FOREACH (item IN CASE WHEN r IS NULL THEN [] ELSE [r] END | MERGE (tip)-[:COMMUNICATED]->(item))`, { ...keys(scope), id: tip.analysisId ? keys(scope).sessionKey + ":analysis:" + tip.analysisId : randomUUID(), text: tip.text,
        source: tip.source, question: question, recommendationId: tip.coaching?.focus?.id || "", now: Date.now() });
      return true;
    }.bind(this));
  }

  async close() { if (this.driver) await this.driver.close(); }
}

export function installMemoryRoutes(app, memory) {
  app.get("/api/memory/status", async function (req, res) {
    if (req.query.check === "true") res.json(await memory.health());
    else res.json({ status: memory.configured ? "configured" : "not_configured" });
  });
  app.post("/api/memory/laps", async function (req, res) {
    if (req.body?.enabled !== true) { res.status(403).json({ error: "engineer_disabled" }); return; }
    let scope, lap;
    try { scope = cleanMemoryScope(req.body.scope); lap = cleanScopedLap(req.body.lap, scope); }
    catch (error) { res.status(400).json({ error: error.message }); return; }
    res.json(await memory.saveLap(scope, lap));
  });
  app.post("/api/memory/focus", async function (req, res) {
    if (req.body?.enabled !== true) { res.status(403).json({ error: "engineer_disabled" }); return; }
    let scope, goal, laps;
    try {
      scope = cleanMemoryScope(req.body.scope);
      goal = cleanPracticeGoal(req.body.practiceGoal);
      if (req.body.laps !== undefined && !Array.isArray(req.body.laps)) throw new Error("Invalid lap history");
      laps = (req.body.laps || []).slice(-CONFIG.memory.historyLimit).map(function(lap){return cleanScopedLap(lap,scope);});
    } catch (error) { res.status(400).json({ error: error.message }); return; }
    const context = await resolvePracticeContext(memory, scope, goal, laps);
    let focus = context.data.coaching.focus;
    if (context.status === "connected") {
      const prepared = await memory.prepareRecommendation(scope, focus);
      focus = prepared.status === "connected" ? prepared.data : null;
    } else if (focus) focus = { ...focus, status: "local" };
    res.json({ status: context.status, data: { focus: focus, outcome: context.data.coaching.outcome, practice: context.data.practice } });
  });
  app.post("/api/memory/focus/ack", async function (req, res) {
    if (req.body?.enabled !== true) { res.status(403).json({ error: "engineer_disabled" }); return; }
    let scope;
    try {
      scope = cleanMemoryScope(req.body.scope);
      if (typeof req.body.id !== "string" || req.body.id.length > 1000 || !req.body.id) throw new Error("Invalid recommendation ID");
    } catch (error) { res.status(400).json({ error: error.message }); return; }
    res.json(await memory.acknowledgeRecommendation(scope, req.body.id));
  });
  app.post("/api/memory/focus/dismiss", async function (req, res) {
    if (req.body?.enabled !== true) { res.status(403).json({ error: "engineer_disabled" }); return; }
    let scope;
    try {
      scope = cleanMemoryScope(req.body.scope);
      if (typeof req.body.id !== "string" || req.body.id.length > 1000 || !req.body.id) throw new Error("Invalid recommendation ID");
    } catch (error) { res.status(400).json({ error: error.message }); return; }
    res.json(await memory.dismissRecommendation(scope, req.body.id));
  });
  app.post("/api/memory/demo-next", async function (req, res) {
    if (req.body?.enabled !== true) { res.status(403).json({ error: "engineer_disabled" }); return; }
    let scope;
    try {
      scope = cleanMemoryScope(req.body.scope);
      if (scope.dataset !== "demo") throw new Error("Examples require the demo dataset");
    } catch (error) { res.status(400).json({ error: error.message }); return; }
    res.json(await memory.saveLap(scope, cleanLap({ ...MEMORY_DEMO_NEXT_LAP, startedAt: Date.now(), completedAt: Date.now() })));
  });
  app.post("/api/memory/demo", async function (req, res) {
    if (req.body?.enabled !== true) { res.status(403).json({ error: "engineer_disabled" }); return; }
    let scope;
    try { scope = cleanMemoryScope(req.body.scope); if (scope.dataset !== "demo") throw new Error("Examples require the demo dataset"); }
    catch (error) { res.status(400).json({ error: error.message }); return; }
    for (const raw of MEMORY_DEMO_LAPS) {
      const result = await memory.saveLap(scope, cleanLap(raw));
      if (result.status !== "connected" || result.data?.stored === false) { res.json(result); return; }
    }
    res.json(await memory.context(scope));
  });
}
