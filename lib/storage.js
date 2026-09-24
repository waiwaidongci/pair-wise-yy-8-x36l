import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "paper-pulp-fermentation.json");

export const seed = {
  items: [
    {
      code: "PF-001",
      source: "构树皮",
      vat: "三号缸",
      days: 5,
      owner: "林素",
      status: "发酵中",
      logs: [
        {
          at: "2026-06-15",
          step: "观察",
          note: "温度24.6，气味微酸，纤维开始松散",
          abnormal: false
        }
      ]
    }
  ]
};

// 单进程写队列：前后脚提交的两缸批次必须串行落盘，
// 否则后一个请求读到旧文件再整体写回，会盖掉前一缸的异常结果。
let chain = Promise.resolve();
let cached = null;

function migrate(db) {
  let dirty = false;
  const usedCodes = new Set();
  for (const item of db.items || []) {
    if (!item.id) {
      let id = item.code || "PF-" + Math.random().toString(36).slice(2, 8);
      let suffix = 2;
      while (usedCodes.has(id)) {
        id = (item.code || "PF") + "-" + suffix++;
      }
      usedCodes.add(id);
      item.id = id;
      dirty = true;
    }
    usedCodes.add(item.id);
    if (!item.createdAt) {
      item.createdAt = new Date().toISOString();
      dirty = true;
    }
    item.logs ||= [];
    item.observations ||= [];
    if (!item.status) {
      item.status = "入缸";
      dirty = true;
    }
    if (item.abnormalReason === undefined && (item.observations || []).length) {
      const last = [...item.observations].reverse().find(o => o.abnormal && o.reason);
      if (last) {
        item.abnormalReason = last.reason;
        item.abnormalAt = last.at;
        dirty = true;
      }
    }
  }
  return dirty;
}

async function readDb() {
  if (cached) return cached;
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  db.items ||= [];
  if (migrate(db)) await persist(db);
  cached = db;
  return db;
}

async function persist(db) {
  const tmp = dbPath + ".tmp";
  await writeFile(tmp, JSON.stringify(db, null, 2));
  await rename(tmp, dbPath);
}

export async function loadDb() {
  return readDb();
}

// 所有写操作都经过同一把队列锁，返回处理结果给调用方。
export async function mutate(handler) {
  const run = chain.then(async () => {
    const db = await readDb();
    const result = await handler(db.items);
    await persist(db);
    return result;
  });
  chain = run.catch(() => {});
  return run;
}
