import { parentPort, workerData } from "node:worker_threads";
import { DurableSkillExecutionAuthority } from "../../src/lib/skill-execution-authority.js";

const isWorker = Boolean(parentPort);
const filePath = isWorker ? workerData.filePath : process.argv[2];
const command = isWorker
  ? workerData.command || "active"
  : process.argv[3] || "active";
// This campaign deliberately starts six independent writers at once. A busy
// Windows CI host can leave the current lock holder unscheduled for longer
// than the store's normal two-second admission budget, even though its
// critical section is healthy. Keep this campaign bounded, but give every
// contender enough time to observe all preceding durable generations.
const concurrentRevocationLockOptions = Object.freeze({ timeoutMs: 10000 });
const diagnosticRevocationLockOptions = Object.freeze({ timeoutMs: 100 });
const lockOptions =
  command === "revoke"
    ? concurrentRevocationLockOptions
    : command === "revoke-lock-timeout"
      ? diagnosticRevocationLockOptions
      : undefined;
const authority = new DurableSkillExecutionAuthority({
  filePath,
  pollIntervalMs: 20,
  ...(lockOptions ? { lockOptions } : {}),
});
let terminalMessageSequence = 0;

function safeCauseDiagnostic(error) {
  try {
    const cause = error?.cause;
    const causeCode =
      typeof cause?.code === "string" &&
      /^[A-Z][A-Z0-9_]{0,127}$/u.test(cause.code)
        ? cause.code
        : null;
    const causeAttempts =
      Number.isSafeInteger(cause?.attempts) && cause.attempts > 0
        ? cause.attempts
        : null;
    const causeCommitState = ["not-committed", "committed", "unknown"].includes(
      cause?.commitState,
    )
      ? cause.commitState
      : null;
    return { causeCode, causeAttempts, causeCommitState };
  } catch {
    return {};
  }
}

function sendRaw(payload, callback) {
  if (isWorker) {
    try {
      parentPort.postMessage(payload);
      callback?.();
    } catch (error) {
      callback?.(error);
      if (!callback) throw error;
    }
  } else if (typeof process.send === "function") {
    process.send(payload, callback);
  } else throw new Error("Skill authority fixture IPC channel is unavailable");
}

function send(payload, done = false) {
  if (!done) {
    sendRaw(payload);
    return;
  }

  // A successful process.send callback only proves that Node handed the
  // payload to the IPC pipe. On Windows the parent can observe `exit` before
  // its queued `message` callback runs. Keep this fixture alive until the
  // parent has actually consumed the terminal result.
  const terminalAckId = `${process.pid}:${++terminalMessageSequence}`;
  const channel = isWorker ? parentPort : process;
  const cleanup = () => {
    clearTimeout(timer);
    channel.off("message", onAcknowledgement);
  };
  const finish = (code) => {
    cleanup();
    if (isWorker && code === 0) parentPort.close();
    else process.exit(code);
  };
  const onAcknowledgement = (message) => {
    if (
      message?.type !== "terminal-ack" ||
      message?.terminalAckId !== terminalAckId
    ) {
      return;
    }
    finish(0);
  };
  const timer = setTimeout(() => finish(1), 4000);
  channel.on("message", onAcknowledgement);
  sendRaw({ ...payload, terminalAckId }, (error) => {
    if (error) finish(1);
  });
}

function fail(error) {
  send(
    {
      type: "error",
      code: error?.code || null,
      message: error?.message || String(error),
      ...safeCauseDiagnostic(error),
    },
    true,
  );
}

try {
  if (command === "read") {
    send(
      { type: "generation", generation: String(authority.readGeneration()) },
      true,
    );
  } else if (command === "revoke" || command === "revoke-lock-timeout") {
    send(
      {
        type: "revoked",
        ...authority.revoke({ reasonCode: "concurrency-test" }),
      },
      true,
    );
  } else {
    const lease = authority.acquireLease({ skillId: "fixture-skill" });
    send({ type: "ready", generation: String(lease.generation) });
    lease.signal.addEventListener(
      "abort",
      () => {
        send({
          type: "aborted",
          code: lease.signal.reason?.code || null,
          generation: lease.signal.reason?.generation || null,
          message: lease.signal.reason?.message || null,
        });
      },
      { once: true },
    );

    const receive = (message) => {
      if (message === "shutdown") {
        lease.release();
        send({ type: "stopped" }, true);
      } else if (message === "assert") {
        try {
          authority.assertGeneration(lease.generation);
          send({ type: "asserted", active: true });
        } catch (error) {
          send({
            type: "asserted",
            active: false,
            code: error?.code || null,
          });
        }
      }
    };
    if (isWorker) parentPort.on("message", receive);
    else process.on("message", receive);
  }
} catch (error) {
  fail(error);
}
