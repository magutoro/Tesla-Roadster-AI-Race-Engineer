// An evidence card and small experiment, not an invented optimal lap.
import { PRACTICE_GOALS, cleanPracticeGoal } from "../public/shared/practice-goal.js";
import { focusText, outcomeText } from "../public/shared/coaching-text.js";
export function practiceReport(rawGoal, coaching, laps, dataset) {
  const goal = cleanPracticeGoal(rawGoal);
  const focus = coaching?.focus;
  const label = PRACTICE_GOALS[goal.type] + (goal.corner ? " · " + goal.corner : "");
  const prefix = dataset === "demo" ? "Example data. " : "";
  if (!focus) {
    const latest = laps[0];
    const comparable = latest?.valid && latest.comparisonKey ? laps.filter(function (lap) { return lap.valid && lap.comparisonKey === latest.comparisonKey; }) : [];
    let next = "I need two valid comparable laps with measured corner losses, braking points and speed differences. Complete clean laps against one fixed reference.";
    if (comparable.length >= 2) next = "No repeated measured braking/throttle issue matches this goal yet. Keep the reference fixed and collect another clean lap; speed alone does not establish a braking adjustment.";
    if (coaching?.outcome) next = outcomeText(coaching.outcome, "en", dataset);
    return { goal: goal, label: label, evidence: [], text: prefix + "Goal: " + label + ". " + next };
  }
  const evidence = [focus.evidenceLapIds.length + " supporting laps; average measured loss " + focus.meanLossSeconds + " s."];
  if (Number.isFinite(focus.minimumSpeedDifferenceKmh)) evidence.push("Latest minimum speed: " + Math.abs(focus.minimumSpeedDifferenceKmh) + " km/h " + (focus.minimumSpeedDifferenceKmh < 0 ? "below" : "above") + " reference.");
  else if (goal.type === "corner_speed") evidence.push("Minimum-speed comparison is missing; this is a braking/throttle experiment, not proof of a speed improvement.");
  if (focus.metric === "brakedEarlyMeters") evidence.push("Latest braking: " + Math.abs(focus.baselineMetric) + " m " + (focus.baselineMetric >= 0 ? "earlier" : "later") + " than reference.");
  else evidence.push("Latest throttle pickup: " + focus.baselineMetric + " m later than reference.");
  if (focus.metric === "brakedEarlyMeters" && !focus.actionSeconds) evidence.push("No compatible measured braking-time offset; the cue uses metres, not seconds.");
  return { goal: goal, label: label, evidence: evidence, text: prefix + "Goal: " + label + ". " +
    (focus.comparableNow === false ? "Conditions changed. Restore the reference/setup before testing this cue." : focusText(focus)) +
    " Based on " + focus.evidenceLapIds.length + " matching laps, averaging " + focus.meanLossSeconds + " s lost. Change only this input; compare the next valid attempt." };
}
