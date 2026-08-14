import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";
import { parseSchedulerSoakWorkerOptions } from "../../scripts/scheduler-kernel-soak-worker.mjs";

const WORKER_PATH = fileURLToPath(
  new URL("../../scripts/scheduler-kernel-soak-worker.mjs", import.meta.url),
);

function authority() {
  return {
    schemaVersion: 1,
    principal: { type: "test", id: "scheduler-soak-worker" },
    tenantId: null,
    workspaceId: null,
    requestedCapabilities: ["scheduler.soak.execute"],
    authorizationRefs: {
      decisionId: "scheduler-soak-test",
      policyRevision: "scheduler-soak-test",
      grantIds: [],
      approvalIds: [],
      delegationIds: [],
    },
  };
}

function seedOccurrence(db, kind, id, payload = {}, maxAttempts = 3) {
  const store = openSchedulerStore({ file: db });
  store.createJob({
    id,
    kind,
    trigger: { source: "scheduler-soak-test" },
    payload,
    authority: authority(),
    maxAttempts,
  });
  const occurrence = store.enqueueOccurrence({
    jobId: id,
    scheduledFor: Date.now(),
    triggerKey: `${id}:first`,
  });
  store.close();
  return occurrence;
}

function waitUntil(epochMs, paddingMs = 100) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, epochMs - Date.now() + paddingMs)),
  );
}

function startWorker({ db, effectsDir, owner, kind, pause = "none" }) {
  const child = spawn(
    process.execPath,
    [
      WORKER_PATH,
      "--db",
      db,
      "--effects-dir",
      effectsDir,
      "--owner",
      owner,
      "--worker-id",
      owner,
      "--job-kind",
      kind,
      "--pause",
      pause,
      "--lease-ms",
      "1000",
      "--poll-ms",
      "5",
      "--once",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const events = [];
  const waiters = [];
  let stdoutBuffer = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/u);
    stdoutBuffer = lines.pop();
    for (const line of lines) {
      if (!line) continue;
      const event = JSON.parse(line);
      events.push(event);
      for (const waiter of [...waiters]) {
        if (!waiter.predicate(event)) continue;
        clearTimeout(waiter.timer);
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event);
      }
    }
  });
  const waitFor = (predicate, timeoutMs = 15_000) => {
    const prior = events.find(predicate);
    if (prior) return Promise.resolve(prior);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(
          new Error(
            `worker event timeout: stderr=${stderr} events=${JSON.stringify(events)}`,
          ),
        );
      }, timeoutMs);
      waiters.push(waiter);
    });
  };
  const done = new Promise((resolve) => {
    child.once("exit", (code, signal) =>
      resolve({ code, signal, events, stderr }),
    );
  });
  return { child, events, waitFor, done };
}

describe("scheduler kernel soak worker", () => {
  const cleanups = [];

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()();
  });

  function fixture() {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-scheduler-soak-worker-"),
    );
    const db = path.join(root, "scheduler.db");
    const effectsDir = path.join(root, "effects");
    const workers = [];
    cleanups.push(async () => {
      for (const worker of workers) {
        if (worker.child.exitCode == null) worker.child.kill();
        await worker.done;
      }
      fs.rmSync(root, { recursive: true, force: true });
    });
    return {
      db,
      effectsDir,
      worker(options) {
        const worker = startWorker({ db, effectsDir, ...options });
        workers.push(worker);
        return worker;
      },
    };
  }

  it("requires explicit private state, owner, and a valid pause mode", () => {
    expect(() =>
      parseSchedulerSoakWorkerOptions(["--db", "scheduler.db"]),
    ).toThrow(/--effects-dir is required/);
    expect(() =>
      parseSchedulerSoakWorkerOptions([
        "--db",
        "scheduler.db",
        "--effects-dir",
        "effects",
        "--owner",
        "owner-a",
        "--pause",
        "unsafe",
      ]),
    ).toThrow(/--pause must be one of/);
  });

  it("runs one real runtime claim, writes one exclusive effect, and settles", async () => {
    const f = fixture();
    const kind = "soak.steady";
    const seeded = seedOccurrence(f.db, kind, "steady-job", {
      executionDelayMs: 5,
      resultValue: "steady-ok",
    });
    const worker = f.worker({ owner: "steady-owner", kind });

    const ready = await worker.waitFor((event) => event.type === "ready");
    expect(ready).toMatchObject({
      pause: "none",
      once: true,
      adapterKind: kind,
      schema: { schemaVersion: 5, quickCheck: "ok" },
    });
    const result = await worker.done;

    expect(result).toMatchObject({ code: 0, signal: null });
    expect(result.events.map((event) => event.type)).toEqual([
      "ready",
      "claimed",
      "effect-written",
      "settled",
      "stopped",
    ]);
    const effect = JSON.parse(
      fs.readFileSync(path.join(f.effectsDir, `${seeded.id}.json`), "utf8"),
    );
    expect(effect).toMatchObject({
      occurrenceId: seeded.id,
      attempt: 1,
      fence: 1,
      owner: "steady-owner",
    });
    expect(effect.resultDigest).toMatch(/^[a-f0-9]{64}$/u);

    const store = openSchedulerStore({ file: f.db });
    expect(store.getOccurrence(seeded.id)).toMatchObject({
      status: "succeeded",
      attempt: 1,
      fence: 1,
      leaseOwner: null,
    });
    store.close();
  });

  it("pauses before any effect and resumes through NDJSON control", async () => {
    const f = fixture();
    const kind = "soak.crash";
    const seeded = seedOccurrence(f.db, kind, "crash-job");
    const worker = f.worker({
      owner: "crash-owner",
      kind,
      pause: "before-execute",
    });

    const checkpoint = await worker.waitFor(
      (event) =>
        event.type === "checkpoint" && event.checkpoint === "before-execute",
    );
    expect(checkpoint.occurrence).toMatchObject({
      id: seeded.id,
      attempt: 1,
      fence: 1,
      leaseOwner: "crash-owner",
    });
    expect(fs.existsSync(path.join(f.effectsDir, `${seeded.id}.json`))).toBe(
      false,
    );

    worker.child.stdin.write(
      `${JSON.stringify({ type: "resume", checkpoint: "before-execute" })}\n`,
    );
    const result = await worker.done;
    expect(result.code).toBe(0);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "control",
        command: "resume",
        checkpoint: "before-execute",
        accepted: true,
      }),
    );
    expect(fs.existsSync(path.join(f.effectsDir, `${seeded.id}.json`))).toBe(
      true,
    );
  });

  it("survives a hard kill before execution and rejects the stale lower fence", async () => {
    const f = fixture();
    const kind = "soak.crash";
    const seeded = seedOccurrence(f.db, kind, "hard-kill-job");
    const crashed = f.worker({
      owner: "crashed-owner",
      kind,
      pause: "before-execute",
    });
    const checkpoint = await crashed.waitFor(
      (event) =>
        event.type === "checkpoint" && event.checkpoint === "before-execute",
    );

    expect(crashed.child.kill()).toBe(true);
    const crashedResult = await crashed.done;
    expect(crashedResult.code === null || crashedResult.code !== 0).toBe(true);
    expect(fs.existsSync(path.join(f.effectsDir, `${seeded.id}.json`))).toBe(
      false,
    );
    await waitUntil(checkpoint.occurrence.leaseExpiresAt);

    const replacement = f.worker({
      owner: "replacement-owner",
      kind,
      pause: "before-execute",
    });
    const claimed = await replacement.waitFor(
      (event) =>
        event.type === "checkpoint" && event.checkpoint === "before-execute",
    );
    expect(claimed.occurrence).toMatchObject({
      id: seeded.id,
      attempt: 2,
      fence: 2,
      leaseOwner: "replacement-owner",
    });

    const store = openSchedulerStore({ file: f.db });
    expect(store.getOccurrence(seeded.id)).toMatchObject({
      status: "running",
      attempt: 2,
      fence: 2,
      leaseOwner: "replacement-owner",
    });
    let staleError;
    try {
      store.settle({
        occurrenceId: seeded.id,
        ownerId: "crashed-owner",
        fence: checkpoint.occurrence.fence,
        outcome: "succeeded",
        result: { stale: true },
      });
    } catch (error) {
      staleError = error;
    }
    expect(staleError).toMatchObject({ code: "SCHEDULER_LEASE_LOST" });
    store.close();
    replacement.child.stdin.write(
      `${JSON.stringify({ type: "resume", checkpoint: "before-execute" })}\n`,
    );
    const replacementResult = await replacement.done;
    expect(replacementResult.code).toBe(0);

    const settledStore = openSchedulerStore({ file: f.db });
    expect(settledStore.getOccurrence(seeded.id)).toMatchObject({
      status: "succeeded",
      attempt: 2,
      fence: 2,
    });
    settledStore.close();
    expect(
      fs
        .readdirSync(f.effectsDir)
        .filter((name) => name === `${seeded.id}.json`),
    ).toHaveLength(1);
  });

  it("dead-letters an after-execute hard kill without replaying its effect", async () => {
    const f = fixture();
    const kind = "soak.outcome";
    const seeded = seedOccurrence(f.db, kind, "outcome-unknown-job", {}, 1);
    const crashed = f.worker({
      owner: "outcome-crashed-owner",
      kind,
      pause: "after-execute",
    });
    const checkpoint = await crashed.waitFor(
      (event) =>
        event.type === "checkpoint" && event.checkpoint === "after-execute",
    );
    const effectPath = path.join(f.effectsDir, `${seeded.id}.json`);
    const effectBefore = fs.readFileSync(effectPath, "utf8");

    expect(crashed.child.kill()).toBe(true);
    await crashed.done;
    await waitUntil(checkpoint.occurrence.leaseExpiresAt);

    const observer = f.worker({ owner: "outcome-observer", kind });
    const observerResult = await observer.done;
    expect(observerResult).toMatchObject({ code: 0, signal: null });
    expect(
      observerResult.events.some((event) => event.type === "claimed"),
    ).toBe(false);
    expect(observerResult.events.some((event) => event.type === "idle")).toBe(
      true,
    );
    expect(
      observerResult.events.filter((event) => event.type === "idle"),
    ).toEqual([expect.objectContaining({ consecutivePolls: 1 })]);
    expect(fs.readFileSync(effectPath, "utf8")).toBe(effectBefore);

    const store = openSchedulerStore({ file: f.db });
    expect(store.getOccurrence(seeded.id)).toMatchObject({
      status: "dead_letter",
      attempt: 1,
      fence: 1,
      lastError: { code: "lease_expired" },
    });
    expect(
      store.history({ occurrenceId: seeded.id }).map((event) => event.type),
    ).toContain("occurrence_dead_lettered");
    store.close();
  });

  it("fails a second execution closed instead of overwriting an effect", async () => {
    const f = fixture();
    const kind = "soak.outcome";
    const seeded = seedOccurrence(f.db, kind, "outcome-job");
    fs.mkdirSync(f.effectsDir, { recursive: true });
    const effectPath = path.join(f.effectsDir, `${seeded.id}.json`);
    fs.writeFileSync(effectPath, "existing authoritative effect\n", {
      mode: 0o600,
    });
    const worker = f.worker({ owner: "outcome-owner", kind });

    const result = await worker.done;

    expect(result.code).toBe(1);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "settled",
        status: "dead_letter",
        error: expect.objectContaining({
          code: "SCHEDULER_SOAK_DUPLICATE_EFFECT",
        }),
      }),
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "fatal",
        error: expect.objectContaining({
          code: "SCHEDULER_SOAK_DUPLICATE_EFFECT",
        }),
      }),
    );
    expect(fs.readFileSync(effectPath, "utf8")).toBe(
      "existing authoritative effect\n",
    );
  });
});
