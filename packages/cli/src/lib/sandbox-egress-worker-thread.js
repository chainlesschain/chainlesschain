import { parentPort, workerData } from "node:worker_threads";
import { createEgressProxy } from "./sandbox-egress-proxy.js";

let proxy;
try {
  proxy = createEgressProxy(workerData.policy, {
    bindHost: workerData.bindHost,
    socketPath: workerData.socketPath,
  });
  const { port, socketPath } = await proxy.listen();
  parentPort.postMessage({ type: "ready", port, socketPath });
  parentPort.on("message", async (message) => {
    if (!Number.isSafeInteger(message?.id) || message.id < 1) return;
    try {
      if (message.type === "update") {
        const revision = proxy.updatePolicy(
          message.policy,
          message.expectedRevision,
        );
        parentPort.postMessage({ id: message.id, revision });
      } else if (message.type === "close") {
        await proxy.close();
        parentPort.postMessage({ id: message.id, closed: true });
      }
    } catch (error) {
      parentPort.postMessage({
        id: message.id,
        errorCode:
          error?.code === "ERR_EGRESS_POLICY_REVISION"
            ? error.code
            : "ERR_EGRESS_WORKER_REQUEST",
      });
    }
  });
} catch {
  parentPort.postMessage({ type: "startup-failed" });
  parentPort.close();
}
