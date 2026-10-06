import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const driver = fileURLToPath(
  new URL("../fixtures/dmm-goal-workflow-process.mjs", import.meta.url),
);
const roots = [];
const workers = new Set();
function launch(root, options) {
  const child = fork(driver, [root, JSON.stringify(options)], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
    execArgv: [],
  });
  const messages = [],
    pending = new Set();
  let output = "",
    exited = false,
    processError;
  const record = (chunk) => {
    output = (output + chunk.toString()).slice(-16384);
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  child.on("message", (message) => {
    messages.push(message);
    for (const check of [...pending]) check();
  });
  child.on("error", (error) => {
    processError = error;
    for (const check of [...pending]) check();
  });
  const closed = new Promise((finish) =>
    child.once("close", (code, signal) => {
      exited = true;
      for (const check of [...pending]) check();
      finish({ code, signal });
    }),
  );
  const worker = {
    child,
    closed,
    waitFor(type) {
      return new Promise((accept, reject) => {
        let timer;
        const complete = (error, result) => {
          clearTimeout(timer);
          pending.delete(check);
          if (error) reject(error);
          else accept(result);
        };
        const check = () => {
          const found = messages.find((message) => message.type === type);
          const fatal = messages.find((message) => message.type === "fatal");
          if (found) complete(null, found);
          else if (fatal || processError || exited)
            complete(
              new Error(
                `Worker ${child.pid} ended before ${type}: ${JSON.stringify(fatal ?? processError)} ${output}`,
              ),
            );
        };
        pending.add(check);
        timer = setTimeout(
          () =>
            complete(
              new Error(`Worker ${child.pid} timed out at ${type}: ${output}`),
            ),
          20_000,
        );
        check();
      });
    },
    async send(command) {
      await new Promise((accept, reject) =>
        child.send({ command }, (error) => (error ? reject(error) : accept())),
      );
    },
    async start() {
      expect(await this.waitFor("ready")).toMatchObject({
        pid: child.pid,
        database: "native-better-sqlite3",
        projectOpen: true,
      });
      await this.send("go");
      return this;
    },
    async finish() {
      const done = await this.waitFor("done");
      expect(await closed).toEqual({ code: 0, signal: null });
      return done;
    },
    async crash() {
      const barrier = await this.waitFor("barrier");
      expect(barrier.pid).toBe(child.pid);
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
      // Kill only this parent-owned, barrier-confirmed live child and reap it
      // before reading or removing any files. No graceful shutdown runs.
      expect(child.kill("SIGKILL")).toBe(true);
      const result = await closed;
      expect(result.code === 0 && result.signal === null).toBe(false);
    },
  };
  workers.add(worker);
  return worker;
}
async function fixture() {
  const temporaryParent = realpathSync(tmpdir());
  const root = mkdtempSync(join(temporaryParent, "cc-dmm-workflow-process-"));
  roots.push({ root, temporaryParent });
  const init = await launch(root, { mode: "initialize" }).start();
  const done = await init.finish();
  return { root, binding: done.outcome.binding };
}
function inspect(root) {
  const db = new Database(join(root, "project.sqlite"), { readonly: true });
  try {
    return {
      tasks: db.prepare("SELECT COUNT(*) AS n FROM project_tasks").get().n,
      confirmations: db
        .prepare("SELECT COUNT(*) AS n FROM fixture_confirmations")
        .get().n,
      runs: db
        .prepare("SELECT run_json FROM cc_business_action_runs ORDER BY id")
        .all()
        .map((row) => JSON.parse(row.run_json)),
      ledger: db
        .prepare(
          "SELECT record_json FROM cc_project_goal_usage ORDER BY operation_id",
        )
        .all()
        .map((row) => JSON.parse(row.record_json)),
      integrity: db.pragma("integrity_check", { simple: true }),
    };
  } finally {
    db.close();
  }
}
function admitted(snapshot, intentId) {
  expect(snapshot).toMatchObject({ tasks: 1, confirmations: 1 });
  expect(snapshot.runs).toHaveLength(1);
  expect(snapshot.runs[0].status).toBe("running");
  expect(snapshot.ledger).toHaveLength(1);
  expect(snapshot.ledger[0]).toMatchObject({
    operationId: intentId,
    status: "reserved",
    usage: null,
  });
}
function recovered(done, intentId) {
  expect(done.outcome.recovered).toMatchObject({
    tasks: 1,
    confirmations: 1,
    usage: {
      totalRuns: 1,
      elapsedMs: null,
      unknownTime: 1,
      modelTokens: 0,
      modelCostUsd: 0,
    },
    intent: { executionState: "unresolved" },
  });
  expect(done.outcome.recovered.ledger).toHaveLength(1);
  expect(done.outcome.recovered.ledger[0]).toMatchObject({
    operationId: intentId,
    status: "unknown",
    usage: { runs: 1, elapsedMs: null, tokens: 0, costUsd: 0 },
  });
  expect(done.outcome.replay.result).toMatchObject({
    replayed: true,
    executionState: "unresolved",
    run: { status: "running" },
  });
  expect(done.outcome.next).toEqual({ error: "ACTION_GOAL_USAGE_UNKNOWN" });
  expect(done.snapshot).toMatchObject({
    tasks: 1,
    confirmations: 1,
    usage: { totalRuns: 1, elapsedMs: null, unknownTime: 1 },
  });
  expect(done.snapshot.runs).toHaveLength(1);
}
afterEach(async () => {
  for (const { child } of workers) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
  await Promise.all([...workers].map(({ closed }) => closed));
  workers.clear();
  for (const { root, temporaryParent } of roots.splice(0)) {
    const target = resolve(root);
    if (
      dirname(target) !== temporaryParent ||
      realpathSync(target) !== target ||
      !basename(target).startsWith("cc-dmm-workflow-process-")
    )
      throw new Error(`Unsafe workflow fixture cleanup target: ${target}`);
    rmSync(target, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
describe("goal native actions across actual process loss and late confirmation", () => {
  it("recovers a killed committed admission before any execute catch can mark usage unknown", async () => {
    const { root, binding } = await fixture();
    const first = await launch(root, { mode: "pending" }).start();
    const barrier = await first.waitFor("barrier");
    expect(barrier.snapshot.inTransaction).toBe(false);
    admitted(inspect(root), binding.intentId);
    await first.crash();
    // An independent connection proves SIGKILL did not run the catch/finally
    // path that normally marks usage unknown after an execution error.
    admitted(inspect(root), binding.intentId);
    const second = await launch(root, { mode: "recover" }).start();
    const done = await second.finish();
    expect(done.pid).not.toBe(first.child.pid);
    recovered(done, binding.intentId);
    expect(inspect(root)).toMatchObject({
      tasks: 1,
      confirmations: 1,
      integrity: "ok",
    });
  }, 40_000);
  it("rejects the original process's late native approval after another process recovers unknown usage", async () => {
    const { root, binding } = await fixture();
    const first = await launch(root, { mode: "pending" }).start();
    await first.waitFor("barrier");
    admitted(inspect(root), binding.intentId);
    const second = await launch(root, { mode: "recover" }).start();
    recovered(await second.finish(), binding.intentId);
    await first.send("release");
    const late = await first.finish();
    expect(late.outcome).toEqual({ error: "ACTION_GOAL_USAGE_UNKNOWN" });
    expect(late.snapshot).toMatchObject({
      tasks: 1,
      confirmations: 1,
      usage: { totalRuns: 1, elapsedMs: null, unknownTime: 1 },
      intent: { intent: { status: "denied" } },
    });
    expect(late.snapshot.ledger).toHaveLength(1);
    expect(late.snapshot.ledger[0]).toMatchObject({
      status: "settled",
      usage: { runs: 1, elapsedMs: null },
    });
    expect(inspect(root)).toMatchObject({
      tasks: 1,
      confirmations: 1,
      integrity: "ok",
    });
  }, 40_000);
  it("does not mark a same-process live confirmation unknown when another host is constructed", async () => {
    const { root, binding } = await fixture();
    const first = await launch(root, {
      mode: "pending",
      recoverWhilePending: true,
    }).start();
    const active = await first.waitFor("active-recovery");
    expect(active.recovered).toMatchObject({ recovered: 0 });
    admitted(active.snapshot, binding.intentId);
    expect(active.snapshot.usage.unknownTime).toBe(0);
    await first.send("release");
    const done = await first.finish();
    expect(done.outcome.result.run.status).toBe("succeeded");
    expect(done.snapshot).toMatchObject({
      tasks: 2,
      confirmations: 1,
      usage: { totalRuns: 1, reservedRuns: 0, unknownTime: 0 },
    });
    expect(done.snapshot.runs).toHaveLength(1);
    expect(inspect(root).integrity).toBe("ok");
  }, 40_000);
});
