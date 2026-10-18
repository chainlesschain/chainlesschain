import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProjectGoalConnection } from "../../src/lib/project-goal-connection.js";
import {
  readCliGoalExtensionPanels,
  _deps,
} from "../../src/lib/plugin-runtime/cli-goal-extension-host.js";
import {
  trustPlugin,
  _deps as trustDeps,
} from "../../src/lib/plugin-runtime/trust.js";
import {
  consentPluginCapabilities,
  _deps as consentDeps,
} from "../../src/lib/plugin-runtime/capability-consent.js";
import { normalizeCapabilities } from "../../src/lib/plugin-runtime/capabilities.js";

// This suite isolates SDK admission and snapshot behavior. Native SQLite,
// credential permissions and real signed HTTP are exercised by the desktop suite.
vi.mock("../../src/lib/project-goal-connection.js", () => ({
  createProjectGoalConnection: vi.fn(),
}));
let temp, options, sample, record, pluginFile;
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-evidence-host-"));
  const cwd = path.join(temp, "workspace");
  sample = JSON.parse(
    fs.readFileSync(
      new URL(
        "../../src/lib/plugin-runtime/examples/goal-evidence-viewer/plugin.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const dir = path.join(cwd, ".chainlesschain", "plugins", sample.name);
  fs.mkdirSync(path.join(dir, sample.version), { recursive: true });
  pluginFile = path.join(dir, sample.version, "plugin.json");
  fs.writeFileSync(pluginFile, JSON.stringify(sample));
  fs.writeFileSync(path.join(dir, ".active"), sample.version);
  vi.spyOn(trustDeps, "storePath").mockReturnValue(
    path.join(temp, "trust.json"),
  );
  vi.spyOn(trustDeps, "workspaceTrustStorePath").mockReturnValue(
    path.join(temp, "workspace-trust.json"),
  );
  vi.spyOn(consentDeps, "storePath").mockReturnValue(
    path.join(temp, "consent.json"),
  );
  options = {
    cwd,
    connection: "explicit-connection.json",
    plugin: sample.name,
    scope: "project",
    managedSettingsFile: path.join(temp, "managed.json"),
    env: {
      ...process.env,
      CC_PLUGINS: "1",
      CC_PLUGIN_SCOPES: "project",
      CC_PLUGIN_TRANSACTION_HOME: path.join(temp, "transactions"),
    },
  };
  record = {
    goalRef: {
      id: "goal-1",
      storeId: "store-1",
      revision: 2,
      controlGeneration: 1,
    },
    objective: "Track delivery",
    status: "active",
    risk: { state: "not-recorded" },
    receipts: { state: "recorded", entries: [], hasMore: false },
  };
  createProjectGoalConnection.mockReturnValue({
    goalRef: record.goalRef,
    evidence: true,
    read: async () => structuredClone(record),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(temp, { recursive: true, force: true });
});
function allow() {
  trustPlugin(sample.name, {
    scope: "project",
    version: sample.version,
    workspaceRoot: options.cwd,
  });
  consentPluginCapabilities(sample.name, {
    scope: "project",
    version: sample.version,
    capabilities: normalizeCapabilities(sample.permissions),
  });
}
describe("CLI evidence capability and snapshot pinning", () => {
  it("requires the separate plugin capability consent even with a host evidence lease", async () => {
    trustPlugin(sample.name, {
      scope: "project",
      version: sample.version,
      workspaceRoot: options.cwd,
    });
    const denied = await readCliGoalExtensionPanels(record.goalRef.id, options);
    expect(denied.panels).toEqual([]);
    expect(denied.dropped).toContainEqual(
      expect.objectContaining({ reason: "consent_required" }),
    );
    allow();
    expect(
      (await readCliGoalExtensionPanels(record.goalRef.id, options)).panels[0]
        .slot,
    ).toBe("goal.evidence");
  });
  it("a summary-only lease cannot admit the evidence declaration", async () => {
    allow();
    createProjectGoalConnection.mockReturnValue({
      goalRef: record.goalRef,
      evidence: false,
      read: async () => ({
        goalRef: record.goalRef,
        objective: record.objective,
        status: record.status,
      }),
    });
    const value = await readCliGoalExtensionPanels(record.goalRef.id, options);
    expect(value.panels).toEqual([]);
    expect(value.dropped).toContainEqual(
      expect.objectContaining({ reason: "unsupported_capabilities" }),
    );
  });
  it("a summary slot cannot request evidence fields even under an evidence lease", async () => {
    sample.permissions.goalExtension = ["panel:goal.summary"];
    sample.goalExtension.panels[0].slot = "goal.summary";
    fs.writeFileSync(pluginFile, JSON.stringify(sample));
    allow();
    const value = await readCliGoalExtensionPanels(record.goalRef.id, options);
    expect(value.panels).toEqual([]);
    expect(value.dropped).toContainEqual(
      expect.objectContaining({ reason: "panel_unavailable" }),
    );
  });
  it.each(["risk", "receipts"])(
    "rejects changed %s after projection even when the goal reference is unchanged",
    async (field) => {
      allow();
      const project = _deps.projectGoalExtensionPanel;
      vi.spyOn(_deps, "projectGoalExtensionPanel").mockImplementation(
        async (...args) => {
          const value = await project(...args);
          if (field === "risk") record.risk = { state: "unavailable" };
          else
            record.receipts.entries.push({
              id: "run-new",
              status: "unresolved",
              actionType: "task.create",
              goalRevision: 2,
              controlGeneration: 1,
              history: true,
            });
          return value;
        },
      );
      await expect(
        readCliGoalExtensionPanels(record.goalRef.id, options),
      ).rejects.toThrow("CLI_GOAL_CONNECTION_CHANGED");
    },
  );
});
