import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export async function assertPortFree({ port, host = "127.0.0.1" }) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

// HTTP readiness can disappear before the listener releases its port. Keep
// the caller's shutdown deadline and require a successful bind and close.
export async function waitForPortFree({
  port,
  host = "127.0.0.1",
  deadline,
  pollIntervalMs = 250,
}) {
  if (!Number.isFinite(deadline))
    throw new TypeError("A finite absolute shutdown deadline is required");
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0)
    throw new TypeError("A positive finite polling interval is required");
  let lastOccupiedError;
  const requireTimeRemaining = () => {
    if (Date.now() >= deadline)
      throw (
        lastOccupiedError ||
        Object.assign(new Error("Port release shutdown deadline exceeded"), {
          code: "CC_DIAGNOSTIC_PORT_DEADLINE_EXCEEDED",
        })
      );
  };
  while (true) {
    requireTimeRemaining();
    try {
      await assertPortFree({ port, host });
      requireTimeRemaining();
      return;
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
      lastOccupiedError = error;
      requireTimeRemaining();
      await delay(Math.min(pollIntervalMs, deadline - Date.now()));
    }
  }
}
