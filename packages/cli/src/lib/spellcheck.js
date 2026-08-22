/**
 * Local spellcheck adapter for REPL text.
 *
 * No dictionary is bundled and no text leaves the machine: a caller may opt
 * into an installed aspell, hunspell, or ispell executable. Fenced code is
 * removed before invocation so identifiers and examples do not become noisy
 * spelling diagnostics.
 */

import { executionBroker } from "./process-execution-broker/index.js";

export const SPELLCHECK_ADAPTERS = Object.freeze([
  Object.freeze({ command: "aspell", args: Object.freeze(["list"]) }),
  Object.freeze({ command: "hunspell", args: Object.freeze(["list"]) }),
  Object.freeze({ command: "ispell", args: Object.freeze(["-l"]) }),
]);

export const MAX_SPELLCHECK_INPUT_BYTES = 1024 * 1024;
export const MAX_SPELLCHECK_WORDS = 200;

const defaultDeps = Object.freeze({
  spawnSync(command, args, options) {
    return executionBroker.spawnSync(command, args, {
      origin: "spellcheck:local-adapter",
      scope: "spellcheck",
      policy: "allow",
      ...options,
    });
  },
});

/** Parse the REPL's local-only `/spellcheck` command. */
export function parseSpellcheckCommand(line) {
  const input = String(line || "").trim();
  if (input !== "/spellcheck" && !input.startsWith("/spellcheck ")) {
    return null;
  }
  const argument = input.slice("/spellcheck".length).trim();
  if (!argument || argument === "status")
    return Object.freeze({ action: "status" });
  if (argument === "on" || argument === "off") {
    return Object.freeze({ action: argument });
  }
  return Object.freeze({ action: "check", text: argument });
}

function bool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function safeCommand(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
  ) {
    throw new TypeError("spellcheck command is invalid");
  }
  return value;
}

function spawnOptions(input) {
  return {
    input,
    encoding: "utf8",
    timeout: 2500,
    maxBuffer: 512 * 1024,
    shell: false,
    windowsHide: true,
  };
}

/** Resolve the opt-out policy without treating project text as authority. */
export function resolveSpellcheckEnabled(options = {}) {
  const explicit = bool(options.enabled);
  if (explicit !== null) return explicit;
  const env = options.env || process.env;
  const environment = bool(env.CC_SPELLCHECK ?? env.CLAUDE_CODE_SPELLCHECK);
  if (environment !== null) return environment;
  const configured = bool(
    options.config?.cli?.spellcheck ?? options.config?.spellcheck,
  );
  return configured ?? true;
}

/** Strip fenced Markdown code while retaining the surrounding prose. */
export function suppressFencedCodeBlocks(value) {
  const output = [];
  let fence = null;
  for (const line of String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1] || null;
    if (fence === null && marker) {
      fence = { character: marker[0], length: marker.length };
      continue;
    }
    if (
      fence !== null &&
      marker &&
      marker[0] === fence.character &&
      marker.length >= fence.length
    ) {
      fence = null;
      continue;
    }
    if (fence === null) output.push(line);
  }
  return output.join("\n");
}

function findAdapter(command, deps) {
  const requested = command == null ? null : safeCommand(command);
  const candidates = requested
    ? SPELLCHECK_ADAPTERS.filter((adapter) => adapter.command === requested)
    : SPELLCHECK_ADAPTERS;
  if (requested && candidates.length === 0) {
    return null;
  }
  for (const adapter of candidates) {
    const probe = deps.spawnSync(
      adapter.command,
      ["--version"],
      spawnOptions(""),
    );
    if (!probe?.error && probe?.status === 0) return adapter;
  }
  return null;
}

function projectWords(output) {
  const words = [];
  const seen = new Set();
  for (const raw of String(output || "").split(/\r?\n/u)) {
    const word = raw.trim();
    if (!word || word.length > 128 || !/^[\p{L}][\p{L}'-]*$/u.test(word))
      continue;
    const key = word.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(word);
    if (words.length >= MAX_SPELLCHECK_WORDS) break;
  }
  return Object.freeze(words);
}

/**
 * Check prose with a local executable. Error objects and tool stderr are never
 * returned because they can expose local paths, dictionary options, or input.
 */
export function spellcheckText(value, options = {}) {
  const enabled = resolveSpellcheckEnabled(options);
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      available: false,
      adapter: null,
      words: Object.freeze([]),
      reason: "disabled",
    });
  }
  const prose = suppressFencedCodeBlocks(value);
  if (Buffer.byteLength(prose, "utf8") > MAX_SPELLCHECK_INPUT_BYTES) {
    throw new RangeError("spellcheck input exceeds the maximum size");
  }
  if (!prose.trim()) {
    return Object.freeze({
      enabled: true,
      available: true,
      adapter: null,
      words: Object.freeze([]),
      reason: "empty",
    });
  }
  const deps = { ...defaultDeps, ...(options.deps || {}) };
  const adapter = findAdapter(options.command, deps);
  if (!adapter) {
    return Object.freeze({
      enabled: true,
      available: false,
      adapter: null,
      words: Object.freeze([]),
      reason: "unavailable",
    });
  }
  const result = deps.spawnSync(
    adapter.command,
    adapter.args,
    spawnOptions(prose),
  );
  if (result?.error || result?.status !== 0) {
    return Object.freeze({
      enabled: true,
      available: false,
      adapter: adapter.command,
      words: Object.freeze([]),
      reason: "failed",
    });
  }
  return Object.freeze({
    enabled: true,
    available: true,
    adapter: adapter.command,
    words: projectWords(result.stdout),
    reason: null,
  });
}
