// Shared goal vocabulary; setting a goal never enables paid automatic tips.
export const PRACTICE_GOALS = {
  general: "Overall driving", corner_speed: "Corner speed", braking: "Braking", corner_exit: "Corner exit / throttle",
};
export function cleanPracticeGoal(raw) {
  if (!raw) return { type: "general", corner: "" };
  if (!Object.hasOwn(PRACTICE_GOALS, raw.type)) throw new Error("Unknown practice goal");
  const corner = raw.corner || "";
  if (typeof corner !== "string" || (corner && !/^[A-Za-z0-9_-]{1,100}$/.test(corner))) throw new Error("Invalid goal corner");
  return { type: raw.type, corner: corner };
}
export function inferPracticeGoal(text) {
  if (!/(?:want|wanna|work on|focus on|practi[cs]e|improve|練習|改善)/i.test(text)) return null;
  let type;
  if (/(?:corner.{0,15}(?:speed|faster)|carry.{0,15}speed|コーナー速度)/i.test(text)) type = "corner_speed";
  else if (/(?:brak|break|ブレーキ)/i.test(text)) type = "braking";
  else if (/(?:throttle|corner exit|exit speed|gas|アクセル|立ち上がり)/i.test(text)) type = "corner_exit";
  else return null;
  const match = text.match(/\b(?:T|turn\s*|corner\s*)(\d{1,3})\b/i);
  return { type: type, corner: match ? "T" + Number(match[1]) : "" };
}
export function ruleMatchesGoal(metric, goal) {
  if (goal.type === "braking") return metric === "brakedEarlyMeters";
  if (goal.type === "corner_exit") return metric === "throttlePickupLateMeters";
  return true;
}
