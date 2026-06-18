/**
 * Guided LLM configuration for the chat panel — the extension is only a
 * thin wizard: all reads/writes/tests go through the CLI (`cc config
 * get/set`, `cc llm test`), so there is exactly one source of truth
 * (~/.chainlesschain/config.json) and zero home-dir resolution here.
 *
 * Pure Node (no `vscode`); `deps.execFile` injectable for tests.
 */
const { execFile } = require("child_process");

/** Curated provider presets (ids must match the CLI's BUILT_IN_PROVIDERS). */
const PROVIDER_PRESETS = [
  { id: "volcengine", label: "火山引擎 / 豆包 (volcengine)", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", defaultModel: "doubao-seed-1-6-251015", needsKey: true },
  { id: "ollama", label: "Ollama (本地, 免 key)", baseUrl: "http://localhost:11434", defaultModel: "qwen2.5:7b", needsKey: false },
  { id: "anthropic", label: "Anthropic Claude", baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-4-6", needsKey: true },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o", needsKey: true },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", needsKey: true },
  { id: "dashscope", label: "阿里云百炼 / 通义 (dashscope)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-max", needsKey: true },
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
  return providerId === "volcengine" ? "doubao-seed-1-6-vision-250815" : "";
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

/** Currently configured provider (null when unset / CLI missing). */
async function getConfiguredProvider({ command = "cc", deps } = {}) {
  const r = await runCli(command, ["config", "get", "llm.provider"], deps);
  if (!r.ok) return null;
  // `cc config get` prints `llm.provider = volcengine` or the bare value;
  // tolerate both, and treat undefined/null/empty as unconfigured.
  const raw = r.stdout.trim().split("=").pop().trim();
  return raw && !/^(undefined|null)$/i.test(raw) ? raw : null;
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
  getConfiguredProvider,
  applyLlmConfig,
  testLlm,
};
