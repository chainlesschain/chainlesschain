"use strict";
const { panelHtml, panelOptions } = require("./panel-shell");
const {
  buildSkillRetrievalArgs,
  parseSkillRetrievalResult,
} = require("./skill-retrieval-view");
let currentPanel = null;

const BODY = `<main class="page"><header class="header"><div><div class="eyebrow">CHAINLESSCHAIN / SKILLS</div><h1>技能库</h1><p class="subtitle">先浏览已发现的技能，再按任务检索。查看详情不会运行技能或授予权限。</p></div><button id="refresh">刷新技能列表</button></header><div id="notice" class="notice" role="status" aria-live="polite">正在加载技能列表…</div><section class="stats" aria-label="技能统计"><div class="stat"><strong id="total">—</strong><span>已发现技能</span></div><div class="stat"><strong id="categories">—</strong><span>技能分类</span></div><div class="stat"><strong id="workspace">—</strong><span>当前项目技能</span></div><div class="stat"><strong id="handlers">—</strong><span>含执行入口</span></div></section><section class="card catalog-controls"><h2>浏览技能列表</h2><div class="catalog-filters"><input id="filter" aria-label="筛选技能" placeholder="按名称、说明或标签筛选"><select id="category" aria-label="按分类筛选"><option value="">全部分类</option></select><select id="source" aria-label="按来源筛选"><option value="">全部来源</option></select></div><details id="retrieval"><summary>不知道用哪个技能？按任务检索</summary><form id="search-form" class="search-row"><input id="query" maxlength="4096" required aria-label="任务描述" placeholder="例如：检查代码安全问题并给出修复建议"><button class="primary" id="search" type="submit">检索技能</button></form><p class="hint">使用 CLI 的摘要绑定检索；排名不等于审批或执行授权。</p></details></section><div class="catalog-heading"><h2 id="list-title">全部技能</h2><div class="actions"><span id="count" class="hint"></span><button id="back" hidden>返回全部技能</button><button id="audit" hidden>检索依据</button></div></div><div id="result-notice" class="notice" hidden></div><div class="catalog-layout"><section><div id="skills" class="skill-grid"></div><div class="pagination"><button id="prev">上一页</button><span id="page-number" class="hint"></span><button id="next">下一页</button></div></section><aside id="detail" class="card skill-detail"><div class="empty"><h2>从列表开始</h2><p>选择一项查看说明、来源、标签和版本信息。</p></div></aside></div></main>`;

function parseSkillCatalog(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 8 * 1024 * 1024)
    throw new Error("技能列表超出大小限制。");
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    throw new Error("CLI 未返回有效技能列表，请升级 CLI 后重试。");
  }
  if (!Array.isArray(rows) || rows.length > 10000)
    throw new Error("技能列表格式不受支持。");
  return rows.map((row, index) => {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.id !== "string" ||
      !row.id ||
      row.id.length > 512
    )
      throw new Error("技能列表包含无效条目。");
    const string = (key, fallback = "", max = 4096) => {
      if (row[key] == null) return fallback;
      if (typeof row[key] !== "string" || row[key].length > max)
        throw new Error(`技能字段无效：${key}`);
      return row[key];
    };
    const strings = (key) =>
      Array.isArray(row[key])
        ? row[key]
            .filter((v) => typeof v === "string" && v.length <= 512)
            .slice(0, 64)
        : [];
    // Only display metadata; never forward handler paths or treat discovery as
    // authority to run a skill. Keys are host-owned and scoped to this snapshot.
    return {
      key: String(index),
      id: row.id,
      displayName: string("displayName", row.id),
      description: string("description", "", 16384),
      category: string("category", "uncategorized"),
      source: string("source", "unknown"),
      version: string("version", "—"),
      tags: strings("tags"),
      os: strings("os"),
      hasHandler: row.hasHandler === true,
    };
  });
}

function openSkillCatalogPanel(vscode, { command, runCliResult, cwd } = {}) {
  if (currentPanel) {
    currentPanel.reveal();
    return currentPanel;
  }
  const panel = vscode.window.createWebviewPanel(
    "chainlesschainSkillCatalog",
    "技能库",
    vscode.ViewColumn.Active,
    panelOptions(vscode),
  );
  currentPanel = panel;
  let busy = false,
    disposed = false,
    catalog = [],
    retrieval = null,
    visible = [];
  const post = (message) => !disposed && panel.webview.postMessage(message);
  const notice = (text, kind = "info") => post({ type: "notice", text, kind });
  const run = async (args) => {
    const result = await runCliResult({
      command,
      args,
      cwd,
      timeoutMs: 30000,
      maxBufferBytes: 8 * 1024 * 1024,
    });
    if (!result.ok)
      throw new Error(
        (
          result.stderr ||
          result.error?.message ||
          "CLI 调用失败，请检查 CLI 安装后刷新。"
        ).slice(0, 2048),
      );
    return result.stdout;
  };
  panel.webview.onDidReceiveMessage(async (message) => {
    if (
      busy ||
      disposed ||
      !["ready", "refresh", "search", "back", "copy", "audit"].includes(
        message?.type,
      )
    )
      return;
    busy = true;
    post({ type: "busy", value: true });
    try {
      if (["ready", "refresh"].includes(message.type)) {
        catalog = parseSkillCatalog(await run(["skill", "list", "--json"]));
        retrieval = null;
        visible = catalog;
        post({ type: "catalog", rows: catalog });
        notice(`已发现 ${catalog.length} 个技能。列表只读，点击卡片查看详情。`);
      } else if (message.type === "search") {
        const args = buildSkillRetrievalArgs(message.query, { limit: 64 });
        notice("正在按任务检索技能…");
        retrieval = parseSkillRetrievalResult(await run(args));
        visible = retrieval.candidates.map((candidate, index) => ({
          key: `result-${index}`,
          id: candidate.id,
          displayName: candidate.displayName,
          description: candidate.reason,
          source: candidate.namespace,
          category: candidate.category,
          version: candidate.version,
          tags: [],
          os: [],
          hasHandler: false,
          retrieval: candidate,
        }));
        post({
          type: "results",
          rows: visible,
          result: retrieval,
          query: args[2],
        });
        notice(
          `检索得到 ${visible.length} 项结果。可查看匹配依据，或返回全部技能。`,
        );
      } else if (message.type === "back") {
        retrieval = null;
        visible = catalog;
        post({ type: "catalog", rows: catalog });
        notice("已返回技能列表。");
      } else if (message.type === "copy") {
        const row = visible.find((r) => r.key === message.key);
        if (!row) throw new Error("技能已变化，请刷新后重新选择。");
        await vscode.env.clipboard.writeText(row.id);
        notice("已复制技能 ID。复制不会执行技能。");
      } else if (retrieval) {
        const document = await vscode.workspace.openTextDocument({
          language: "json",
          content: JSON.stringify(retrieval, null, 2),
        });
        await vscode.window.showTextDocument(document, { preview: true });
      }
    } catch (error) {
      notice(error.message, "error");
    } finally {
      busy = false;
      post({ type: "busy", value: false });
    }
  });
  panel.onDidDispose(() => {
    disposed = true;
    if (currentPanel === panel) currentPanel = null;
  });
  panel.webview.html = panelHtml(vscode, panel.webview, {
    title: "技能库",
    body: BODY,
    script: "skill-catalog.js",
  });
  return panel;
}
module.exports = { openSkillCatalogPanel, parseSkillCatalog };
