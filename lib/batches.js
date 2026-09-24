// 批次档案模块：批次建档、观察记录、退缸、列表汇总与旧数据迁移。
// 这是批次数据的唯一业务入口（接口和页面都经过这里的规则），
// 不允许绕过判定逻辑直接改状态。

import { ValidationError, NotFoundError, ConflictError } from "./errors.js";
import {
  STATUS,
  STATUSES,
  refreshStatus,
  latestObservation,
  abnormalCount,
  lastObservedAt,
  meetsPaperCondition,
  enteredAt,
} from "./status.js";
import {
  buildObservation,
  normalizeObservation,
  describeObservation,
} from "./observations.js";

export { STATUSES };

let batchSeq = 0;
export function newId() {
  batchSeq += 1;
  return `PF-${Date.now().toString(36)}-${batchSeq}`;
}

function nowIso() {
  return new Date().toISOString();
}

// 把一条批次记录规范成当前档案结构；旧数据（无 id/observations）就地兼容
export function normalizeBatch(raw = {}, index = 0) {
  const batch = {
    id: raw.id || raw.code || `PF-LEGACY-${index + 1}`,
    code: String(raw.code ?? "").trim(),
    source: String(raw.source ?? "").trim(),
    vat: String(raw.vat ?? "").trim(),
    days: Number.isFinite(Number(raw.days)) ? Number(raw.days) : 0,
    owner: String(raw.owner ?? "").trim(),
    createdAt: raw.createdAt || "",
    withdrawnAt: raw.withdrawnAt || null,
    status: raw.status || STATUS.IN_VAT,
    observations: (raw.observations || []).map(normalizeObservation),
    logs: Array.isArray(raw.logs) ? raw.logs : [],
  };
  return batch;
}

function findBatch(db, idOrCode) {
  return db.items.find((x) => x.id === idOrCode || x.code === idOrCode) || null;
}

// 列表行：异常次数与最近观察时间直接来自观察记录，供排序展示
export function summarize(batch, allBatches = []) {
  refreshStatus(batch, allBatches);
  const latest = latestObservation(batch);
  return {
    ...batch,
    abnormalCount: abnormalCount(batch),
    lastObservedAt: lastObservedAt(batch),
    latestAbnormalReason: latest && latest.abnormal ? latest.abnormalReason : "",
    meetsPaperCondition: meetsPaperCondition(batch),
  };
}

export function listBatches(db) {
  return db.items.map((item) => summarize(item, db.items));
}

export function getBatch(db, idOrCode) {
  const batch = findBatch(db, idOrCode);
  if (!batch) throw new NotFoundError();
  return summarize(batch, db.items);
}

export function createBatch(db, input = {}) {
  const code = String(input.code ?? "").trim();
  const source = String(input.source ?? "").trim();
  const vat = String(input.vat ?? "").trim();
  const owner = String(input.owner ?? "").trim();
  const days = input.days === "" || input.days == null ? 0 : Number(input.days);

  if (!code) throw new ValidationError("请填写批次编号");
  if (!vat) throw new ValidationError("请填写浸泡缸");
  if (!owner) throw new ValidationError("请填写负责人");
  if (!Number.isFinite(days) || days < 0) throw new ValidationError("发酵天数不合法");
  if (findBatch(db, code)) throw new ValidationError(`批次编号 ${code} 已存在`);

  const batch = normalizeBatch({
    id: newId(),
    code,
    source,
    vat,
    owner,
    days,
    createdAt: nowIso(),
    status: STATUS.IN_VAT,
  });
  batch.logs.push({ at: batch.createdAt, step: "建档", note: `入缸${vat}，负责人${owner}` });

  db.items.push(batch);
  refreshStatus(batch, db.items);
  return summarize(batch, db.items);
}

// 每次记录温度和纤维情况后落一条观察，再按统一规则确定状态
export function recordObservation(db, idOrCode, input = {}) {
  const batch = findBatch(db, idOrCode);
  if (!batch) throw new NotFoundError();
  if (batch.status === STATUS.WITHDRAWN) {
    throw new ConflictError(
      "batch_withdrawn",
      `批次 ${batch.code} 已退缸，不能继续记录观察`
    );
  }

  const observation = buildObservation(input);
  batch.observations.push(observation);
  batch.days = Number(batch.days || 0) + 1;
  batch.logs.push({
    at: observation.at,
    step: observation.abnormal ? "异常观察" : "观察",
    note: describeObservation(observation),
  });

  const result = refreshStatus(batch, db.items);
  const summary = summarize(batch, db.items);

  // 冲突但记录已保留：前序未退缸批次占位，本批次不能进入可抄纸状态
  if (result.blocker) {
    throw new ConflictError("vat_blocked",
      `批次 ${result.blocker.code}（${result.blocker.owner || "负责人未定"}）` +
      `仍在${batch.vat}未退缸，本批次暂时不能进入可抄纸状态，观察记录已保存`,
      { batch: summary, blockedBy: summary.blockedBy }
    );
  }
  return summary;
}

// 退缸：释放缸位，之后同一缸后续批次再次读取时即可进入可抄纸状态
export function withdrawBatch(db, idOrCode, input = {}) {
  const batch = findBatch(db, idOrCode);
  if (!batch) throw new NotFoundError();
  if (batch.status === STATUS.WITHDRAWN) {
    throw new ConflictError("batch_withdrawn", `批次 ${batch.code} 已退缸，请勿重复操作`);
  }
  const at = nowIso();
  batch.status = STATUS.WITHDRAWN;
  batch.withdrawnAt = at;
  batch.blockedBy = null;
  batch.logs.push({
    at,
    step: "退缸",
    note: input.note ? `批次退缸：${String(input.note).trim()}` : "批次退缸，释放浸泡缸",
  });
  // 退缸可能放行同缸后续批次，统一重算全部状态
  for (const other of db.items) refreshStatus(other, db.items);
  return summarize(batch, db.items);
}

export function computeStats(batches) {
  const stats = Object.fromEntries(STATUSES.map((label) => [label, 0]));
  for (const batch of batches) {
    if (stats[batch.status] !== undefined) stats[batch.status] += 1;
  }
  return stats;
}

// 列表排序：支持按异常次数、最近观察时间；空观察时间沉底
export function sortBatches(batches, key = "recent") {
  const copy = [...batches];
  const byEntered = (a, b) => enteredAt(b).localeCompare(enteredAt(a));
  if (key === "abnormal") {
    copy.sort((a, b) =>
      abnormalCount(b) - abnormalCount(a) ||
      String(lastObservedAt(b) || "").localeCompare(String(lastObservedAt(a) || "")) ||
      byEntered(a, b)
    );
  } else {
    copy.sort((a, b) =>
      String(lastObservedAt(b) || "").localeCompare(String(lastObservedAt(a) || "")) ||
      byEntered(a, b)
    );
  }
  return copy;
}
