import http from "node:http";
import {
  listBatches,
  getBatch,
  createBatch,
  updateArchive,
  addNote,
  recordObservation,
  retireBatch,
  HttpError
} from "./lib/batches.js";
import { STATUSES } from "./lib/status.js";
import { renderPage } from "./lib/page.js";

const port = Number(process.env.PORT || 3039);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "请求体不是合法的 JSON");
  }
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const id = (m) => decodeURIComponent(m[1]);

    if (req.method === "GET" && url.pathname === "/") {
      const items = await listBatches();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPage(items));
    }

    if (req.method === "GET" && url.pathname === "/api/items") {
      return send(res, 200, await listBatches());
    }

    if (req.method === "GET" && url.pathname === "/api/statuses") {
      return send(res, 200, {
        statuses: STATUSES,
        rules: {
          priority: ["异常观察", "满七天且缸内无前序批次 → 可抄纸", "否则发酵中"],
          vatRule: "同一浸泡缸仍有未退缸的前序批次时，后续批次不能进入可抄纸状态"
        }
      });
    }

    if (req.method === "GET" && url.pathname === "/api/stats") {
      const items = await listBatches();
      const stats = Object.fromEntries(STATUSES.map(s => [s, 0]));
      for (const item of items) if (stats[item.status] !== undefined) stats[item.status] += 1;
      return send(res, 200, stats);
    }

    if (req.method === "POST" && url.pathname === "/api/items") {
      const item = await createBatch(await body(req));
      return send(res, 201, item);
    }

    let match = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (match && req.method === "GET") {
      return send(res, 200, await getBatch(id(match)));
    }
    if (match && req.method === "PATCH") {
      return send(res, 200, await updateArchive(id(match), await body(req)));
    }

    match = url.pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
    if (match && req.method === "POST") {
      return send(res, 201, await addNote(id(match), await body(req)));
    }

    match = url.pathname.match(/^\/api\/items\/([^/]+)\/action$/);
    if (match && req.method === "POST") {
      const result = await recordObservation(id(match), await body(req));
      // 观察记录已保存，但被缸内前序批次挡住、不能进入可抄纸：
      // 返回 409 让提交人收到明确冲突提示（顶层 message 与 conflict 内容一致）。
      if (result.conflict) {
        return send(res, 409, {
          ...result,
          error: result.conflict.code,
          message: "观察已保存。" + result.conflict.message
        });
      }
      return send(res, 201, result);
    }

    match = url.pathname.match(/^\/api\/items\/([^/]+)\/retire$/);
    if (match && req.method === "POST") {
      return send(res, 200, await retireBatch(id(match), await body(req)));
    }

    send(res, 404, { error: "not_found", message: "接口不存在" });
  } catch (error) {
    if (error instanceof HttpError) {
      return send(res, error.status, {
        error: error.code,
        message: error.message,
        ...(error.blocker ? { blocker: error.blocker } : {})
      });
    }
    send(res, 500, { error: "internal_error", message: error.message });
  }
});

server.listen(port, () => console.log("古法纸浆发酵记录 listening on http://localhost:" + port));
