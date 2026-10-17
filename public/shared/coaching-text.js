// Shared presentation for deterministic, measured coaching.
export function focusText(focus, lang = "en", dataset = "live") {
  const example = dataset === "demo" ? (lang === "ja" ? "例のデータ: " : "Example data: ") : "";
  if (focus.metric === "brakedEarlyMeters") {
    const amount = focus.actionSeconds > 0 ? focus.actionSeconds + " s" : focus.actionMeters + " m";
    const direction = focus.actionDirection || "later";
    return example + (lang === "ja" ? focus.corner + "では次の有効な周回でブレーキ位置を" + amount + (direction === "later" ? "遅らせて" : "早めて") + "比較しましょう。" :
      "At " + focus.corner + ", try braking " + amount + " " + direction + " on the next valid lap, then compare.");
  }
  return example + (lang === "ja" ? focus.corner + "では次の有効な周回でアクセル開始を" + focus.actionMeters + "m早めて比較しましょう。" :
    "At " + focus.corner + ", try picking up throttle " + focus.actionMeters + " m earlier on the next valid lap, then compare.");
}

export function outcomeText(outcome, lang = "en", dataset = "live") {
  const example = dataset === "demo" ? (lang === "ja" ? "例: " : "Example: ") : "";
  const movement = Math.abs(outcome.metricChangeMeters);
  const change = Math.abs(outcome.lossChangeSeconds);
  if (lang === "ja") {
    return example + outcome.corner + "の操作位置の変化は" + outcome.metricChangeMeters + "m、タイムロスは" +
      (outcome.lossChangeSeconds >= 0 ? change + "秒減少" : change + "秒増加") + "。同条件の1回の比較で、因果関係は未確認です。";
  }
  let behavior;
  if (outcome.metric === "brakedEarlyMeters") behavior = "braking moved " + movement + " m " + (outcome.metricChangeMeters >= 0 ? "later" : "earlier");
  else behavior = "throttle pickup moved " + movement + " m " + (outcome.metricChangeMeters >= 0 ? "earlier" : "later");
  return example + outcome.corner + " " + behavior + "; time loss " + (outcome.lossChangeSeconds >= 0 ? "fell " : "rose ") +
    change + " s versus the pre-cue lap. One comparable attempt; cause unproven.";
}

// Never finish a spoken answer halfway through a word or sentence at the output limit.
export function naturalReply(value, limit) {
  if (typeof value !== "string") return "";
  const text=value.trim();
  if(text.length<limit) return text;
  const clipped=text.slice(0,limit);
  const endings=Array.from(clipped.matchAll(/[.!?](?=\s|$)/g));
  const end=endings.at(-1)?.index;
  if(end!==undefined && end>=40) return clipped.slice(0,end+1);
  return clipped.replace(/\s+\S*$/,"").trim()+"…";
}
