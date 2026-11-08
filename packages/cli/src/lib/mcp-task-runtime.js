import { deliverMcpTaskResult } from "./mcp-task-delivery.js";
import { randomBytes, randomUUID } from "node:crypto";
import { createSecretStore } from "./secret-store.js";
import { createSessionMcpLedgerSink } from "./mcp-call-ledger-store.js";
import {
  McpEffect,
  snapshotMcpJsonRpcInput,
  summarizeMcpPayload,
} from "./mcp-call-ledger.js";
import { createRecoveryGuardedMcpCallLedger } from "./mcp-ledger-recovery-admission.js";
import {
  appendMcpTaskJournalEvent,
  readMcpTaskJournal,
} from "./mcp-task-journal.js";

function failure(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function waitForTaskPoll(ms, signal, leaseSignal) {
  const delay = Math.max(0, Math.min(60_000, Number(ms) || 0));
  if (delay === 0) return Promise.resolve();
  const combined = signal
    ? AbortSignal.any([leaseSignal, signal])
    : leaseSignal;
  if (combined.aborted) return Promise.reject(combined.reason);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      combined.removeEventListener("abort", abort);
      reject(
        combined.reason ||
          new DOMException("The operation was aborted", "AbortError"),
      );
    };
    // The timer is the only successful completion path; remove the listener
    // before resolving so repeated polling does not retain old closures.
    const timer = setTimeout(() => {
      combined.removeEventListener("abort", abort);
      resolve();
    }, delay);
    combined.addEventListener("abort", abort, { once: true });
  });
}

function publicRecord(record, projection) {
  const call = projection.callRecovery.records.find(
    (item) => item.ledgerId === record.ledgerId,
  );
  const expiresMs =
    record.task?.ttl == null
      ? null
      : Date.parse(record.task.createdAt) + record.task.ttl;
  return Object.freeze({
    localId: record.localId,
    sessionId: record.sessionId,
    serverName: record.serverName,
    toolName: record.toolName,
    phase: record.phase,
    revision: record.revision,
    taskId: record.task?.taskId ?? null,
    remoteStatus: record.task?.status ?? null,
    cancelRequested: record.cancelRequested,
    cancelUnknown: record.cancelUnknown,
    resultSaved: record.result !== null,
    delivered: projection.deliveries.some(
      (item) => item.localId === record.localId,
    ),
    callStatus: call?.status ?? null,
    outcomeUnknown: record.task === null && call?.status === "started",
    expiresAt:
      expiresMs === null ||
      !Number.isFinite(expiresMs) ||
      Math.abs(expiresMs) > 8640000000000000
        ? null
        : new Date(expiresMs).toISOString(),
  });
}

/**
 * Session-owned durable auxiliary task service. It never injects a standalone
 * tool message into model history. Model-originated tasks need their complete
 * tool-round/consumption contract before they can use this service.
 */
export function createDurableMcpTaskRuntime({
  client,
  sessionId,
  lease,
  secretStore = null,
  now = () => new Date().toISOString(),
} = {}) {
  if (
    (client != null && typeof client.callToolTask !== "function") ||
    !lease ||
    lease.sessionId !== sessionId ||
    typeof lease.admitMcpDispatch !== "function" ||
    typeof lease.assert !== "function"
  ) {
    throw new TypeError(
      "Durable MCP Tasks require a session-owned client and lease",
    );
  }
  let secrets = secretStore;
  const vault = () =>
    (secrets ||= createSecretStore({
      service: "com.chainlesschain.mcp-tasks",
    }));
  const requireRemote = () => {
    if (!client || typeof client.getTaskRecoveryIdentity !== "function") {
      throw failure(
        "CC_MCP_TASK_CONNECTION_REQUIRED",
        "A connected MCP task server is required",
      );
    }
  };
  let serial = Promise.resolve();
  const enqueue = (run) => {
    const next = serial.then(run);
    serial = next.catch(() => {});
    return next;
  };
  const read = () => {
    lease.assert();
    const projection = readMcpTaskJournal(sessionId);
    if (projection.callRecovery.incidents.length > 0) {
      throw failure(
        "CC_MCP_TASK_CALL_LEDGER_INVALID",
        "MCP call recovery requires inspection",
      );
    }
    return projection;
  };
  const find = (localId, projection = read()) => {
    const record = projection.records.find((item) => item.localId === localId);
    if (!record)
      throw failure(
        "CC_MCP_TASK_NOT_FOUND",
        "No task exists in this verified session",
      );
    return record;
  };
  const append = (record, phase, extra = {}) => {
    lease.assert();
    return appendMcpTaskJournalEvent(sessionId, {
      schemaVersion: 1,
      sessionId,
      localId: record.localId,
      revision: record.revision + 1,
      phase,
      at: now(),
      ...extra,
    });
  };
  const keyFor = (record) => {
    const key = vault().get(record.secretRef);
    if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) {
      throw failure(
        "CC_MCP_TASK_RECOVERY_KEY_UNAVAILABLE",
        "MCP task recovery secret is unavailable",
      );
    }
    return key;
  };
  const assertIdentity = (record, key) => {
    requireRemote();
    lease.assert();
    if (
      client.getTaskRecoveryIdentity(record.serverName, key) !==
      record.identityDigest
    ) {
      throw failure(
        "CC_MCP_TASK_RECOVERY_IDENTITY_CHANGED",
        "MCP task server authorization identity changed",
      );
    }
  };
  const requestOptions = (record, key, signal) => ({
    signal: signal ? AbortSignal.any([lease.signal, signal]) : lease.signal,
    dispatchAdmission(metadata, send) {
      assertIdentity(record, key);
      return lease.admitMcpDispatch(metadata, send);
    },
  });
  const restore = (record) => {
    if (!record.task) {
      throw failure(
        "CC_MCP_TASK_ACCEPTANCE_UNKNOWN",
        "Task acceptance is unknown; inspect recovery before attempting another call",
        { localId: record.localId, outcomeUnknown: true },
      );
    }
    const key = keyFor(record);
    assertIdentity(record, key);
    client.restoreTaskBinding(record.serverName, record.task, {
      key,
      identityDigest: record.identityDigest,
    });
    return key;
  };
  const checkCall = (record, projection) => {
    if (
      projection.callRecovery.adjudications.some(
        (item) => item.ledgerId === record.ledgerId,
      )
    ) {
      throw failure(
        "CC_MCP_TASK_CALL_ADJUDICATED",
        "The task's underlying call was explicitly adjudicated",
      );
    }
    const call = projection.callRecovery.records.find(
      (item) => item.ledgerId === record.ledgerId,
    );
    if (
      !call ||
      call.serverName !== record.serverName ||
      call.toolName !== record.toolName ||
      call.inputDigest !== record.inputDigest ||
      call.sessionId !== sessionId
    ) {
      throw failure(
        "CC_MCP_TASK_CALL_BINDING_INVALID",
        "The task's underlying call binding is unavailable",
      );
    }
    return call;
  };
  const repairSettlement = async (record) => {
    const projection = read();
    const call = checkCall(record, projection);
    const summary = summarizeMcpPayload(record.result);
    const status = record.result.isError === true ? "failed" : "completed";
    if (call.status !== "started") {
      if (call.status !== status || call.outputDigest !== summary.sha256) {
        throw failure(
          "CC_MCP_TASK_SETTLEMENT_CONFLICT",
          "MCP task result conflicts with call settlement",
        );
      }
      return;
    }
    const sink = createSessionMcpLedgerSink(sessionId, {
      recovery: projection.callRecovery,
    });
    await sink(
      {
        ...call,
        status,
        prewritePersistence: "persisted",
        settledAt: now(),
        outputSummary: summary,
        outputDigest: summary.sha256,
        errorSummary:
          status === "failed"
            ? {
                name: "Error",
                code: "CC_MCP_PROTOCOL_TOOL_ERROR",
                messageDigest: summarizeMcpPayload(
                  "MCP server returned isError=true",
                ).sha256,
              }
            : null,
        settlementPersistence: "pending",
      },
      { phase: "settled" },
    );
    const after = read();
    const settled = checkCall(record, after);
    if (settled.status !== status || settled.outputDigest !== summary.sha256) {
      throw failure(
        "CC_MCP_TASK_SETTLEMENT_UNVERIFIED",
        "MCP task result settlement was not verified",
      );
    }
  };
  const remoteFailure = (error, record) =>
    failure(
      typeof error?.code === "string"
        ? error.code
        : "CC_MCP_TASK_REMOTE_UNAVAILABLE",
      "MCP task request did not yield a verified result; no tool invocation was replayed",
      {
        localId: record.localId,
        dispatched: error?.dispatched !== false,
        outcomeUnknown: error?.dispatched !== false,
      },
    );

  return Object.freeze({
    list() {
      const projection = read();
      return Object.freeze({
        sessionId,
        records: Object.freeze(
          projection.records.map((record) => publicRecord(record, projection)),
        ),
      });
    },

    create(serverName, toolName, args = {}, options = {}) {
      // Capture the caller's exact JSON input before joining the async queue.
      const input = snapshotMcpJsonRpcInput(args);
      return enqueue(async () => {
        const projection = read();
        if (projection.records.length >= 1024) {
          throw failure(
            "CC_MCP_TASK_BINDING_LIMIT",
            "MCP task journal limit reached",
          );
        }
        requireRemote();
        const localId = randomUUID();
        const secretRef = "mcp-task/" + localId;
        const key = randomBytes(32).toString("hex");
        const identityDigest = client.getTaskRecoveryIdentity(serverName, key);
        // No plaintext fallback. Verify OS-vault readback before any wire effect.
        vault().set(secretRef, key);
        if (vault().get(secretRef) !== key) {
          throw failure(
            "CC_MCP_TASK_SECRET_PERSIST_FAILED",
            "MCP task recovery secret could not be verified",
          );
        }
        const ledger = createRecoveryGuardedMcpCallLedger({
          sink: createSessionMcpLedgerSink(sessionId, {
            recovery: projection.callRecovery,
          }),
          recovery: projection.callRecovery,
        });
        const ticket = await ledger.begin({
          sessionId,
          serverName,
          toolName,
          input,
          effectContract: {
            effect: McpEffect.UNKNOWN,
            trusted: false,
            source: "mcp-durable-task",
          },
        });
        let record;
        try {
          record = appendMcpTaskJournalEvent(sessionId, {
            schemaVersion: 1,
            phase: "prepared",
            revision: 0,
            localId,
            sessionId,
            serverName,
            toolName,
            ledgerId: ticket.ledgerId,
            inputDigest: ticket.record.inputDigest,
            identityDigest,
            secretRef,
            at: now(),
          });
        } catch {
          // The wire has not started. A failed/unknown prepare append must never
          // authorize dispatch; the original started call remains conservative.
          throw failure(
            "CC_MCP_TASK_PREPARE_FAILED",
            "MCP task preparation was not durably confirmed",
            { localId, dispatched: false, outcomeUnknown: false },
          );
        }
        let accepted;
        try {
          accepted = await client.callToolTask(serverName, toolName, input, {
            ttl: options.ttl,
            ...requestOptions(record, key, options.signal),
          });
        } catch (error) {
          if (error?.dispatched === false) {
            await ticket.settle({ status: "failed", error });
          }
          throw remoteFailure(error, record);
        }
        try {
          record = append(record, "accepted", { task: accepted.task });
        } catch {
          throw failure(
            "CC_MCP_TASK_ACCEPTANCE_PERSIST_FAILED",
            "MCP task was accepted but its receipt was not durably confirmed",
            { localId, dispatched: true, outcomeUnknown: true },
          );
        }
        return publicRecord(record, read());
      });
    },

    poll(localId, { signal } = {}) {
      return enqueue(async () => {
        const projection = read();
        let record = find(localId, projection);
        checkCall(record, projection);
        if (record.result !== null) {
          await repairSettlement(record);
          return publicRecord(record, read());
        }
        const key = restore(record);
        let task;
        try {
          task = await client.getTask(
            record.serverName,
            record.task.taskId,
            requestOptions(record, key, signal),
          );
        } catch (error) {
          throw remoteFailure(error, record);
        }
        record = append(record, "observed", { task });
        return publicRecord(record, read());
      });
    },

    /**
     * Opt-in foreground/background tracking for one accepted task. This only
     * polls and durably delivers the verified result; it never starts a model
     * turn or injects data into conversation history.
     */
    async watch(
      localId,
      {
        intervalMs = 1000,
        timeoutMs = 15 * 60 * 1000,
        signal,
        deliver = true,
        onUpdate = null,
      } = {},
    ) {
      const started = Date.now();
      let latest = null;
      for (;;) {
        latest = await this.poll(localId, { signal });
        onUpdate?.(latest);
        if (latest.resultSaved) break;
        if (
          ["completed", "failed", "cancelled"].includes(latest.remoteStatus)
        ) {
          latest = await this.result(localId, { signal });
          onUpdate?.(latest);
          break;
        }
        if (Date.now() - started >= timeoutMs) {
          throw failure(
            "CC_MCP_TASK_WATCH_TIMEOUT",
            "MCP task did not produce a verified result before the watch timeout",
            { localId },
          );
        }
        await waitForTaskPoll(intervalMs, signal, lease.signal);
      }
      if (!deliver) return latest;
      const receipt = await this.deliver(localId);
      return Object.freeze({ ...receipt, watched: true });
    },

    result(localId, { signal } = {}) {
      return enqueue(async () => {
        const projection = read();
        let record = find(localId, projection);
        checkCall(record, projection);
        const cached = record.result !== null;
        if (!cached) {
          const key = restore(record);
          let result;
          try {
            result = await client.getTaskResult(
              record.serverName,
              record.task.taskId,
              requestOptions(record, key, signal),
            );
          } catch (error) {
            throw remoteFailure(error, record);
          }
          record = append(record, "result_saved", { result });
        }
        // If the process died after saving the result but before the original
        // call's terminal event, finish that local settlement without refetching.
        await repairSettlement(record);
        return Object.freeze({
          ...publicRecord(record, read()),
          cached,
          result: record.result,
        });
      });
    },

    deliver(localId) {
      return enqueue(async () => {
        const projection = read();
        const record = find(localId, projection);
        if (record.result === null) {
          throw failure(
            "CC_MCP_TASK_RESULT_NOT_SAVED",
            "Retrieve the task result before delivering it",
          );
        }
        await repairSettlement(record);
        return deliverMcpTaskResult(sessionId, localId);
      });
    },

    cancel(localId, { signal } = {}) {
      return enqueue(async () => {
        const projection = read();
        let record = find(localId, projection);
        checkCall(record, projection);
        if (record.result !== null || record.task?.status === "cancelled") {
          return publicRecord(record, projection);
        }
        if (["cancel_requested", "cancel_unknown"].includes(record.phase)) {
          throw failure(
            "CC_MCP_TASK_CANCEL_RECONCILIATION_REQUIRED",
            "Poll the prior cancellation before sending another cancel request",
          );
        }
        const key = restore(record);
        record = append(record, "cancel_requested");
        let task;
        try {
          task = await client.cancelTask(
            record.serverName,
            record.task.taskId,
            requestOptions(record, key, signal),
          );
        } catch (error) {
          append(record, "cancel_unknown");
          throw remoteFailure(error, record);
        }
        record = append(record, "observed", { task });
        // Cancellation does not prove that previously executed side effects did
        // not happen. Leave the original call unsettled until result/review.
        return publicRecord(record, read());
      });
    },
  });
}

export function listDurableMcpTasks(sessionId) {
  const projection = readMcpTaskJournal(sessionId);
  return Object.freeze({
    sessionId,
    records: Object.freeze(
      projection.records.map((record) => publicRecord(record, projection)),
    ),
  });
}
