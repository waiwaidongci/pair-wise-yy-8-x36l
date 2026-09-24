// 观察记录模块：温度与纤维情况的结构化、异常判定与异常原因留存。
// 记录只追加不覆盖，异常原因跟随每一条观察保存，不会被后提交的记录盖掉。

import { ValidationError } from "./errors.js";

let observationSeq = 0;
function newObservationId() {
  observationSeq += 1;
  return `OBS-${Date.now().toString(36)}-${observationSeq}`;
}

const POSITIVE_WORDS = ["是", "有", "霉", "异味", "异常"];
const NEGATIVE_WORDS = ["否", "无", "未", "正常"];

// “是否异常”字段兼容布尔值和旧版自由文本（“是/有异味”等）
export function parseAbnormal(value) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (NEGATIVE_WORDS.some((w) => text.includes(w))) return false;
  return POSITIVE_WORDS.some((w) => text.includes(w));
}

// 把接口/页面提交的原始字段整理成一条观察记录
export function buildObservation(input = {}, now = new Date().toISOString()) {
  const temperature = String(input.temperature ?? "").trim();
  const fiber = String(input.fiber ?? "").trim();
  const smell = String(input.smell ?? "").trim();
  const changedWater = String(input.changedWater ?? "").trim();
  const abnormal = parseAbnormal(input.abnormal);
  const abnormalReason = String(
    input.abnormalReason ?? (abnormal ? input.note ?? "" : "")
  ).trim();

  if (!temperature) throw new ValidationError("请填写温度");
  if (!fiber) throw new ValidationError("请填写纤维松散度");
  if (abnormal && !abnormalReason) {
    throw new ValidationError("标记异常时必须填写异常原因");
  }

  return {
    id: newObservationId(),
    at: input.at || now,
    temperature,
    smell,
    fiber,
    changedWater,
    abnormal,
    abnormalReason: abnormal ? abnormalReason : "",
  };
}

// 兼容旧数据：早期记录可能缺 id 或异常原因字段
export function normalizeObservation(raw, index = 0) {
  const abnormal = typeof raw.abnormal === "boolean" ? raw.abnormal : parseAbnormal(raw.abnormal);
  return {
    id: raw.id || `OBS-LEGACY-${index + 1}`,
    at: raw.at || "",
    temperature: String(raw.temperature ?? "").trim(),
    smell: String(raw.smell ?? "").trim(),
    fiber: String(raw.fiber ?? "").trim(),
    changedWater: String(raw.changedWater ?? "").trim(),
    abnormal,
    abnormalReason: abnormal ? String(raw.abnormalReason ?? "").trim() : "",
  };
}

// 汇总观察日志的文本，沿用旧版日志可读风格
export function describeObservation(observation) {
  const parts = [`温度${observation.temperature}`];
  if (observation.smell) parts.push(observation.smell);
  if (observation.fiber) parts.push(observation.fiber);
  if (observation.changedWater) parts.push(`换水${observation.changedWater}`);
  if (observation.abnormal) {
    parts.push(`异常：${observation.abnormalReason || "未填写原因"}`);
  }
  return parts.join("，");
}
