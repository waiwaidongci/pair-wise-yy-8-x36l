// 状态判定模块：纯函数，无文件/网络依赖。
// 服务端业务用例与页面端 /public/app.js 从同一份代码读写判定规则，
// 避免“接口一套、页面一套”导致状态被盖掉。

// 满 7 天才满足抄纸条件
export const FERMENT_DAYS = 7;

export const STATUS = {
  IN_VAT: "入缸",
  FERMENTING: "发酵中",
  READY: "可抄纸",
  ABNORMAL: "异常观察",
  WITHDRAWN: "已退缸",
};

export const STATUSES = [
  STATUS.IN_VAT,
  STATUS.FERMENTING,
  STATUS.READY,
  STATUS.ABNORMAL,
  STATUS.WITHDRAWN,
];

// 还浸泡在缸里的批次都算占用缸位（异常批次也要人工处理后才能退缸）
export function isInVat(batch) {
  return batch.status !== STATUS.WITHDRAWN;
}

// 入缸顺序：先建档的批次在前；老数据没有 createdAt 时退回批次编号
export function enteredAt(batch) {
  return batch.createdAt || "";
}

export function isEarlierInVat(a, b) {
  const ta = enteredAt(a);
  const tb = enteredAt(b);
  if (ta && tb && ta !== tb) return ta < tb;
  return String(a.code || "") < String(b.code || "");
}

// 同一浸泡缸里、入缸更早且尚未退缸的批次
export function earlierBatchesInVat(batch, allBatches) {
  return allBatches
    .filter((other) =>
      other.id !== batch.id &&
      other.vat &&
      other.vat === batch.vat &&
      isInVat(other) &&
      isEarlierInVat(other, batch))
    .sort((a, b) => isEarlierInVat(a, b) ? -1 : 1);
}

export function latestObservation(batch) {
  const observations = batch.observations || [];
  return observations.length ? observations[observations.length - 1] : null;
}

// 异常次数：观察记录逐条保留，次数以记录条数为准而不是只看最后一条
export function abnormalCount(batch) {
  return (batch.observations || []).filter((o) => o.abnormal).length;
}

export function lastObservedAt(batch) {
  const latest = latestObservation(batch);
  return latest ? latest.at : null;
}

// 不考虑缸内排队时，本批次自身满足的状态：
// 异常优先，满七天其次，其余继续发酵
export function ownStatus(batch) {
  const latest = latestObservation(batch);
  if (latest && latest.abnormal) return STATUS.ABNORMAL;
  if (Number(batch.days || 0) >= FERMENT_DAYS) return STATUS.READY;
  return latest ? STATUS.FERMENTING : STATUS.IN_VAT;
}

// 批次自身是否已满足抄纸条件（满七天且最新一次观察无异常）
export function meetsPaperCondition(batch) {
  const latest = latestObservation(batch);
  return Number(batch.days || 0) >= FERMENT_DAYS && !(latest && latest.abnormal);
}

// 统一状态出口：服务端落库、接口返回、页面展示都走这里。
// 同一浸泡缸里还有未退缸的前序批次时，后续批次不能进入可抄纸状态，
// 等前序批次退缸后再次读取时自动放行（无需补记录）。
export function deriveStatus(batch, allBatches = []) {
  if (batch.status === STATUS.WITHDRAWN) {
    return { status: STATUS.WITHDRAWN, blocker: null };
  }
  if (ownStatus(batch) === STATUS.READY) {
    const blocker = earlierBatchesInVat(batch, allBatches)[0] || null;
    if (blocker) return { status: STATUS.FERMENTING, blocker };
  }
  return { status: ownStatus(batch), blocker: null };
}

export function refreshStatus(batch, allBatches = []) {
  const result = deriveStatus(batch, allBatches);
  batch.status = result.status;
  batch.blockedBy = result.blocker ? {
    id: result.blocker.id,
    code: result.blocker.code,
    vat: result.blocker.vat,
    owner: result.blocker.owner,
  } : null;
  return result;
}
