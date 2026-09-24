// 页面模块：HTML 与前端交互。初始数据由接口层调用 listBatches() 注入，
// 页面内所有操作也只走 /api/items/* 业务接口，不另外读写数据。

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderPage(initialItems) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古法纸浆发酵记录</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --ok:#3f6b4f; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:60px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; } button.danger { background:var(--warn); } button:disabled { opacity:.5; cursor:not-allowed; }
    .row { display:flex; gap:8px; flex-wrap:wrap; } .row button { flex:1; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; } .card { display:grid; gap:8px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.warn { color:var(--warn); border-color:var(--warn); } .pill.ok { color:var(--ok); border-color:var(--ok); }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:130px; overflow:auto; display:grid; gap:4px; }
    .warn-text { color:var(--warn); font-weight:700; } .rule { font-size:12px; color:var(--muted); line-height:1.6; margin-top:8px; }
    .checkline { display:flex; align-items:center; gap:8px; margin:10px 0 0; } .checkline input { width:auto; } .checkline label { margin:0; color:var(--ink); }
    #toast { position:fixed; right:20px; bottom:20px; display:grid; gap:8px; z-index:10; }
    .toast { max-width:380px; padding:12px 16px; border-radius:8px; color:#fff; font-size:14px; box-shadow:0 4px 14px rgba(0,0,0,.18); white-space:pre-wrap; }
    .toast.error { background:var(--warn); } .toast.success { background:var(--ok); }
    @keyframes flash { 0%,100% { box-shadow:none; } 50% { box-shadow:0 0 0 3px rgba(82,111,67,.45); } }
    .flash { animation:flash 1s ease-in-out 2; border-color:var(--accent); }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>古法纸浆发酵记录</h1><div class="meta">批次档案 · 观察记录 · 状态统一判定（异常优先，满七天其次；同缸前序批次未退缸不可抄纸）</div></div><button id="reload">刷新</button></header>
  <main>
    <section>
      <form id="createForm"><h2>新增纸浆批次</h2><div id="fields"></div><button>保存纸浆批次</button></form>
      <form id="actionForm" style="margin-top:14px">
        <h2>每日观察记录</h2>
        <label>选择纸浆批次</label><select name="id" id="itemSelect"></select>
        <div id="extraFields"></div>
        <div class="checkline"><input type="checkbox" id="abnormalCheck" name="abnormal"><label for="abnormalCheck">存在异味或霉点（异常）</label></div>
        <div id="reasonBox" hidden><label>异常原因</label><input name="reason" placeholder="如：缸壁霉点、酸臭异味"></div>
        <button style="margin-top:12px">提交记录</button>
        <div class="rule">提交后自动判定：异常优先 → 发酵满七天其次 → 其余发酵中；异常原因随批次保留。同一浸泡缸还有未退缸的前序批次时，本批次即使满七天也不能进入可抄纸状态。</div>
      </form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar">
        <select id="statusFilter"><option value="">全部状态</option></select>
        <input id="search" placeholder="搜索编号 / 缸号 / 负责人">
        <select id="sortBy">
          <option value="abnormal">按异常次数排序</option>
          <option value="latest">按最近观察时间排序</option>
          <option value="created">按建档时间排序</option>
        </select>
      </div>
      <div class="panel"><h2>每天记录温度、气味、纤维状态和换水情况；异常次数与最近观察时间可排序。</h2><div class="grid" id="cards"></div></div>
    </section>
  </main>
  <div id="toast"></div>
  <script id="initialData" type="application/json">${JSON.stringify(initialItems).replace(/</g, "\\u003c")}</script>
  <script>
    const stages = ["入缸","发酵中","可抄纸","异常观察","已退缸"];
    const fields = [["code","批次编号","text"],["source","原料来源","text"],["vat","浸泡缸","text"],["days","发酵天数","number"],["owner","负责人","text"]];
    const extraFields = [["temperature","温度"],["smell","气味状态"],["fiber","纤维松散度"],["changedWater","是否换水"]];
    let items = JSON.parse(document.getElementById("initialData").textContent || "[]");

    async function api(path, options) {
      const res = await fetch(path, options && options.body ? Object.assign({}, options, { headers: { "Content-Type": "application/json" } }) : options);
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data.error || data.message || "请求失败");
        err.payload = data;
        throw err;
      }
      return data;
    }
    function esc(v) {
      return String(v === null || v === undefined ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }
    function fmtTime(at) {
      if (!at) return "暂无观察";
      const d = new Date(at);
      if (isNaN(d)) return at;
      const p = n => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    }
    function formJson(form) {
      const data = {};
      new FormData(form).forEach((v, k) => { data[k] = String(v); });
      data.abnormal = form.querySelector("#abnormalCheck").checked;
      return data;
    }
    function toast(message, type) {
      const box = document.querySelector("#toast");
      const el = document.createElement("div");
      el.className = "toast " + (type || "error");
      el.textContent = message;
      box.appendChild(el);
      setTimeout(() => el.remove(), 6000);
    }

    function renderForms() {
      document.querySelector("#fields").innerHTML = fields.map(function(f) {
        return '<label>' + f[1] + '</label><input name="' + f[0] + '" type="' + f[2] + '"' + (f[0] === "code" ? " required" : "") + (f[0] === "days" ? ' value="0" min="0"' : "") + ">";
      }).join("");
      document.querySelector("#extraFields").innerHTML = extraFields.map(function(f) {
        return '<label>' + f[1] + '</label><input name="' + f[0] + '">';
      }).join("");
      document.querySelector("#statusFilter").innerHTML = '<option value="">全部状态</option>' + stages.map(function(s) {
        return '<option>' + s + '</option>';
      }).join("");
    }

    function sortedItems(list) {
      const sortBy = document.querySelector("#sortBy").value;
      const copy = list.slice();
      if (sortBy === "latest") {
        copy.sort(function(a, b) { return String(b.lastObservationAt || "").localeCompare(String(a.lastObservationAt || "")); });
      } else if (sortBy === "created") {
        copy.sort(function(a, b) { return String(b.createdAt || "").localeCompare(String(a.createdAt || "")); });
      } else {
        copy.sort(function(a, b) {
          const diff = (b.abnormalCount || 0) - (a.abnormalCount || 0);
          return diff !== 0 ? diff : String(b.lastObservationAt || "").localeCompare(String(a.lastObservationAt || ""));
        });
      }
      return copy;
    }

    function cardHtml(item) {
      const retired = item.status === "已退缸";
      const pill = item.status === "异常观察" ? "warn" : item.status === "可抄纸" ? "ok" : "";
      const main = fields.slice(1).map(function(f) {
        return '<div><b>' + f[1] + '</b> ' + esc(item[f[0]]) + "</div>";
      }).join("");
      const abnormalLine = item.abnormalCount > 0
        ? '<div class="warn-text">异常 ' + item.abnormalCount + ' 次' + (item.abnormalReason ? '：' + esc(item.abnormalReason) : "") + "</div>"
        : "";
      const observations = (item.observations || []).slice(-4).map(function(o) {
        return '<div class="' + (o.abnormal ? "warn-text" : "") + '">' + fmtTime(o.at) + " · 温度" + esc(o.temperature || "-") + " · 纤维" + esc(o.fiber || "-") + (o.abnormal ? " · 异常：" + esc(o.reason || "异味或霉点") : "") + "</div>";
      }).join("");
      const buttons = retired
        ? '<button class="secondary" data-note="' + esc(item.id) + '">追加备注</button>'
        : '<div class="row"><button data-continue="' + esc(item.id) + '">继续记录</button><button class="secondary" data-note="' + esc(item.id) + '">追加备注</button><button class="danger" data-retire="' + esc(item.id) + '">退缸</button></div>';
      return '<article class="card" data-card="' + esc(item.id) + '">' +
        '<h3>' + esc(item.code) + '</h3>' +
        '<span class="pill ' + pill + '">' + esc(item.status) + "</span>" +
        main + abnormalLine +
        '<div class="meta">异常次数：<b>' + (item.abnormalCount || 0) + '</b> ｜ 最近观察：' + fmtTime(item.lastObservationAt) + "</div>" +
        buttons +
        '<div class="logs meta">' + (observations || "暂无观察记录") + "</div>" +
        "</article>";
    }

    function render() {
      const select = document.querySelector("#itemSelect");
      const current = select.value;
      select.innerHTML = items.filter(function(i) { return i.status !== "已退缸"; }).map(function(item) {
        return '<option value="' + esc(item.id) + '">' + esc(item.code) + " · " + esc(item.vat || "") + " · " + esc(item.owner || "") + "</option>";
      }).join("");
      if (current) select.value = current;
      const stats = {};
      stages.forEach(function(s) { stats[s] = 0; });
      items.forEach(function(i) { if (stats[i.status] !== undefined) stats[i.status] += 1; });
      document.querySelector("#stats").innerHTML = stages.map(function(k) {
        return '<div class="stat"><span>' + k + "</span><strong>" + stats[k] + "</strong></div>";
      }).join("");
      const status = document.querySelector("#statusFilter").value;
      const q = document.querySelector("#search").value.trim().toLowerCase();
      const visible = items.filter(function(item) {
        const hit = !q || [item.code, item.source, item.vat, item.owner, item.abnormalReason].join(" ").toLowerCase().includes(q);
        return (!status || item.status === status) && hit;
      });
      document.querySelector("#cards").innerHTML = sortedItems(visible).map(cardHtml).join("");
    }

    async function load(selectId) {
      items = await api("/api/items");
      render();
      if (selectId) {
        document.querySelector("#itemSelect").value = selectId;
        const card = document.querySelector('[data-card="' + selectId + '"]');
        if (card) card.classList.add("flash");
        document.querySelector("#actionForm").scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }

    document.querySelector("#abnormalCheck").onchange = function() {
      document.querySelector("#reasonBox").hidden = !this.checked;
    };
    document.querySelector("#createForm").onsubmit = async function(event) {
      event.preventDefault();
      try {
        const data = Object.fromEntries(new FormData(document.querySelector("#createForm")).entries());
        await api("/api/items", { method: "POST", body: JSON.stringify(data) });
        document.querySelector("#createForm").reset();
        await load();
        toast("批次档案已建立，初始状态：入缸", "success");
      } catch (err) { toast(err.message); }
    };
    document.querySelector("#actionForm").onsubmit = async function(event) {
      event.preventDefault();
      const form = document.querySelector("#actionForm");
      const id = document.querySelector("#itemSelect").value;
      const payload = formJson(form);
      delete payload.id;
      try {
        const result = await api("/api/items/" + encodeURIComponent(id) + "/action", { method: "POST", body: JSON.stringify(payload) });
        form.reset();
        document.querySelector("#reasonBox").hidden = true;
        await load(id);
        toast("观察已保存，当前状态：" + result.item.status, "success");
      } catch (err) {
        // 缸冲突返回 409，但观察记录已保存：刷新列表，让提交人看到已保存的记录与冲突提示。
        if (err.payload && err.payload.conflict) {
          form.reset();
          document.querySelector("#reasonBox").hidden = true;
          await load(id);
        }
        toast((err.payload && err.payload.message) || err.message);
      }
    };
    document.querySelector("#cards").addEventListener("click", async function(event) {
      const btn = event.target.closest("button[data-continue],button[data-note],button[data-retire]");
      if (!btn) return;
      if (btn.dataset.continue) {
        document.querySelector("#itemSelect").value = btn.dataset.continue;
        const card = document.querySelector('[data-card="' + btn.dataset.continue + '"]');
        if (card) card.classList.add("flash");
        document.querySelector("#actionForm").scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      try {
        if (btn.dataset.note) {
          const note = prompt("记录备注");
          if (note && note.trim()) {
            await api("/api/items/" + encodeURIComponent(btn.dataset.note) + "/logs", { method: "POST", body: JSON.stringify({ note: note }) });
            await load();
            toast("备注已追加", "success");
          }
        } else if (btn.dataset.retire) {
          if (!confirm("确认该批次已出缸退纸？退缸后同缸后续批次方可抄纸。")) return;
          const note = prompt("退缸备注（可留空）") || "";
          await api("/api/items/" + encodeURIComponent(btn.dataset.retire) + "/retire", { method: "POST", body: JSON.stringify({ note: note }) });
          await load();
          toast("批次已退缸", "success");
        }
      } catch (err) { toast((err.payload && err.payload.message) || err.message); }
    });
    document.querySelector("#statusFilter").onchange = render;
    document.querySelector("#search").oninput = render;
    document.querySelector("#sortBy").onchange = render;
    document.querySelector("#reload").onclick = function() { load(); };
    renderForms();
    render();
  </script>
</body>
</html>`;
}
