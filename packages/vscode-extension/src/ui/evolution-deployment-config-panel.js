"use strict";

const api = require("../evolution-deployment-config.js");
const { panelHtml, panelOptions } = require("./panel-shell.js");

let currentPanel = null;

const READINESS_SECTION = `<section class="card"><h2>模型命令部署准入</h2><p class="hint">这里只检查部署准入，实际任务运行尚未验证。</p><div class="summary-line"><strong id="readiness-ask">ask：未提供准入诊断</strong></div><p id="readiness-ask-detail" class="mono"></p><p id="readiness-ask-remediation" class="mono"></p><div class="summary-line"><strong id="readiness-agent">agent：未提供准入诊断</strong></div><p id="readiness-agent-detail" class="mono"></p><p id="readiness-agent-remediation" class="mono"></p></section>`;

const BODY = `<main class="page"><header class="header"><div><div class="eyebrow">CHAINLESSCHAIN / GOVERNANCE</div><h1>Skill 自进化配置</h1><p class="subtitle">默认关闭；CLI、cc ui 与 IDE 共用 config.json 的 evolution.enabled。关闭后仍可正常使用 Agent；切换后请停止并重新启动会话。</p></div><span class="badge" id="status">读取中</span></header><div id="notice" class="notice" role="status" aria-live="polite">正在读取本机配置…</div><section class="card"><h2>自进化开关</h2><p class="hint">首次开启会初始化本地运行时；也可使用下方配置的部署。配置文件："evolution": { "enabled": false }。自动发布仍需人工审核。</p><button id="toggle" type="button" aria-pressed="false" disabled>开启自进化</button></section><div class="form-grid"><section class="card"><h2>上线前测试开发入口</h2><p class="hint">选择单文件 ESM 部署宿主后生成 Ed25519 测试密钥、签名描述符并立即启用。测试凭据仅保存在本机；自动发布仍为 HOLD。</p><div class="field"><label for="modulePath">测试部署宿主模块</label><div class="field-row"><input id="modulePath" spellcheck="false" placeholder="选择 deployment host .mjs/.js 的绝对路径"><button id="browse-module" type="button">选择</button></div></div><div class="actions"><button class="primary" id="init-test" type="button">一键生成/刷新测试环境</button></div><hr><h2>正式部署</h2><div class="field"><label for="descriptor">签名部署描述符</label><div class="field-row"><input id="descriptor" spellcheck="false" placeholder="选择 deployment descriptor JSON 的绝对路径"><button id="browse-descriptor" type="button">选择</button></div></div><div class="field"><label for="trustRoot">信任根公钥</label><div class="field-row"><input id="trustRoot" spellcheck="false" placeholder="选择 Ed25519 public key 的绝对路径"><button id="browse-trust" type="button">选择</button></div></div><div class="form-footer"><span class="hint">测试模式下可一键安全轮换到正式根；其他情况使用普通校验保存。</span><div class="actions"><button id="reload" type="button">刷新</button><button id="replace-test" type="button" disabled>替换测试证书并转正式</button><button class="primary" id="save" type="button">校验、保存并启用</button></div></div></section><aside><section class="card"><h2>治理状态</h2><div class="summary-line"><span>部署模式</span><strong id="mode">—</strong></div><div class="summary-line"><span>生效来源</span><strong id="source">—</strong></div><div class="summary-line"><span>签名校验</span><strong id="verified">—</strong></div><div class="summary-line"><span>自动发布</span><strong>HOLD（仍需人工审核）</strong></div><div class="summary-line"><span>配置文件</span><div id="profile" class="mono">—</div></div><div class="summary-line"><span>允许命令</span><div id="commands" class="mono">—</div></div></section></aside></div></main>`;

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
            : message.target === "module"
              ? "选择 Skill 自进化部署宿主模块"
              : "选择 Ed25519 信任根公钥",
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        filters:
          message.target === "descriptor"
            ? { JSON: ["json"] }
            : message.target === "module"
              ? { "ES modules": ["mjs", "js"], "All files": ["*"] }
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
    if (
      ![
        "ready",
        "reload",
        "save",
        "toggle",
        "init-test",
        "replace-test",
      ].includes(message.type)
    )
      return;
    busy = true;
    post({ type: "busy", value: true });
    try {
      if (message.type === "init-test") {
        status = await api.initializeEvolutionTestDeployment(
          message.value || {},
          runtime(),
        );
      } else if (message.type === "replace-test") {
        status = await api.replaceEvolutionTestDeployment(
          message.value || {},
          runtime(),
        );
      } else if (message.type === "save") {
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
          (status?.replacedTestDeployment
            ? "测试根已安全轮换为正式受管证书；请重启 IDE、cc ui 或 Desktop 长驻进程后做正式验证。"
            : status?.deploymentMode === "test"
              ? "测试开发环境已启用；该凭据禁止用于生产，自动发布仍保持 HOLD。"
              : status?.profileEnabled
                ? "自进化已开启；请停止并重新启动 Agent 会话后生效，自动发布仍为 HOLD。"
                : "自进化已关闭；请停止并重新启动 Agent 会话后生效，普通聊天和工具功能仍可使用。"),
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
