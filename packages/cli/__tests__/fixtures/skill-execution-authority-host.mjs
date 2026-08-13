import { parentPort, workerData } from "node:worker_threads";
import { DurableSkillExecutionAuthority } from "../../src/lib/skill-execution-authority.js";

const isWorker = Boolean(parentPort);
const filePath = isWorker ? workerData.filePath : process.argv[2];
const command = isWorker
  ? workerData.command || "active"
  : process.argv[3] || "active";
const authority = new DurableSkillExecutionAuthority({
  filePath,
  pollIntervalMs: 20,
});
let terminalMessageSequence = 0;

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
  } else if (command === "revoke") {
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
