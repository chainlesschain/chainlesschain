import { EventEmitter } from "node:events";

export const CODEX_APP_SERVER_PROTOCOL = "codex-app-server-experimental-v1";
export const CODEX_APP_SERVER_FEATURE_FLAG = "CC_EXPERIMENTAL_CODEX_APP_SERVER";
export const CODEX_APP_SERVER_COMPATIBILITY_MATRIX = Object.freeze([
  Object.freeze({ version: "0.149.0" }),
  Object.freeze({ version: "0.150.0" }),
  Object.freeze({ version: "0.150.1" }),
  Object.freeze({ version: "0.154.0" }),
]);

function adapterError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "CodexAppServerAdapterError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function parseVersion(value) {
  const match = String(value || "")
    .trim()
    .match(/^(?:codex(?:-cli)?\s+)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
  return match ? match.slice(1).map(Number).join(".") : null;
}

export function isCodexAppServerVersionCompatible(version, matrix = []) {
  const parsed = parseVersion(version);
  if (!parsed || !Array.isArray(matrix) || matrix.length === 0) return false;
  return matrix.some((entry) => parseVersion(entry?.version) === parsed);
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
  const deltaKinds = {
    "item/agentMessage/delta": "assistant_message",
    "item/commandExecution/outputDelta": "tool",
    "item/fileChange/outputDelta": "tool",
    "item/reasoning/textDelta": "reasoning",
    "item/reasoning/summaryTextDelta": "reasoning",
  };
  if (Object.hasOwn(deltaKinds, method)) {
    return {
      method: "item/delta",
      params: {
        item: {
          id: params.itemId,
          kind: deltaKinds[method],
          status: "streaming",
          delta: params.delta || "",
        },
      },
      ...(method === "item/agentMessage/delta"
        ? {
            outputDelta: String(params.delta || ""),
            outputItemId: params.itemId,
          }
        : {}),
    };
  }
  if (method === "thread/tokenUsage/updated") {
    return {
      method: "thread/usage",
      params: { tokenUsage: params.tokenUsage },
      usage: params.tokenUsage?.last || null,
    };
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
            item.type === "agentMessage"
              ? "assistant_message"
              : item.type === "reasoning"
                ? "reasoning"
                : item.type === "commandExecution" || item.type === "fileChange"
                  ? "tool"
                  : "artifact",
          status,
          content: item.text ?? item.content ?? item,
        },
      },
      output:
        method === "item/completed" && item.type === "agentMessage"
          ? String(item.text || "")
          : undefined,
      outputItemId: item.id,
    };
  }
  if (method === "turn/completed" || method === "turn/failed") {
    const turn = params.turn || {};
    const reportedStatus =
      method === "turn/failed" ? "failed" : String(turn.status || "");
    const terminalStatus = ["completed", "failed", "interrupted"].includes(
      reportedStatus,
    )
      ? reportedStatus
      : "failed";
    const protocolError =
      terminalStatus === "failed" && reportedStatus !== "failed"
        ? {
            code: "CC_CODEX_APP_SERVER_INVALID_TERMINAL_STATUS",
            message:
              "Codex App Server emitted turn/completed without a supported terminal status",
          }
        : null;
    const terminalError =
      terminalStatus === "failed"
        ? turn.error ||
          params.error ||
          protocolError ||
          "Codex App Server turn failed"
        : turn.error || params.error || null;
    return {
      method: "turn/completed",
      params: {
        turn: {
          ...turn,
          status: terminalStatus,
        },
      },
      terminal: terminalStatus,
      error: terminalError,
      usage: params.usage || turn.usage || null,
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
    compatibilityMatrix = CODEX_APP_SERVER_COMPATIBILITY_MATRIX,
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
    const outputItems = new Map();
    let usage = null;
    let activeThreadId = threadId;
    let activeTurnId = null;
    let submissionStarted = false;
    let admissionObserved = false;
    let observedTerminal = null;
    let terminalResolve;
    const terminal = new Promise((resolve) => {
      terminalResolve = resolve;
    });
    let deadlineReject;
    const deadline = new Promise((_, reject) => {
      deadlineReject = reject;
    });
    // Attach immediately: startup/RPC may hang or reject before terminal await.
    deadline.catch(() => {});
    const timer = setTimeout(
      () =>
        deadlineReject(
          adapterError(
            "CC_CODEX_APP_SERVER_TIMEOUT",
            "Codex App Server request timed out",
          ),
        ),
      this.timeoutMs,
    );
    timer.unref?.();
    const withinDeadline = (pending) => Promise.race([pending, deadline]);
    let buffered = [];
    let retainedBytes = 0;
    let eventFailure = null;
    const retain = (notification) => {
      retainedBytes += Buffer.byteLength(JSON.stringify(notification));
      if (
        retainedBytes > 4 * 1024 * 1024 ||
        notifications.length + buffered.length >= 4096
      ) {
        eventFailure = adapterError(
          "CC_CODEX_APP_SERVER_EVENT_LIMIT",
          "Codex App Server event retention limit exceeded",
        );
        deadlineReject(eventFailure);
        return false;
      }
      return true;
    };
    const onNotification = (notification) => {
      if (observedTerminal || eventFailure || !submissionStarted) return;
      const params = notification?.params || {};
      const eventThread =
        params.threadId ||
        (notification.method === "thread/started" ? params.thread?.id : null);
      if (!eventThread || eventThread !== activeThreadId) return;
      if (!activeTurnId) {
        if (retain(notification)) buffered.push(notification);
        return;
      }
      const eventTurn = params.turnId || params.turn?.id;
      // Thread-wide events carry no turn. Only thread/started is safe to
      // project here; usage and terminal events require the exact turn ID.
      if (
        notification.method !== "thread/started" &&
        eventTurn !== activeTurnId
      )
        return;
      if (!retain(notification)) return;
      const projected = projectNotification(notification);
      if (projected.unknownMethod) {
        if (unknownMethods.size < 64)
          unknownMethods.add(projected.unknownMethod);
      } else {
        projected.params = {
          ...projected.params,
          threadId: activeThreadId,
          turnId: activeTurnId,
        };
        notifications.push(projected);
        this.emit("notification", projected);
      }
      if (projected.outputItemId) {
        if (projected.output !== undefined)
          outputItems.set(projected.outputItemId, projected.output);
        else if (projected.outputDelta)
          outputItems.set(
            projected.outputItemId,
            (outputItems.get(projected.outputItemId) || "") +
              projected.outputDelta,
          );
      }
      if (projected.usage) usage = projected.usage;
      if (projected.terminal) {
        observedTerminal = projected;
        terminalResolve(projected);
      }
    };
    this.client.on?.("notification", onNotification);
    const buildResult = (terminalEvent) =>
      Object.freeze({
        protocol: CODEX_APP_SERVER_PROTOCOL,
        threadId: activeThreadId,
        turnId: activeTurnId,
        terminal: terminalEvent.terminal,
        output: [...outputItems.values()].join("\n"),
        error: terminalEvent.error || null,
        usage: terminalEvent.usage || usage,
        notifications: Object.freeze(notifications),
        unknownMethods: Object.freeze([...unknownMethods].sort()),
        fallback: false,
        authoritative: false,
      });
    try {
      if (!this.client.running && typeof this.client.start === "function") {
        await withinDeadline(this.client.start());
      }
      if (!activeThreadId) {
        const started = await withinDeadline(
          this.client.request("thread/start", {
            ephemeral: false,
          }),
        );
        activeThreadId = started?.thread?.id;
      }
      if (!activeThreadId) {
        throw adapterError(
          "CC_CODEX_APP_SERVER_PROTOCOL_FAILED",
          "Codex App Server did not return a thread identity",
        );
      }
      // Once turn/start begins, a rejected client promise cannot prove that
      // the server did not accept the input. Never launch a second execution
      // path from that ambiguous state.
      submissionStarted = true;
      const started = await withinDeadline(
        this.client.request("turn/start", {
          threadId: activeThreadId,
          input: [{ type: "text", text: String(prompt || "") }],
        }),
      );
      activeTurnId = started?.turn?.id;
      if (typeof activeTurnId !== "string" || !activeTurnId) {
        throw adapterError(
          "CC_CODEX_APP_SERVER_PROTOCOL_FAILED",
          "Codex App Server did not return a turn identity",
        );
      }
      admissionObserved = true;
      if (eventFailure) throw eventFailure;
      const early = buffered;
      buffered = [];
      retainedBytes = 0;
      for (const notification of early) onNotification(notification);
      if (eventFailure) throw eventFailure;
      // Some servers finish before writing the RPC response, including items
      // in the response without separate item notifications.
      if (!observedTerminal)
        for (const item of started.turn.items || []) {
          onNotification({
            method: "item/completed",
            params: { threadId: activeThreadId, turnId: activeTurnId, item },
          });
        }
      if (eventFailure) throw eventFailure;
      const initialStatus = String(started?.turn?.status || "");
      const terminalEvent = ["completed", "failed", "interrupted"].includes(
        initialStatus,
      )
        ? projectNotification({
            method: "turn/completed",
            params: {
              threadId: activeThreadId,
              turn: started.turn,
              usage: started.turn.usage || null,
            },
          })
        : await withinDeadline(terminal);
      return buildResult(terminalEvent);
    } catch (error) {
      if (!submissionStarted) {
        return this._fallback(prompt, options, error?.code || "startup_failed");
      }
      if (observedTerminal) return buildResult(observedTerminal);
      if (!admissionObserved) {
        throw adapterError(
          "CC_CODEX_APP_SERVER_SUBMISSION_UNKNOWN",
          "Codex App Server turn submission outcome is unknown; fallback was suppressed to prevent duplicate effects",
          { cause: error },
        );
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
