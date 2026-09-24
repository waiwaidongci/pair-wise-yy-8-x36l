// 观察记录模块：温度、气味、纤维、换水、异常原因的规范化与汇总。

export function isAbnormalFlag(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null || value === "") return false;
  const text = String(value).trim();
  return ["是", "有", "true", "1", "yes", "on"].includes(text.toLowerCase()) ||
    text.includes("异味") || text.includes("霉");
}

// 老数据里 abnormal 是自由文本（"是"/"有霉点"），统一规范但不丢原始内容。
export function normalizeObservation(input = {}) {
  const abnormal = isAbnormalFlag(input.abnormal);
  const observation = {
    at: new Date().toISOString(),
    temperature: String(input.temperature ?? "").trim(),
    smell: String(input.smell ?? "").trim(),
    fiber: String(input.fiber ?? "").trim(),
    changedWater: String(input.changedWater ?? "").trim(),
    abnormal
  };
  if (abnormal) {
    observation.reason = String(
      input.reason ?? (typeof input.abnormal === "string" && !["是", "true", "1", "on"].includes(String(input.abnormal).trim().toLowerCase()) ? input.abnormal : "")
    ).trim();
  }
  return observation;
}

export function observationNote(obs) {
  const parts = ["温度" + (obs.temperature || "未填")];
  if (obs.smell) parts.push("气味：" + obs.smell);
  if (obs.fiber) parts.push("纤维：" + obs.fiber);
  if (obs.changedWater) parts.push("换水：" + obs.changedWater);
  if (obs.abnormal) parts.push("异常：" + (obs.reason || "异味或霉点"));
  return parts.join("，");
}

export function summarize(item) {
  const abnormalCount = (item.observations || []).filter(o => o.abnormal).length;
  const latest = (item.observations || []).slice(-1)[0];
  const logCount =
    (item.logs || []).length +
    (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0);
  return {
    ...item,
    logCount,
    abnormalCount,
    lastObservationAt: latest ? latest.at : null
  };
}
