// 全新安装时的示例数据：三号缸里两批前后脚入缸，
// 都满七天后前一批未退缸，后一批应被挡在“发酵中”（可抄纸条件已满足但排队）。

import { STATUS } from "./status.js";
import { normalizeObservation } from "./observations.js";

function obs(raw, index) {
  return normalizeObservation(raw, index);
}

export function seedData() {
  return {
    version: 2,
    items: [
      {
        id: "PF-SEED-001",
        code: "PF-001",
        source: "构树皮",
        vat: "三号缸",
        days: 7,
        owner: "林素",
        createdAt: "2026-06-08T01:00:00.000Z",
        withdrawnAt: null,
        status: STATUS.READY,
        observations: [
          obs({ at: "2026-06-09T02:00:00.000Z", temperature: "24.6", smell: "微酸", fiber: "开始松散", changedWater: "否", abnormal: false }, 0),
          obs({ at: "2026-06-15T02:00:00.000Z", temperature: "25.1", smell: "微酸", fiber: "松散", changedWater: "是", abnormal: false }, 1),
        ],
        logs: [
          { at: "2026-06-08T01:00:00.000Z", step: "建档", note: "入缸三号缸，负责人林素" },
        ],
      },
      {
        id: "PF-SEED-002",
        code: "PF-002",
        source: "桑皮",
        vat: "三号缸",
        days: 7,
        owner: "林素",
        createdAt: "2026-06-09T01:00:00.000Z",
        withdrawnAt: null,
        status: STATUS.FERMENTING,
        observations: [
          obs({ at: "2026-06-10T02:00:00.000Z", temperature: "24.8", smell: "正常", fiber: "开始松散", changedWater: "否", abnormal: false }, 0),
        ],
        logs: [
          { at: "2026-06-09T01:00:00.000Z", step: "建档", note: "入缸三号缸，负责人林素" },
        ],
      },
    ],
  };
}
