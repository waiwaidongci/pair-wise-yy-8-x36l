import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDb, updateDb } from "./lib/store.js";
import {
  listBatches,
  getBatch,
  createBatch,
  recordObservation,
  withdrawBatch,
  computeStats,
  sortBatches,
} from "./lib/batches.js";
import { ValidationError, NotFoundError, ConflictError } from "./lib/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 3039);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function errorResponse(res, error) {
  if (error instanceof ValidationError) return send(res, 400, { error: "validation_error", message: error.message });
  if (error instanceof NotFoundError) return send(res, 404, { error: error.code || "not_found", message: error.message });
  if (error instanceof ConflictError) {
    return send(res, 409, { error: error.code, message: error.message, batch: error.batch, blockedBy: error.blockedBy });
  }
  return send(res, 500, { error: "server_error", message: error.message });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = join(publicDir, rel);
  if (!file.startsWith(publicDir)) return send(res, 403, { error: "forbidden" });
  try {
    const text = await readFile(file, "utf8");
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(text);
  } catch {
    send(res, 404, { error: "not_found" });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = url;

    if (!pathname.startsWith("/api/")) {
      // 页面与接口共用同一份业务模块（lib 下的纯逻辑，可在浏览器直接运行）
      const shared = pathname.match(/^\/shared\/([\w.-]+\.js)$/);
      if (shared) {
        const file = join(__dirname, "lib", shared[1]);
        if (!file.startsWith(join(__dirname, "lib"))) return send(res, 403, { error: "forbidden" });
        const text = await readFile(file, "utf8");
        res.writeHead(200, { "Content-Type": MIME[".js"] });
        return res.end(text);
      }
      return serveStatic(res, pathname);
    }

    // 批次列表：?sort=abnormal|recent
    if (req.method === "GET" && pathname === "/api/batches") {
      const db = await loadDb();
      return send(res, 200, sortBatches(listBatches(db), url.searchParams.get("sort")));
    }

    if (req.method === "GET" && pathname === "/api/stats") {
      const db = await loadDb();
      return send(res, 200, computeStats(listBatches(db)));
    }

    if (req.method === "POST" && pathname === "/api/batches") {
      const input = await body(req);
      const batch = await updateDb((db) => createBatch(db, input));
      return send(res, 201, batch);
    }

    const detail = pathname.match(/^\/api\/batches\/([^/]+)$/);
    if (detail && req.method === "GET") {
      const db = await loadDb();
      return send(res, 200, getBatch(db, decodeURIComponent(detail[1])));
    }

    // 观察记录：按“异常优先、满七天其次”确定状态；缸内排队冲突返回 409
    const observation = pathname.match(/^\/api\/batches\/([^/]+)\/observations$/);
    if (observation && req.method === "POST") {
      const input = await body(req);
      try {
        const batch = await updateDb((db) => recordObservation(db, decodeURIComponent(observation[1]), input));
        return send(res, 201, batch);
      } catch (error) {
        if (error instanceof ConflictError) return errorResponse(res, error);
        throw error;
      }
    }

    const withdraw = pathname.match(/^\/api\/batches\/([^/]+)\/withdraw$/);
    if (withdraw && req.method === "POST") {
      const input = await body(req);
      const batch = await updateDb((db) => withdrawBatch(db, decodeURIComponent(withdraw[1]), input));
      return send(res, 200, batch);
    }

    return send(res, 404, { error: "not_found", message: "接口不存在" });
  } catch (error) {
    return errorResponse(res, error);
  }
});

server.listen(port, () => console.log("古法纸浆发酵记录 listening on http://localhost:" + port));
