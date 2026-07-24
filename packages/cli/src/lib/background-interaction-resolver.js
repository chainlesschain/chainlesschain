/**
 * Background turn interaction protocol.
 *
 * A background worker starts the headless turn with a Node IPC channel. The
 * turn child uses `createBackgroundInteractionClient()` to suspend the active
 * tool call until the worker resolves it. The worker uses
 * `attachInteractionRequestHandler()` to validate the request binding, route
 * it to attach/Desktop/IDE, and return the answer to the same child process.
 *
 * Every response is bound to the original background session, agent, turn,
 * tool call, and monotonically increasing sequence. A stale or cross-session
 * response is ignored by the child and can never resolve another request.
 */

import { randomUUID } from "node:crypto";

export const BACKGROUND_INTERACTION_PROTOCOL_VERSION = 1;
export const DEFAULT_BACKGROUND_INTERACTION_TIMEOUT_MS = 60_000;

const MAX_COMPLETED_RESPONSES = 256;

function protocolError(message, code = "INTERACTION_PROTOCOL_ERROR") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function asNullableString(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function normalizeBinding(binding = {}) {
  return {
    backgroundAgentId: asNullableString(binding.backgroundAgentId),
    sessionId: asNullableString(binding.sessionId),
    turnId: asNullableString(binding.turnId),
    toolUseId: asNullableString(binding.toolUseId),
    sequence:
      Number.isSafeInteger(binding.sequence) && binding.sequence > 0
        ? binding.sequence
        : null,
  };
}

function sameBinding(left, right) {
  const a = normalizeBinding(left);
  const b = normalizeBinding(right);
  return (
    a.backgroundAgentId === b.backgroundAgentId &&
    a.sessionId === b.sessionId &&
    a.turnId === b.turnId &&
    a.toolUseId === b.toolUseId &&
    a.sequence === b.sequence
  );
}

function validRequest(message) {
  return (
    message &&
    message.type === "interaction-request" &&
    message.protocolVersion === BACKGROUND_INTERACTION_PROTOCOL_VERSION &&
    typeof message.requestId === "string" &&
    message.requestId.length > 0 &&
    message.requestId.length <= 256 &&
    message.payload &&
    typeof message.payload === "object" &&
    normalizeBinding(message.binding).sequence !== null
  );
}

function sendIpc(target, message, onError = () => {}) {
  if (!target || typeof target.send !== "function" || target.connected === false)
    return false;
  try {
    target.send(message, (error) => {
      if (error) onError(error);
    });
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}

/**
 * Create the turn-child side of the interaction channel.
 *
 * @param {object} [options]
 * @param {NodeJS.Process|object} [options.processLike]
 * @param {string} [options.backgroundAgentId]
 * @param {string|null} [options.sessionId]
 * @param {string|null} [options.turnId]
 * @param {number} [options.defaultTimeoutMs]
 * @param {()=>string} [options.idFactory]
 */
export function createBackgroundInteractionClient(options = {}) {
  const processLike = options.processLike || process;
  const backgroundAgentId =
    options.backgroundAgentId ?? processLike?.env?.CC_BACKGROUND_AGENT_ID;
  const sessionId = options.sessionId ?? null;
  const turnId = options.turnId ?? null;
  const defaultTimeoutMs =
    Number.isFinite(options.defaultTimeoutMs) && options.defaultTimeoutMs > 0
      ? options.defaultTimeoutMs
      : DEFAULT_BACKGROUND_INTERACTION_TIMEOUT_MS;
  const idFactory = options.idFactory || randomUUID;
  const enabled =
    typeof backgroundAgentId === "string" &&
    backgroundAgentId.trim() !== "" &&
    typeof processLike?.send === "function";
  const pending = new Map();
  let sequence = 0;
  let closed = false;

  const removeMessageListener = () => {
    if (typeof processLike?.off === "function") {
      processLike.off("message", onMessage);
    } else if (typeof processLike?.removeListener === "function") {
      processLike.removeListener("message", onMessage);
    }
  };

  function settle(entry, action, value) {
    if (!entry || entry.settled) return;
    entry.settled = true;
    clearTimeout(entry.timer);
    pending.delete(entry.requestId);
    action(value);
  }

  function onMessage(message) {
    if (
      !message ||
      message.type !== "interaction-response" ||
      message.protocolVersion !== BACKGROUND_INTERACTION_PROTOCOL_VERSION
    ) {
      return;
    }
    const entry = pending.get(message.requestId);
    if (!entry || !sameBinding(entry.binding, message.binding)) return;

    if (message.status === "resolved") {
      settle(entry, entry.resolve, message.answer);
      return;
    }
    const error = protocolError(
      message.error?.message || "Background interaction was rejected",
      message.error?.code || "INTERACTION_REJECTED",
    );
    settle(entry, entry.reject, error);
  }

  if (enabled && typeof processLike.on === "function") {
    processLike.on("message", onMessage);
  }

  return {
    enabled,
    pendingCount() {
      return pending.size;
    },
    async request(payload = {}) {
      if (!enabled || closed) {
        throw protocolError(
          "Background interaction IPC channel is unavailable",
          "USER_NOT_REACHABLE",
        );
      }

      sequence += 1;
      const requestId = `${backgroundAgentId}:${idFactory()}`;
      const binding = normalizeBinding({
        backgroundAgentId,
        sessionId: payload.sessionId ?? sessionId,
        turnId: payload.turnId ?? turnId,
        toolUseId: payload.toolUseId,
        sequence,
      });
      const timeoutMs =
        Number.isFinite(payload.timeoutMs) && payload.timeoutMs > 0
          ? payload.timeoutMs
          : defaultTimeoutMs;

      return new Promise((resolve, reject) => {
        const entry = {
          requestId,
          binding,
          resolve,
          reject,
          timer: null,
          settled: false,
        };
        entry.timer = setTimeout(() => {
          const error = protocolError(
            "User did not respond before the interaction timed out",
            "USER_TIMEOUT",
          );
          sendIpc(processLike, {
            type: "interaction-cancel",
            protocolVersion: BACKGROUND_INTERACTION_PROTOCOL_VERSION,
            requestId,
            binding,
            reason: "timeout",
          });
          settle(entry, reject, error);
        }, timeoutMs);
        entry.timer.unref?.();
        pending.set(requestId, entry);

        const sent = sendIpc(
          processLike,
          {
            type: "interaction-request",
            protocolVersion: BACKGROUND_INTERACTION_PROTOCOL_VERSION,
            requestId,
            binding,
            payload: {
              kind: payload.kind || "question",
              question: String(payload.question || payload.prompt || ""),
              options: Array.isArray(payload.options) ? payload.options : null,
              multiSelect: payload.multiSelect === true,
              defaultValue: payload.defaultValue,
              timeoutMs,
              policyDigest: asNullableString(payload.policyDigest),
            },
          },
          (error) => {
            settle(
              entry,
              reject,
              protocolError(
                `Failed to send background interaction: ${error.message}`,
                "INTERACTION_CHANNEL_ERROR",
              ),
            );
          },
        );
        if (!sent) {
          settle(
            entry,
            reject,
            protocolError(
              "Background interaction IPC channel is unavailable",
              "USER_NOT_REACHABLE",
            ),
          );
        }
      });
    },
    close(reason = "Background interaction channel closed") {
      if (closed) return;
      closed = true;
      removeMessageListener();
      for (const entry of [...pending.values()]) {
        settle(
          entry,
          entry.reject,
          protocolError(reason, "INTERACTION_CHANNEL_CLOSED"),
        );
      }
    },
  };
}

/**
 * Attach the worker side of the interaction channel to one turn child.
 *
 * @param {import("node:child_process").ChildProcess|object} child
 * @param {(payload:object, request:object, context:{signal:AbortSignal})=>Promise<any>|any} resolveRequest
 * @param {object} [options]
 * @param {string|null} [options.backgroundAgentId]
 * @param {string|null} [options.sessionId]
 * @returns {()=>void} detach function
 */
export function attachInteractionRequestHandler(
  child,
  resolveRequest,
  options = {},
) {
  if (!child || typeof child.on !== "function") return () => {};

  const inflight = new Map();
  const completed = new Map();
  let detached = false;

  const rememberCompleted = (requestId, response) => {
    completed.set(requestId, response);
    if (completed.size > MAX_COMPLETED_RESPONSES) {
      completed.delete(completed.keys().next().value);
    }
  };

  const sendResponse = (response) => {
    if (!detached) sendIpc(child, response);
  };

  const rejectRequest = (message, code, detail) => {
    const response = {
      type: "interaction-response",
      protocolVersion: BACKGROUND_INTERACTION_PROTOCOL_VERSION,
      requestId:
        typeof message?.requestId === "string" ? message.requestId : "",
      binding: normalizeBinding(message?.binding),
      status: "rejected",
      error: { code, message: detail },
    };
    if (response.requestId) rememberCompleted(response.requestId, response);
    sendResponse(response);
  };

  const onMessage = (message) => {
    if (
      message?.type === "interaction-cancel" &&
      message.protocolVersion === BACKGROUND_INTERACTION_PROTOCOL_VERSION
    ) {
      const active = inflight.get(message.requestId);
      if (active && sameBinding(active.binding, message.binding)) {
        inflight.delete(message.requestId);
        active.controller.abort(message.reason || "cancelled");
      }
      return;
    }
    if (message?.type !== "interaction-request") return;
    if (!validRequest(message)) {
      rejectRequest(
        message,
        "INVALID_INTERACTION_REQUEST",
        "Malformed background interaction request",
      );
      return;
    }

    const binding = normalizeBinding(message.binding);
    const expectedAgentId = asNullableString(options.backgroundAgentId);
    const expectedSessionId = asNullableString(options.sessionId);
    if (
      (expectedAgentId &&
        binding.backgroundAgentId !== expectedAgentId) ||
      (expectedSessionId && binding.sessionId !== expectedSessionId)
    ) {
      rejectRequest(
        message,
        "INTERACTION_BINDING_MISMATCH",
        "Background interaction does not belong to this worker/session",
      );
      return;
    }

    const prior = completed.get(message.requestId);
    if (prior) {
      sendResponse(prior);
      return;
    }
    if (inflight.has(message.requestId)) return;

    const controller = new AbortController();
    inflight.set(message.requestId, { binding, controller });
    Promise.resolve()
      .then(() =>
        resolveRequest(message.payload, message, {
          signal: controller.signal,
        }),
      )
      .then(
        (answer) => {
          const active = inflight.get(message.requestId);
          if (!active || controller.signal.aborted) return;
          inflight.delete(message.requestId);
          const response = {
            type: "interaction-response",
            protocolVersion: BACKGROUND_INTERACTION_PROTOCOL_VERSION,
            requestId: message.requestId,
            binding,
            status: "resolved",
            answer,
          };
          rememberCompleted(message.requestId, response);
          sendResponse(response);
        },
        (error) => {
          const active = inflight.get(message.requestId);
          if (!active || controller.signal.aborted) return;
          inflight.delete(message.requestId);
          const response = {
            type: "interaction-response",
            protocolVersion: BACKGROUND_INTERACTION_PROTOCOL_VERSION,
            requestId: message.requestId,
            binding,
            status: "rejected",
            error: {
              code: error?.code || "INTERACTION_REJECTED",
              message: error?.message || String(error),
            },
          };
          rememberCompleted(message.requestId, response);
          sendResponse(response);
        },
      );
  };

  child.on("message", onMessage);
  const detach = () => {
    if (detached) return;
    detached = true;
    if (typeof child.off === "function") child.off("message", onMessage);
    else child.removeListener?.("message", onMessage);
    for (const active of inflight.values()) {
      active.controller.abort("child detached");
    }
    inflight.clear();
  };
  child.once?.("exit", detach);
  child.once?.("disconnect", detach);
  return detach;
}
