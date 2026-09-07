"use strict";
const { panelHtml, panelOptions } = require("./panel-shell");
const {
  validateEvolutionWorkbenchProjection,
} = require("./evolution-workbench-view");
let currentPanel = null;

const BODY = `<main class="page"><header class="header"><div><div class="eyebrow">CHAINLESSCHAIN / EVOLUTION</div><h1>演化工作台</h1><p class="subtitle">查看候选版本与证据，审核改进，随时回到已批准的版本。</p></div><div class="toolbar"><span id="mode" class="badge">连接中</span><button id="setup">连接配置</button><button id="refresh">刷新</button></div></header><div id="notice" class="notice" role="status" aria-live="polite">正在连接工作台…</div><section class="stats" aria-label="版本统计"><div class="stat"><strong id="total">—</strong><span>候选版本</span></div><div class="stat"><strong id="pending">—</strong><span>等待审核</span></div><div class="stat"><strong id="approved">—</strong><span>已批准</span></div><div class="stat"><strong id="active">—</strong><span>正在使用</span></div></section><div class="split"><aside class="card list-card"><input id="search" aria-label="搜索版本" placeholder="搜索版本名称或摘要"><nav class="filters" aria-label="版本筛选"><button data-filter="all" class="selected">全部</button><button data-filter="pending">待审核</button><button data-filter="active">使用中</button><button data-filter="approved">已批准</button></nav><div id="candidates"></div></aside><section class="card"><div id="empty" class="empty"><h2>选择一个版本</h2><p>左侧选择候选版本，查看具体改动和审核依据。</p></div><div id="detail" hidden><div class="detail-head"><div><span id="candidate-status" class="badge"></span><div id="candidate-name" class="detail-id"></div></div><button id="raw">原始记录</button></div><dl id="summary" class="detail-grid"></dl><nav class="tabs" aria-label="详情类型"><button class="selected" data-tab="changes">内容差异</button><button data-tab="evidence">审核证据</button><button data-tab="validation">评测与使用</button></nav><pre id="detail-content"></pre><div class="section"><label for="compare-target">与其他版本对比</label><div class="field-row"><select id="compare-target"></select><button id="compare">对比版本</button></div></div><div class="section"><label for="reason">审核 / 回滚原因</label><textarea id="reason" maxlength="2048" placeholder="说明你检查了哪些证据，以及本次决定的原因。"></textarea><div class="actions"><button class="primary" id="approve">批准此版本</button><button class="danger" id="reject">拒绝此版本</button><button id="rollback">回滚到此版本</button></div><p id="action-hint" class="hint"></p></div></div></section></div></main>`;

function openEvolutionWorkbenchPanel(vscode, { getPilot, openSetup } = {}) {
  if (currentPanel) {
    currentPanel.reveal();
    return currentPanel;
  }
  const panel = vscode.window.createWebviewPanel(
    "chainlesschainEvolutionWorkbench",
    "演化工作台",
    vscode.ViewColumn.Active,
    panelOptions(vscode),
  );
  currentPanel = panel;
  let projection = null;
  let pilot = null;
  let methods = new Set();
  let busy = false;
  let disposed = false;
  const post = (value) => !disposed && panel.webview.postMessage(value);
  const notice = (text, kind = "info") => post({ type: "notice", text, kind });
  async function refresh() {
    projection = null;
    methods = new Set();
    try {
      pilot = await getPilot();
      const capability = (await pilot.start())?.evolutionWorkbench;
      if (
        capability?.available !== true ||
        !capability.methods?.includes("list")
      ) {
        post({
          type: "snapshot",
          projection: null,
          mode: "unavailable",
          methods: [],
        });
        notice(
          "尚未连接受治理的工作台。点击「连接配置」选择部署配置，或使用本地测试环境。",
          "error",
        );
        return;
      }
      methods = new Set(capability.methods);
      projection = validateEvolutionWorkbenchProjection(
        await pilot.evolutionWorkbenchList({ limit: 500 }),
      );
      post({
        type: "snapshot",
        projection,
        mode: pilot.workbenchMode || "governed",
        methods: [...methods],
      });
      notice(
        pilot.workbenchMode === "local-test"
          ? "本地测试环境 · 使用测试身份与数据，操作仅写入独立测试账本。"
          : "工作台已连接。审批仍由部署配置的身份与人工审批服务验证。",
      );
      return true;
    } catch (error) {
      post({
        type: "snapshot",
        projection: null,
        mode: "unavailable",
        methods: [],
      });
      notice(error.message, "error");
    }
  }
  panel.webview.onDidReceiveMessage(async (message) => {
    if (!message || busy || disposed) return;
    busy = true;
    post({ type: "busy", value: true });
    try {
      if (["ready", "refresh"].includes(message.type)) {
        await refresh();
        return;
      }
      if (message.type === "setup") {
        await openSetup?.();
        await refresh();
        return;
      }
      if (
        !["details", "compare", "approve", "reject", "rollback"].includes(
          message.type,
        )
      )
        return;
      if (
        !projection ||
        message.projectionDigest !== projection.projectionDigest
      )
        throw new Error("版本数据已更新，请刷新后重试。");
      const candidate = projection.candidates.find(
        (c) => c.packetDigest === message.packetDigest,
      );
      if (!candidate) throw new Error("候选版本不存在，请刷新后重试。");
      if (message.type === "details") {
        const document = await vscode.workspace.openTextDocument({
          language: "json",
          content: JSON.stringify(candidate, null, 2),
        });
        await vscode.window.showTextDocument(document, { preview: true });
        return;
      }
      const required = ["approve", "reject"].includes(message.type)
        ? "review"
        : message.type;
      if (!methods.has(required)) throw new Error("当前部署未开放此操作。");
      // Never submit a mutation based on a stale page, even when the packet is
      // still present. The CLI performs its own independent authority checks.
      const latest = validateEvolutionWorkbenchProjection(
        await pilot.evolutionWorkbenchList({ limit: 500 }),
      );
      if (latest.projectionDigest !== projection.projectionDigest) {
        await refresh();
        throw new Error("版本状态已经变化，请检查最新数据后重新操作。");
      }
      let result;
      if (message.type === "compare") {
        if (
          !projection.candidates.some(
            (c) => c.packetDigest === message.otherPacketDigest,
          ) ||
          message.otherPacketDigest === candidate.packetDigest
        )
          throw new Error("请选择另一个版本进行对比。");
        result = await pilot.evolutionWorkbenchCompare({
          leftPacketDigest: candidate.packetDigest,
          rightPacketDigest: message.otherPacketDigest,
        });
        post({ type: "comparison", result });
        return;
      }
      const reason =
        typeof message.reason === "string" ? message.reason.trim() : "";
      if (!reason || reason.length > 2048)
        throw new Error("请填写 1–2048 字的操作原因。");
      const isRollback = message.type === "rollback";
      const active = projection.candidates.filter((c) => c.actualUsage.active);
      if (
        isRollback
          ? candidate.status !== "approved" ||
            candidate.actualUsage.active ||
            active.length !== 1
          : candidate.status !== "pending"
      )
        throw new Error("该版本当前不支持此操作。");
      const action = isRollback
        ? "确认回滚"
        : message.type === "approve"
          ? "确认批准"
          : "确认拒绝";
      const chosen = await vscode.window.showWarningMessage(
        `${pilot.workbenchMode === "local-test" ? "[本地测试] " : ""}${action} ${candidate.candidateId}？`,
        {
          modal: true,
          detail: `版本摘要：${candidate.packetDigest}\n原因：${reason}`,
        },
        action,
      );
      if (chosen !== action || disposed) return;
      const confirmed = validateEvolutionWorkbenchProjection(
        await pilot.evolutionWorkbenchList({ limit: 500 }),
      );
      if (confirmed.projectionDigest !== projection.projectionDigest) {
        await refresh();
        throw new Error("确认期间版本状态发生变化，请核对最新数据后重新操作。");
      }
      result = isRollback
        ? await pilot.evolutionWorkbenchRollback({
            fromPacketDigest: active[0].packetDigest,
            toPacketDigest: candidate.packetDigest,
            reason,
          })
        : await pilot.evolutionWorkbenchReview({
            packetDigests: [candidate.packetDigest],
            decision: message.type,
            reason,
          });
      const refreshed = await refresh();
      post({ type: "operation", result });
      if (refreshed)
        notice(
          isRollback
            ? "回滚已完成，当前版本状态已刷新。"
            : "审核决定已保存，版本状态已刷新。",
          "success",
        );
      else
        notice(
          "操作请求已返回，但未能读取最新状态。请刷新核实，勿重复提交。",
          "error",
        );
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
    title: "演化工作台",
    body: BODY,
    script: "evolution-workbench.js",
  });
  return panel;
}
module.exports = { openEvolutionWorkbenchPanel };
