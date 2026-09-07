"use strict";
const llm = require("../llm-config");
const { panelHtml, panelOptions } = require("./panel-shell");
let currentPanel = null;
const BODY = `<main class="page"><header class="header"><div><div class="eyebrow">CHAINLESSCHAIN / CONNECTIONS</div><h1>配置大模型</h1><p class="subtitle">连接官方服务、本地模型或自定义中转站。配置与 CLI、聊天面板共享。</p></div><span class="badge" id="connection-status">读取配置中</span></header><div id="notice" class="notice" role="status" aria-live="polite">正在读取现有配置，不会显示已保存的密钥。</div><div class="form-grid"><section class="card"><form id="form"><fieldset id="fields"><div class="field"><label for="preset">服务类型</label><select id="preset"><option value="custom">自定义 / 中转站</option></select><span class="hint">可以使用任何兼容接口；模型名称以中转站提供的名称为准。</span></div><div class="field" id="protocol-field"><label for="protocol">兼容协议</label><select id="protocol"><option value="openai">OpenAI 兼容 · Chat Completions</option><option value="anthropic">Anthropic · Messages</option><option value="gemini">Gemini · Generate Content</option><option value="ollama">Ollama · 本地接口</option></select></div><div class="field"><label for="baseUrl">接口基础地址（Base URL）</label><input id="baseUrl" type="url" required spellcheck="false" placeholder="https://your-relay.example/v1"><span id="url-hint" class="hint">填写基础地址（通常包含 /v1），不要填写 /chat/completions。</span></div><div class="field-row"><div class="field"><label for="model">文本模型</label><input id="model" required spellcheck="false" placeholder="填写模型 ID 或中转站别名"><span class="hint">支持自定义名称，无需出现在预设列表中。</span></div><div class="field"><label for="visionModel">视觉模型 · 可选</label><input id="visionModel" spellcheck="false" placeholder="留空使用文本模型 / CLI 默认"><span class="hint">用于截图和图片识别；模型须支持图片输入。</span></div></div><div class="field" id="key-field"><label for="apiKey">API Key</label><input id="apiKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="输入此服务的 API Key"><span id="key-hint" class="hint">密钥通过本地 CLI 的安全存储保存，不写入 IDE 设置。</span></div><div class="field" id="http-field" hidden><label class="checkbox"><input id="allowHttp" type="checkbox">此远程接口使用 HTTP，我确认允许以未加密连接访问。</label></div></fieldset><div class="form-footer"><span id="dirty" class="hint">尚未修改</span><div class="actions"><button id="reload" type="button">重新读取</button><button class="primary" id="save" type="submit">保存配置</button><button id="test" type="button">测试已保存连接</button></div></div></form></section><aside><section class="card"><h2>连接只需三步</h2><ol class="steps"><li><strong>选择服务与协议</strong><p>中转站通常选择 OpenAI 兼容；Claude 原生接口选 Anthropic。</p></li><li><strong>填写地址与模型</strong><p>可直接使用中转站的模型别名；换地址时请填写该站点的密钥。</p></li><li><strong>保存并测试</strong><p>测试会发送一次简短模型请求，可能产生少量费用。成功后，聊天下一条消息即使用新配置。</p></li></ol><div class="summary-line"><span>当前提供商 / 协议</span><strong id="saved-provider">—</strong></div><div class="summary-line"><span>当前模型</span><strong id="saved-model">—</strong></div><div class="summary-line"><span>当前地址</span><div id="saved-url" class="mono">—</div></div><div class="summary-line"><span>密钥状态</span><strong id="saved-key">—</strong></div></section></aside></div></main>`;

function validateAnswers(input, current) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("无效的配置");
  const answers = {};
  for (const key of ["provider", "model", "baseUrl", "visionModel", "apiKey"]) {
    if (
      typeof input[key] !== "string" ||
      input[key].length > (key === "apiKey" ? 8192 : 2048)
    )
      throw new Error(`无效的字段：${key}`);
    answers[key] = input[key].trim();
  }
  if (!llm.PROVIDER_PRESETS.some((p) => p.id === answers.provider))
    throw new Error("请选择支持的服务或兼容协议");
  if (!answers.model || /[\r\n\0]/.test(answers.model + answers.visionModel))
    throw new Error("请填写正确的模型名称");
  let url;
  try {
    url = new URL(answers.baseUrl);
  } catch {
    throw new Error("请填写完整的接口地址");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "地址需使用 HTTP(S)，且不能包含用户名、密码、查询参数或片段",
    );
  if (
    /\/(chat\/completions|messages|responses|api\/generate)\/?$/.test(
      url.pathname,
    )
  )
    throw new Error(
      "请填写接口基础地址，不要包含 /chat/completions、/messages 等具体接口",
    );
  answers.baseUrl = url.href.replace(/\/+$/, "");
  answers.allowHttp = input.allowHttp === true;
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    !answers.allowHttp
  )
    throw new Error("请先确认允许此远程 HTTP 连接");
  const same =
    current?.provider === answers.provider &&
    String(current.baseUrl || "").replace(/\/+$/, "") === answers.baseUrl;
  if (
    answers.provider !== "ollama" &&
    !answers.apiKey &&
    !(same && current.hasKey)
  )
    throw new Error("请输入此服务的 API Key。更换地址时不会复用原服务的密钥。");
  return answers;
}

function openLlmConfigPanel(
  vscode,
  { getCommand, onConfigured, api = llm } = {},
) {
  if (currentPanel) {
    currentPanel.reveal();
    return currentPanel;
  }
  const panel = vscode.window.createWebviewPanel(
    "chainlesschainLlmConfig",
    "配置大模型",
    vscode.ViewColumn.Active,
    panelOptions(vscode),
  );
  currentPanel = panel;
  let busy = false,
    disposed = false,
    current = null;
  const post = (value) => !disposed && panel.webview.postMessage(value);
  const notice = (text, kind = "info") => post({ type: "notice", text, kind });
  const command = () =>
    getCommand?.() || require("../cli-binary").getResolvedCli();
  async function read() {
    const options = { command: command() };
    const [provider, model, baseUrl, visionModel, hasKey] = await Promise.all([
      api.getConfiguredProvider(options),
      api.getConfiguredModel(options),
      api.getConfiguredBaseUrl(options),
      api.getConfiguredVisionModel(options),
      api.hasConfiguredApiKey(options),
    ]);
    current = {
      provider: provider || "ollama",
      model: model || "",
      baseUrl:
        baseUrl ||
        api.PROVIDER_PRESETS.find((p) => p.id === (provider || "ollama"))
          ?.baseUrl ||
        "",
      visionModel: visionModel || "",
      hasKey,
    };
    post({ type: "config", current, presets: api.PROVIDER_PRESETS });
  }
  panel.webview.onDidReceiveMessage(async (message) => {
    if (
      busy ||
      disposed ||
      !["ready", "reload", "save", "test"].includes(message?.type)
    )
      return;
    busy = true;
    post({ type: "busy", value: true });
    try {
      if (["ready", "reload"].includes(message.type)) {
        await read();
        notice(
          "已读取现有配置。修改后保存，密钥留空可保留同一服务的现有密钥。",
        );
      } else if (message.type === "save") {
        const answers = validateAnswers(message.answers, current);
        notice("正在保存连接配置…");
        const result = await api.applyLlmConnection({
          command: command(),
          answers,
        });
        if (!result.ok) throw new Error(result.error || "保存失败");
        await read();
        await onConfigured?.();
        notice(
          "配置已保存。可以测试连接；聊天的下一条消息将使用新配置。",
          "success",
        );
      } else {
        notice("正在测试已保存的连接，通常需要几秒…");
        const result = await api.testLlm({ command: command() });
        notice(
          result.ok
            ? `连接成功。${result.detail || ""}`
            : `连接未通过：${result.detail || "请检查接口地址、协议、模型权限和账户余额。"}`,
          result.ok ? "success" : "error",
        );
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
    title: "配置大模型",
    body: BODY,
    script: "llm-config.js",
  });
  return panel;
}
module.exports = { openLlmConfigPanel, validateAnswers };
