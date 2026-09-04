import { readFile } from "node:fs/promises";

import { createProgressiveCanaryWatchdogFileStore } from "../../../src/lib/evolution/progressive-canary-watchdog-file-store.js";
import { createNodeProgressiveCanaryHeartbeatAuthority } from "../../../src/lib/evolution/progressive-canary-watchdog-node-pki.js";

const [
  planPath,
  privateKeyPath,
  publicKeyPath,
  storeRoot,
  candidateStateDigest,
] = process.argv.slice(2);
const plan = JSON.parse(await readFile(planPath, "utf8"));
const [privateKey, publicKey] = await Promise.all([
  readFile(privateKeyPath, "utf8"),
  readFile(publicKeyPath, "utf8"),
]);
const store = await createProgressiveCanaryWatchdogFileStore({
  rootDir: storeRoot,
  planDigest: plan.planDigest,
  hostId: plan.hostId,
});
const heartbeatAuthority = createNodeProgressiveCanaryHeartbeatAuthority({
  plan,
  privateKey,
  publicKey,
});
const heartbeat = await heartbeatAuthority.issue({
  sequence: 1,
  stage: "active-probation",
  activeStateDigest: candidateStateDigest,
});
await store.publishHeartbeat(heartbeat);
process.stdout.write(
  `${JSON.stringify({ ready: true, pid: process.pid, receiptDigest: heartbeat.receiptDigest })}\n`,
);
setInterval(() => {}, 60_000);
