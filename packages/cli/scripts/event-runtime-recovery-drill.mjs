/**
 * Cross-process Event Runtime recovery drill.
 *
 * Process A claims a durable record and exits without settlement. After its
 * lease expires, process B must reclaim the same record with a higher fence,
 * settle it exactly once, and expose A as stale through the shared host
 * registry. Child creation is routed through ProcessExecutionBroker so the
 * drill exercises the same audited process boundary as production tooling.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventRuntimeHost } from "../src/lib/event-runtime-host.js";
import { EventRuntimeStore } from "../src/lib/event-runtime-store.js";
import { executionBroker } from "../src/lib/process-execution-broker/index.js";

const scriptPath = fileURLToPath(import.meta.url);
const LEASE_MS = 80;
const HOST_STALE_MS = 100;

function writeResult(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function childStore(dir, role) {
  return new EventRuntimeStore({
    dir,
    owner: `${role}:${process.pid}`,
    leaseMs: LEASE_MS,
    hostStaleMs: HOST_STALE_MS,
  });
}

function runClaimant(dir) {
  const store = childStore(dir, "claimant");
  store.reportHost({
    id: store.owner,
    role: "recovery-drill-claimant",
    staleAfterMs: HOST_STALE_MS,
  });
  store.enqueueInbox({
    event_id: "event-runtime-recovery-drill",
    type: "runtime.recovery.drill",
    requiresHandler: true,
  });
  const [record] = store.claimInbox();
  if (!record) throw new Error("claimant could not claim the drill record");
  writeResult({
    role: "claimant",
    owner: record.lease.owner,
    fence: record.lease.fence,
    attempts: record.attempts,
  });
  // Intentionally do not acknowledge or publish a stopped heartbeat. Exiting
  // here models a hard host crash.
}

async function runRecovery(dir) {
  const store = childStore(dir, "recovery");
  const host = new EventRuntimeHost({
    store,
    role: "recovery-drill-successor",
    heartbeatStaleMs: HOST_STALE_MS,
  });
  const effectFile = path.join(dir, "recovered-effect.json");
  let recoveryFence = null;
  host.registerHandler((_event, record) => {
    recoveryFence = record.lease?.fence ?? null;
    try {
      fs.writeFileSync(
        effectFile,
        JSON.stringify({ eventId: record.id, recoveredBy: store.owner }),
        { encoding: "utf8", flag: "wx" },
      );
      return { recoveredBy: store.owner, effect: "created" };
    } catch (error) {
      if (error?.code === "EEXIST") {
        return { recoveredBy: store.owner, effect: "already-applied" };
      }
      throw error;
    }
  }, {
    queue: "inbox",
    type: "runtime.recovery.drill",
  });
  host.start({ immediate: false });
  const stats = await host.runOnce();
  await host.stop({ drain: false });
  const settled = store
    .listInbox()
    .find((item) => item.id === "event-runtime-recovery-drill");
  if (settled?.status !== "done" || stats.inboxAcked !== 1) {
    throw new Error("successor did not settle the recovered side effect");
  }
  writeResult({
    role: "recovery",
    owner: store.owner,
    fence: recoveryFence,
    attempts: settled.attempts,
    status: settled.status,
    effect: JSON.parse(fs.readFileSync(effectFile, "utf8")),
  });
}

function parseChildResult(stdout, role) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  try {
    return JSON.parse(lines.at(-1) || "");
  } catch {
    throw new Error(`${role} returned invalid drill output`);
  }
}

function runChild(mode, dir) {
  return new Promise((resolve, reject) => {
    // A Windows restricted token may intentionally lose access to the
    // parent-created temp directory, which would turn this persistence drill
    // into an ACL test. In non-strict mode use the Broker's explicit,
    // audited sandbox-unavailable path for this fixed Node + argv invocation;
    // strict CI keeps the platform sandbox mandatory.
    const previousSandboxDisable = process.env.CC_SANDBOX_DISABLE;
    if (process.platform === "win32" && process.env.CC_SANDBOX_STRICT !== "1") {
      process.env.CC_SANDBOX_DISABLE = "1";
    }
    let child;
    try {
      child = executionBroker.fork(scriptPath, ["--child", mode, dir], {
        origin: "tooling:event-runtime-recovery-drill",
        scope: "runtime-recovery-drill",
        policy: "allow",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } finally {
      if (previousSandboxDisable == null) {
        delete process.env.CC_SANDBOX_DISABLE;
      } else {
        process.env.CC_SANDBOX_DISABLE = previousSandboxDisable;
      }
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve(parseChildResult(stdout, mode));
        return;
      }
      reject(
        new Error(
          `${mode} process failed (${code ?? signal ?? "unknown"}): ${stderr.trim()}`,
        ),
      );
    });
  });
}

export async function runRecoveryDrill({
  dir = null,
  waitMs = LEASE_MS + HOST_STALE_MS + 40,
  cleanup = dir == null,
} = {}) {
  const runtimeDir =
    dir || fs.mkdtempSync(path.join(os.tmpdir(), "cc-event-runtime-drill-"));
  try {
    const claimant = await runChild("claim", runtimeDir);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(waitMs, LEASE_MS + 1)),
    );
    const recovery = await runChild("recover", runtimeDir);
    const observer = new EventRuntimeStore({
      dir: runtimeDir,
      owner: `observer:${process.pid}`,
      leaseMs: LEASE_MS,
      hostStaleMs: HOST_STALE_MS,
    });
    const record = observer
      .listInbox()
      .find((item) => item.id === "event-runtime-recovery-drill");
    const health = observer.getHealthSnapshot();
    const effect = JSON.parse(
      fs.readFileSync(path.join(runtimeDir, "recovered-effect.json"), "utf8"),
    );
    const claimantHost = health.hosts.entries.find(
      (host) => host.role === "recovery-drill-claimant",
    );
    const recoveryHost = health.hosts.entries.find(
      (host) => host.role === "recovery-drill-successor",
    );
    if (
      record?.status !== "done" ||
      record?.attempts !== 2 ||
      recovery.fence <= claimant.fence ||
      claimantHost?.stale !== true ||
      recoveryHost?.state !== "stopped" ||
      effect.eventId !== record.id
    ) {
      throw new Error("cross-process recovery invariants were not satisfied");
    }
    return {
      schema: "chainlesschain.event-runtime-recovery-drill.v1",
      ok: true,
      record: {
        id: record.id,
        status: record.status,
        attempts: record.attempts,
        firstFence: claimant.fence,
        recoveryFence: recovery.fence,
      },
      hosts: {
        stale: health.hosts.stale,
        stopped: health.hosts.stopped,
      },
      effect: {
        eventId: effect.eventId,
        applications: 1,
      },
    };
  } finally {
    if (cleanup) {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  }
}

const directRun =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() ===
    path.resolve(scriptPath).toLowerCase();

if (directRun) {
  const [flag, mode, dir] = process.argv.slice(2);
  if (flag === "--child") {
    try {
      if (!dir) throw new Error("child runtime directory is required");
      if (mode === "claim") runClaimant(dir);
      else if (mode === "recover") await runRecovery(dir);
      else throw new Error(`unknown recovery child mode: ${mode}`);
    } catch (error) {
      process.stderr.write(`${error?.stack || error}\n`);
      process.exitCode = 1;
    }
  } else {
    runRecoveryDrill()
      .then((result) => writeResult(result))
      .catch((error) => {
        process.stderr.write(`${error?.stack || error}\n`);
        process.exitCode = 1;
      });
  }
}
