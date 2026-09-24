# 古法纸浆发酵记录

运行：

```bash
npm start
```

访问 `http://localhost:3039`。数据保存在 `data/paper-pulp-fermentation.json`。

## 业务模块

批次档案、观察记录、状态判定拆成可复用模块，接口和页面从同一处读写：

| 文件 | 职责 |
| --- | --- |
| `lib/status.js` | 纯状态判定（异常优先 → 满七天 → 发酵中）、同缸前序未退缸批次拦截；服务端和页面 `/shared/status.js` 共用同一份代码 |
| `lib/observations.js` | 温度/纤维观察记录的结构化、校验；异常原因逐条保留，只追加不覆盖 |
| `lib/batches.js` | 批次档案用例：建档、记录观察、退缸、列表汇总（异常次数、最近观察时间）、旧数据迁移 |
| `lib/store.js` | JSON 数据的唯一读写口，读-改-写串行化，前后脚提交不会互相覆盖 |
| `lib/errors.js` / `lib/seed.js` | 业务错误类型 / 全新安装示例数据 |
| `public/` | 页面，仅通过 API 读写，并直接 import `lib` 下的判定模块 |

## 状态规则

每次记录温度和纤维情况后，由 `lib/status.js` 统一确定状态，页面上不能手工改状态：

1. 最新一次观察标记异常 → **异常观察**，异常原因随该条记录长期保留（标记异常时原因必填）；
2. 否则发酵天数满 7 天 → **可抄纸**；
3. 其余 → 发酵中 / 入缸。

同一浸泡缸里还有更早入缸且未退缸的批次时，后续批次即使满足条件也不能进入可抄纸状态：
提交返回 `409 vat_blocked` 并在提示中给出挡路批次编号和负责人，观察记录照常保存；
前序批次退缸后，后续批次无需补记录，再次读取时自动变为可抄纸。

## 接口

- `GET /api/batches?sort=recent|abnormal` 列表（含异常次数、最近观察时间）
- `POST /api/batches` 建档
- `GET /api/batches/:id` 批次详情（含全部历史观察）
- `POST /api/batches/:id/observations` 记录观察（重算状态，缸位冲突返回 409，记录仍保留）
- `POST /api/batches/:id/withdraw` 批次退缸，释放缸位
- `GET /api/stats` 状态统计
