import { EventEmitter } from "node:events";

export const CODEX_APP_SERVER_PROTOCOL = "codex-app-server-experimental-v1";
export const CODEX_APP_SERVER_FEATURE_FLAG = "CC_EXPERIMENTAL_CODEX_APP_SERVER";

function adapterError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "CodexAppServerAdapterError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function parseVersion(value) {
  const match = String(value || "").match(/(\d+)\.(\d+)\.(\d+)/u);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function isCodexAppServerVersionCompatible(version, matrix = []) {
  const parsed = parseVersion(version);
  if (!parsed || !Array.isArray(matrix) || matrix.length === 0) return false;
  return matrix.some((range) => {
    const minimum = parseVersion(range.min);
    const maximum = parseVersion(range.maxExclusive);
    return (
      minimum &&
      maximum &&
      compareVersion(parsed, minimum) >= 0 &&
      compareVersion(parsed, maximum) < 0
    );
  });
}

function projectNotification(notification) {
  const method = notification?.method;
  const params = notification?.params || {};
  if (method === "thread/started") {
    return { method: "thread/updated", params: { thread: params.thread } };
  }
  if (method === "turn/started") {
    return { method: "turn/started", params: { turn: params.turn } };
  }
  if (["item/started", "item/updated", "item/completed"].includes(method)) {
    const item = params.item || {};
    const status = method === "item/completed" ? "completed" : "streaming";
    return {
      method: method === "item/updated" ? "item/delta" : method,
      params: {
        item: {
          id: item.id,
          kind:
            item.type === "agent_message"
              ? "assistant_message"
              : item.type === "reasoning"
                ? "reasoning"
                : item.type === "command_execution" ||
                    item.type === "file_change"
                  ? "tool"
                  : "artifact",
          status,
          content: item.text ?? item.content ?? item,
        },
      },
      output:
        method === "item/completed" && item.type === "agent_message"
          ? String(item.text || "")
          : "",
    };
  }
  if (method === "turn/completed" || method === "turn/failed") {
    const failed = method === "turn/failed";
    return {
      method: "turn/completed",
      params: {
        turn: {
          ...params.turn,
          status: failed ? "failed" : "completed",
        },
      },
      terminal: failed ? "failed" : "completed",
      error: failed ? params.error || "Codex App Server turn failed" : null,
      usage: params.usage || null,
    };
  }
  return { unknownMethod: String(method || "<missing>") };
}

/**
 * Feature-gated bridge for the experimental upstream Codex App Server.
 * It is deliberately non-authoritative and falls back to the stable
 * `codex exec --json` adapter before admission. Once a persistent turn is
 * admitted it never starts a duplicate fallback execution.
 */
export class CodexAppServerAdapter extends EventEmitter {
  constructor({
    client,
    fallback,
    upstreamVersion,
    compatibilityMatrix = [],
    enabled = process.env[CODEX_APP_SERVER_FEATURE_FLAG] === "1",
    timeoutMs = 120_000,
  } = {}) {
    super();
    this.client = client;
    this.fallback = fallback;
    this.upstreamVersion = upstreamVersion;
    this.compatibilityMatrix = compatibilityMatrix;
    this.enabled = enabled === true;
    this.timeoutMs = timeoutMs;
  }

  runtimeClaims() {
    return Object.freeze({
      protocol: CODEX_APP_SERVER_PROTOCOL,
      execution: "real",
      persistence: "provider_managed",
      stability: "experimental",
      authoritative: false,
      productionCritical: false,
      featureFlag: CODEX_APP_SERVER_FEATURE_FLAG,
      enabled: this.enabled,
      versionCompatible: isCodexAppServerVersionCompatible(
        this.upstreamVersion,
        this.compatibilityMatrix,
      ),
      fallback: "codex-exec-jsonl-v1",
    });
  }

  async execute({ prompt, threadId = null, ...options } = {}) {
    const claims = this.runtimeClaims();
    if (!claims.enabled)
      return this._fallback(prompt, options, "feature_disabled");
    if (!claims.versionCompatible) {
      return this._fallback(prompt, options, "version_incompatible");
    }
    if (!this.client || typeof this.client.request !== "function") {
      return this._fallback(prompt, options, "app_server_unavailable");
    }
    const notifications = [];
    const unknownMethods = new Set();
    let output = "";
    let terminalResolve;
    let terminalReject;
    const terminal = new Promise((resolve, reject) => {
      terminalResolve = resolve;
      terminalReject = reject;
    });
    const timer = setTimeout(
      () =>
        terminalReject(
          adapterError(
            "CC_CODEX_APP_SERVER_TIMEOUT",
            "Codex App Server turn timed out after admission",
          ),
        ),
      this.timeoutMs,
    );
    timer.unref?.();
    const onNotification = (notification) => {
      const projected = projectNotification(notification);
      if (projected.unknownMethod) unknownMethods.add(projected.unknownMethod);
      else {
        notifications.push(projected);
        this.emit("notification", projected);
      }
      if (projected.output) output = projected.output;
      if (projected.terminal) terminalResolve(projected);
    };
    this.client.on?.("notification", onNotification);
    let admitted = false;
    try {
      if (!this.client.running && typeof this.client.start === "function") {
        await this.client.start();
      }
      let activeThreadId = threadId;
      if (!activeThreadId) {
        const started = await this.client.request("thread/start", {
          ephemeral: false,
          provider: "codex",
        });
        activeThreadId = started?.thread?.id;
      }
      if (!activeThreadId) {
        throw adapterError(
          "CC_CODEX_APP_SERVER_PROTOCOL_FAILED",
          "Codex App Server did not return a thread identity",
        );
      }
      const started = await this.client.request("turn/start", {
        threadId: activeThreadId,
        input: [{ type: "text", text: String(prompt || "") }],
      });
      admitted = true;
      const terminalEvent =
        started?.turn?.status === "completed"
          ? { terminal: "completed", usage: started.turn.usage || null }
          : await terminal;
      return Object.freeze({
        protocol: CODEX_APP_SERVER_PROTOCOL,
        threadId: activeThreadId,
        terminal: terminalEvent.terminal,
        output,
        error: terminalEvent.error || null,
        usage: terminalEvent.usage || null,
        notifications: Object.freeze(notifications),
        unknownMethods: Object.freeze([...unknownMethods].sort()),
        fallback: false,
        authoritative: false,
      });
    } catch (error) {
      if (!admitted) {
        return this._fallback(prompt, options, error?.code || "startup_failed");
      }
      throw adapterError(
        "CC_CODEX_APP_SERVER_FAILED_AFTER_ADMISSION",
        "Codex App Server failed after the turn was admitted; fallback was suppressed to prevent duplicate effects",
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
      this.client.off?.("notification", onNotification);
    }
  }

  async _fallback(prompt, options, reason) {
    if (typeof this.fallback !== "function") {
      throw adapterError(
        "CC_CODEX_APP_SERVER_FALLBACK_UNAVAILABLE",
        `Codex App Server is unavailable and no exec fallback was provided (${reason})`,
      );
    }
    const result = await this.fallback({ prompt, ...options });
    return Object.freeze({
      ...result,
      protocol: "codex-exec-jsonl-v1",
      fallback: true,
      fallbackReason: reason,
      authoritative: false,
    });
  }
}
