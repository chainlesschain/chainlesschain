import { fork } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const worker = fileURLToPath(
  new URL("../fixtures/dmm-goal-monitoring-process.mjs", import.meta.url),
);
const instant = 1791244800000;
const leaseMs = 60_000;
const roots = [];
const workers = new Set();

function launch(root, options = {}) {
  const child = fork(
    worker,
    [root, JSON.stringify({ now: instant, mode: "check", ...options })],
    {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
      execArgv: [],
    },
  );
  const messages = [];
  const pending = new Set();
  let output = "",
    exited = false;
  const record = (data) => {
    output = (output + data.toString()).slice(-16_384);
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  child.on("message", (message) => {
    messages.push(message);
    for (const check of [...pending]) check();
  });
  let processError;
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
  const control = {
    child,
    closed,
    waitFor(type, timeout = 20_000) {
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
          timeout,
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
      const ready = await this.waitFor("ready");
      expect(ready).toMatchObject({
        pid: child.pid,
        projectOpen: true,
        schedulerOpen: true,
        database: "native-better-sqlite3",
      });
      await this.send("go");
      return this;
    },
    async finish() {
      const result = await this.waitFor("done");
      expect(await closed).toEqual({ code: 0, signal: null });
      return result;
    },
    async crash() {
      // The barrier proves this exact child owns open native handles at the
      // crash point. No SIGTERM handler, exception, close(), or reopen() stands
      // in for a process death. Node uses its owned process handle on Windows.
      const barrier = await this.waitFor("barrier");
      expect(barrier.pid).toBe(child.pid);
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
      expect(child.kill("SIGKILL")).toBe(true);
      const termination = await closed;
      expect(termination.code === 0 && termination.signal === null).toBe(false);
      return barrier;
    },
  };
  workers.add(control);
  return control;
}

async function fixture(options = {}) {
  const temporaryParent = realpathSync(tmpdir());
  const root = mkdtempSync(join(temporaryParent, "cc-dmm-process-"));
  roots.push({ root, temporaryParent });
  const init = launch(root, { ...options, mode: "initialize" });
  await init.start();
  const { outcome } = await init.finish();
  return { root, request: outcome.request };
}

function inspect(root) {
  const project = new Database(join(root, "project.sqlite"), {
    readonly: true,
  });
  const scheduler = new Database(join(root, "scheduler.sqlite"), {
    readonly: true,
  });
  try {
    return {
      jobs: scheduler.prepare("SELECT COUNT(*) AS n FROM jobs").get().n,
      reviews: project
        .prepare("SELECT COUNT(*) AS n FROM cc_project_risk_reviews")
        .get().n,
      checks: project
        .prepare("SELECT COUNT(*) AS n FROM cc_project_goal_checks")
        .get().n,
      records: project
        .prepare("SELECT occurrence_id,review_id FROM cc_project_goal_checks")
        .all(),
      occurrences: scheduler
        .prepare(
          "SELECT occurrence_id,status,fence,attempt,lease_owner FROM occurrences",
        )
        .all(),
      reservations: scheduler
        .prepare(
          "SELECT occurrence_id,units,status FROM scheduler_authority_reservations",
        )
        .all(),
      usage: scheduler
        .prepare(
          "SELECT COALESCE(SUM(runs),0) AS runs,COALESCE(SUM(units),0) AS units FROM scheduler_authority_usage",
        )
        .get(),
      projectIntegrity: project.pragma("integrity_check", { simple: true }),
      schedulerIntegrity: scheduler.pragma("integrity_check", { simple: true }),
    };
  } finally {
    project.close();
    scheduler.close();
  }
}

async function resume(root, options = {}) {
  const recovery = launch(root, { now: instant + leaseMs + 1, ...options });
  await recovery.start();
  return recovery.finish();
}

afterEach(async () => {
  // Reap every process before touching files. Validate both resolved and real
  // cleanup targets against the exact temporary parent on every platform.
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
      !basename(target).startsWith("cc-dmm-process-")
    )
      throw new Error(`Unsafe process fixture cleanup target: ${target}`);
    rmSync(target, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

describe("DMM native SQLite recovery after real child process death", () => {
  it("shares one immutable job when two fresh manual intents both observe its absence", async () => {
    const { root } = await fixture({ maxRuns: 2 });
    const contenders = ["fresh-first", "fresh-second"].map((requestId) =>
      launch(root, { requestId, barrier: "first-job-miss" }),
    );
    await Promise.all(contenders.map((entry) => entry.start()));
    const deadline = Date.now() + 15_000;
    const observations = await Promise.all(
      contenders.map(async ({ child }) => {
        const marker = join(root, `job-miss-${child.pid}.json`);
        while (!existsSync(marker)) {
          if (
            child.exitCode !== null ||
            child.signalCode !== null ||
            Date.now() >= deadline
          )
            throw new Error(
              `Worker ${child.pid} did not reach the first-job barrier`,
            );
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(child.exitCode).toBeNull();
        const observation = JSON.parse(readFileSync(marker, "utf8"));
        expect(observation).toMatchObject({
          pid: child.pid,
          missing: true,
          inProjectTransaction: false,
          inSchedulerTransaction: false,
        });
        return observation;
      }),
    );
    expect(observations[0].jobId).toBe(observations[1].jobId);
    expect(inspect(root)).toMatchObject({
      jobs: 0,
      checks: 0,
      reviews: 0,
      occurrences: [],
      usage: { runs: 0, units: 0 },
    });
    writeFileSync(join(root, "release-job-creation"), "release");
    const results = await Promise.all(
      contenders.map((entry) => entry.finish()),
    );
    expect(results.map(({ outcome }) => outcome.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(
      new Set(results.map(({ outcome }) => outcome.occurrenceId)).size,
    ).toBe(2);
    expect(
      new Set(results.map(({ outcome }) => outcome.result.reviewId)).size,
    ).toBe(2);
    const final = inspect(root);
    expect(final).toMatchObject({
      jobs: 1,
      reviews: 2,
      checks: 2,
      usage: { runs: 2, units: 2 },
      projectIntegrity: "ok",
      schedulerIntegrity: "ok",
    });
    expect(final.occurrences).toHaveLength(2);
    expect(final.reservations).toHaveLength(2);
    expect(
      final.occurrences.every(({ status }) => status === "succeeded"),
    ).toBe(true);
  });

  it("recovers a claimed, authorized check killed before project execution without a second authority debit", async () => {
    const { root } = await fixture();
    const first = launch(root, { barrier: "before-execute" });
    await first.start();
    const barrier = await first.crash();
    expect(barrier.inProjectTransaction).toBe(false);
    expect(inspect(root)).toMatchObject({
      reviews: 0,
      checks: 0,
      usage: { runs: 1, units: 1 },
      occurrences: [{ status: "running" }],
    });
    const recovered = await resume(root);
    expect(recovered.outcome.status).toBe("succeeded");
    expect(recovered.outcome.occurrenceId).toBe(barrier.occurrence.id);
    expect(inspect(root)).toMatchObject({
      reviews: 1,
      checks: 1,
      usage: { runs: 1, units: 1 },
      occurrences: [{ status: "succeeded", fence: 2, attempt: 2 }],
      reservations: [{ status: "succeeded", units: 1 }],
      projectIntegrity: "ok",
      schedulerIntegrity: "ok",
    });
  });

  it("recovers the committed project evidence after SIGKILL before scheduler settlement and replays identically", async () => {
    const { root } = await fixture();
    const first = launch(root, { barrier: "after-project-commit" });
    await first.start();
    const committed = await first.waitFor("barrier");
    expect(committed.inProjectTransaction).toBe(false);
    // A different native connection can already see committed evidence while
    // the execution process is still alive and scheduler settlement is absent.
    expect(inspect(root)).toMatchObject({
      reviews: 1,
      checks: 1,
      occurrences: [{ status: "running" }],
      usage: { runs: 1, units: 1 },
    });
    await first.crash();
    const recovered = await resume(root);
    expect(recovered.outcome).toMatchObject({
      status: "succeeded",
      occurrenceId: committed.occurrence.id,
      result: committed.result,
    });
    const replay = await resume(root, { now: instant + 2 * leaseMs });
    expect(replay.outcome).toEqual(recovered.outcome);
    expect(inspect(root)).toMatchObject({
      reviews: 1,
      checks: 1,
      usage: { runs: 1, units: 1 },
      records: [
        {
          occurrence_id: committed.occurrence.id,
          review_id: committed.result.reviewId,
        },
      ],
      occurrences: [{ status: "succeeded", attempt: 2 }],
      reservations: [
        {
          occurrence_id: committed.occurrence.id,
          units: 1,
          status: "succeeded",
        },
      ],
      projectIntegrity: "ok",
      schedulerIntegrity: "ok",
    });
  });

  it("allows only one of two ready processes to claim the same occurrence", async () => {
    const { root } = await fixture();
    const seed = launch(root, { barrier: "before-execute" });
    await seed.start();
    const abandoned = await seed.crash();
    const claim = {
      mode: "recover-occurrence",
      occurrenceId: abandoned.occurrence.id,
      now: instant + leaseMs + 1,
      barrier: "before-execute",
    };
    const contenders = [launch(root, claim), launch(root, claim)];
    await Promise.all(contenders.map((entry) => entry.waitFor("ready")));
    await Promise.all(contenders.map((entry) => entry.send("go")));
    const announcements = await Promise.all(
      contenders.map(async (entry) => {
        // A winner waits at the adapter barrier. A loser reports busy and exits.
        const kind = await Promise.race([
          entry.waitFor("barrier").then(
            () => "winner",
            () => "closed",
          ),
          entry.waitFor("done").then(() => "done"),
        ]);
        return { entry, kind };
      }),
    );
    const winner = announcements.find(({ kind }) => kind === "winner")?.entry;
    const loser = announcements.find(({ kind }) => kind !== "winner")?.entry;
    expect(winner).toBeDefined();
    expect(loser).toBeDefined();
    const lost = await loser.finish();
    expect(lost.outcome.status).toBe("busy");
    expect(inspect(root)).toMatchObject({
      reviews: 0,
      checks: 0,
      usage: { runs: 1, units: 1 },
      occurrences: [{ status: "running", fence: 2, attempt: 2 }],
    });
    await winner.send("release");
    expect((await winner.finish()).outcome.status).toBe("succeeded");
    expect(inspect(root)).toMatchObject({
      reviews: 1,
      checks: 1,
      usage: { runs: 1, units: 1 },
      occurrences: [{ status: "succeeded", fence: 2, attempt: 2 }],
      reservations: [{ status: "succeeded", units: 1 }],
    });
  });

  it.each(["before-execute", "after-project-commit"])(
    "rejects a late old fence after another process takes over from %s",
    async (stage) => {
      const { root } = await fixture();
      const old = launch(root, { barrier: stage });
      await old.start();
      const barrier = await old.waitFor("barrier");
      const current = await resume(root);
      expect(current.outcome.status).toBe("succeeded");
      expect(current.outcome.occurrenceId).toBe(barrier.occurrence.id);
      await old.send("release");
      const late = await old.finish();
      expect(late.outcome).toMatchObject({
        thrown: { code: "SCHEDULER_LEASE_LOST" },
      });
      expect(inspect(root)).toMatchObject({
        reviews: 1,
        checks: 1,
        usage: { runs: 1, units: 1 },
        occurrences: [{ status: "succeeded", fence: 2, attempt: 2 }],
        reservations: [{ status: "succeeded" }],
      });
    },
  );

  it.each(["before-execute", "after-project-commit"])(
    "denies recovery after global policy revocation following a crash at %s",
    async (stage) => {
      const { root } = await fixture();
      const first = launch(root, { barrier: stage });
      await first.start();
      const barrier = await first.crash();
      // Revoke through the production policy API in a separate actual process.
      const revoked = await resume(root, { mode: "revoke-policy" });
      expect(revoked.outcome.enabled).toBe(false);
      const recovery = await resume(root, {
        mode: "recover-occurrence",
        occurrenceId: barrier.occurrence.id,
      });
      expect(recovery.outcome).toMatchObject({
        status: "dead_letter",
        error: {
          code: "SCHEDULER_RUNTIME_AUTHORIZATION_DENIED",
          details: { reason: "scheduler_authority_policy_required" },
        },
      });
      const completed = stage === "after-project-commit" ? 1 : 0;
      expect(inspect(root)).toMatchObject({
        reviews: completed,
        checks: completed,
        usage: { runs: 1, units: 1 },
        occurrences: [{ status: "dead_letter", fence: 2, attempt: 2 }],
        reservations: [{ units: 1, status: "failed" }],
        projectIntegrity: "ok",
        schedulerIntegrity: "ok",
      });
    },
  );

  it.each(["before-execute", "after-project-commit"])(
    "denies recovery after ownership is revoked following a crash at %s",
    async (stage) => {
      const { root } = await fixture();
      const first = launch(root, { barrier: stage });
      await first.start();
      const barrier = await first.crash();
      const project = new Database(join(root, "project.sqlite"));
      try {
        project
          .prepare("UPDATE projects SET user_id=? WHERE id='p1'")
          .run("did:chainless:revoked-owner");
      } finally {
        project.close();
      }
      const recovery = await resume(root, {
        mode: "recover-occurrence",
        occurrenceId: barrier.occurrence.id,
      });
      expect(recovery.outcome).toMatchObject({
        status: "dead_letter",
        error: { code: "SCHEDULER_RUNTIME_AUTHORIZATION_DENIED" },
      });
      const completed = stage === "after-project-commit" ? 1 : 0;
      expect(inspect(root)).toMatchObject({
        reviews: completed,
        checks: completed,
        usage: { runs: 1, units: 1 },
        occurrences: [{ status: "dead_letter" }],
        reservations: [{ units: 1, status: "failed" }],
        projectIntegrity: "ok",
        schedulerIntegrity: "ok",
      });
    },
  );
});
