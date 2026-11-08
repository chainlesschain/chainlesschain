import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  createGoal,
  freezeGoalForProject,
  getGoal,
  restoreTransferredGoal,
} from "../../src/lib/goal-store.js";
const require = createRequire(import.meta.url),
  Database = require("better-sqlite3");
const {
  ProjectGoalTransferService,
} = require("@chainlesschain/session-core/project-goal-transfer");
const fixture = fileURLToPath(
  new URL("../fixtures/dmm-goal-transfer-process.mjs", import.meta.url),
);
describe("goal handoff real-process crash and concurrent native commits", () => {
  let root, db, service, goal, target, raw, children;
  const file = (name) => path.join(root, name);
  const packet = () =>
    JSON.parse(fs.readFileSync(file("transfer.json"), "utf8"));
  const freeze = () =>
    freezeGoalForProject(
      goal.id,
      { target, output: file("transfer.json"), expectedRevision: 1 },
      { root },
    );
  function launch(mode) {
    const child = fork(fixture, [root, mode, goal.id], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
      execArgv: [],
    });
    const worker = {
      child,
      output: "",
      error: "",
      closed: false,
      result: null,
    };
    worker.done = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        worker.closed = true;
        worker.result = { code, signal };
        resolve(worker.result);
      });
    });
    child.stdout.on("data", (v) => {
      worker.output = (worker.output + v).slice(-16384);
    });
    child.stderr.on("data", (v) => {
      worker.error = (worker.error + v).slice(-16384);
    });
    children.push(worker);
    return worker;
  }
  async function checkpoint(worker) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const barrier = file(`barrier-${worker.child.pid}`);
      if (fs.existsSync(barrier)) {
        expect(worker.closed).toBe(false);
        return JSON.parse(fs.readFileSync(barrier, "utf8"));
      }
      if (worker.closed)
        throw new Error(`Unexpected worker exit ${worker.error}`);
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`Missing live process checkpoint: ${worker.error}`);
  }
  async function kill(worker) {
    expect(worker.closed).toBe(false);
    expect(worker.child.kill("SIGKILL")).toBe(true);
    await worker.done;
    expect(worker.closed).toBe(true);
  }
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-goal-handoff-process-"));
    children = [];
    db = new Database(file("project.db"));
    db.pragma("journal_mode = WAL");
    db.exec(
      "CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0)",
    );
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p1",
      "did:chainless:owner",
      "active",
      10,
    );
    service = new ProjectGoalTransferService({
      db,
      getActor: () => "did:chainless:owner",
    });
    goal = createGoal(
      { objective: "Transfer a goal across actual process exits" },
      { root },
    );
    raw = fs.readFileSync(file(`${goal.id}.json`), "utf8");
    target = service.prepare({
      projectId: "p1",
      requestId: "process-transfer",
    }).target;
    fs.writeFileSync(file("target.json"), JSON.stringify(target));
  });
  afterEach(async () => {
    for (const worker of children) {
      if (!worker.closed) worker.child.kill("SIGKILL");
      await worker.done;
    }
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  it("recovers after SIGKILL between durable freeze and source rename", async () => {
    const worker = launch("freeze-journal");
    expect(await checkpoint(worker)).toEqual({ phase: "frozen-journal" });
    expect(fs.readFileSync(file(`${goal.id}.json`), "utf8")).toBe(raw);
    expect(getGoal(goal.id, { root })).toBeNull();
    expect(fs.existsSync(file("transfer.json"))).toBe(false);
    await kill(worker);
    expect(freeze().state).toBe("frozen");
    expect(service.importTransfer(packet()).state).toBe("imported");
    expect(fs.existsSync(file(`${goal.id}.json`))).toBe(false);
  });
  it("looks up the original imported mapping after a committed child dies before returning it", async () => {
    freeze();
    const worker = launch("import"),
      barrier = await checkpoint(worker);
    const rows = db.prepare("SELECT id FROM cc_project_goals").all();
    expect(rows).toEqual([{ id: barrier.goalId }]);
    await kill(worker);
    expect(service.importTransfer(packet()).goal.id).toBe(barrier.goalId);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM cc_project_goals").get().n,
    ).toBe(1);
  });
  it("recovers durable cancellation after SIGKILL before receipt export", async () => {
    freeze();
    service.importTransfer(packet());
    const worker = launch("cancel"),
      barrier = await checkpoint(worker);
    expect(service.status({ targetId: target.id })).toMatchObject({
      state: "cancelled",
      cancellation: barrier.cancellation,
    });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM cc_project_goals").get().n,
    ).toBe(0);
    expect(getGoal(goal.id, { root })).toBeNull();
    await kill(worker);
    const cancelled = service.cancel({ targetId: target.id });
    restoreTransferredGoal(goal.id, cancelled.cancellation, { root });
    expect(fs.readFileSync(file(`${goal.id}.json`), "utf8")).toBe(raw);
    expect(() => service.importTransfer(packet())).toThrow(
      "GOAL_TRANSFER_CANCELLED",
    );
  });
  it("keeps restored bytes hidden until source restoration is durably published", async () => {
    freeze();
    service.cancel({ targetId: target.id });
    const worker = launch("restore");
    expect(await checkpoint(worker)).toEqual({ phase: "restored-bytes" });
    expect(fs.readFileSync(file(`${goal.id}.json`), "utf8")).toBe(raw);
    expect(getGoal(goal.id, { root })).toBeNull();
    await kill(worker);
    restoreTransferredGoal(
      goal.id,
      service.status({ targetId: target.id }).cancellation,
      { root },
    );
    expect(getGoal(goal.id, { root })).toEqual(goal);
  });
  it("serializes two native importing processes to one goal and mapping", async () => {
    freeze();
    const first = launch("import-once"),
      second = launch("import-once");
    const results = await Promise.all([first.done, second.done]);
    expect(results).toEqual([
      { code: 0, signal: null },
      { code: 0, signal: null },
    ]);
    expect(JSON.parse(first.output).goal.id).toBe(
      JSON.parse(second.output).goal.id,
    );
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM cc_project_goals").get().n,
    ).toBe(1);
    expect(service.status({ targetId: target.id }).state).toBe("imported");
  });
});
