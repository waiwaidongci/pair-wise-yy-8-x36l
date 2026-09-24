// 页面逻辑：只负责展示与表单提交，不自己发明状态规则。
// 状态判定直接 import 与服务端相同的 lib 模块（经 /shared 提供），
// 接口落库后返回的结果与页面本地复算口径一致。

import {
  STATUS,
  STATUSES,
  refreshStatus,
  abnormalCount,
  lastObservedAt,
  latestObservation,
  meetsPaperCondition,
} from "/shared/status.js";

const createForm = document.querySelector("#createForm");
const cardsEl = document.querySelector("#cards");
const statsEl = document.querySelector("#stats");
const statusFilter = document.querySelector("#statusFilter");
const searchInput = document.querySelector("#search");
const sortBy = document.querySelector("#sortBy");
const modalMask = document.querySelector("#modalMask");
const modalTitle = document.querySelector("#modalTitle");
const modalBody = document.querySelector("#modalBody");

let batches = [];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function fmtTime(at) {
  if (!at) return "—";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || "请求失败");
    error.payload = data;
    error.status = res.status;
    throw error;
  }
  return data;
}

let toastTimer = null;
function toast(message, type = "ok") {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.className = `toast ${type}`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 6000);
}

function pillClass(status) {
  if (status === STATUS.READY) return "ready";
  if (status === STATUS.ABNORMAL) return "abnormal";
  if (status === STATUS.WITHDRAWN) return "withdrawn";
  return "";
}

// 页面用同一份模块复算全部状态（数据来自接口），保证展示口径统一
function refreshAll(items) {
  for (const item of items) refreshStatus(item, items);
  return items;
}

function renderStats(items) {
  const stats = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const item of items) stats[item.status] += 1;
  statsEl.innerHTML = STATUSES
    .map((k) => `<div class="stat"><span>${k}</span><strong>${stats[k]}</strong></div>`)
    .join("");
}

function cardHtml(item) {
  const abCount = abnormalCount(item);
  const latest = latestObservation(item);
  const waiting = !!item.blockedBy;
  const pill = waiting
    ? `<span class="pill waiting">${item.status}（排队中）</span>`
    : `<span class="pill ${pillClass(item.status)}">${item.status}</span>`;

  let hint = "";
  if (waiting) {
    hint = `<div class="amber-text">前序批次 ${esc(item.blockedBy.code)} 未退缸，已满足抄纸条件但需等待</div>`;
  } else if (item.status === STATUS.ABNORMAL && latest) {
    hint = `<div class="warn-text">异常原因：${esc(latest.abnormalReason || "未填写原因")}</div>`;
  } else if (meetsPaperCondition(item) && item.status === STATUS.READY) {
    hint = `<div class="meta">已满足抄纸条件，可安排抄纸或退缸</div>`;
  }

  return `
    <article class="card" data-id="${esc(item.id)}">
      <div class="tag-row">
        <h3>${esc(item.code)}</h3>
        ${pill}
        <span class="count-pill ${abCount ? "bad" : ""}">异常 ${abCount} 次</span>
      </div>
      <div class="meta">原料：${esc(item.source || "—")}　浸泡缸：${esc(item.vat)}</div>
      <div class="meta">负责人：${esc(item.owner)}　发酵 ${Number(item.days || 0)} 天</div>
      ${hint}
      <div class="meta">最近观察：${fmtTime(lastObservedAt(item))}</div>
      <div class="meta">入缸：${fmtTime(item.createdAt)}${item.withdrawnAt ? `　退缸：${fmtTime(item.withdrawnAt)}` : ""}</div>
    </article>`;
}

function render() {
  const status = statusFilter.value;
  const q = searchInput.value.trim().toLowerCase();
  let visible = batches.filter((item) => {
    if (status && item.status !== status) return false;
    if (!q) return true;
      const haystack = [
        item.code, item.source, item.vat, item.owner, item.status,
        ...(item.observations || []).map((o) => `${o.abnormalReason} ${o.note || ""}`),
      ].join(" ").toLowerCase();
      return haystack.includes(q);
  });
  // 接口已排序，客户端切换排序条件时本地同样排一次
  const key = sortBy.value;
  visible = [...visible].sort((a, b) => {
    const la = String(lastObservedAt(a) || "");
    const lb = String(lastObservedAt(b) || "");
    if (key === "abnormal") {
      return abnormalCount(b) - abnormalCount(a) || lb.localeCompare(la) ||
        String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    }
    return lb.localeCompare(la) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
  cardsEl.innerHTML = visible.length
    ? visible.map(cardHtml).join("")
    : '<div class="empty">没有符合条件的批次</div>';
  renderStats(batches);

  document.querySelectorAll(".card[data-id]").forEach((card) => {
    card.onclick = () => openDetail(card.dataset.id);
  });
}

async function load() {
  const items = await api(`/api/batches?sort=${encodeURIComponent(sortBy.value)}`);
  batches = refreshAll(items);
  render();
}

function observationRow(o) {
  return `
    <div class="obs ${o.abnormal ? "abnormal" : ""}">
      <div><b>${fmtTime(o.at)}</b>${o.abnormal ? ' <span class="warn-text">异常</span>' : ""}</div>
      <div class="meta">温度 ${esc(o.temperature)}｜气味 ${esc(o.smell || "—")}｜纤维 ${esc(o.fiber || "—")}｜换水 ${esc(o.changedWater || "—")}</div>
      ${o.abnormal ? `<div class="warn-text">原因：${esc(o.abnormalReason || "未填写原因")}</div>` : ""}
    </div>`;
}

async function openDetail(id) {
  const item = await api(`/api/batches/${encodeURIComponent(id)}`);
  refreshStatus(item, batches);
  modalTitle.textContent = `${item.code} · 批次档案`;
  const withdrawn = item.status === STATUS.WITHDRAWN;

  modalBody.innerHTML = `
    <div class="meta">${esc(item.source || "原料未填")}　浸泡缸 ${esc(item.vat)}　负责人 ${esc(item.owner)}　发酵 ${Number(item.days || 0)} 天</div>
    <div class="tag-row" style="margin-top:8px">
      <span class="pill ${pillClass(item.status)}">${item.status}</span>
      <span class="count-pill ${abnormalCount(item) ? "bad" : ""}">异常 ${abnormalCount(item)} 次</span>
      <span class="count-pill">最近观察 ${fmtTime(lastObservedAt(item))}</span>
    </div>
    ${item.blockedBy ? `<div class="amber-text" style="margin-top:8px">前序批次 ${esc(item.blockedBy.code)}（${esc(item.blockedBy.owner || "负责人未定")}）仍在 ${esc(item.vat)} 未退缸，本批次暂不能进入可抄纸状态</div>` : ""}

    <form id="obsForm" style="margin-top:14px">
      <h2 style="font-size:16px">继续记录观察</h2>
      <div class="row2">
        <div><label>温度 *</label><input name="temperature" required placeholder="如 25.1"></div>
        <div><label>纤维松散度 *</label><input name="fiber" required placeholder="如 松散"></div>
      </div>
      <div class="row2">
        <div><label>气味状态</label><input name="smell" placeholder="如 微酸"></div>
        <div><label>是否换水</label>
          <select name="changedWater"><option value="否">否</option><option value="是">是</option></select>
        </div>
      </div>
      <label>是否有异味或霉点</label>
      <select name="abnormal" id="abnormalSelect">
        <option value="否">否，情况正常</option>
        <option value="是">是，发现异常</option>
      </select>
      <div id="reasonWrap" style="display:none">
        <label>异常原因 *（会随记录保留，不再被后续提交覆盖）</label>
        <textarea name="abnormalReason" placeholder="如 缸角发现霉点"></textarea>
      </div>
      <div class="form-actions">
        <button ${withdrawn ? "disabled" : ""}>提交观察记录</button>
        <button type="button" class="warn" id="withdrawBtn" ${withdrawn ? "disabled" : ""}>批次退缸</button>
        <button type="button" class="secondary" id="detailClose">关闭</button>
      </div>
    </form>

    <h2 style="font-size:16px;margin-top:16px">历史观察（${(item.observations || []).length} 条）</h2>
    <div class="observations">
      ${(item.observations || []).slice().reverse().map(observationRow).join("") || '<div class="meta">暂无观察记录</div>'}
    </div>
  `;
  modalMask.classList.add("open");

  const abnormalSelect = modalBody.querySelector("#abnormalSelect");
  const reasonWrap = modalBody.querySelector("#reasonWrap");
  const reasonInput = reasonWrap.querySelector("textarea");
  abnormalSelect.onchange = () => {
    const abnormal = abnormalSelect.value === "是";
    reasonWrap.style.display = abnormal ? "block" : "none";
    reasonInput.required = abnormal;
  };

  modalBody.querySelector("#detailClose").onclick = closeDetail;
  modalBody.querySelector("#withdrawBtn").onclick = async () => {
    if (!withdrawn && !window.confirm(`确认批次 ${item.code} 退缸？退缸后将释放 ${item.vat} 缸位`)) return;
    try {
      const note = window.prompt("退缸备注（可留空）") || "";
      await api(`/api/batches/${encodeURIComponent(item.id)}/withdraw`, {
        method: "POST",
        body: JSON.stringify({ note }),
      });
      toast(`批次 ${item.code} 已退缸，缸位已释放`);
      closeDetail();
      await load();
    } catch (error) {
      toast(error.message, "error");
    }
  };

  modalBody.querySelector("#obsForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const updated = await api(`/api/batches/${encodeURIComponent(item.id)}/observations`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (updated.status === STATUS.ABNORMAL) {
        toast(`观察记录已保存：异常原因「${esc(payload.abnormalReason)}」已保留，批次转入异常观察`, "warn");
      } else if (updated.status === STATUS.READY) {
        toast(`观察记录已保存，批次 ${updated.code} 已满足抄纸条件（满 7 天且无异常）`);
      } else {
        toast(`观察记录已保存，当前状态：${updated.status}`);
      }
      closeDetail();
      await load();
    } catch (error) {
      // 缸位冲突：观察已入库，明确提示负责人并刷新，可在详情里看到排队原因
      if (error.status === 409 && error.payload?.error === "vat_blocked") {
        toast(error.message + "，请等待前序批次退缸", "warn");
        closeDetail();
        await load();
      } else {
        toast(error.message, "error");
      }
    }
  };
}

function closeDetail() {
  modalMask.classList.remove("open");
  modalBody.innerHTML = "";
}

createForm.onsubmit = async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(createForm).entries());
  try {
    await api("/api/batches", { method: "POST", body: JSON.stringify(payload) });
    createForm.reset();
    createForm.days.value = "0";
    toast(`批次 ${payload.code} 建档成功`);
    await load();
  } catch (error) {
    toast(error.message, "error");
  }
};

statusFilter.innerHTML = '<option value="">全部状态</option>' +
  STATUSES.map((s) => `<option>${s}</option>`).join("");
statusFilter.onchange = render;
searchInput.oninput = render;
sortBy.onchange = load;
document.querySelector("#reload").onclick = load;
document.querySelector("#modalClose").onclick = closeDetail;
modalMask.onclick = (event) => { if (event.target === modalMask) closeDetail(); };

load().catch((error) => toast(error.message, "error"));
