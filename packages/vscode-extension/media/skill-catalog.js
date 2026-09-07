"use strict";
/* global acquireVsCodeApi, document, window, matchMedia */
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 12;
const sourceName = {
  bundled: "内置",
  "cli-bundled": "CLI 内置",
  marketplace: "市场",
  managed: "全局",
  workspace: "项目",
  "claude-project": "项目 · Claude",
};
let rows = [],
  selected = null,
  page = 0,
  busy = false;
const send = (type, extra = {}) => vscode.postMessage({ type, ...extra });
function node(tag, value, className) {
  const el = document.createElement(tag);
  if (value != null) el.textContent = value;
  if (className) el.className = className;
  return el;
}
function renderDetail() {
  if (!selected) {
    const empty = node("div", null, "empty");
    empty.append(
      node("h2", "从列表开始"),
      node("p", "选择一项查看说明、来源、标签和版本信息。"),
    );
    $("detail").replaceChildren(empty);
    return;
  }
  const detail = $("detail"),
    title = node("h2", selected.displayName),
    description = node(
      "p",
      selected.description || "此技能尚未提供说明。",
      "skill-description",
    ),
    badges = node("div", null, "badges");
  badges.append(
    node("span", sourceName[selected.source] || selected.source, "badge"),
    node("span", selected.category, "badge"),
  );
  const dl = node("dl", null, "detail-grid");
  const values = [
    ["技能 ID", selected.id],
    ["版本", selected.version],
    [
      "适用平台",
      selected.os.length ? selected.os.join(" / ") : "未限制 / 未声明",
    ],
    [
      "执行入口",
      selected.retrieval
        ? "以运行时验证为准"
        : selected.hasHandler
          ? "已声明 · 仍需运行授权"
          : "未声明",
    ],
  ];
  if (selected.retrieval)
    values.push(
      ["匹配得分", selected.retrieval.score.toFixed(3)],
      ["内容摘要", selected.retrieval.digest],
      ["上下文开销", `${selected.retrieval.contextCostTokens} tokens`],
      ["历史样本", String(selected.retrieval.outcome.samples)],
    );
  for (const [label, value] of values) {
    const div = node("div");
    div.append(node("dt", label), node("dd", value));
    dl.append(div);
  }
  const tags = node("div", null, "badges");
  selected.tags.forEach((tag) => tags.append(node("span", tag, "badge")));
  const copy = node("button", "复制技能 ID");
  copy.id = "copy";
  copy.disabled = busy;
  copy.onclick = () => send("copy", { key: selected.key });
  const footer = node("div", null, "section");
  footer.append(
    copy,
    node("p", "仅浏览不会运行技能。实际执行时仍需检查当前内容与权限。", "hint"),
  );
  detail.replaceChildren(badges, title, description, dl, tags, footer);
}
function filtered() {
  const query = $("filter").value.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (!$("category").value || row.category === $("category").value) &&
      (!$("source").value || row.source === $("source").value) &&
      `${row.id} ${row.displayName} ${row.description} ${row.tags.join(" ")}`
        .toLowerCase()
        .includes(query),
  );
}
function render() {
  const matches = filtered(),
    pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  page = Math.min(page, pages - 1);
  $("count").textContent = `${matches.length} 项`;
  $("page-number").textContent = `${page + 1} / ${pages} 页`;
  $("prev").disabled = page === 0;
  $("next").disabled = page + 1 === pages;
  $("skills").replaceChildren(
    ...matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((row) => {
      const button = node(
        "button",
        null,
        "skill-card" + (selected?.key === row.key ? " selected" : ""),
      );
      button.setAttribute("aria-pressed", String(selected?.key === row.key));
      const badges = node("div", null, "badges");
      badges.append(
        node("span", sourceName[row.source] || row.source, "badge"),
        node("span", row.category, "hint"),
      );
      button.append(
        badges,
        node("h3", row.displayName),
        node("p", row.description || row.id),
        node(
          "span",
          row.retrieval
            ? `匹配 ${row.retrieval.score.toFixed(3)} · v${row.version}`
            : `v${row.version} · ${row.id}`,
          "hint mono",
        ),
      );
      button.onclick = () => {
        selected = row;
        render();
        renderDetail();
        if (matchMedia("(max-width:850px)").matches)
          $("detail").scrollIntoView({ behavior: "smooth", block: "start" });
      };
      return button;
    }),
  );
  if (!matches.length)
    $("skills").append(
      node("p", "没有匹配的技能，请清空筛选或尝试不同的任务描述。", "empty"),
    );
}
function setRows(nextRows) {
  rows = nextRows;
  selected = null;
  page = 0;
  $("filter").value = "";
  for (const [id, label] of [
    ["category", "全部分类"],
    ["source", "全部来源"],
  ]) {
    const options = [node("option", label)];
    options[0].value = "";
    [...new Set(rows.map((r) => r[id]))].sort().forEach((value) => {
      const option = node(
        "option",
        id === "source" ? sourceName[value] || value : value,
      );
      option.value = value;
      options.push(option);
    });
    $(id).replaceChildren(...options);
  }
  render();
  renderDetail();
}
$("refresh").onclick = () => send("refresh");
$("back").onclick = () => send("back");
$("audit").onclick = () => send("audit");
$("search-form").onsubmit = (event) => {
  event.preventDefault();
  if (!busy) send("search", { query: $("query").value });
};
for (const id of ["filter", "category", "source"])
  $(id).addEventListener("input", () => {
    page = 0;
    render();
  });
$("prev").onclick = () => {
  page--;
  render();
};
$("next").onclick = () => {
  page++;
  render();
};
window.addEventListener("message", ({ data: message }) => {
  if (message.type === "catalog") {
    setRows(message.rows);
    $("total").textContent = rows.length;
    $("categories").textContent = new Set(rows.map((r) => r.category)).size;
    $("workspace").textContent = rows.filter((r) =>
      ["workspace", "claude-project"].includes(r.source),
    ).length;
    $("handlers").textContent = rows.filter((r) => r.hasHandler).length;
    $("list-title").textContent = "全部技能";
    $("back").hidden = $("audit").hidden = $("result-notice").hidden = true;
  } else if (message.type === "results") {
    setRows(message.rows);
    $("list-title").textContent = `检索结果：${message.query}`;
    $("back").hidden = $("audit").hidden = $("result-notice").hidden = false;
    const result = message.result;
    $("result-notice").textContent =
      `${result.conflicts.length ? `存在 ${result.conflicts.length} 项冲突，请人工检查。` : "可逐项查看匹配依据。"} 历史反馈：${["verified", "verified-indexed"].includes(result.outcomeAuthority?.status) ? "已验证" : "不可用"}；向量检索：${result.vectorAuthority?.status === "verified" ? "已验证" : "不可用"}。最多展示 64 项，可缩小任务范围。`;
  } else if (message.type === "notice") {
    $("notice").textContent = message.text;
    $("notice").className = "notice " + message.kind;
  } else if (message.type === "busy") {
    busy = message.value;
    for (const id of ["refresh", "search", "back", "audit", "copy"]) {
      if ($(id)) $(id).disabled = busy;
    }
  }
});
send("ready");
