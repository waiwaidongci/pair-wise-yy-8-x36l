// 存储模块：批次档案的唯一读写口。
// 所有业务用例都在 update() 的读-改-写临界区内执行并串行化，
// 两缸批次前后脚提交时不会互相覆盖。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeBatch } from "./batches.js";
import { refreshStatus } from "./status.js";
import { seedData } from "./seed.js";
import { ValidationError, NotFoundError, ConflictError } from "./errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "paper-pulp-fermentation.json");

let chain = Promise.resolve();

async function readRaw() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seedData(), null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}

// 兼容旧版本落库文件：补齐新结构并重算状态（幂等）
function migrate(db) {
  if (!Array.isArray(db.items)) db.items = [];
  if (db.version >= 2) return db;

  db.items = db.items.map((raw, index) => {
    const batch = normalizeBatch(raw, index);
    if (!batch.createdAt) {
      batch.createdAt = batch.logs[0]?.at || `2026-01-01T00:00:${String(index).padStart(2, "0")}Z`;
    }
    return batch;
  });
  for (const batch of db.items) refreshStatus(batch, db.items);
  db.version = 2;
  return db;
}

async function persist(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
  return db;
}

// 只读：每次取最新落库内容，迁移不写回
export async function loadDb() {
  return migrate(await readRaw());
}

// 读-改-写：mutator 返回的结果透传给调用方
export async function updateDb(mutator) {
  const run = chain.then(async () => {
    const db = migrate(await readRaw());
    try {
      const result = await mutator(db);
      await persist(db);
      return result;
    } catch (error) {
      // 业务冲突（如缸位排队）发生在记录已写入之后：先落库保留数据，再把提示抛给接口
      if (error instanceof ConflictError) await persist(db);
      // 参数/不存在等错误没有改动数据，直接抛出不落库
      if (error instanceof ValidationError || error instanceof NotFoundError || error instanceof ConflictError) throw error;
      throw error;
    }
  });
  // 无论本次成败都释放“锁”，不阻塞后续请求
  chain = run.then(() => {}, () => {});
  return run;
}
