// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
function save() {
  fs.writeFileSync(
    file,
    JSON.stringify({
      schema: "chainlesschain.goal-draft-access/v1",
      plugin: {
        name: "goal-description-drafter",
        scope: "project",
        version: "0.1.0",
      },
      declarationDigest: `sha256:${"a".repeat(64)}`,
    }),
  );
}
function enableCreation() {
  goal = host.revise(event, {
    id: goal.id,
    expectedRevision: goal.revision,
    patch: { allowedActionTypes: ["task.update-description", "task.create"] },
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
      (item) => item.current && item.proposal.actionType === "task.create",
    ).proposal;
}
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-online-draft-"));
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

describe("native online pending draft connection", () => {
  it.each([
    ["goal-description-drafter", false],
    ["project-delivery-assistant", false],
    ["goal-task-creator", true],
    ["project-delivery-assistant", true],
  ])(
    "connects %s admission to HTTP, SQLite, native preview and confirmation (creation=%s)",
    async (pluginName, creation) => {
      if (creation) enableCreation();
      // Build a filesystem URL: Vite rewrites static import.meta URL assets in jsdom.
      const cliRoot = pathToFileURL(
        path.resolve(__dirname, "../../../../../packages/cli") + path.sep,
      );
      const cli =
        await import("../../../../../packages/cli/src/lib/plugin-runtime/cli-goal-drafts.js");
      const exportCliGoalDraftAccess = creation
          ? cli.exportCliGoalCreateDraftAccess
          : cli.exportCliGoalDraftAccess,
        sendCliGoalDraft = creation
          ? cli.sendCliGoalCreateDraft
          : cli.sendCliGoalDraft,
        readCliGoalDraftReceipt = creation
          ? cli.readCliGoalCreateDraftReceipt
          : cli.readCliGoalDraftReceipt,
        readCliGoalDraftSources = creation
          ? cli.readCliGoalCreateDraftSources
          : cli.readCliGoalDraftSources;
      const { trustPlugin, _deps: trustDeps } =
        await import("../../../../../packages/cli/src/lib/plugin-runtime/trust.js");
      const { consentPluginCapabilities, _deps: consentDeps } =
        await import("../../../../../packages/cli/src/lib/plugin-runtime/capability-consent.js");
      const { normalizeCapabilities } =
        await import("../../../../../packages/cli/src/lib/plugin-runtime/capabilities.js");
      const sample = JSON.parse(
        fs.readFileSync(
          new URL(
            "src/lib/plugin-runtime/examples/" + pluginName + "/plugin.json",
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
      file = path.join(directory, "real-access.json");
      const options = {
        cwd,
        plugin: sample.name,
        scope: "project",
        out: file,
        connection: path.join(directory, "goal-connections", "connection.json"),
        expectedStore: goal.storeId,
        managedSettingsFile: path.join(directory, "managed.json"),
        env: {
          ...process.env,
          CC_PLUGINS: "1",
          CC_PLUGIN_SCOPES: "project",
          CC_PLUGIN_TRANSACTION_HOME: path.join(directory, "transactions"),
        },
      };
      await expect(exportCliGoalDraftAccess(options)).rejects.toThrow(
        "NOT_ADMITTED",
      );
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
      const exportedAccess = await exportCliGoalDraftAccess(options);
      const ideDrafts = require("../../../../../packages/vscode-extension/src/goal-drafts.js");
      const ide = creation ? ideDrafts.creation : ideDrafts;
      const ideInput = {
        id: goal.id,
        name: sample.name,
        scope: "project",
        expectedStore: goal.storeId,
        connection: options.connection,
      };
      expect(
        ide.parseGoalDraftAccess(JSON.stringify(exportedAccess), {
          ...ideInput,
          out: file,
        }),
      ).toMatchObject({ file });
      if (pluginName === "project-delivery-assistant") {
        const { readCliGoalExtensionPanels } =
          await import("../../../../../packages/cli/src/lib/plugin-runtime/cli-goal-extension-host.js");
        const evidenceFile = path.join(
          directory,
          "goal-connections",
          "evidence.json",
        );
        electron.dialog.showSaveDialog.mockResolvedValueOnce({
          canceled: false,
          filePath: evidenceFile,
        });
        await host.openCliConnection(event, { goalRef: ref(), evidence: true });
        const panels = await readCliGoalExtensionPanels(goal.id, {
          ...options,
          connection: evidenceFile,
        });
        expect(panels.panels).toHaveLength(1);
        expect(panels.panels[0]).toMatchObject({
          plugin: { name: pluginName, version: sample.version },
          slot: "goal.evidence",
        });
        expect(panels.panels[0].text).toContain("riskSummary:");
        host.closeCliConnection(event);
      }
      await host.openCliConnection(event, {
        goalRef: ref(),
        ...(creation ? { createDrafts: true } : { drafts: true }),
      });
      const page = await readCliGoalDraftSources(goal.id, options);
      expect(page.sources.entries[0].id).toBe(source.id);
      const idePage = ide.parseGoalDraftSources(JSON.stringify(page), ideInput);
      expect(idePage.entries[0].id).toBe(source.id);
      const { readProjectGoalCatalog } =
        await import("../../../../../packages/cli/src/lib/project-goal-connection.js");
      expect(
        (await readProjectGoalCatalog({ connection: options.connection }))
          .entries[0].id,
      ).toBe(goal.id);
      const descriptionFile = path.join(directory, "body.txt"),
        record = path.join(directory, "submission.json");
      fs.writeFileSync(descriptionFile, "Real CLI pending description");
      const sendOptions = {
        ...options,
        source: source.id,
        title: "Real CLI draft",
        requestId: "real-online-1",
        descriptionFile,
        record,
        ...(creation ? { taskType: "analyze_data" } : {}),
      };
      const result = await sendCliGoalDraft(goal.id, sendOptions);
      expect(result.state).toBe("saved");
      expect(
        ide.parseGoalDraftSubmission(JSON.stringify(result), {
          ...ideInput,
          binding: idePage.binding,
          record,
          requestId: sendOptions.requestId,
        }),
      ).toMatchObject({ state: "saved", requestId: sendOptions.requestId });
      expect(
        JSON.stringify(JSON.parse(fs.readFileSync(record, "utf8"))),
      ).not.toMatch(/Real CLI pending description|endpoint|key|connection/);
      expect(await sendCliGoalDraft(goal.id, sendOptions)).toEqual(result);
      expect(
        (await readCliGoalDraftReceipt(goal.id, { ...options, record })).state,
      ).toBe("saved");
      expect(rows("cc_project_goal_extension_drafts")).toBe(1);
      expect(rows("cc_business_action_runs")).toBe(0);
      expect(rows("project_tasks")).toBe(1);
      const grant = host.listExternalDraftGrants(event, { goalRef: ref() })
        .entries[0];
      const prepared = host.prepareExternalDraft(event, {
        goalRef: ref(),
        id: grant.id,
        draftId: result.proposalId,
      });
      if (creation) expect(prepared.intent.taskType).toBe("analyze_data");
      expect(
        (await host.executeIntent(event, { intentId: prepared.intent.id })).run
          .status,
      ).toBe("succeeded");
      expect(
        db
          .prepare(
            creation
              ? "SELECT description FROM project_tasks WHERE task_type='analyze_data'"
              : "SELECT description FROM project_tasks",
          )
          .get().description,
      ).toBe("Real CLI pending description");
      expect(rows("project_tasks")).toBe(creation ? 2 : 1);
      // The task changed, making the source stale. Receipt lookup remains valid.
      expect(
        (await readCliGoalDraftReceipt(goal.id, { ...options, record })).state,
      ).toBe("saved");
    },
    180000,
  );
  it.each([false, true])(
    "uses authenticated pending-only submission, survives restart and requires native confirmation (creation=%s)",
    async (creation) => {
      if (creation) {
        enableCreation();
        const access = JSON.parse(fs.readFileSync(file, "utf8"));
        access.schema = "chainlesschain.goal-create-draft-access/v1";
        fs.writeFileSync(file, JSON.stringify(access));
      }
      const { createProjectGoalConnection } =
        await import("../../../../../packages/cli/src/lib/project-goal-connection.js");
      const {
        digestBusinessObjectContent: digest,
      } = require("@chainlesschain/session-core/business-object-contract");
      await host.openCliConnection(event, {
        goalRef: ref(),
        ...(creation ? { createDrafts: true } : { drafts: true }),
      });
      const connectionFile = path.join(
        directory,
        "goal-connections",
        "connection.json",
      );
      const descriptor = JSON.parse(fs.readFileSync(connectionFile, "utf8"));
      expect(descriptor).toMatchObject({
        schema: `chainlesschain.project-goal-connection/${creation ? "v6" : "v3"}`,
        capability: creation ? "goal.create-drafts" : "goal.drafts",
      });
      const client = createProjectGoalConnection(connectionFile);
      const context = await client.read(goal.id);
      expect(context.sources.entries[0].id).toBe(source.id);
      expect(JSON.stringify(context)).not.toMatch(
        /Original|approvalRef|preview/,
      );
      const proposal = {
        type: creation ? "task.create" : "task.description.update",
        ...(creation ? { taskType: "analyze_data" } : {}),
        goalRef: ref(),
        sourceRef: source.id,
        requestId: "online-1",
        title: "Online suggestion",
        description: "Online reviewed description",
      };
      const receipt = await client.enqueue(proposal);
      expect(
        await client.receipt({
          requestId: proposal.requestId,
          inputDigest: digest(proposal),
        }),
      ).toEqual(receipt);
      expect((await client.enqueue(proposal)).proposalId).toBe(
        receipt.proposalId,
      );
      expect(rows("cc_project_goal_extension_drafts")).toBe(1);
      expect(rows("cc_business_action_runs")).toBe(0);
      expect(rows("project_tasks")).toBe(1);
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
      host.closeCliConnection(event);
      expect(
        host.listExternalDraftGrants(event, { goalRef: ref() }).entries[0],
      ).toMatchObject({ enabled: true, savedCount: 1 });
      db.close();
      open();
      const grant = host.listExternalDraftGrants(event, { goalRef: ref() })
        .entries[0];
      const pending = host.listExternalDrafts(event, {
        goalRef: ref(),
        id: grant.id,
      });
      expect(pending.entries[0].id).toBe(receipt.proposalId);
      const prepared = host.prepareExternalDraft(event, {
        goalRef: ref(),
        id: grant.id,
        draftId: receipt.proposalId,
      });
      expect(
        db.prepare("SELECT description FROM project_tasks").get().description,
      ).toBe("Original");
      expect(
        (await host.executeIntent(event, { intentId: prepared.intent.id })).run
          .status,
      ).toBe("succeeded");
      expect(
        db
          .prepare(
            creation
              ? "SELECT description FROM project_tasks WHERE task_type='analyze_data'"
              : "SELECT description FROM project_tasks",
          )
          .get().description,
      ).toBe(proposal.description);
      expect(rows("project_tasks")).toBe(creation ? 2 : 1);
      const detail = electron.dialog.showMessageBox.mock.calls.at(-1)[1].detail;
      expect(detail).toContain("在线来源待审草稿");
      expect(detail).toContain(grant.id);
      host.revokeExternalDraftGrant(event, {
        goalRef: ref(),
        id: grant.id,
        expectedEpoch: grant.epoch,
      });
      expect(
        host.listExternalDraftGrants(event, { goalRef: ref() }).entries[0]
          .enabled,
      ).toBe(false);
      expect(
        host.readIntent(event, { intentId: prepared.intent.id }).executionState,
      ).toBe("succeeded");
      expect(
        (await host.executeIntent(event, { intentId: prepared.intent.id }))
          .replayed,
      ).toBe(true);
      expect(rows("project_tasks")).toBe(creation ? 2 : 1);
    },
    180000,
  );
  it("revokes description and creation grants independently and closes only the matching connection", async () => {
    enableCreation();
    await host.openCliConnection(event, { goalRef: ref(), drafts: true });
    const description = host.listExternalDraftGrants(event, { goalRef: ref() })
      .entries[0];
    host.closeCliConnection(event);
    const access = JSON.parse(fs.readFileSync(file, "utf8"));
    access.schema = "chainlesschain.goal-create-draft-access/v1";
    fs.writeFileSync(file, JSON.stringify(access));
    electron.dialog.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(directory, "goal-connections", "creation.json"),
    });
    await host.openCliConnection(event, { goalRef: ref(), createDrafts: true });
    const prompt = electron.dialog.showMessageBox.mock.calls.at(-1)[1];
    expect(prompt.title).toContain("创建任务");
    expect(prompt.detail).toContain("说明草稿的旧授权不能替代");
    const creation = host
      .listExternalDraftGrants(event, { goalRef: ref() })
      .entries.find((item) => item.type === "task.create");
    expect(creation.id).not.toBe(description.id);
    host.revokeExternalDraftGrant(event, {
      goalRef: ref(),
      id: description.id,
      expectedEpoch: description.epoch,
    });
    expect(host.cliConnectionStatus(event).enabled).toBe(true);
    host.revokeExternalDraftGrant(event, {
      goalRef: ref(),
      id: creation.id,
      expectedEpoch: creation.epoch,
    });
    expect(host.cliConnectionStatus(event).enabled).toBe(false);
  });
  it("rejects creation/description access-file substitution and mixed connection profiles", async () => {
    enableCreation();
    await expect(
      host.openCliConnection(event, {
        goalRef: ref(),
        createDrafts: true,
        drafts: true,
      }),
    ).rejects.toThrow();
    await expect(
      host.openCliConnection(event, { goalRef: ref(), createDrafts: true }),
    ).rejects.toThrow();
    const access = JSON.parse(fs.readFileSync(file, "utf8"));
    access.schema = "chainlesschain.goal-create-draft-access/v1";
    fs.writeFileSync(file, JSON.stringify(access));
    await expect(
      host.openCliConnection(event, { goalRef: ref(), drafts: true }),
    ).rejects.toThrow();
    expect(
      host.listExternalDraftGrants(event, { goalRef: ref() }).entries,
    ).toEqual([]);
  });
  it("stopping a delayed native access picker cannot persist a grant", async () => {
    let finish;
    electron.dialog.showOpenDialog.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const opening = host.openCliConnection(event, {
      goalRef: ref(),
      drafts: true,
    });
    host.closeCliConnection(event);
    finish({ canceled: false, filePaths: [file] });
    await expect(opening).rejects.toThrow("GOAL_BRIDGE_UNAVAILABLE");
    expect(
      host.listExternalDraftGrants(event, { goalRef: ref() }).entries,
    ).toEqual([]);
  });
  it("rejects renderer-supplied identity/path and combined evidence authority", async () => {
    for (const extra of [
      { path: file },
      { plugin: { name: "injected" } },
      { evidence: true },
    ])
      await expect(
        host.openCliConnection(event, {
          goalRef: ref(),
          drafts: true,
          ...extra,
        }),
      ).rejects.toThrow();
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  });
  it("rechecks navigation before creating a persistent grant from native consent", async () => {
    electron.dialog.showMessageBox.mockImplementation(async () => {
      event.sender.emit("did-start-navigation");
      return { response: 1 };
    });
    await expect(
      host.openCliConnection(event, { goalRef: ref(), drafts: true }),
    ).rejects.toThrow();
    expect(
      host.listExternalDraftGrants(event, { goalRef: ref() }).entries,
    ).toEqual([]);
  });
});
