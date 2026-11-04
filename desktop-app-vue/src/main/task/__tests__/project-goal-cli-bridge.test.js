// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHmac, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createProjectGoalConnection,
  readProjectGoalCatalog,
} from "../../../../../packages/cli/src/lib/project-goal-connection.js";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { createProjectGoalHost } = require("../project-goal-ipc.js");
const {
  inspectPrivatePath,
} = require("@chainlesschain/session-core/private-storage");
const { clearProjectGoalAuth } = require("../project-goal-auth-session.js");
let dir, db, host, goal, event, parent, electron, actor, generation, now, file;
const owner = "did:chainless:owner";
const ref = () => ({
  id: goal.id,
  storeId: goal.storeId,
  revision: goal.revision,
  controlGeneration: goal.controlGeneration,
});
const open = () => host.openCliConnection(event, { goalRef: ref() });
const descriptor = () => JSON.parse(fs.readFileSync(file, "utf8"));
function request(
  data,
  {
    method = "GET",
    pathname = "/goal-summary",
    headers = {},
    nonce = randomBytes(32).toString("hex"),
  } = {},
) {
  const signature = createHmac("sha256", Buffer.from(data.key, "hex"))
    .update(`request\nGET\n${new URL(data.endpoint).pathname}\n${nonce}`)
    .digest("hex");
  return new Promise((resolve, reject) => {
    const req = http.request(
      new URL(pathname, data.endpoint),
      {
        method,
        agent: false,
        headers: {
          "X-CC-Nonce": nonce,
          "X-CC-Signature": signature,
          ...headers,
        },
      },
      (response) => {
        let text = "";
        response.on("data", (b) => (text += b));
        response.on("end", () =>
          resolve({ status: response.statusCode, text }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-project-cli-bridge-"));
  file = path.join(dir, "goal-connections", "connection.json");
  actor = owner;
  generation = 1;
  now = Date.now();
  db = new Database(path.join(dir, "project.sqlite"));
  parent = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  event = {
    sender: new EventEmitter(),
    senderFrame: { url: "http://localhost:5173", parent: null },
  };
  electron = {
    app: { getPath: () => dir },
    BrowserWindow: { fromWebContents: () => parent },
    dialog: {
      showMessageBox: vi.fn(async () => ({ response: 1 })),
      showSaveDialog: vi.fn(async () => ({ filePath: file, canceled: false })),
    },
  };
  host = createProjectGoalHost({
    database: { getDatabase: () => db },
    electron,
    getCurrentUserDid: () => actor,
    getAuthenticationGeneration: () => generation,
    validateSender: () => ({ trusted: true }),
    clock: () => now,
    monitoringController: { close: vi.fn(async () => {}) },
  });
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
    INSERT INTO projects VALUES('p1','${owner}','active',10,0);`);
  goal = host.create(event, {
    projectId: "p1",
    objective: "Private delivery objective",
  });
});
afterEach(async () => {
  await host.close();
  vi.restoreAllMocks();
  if (db.open) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
// Real Windows DACL operations launch PowerShell and exceed the ordinary 30s
// host-test budget on this machine. This is functional validation, not an SLO.
describe("explicit desktop goal connection", { timeout: 90_000 }, () => {
  it("separately authorizes events, restricts its routes, and observes real checks and action receipts without read writes", async () => {
    const {
      ProjectGoalMonitoringState,
    } = require("@chainlesschain/session-core/project-goal-monitoring");
    db.exec(`CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
      INSERT INTO project_tasks VALUES('t1','p1','query_info','PRIVATE BODY','pending',10,10,0,'synced',20,NULL);`);
    goal = host.revise(event, {
      id: goal.id,
      expectedRevision: goal.revision,
      patch: { allowedActionTypes: ["task.update-description"] },
    });
    const state = new ProjectGoalMonitoringState({
      db,
      getActor: () => actor,
      clock: () => now,
    });
    function check(requestId) {
      state.prepareManual(
        { id: goal.id, expectedRevision: goal.revision, requestId },
        () => 1,
      );
      return state.perform(
        {
          occurrence: {
            id: requestId,
            payload: {
              storeId: goal.storeId,
              goalId: goal.id,
              goalRevision: goal.revision,
              controlGeneration: goal.controlGeneration,
              monitorRevision: null,
              schedulerPolicyRevision: 1,
              requestId,
            },
          },
          renewLease: () => {},
          signal: { aborted: false },
        },
        () => {},
      );
    }
    await open();
    const old = descriptor();
    expect((await request(old, { pathname: "/goal-events" })).status).toBe(403);
    const oldFile = file;
    file = path.join(dir, "goal-connections", "events.json");
    await host.openCliConnection(event, { goalRef: ref(), events: true });
    expect(descriptor()).toMatchObject({
      schema: "chainlesschain.project-goal-connection/v4",
      capability: "goal.events",
    });
    expect(
      electron.dialog.showMessageBox.mock.calls.at(-1)[1].detail,
    ).toContain("没有历史重放");
    const source = createProjectGoalConnection(file);
    expect(source.events).toBe(true);
    await expect(source.read()).rejects.toThrow("CONNECTION_UNAVAILABLE");
    await expect(readProjectGoalCatalog({ connection: file })).rejects.toThrow(
      "CONNECTION_UNAVAILABLE",
    );
    for (const pathname of [
      "/goal-summary",
      "/goal-evidence",
      "/goal-drafts",
      "/goal-events?goal=other",
    ])
      expect((await request(descriptor(), { pathname })).status).toBe(403);
    expect(
      (
        await request(descriptor(), {
          pathname: "/goal-events",
          method: "POST",
        })
      ).status,
    ).toBe(403);
    const nonce = "a".repeat(64);
    expect(
      (await request(descriptor(), { pathname: "/goal-events", nonce })).status,
    ).toBe(200);
    expect(
      (await request(descriptor(), { pathname: "/goal-events", nonce })).status,
    ).toBe(429);

    const cliRoot = pathToFileURL(
      path.resolve(__dirname, "../../../../../packages/cli") + path.sep,
    );
    const { watchCliProjectGoalEvents } = await import(
      "../../../../../packages/cli/src/lib/plugin-runtime/cli-project-goal-events.js"
    );
    const { trustPlugin, _deps: trustDeps } = await import(
      "../../../../../packages/cli/src/lib/plugin-runtime/trust.js"
    );
    const { consentPluginCapabilities, _deps: consentDeps } = await import(
      "../../../../../packages/cli/src/lib/plugin-runtime/capability-consent.js"
    );
    const { normalizeCapabilities } = await import(
      "../../../../../packages/cli/src/lib/plugin-runtime/capabilities.js"
    );
    const sample = JSON.parse(
      fs.readFileSync(
        new URL(
          "src/lib/plugin-runtime/examples/goal-project-observer/plugin.json",
          cliRoot,
        ),
        "utf8",
      ),
    );
    const cwd = path.join(dir, "events-workspace"),
      pluginDir = path.join(cwd, ".chainlesschain", "plugins", sample.name);
    fs.mkdirSync(path.join(pluginDir, sample.version), { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, sample.version, "plugin.json"),
      JSON.stringify(sample),
    );
    fs.writeFileSync(path.join(pluginDir, ".active"), sample.version);
    vi.spyOn(trustDeps, "storePath").mockReturnValue(
      path.join(dir, "trust.json"),
    );
    vi.spyOn(trustDeps, "workspaceTrustStorePath").mockReturnValue(
      path.join(dir, "workspace-trust.json"),
    );
    vi.spyOn(consentDeps, "storePath").mockReturnValue(
      path.join(dir, "consent.json"),
    );
    const options = {
      cwd,
      connection: file,
      plugin: sample.name,
      scope: "project",
      intervalMs: 250,
      durationMs: 60000,
      managedSettingsFile: path.join(dir, "managed.json"),
      env: {
        ...process.env,
        CC_PLUGINS: "1",
        CC_PLUGIN_SCOPES: "project",
        CC_PLUGIN_TRANSACTION_HOME: path.join(dir, "transactions"),
      },
    };
    trustPlugin(sample.name, {
      scope: "project",
      version: sample.version,
      workspaceRoot: cwd,
    });
    consentPluginCapabilities(sample.name, {
      scope: "project",
      version: sample.version,
      capabilities: normalizeCapabilities(sample.permissions),
    });
    await expect(
      watchCliProjectGoalEvents(goal.id, {
        ...options,
        connection: oldFile,
      }).next(),
    ).rejects.toThrow("EVENT_CONNECTION_REQUIRED");
    const stream = watchCliProjectGoalEvents(goal.id, options);
    try {
      const writes = db.prepare("SELECT total_changes() AS n").get().n;
      db.pragma("query_only=ON");
      const ready = (await stream.next()).value;
      expect(ready).toMatchObject({
        kind: "ready",
        source: "desktop-project",
        goalRef: ref(),
      });
      expect(db.prepare("SELECT total_changes() AS n").get().n).toBe(writes);
      db.pragma("query_only=OFF");
      const checked = check("event-check-1");
      const afterCheck = db.prepare("SELECT total_changes() AS n").get().n;
      db.pragma("query_only=ON");
      const riskEvent = (await stream.next()).value;
      expect(riskEvent.event.type).toBe("risk.review.completed");
      expect(riskEvent.event.summary).toContain(checked.reviewId);
      expect(db.prepare("SELECT total_changes() AS n").get().n).toBe(
        afterCheck,
      );
      db.pragma("query_only=OFF");
      const proposal = host
        .proposals(event, { goalId: goal.id })
        .proposals.find(
          (item) => item.proposal.actionType === "task.update-description",
        ).proposal;
      const prepared = host.prepareIntent(event, {
        goalId: goal.id,
        proposalId: proposal.id,
        expectedRevision: goal.revision,
        requestId: "event-action-1",
        description: "PRIVATE ACTION BODY",
      });
      const executed = await host.executeIntent(event, {
        intentId: prepared.intent.id,
      });
      const afterAction = db.prepare("SELECT total_changes() AS n").get().n;
      db.pragma("query_only=ON");
      const actionEvent = (await stream.next()).value;
      expect(actionEvent.event.type).toBe("action.receipt.updated");
      expect(actionEvent.event.summary).toContain(executed.run.id);
      const snapshot = await source.readEvents();
      expect(Object.keys(snapshot).sort()).toEqual([
        "goalRef",
        "receipts",
        "risk",
        "schema",
      ]);
      expect(
        JSON.stringify([ready, riskEvent, actionEvent, snapshot]),
      ).not.toMatch(
        /PRIVATE BODY|PRIVATE ACTION BODY|Private delivery objective|approvalRef|preview/,
      );
      expect(db.prepare("SELECT total_changes() AS n").get().n).toBe(
        afterAction,
      );
      await stream.return();
      db.pragma("query_only=OFF");
      // Exercise the real CLI dispatcher, redirecting only security storage.
      const bootstrap = path.join(dir, "event-security-stores.mjs");
      fs.writeFileSync(
        bootstrap,
        `import { _deps as trust } from ${JSON.stringify(new URL("src/lib/plugin-runtime/trust.js", cliRoot).href)};
import { _deps as consent } from ${JSON.stringify(new URL("src/lib/plugin-runtime/capability-consent.js", cliRoot).href)};
trust.storePath=()=>process.env.DMM_TEST_TRUST_FILE;
trust.workspaceTrustStorePath=()=>process.env.DMM_TEST_WORKSPACE_TRUST_FILE;
consent.storePath=()=>process.env.DMM_TEST_CONSENT_FILE;`,
      );
      const execution = promisify(execFile)(
        process.execPath,
        [
          "--import",
          pathToFileURL(bootstrap).href,
          fileURLToPath(new URL("bin/chainlesschain.js", cliRoot)),
          "goal",
          "watch",
          goal.id,
          "--connection",
          file,
          "--expected-store",
          goal.storeId,
          "--plugin",
          sample.name,
          "--scope",
          "project",
          "--interval",
          "250",
          "--duration",
          "15",
          "--json",
        ],
        {
          cwd,
          env: {
            ...options.env,
            CHAINLESSCHAIN_HOME: path.join(dir, "home"),
            CC_MANAGED_SETTINGS: options.managedSettingsFile,
            DMM_TEST_TRUST_FILE: path.join(dir, "trust.json"),
            DMM_TEST_WORKSPACE_TRUST_FILE: path.join(
              dir,
              "workspace-trust.json",
            ),
            DMM_TEST_CONSENT_FILE: path.join(dir, "consent.json"),
          },
          encoding: "utf8",
          windowsHide: true,
          timeout: 30000,
        },
      );
      const completion = execution.then(
        (result) => ({ code: 0, ...result }),
        (failure) => ({
          code: failure.code,
          stdout: failure.stdout,
          stderr: failure.stderr,
        }),
      );
      let pendingLines = "",
        childCheck,
        callbackError;
      execution.child.stdout.on("data", (chunk) => {
        try {
          pendingLines += chunk.toString();
          const lines = pendingLines.split("\n");
          pendingLines = lines.pop();
          for (const line of lines.filter(Boolean)) {
            const record = JSON.parse(line);
            if (record.kind === "ready")
              childCheck = check("event-check-child");
            if (record.kind === "event") host.closeCliConnection(event);
          }
        } catch (error) {
          callbackError = error;
          execution.child.kill();
        }
      });
      const finished = await completion;
      if (callbackError) throw callbackError;
      expect(finished.code).toBe(1);
      const records = finished.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(records.map((record) => record.kind)).toEqual(["ready", "event"]);
      expect(records[1].event.summary).toContain(childCheck.reviewId);
      expect(finished.stderr).toContain("CONNECTION_UNAVAILABLE");
      await expect(source.readEvents()).rejects.toThrow(
        "CONNECTION_UNAVAILABLE",
      );
    } finally {
      db.pragma("query_only=OFF");
      await stream.return();
    }
  }, 180000);
  it.each([
    { events: "yes" },
    { events: true, evidence: true },
    { events: true, drafts: true },
  ])(
    "rejects invalid or combined event consent %j before opening a dialog",
    async (mode) => {
      await expect(
        host.openCliConnection(event, { goalRef: ref(), ...mode }),
      ).rejects.toThrow("GOAL_BRIDGE_UNAVAILABLE");
      expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
    },
  );
  it.each(["cancel", "navigation", "identity"])(
    "does not export an event credential after %s during confirmation",
    async (mode) => {
      electron.dialog.showMessageBox.mockImplementation(async () => {
        if (mode === "navigation") event.sender.emit("did-start-navigation");
        if (mode === "identity") generation++;
        return { response: mode === "cancel" ? 0 : 1 };
      });
      const opening = host.openCliConnection(event, {
        goalRef: ref(),
        events: true,
      });
      if (mode === "cancel")
        expect(await opening).toMatchObject({ enabled: false });
      else await expect(opening).rejects.toThrow("GOAL_BRIDGE_UNAVAILABLE");
      expect(fs.existsSync(file)).toBe(false);
    },
  );
  it.each(["navigation", "login", "revision"])(
    "invalidates event reads after %s",
    async (mode) => {
      await host.openCliConnection(event, { goalRef: ref(), events: true });
      const source = createProjectGoalConnection(file);
      expect((await source.readEvents()).goalRef).toEqual(ref());
      if (mode === "navigation") event.sender.emit("did-navigate-in-page");
      if (mode === "login") clearProjectGoalAuth();
      if (mode === "revision")
        goal = host.revise(event, {
          id: goal.id,
          expectedRevision: goal.revision,
          patch: { objective: "Revised" },
        });
      await expect(source.readEvents()).rejects.toThrow(
        "CONNECTION_UNAVAILABLE",
      );
      expect(host.cliConnectionStatus(event).enabled).toBe(false);
    },
  );
  it("validates v4 descriptor capabilities, signed response fields and cancellation during HTTP", async () => {
    await host.openCliConnection(event, { goalRef: ref(), events: true });
    const original = descriptor();
    let payload = await createProjectGoalConnection(file).readEvents();
    const valid = structuredClone(payload);
    let signed = true,
      hold = false,
      received;
    const fake = http.createServer((request, response) => {
      if (hold) {
        received?.();
        return;
      }
      const body = JSON.stringify(payload);
      response.setHeader(
        "X-CC-Signature",
        signed
          ? createHmac("sha256", Buffer.from(original.key, "hex"))
              .update(`response\n${request.headers["x-cc-nonce"]}\n${body}`)
              .digest("hex")
          : "0".repeat(64),
      );
      response.end(body);
    });
    await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
    const descriptorForFake = {
      ...original,
      endpoint: `http://127.0.0.1:${fake.address().port}/goal-events`,
    };
    try {
      fs.writeFileSync(
        file,
        JSON.stringify({ ...descriptorForFake, capability: "goal.evidence" }),
      );
      expect(() => createProjectGoalConnection(file)).toThrow(
        "CONNECTION_UNAVAILABLE",
      );
      fs.writeFileSync(file, JSON.stringify(descriptorForFake));
      expect(await createProjectGoalConnection(file).readEvents()).toEqual(
        valid,
      );
      for (const invalid of [
        { ...valid, objective: "must not be exposed" },
        { ...valid, goalRef: { ...ref(), id: "another" } },
        {
          ...valid,
          receipts: { ...valid.receipts, entries: [{ id: "forged" }] },
        },
        { ...valid, schema: "chainlesschain.project-goal-evidence/v1" },
        { ...valid, extra: "x".repeat(17000) },
      ]) {
        payload = invalid;
        await expect(
          createProjectGoalConnection(file).readEvents(),
        ).rejects.toThrow("CONNECTION_UNAVAILABLE");
      }
      payload = valid;
      signed = false;
      await expect(
        createProjectGoalConnection(file).readEvents(),
      ).rejects.toThrow("CONNECTION_UNAVAILABLE");
      signed = true;
      hold = true;
      const arrival = new Promise((resolve) => {
        received = resolve;
      });
      const controller = new AbortController();
      const pending = createProjectGoalConnection(file).readEvents(goal.id, {
        signal: controller.signal,
      });
      const rejected = expect(pending).rejects.toThrow(
        "CONNECTION_UNAVAILABLE",
      );
      await arrival;
      controller.abort();
      await rejected;
    } finally {
      fake.closeAllConnections();
      await new Promise((resolve) => fake.close(resolve));
    }
  });
  it("requires separate native evidence consent and transports validated real checks/receipts with zero read writes", async () => {
    const {
      ProjectGoalMonitoringState,
    } = require("@chainlesschain/session-core/project-goal-monitoring");
    db.exec(`CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
      INSERT INTO project_tasks VALUES('t1','p1','query_info','PRIVATE BODY','pending',10,10,0,'synced',20,NULL);`);
    goal = host.revise(event, {
      id: goal.id,
      expectedRevision: goal.revision,
      patch: { allowedActionTypes: ["task.update-description"] },
    });
    const state = new ProjectGoalMonitoringState({
      db,
      getActor: () => actor,
      clock: () => now,
    });
    state.prepareManual(
      {
        id: goal.id,
        expectedRevision: goal.revision,
        requestId: "evidence-check",
      },
      () => 1,
    );
    const result = state.perform(
      {
        occurrence: {
          id: "evidence-check",
          payload: {
            storeId: goal.storeId,
            goalId: goal.id,
            goalRevision: goal.revision,
            controlGeneration: goal.controlGeneration,
            monitorRevision: null,
            schedulerPolicyRevision: 1,
            requestId: "evidence-check",
          },
        },
        renewLease: () => {},
        signal: { aborted: false },
      },
      () => {},
    );
    const proposal = host
      .proposals(event, { goalId: goal.id })
      .proposals.find(
        (item) => item.proposal.actionType === "task.update-description",
      ).proposal;
    const prepared = host.prepareIntent(event, {
      goalId: goal.id,
      proposalId: proposal.id,
      expectedRevision: goal.revision,
      requestId: "native-evidence-action",
      description: "PRIVATE ACTION BODY",
    });
    const run = await host.executeIntent(event, {
      intentId: prepared.intent.id,
    });
    await open();
    const summary = descriptor();
    expect(
      (await request(summary, { pathname: "/goal-evidence" })).status,
    ).toBe(403);
    file = path.join(dir, "goal-connections", "evidence.json");
    const opened = await host.openCliConnection(event, {
      goalRef: ref(),
      evidence: true,
    });
    expect(opened.enabled).toBe(true);
    expect(descriptor()).toMatchObject({
      schema: "chainlesschain.project-goal-connection/v2",
      capability: "goal.evidence",
    });
    expect(
      electron.dialog.showMessageBox.mock.calls.at(-1)[1].detail,
    ).toContain("最近20");
    const before = db.prepare("SELECT total_changes() AS n").get().n;
    const source = createProjectGoalConnection(file);
    expect(source.evidence).toBe(true);
    db.pragma("query_only=ON");
    try {
      const value = await source.read();
      expect(value.risk).toMatchObject({
        reviewId: result.reviewId,
        state: "evaluated",
        history: true,
      });
      expect(value.receipts.entries[0]).toMatchObject({
        id: run.run.id,
        status: "succeeded",
        history: true,
      });
      expect(JSON.stringify(value)).not.toMatch(
        /PRIVATE BODY|PRIVATE ACTION BODY|approvalRef|preview/,
      );
      expect(db.prepare("SELECT total_changes() AS n").get().n).toBe(before);
      // Build a filesystem URL: Vite rewrites static import.meta URL assets in jsdom.
      const cliRoot = pathToFileURL(
        path.resolve(__dirname, "../../../../../packages/cli") + path.sep,
      );
      const { readCliGoalExtensionPanels } = await import(
        "../../../../../packages/cli/src/lib/plugin-runtime/cli-goal-extension-host.js"
      );
      const { trustPlugin, _deps: trustDeps } = await import(
        "../../../../../packages/cli/src/lib/plugin-runtime/trust.js"
      );
      const { consentPluginCapabilities, _deps: consentDeps } = await import(
        "../../../../../packages/cli/src/lib/plugin-runtime/capability-consent.js"
      );
      const { normalizeCapabilities } = await import(
        "../../../../../packages/cli/src/lib/plugin-runtime/capabilities.js"
      );
      const sample = JSON.parse(
        fs.readFileSync(
          new URL(
            "src/lib/plugin-runtime/examples/goal-evidence-viewer/plugin.json",
            cliRoot,
          ),
          "utf8",
        ),
      );
      const cwd = path.join(dir, "evidence-workspace"),
        pluginDir = path.join(cwd, ".chainlesschain", "plugins", sample.name);
      fs.mkdirSync(path.join(pluginDir, sample.version), { recursive: true });
      fs.writeFileSync(
        path.join(pluginDir, sample.version, "plugin.json"),
        JSON.stringify(sample),
      );
      fs.writeFileSync(path.join(pluginDir, ".active"), sample.version);
      vi.spyOn(trustDeps, "storePath").mockReturnValue(
        path.join(dir, "trust.json"),
      );
      vi.spyOn(trustDeps, "workspaceTrustStorePath").mockReturnValue(
        path.join(dir, "workspace-trust.json"),
      );
      vi.spyOn(consentDeps, "storePath").mockReturnValue(
        path.join(dir, "consent.json"),
      );
      const options = {
        cwd,
        connection: file,
        plugin: sample.name,
        scope: "project",
        managedSettingsFile: path.join(dir, "managed.json"),
        env: {
          ...process.env,
          CC_PLUGINS: "1",
          CC_PLUGIN_SCOPES: "project",
          CC_PLUGIN_TRANSACTION_HOME: path.join(dir, "transactions"),
        },
      };
      expect(
        (await readCliGoalExtensionPanels(goal.id, options)).panels,
      ).toHaveLength(0);
      trustPlugin(sample.name, {
        scope: "project",
        version: sample.version,
        workspaceRoot: cwd,
      });
      consentPluginCapabilities(sample.name, {
        scope: "project",
        version: sample.version,
        capabilities: normalizeCapabilities(sample.permissions),
      });
      const panels = await readCliGoalExtensionPanels(goal.id, options);
      expect(panels.panels[0]).toMatchObject({
        slot: "goal.evidence",
        format: "text",
      });
      expect(panels.panels[0].text).toContain(result.reviewId);
      expect(panels.panels[0].text).toContain(run.run.id);
      expect(JSON.stringify(panels)).not.toMatch(
        /PRIVATE BODY|PRIVATE ACTION BODY/,
      );
      expect(db.prepare("SELECT total_changes() AS n").get().n).toBe(before);
    } finally {
      db.pragma("query_only=OFF");
    }
    host.closeCliConnection(event);
    await expect(source.read()).rejects.toThrow("CONNECTION_UNAVAILABLE");
  }, 180000);
  it("refuses an export outside the pre-secured connection directory", async () => {
    const outside = path.join(dir, "outside.json");
    electron.dialog.showSaveDialog.mockResolvedValue({
      filePath: outside,
      canceled: false,
    });
    await expect(open()).rejects.toThrow("GOAL_BRIDGE_UNAVAILABLE");
    expect(fs.existsSync(outside)).toBe(false);
    expect(host.cliConnectionStatus(event).enabled).toBe(false);
  });
  it("does not resume a pending native confirmation after explicit stop", async () => {
    electron.dialog.showMessageBox.mockImplementation(async () => {
      host.closeCliConnection(event);
      return { response: 1 };
    });
    await expect(open()).rejects.toThrow("GOAL_BRIDGE_UNAVAILABLE");
    expect(fs.existsSync(file)).toBe(false);
  });
  it("runs fresh CLI children through native HTTP, real plugin trust/consent and revocation", async () => {
    await open();
    // Build a filesystem URL: Vite rewrites static import.meta URL assets in jsdom.
    const cliRoot = pathToFileURL(
      path.resolve(__dirname, "../../../../../packages/cli") + path.sep,
    );
    const workspace = path.join(dir, "workspace");
    fs.mkdirSync(workspace);
    const bootstrap = path.join(dir, "security-stores.mjs");
    fs.writeFileSync(
      bootstrap,
      `import { _deps as trust } from ${JSON.stringify(new URL("src/lib/plugin-runtime/trust.js", cliRoot).href)};
import { _deps as consent } from ${JSON.stringify(new URL("src/lib/plugin-runtime/capability-consent.js", cliRoot).href)};
trust.storePath=()=>process.env.DMM_TEST_TRUST_FILE;
trust.workspaceTrustStorePath=()=>process.env.DMM_TEST_WORKSPACE_TRUST_FILE;
consent.storePath=()=>process.env.DMM_TEST_CONSENT_FILE;`,
    );
    const env = {
      ...process.env,
      CHAINLESSCHAIN_HOME: path.join(dir, "home"),
      CC_PLUGINS: "1",
      CC_PLUGIN_SCOPES: "project",
      CC_PLUGIN_TRANSACTION_HOME: path.join(dir, "transactions"),
      CC_MANAGED_SETTINGS: path.join(dir, "managed.json"),
      DMM_TEST_TRUST_FILE: path.join(dir, "trust.json"),
      DMM_TEST_WORKSPACE_TRUST_FILE: path.join(dir, "workspace-trust.json"),
      DMM_TEST_CONSENT_FILE: path.join(dir, "consent.json"),
    };
    async function cli(...args) {
      const result = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          pathToFileURL(bootstrap).href,
          fileURLToPath(new URL("bin/chainlesschain.js", cliRoot)),
          ...args,
        ],
        {
          cwd: workspace,
          env,
          encoding: "utf8",
          windowsHide: true,
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        },
      );
      return result.stdout;
    }
    const catalog = JSON.parse(
      await cli("goal", "catalog", "--connection", file, "--json"),
    );
    expect(catalog.entries[0].id).toBe(goal.id);
    await cli(
      "plugin",
      "add",
      fileURLToPath(
        new URL(
          "src/lib/plugin-runtime/examples/goal-progress-viewer",
          cliRoot,
        ),
      ),
      "--scope",
      "project",
      "--json",
    );
    const panels = async () =>
      JSON.parse(
        await cli(
          "goal",
          "panels",
          goal.id,
          "--connection",
          file,
          `--expected-store=${goal.storeId}`,
          "--plugin=goal-progress-viewer",
          "--scope",
          "project",
          "--json",
        ),
      );
    expect((await panels()).panels).toHaveLength(0);
    await cli("plugin", "trust", "goal-progress-viewer", "--scope", "project");
    expect((await panels()).dropped).toContainEqual(
      expect.objectContaining({ reason: "consent_required" }),
    );
    await cli(
      "plugin",
      "consent",
      "goal-progress-viewer",
      "--scope",
      "project",
      "--grant",
      "--json",
    );
    const snapshot = await panels();
    expect(snapshot.panels[0].text).toContain(goal.objective);
    expect(snapshot.source).toBe("desktop-project");
    expect(JSON.stringify(snapshot)).not.toContain(descriptor().key);
    await cli(
      "plugin",
      "disable",
      "goal-progress-viewer",
      "--scope",
      "project",
      "--json",
    );
    expect((await panels()).panels).toHaveLength(0);
    host.closeCliConnection(event);
    await expect(panels()).rejects.toThrow("CLI_GOAL_CONNECTION_UNAVAILABLE");
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM cc_project_goals").get().n,
    ).toBe(1);
  }, 180000);
  it("exports an owner-only credential after native consent and serves only the exact summary", async () => {
    expect(host.cliConnectionStatus(event)).toMatchObject({ enabled: false });
    const result = await open();
    expect(result).toMatchObject({ enabled: true, goalRef: ref() });
    expect(Object.keys(result).sort()).toEqual([
      "enabled",
      "expiresAt",
      "goalRef",
    ]);
    expect(inspectPrivatePath(file).ok).toBe(true);
    const source = createProjectGoalConnection(file);
    expect(await source.read()).toEqual({
      schema: "chainlesschain.project-goal-summary/v1",
      goalRef: ref(),
      objective: goal.objective,
      status: "active",
    });
    const page = await readProjectGoalCatalog({ connection: file });
    expect(page).toMatchObject({
      source: "desktop-project",
      storeId: goal.storeId,
      nextCursor: null,
      entries: [{ id: goal.id }],
    });
    const [, confirmation] = electron.dialog.showMessageBox.mock.calls[0];
    expect(confirmation).toMatchObject({
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    expect(confirmation.message).toContain("15");
    expect(JSON.stringify(result)).not.toContain(descriptor().key);
    await expect(source.read("another-goal")).rejects.toThrow(
      "CONNECTION_UNAVAILABLE",
    );
  });
  it("native cancel creates no credential or listener", async () => {
    electron.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    expect(await open()).toMatchObject({ enabled: false });
    expect(electron.dialog.showSaveDialog).not.toHaveBeenCalled();
    expect(fs.existsSync(file)).toBe(false);
    expect(event.sender.listenerCount("did-start-navigation")).toBe(0);
  });
  it.each(["identity", "generation", "frame", "navigation", "database"])(
    "rejects %s changes during native confirmation",
    async (kind) => {
      const original = db;
      electron.dialog.showMessageBox.mockImplementation(async () => {
        if (kind === "identity") actor = "did:chainless:other";
        if (kind === "generation") generation++;
        if (kind === "frame") event.senderFrame = { ...event.senderFrame };
        if (kind === "navigation") event.sender.emit("did-start-navigation");
        if (kind === "database") db = new Database(":memory:");
        return { response: 1 };
      });
      await expect(open()).rejects.toThrow("GOAL_BRIDGE_UNAVAILABLE");
      expect(fs.existsSync(file)).toBe(false);
      if (db !== original) {
        db.close();
        db = original;
      }
    },
  );
  it.each([
    "login",
    "navigation",
    "closed",
    "project",
    "revision",
    "expiry",
    "stop",
  ])("invalidates a saved connection after %s", async (kind) => {
    await open();
    const source = createProjectGoalConnection(file);
    if (kind === "login") clearProjectGoalAuth();
    if (kind === "navigation") event.sender.emit("did-navigate-in-page");
    if (kind === "closed") parent.emit("closed");
    if (kind === "project")
      db.prepare("UPDATE projects SET status='archived'").run();
    if (kind === "revision")
      goal = host.revise(event, {
        id: goal.id,
        expectedRevision: goal.revision,
        patch: { objective: "Revised" },
      });
    if (kind === "expiry") now += 15 * 60 * 1000 + 1;
    if (kind === "stop") host.closeCliConnection(event);
    await expect(source.read()).rejects.toThrow("CONNECTION_UNAVAILABLE");
    expect(host.cliConnectionStatus(event).enabled).toBe(false);
  });
  it("rejects foreign methods, origins, paths, MACs and repeated nonces", async () => {
    await open();
    const data = descriptor();
    for (const options of [
      { method: "POST" },
      { pathname: "/goal-summary?goal=other" },
      { headers: { Origin: "http://evil.invalid" } },
      { headers: { "X-CC-Signature": "0".repeat(64) } },
    ])
      expect((await request(data, options)).status).toBe(403);
    const nonce = "a".repeat(64);
    expect((await request(data, { nonce })).status).toBe(200);
    expect((await request(data, { nonce })).status).toBe(429);
    expect((await createProjectGoalConnection(file).read()).objective).toBe(
      goal.objective,
    );
  });
  it("does not overwrite an existing file or retain its new server after save fails", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "keep existing");
    await expect(open()).rejects.toThrow("GOAL_BRIDGE_UNAVAILABLE");
    expect(fs.readFileSync(file, "utf8")).toBe("keep existing");
    expect(host.cliConnectionStatus(event).enabled).toBe(false);
  });
  it("rejects copied authority parameters before opening a native dialog", async () => {
    await expect(
      host.openCliConnection(event, { goalRef: ref(), actorDid: owner }),
    ).rejects.toThrow("GOAL_BRIDGE_UNAVAILABLE");
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  });
  it("refuses replaced or oversized descriptors and unsigned counterfeit responses", async () => {
    await open();
    const data = descriptor();
    const source = createProjectGoalConnection(file);
    fs.writeFileSync(file, JSON.stringify({ ...data, key: "f".repeat(64) }));
    await expect(source.read()).rejects.toThrow("CONNECTION_UNAVAILABLE");
    fs.writeFileSync(file, " ".repeat(4097));
    expect(() => createProjectGoalConnection(file)).toThrow(
      "CONNECTION_UNAVAILABLE",
    );
    const fake = http.createServer((req, res) =>
      res.end(
        JSON.stringify({
          schema: "chainlesschain.project-goal-summary/v1",
          goalRef: ref(),
          objective: "forged",
          status: "active",
        }),
      ),
    );
    await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...data,
        endpoint: `http://127.0.0.1:${fake.address().port}/goal-summary`,
      }),
    );
    try {
      await expect(createProjectGoalConnection(file).read()).rejects.toThrow(
        "CONNECTION_UNAVAILABLE",
      );
    } finally {
      await new Promise((resolve) => fake.close(resolve));
    }
  });
});
