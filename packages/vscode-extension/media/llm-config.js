"use strict";
/* global acquireVsCodeApi, document, window */
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
let current = null,
  presets = [],
  busy = false,
  dirty = false;
const protocols = ["openai", "anthropic", "gemini", "ollama"];
const normalized = (url) => String(url || "").replace(/\/+$/, "");
function provider() {
  return $("preset").value === "custom"
    ? $("protocol").value
    : $("preset").value;
}
function update() {
  $("protocol-field").hidden = $("preset").value !== "custom";
  const p = provider();
  $("key-field").hidden = p === "ollama";
  const same =
    p === current?.provider &&
    normalized($("baseUrl").value.trim()) === normalized(current?.baseUrl);
  $("apiKey").placeholder =
    same && current?.hasKey ? "已保存密钥 · 留空保留" : "输入此服务的 API Key";
  $("key-hint").textContent =
    same && current?.hasKey
      ? "已有密钥不会显示或回传到页面。留空即可保留。"
      : "新服务或新中转地址需填写对应密钥，原服务的密钥不会被复用。";
  $("url-hint").textContent =
    p === "ollama"
      ? "例如 http://localhost:11434；不要填写 /api/generate。"
      : p === "gemini"
        ? "填写 Gemini 兼容接口基础地址，通常以 /v1beta 结尾。"
        : p === "anthropic"
          ? "填写 Anthropic 兼容接口基础地址，通常以 /v1 结尾；不要填写 /messages。"
          : "例如 https://your-relay.example/v1；不要填写 /chat/completions。";
  try {
    const url = new URL($("baseUrl").value);
    $("http-field").hidden =
      url.protocol !== "http:" ||
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    $("http-field").hidden = true;
  }
  $("fields").disabled = busy;
  $("save").disabled = busy || !dirty;
  $("test").disabled = busy || dirty || !current?.model;
  $("reload").disabled = busy;
  $("dirty").textContent = dirty
    ? "有未保存的修改 · 保存后再测试"
    : "配置已同步";
}
function fill(c) {
  const preset = presets.find(
    (p) =>
      p.id === c.provider && normalized(p.baseUrl) === normalized(c.baseUrl),
  );
  $("preset").value = preset ? preset.id : "custom";
  $("protocol").value = protocols.includes(c.provider) ? c.provider : "openai";
  for (const key of ["model", "baseUrl", "visionModel"])
    $(key).value = c[key] || "";
  $("apiKey").value = "";
  $("allowHttp").checked = false;
  $("saved-provider").textContent =
    presets.find((p) => p.id === c.provider)?.label || c.provider;
  $("saved-model").textContent = c.model || "未配置";
  $("saved-url").textContent = c.baseUrl || "未配置";
  $("saved-key").textContent = c.hasKey
    ? "已安全保存"
    : c.provider === "ollama"
      ? "本地服务无需密钥"
      : "未配置";
  $("connection-status").textContent = c.model ? "已读取配置" : "等待配置";
  dirty = false;
  update();
}
$("preset").onchange = () => {
  const p = presets.find((p) => p.id === $("preset").value);
  if (p) {
    $("baseUrl").value = p.baseUrl;
    $("model").value = p.defaultModel;
    $("visionModel").value =
      p.id === "volcengine" ? "doubao-seed-2-0-lite-260215" : "";
  }
  $("apiKey").value = "";
  dirty = true;
  update();
};
$("protocol").onchange = () => {
  $("apiKey").value = "";
  dirty = true;
  update();
};
for (const key of ["model", "baseUrl", "visionModel", "apiKey", "allowHttp"])
  $(key).addEventListener("input", () => {
    dirty = true;
    update();
  });
$("form").onsubmit = (event) => {
  event.preventDefault();
  if (busy) return;
  const answers = {
    provider: provider(),
    model: $("model").value,
    baseUrl: $("baseUrl").value,
    visionModel: $("visionModel").value,
    apiKey: $("apiKey").value,
    allowHttp: $("allowHttp").checked,
  };
  vscode.postMessage({ type: "save", answers });
};
$("reload").onclick = () => vscode.postMessage({ type: "reload" });
$("test").onclick = () => vscode.postMessage({ type: "test" });
window.addEventListener("message", ({ data: m }) => {
  if (m.type === "config") {
    current = m.current;
    presets = m.presets;
    $("preset").replaceChildren();
    for (const p of [{ id: "custom", label: "自定义 / 中转站" }, ...presets]) {
      const option = document.createElement("option");
      option.value = p.id;
      option.textContent = p.label;
      $("preset").append(option);
    }
    fill(current);
  } else if (m.type === "busy") {
    busy = m.value;
    update();
  } else if (m.type === "notice") {
    $("notice").textContent = m.text;
    $("notice").className = "notice " + m.kind;
  }
});
vscode.postMessage({ type: "ready" });
