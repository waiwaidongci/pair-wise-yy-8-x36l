// 状态判定模块：批次档案与观察记录共同调用的唯一状态规则来源。
// 页面与接口都不允许直接改 status，必须走这里的判定函数。

export const STATUSES = ["入缸", "发酵中", "可抄纸", "异常观察", "已退缸"];
export const READY_DAYS = 7;

// 入缸顺序由建档时间决定，早入缸的批次先退缸；同时间戳按批次编号兜底。
export function vatBlocker(item, items) {
  if (!item.vat || item.status === "已退缸") return null;
  const earlier = items
    .filter(other =>
      other.id !== item.id &&
      other.vat === item.vat &&
      other.status !== "已退缸" &&
      (String(other.createdAt || "") < String(item.createdAt || "") ||
        (String(other.createdAt || "") === String(item.createdAt || "") &&
          String(other.code || other.id) < String(item.code || item.id)))
    )
    .sort((a, b) => {
      const byTime = String(a.createdAt).localeCompare(String(b.createdAt));
      return byTime !== 0 ? byTime : String(a.code || a.id).localeCompare(String(b.code || b.id));
    });
  return earlier[0] || null;
}

// 判定次序：异常优先，满七天其次，其余继续发酵。
// 缸内还有未退缸的前序批次时，后续批次不能进入可抄纸状态。
export function evaluate(item, items, { abnormal, reason }) {
  const days = Number(item.days || 0);
  let next;
  let blockedBy = null;
  if (abnormal) {
    next = "异常观察";
  } else if (days >= READY_DAYS) {
    const blocker = vatBlocker(item, items);
    if (blocker) {
      next = "发酵中";
      blockedBy = blocker;
    } else {
      next = "可抄纸";
    }
  } else {
    next = "发酵中";
  }
  return { status: next, days, abnormal, reason, blockedBy };
}

export function vatConflictMessage(blocker, item) {
  return (
    "浸泡缸「" + item.vat + "」内还有未退缸的前序批次 " +
    blocker.code + "（负责人：" + (blocker.owner || "未填写") +
    "，当前状态：" + blocker.status + "），本批次暂不能进入可抄纸状态，需先将其退缸"
  );
}
