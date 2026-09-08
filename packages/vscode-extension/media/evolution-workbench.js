"use strict";
/* global acquireVsCodeApi, document, window */
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
let snapshot = null,
  selected = null,
  methods = [],
  filter = "all",
  tab = "changes",
  busy = false;
let pageIndex = 0;
const pageSize = 25;
const statusName = {
  pending: "待审核",
  approved: "已批准",
  rejected: "已拒绝",
  expired: "已过期",
};
function send(type, extra = {}) {
  vscode.postMessage({
    type,
    projectionDigest: snapshot?.projectionDigest,
    packetDigest: selected?.packetDigest,
    ...extra,
  });
}
function content(value) {
  return typeof value === "string"
    ? value
    : JSON.stringify(value ?? {}, null, 2);
}
function renderHome() {
  const home = $("empty");
  const title = document.createElement("h2"),
    description = document.createElement("p");
  title.textContent = "工作台概览";
  description.textContent = snapshot
    ? "先查看运行状态，再从左侧选择版本进行检查。无需输入关键词。"
    : "配置连接后，即可查看运行状态、候选版本和审核记录。";
  const state = document.createElement("div");
  state.className = "home-state";
  if (snapshot)
    for (const [label, value] of [
      ["运行状态", snapshot.governance.runStatus],
      ["当前发布", snapshot.governance.activeReleaseId || "暂无"],
      ["最近可回滚版本", snapshot.governance.lastKnownGoodReleaseId || "暂无"],
      ["待处理冲突", String(snapshot.governance.conflictCount)],
      ["灰度阶段", snapshot.governance.pilot?.stage || "未启动"],
      ["紧急停止", snapshot.governance.pilot?.killSwitch ? "已触发" : "未触发"],
      [
        "待恢复事务",
        snapshot.governance.pilot?.reconciliationRequired
          ? "需要核对与恢复"
          : "无",
      ],
    ]) {
      const row = document.createElement("div"),
        name = document.createElement("span"),
        text = document.createElement("strong");
      row.className = "summary-line";
      name.textContent = label;
      text.textContent = value;
      row.append(name, text);
      state.append(row);
    }
  const steps = document.createElement("ol");
  steps.className = "steps home-steps";
  for (const [label, detail] of [
    ["浏览版本", "选择「待审核」或「使用中」快速定位版本。"],
    ["检查改动和证据", "打开版本详情，查看差异、评测和真实使用记录。"],
    ["确认后提交决定", "填写原因，核对确认框；审批与回滚权限仍由服务验证。"],
  ]) {
    const li = document.createElement("li"),
      strong = document.createElement("strong"),
      p = document.createElement("p");
    strong.textContent = label;
    p.textContent = detail;
    li.append(strong, p);
    steps.append(li);
  }
  home.replaceChildren(title, description, state, steps);
}
const overview = document.createElement("button");
overview.id = "overview";
overview.textContent = "返回概览";
overview.onclick = () => {
  selected = null;
  $("reason").value = "";
  renderList();
  renderDetail();
};
document.querySelector(".detail-head").append(overview);
const pagination = document.createElement("div");
pagination.className = "workbench-pagination";
const previousPage = document.createElement("button");
previousPage.id = "previous-page";
previousPage.textContent = "上一页";
const pageLabel = document.createElement("span");
pageLabel.id = "page-label";
pageLabel.setAttribute("aria-live", "polite");
const nextPage = document.createElement("button");
nextPage.id = "next-page";
nextPage.textContent = "下一页";
previousPage.onclick = () => {
  pageIndex--;
  renderList();
};
nextPage.onclick = () => {
  pageIndex++;
  renderList();
};
pagination.append(previousPage, pageLabel, nextPage);
document.querySelector(".list-card").append(pagination);
function renderDetail() {
  $("detail").hidden = !selected;
  $("empty").hidden = !!selected;
  if (!selected) return;
  $("candidate-name").textContent = selected.candidateId;
  $("candidate-status").textContent = selected.actualUsage.active
    ? "正在使用"
    : statusName[selected.status];
  const rows = [
    ["内容摘要", selected.candidateContentDigest],
    [
      "目标运行环境",
      selected.validation?.targetRuntimes?.join(" / ") || "尚无数据",
    ],
    [
      "完成调用",
      `${selected.actualUsage.completed || 0} / ${selected.actualUsage.receiptCount || 0}`,
    ],
    [
      "实际成本",
      `$${Number(selected.actualUsage.totalCostUsd || 0).toFixed(4)}`,
    ],
  ];
  $("summary").replaceChildren(
    ...rows.map(([label, value]) => {
      const div = document.createElement("div"),
        dt = document.createElement("dt"),
        dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      div.append(dt, dd);
      return div;
    }),
  );
  $("detail-content").textContent = content(
    tab === "changes"
      ? selected.changes?.unifiedDiff || selected.changes || "暂无内容差异"
      : tab === "evidence"
        ? selected.why
        : {
            validation: selected.validation,
            actualUsage: selected.actualUsage,
          },
  );
  const options = snapshot.candidates
    .filter((c) => c.packetDigest !== selected.packetDigest)
    .map((c) => {
      const option = document.createElement("option");
      option.value = c.packetDigest;
      option.textContent = `${c.actualUsage.active ? "使用中" : statusName[c.status]} · ${c.candidateId}`;
      return option;
    });
  $("compare-target").replaceChildren(...options);
  $("approve").hidden = $("reject").hidden =
    selected.status !== "pending" || !methods.includes("review");
  $("rollback").hidden =
    selected.status !== "approved" ||
    selected.actualUsage.active ||
    !methods.includes("rollback") ||
    !snapshot.candidates.some((c) => c.actualUsage.active);
  $("action-hint").textContent = !methods.includes("review")
    ? "此部署仅开放读取；尚未接通人工审批权限。"
    : "提交前会再次确认。身份和审批权限由工作台服务验证。";
  updateBusy();
}
function renderList() {
  const query = $("search").value.toLowerCase();
  const rows = (snapshot?.candidates || []).filter(
    (c) =>
      (filter === "all" ||
        (filter === "active" ? c.actualUsage.active : c.status === filter)) &&
      `${c.candidateId} ${c.candidateContentDigest}`
        .toLowerCase()
        .includes(query),
  );
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  pagination.hidden = !snapshot || pages === 1;
  pageIndex = Math.min(Math.max(0, pageIndex), pages - 1);
  pageLabel.textContent = `${pageIndex + 1} / ${pages} · ${rows.length} 个版本`;
  previousPage.disabled = busy || pageIndex === 0;
  nextPage.disabled = busy || pageIndex >= pages - 1;
  $("candidates").replaceChildren(
    ...rows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize).map((c) => {
      const button = document.createElement("button");
      button.className =
        "candidate" +
        (selected?.packetDigest === c.packetDigest ? " selected" : "");
      button.disabled = busy;
      button.setAttribute(
        "aria-pressed",
        String(selected?.packetDigest === c.packetDigest),
      );
      const badge = document.createElement("span"),
        name = document.createElement("div"),
        hint = document.createElement("span");
      badge.className = "badge" + (c.actualUsage.active ? " ok" : "");
      badge.textContent = c.actualUsage.active
        ? "正在使用"
        : statusName[c.status];
      name.className = "name";
      name.textContent = c.candidateId;
      hint.className = "hint mono";
      hint.textContent = c.candidateContentDigest.slice(0, 23) + "…";
      button.append(badge, name, hint);
      button.onclick = () => {
        selected = c;
        $("reason").value = "";
        renderList();
        renderDetail();
      };
      return button;
    }),
  );
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = snapshot
      ? "暂无符合条件的版本"
      : "连接后将在这里显示版本";
    $("candidates").append(empty);
  }
}
function updateBusy() {
  document.querySelectorAll(".candidate").forEach((button) => {
    button.disabled = busy;
  });
  $("overview").disabled = busy;
  for (const id of [
    "refresh",
    "setup",
    "compare",
    "approve",
    "reject",
    "rollback",
    "raw",
  ])
    $(id).disabled = busy;
  $("compare").disabled =
    busy || !methods.includes("compare") || !$("compare-target").options.length;
  for (const id of ["approve", "reject", "rollback"])
    $(id).disabled = busy || !$("reason").value.trim();
}
$("refresh").onclick = () => send("refresh");
$("setup").onclick = () => send("setup");
$("raw").onclick = () => send("details");
$("search").oninput = () => {
  pageIndex = 0;
  renderList();
};
$("reason").oninput = updateBusy;
document.querySelectorAll("[data-filter]").forEach(
  (b) =>
    (b.onclick = () => {
      filter = b.dataset.filter;
      pageIndex = 0;
      document
        .querySelectorAll("[data-filter]")
        .forEach((x) => x.classList.toggle("selected", x === b));
      renderList();
    }),
);
document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      tab = b.dataset.tab;
      document
        .querySelectorAll("[data-tab]")
        .forEach((x) => x.classList.toggle("selected", x === b));
      renderDetail();
    }),
);
$("compare").onclick = () =>
  send("compare", { otherPacketDigest: $("compare-target").value });
for (const id of ["approve", "reject", "rollback"])
  $(id).onclick = () => send(id, { reason: $("reason").value });
window.addEventListener("message", ({ data: m }) => {
  if (m.type === "snapshot") {
    snapshot = m.projection;
    methods = m.methods;
    const candidates = snapshot?.candidates || [];
    selected =
      candidates.find((c) => c.packetDigest === selected?.packetDigest) || null;
    $("mode").textContent =
      m.mode === "local-test"
        ? "本地测试"
        : m.mode === "connecting"
          ? "连接中"
          : m.mode === "unavailable"
            ? "未连接"
            : "受治理部署";
    $("mode").className =
      "badge " +
      (m.mode === "local-test" ? "test" : m.mode === "governed" ? "ok" : "");
    $("total").textContent = snapshot ? candidates.length : "—";
    $("pending").textContent = snapshot
      ? candidates.filter((c) => c.status === "pending").length
      : "—";
    $("approved").textContent = snapshot
      ? candidates.filter((c) => c.status === "approved").length
      : "—";
    $("active").textContent = snapshot
      ? candidates.filter((c) => c.actualUsage.active).length
      : "—";
    renderHome();
    renderList();
    renderDetail();
  } else if (m.type === "notice") {
    $("notice").textContent = m.text;
    $("notice").className = "notice " + m.kind;
  } else if (m.type === "busy") {
    busy = m.value;
    renderList();
    updateBusy();
  } else if (m.type === "comparison") {
    $("detail-content").textContent = content(m.result);
  } else if (m.type === "operation") {
    $("reason").value = "";
    updateBusy();
  }
});
renderHome();
renderList();
renderDetail();
updateBusy();
send("ready");
