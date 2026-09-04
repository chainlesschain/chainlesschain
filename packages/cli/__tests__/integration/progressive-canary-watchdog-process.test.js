import { createHash, generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  createProgressiveCanaryWatchdogPlan,
  ProgressiveCanaryExternalWatchdog,
} from "../../src/lib/evolution/progressive-canary-external-watchdog.js";
import { createProgressiveCanaryWatchdogFileStore } from "../../src/lib/evolution/progressive-canary-watchdog-file-store.js";
import {
  createNodeProgressiveCanaryExternalRollbackAuthority,
  createNodeProgressiveCanaryHeartbeatAuthority,
  progressiveCanaryPublicKeySpkiDigest,
} from "../../src/lib/evolution/progressive-canary-watchdog-node-pki.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
const HOST_WORKER = fileURLToPath(
  new URL("./helpers/progressive-canary-watchdog-host.mjs", import.meta.url),
);
const children = new Set();

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  children.clear();
});

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error("host readiness timed out")),
      10_000,
    );
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      const newline = output.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      resolve(JSON.parse(output.slice(0, newline)));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (output.includes("\n")) return;
      clearTimeout(timer);
      reject(new Error(`host exited before ready: ${code}/${signal}`));
    });
  });
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("host kill timed out")),
      10_000,
    );
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function durableWrite(path, value) {
  const handle = await open(path, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return JSON.parse(await readFile(path, "utf8"));
}

describe("progressive Canary watchdog across processes", () => {
  it("verifies a child heartbeat, kills its PID, rolls back LKG, and reopens the incident", async () => {
    const root = await mkdtemp(join(tmpdir(), "cc-watchdog-process-"));
    const storeRoot = join(root, "store");
    const heartbeatKeys = generateKeyPairSync("ed25519");
    const rollbackKeys = generateKeyPairSync("ed25519");
    const candidateStateDigest = D("candidate-state");
    const baselineDigest = D("last-known-good");
    const plan = createProgressiveCanaryWatchdogPlan({
      tenantId: "tenant-process",
      pilotId: "pilot-process",
      descriptorDigest: D("descriptor"),
      baselineDigest,
      hostId: "host-process",
      leaseDurationMs: 1_000,
      heartbeatAuthority: {
        id: "heartbeat-process",
        revision: 1,
        handlerDigest: D("heartbeat-handler"),
        publicKeySpkiDigest: progressiveCanaryPublicKeySpkiDigest(
          heartbeatKeys.publicKey,
        ),
      },
      rollbackAuthority: {
        id: "rollback-process",
        revision: 1,
        handlerDigest: D("rollback-handler"),
        publicKeySpkiDigest: progressiveCanaryPublicKeySpkiDigest(
          rollbackKeys.publicKey,
        ),
      },
    });
    const planPath = join(root, "plan.json");
    const heartbeatPrivatePath = join(root, "heartbeat-private.pem");
    const heartbeatPublicPath = join(root, "heartbeat-public.pem");
    await Promise.all([
      writeFile(planPath, JSON.stringify(plan)),
      writeFile(
        heartbeatPrivatePath,
        heartbeatKeys.privateKey.export({ type: "pkcs8", format: "pem" }),
      ),
      writeFile(
        heartbeatPublicPath,
        heartbeatKeys.publicKey.export({ type: "spki", format: "pem" }),
      ),
    ]);
    const child = spawn(
      process.execPath,
      [
        HOST_WORKER,
        planPath,
        heartbeatPrivatePath,
        heartbeatPublicPath,
        storeRoot,
        candidateStateDigest,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    children.add(child);
    const ready = await waitForReady(child);
    expect(ready.pid).toBe(child.pid);

    const store = await createProgressiveCanaryWatchdogFileStore({
      rootDir: storeRoot,
      planDigest: plan.planDigest,
      hostId: plan.hostId,
    });
    const latest = await store.heartbeatSource.readLatest({
      planDigest: plan.planDigest,
      hostId: plan.hostId,
    });
    const heartbeatVerifier = createNodeProgressiveCanaryHeartbeatAuthority({
      plan,
      publicKey: heartbeatKeys.publicKey,
    });
    const activePath = join(root, "active-state.json");
    await durableWrite(activePath, { activeStateDigest: candidateStateDigest });
    let killAttempts = 0;
    const rollbackAuthority =
      createNodeProgressiveCanaryExternalRollbackAuthority({
        plan,
        privateKey: rollbackKeys.privateKey,
        publicKey: rollbackKeys.publicKey,
        async killHost(request) {
          expect(request.hostId).toBe(plan.hostId);
          killAttempts += 1;
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGTERM");
            await waitForExit(child);
          }
          if (killAttempts === 1)
            throw new Error("simulated watchdog crash after host kill");
          return {
            authenticated: true,
            durable: true,
            incidentDigest: request.incidentDigest,
            hostId: request.hostId,
            processAbsent: child.exitCode !== null || child.signalCode !== null,
            effectDigest: D(`kill:${child.pid}:${request.incidentDigest}`),
          };
        },
        async rollbackToBaseline(request) {
          const readback = await durableWrite(activePath, {
            activeStateDigest: baselineDigest,
          });
          return {
            authenticated: true,
            durable: true,
            incidentDigest: request.incidentDigest,
            baselineDigest,
            activeStateDigest: readback.activeStateDigest,
            effectDigest: D(`rollback:${request.incidentDigest}`),
          };
        },
      });
    const watchdog = new ProgressiveCanaryExternalWatchdog({
      plan,
      heartbeatAuthority: heartbeatVerifier,
      heartbeatSource: store.heartbeatSource,
      rollbackAuthority,
      incidentStore: store.incidentStore,
    });
    await expect(
      watchdog.inspect({ observedAt: latest.receipt.expiresAt + 1 }),
    ).rejects.toThrow("simulated watchdog crash after host kill");
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(JSON.parse(await readFile(activePath, "utf8"))).toEqual({
      activeStateDigest: candidateStateDigest,
    });

    const first = await watchdog.inspect({
      observedAt: latest.receipt.expiresAt + plan.leaseDurationMs + 2,
    });
    expect(first.rolledBack).toBe(true);
    expect(killAttempts).toBe(2);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(JSON.parse(await readFile(activePath, "utf8"))).toEqual({
      activeStateDigest: baselineDigest,
    });

    const reopened = await createProgressiveCanaryWatchdogFileStore({
      rootDir: storeRoot,
      planDigest: plan.planDigest,
      hostId: plan.hostId,
    });
    const restartedWatchdog = new ProgressiveCanaryExternalWatchdog({
      plan,
      heartbeatAuthority: heartbeatVerifier,
      heartbeatSource: reopened.heartbeatSource,
      rollbackAuthority,
      incidentStore: reopened.incidentStore,
    });
    const recovered = await restartedWatchdog.inspect({
      observedAt: latest.receipt.expiresAt + 20_000,
    });
    expect(recovered.recovered).toBe(true);
    expect(recovered.incident.incidentDigest).toBe(
      first.incident.incidentDigest,
    );
  }, 30_000);
});
