/**
 * Guided LLM configuration for the chat panel — the extension is only a
 * thin wizard: writes and connection tests go through the CLI. First-run
 * detection reads the shared config file first and uses the CLI's read-only
 * capability diagnostic for relocated/legacy configuration.
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
 * file `cc config set` writes by default. When a launcher supplies a config
 * root override, defer to the CLI's authoritative path/security validation.
 *
 * WHY a direct file read instead of `cc config get`: detection must not depend
 * on the `cc` binary being runnable. Right after `npm i -g chainlesschain`,
 * `cc` is frequently mid-rebuild (native module ABI / EBUSY lock / PATH shim),
 * so `cc config get` exits non-zero. The old code treated that failure as
 * "LLM unconfigured" → the panel demanded a full re-setup after EVERY update
 * even though config.json was intact. That is the recurring "更新npm后又要重新
 * 配置LLM" bug. Reading the file makes detection independent of cc's health.
 *
 * Returns an inspection state; callers decide whether a CLI fallback is safe.
 */
function inspectLlmConfigFile(deps) {
  const env = deps?.env || process.env;
  if (env.CHAINLESSCHAIN_HOME || env.CLAUDE_CONFIG_DIR)
    return { status: "defer" };
  const readFileSync = deps?.readFileSync || fs.readFileSync;
  const homedir = deps?.homedir || os.homedir;
  try {
    const file = path.join(homedir(), ".chainlesschain", "config.json");
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg))
      return { status: "unavailable" };
    if (!Object.hasOwn(cfg, "llm")) return { status: "defer" };
    if (!cfg.llm || typeof cfg.llm !== "object" || Array.isArray(cfg.llm))
      return { status: "unavailable" };
    return { status: "available", llm: cfg.llm };
  } catch (error) {
    return {
      status: ["ENOENT", "ENOTDIR"].includes(error?.code)
        ? "defer"
        : "unavailable",
    };
  }
}

function readLlmConfigFromFile(deps) {
  const result = inspectLlmConfigFile(deps);
  return result.status === "available" ? result.llm : null;
}

/** Normalize a config value → non-empty trimmed string, or null. */
function cleanConfigValue(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s && !/^(undefined|null)$/i.test(s) ? s : null;
}

// Generated from the CLI onboarding catalog; sync with
// node packages/cli/scripts/sync-llm-onboarding.mjs.
const PROVIDER_PRESETS = Object.freeze(
  require("./vendor/llm-onboarding-presets.json").providers.map((preset) =>
    Object.freeze(preset),
  ),
);

/**
 * Values are passed to `cc config set` as argv items through a Windows shell
 * (npm .cmd shims need one), where metacharacters cannot be quoted reliably.
 * Reject them up front with a clear message instead of corrupting the config.
 */
function hasUnsafeShellChars(value) {
  return /[\s&|<>^"'`%]/.test(String(value));
}

/**
 * The non-secret `cc config set` invocations for the wizard's answers.
 * API keys deliberately never enter argv; applyLlmConfig writes them through
 * `cc config set-secret` on stdin after these ordinary settings succeed.
 */
function buildConfigSetArgs({ provider, model, baseUrl, visionModel } = {}) {
  const sets = [];
  if (provider) sets.push(["config", "set", "llm.provider", provider]);
  if (model) sets.push(["config", "set", "llm.model", model]);
  if (baseUrl) sets.push(["config", "set", "llm.baseUrl", baseUrl]);
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
  return (
    PROVIDER_PRESETS.find((preset) => preset.id === providerId)?.visionModel ||
    ""
  );
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
  if (
    m.includes("accountoverdue") ||
    m.includes("overdue balance") ||
    m.includes("account balance/billing") ||
    m.includes("model access permissions")
  ) {
    return false;
  }
  return (
    m.includes("401") ||
    m.includes("api key") ||
    m.includes("api_key") ||
    m.includes("unauthorized") ||
    m.includes("authentication failed") ||
    m.includes("invalid api key") ||
    m.includes("incorrect api key")
  );
}

/** Add the missing 403 caveat for older CLIs that still label every 403 auth. */
function withLlmErrorGuidance(message) {
  const text = String(message || "");
  if (!/\b403\b/.test(text)) return text;
  if (
    /accountoverdue|overdue balance|account balance\/billing|model access/i.test(
      text,
    )
  ) {
    return text;
  }
  return (
    text +
    "\nHTTP 403 can also mean provider billing/account balance or model-access permission; check those before replacing the API key."
  );
}

function runCli(command, args, deps, { stdin, timeoutMs = 60000 } = {}) {
  const run = deps?.execFile || execFile;
  const executable =
    typeof command === "string" && command.trim()
      ? command
      : require("./cli-binary").getResolvedCli();
  const script = /\.(?:m?js|cjs)$/i.test(executable);
  return new Promise((resolve) => {
    const child = run(
      script ? process.execPath : executable,
      script ? [executable, ...args] : args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        // Hardened so cmd.exe doesn't resolve a repo-local `cc.bat` before PATH.
        env: hardenedEnv({
          ...(deps?.env || process.env),
          ...(script ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        }),
        shell: !script && process.platform === "win32",
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          error: err ? err.message : null,
          errorCode: err?.code,
        });
      },
    );
    if (stdin !== undefined) {
      if (!child?.stdin || typeof child.stdin.end !== "function") {
        child?.kill?.();
        resolve({
          ok: false,
          stdout: "",
          stderr: "",
          error: "cc process stdin is unavailable",
        });
        return;
      }
      // Ignore an EPIPE here; execFile's callback carries the actionable error.
      child.stdin.on?.("error", () => {});
      child.stdin.end(String(stdin));
    }
  });
}

function configurationState(
  provider,
  source,
  { requireProvider = false } = {},
) {
  if (provider != null && typeof provider !== "string")
    return unavailableConfiguration(source);
  const value = cleanConfigValue(provider);
  if (
    (requireProvider && !value) ||
    (value && (value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)))
  )
    return unavailableConfiguration(source);
  return {
    status: value ? "configured" : "unconfigured",
    provider: value,
    source,
  };
}

function unavailableConfiguration(source) {
  return {
    status: "unavailable",
    provider: null,
    source,
    code: "LLM_CONFIG_READ_FAILED",
  };
}

/**
 * First-run detection is distinct from connection verification. A corrupt file
 * must not be read through a CLI command that repairs it or falls back to defaults.
 * `llm capabilities` is an existing strict, secret-free, network-free diagnostic.
 */
async function getLlmConfigurationState({ command, deps } = {}) {
  const file = inspectLlmConfigFile(deps);
  if (file.status === "available")
    return configurationState(file.llm.provider, "file");
  if (file.status === "unavailable") return unavailableConfiguration("file");
  try {
    const result = await runCli(
      command,
      ["llm", "capabilities", "--json"],
      deps,
      { timeoutMs: 12000 },
    );
    if (!result.ok) return unavailableConfiguration("cli");
    const profile = JSON.parse(result.stdout);
    if (
      !profile ||
      profile.schema !== "chainlesschain.model-capability-profile/v1"
    )
      return unavailableConfiguration("cli");
    return configurationState(profile.provider, "cli", {
      requireProvider: true,
    });
  } catch {
    return unavailableConfiguration("cli");
  }
}

/**
 * Read one `llm.<field>` for detection: the config FILE is the source of truth
 * (robust to a transiently-broken `cc` post-update); only when the file is
 * unreadable do we fall back to `cc config get`.
 */
async function readLlmField(field, { command, deps } = {}) {
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
async function setVisionModel({ command, visionModel, deps } = {}) {
  const v = (visionModel == null ? "" : String(visionModel)).trim();
  if (v && hasUnsafeShellChars(v)) {
    return {
      ok: false,
      error:
        "Value contains unsafe characters — remove spaces/quotes/& and retry",
    };
  }
  const r = await runCli(
    command,
    ["config", "set", "llm.visionModel", v],
    deps,
  );
  return r.ok
    ? { ok: true }
    : { ok: false, error: r.error || r.stderr.slice(0, 200) };
}

/** Apply the wizard's answers sequentially, with secrets sent only on stdin. */
async function applyLlmConfig({ command, answers, deps } = {}) {
  for (const [key, value] of Object.entries(answers || {})) {
    // apiKey never reaches the shell/argv, so shell metacharacters in a
    // provider-issued credential are data rather than command syntax.
    if (key !== "apiKey" && value && hasUnsafeShellChars(value)) {
      return {
        ok: false,
        error: `Value contains unsafe characters (${key}) — remove spaces/quotes/& and retry`,
      };
    }
  }
  for (const args of buildConfigSetArgs(answers)) {
    const r = await runCli(command, args, deps);
    if (!r.ok) return { ok: false, error: r.error || r.stderr.slice(0, 200) };
  }
  if (answers?.apiKey) {
    const r = await runCli(
      command,
      ["config", "set-secret", "llm.apiKey"],
      deps,
      { stdin: String(answers.apiKey) },
    );
    if (!r.ok) return { ok: false, error: r.error || r.stderr.slice(0, 200) };
  }
  return { ok: true };
}

/** Connectivity check via `cc llm test`. */
async function testLlm({ command, deps } = {}) {
  const r = await runCli(command, ["llm", "test"], deps);
  const output = (r.stdout + r.stderr).trim() || r.error || "";
  // A failed local launcher has not tested the provider at all. In particular,
  // --version may work while lazy-loading `llm` fails on a missing dependency.
  if (
    !r.ok &&
    (["ENOENT", "EACCES", "EPERM"].includes(r.errorCode) ||
      /Cannot find (?:package|module)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|is not recognized as an internal or external command|command not found/i.test(
        output,
      ))
  ) {
    return {
      ok: false,
      failureKind: "cli",
      detail:
        "本地 CLI 未能启动，尚未检测模型连接。请检查 CLI 路径和依赖安装；无需重新填写 API Key。",
    };
  }
  const tail = output.split("\n").slice(-3).join(" ");
  return { ok: r.ok, detail: tail.slice(0, 300) };
}

async function applyLlmConnection({ command, answers, deps } = {}) {
  const result = await runCli(command, ["llm", "configure"], deps, {
    stdin: JSON.stringify(answers),
  });
  if (result.ok) return { ok: true };
  // Do not forward subprocess output that could echo user-provided secrets.
  const raw = `${result.stderr || ""} ${result.error || ""}`;
  if (/unknown command|too many arguments/i.test(raw))
    return {
      ok: false,
      error:
        "当前 CLI 尚不支持原子保存连接配置，请更新 CLI 或选择已更新的本地 CLI。",
    };
  const secret = answers?.apiKey;
  return {
    ok: false,
    error:
      (secret ? raw.split(secret).join("[已隐藏]") : raw).slice(0, 500) ||
      "配置保存失败",
  };
}

module.exports = {
  PROVIDER_PRESETS,
  hasUnsafeShellChars,
  buildConfigSetArgs,
  suggestVisionModel,
  looksLikeLlmConfigError,
  withLlmErrorGuidance,
  readLlmConfigFromFile,
  getLlmConfigurationState,
  getConfiguredProvider,
  getConfiguredVisionModel,
  getConfiguredModel,
  getConfiguredBaseUrl,
  hasConfiguredApiKey,
  setVisionModel,
  applyLlmConfig,
  testLlm,
  applyLlmConnection,
};
