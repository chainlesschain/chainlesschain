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
      const cliRoot = new URL("../../../../../packages/cli/", import.meta.url);
      const { readCliGoalExtensionPanels } = await import(
        new URL("src/lib/plugin-runtime/cli-goal-extension-host.js", cliRoot)
          .href
      );
      const { trustPlugin, _deps: trustDeps } = await import(
        new URL("src/lib/plugin-runtime/trust.js", cliRoot).href
      );
      const { consentPluginCapabilities, _deps: consentDeps } = await import(
        new URL("src/lib/plugin-runtime/capability-consent.js", cliRoot).href
      );
      const { normalizeCapabilities } = await import(
        new URL("src/lib/plugin-runtime/capabilities.js", cliRoot).href
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
    const cliRoot = new URL("../../../../../packages/cli/", import.meta.url);
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
