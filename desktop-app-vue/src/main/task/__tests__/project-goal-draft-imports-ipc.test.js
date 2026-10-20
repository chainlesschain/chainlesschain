// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url),
  Database = require("better-sqlite3");
const {
  createProjectGoalHost,
  CHANNELS,
  registerProjectGoalIPC,
} = require("../project-goal-ipc.js");
const {
  ProjectGoalWorkflow,
} = require("@chainlesschain/session-core/project-goal-workflow");
const {
  createGoalDraftRequest,
} = require("@chainlesschain/session-core/goal-draft-request-contract");
let directory,
  db,
  host,
  actor,
  event,
  electron,
  window,
  goal,
  source,
  envelope,
  file,
  now;
const owner = "did:chainless:owner";
const ref = () => ({
  id: goal.id,
  storeId: goal.storeId,
  revision: goal.revision,
  controlGeneration: goal.controlGeneration,
});
const adopt = () => host.importDraftRequest(event, { goalRef: ref() });
const rows = (table) =>
  db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
function open() {
  db = new Database(path.join(directory, "project.sqlite"));
  host = createProjectGoalHost({
    database: { getDatabase: () => db },
    electron,
    getCurrentUserDid: () => actor,
    clock: () => now,
  });
}
function save(changes = {}) {
  envelope = createGoalDraftRequest({
    declaredPlugin: {
      name: "goal-description-drafter",
      scope: "project",
      version: "0.1.0",
    },
    declarationDigest: `sha256:${"a".repeat(64)}`,
    proposal: {
      type: "task.description.update",
      goalRef: ref(),
      sourceRef: source.id,
      requestId: "request-1",
      title: "Proposed follow-up",
      description: "Reviewed external description",
      ...changes,
    },
  });
  fs.writeFileSync(file, JSON.stringify(envelope));
}
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-draft-import-"));
  now = Date.now();
  actor = owner;
  file = path.join(directory, "request.json");
  window = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  event = {
    sender: new EventEmitter(),
    senderFrame: { url: "http://localhost:5173", parent: null },
  };
  electron = {
    BrowserWindow: { fromWebContents: () => window },
    app: { getPath: () => directory },
    ipcMain: { handle: vi.fn() },
    dialog: {
      showMessageBox: vi.fn(async () => ({ response: 1 })),
      showOpenDialog: vi.fn(async () => ({
        canceled: false,
        filePaths: [file],
      })),
      showSaveDialog: vi.fn(async () => ({
        canceled: false,
        filePath: path.join(directory, "goal-connections", "connection.json"),
      })),
    },
  };
  open();
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
    CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
    INSERT INTO projects VALUES('p1','${owner}','active',10,0);
    INSERT INTO project_tasks VALUES('t1','p1','query_info','Original','pending',10,10,0,'synced',20,NULL);`);
  goal = host.create(event, { projectId: "p1", objective: "Follow delivery" });
  goal = host.revise(event, {
    id: goal.id,
    expectedRevision: goal.revision,
    patch: { allowedActionTypes: ["task.update-description"] },
  });
  const workflow = new ProjectGoalWorkflow({
    db,
    getActor: () => actor,
    clock: () => now,
  });
  const review = workflow.risk.evaluate({ projectId: "p1" });
  db.transaction(() =>
    workflow.observeInTransaction({
      goalId: goal.id,
      reviewId: review.review.id,
    }),
  ).immediate();
  source = workflow
    .list({ goalId: goal.id })
    .proposals.find(
      (item) => item.proposal.actionType === "task.update-description",
    ).proposal;
  save();
});
afterEach(() => {
  try {
    host.closeCliConnection(event);
  } catch {}
  vi.restoreAllMocks();
  if (db.open) db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
describe("explicit native adoption of untrusted goal requests", () => {
  it("exports through real authenticated HTTP and real plugin admission, then adopts and executes through separate native confirmations", async () => {
    await host.openCliConnection(event, { goalRef: ref() });
    const cliRoot = new URL("../../../../../packages/cli/", import.meta.url);
    const { exportCliGoalDraftRequest } = await import(
      new URL("src/lib/plugin-runtime/cli-goal-draft-request.js", cliRoot).href
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
          "src/lib/plugin-runtime/examples/goal-description-drafter/plugin.json",
          cliRoot,
        ),
        "utf8",
      ),
    );
    const cwd = path.join(directory, "workspace"),
      pluginDir = path.join(cwd, ".chainlesschain", "plugins", sample.name);
    fs.mkdirSync(path.join(pluginDir, sample.version), { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, sample.version, "plugin.json"),
      JSON.stringify(sample),
    );
    fs.writeFileSync(path.join(pluginDir, ".active"), sample.version);
    vi.spyOn(trustDeps, "storePath").mockReturnValue(
      path.join(directory, "trust.json"),
    );
    vi.spyOn(trustDeps, "workspaceTrustStorePath").mockReturnValue(
      path.join(directory, "workspace-trust.json"),
    );
    vi.spyOn(consentDeps, "storePath").mockReturnValue(
      path.join(directory, "consent.json"),
    );
    const body = path.join(directory, "description.txt"),
      out = path.join(directory, "exported-request.json");
    fs.writeFileSync(body, "User-selected CLI description");
    const options = {
      cwd,
      connection: path.join(directory, "goal-connections", "connection.json"),
      plugin: sample.name,
      scope: "project",
      source: source.id,
      requestId: "real-cli-export",
      title: "CLI proposal",
      descriptionFile: body,
      out,
      expectedStore: goal.storeId,
      managedSettingsFile: path.join(directory, "managed.json"),
      env: {
        ...process.env,
        CC_PLUGINS: "1",
        CC_PLUGIN_SCOPES: "project",
        CC_PLUGIN_TRANSACTION_HOME: path.join(directory, "transactions"),
      },
    };
    await expect(exportCliGoalDraftRequest(goal.id, options)).rejects.toThrow(
      "NOT_ADMITTED",
    );
    expect(fs.existsSync(out)).toBe(false);
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
    const exported = await exportCliGoalDraftRequest(goal.id, options);
    expect(exported.state).toBe("request-exported");
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Original");
    file = out;
    const saved = await adopt();
    expect(saved).toMatchObject({ state: "saved", available: true });
    const prepared = host.prepareDraftImport(event, {
      goalRef: ref(),
      id: saved.id,
    });
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Original");
    expect(
      (await host.executeIntent(event, { intentId: prepared.intent.id })).run
        .status,
    ).toBe("succeeded");
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("User-selected CLI description");
    expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(3);
  }, 180000);
  it("atomically saves an exact pending draft after full native review, with no task or intent write", async () => {
    const result = await adopt();
    expect(result).toMatchObject({
      state: "saved",
      enabled: true,
      epoch: 1,
      available: true,
    });
    expect(rows("cc_project_goal_draft_imports")).toBe(1);
    expect(rows("cc_project_goal_extension_drafts")).toBe(1);
    expect(rows("cc_business_action_runs")).toBe(0);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM cc_project_goal_workflow WHERE kind='intent'",
        )
        .get().n,
    ).toBe(0);
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Original");
    const dialog = electron.dialog.showMessageBox.mock.calls[0][1];
    expect(dialog.detail).toContain("Reviewed external description");
    expect(dialog.detail).toContain(envelope.contentDigest);
    expect(dialog.detail).toContain("未经代码鉴定");
    expect(dialog).toMatchObject({ defaultId: 0, cancelId: 0 });
    const value = host.readDraftImport(event, {
      goalRef: ref(),
      id: result.id,
    });
    expect(value.draft).toMatchObject({
      origin: "user-edited",
      plugin: { name: "native-imported-description" },
      proposal: envelope.proposal,
    });
  });
  it("reimports the same file without another confirmation or duplicate draft", async () => {
    const first = await adopt();
    expect(await adopt()).toEqual(first);
    expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(rows("cc_project_goal_extension_drafts")).toBe(1);
    save({ description: "Changed under same request" });
    await expect(adopt()).rejects.toThrow("REQUEST_CONFLICT");
    expect(rows("cc_project_goal_extension_drafts")).toBe(1);
  });
  it("does not save a usable adoption when the native review is cancelled", async () => {
    electron.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    expect(await adopt()).toEqual({ state: "cancelled" });
    expect(rows("cc_project_goal_draft_imports")).toBe(0);
    expect(rows("cc_project_goal_extension_drafts")).toBe(0);
  });
  it("rolls adoption back if the pending insert fails", async () => {
    host.listDraftImports(event, { goalRef: ref() });
    db.exec(
      "CREATE TRIGGER fail_import BEFORE INSERT ON cc_project_goal_extension_drafts BEGIN SELECT RAISE(ABORT,'fixture insertion failure'); END",
    );
    await expect(adopt()).rejects.toThrow("fixture insertion failure");
    expect(rows("cc_project_goal_draft_imports")).toBe(0);
    expect(rows("cc_project_goal_extension_drafts")).toBe(0);
  });
  it.each(["actor", "revision", "source", "navigation"])(
    "rejects %s changes during native review",
    async (kind) => {
      electron.dialog.showMessageBox.mockImplementation(async () => {
        if (kind === "actor") actor = "did:other";
        if (kind === "revision")
          goal = host.revise(event, {
            id: goal.id,
            expectedRevision: goal.revision,
            patch: { objective: "Changed" },
          });
        if (kind === "source")
          db.exec("UPDATE project_tasks SET updated_at=11");
        if (kind === "navigation") event.sender.emit("did-start-navigation");
        return { response: 1 };
      });
      await expect(adopt()).rejects.toThrow();
      expect(rows("cc_project_goal_draft_imports")).toBe(0);
      expect(rows("cc_project_goal_extension_drafts")).toBe(0);
    },
  );
  it("uses the captured bytes even if the selected file changes during review", async () => {
    const original = envelope.proposal.description;
    electron.dialog.showMessageBox.mockImplementation(async () => {
      save({ description: "Replacement after read" });
      return { response: 1 };
    });
    const result = await adopt();
    expect(
      host.readDraftImport(event, { goalRef: ref(), id: result.id }).draft
        .proposal.description,
    ).toBe(original);
  });
  it("survives close/reopen, prepares one intent, and requires a second native confirmation for the actual modification", async () => {
    const saved = await adopt();
    db.close();
    open();
    expect(await adopt()).toMatchObject({ id: saved.id, state: "saved" });
    const input = { goalRef: ref(), id: saved.id };
    const prepared = host.prepareDraftImport(event, input);
    expect(host.prepareDraftImport(event, input).intent.id).toBe(
      prepared.intent.id,
    );
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Original");
    const run = await host.executeIntent(event, {
      intentId: prepared.intent.id,
    });
    expect(run.run.status).toBe("succeeded");
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Reviewed external description");
    expect(
      electron.dialog.showMessageBox.mock.calls.at(-1)[1].detail,
    ).toContain("已采纳外部请求草稿");
    expect(
      electron.dialog.showMessageBox.mock.calls.at(-1)[1].detail,
    ).toContain(envelope.contentDigest);
  });
  it("revokes one adoption, rejects its prepared intent, and cannot revive it by importing again", async () => {
    const saved = await adopt(),
      input = { goalRef: ref(), id: saved.id };
    const prepared = host.prepareDraftImport(event, input);
    expect(
      host.revokeDraftImport(event, { ...input, expectedEpoch: 1 }),
    ).toMatchObject({ state: "revoked", epoch: 2, available: false });
    expect(await adopt()).toMatchObject({
      id: saved.id,
      state: "revoked",
      available: false,
    });
    expect(() => host.prepareDraftImport(event, input)).toThrow();
    await expect(
      host.executeIntent(event, { intentId: prepared.intent.id }),
    ).rejects.toThrow();
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Original");
  });
  it("reports a previously saved request after its risk source changes without another insert", async () => {
    const saved = await adopt();
    db.exec("UPDATE project_tasks SET updated_at=22");
    expect(await adopt()).toMatchObject({
      id: saved.id,
      state: "saved",
      available: false,
    });
    expect(rows("cc_project_goal_extension_drafts")).toBe(1);
  });
  it("rejects renderer paths and malformed or oversized files before confirmation", async () => {
    await expect(
      host.importDraftRequest(event, { goalRef: ref(), file }),
    ).rejects.toThrow("INVALID_REQUEST");
    for (const text of [
      "{bad",
      " ".repeat(16385),
      JSON.stringify({ ...envelope, approved: true }),
    ]) {
      fs.writeFileSync(file, text);
      await expect(adopt()).rejects.toThrow();
    }
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  });
  it("registers only fixed import endpoints", () => {
    registerProjectGoalIPC(db, {
      electron,
      getCurrentUserDid: () => actor,
      clock: () => now,
    });
    for (const name of [
      "importDraftRequest",
      "listDraftImports",
      "readDraftImport",
      "prepareDraftImport",
      "revokeDraftImport",
    ])
      expect(
        electron.ipcMain.handle.mock.calls.some(
          (call) => call[0] === CHANNELS[name],
        ),
      ).toBe(true);
  });
});
