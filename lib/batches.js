// 批次档案模块：批次建档、观察提交、状态判定、退缸都从这里读写，
// HTTP 接口和页面渲染共用同一套业务函数，保证只有一处数据口径。

import { loadDb, mutate } from "./storage.js";
import { evaluate, vatConflictMessage } from "./status.js";
import {
  normalizeObservation,
  observationNote,
  summarize
} from "./observations.js";

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

const ARCHIVE_FIELDS = ["code", "source", "vat", "days", "owner"];

export async function listBatches() {
  const db = await loadDb();
  return db.items.map(summarize);
}

export async function getBatch(id) {
  const db = await loadDb();
  const item = findBatch(db.items, id);
  return summarize(item);
}

function findBatch(items, id) {
  const item = items.find(x => x.id === id || x.code === id);
  if (!item) throw new HttpError(404, "item_not_found", "批次不存在或已删除");
  return item;
}

function newId(items) {
  const base = "PF-" + Date.now();
  let id = base;
  let n = 2;
  while (items.some(x => x.id === id || x.code === id)) id = base + "-" + n++;
  return id;
}

export async function createBatch(input = {}) {
  return mutate(items => {
    const code = String(input.code ?? "").trim();
    if (!code) throw new HttpError(400, "code_required", "批次编号不能为空");
    if (items.some(x => x.code === code)) {
      throw new HttpError(409, "code_duplicated", "批次编号 " + code + " 已存在");
    }
    const now = new Date().toISOString();
    const item = {
      id: newId(items),
      code,
      source: String(input.source ?? "").trim(),
      vat: String(input.vat ?? "").trim(),
      days: Math.max(0, Number(input.days) || 0),
      owner: String(input.owner ?? "").trim(),
      status: "入缸",
      observations: [],
      abnormalReason: null,
      abnormalAt: null,
      createdAt: now,
      logs: [{ at: now, step: "建档", note: "创建纸浆批次，初始状态：入缸" }]
    };
    items.unshift(item);
    return summarize(item);
  });
}

// 只允许改档案字段；状态不能由外部直接指定，避免后提交的请求覆盖判定结果。
export async function updateArchive(id, input = {}) {
  return mutate(items => {
    const item = findBatch(items, id);
    if (Object.prototype.hasOwnProperty.call(input, "status")) {
      throw new HttpError(403, "status_readonly", "状态由观察记录自动判定，请通过每日观察或退缸操作变更");
    }
    for (const field of ARCHIVE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
      if (field === "code") {
        const code = String(input.code ?? "").trim();
        if (!code) throw new HttpError(400, "code_required", "批次编号不能为空");
        if (items.some(x => x !== item && x.code === code)) {
          throw new HttpError(409, "code_duplicated", "批次编号 " + code + " 已存在");
        }
        item.code = code;
      } else if (field === "days") {
        item.days = Math.max(0, Number(input.days) || 0);
      } else {
        item[field] = String(input[field] ?? "").trim();
      }
    }
    item.logs.push({
      at: new Date().toISOString(),
      step: "档案",
      note: "更新批次档案信息"
    });
    return summarize(item);
  });
}

export async function addNote(id, input = {}) {
  return mutate(items => {
    const item = findBatch(items, id);
    const note = String(input.note ?? "").trim();
    if (!note) throw new HttpError(400, "note_required", "备注内容不能为空");
    item.logs.push({ at: new Date().toISOString(), step: input.step || "备注", note });
    return summarize(item);
  });
}

// 提交一次观察：记录先落盘，再按「异常优先、满七天其次」判定状态。
// 缸内有未退缸前序批次时，满七天也只能留在发酵中，并返回明确冲突提示。
export async function recordObservation(id, input = {}) {
  return mutate(items => {
    const item = findBatch(items, id);
    if (item.status === "已退缸") {
      throw new HttpError(400, "batch_retired", "批次 " + item.code + " 已退缸，不能继续记录观察");
    }
    const observation = normalizeObservation(input);
    item.observations.push(observation);
    // 建档天数是已发酵天数；每提交一次每日观察，发酵天数 +1。
    // 兜底 max(observations.length) 用于迁移前没有 days 累计的老数据。
    item.days = Math.max(Number(item.days) || 0, item.observations.length - 1) + 1;

    const result = evaluate(item, items, {
      abnormal: observation.abnormal,
      reason: observation.reason
    });

    item.status = result.status;
    if (observation.abnormal) {
      item.abnormalReason = observation.reason || "异味或霉点";
      item.abnormalAt = observation.at;
    } else if (item.status === "可抄纸") {
      item.abnormalReason = null;
      item.abnormalAt = null;
    }

    let note = observationNote(observation);
    let conflict = null;
    if (observation.abnormal) {
      note += "；判定为异常观察";
    } else if (result.blockedBy) {
      note += "；已满七天，" + vatConflictMessage(result.blockedBy, item) + "，暂判为发酵中";
      conflict = {
        code: "vat_blocked",
        message: vatConflictMessage(result.blockedBy, item),
        blocker: {
          id: result.blockedBy.id,
          code: result.blockedBy.code,
          owner: result.blockedBy.owner,
          status: result.blockedBy.status
        }
      };
    } else if (result.status === "可抄纸") {
      note += "；发酵满七天，判定为可抄纸";
    } else {
      note += "；判定为发酵中";
    }

    item.logs.push({ at: observation.at, step: "观察", note, abnormal: observation.abnormal });

    return { item: summarize(item), observation, conflict };
  });
}

export async function retireBatch(id, input = {}) {
  return mutate(items => {
    const item = findBatch(items, id);
    if (item.status === "已退缸") {
      throw new HttpError(409, "already_retired", "批次 " + item.code + " 已经退缸");
    }
    const previous = item.status;
    item.status = "已退缸";
    item.retiredAt = new Date().toISOString();
    const note = String(input.note ?? "").trim();
    item.logs.push({
      at: item.retiredAt,
      step: "退缸",
      note: "批次退缸，原状态：" + previous + (note ? "；" + note : "")
    });

    // 前序批次退缸后，同缸已满七天且无异常的后续批次解除阻塞，重判为可抄纸。
    for (const later of items) {
      if (later === item || later.vat !== item.vat || later.status === "已退缸") continue;
      if (Number(later.days || 0) < 7 || later.status === "异常观察") continue;
      const result = evaluate(later, items, { abnormal: false });
      if (result.status === "可抄纸" && later.status !== "可抄纸") {
        later.status = "可抄纸";
        later.abnormalReason = null;
        later.abnormalAt = null;
        later.logs.push({
          at: new Date().toISOString(),
          step: "状态",
          note: "前序批次 " + item.code + " 已退缸，本批次已满七天，重判为可抄纸"
        });
      }
    }
    return summarize(item);
  });
}
