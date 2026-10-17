// Measured coaching decisions stay deterministic; the LLM explains this evidence.
import { cleanPracticeGoal, ruleMatchesGoal } from "../public/shared/practice-goal.js";
import { CONFIG } from "../public/config.js";

function rounded(value) { return Math.round(value * 1000) / 1000; }

export function comparisonKey(comparison) {
  if (!comparison) return null;
  return JSON.stringify([comparison.referenceId, comparison.trackVersion, comparison.physicsVersion, comparison.setupId]);
}

export function chooseFocus(laps, pending = null, rawGoal) {
  const goal = cleanPracticeGoal(rawGoal);
  const latest = laps[0];
  if (pending && (pending.goalType || "general") === goal.type && (pending.goalCorner || "") === goal.corner) return { ...pending, comparableNow: Boolean(latest?.valid && latest.comparisonKey === pending.comparisonKey) };
  // Never silently compare old summaries or laps without declared conditions.
  if (!latest?.valid || !latest.comparisonKey) return null;
  const comparable = laps.filter(function (lap) { return lap.valid && lap.comparisonKey === latest.comparisonKey; });
  const candidates = [];
  for (const corner of latest.corners || []) {
    if (goal.corner && corner.name !== goal.corner) continue;
    for (const rule of CONFIG.coachingLoop.rules) {
      if (!ruleMatchesGoal(rule.metric, goal)) continue;
      const sign = rule.direction || 1;
      if (!(corner.timeLostSeconds >= CONFIG.coachingLoop.minimumLossSeconds) ||
          !(corner[rule.metric] * sign >= rule.minimumErrorMeters)) continue;
      const evidence = [];
      for (const lap of comparable) {
        const attempt = lap.corners?.find(function (item) { return item.name === corner.name; });
        if (attempt?.timeLostSeconds >= CONFIG.coachingLoop.minimumLossSeconds && attempt[rule.metric] * sign >= rule.minimumErrorMeters) {
          evidence.push({ lapId: lap.id, timeLostSeconds: attempt.timeLostSeconds, metricValue: attempt[rule.metric] });
        }
      }
      if (evidence.length < CONFIG.coachingLoop.minimumAttempts) continue;
      let totalLoss = 0;
      for (const item of evidence) totalLoss += item.timeLostSeconds;
      const meanLoss = totalLoss / evidence.length;
      const coverage = evidence.length / comparable.length;
      candidates.push({ id: latest.id + ":focus:" + corner.name + ":" + rule.metric + ":" + goal.type + ":" + (goal.corner || "all"),
        status: "candidate", corner: corner.name, metric: rule.metric,
        goalType: goal.type, goalCorner: goal.corner,
        actionDirection: rule.metric === "brakedEarlyMeters" && sign > 0 ? "later" : "earlier",
        minimumSpeedDifferenceKmh: corner.minimumSpeedDifferenceKmh ?? null,
        baselineTimeDifferenceSeconds: corner.brakedEarlySeconds ?? null,
        actionSeconds: rule.metric === "brakedEarlyMeters" && corner.brakedEarlySeconds * sign > 0 ?
          rounded(Math.min(CONFIG.coachingLoop.maximumStepSeconds, Math.abs(corner.brakedEarlySeconds) / 2)) : null,
        comparisonKey: latest.comparisonKey, baselineLapId: latest.id,
        baselineMetric: corner[rule.metric], baselineLossSeconds: corner.timeLostSeconds,
        actionMeters: rounded(Math.min(rule.maximumStepMeters, Math.abs(corner[rule.metric]) / 2)),
        evidenceLapIds: evidence.map(function (item) { return item.lapId; }), evidence: evidence,
        meanLossSeconds: rounded(meanLoss), priorityScore: rounded(meanLoss * coverage),
        confidence: evidence.length >= CONFIG.coachingLoop.strongEvidenceAttempts && coverage === 1 ? "strong" : "moderate",
        confidenceReason: evidence.length + " matching attempts out of " + comparable.length + " comparable laps",
      });
    }
  }
  // Rank by repeated measured loss, not a claimed amount of recoverable time.
  candidates.sort(function (a, b) { return b.priorityScore - a.priorityScore || a.corner.localeCompare(b.corner) || a.metric.localeCompare(b.metric); });
  return candidates[0] || null;
}

export function evaluateFocus(focus, lap) {
  if (!lap?.valid || lap.comparisonKey !== focus.comparisonKey || lap.id === focus.baselineLapId ||
      !focus.shownAt || !(lap.createdAt > focus.shownAt)) return null;
  const corner = lap.corners?.find(function (item) { return item.name === focus.corner; });
  const attemptAt = corner?.observedAt ?? lap.startedAt;
  if (!Number.isFinite(attemptAt) || attemptAt <= focus.shownAt) return null;
  if (!Number.isFinite(corner?.[focus.metric]) || !Number.isFinite(corner?.timeLostSeconds)) return null;
  const metricChangeMeters = rounded(focus.baselineMetric - corner[focus.metric]);
  const lossChangeSeconds = rounded(focus.baselineLossSeconds - corner.timeLostSeconds);
  const errorReductionMeters = rounded(Math.abs(focus.baselineMetric) - Math.abs(corner[focus.metric]));
  const behaviorImproved = errorReductionMeters >= CONFIG.coachingLoop.meaningfulChangeMeters;
  const timeImproved = lossChangeSeconds >= CONFIG.coachingLoop.meaningfulChangeSeconds;
  let result = "unchanged";
  if (behaviorImproved && timeImproved) result = "improved";
  else if (behaviorImproved) result = "technique_changed";
  else if (timeImproved) result = "time_improved_only";
  else if (lossChangeSeconds <= -CONFIG.coachingLoop.meaningfulChangeSeconds) result = "more_time_lost";
  return { id: focus.id + ":outcome", recommendationId: focus.id, lapId: lap.id,
    baselineLapId: focus.baselineLapId, corner: focus.corner, metric: focus.metric,
    baselineMetric: focus.baselineMetric, observedMetric: corner[focus.metric],
    baselineLossSeconds: focus.baselineLossSeconds, observedLossSeconds: corner.timeLostSeconds,
    metricChangeMeters: metricChangeMeters, errorReductionMeters: errorReductionMeters, lossChangeSeconds: lossChangeSeconds,
    goalType: focus.goalType || "general", goalCorner: focus.goalCorner || "", result: result, causalClaim: false };
}
