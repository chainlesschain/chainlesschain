// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter, once } from "node:events";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProjectGoalConnection } from "../../../../../packages/cli/src/lib/project-goal-connection.js";
const require = createRequire(import.meta.url),
  Database = require("better-sqlite3");
const { createProjectGoalHost } = require("../project-goal-ipc.js");
const {
  ProjectGoalMonitoringState,
} = require("@chainlesschain/session-core/project-goal-monitoring");
let directory,
  db,
  host,
  goal,
  event,
  electron,
  file,
  actor,
  now,
  state,
  requestId;
const ref = () => ({
  id: goal.id,
  storeId: goal.storeId,
  revision: goal.revision,
  controlGeneration: goal.controlGeneration,
});
function makeHost() {
  return createProjectGoalHost({
    database: { getDatabase: () => db },
    electron,
    getCurrentUserDid: () => actor,
    getAuthenticationGeneration: () => 1,
    validateSender: () => ({ trusted: true }),
    clock: () => now,
    monitoringController: { close: vi.fn(async () => {}) },
  });
}
function check() {
  const id = `history-${++requestId}`;
  now += 100;
  state.prepareManual(
    { id: goal.id, expectedRevision: goal.revision, requestId: id },
    () => 1,
  );
  return state.perform(
    {
      occurrence: {
        id,
        payload: {
          storeId: goal.storeId,
          goalId: goal.id,
          goalRevision: goal.revision,
          controlGeneration: goal.controlGeneration,
          monitorRevision: null,
          schedulerPolicyRevision: 1,
          requestId: id,
        },
      },
      renewLease: () => {},
      signal: { aborted: false },
    },
    () => {},
  );
}
async function open() {
  await host.openCliConnection(event, { goalRef: ref(), eventHistory: true });
  return createProjectGoalConnection(file);
}
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-history-bridge-"));
  actor = "did:chainless:owner";
  now = Date.now();
  requestId = 0;
  db = new Database(path.join(directory, "project.sqlite"));
  const parent = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
  });
  event = {
    sender: new EventEmitter(),
    senderFrame: { url: "http://localhost:5173", parent: null },
  };
  file = path.join(directory, "goal-connections", "history.json");
  electron = {
    app: { getPath: () => directory },
    BrowserWindow: { fromWebContents: () => parent },
    dialog: {
      showMessageBox: vi.fn(async () => ({ response: 1 })),
      showSaveDialog: vi.fn(async () => ({ filePath: file, canceled: false })),
    },
  };
  host = makeHost();
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
 CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
 INSERT INTO projects VALUES('p1','${actor}','active',10,0);
 INSERT INTO project_tasks VALUES('t1','p1','query_info','PRIVATE BODY','pending',10,10,0,'synced',20,NULL);`);
  goal = host.create(event, {
    projectId: "p1",
    objective: "PRIVATE OBJECTIVE",
    budgetPolicy: { maxRuns: 200 },
  });
  state = new ProjectGoalMonitoringState({
    db,
    getActor: () => actor,
    clock: () => now,
  });
});
afterEach(async () => {
  await host.close();
  vi.restoreAllMocks();
  if (db.open) db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
describe(
  "separately authorized persistent goal history",
  { timeout: 180000 },
  () => {
    it("reads retained history with zero database writes and resumes through a newly authorized connection after restart", async () => {
      const ids = [];
      for (let i = 0; i < 25; i++) ids.push(check().reviewId);
      const source = await open();
      const descriptor = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(descriptor).toMatchObject({
        schema: "chainlesschain.project-goal-connection/v5",
        capability: "goal.event-history",
      });
      expect(
        electron.dialog.showMessageBox.mock.calls.at(-1)[1].detail,
      ).toContain("最近1000条");
      const changes = db.prepare("SELECT total_changes() AS n").get().n;
      db.pragma("query_only=ON");
      const first = await source.readEventPage();
      expect(first.entries.map((x) => x.sourceId)).toEqual(ids.slice(0, 20));
      expect(db.prepare("SELECT total_changes() AS n").get().n).toBe(changes);
      db.pragma("query_only=OFF");
      expect(JSON.stringify(first)).not.toMatch(
        /PRIVATE|actor_did|secret|signature/,
      );
      await expect(source.read()).rejects.toThrow("CONNECTION_UNAVAILABLE");
      await host.close();
      db.close();
      db = new Database(path.join(directory, "project.sqlite"));
      host = makeHost();
      file = path.join(directory, "goal-connections", "reconnected.json");
      const resumed = await open(),
        second = await resumed.readEventPage(first.nextCursor);
      expect(second.entries.map((x) => x.sourceId)).toEqual(ids.slice(20));
      expect(second.hasMore).toBe(false);
      await expect(source.readEventPage(first.nextCursor)).rejects.toThrow(
        "CONNECTION_UNAVAILABLE",
      );
    });
    it("does not expand v4 authorization and rejects combined history modes before native confirmation", async () => {
      await host.openCliConnection(event, { goalRef: ref(), events: true });
      const old = createProjectGoalConnection(file);
      expect(old.eventHistory).not.toBe(true);
      const before = electron.dialog.showMessageBox.mock.calls.length;
      for (const mode of [
        { eventHistory: true, events: true },
        { eventHistory: true, drafts: true },
        { eventHistory: "yes" },
      ])
        await expect(
          host.openCliConnection(event, { goalRef: ref(), ...mode }),
        ).rejects.toThrow("BRIDGE_UNAVAILABLE");
      expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(before);
    });
    it("returns authenticated cursor errors without destroying the valid history lease", async () => {
      check();
      const source = await open(),
        first = await source.readEventPage();
      const token = JSON.parse(
        Buffer.from(first.nextCursor, "base64url").toString(),
      );
      token.signature = "0".repeat(64);
      const changed = Buffer.from(JSON.stringify(token)).toString("base64url");
      await expect(source.readEventPage(changed)).rejects.toMatchObject({
        code: "GOAL_EVENT_CURSOR_INVALID",
      });
      expect(host.cliConnectionStatus(event).enabled).toBe(true);
      expect((await source.readEventPage()).entries[0].id).toBe(
        first.entries[0].id,
      );
      event.sender.emit("did-navigate-in-page");
      await expect(source.readEventPage(first.nextCursor)).rejects.toThrow(
        "CONNECTION_UNAVAILABLE",
      );
    });
    it("runs real CLI replay and recovers the same page after a child dies following output but before checkpoint commit", async () => {
      for (let i = 0; i < 25; i++) check();
      await open();
      const workspace = path.join(directory, "workspace");
      fs.mkdirSync(workspace);
      const cliRoot = pathToFileURL(
        path.resolve(__dirname, "../../../../../packages/cli") + path.sep,
      );
      const bootstrap = path.join(directory, "security-stores.mjs"),
        marker = path.join(directory, "after-output.marker");
      fs.writeFileSync(
        bootstrap,
        `import fs from 'node:fs';
import { _deps as trust } from ${JSON.stringify(new URL("src/lib/plugin-runtime/trust.js", cliRoot).href)};
import { _deps as consent } from ${JSON.stringify(new URL("src/lib/plugin-runtime/capability-consent.js", cliRoot).href)};
import { _deps as replay } from ${JSON.stringify(new URL("src/lib/plugin-runtime/cli-goal-event-history.js", cliRoot).href)};
trust.storePath=()=>process.env.DMM_TEST_TRUST_FILE;
trust.workspaceTrustStorePath=()=>process.env.DMM_TEST_WORKSPACE_TRUST_FILE;
consent.storePath=()=>process.env.DMM_TEST_CONSENT_FILE;
if(process.env.DMM_TEST_OUTPUT_MARKER){const create=replay.createProjectGoalConnection;replay.createProjectGoalConnection=(...args)=>{const source=create(...args);let reads=0;return {...source,async readEventPage(...input){const value=await source.readEventPage(...input);if(++reads===3){fs.writeFileSync(process.env.DMM_TEST_OUTPUT_MARKER,'output-acknowledged');await new Promise(()=>setInterval(()=>{},1000));}return value;}};};}
`,
      );
      const env = {
        ...process.env,
        CHAINLESSCHAIN_HOME: path.join(directory, "home"),
        CC_PLUGINS: "1",
        CC_PLUGIN_SCOPES: "project",
        CC_PLUGIN_TRANSACTION_HOME: path.join(directory, "transactions"),
        CC_MANAGED_SETTINGS: path.join(directory, "no-policy.json"),
        DMM_TEST_TRUST_FILE: path.join(directory, "trust.json"),
        DMM_TEST_WORKSPACE_TRUST_FILE: path.join(
          directory,
          "workspace-trust.json",
        ),
        DMM_TEST_CONSENT_FILE: path.join(directory, "consent.json"),
      };
      const bin = fileURLToPath(new URL("bin/chainlesschain.js", cliRoot)),
        prefix = ["--import", pathToFileURL(bootstrap).href, bin];
      async function cli(...args) {
        return promisify(execFile)(process.execPath, [...prefix, ...args], {
          cwd: workspace,
          env,
          encoding: "utf8",
          windowsHide: true,
          timeout: 30000,
        });
      }
      const sample = fileURLToPath(
        new URL(
          "src/lib/plugin-runtime/examples/goal-project-observer",
          cliRoot,
        ),
      );
      await cli("plugin", "add", sample, "--scope", "project", "--json");
      await cli(
        "plugin",
        "trust",
        "goal-project-observer",
        "--scope",
        "project",
      );
      await cli(
        "plugin",
        "consent",
        "goal-project-observer",
        "--scope",
        "project",
        "--grant",
        "--json",
      );
      const checkpoint = path.join(directory, "checkpoint.json"),
        args = [
          "goal",
          "replay",
          goal.id,
          "--connection",
          file,
          "--checkpoint",
          checkpoint,
          "--plugin",
          "goal-project-observer",
          "--scope",
          "project",
          "--json",
        ];
      const child = spawn(process.execPath, [...prefix, ...args], {
        cwd: workspace,
        env: { ...env, DMM_TEST_OUTPUT_MARKER: marker },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const closed = once(child, "close");
      let output = "",
        stderr = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      try {
        await vi.waitFor(
          () => {
            expect(fs.existsSync(marker), stderr).toBe(true);
          },
          { timeout: 15000, interval: 25 },
        );
        expect(child.exitCode).toBeNull();
        expect(
          JSON.parse(fs.readFileSync(checkpoint, "utf8")).after,
        ).toBeNull();
        const emitted = JSON.parse(output);
        expect(emitted.entries).toHaveLength(20);
        child.kill("SIGKILL");
        await closed;
        expect(
          JSON.parse(fs.readFileSync(checkpoint, "utf8")).after,
        ).toBeNull();
        const replayed = JSON.parse((await cli(...args)).stdout);
        expect(replayed.entries.map((x) => x.id)).toEqual(
          emitted.entries.map((x) => x.id),
        );
        expect(JSON.parse(fs.readFileSync(checkpoint, "utf8")).after).toBe(
          replayed.nextCursor,
        );
        const remaining = JSON.parse((await cli(...args)).stdout);
        expect(remaining.entries.map((x) => x.sequence)).toEqual([
          21, 22, 23, 24, 25,
        ]);
        expect(
          JSON.stringify(JSON.parse(fs.readFileSync(checkpoint, "utf8"))),
        ).not.toMatch(/PRIVATE|summary|"key"|endpoint|connection/);
      } finally {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
        await closed;
      }
    });
  },
);
