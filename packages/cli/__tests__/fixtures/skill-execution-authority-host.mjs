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

function send(payload, done = false) {
  if (isWorker) {
    parentPort.postMessage(payload);
    if (done) parentPort.close();
    return;
  }
  if (typeof process.send === "function") {
    process.send(payload, done ? () => process.exit(0) : undefined);
  } else if (done) {
    process.exit(0);
  }
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
