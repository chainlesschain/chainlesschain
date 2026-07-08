/**
 * Guided LLM configuration for the chat panel — the extension is only a
 * thin wizard: all reads/writes/tests go through the CLI (`cc config
 * get/set`, `cc llm test`), so there is exactly one source of truth
 * (~/.chainlesschain/config.json) and zero home-dir resolution here.
 *
 * Pure Node (no `vscode`); `deps.execFile` injectable for tests.
 */
const { execFile } = require("child_process");
const { hardenedEnv } = require("./hardened-env");
const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * Read the `llm` block straight from ~/.chainlesschain/config.json — the SAME
 * file `cc config set` writes (CONFIG_DIR_NAME=".chainlesschain"; paths.js
 * getConfigPath has NO env override, so this is authoritative).
 *
 * WHY a direct file read instead of `cc config get`: detection must not depend
 * on the `cc` binary being runnable. Right after `npm i -g chainlesschain`,
 * `cc` is frequently mid-rebuild (native module ABI / EBUSY lock / PATH shim),
 * so `cc config get` exits non-zero. The old code treated that failure as
 * "LLM unconfigured" → the panel demanded a full re-setup after EVERY update
 * even though config.json was intact. That is the recurring "更新npm后又要重新
 * 配置LLM" bug. Reading the file makes detection independent of cc's health.
 *
 * Returns the llm object, or null when the file is missing/corrupt/has no llm.
 */
function readLlmConfigFromFile(deps) {
  const readFileSync = deps?.readFileSync || fs.readFileSync;
  const homedir = deps?.homedir || os.homedir;
  try {
    const file = path.join(homedir(), ".chainlesschain", "config.json");
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    return cfg && typeof cfg.llm === "object" && cfg.llm ? cfg.llm : null;
  } catch (_e) {
    return null; // missing / unreadable / invalid JSON → defer to CLI fallback
  }
}

/** Normalize a config value → non-empty trimmed string, or null. */
function cleanConfigValue(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s && !/^(undefined|null)$/i.test(s) ? s : null;
}

/** Curated provider presets (ids must match the CLI's BUILT_IN_PROVIDERS). */
const PROVIDER_PRESETS = [
  { id: "volcengine", label: "Volcengine / Doubao (volcengine)", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", defaultModel: "doubao-seed-2-1-pro-260628", needsKey: true },
  { id: "ollama", label: "Ollama (local, no key)", baseUrl: "http://localhost:11434", defaultModel: "qwen2.5:7b", needsKey: false },
  { id: "anthropic", label: "Anthropic Claude", baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-4-6", needsKey: true },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o", needsKey: true },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", needsKey: true },
  { id: "dashscope", label: "Aliyun Bailian / Tongyi (dashscope)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-max", needsKey: true },
  { id: "kimi", label: "Moonshot Kimi", baseUrl: "https://api.moonshot.cn/v1", defaultModel: "moonshot-v1-auto", needsKey: true },
  { id: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-2.0-flash", needsKey: true },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-large-latest", needsKey: true },
  { id: "minimax", label: "MiniMax", baseUrl: "https://api.minimax.chat/v1", defaultModel: "abab6.5s-chat", needsKey: true },
];

/**
 * Values are passed to `cc config set` as argv items through a Windows shell
 * (npm .cmd shims need one), where metacharacters cannot be quoted reliably.
 * Reject them up front with a clear message instead of corrupting the config.
 */
function hasUnsafeShellChars(value) {
  return /[\s&|<>^"'`%]/.test(String(value));
}

/** The `cc config set` invocations for the wizard's answers (skips blanks). */
function buildConfigSetArgs({ provider, model, apiKey, baseUrl, visionModel } = {}) {
  const sets = [];
  if (provider) sets.push(["config", "set", "llm.provider", provider]);
  if (model) sets.push(["config", "set", "llm.model", model]);
  if (baseUrl) sets.push(["config", "set", "llm.baseUrl", baseUrl]);
  if (apiKey) sets.push(["config", "set", "llm.apiKey", apiKey]);
  // Vision (image-recognition) model — often differs from the text model; the
  // CLI auto-switches to it when a turn carries images. Blank = reuse the text
  // model / the CLI default, so it is omitted.
  if (visionModel) sets.push(["config", "set", "llm.visionModel", visionModel]);
  return sets;
}

/**
 * Suggested default vision (image-recognition) model for a provider, when it
 * differs from the text model. Blank = use the text model / the CLI default.
 */
function suggestVisionModel(providerId) {
  // Mirror the CLI's DEFAULT_VISION_MODEL (image-input.js) so the prefilled
  // suggestion equals what `cc agent --image` would use by default.
  return providerId === "volcengine" ? "doubao-seed-2-0-lite-260215" : "";
}

/**
 * Does this agent error message look like an LLM provider/key configuration
 * problem (auth failure / missing key) — worth surfacing the guided-setup card
 * instead of a bare error? Mirrors the JetBrains LlmConfig.looksLikeLlmConfigError
 * so both panels treat a bare `401`/`403`/`unauthorized` the same way (the
 * connection-refused cases are handled separately by the caller). Pure/testable.
 */
function looksLikeLlmConfigError(message) {
  if (!message) return false;
  const m = String(message).toLowerCase();
  return (
    m.includes("401") ||
    m.includes("403") ||
    m.includes("api key") ||
    m.includes("api_key") ||
    m.includes("unauthorized") ||
    m.includes("authentication failed") ||
    m.includes("invalid api key") ||
    m.includes("incorrect api key")
  );
}

function runCli(command, args, deps) {
  const run = deps?.execFile || execFile;
  return new Promise((resolve) => {
    run(
      command,
      args,
      {
        timeout: 60000,
        windowsHide: true,
        // Hardened so cmd.exe doesn't resolve a repo-local `cc.bat` before PATH.
        env: hardenedEnv(process.env),
        shell: process.platform === "win32",
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          error: err ? err.message : null,
        });
      },
    );
  });
}

/**
 * Read one `llm.<field>` for detection: the config FILE is the source of truth
 * (robust to a transiently-broken `cc` post-update); only when the file is
 * unreadable do we fall back to `cc config get`.
 */
async function readLlmField(field, { command = "cc", deps } = {}) {
  const llm = readLlmConfigFromFile(deps);
  if (llm) return cleanConfigValue(llm[field]); // file present → authoritative
  // File missing/corrupt → ask the CLI (legacy / relocated config).
  const r = await runCli(command, ["config", "get", `llm.${field}`], deps);
  if (!r.ok) return null;
  // `cc config get` prints `llm.<field> = value` or the bare value.
  return cleanConfigValue(r.stdout.trim().split("=").pop());
}

/** Currently configured provider (null when genuinely unset). */
async function getConfiguredProvider(opts = {}) {
  return readLlmField("provider", opts);
}

/** Currently configured vision model (null when unset). */
async function getConfiguredVisionModel(opts = {}) {
  return readLlmField("visionModel", opts);
}

/** Currently configured text model (null when unset). */
async function getConfiguredModel(opts = {}) {
  return readLlmField("model", opts);
}

/** Currently configured base URL (null when unset). */
async function getConfiguredBaseUrl(opts = {}) {
  return readLlmField("baseUrl", opts);
}

/**
 * True when an API key is already stored. Lets the wizard offer "leave blank to
 * keep the existing key" instead of forcing the user to re-type it on every
 * reconfigure (the #1 reported pain: "更新后又要重新配置模型和key"). The key
 * value itself is never surfaced to the UI — only its presence. File-first so a
 * post-update `cc` crash never makes the panel think the key vanished.
 */
async function hasConfiguredApiKey(opts = {}) {
  return !!(await readLlmField("apiKey", opts));
}

/**
 * Set just `llm.visionModel` — the dedicated vision-model entry, so the user
 * need not re-run the full wizard / re-type the API key. A blank value clears it
 * (revert to the text model / CLI default).
 */
async function setVisionModel({ command = "cc", visionModel, deps } = {}) {
  const v = (visionModel == null ? "" : String(visionModel)).trim();
  if (v && hasUnsafeShellChars(v)) {
    return { ok: false, error: "值含不安全字符 — 请去掉空格/引号/& 等再试" };
  }
  const r = await runCli(command, ["config", "set", "llm.visionModel", v], deps);
  return r.ok ? { ok: true } : { ok: false, error: r.error || r.stderr.slice(0, 200) };
}

/** Apply the wizard's answers via `cc config set` (sequential, fail-fast). */
async function applyLlmConfig({ command = "cc", answers, deps } = {}) {
  for (const [key, value] of Object.entries(answers || {})) {
    if (value && hasUnsafeShellChars(value)) {
      return { ok: false, error: `值含不安全字符 (${key}) — 请去掉空格/引号/& 等再试` };
    }
  }
  for (const args of buildConfigSetArgs(answers)) {
    const r = await runCli(command, args, deps);
    if (!r.ok) return { ok: false, error: r.error || r.stderr.slice(0, 200) };
  }
  return { ok: true };
}

/** Connectivity check via `cc llm test`. */
async function testLlm({ command = "cc", deps } = {}) {
  const r = await runCli(command, ["llm", "test"], deps);
  const tail = (r.stdout + r.stderr).trim().split("\n").slice(-3).join(" ");
  return { ok: r.ok, detail: tail.slice(0, 300) };
}

module.exports = {
  PROVIDER_PRESETS,
  hasUnsafeShellChars,
  buildConfigSetArgs,
  suggestVisionModel,
  looksLikeLlmConfigError,
  readLlmConfigFromFile,
  getConfiguredProvider,
  getConfiguredVisionModel,
  getConfiguredModel,
  getConfiguredBaseUrl,
  hasConfiguredApiKey,
  setVisionModel,
  applyLlmConfig,
  testLlm,
};
