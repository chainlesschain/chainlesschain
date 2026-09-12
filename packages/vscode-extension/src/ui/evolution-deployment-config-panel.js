"use strict";

const api = require("../evolution-deployment-config.js");
const { panelHtml, panelOptions } = require("./panel-shell.js");

let currentPanel = null;

const READINESS_SECTION = `<section class="card"><h2>模型命令部署准入</h2><p class="hint">这里只检查部署准入，实际任务运行尚未验证。</p><div class="summary-line"><strong id="readiness-ask">ask：未提供准入诊断</strong></div><p id="readiness-ask-detail" class="mono"></p><p id="readiness-ask-remediation" class="mono"></p><div class="summary-line"><strong id="readiness-agent">agent：未提供准入诊断</strong></div><p id="readiness-agent-detail" class="mono"></p><p id="readiness-agent-remediation" class="mono"></p></section>`;

const BODY = `<main class="page"><header class="header"><div><div class="eyebrow">CHAINLESSCHAIN / GOVERNANCE</div><h1>Skill 自进化配置</h1><p class="subtitle">配置经过签名的受治理部署。保存时会校验描述符、Ed25519 信任根、模块摘要和签名。</p></div><span class="badge" id="status">读取中</span></header><div id="notice" class="notice" role="status" aria-live="polite">正在读取本机配置…</div><div class="form-grid"><section class="card"><div class="field"><label for="descriptor">签名部署描述符</label><div class="field-row"><input id="descriptor" spellcheck="false" placeholder="选择 deployment descriptor JSON 的绝对路径"><button id="browse-descriptor" type="button">选择</button></div></div><div class="field"><label for="trustRoot">信任根公钥</label><div class="field-row"><input id="trustRoot" spellcheck="false" placeholder="选择 Ed25519 public key 的绝对路径"><button id="browse-trust" type="button">选择</button></div></div><div class="form-footer"><span class="hint">环境变量配置优先于这里保存的本机配置。</span><div class="actions"><button id="reload" type="button">刷新</button><button id="toggle" type="button" disabled>启用</button><button class="primary" id="save" type="button">校验、保存并启用</button></div></div></section><aside><section class="card"><h2>治理状态</h2><div class="summary-line"><span>生效来源</span><strong id="source">—</strong></div><div class="summary-line"><span>签名校验</span><strong id="verified">—</strong></div><div class="summary-line"><span>自动发布</span><strong>HOLD（仍需人工审核）</strong></div><div class="summary-line"><span>配置文件</span><div id="profile" class="mono">—</div></div><div class="summary-line"><span>允许命令</span><div id="commands" class="mono">—</div></div></section></aside></div></main>`;

function openEvolutionDeploymentConfigPanel(vscode, options = {}) {
  if (currentPanel) {
    currentPanel.reveal();
    return currentPanel;
  }
  const panel = vscode.window.createWebviewPanel(
    "chainlesschainEvolutionDeploymentConfig",
    "Skill 自进化配置",
    vscode.ViewColumn.Active,
    panelOptions(vscode),
  );
  currentPanel = panel;
  let busy = false;
  let disposed = false;
  let status = null;
  const post = (message) => !disposed && panel.webview.postMessage(message);
  const postStatus = () =>
    post({
      type: "status",
      status,
      readinessRows: api.deploymentReadinessRows(status),
    });
  const runtime = () => ({
    command: options.getCommand(),
    cwd: options.getCwd?.(),
  });
  async function refresh() {
    status = await api.getEvolutionDeploymentStatus(runtime());
    postStatus();
  }
  panel.webview.onDidReceiveMessage(async (message) => {
    if (busy || disposed || typeof message?.type !== "string") return;
    if (message.type === "browse") {
      const selected = await vscode.window.showOpenDialog({
        title:
          message.target === "descriptor"
            ? "选择签名部署描述符"
            : "选择 Ed25519 信任根公钥",
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        filters:
          message.target === "descriptor"
            ? { JSON: ["json"] }
            : { "Public key": ["pem", "pub", "key"], "All files": ["*"] },
      });
      if (selected?.[0])
        post({
          type: "picked",
          target: message.target,
          path: selected[0].fsPath,
        });
      return;
    }
    if (!["ready", "reload", "save", "toggle"].includes(message.type)) return;
    busy = true;
    post({ type: "busy", value: true });
    try {
      if (message.type === "save") {
        status = await api.configureEvolutionDeployment(
          message.value || {},
          runtime(),
        );
      } else if (message.type === "toggle") {
        status = await api.setEvolutionDeploymentEnabled(
          status?.profileEnabled !== true,
          runtime(),
        );
      } else {
        await refresh();
      }
      if (status) postStatus();
      post({
        type: "notice",
        kind: status?.error ? "error" : "success",
        text:
          status?.error ||
          "配置状态已更新；实际任务运行尚未验证，自动发布仍保持 HOLD。",
      });
    } catch (error) {
      post({ type: "notice", kind: "error", text: error.message });
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
    title: "Skill 自进化配置",
    body: BODY.replace("</aside>", READINESS_SECTION + "</aside>"),
    script: "evolution-deployment-config.js",
  });
  return panel;
}

module.exports = { openEvolutionDeploymentConfigPanel };
