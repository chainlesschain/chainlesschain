import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  createProjectGoalFeaturePolicy: policy,
} = require("../project-goal-feature-policy");
const { CHANNELS, createProjectGoalHost } = require("../project-goal-ipc");
const {
  CHANNELS: ORG_CHANNELS,
  createOrganizationProjectHost,
} = require("../organization-project-ipc");
const {
  createProjectGoalMonitoringController,
} = require("../project-goal-monitoring-host");
const { createTaskDescriptionHost } = require("../task-description-ipc");
const {
  organizationProjectFixture,
} = require("./fixtures/organization-project-host-fixture.cjs");
const owner = "did:chainless:trial-owner";
afterEach(() => vi.unstubAllEnvs());

describe("main-process continuous goal trial boundary", () => {
  it.each([undefined, "", "0", "true", "yes", "canonical", " 1 "])(
    "defaults off unless the startup value is exactly 1: %s",
    (value) => {
      vi.stubEnv("CHAINLESSCHAIN_PROJECT_GOALS", value);
      expect(policy().isEnabled()).toBe(false);
    },
  );
  it("snapshots opt-in once, fences immediately and waits for every drain", async () => {
    vi.stubEnv("CHAINLESSCHAIN_PROJECT_GOALS", "1");
    const feature = policy(),
      assertCurrent = feature.capture();
    let release;
    const drained = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    feature.subscribe(drained);
    vi.stubEnv("CHAINLESSCHAIN_PROJECT_GOALS", "0");
    expect(feature.isEnabled()).toBe(true);
    const closing = feature.disable();
    expect(feature.disable()).toBe(closing);
    expect(() => assertCurrent()).toThrow("GOAL_FEATURE_DISABLED");
    await Promise.resolve();
    expect(drained).toHaveBeenCalledTimes(1);
    release();
    await expect(closing).resolves.toEqual({ enabled: false, drained: true });
    vi.stubEnv("CHAINLESSCHAIN_PROJECT_GOALS", "1");
    expect(feature.isEnabled()).toBe(false);
  });
  it("reports drain failure while keeping every operation fenced", async () => {
    const feature = policy({ enabled: true }),
      second = vi.fn();
    feature.subscribe(() => {
      throw new Error("could not drain");
    });
    feature.subscribe(second);
    await expect(feature.disable()).rejects.toThrow(
      "GOAL_FEATURE_DRAIN_FAILED",
    );
    expect(second).toHaveBeenCalledOnce();
    expect(() => feature.capture()).toThrow("GOAL_FEATURE_DISABLED");
  });
  it("uses a default-off singleton even in a host with canonical Graph selected", () => {
    const env = {
      ...process.env,
      CHAINLESSCHAIN_GRAPH_PROJECT_GOALS: "canonical",
    };
    delete env.CHAINLESSCHAIN_PROJECT_GOALS;
    const result = execFileSync(
      process.execPath,
      [
        "-e",
        `
      const feature = require(${JSON.stringify(require.resolve("../project-goal-feature-policy"))}).projectGoalFeaturePolicy;
      process.env.CHAINLESSCHAIN_PROJECT_GOALS = '1';
      process.stdout.write(JSON.stringify(feature.status()));
    `,
      ],
      { env, encoding: "utf8" },
    );
    expect(JSON.parse(result)).toEqual({
      enabled: false,
      startupOptInRequired: true,
    });
  });
  it("refuses all personal feature IPC before touching a database, with cleanup still available", async () => {
    const getDatabase = vi.fn(() => {
      throw new Error("must not open");
    });
    const controller = { initialize: vi.fn(), close: vi.fn() };
    const host = createProjectGoalHost({
      database: { getDatabase },
      featurePolicy: policy({ enabled: false }),
      monitoringController: controller,
      electron: {
        BrowserWindow: {
          fromWebContents: () => ({ isDestroyed: () => false }),
        },
      },
      validateSender: () => ({ trusted: true }),
    });
    const event = { sender: {} };
    try {
      for (const method of Object.keys(CHANNELS)) {
        if (
          [
            "featureStatus",
            "closeCliConnection",
            "cliConnectionStatus",
          ].includes(method)
        ) {
          continue;
        }
        await expect(
          Promise.resolve().then(() => host[method](event, {})),
        ).rejects.toThrow("GOAL_FEATURE_DISABLED");
      }
      expect(host.featureStatus(event).enabled).toBe(false);
      expect(host.closeCliConnection(event).enabled).toBe(false);
      expect(host.cliConnectionStatus(event).enabled).toBe(false);
      expect(await host.initializeMonitoring()).toBeNull();
      expect(getDatabase).not.toHaveBeenCalled();
      expect(controller.initialize).not.toHaveBeenCalled();
    } finally {
      await host.close();
    }
  });
  it("refuses every organization goal IPC and its startup scheduler before opening storage", async () => {
    const getDatabase = vi.fn(() => {
      throw new Error("must not open");
    });
    const controller = { initialize: vi.fn(), close: vi.fn() };
    const host = createOrganizationProjectHost({
      database: { getDatabase },
      featurePolicy: policy({ enabled: false }),
      electron: {},
      goalMonitoringController: controller,
    });
    try {
      for (const [method, channel] of Object.entries(ORG_CHANNELS)) {
        if (!channel.startsWith("organization-project:goal-")) {
          continue;
        }
        await expect(
          Promise.resolve().then(() => host[method]({}, {})),
        ).rejects.toThrow("GOAL_FEATURE_DISABLED");
      }
      expect(await host.initializeMonitoring()).toBeNull();
      expect(controller.initialize).not.toHaveBeenCalled();
      expect(getDatabase).not.toHaveBeenCalled();
    } finally {
      await host.close();
    }
  });
  it("does not initialize scheduler, Graph or ACL storage while off", async () => {
    const getDatabase = vi.fn(),
      engineFactory = vi.fn(),
      protectDirectory = vi.fn();
    const controller = createProjectGoalMonitoringController({
      database: { getDatabase },
      engineFactory,
      protectDirectory,
      featurePolicy: policy({ enabled: false }),
    });
    try {
      expect(await controller.initialize()).toBeNull();
      expect(getDatabase).not.toHaveBeenCalled();
      expect(engineFactory).not.toHaveBeenCalled();
      expect(protectDirectory).not.toHaveBeenCalled();
    } finally {
      await controller.close();
    }
  });
  it("drains a real native scheduler and retains goals and task rows", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cc-goal-trial-drain-"));
    const db = new Database(join(directory, "project.sqlite"));
    const feature = policy({ enabled: true });
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT);
      INSERT INTO projects VALUES('p1','${owner}','active',10,0);`);
    const controller = createProjectGoalMonitoringController({
      database: db,
      featurePolicy: feature,
      getCurrentUserDid: () => owner,
      electron: { app: { getPath: () => directory } },
      protectDirectory: (target) => {
        mkdirSync(target, { recursive: true });
        return target;
      },
      protectFile: (target) => target,
    });
    try {
      const engine = await controller.initialize();
      const goal = engine.state.goals.create({
        projectId: "p1",
        objective: "Retain history",
      });
      await engine.start({
        id: goal.id,
        expectedRevision: 1,
        intervalMs: 60000,
      });
      const retained = db.prepare("SELECT * FROM cc_project_goals").all();
      const schedulerFile = engine.store.file;
      await expect(feature.disable()).resolves.toMatchObject({ drained: true });
      expect(engine.store.db.open).toBe(false);
      expect(existsSync(schedulerFile)).toBe(true);
      expect(db.prepare("SELECT * FROM cc_project_goals").all()).toEqual(
        retained,
      );
      expect(db.open).toBe(true);
      expect(() => controller.initialize()).toThrow("GOAL_MONITOR_HOST_CLOSED");
    } finally {
      await controller.close();
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("preserves personal task writes and retained goal history across an off-mode restart", async () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
      INSERT INTO projects VALUES('p1','${owner}','active',10,0);`);
    const event = {
      sender: {},
      senderFrame: { url: "http://localhost:5173", parent: null },
    };
    const electron = {
      BrowserWindow: { fromWebContents: () => ({ isDestroyed: () => false }) },
      dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
    };
    const common = {
      database: db,
      electron,
      getCurrentUserDid: () => owner,
      monitoringController: { close: vi.fn() },
    };
    let host = createProjectGoalHost({
      ...common,
      featurePolicy: policy({ enabled: true }),
    });
    try {
      const goal = host.create(event, {
        projectId: "p1",
        objective: "Retained goal",
      });
      await host.close();
      host = createProjectGoalHost({
        ...common,
        featurePolicy: policy({ enabled: false }),
      });
      const before = db.prepare("SELECT * FROM cc_project_goals").all();
      expect(() => host.read(event, { id: goal.id })).toThrow(
        "GOAL_FEATURE_DISABLED",
      );
      const tasks = createTaskDescriptionHost(common);
      const prepared = tasks.previewCreate(event, {
        projectId: "p1",
        taskType: "query_info",
        description: "Ordinary off-mode task",
        idempotencyKey: "off-task",
      });
      expect(
        (await tasks.executeCreate(event, { request: prepared.request })).run
          .status,
      ).toBe("succeeded");
      expect(tasks.listTasks(event, { projectId: "p1" }).tasks).toHaveLength(1);
      expect(db.prepare("SELECT * FROM cc_project_goals").all()).toEqual(
        before,
      );
      await host.close();
      host = createProjectGoalHost({
        ...common,
        featurePolicy: policy({ enabled: true }),
      });
      expect(host.read(event, { id: goal.id })).toEqual(goal);
    } finally {
      await host.close();
      db.close();
    }
  });
  it("keeps ordinary organization approval and task execution usable while goals are off", async () => {
    const f = organizationProjectFixture(
      vi.fn(async () => ({ response: 1 })),
      { featurePolicy: policy({ enabled: false }) },
    );
    try {
      const { workflowIds } = await f.setup();
      f.setActor(f.identities.requester);
      const prepared = f.host.previewDescription(f.event, {
        taskId: "t1",
        description: "Off-mode approved edit",
        idempotencyKey: "off-edit",
      });
      const proposal = f.host.submitProposal(f.event, {
        projectId: "p1",
        workflowId: workflowIds[0],
        request: prepared.request,
      });
      for (const [step, actor] of [
        f.identities.first,
        f.identities.second,
      ].entries()) {
        f.setActor(actor);
        await f.host.respondProposal(f.event, {
          proposalId: proposal.proposalId,
          step,
          decision: "approve",
        });
      }
      f.setActor(f.identities.requester);
      const receipt = await f.host.executeProposal(f.event, {
        proposalId: proposal.proposalId,
      });
      expect(receipt.run.status).toBe("succeeded");
      expect(
        f.db
          .prepare("SELECT description FROM project_tasks WHERE id='t1'")
          .get().description,
      ).toBe("Off-mode approved edit");
      expect(
        f.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='cc_organization_project_goals'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      await f.host.close();
      f.db.close();
    }
  });
});
