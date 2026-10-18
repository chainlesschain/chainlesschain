import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { createGoal, getGoal, setStatus } from "../../src/lib/goal-store.js";
import {
  readCliGoalExtensionPanels,
  _deps,
} from "../../src/lib/plugin-runtime/cli-goal-extension-host.js";
import {
  trustPlugin,
  untrustPlugin,
  _deps as trustDeps,
} from "../../src/lib/plugin-runtime/trust.js";
import {
  consentPluginCapabilities,
  revokeCapabilityConsent,
  _deps as consentDeps,
} from "../../src/lib/plugin-runtime/capability-consent.js";
import { normalizeCapabilities } from "../../src/lib/plugin-runtime/capabilities.js";
import { registerGoalCommand } from "../../src/commands/goal.js";
import { parseCliGoalPanels } from "../../../vscode-extension/src/plugin-manager.js";

const sample = JSON.parse(
  fs.readFileSync(
    fileURLToPath(
      new URL(
        "../../src/lib/plugin-runtime/examples/goal-progress-viewer/plugin.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
);
let temp, root, cwd, nameDir, options, goal;
function allow() {
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
}
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-cli-goal-panels-"));
  root = path.join(temp, "home", "goals");
  cwd = path.join(temp, "workspace");
  nameDir = path.join(cwd, ".chainlesschain", "plugins", sample.name);
  fs.mkdirSync(path.join(nameDir, sample.version), { recursive: true });
  fs.writeFileSync(
    path.join(nameDir, sample.version, "plugin.json"),
    JSON.stringify(sample),
  );
  fs.writeFileSync(path.join(nameDir, ".active"), sample.version);
  const managedSettingsFile = path.join(temp, "managed-settings.json");
  fs.writeFileSync(managedSettingsFile, "{}");
  vi.spyOn(trustDeps, "storePath").mockReturnValue(
    path.join(temp, "trust.json"),
  );
  vi.spyOn(trustDeps, "workspaceTrustStorePath").mockReturnValue(
    path.join(temp, "workspace-trust.json"),
  );
  vi.spyOn(consentDeps, "storePath").mockReturnValue(
    path.join(temp, "consent.json"),
  );
  vi.stubEnv("CC_PLUGIN_TRANSACTION_HOME", path.join(temp, "transactions"));
  options = {
    cwd,
    root,
    managedSettingsFile,
    env: {
      ...process.env,
      CC_PLUGINS: "1",
      CC_PLUGIN_SCOPES: "project",
      CHAINLESSCHAIN_HOME: path.join(temp, "home"),
    },
    plugin: sample.name,
    scope: "project",
  };
  goal = createGoal({ objective: "Ship the local release" }, { root });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = 0;
  fs.rmSync(temp, { recursive: true, force: true });
});

describe("standalone CLI goal extension host", () => {
  it("does not fall back to a standalone source when an explicit connection is empty", async () => {
    await expect(
      readCliGoalExtensionPanels(goal.id, { ...options, connection: "" }),
    ).rejects.toThrow("CLI_GOAL_CONNECTION_UNAVAILABLE");
  });
  it("requires real workspace trust and stored capability consent", async () => {
    expect(
      (await readCliGoalExtensionPanels(goal.id, options)).dropped,
    ).toContainEqual(expect.objectContaining({ reason: "untrusted" }));
    trustPlugin(sample.name, {
      scope: "project",
      version: sample.version,
      workspaceRoot: cwd,
    });
    expect(
      (await readCliGoalExtensionPanels(goal.id, options)).dropped,
    ).toContainEqual(expect.objectContaining({ reason: "consent_required" }));
    allow();
    const before = fs.readFileSync(path.join(root, `${goal.id}.json`), "utf8");
    const result = await readCliGoalExtensionPanels(goal.id, options);
    expect(result).toMatchObject({
      snapshot: true,
      goalRef: { id: goal.id, revision: 1 },
    });
    expect(result.panels).toHaveLength(1);
    expect(result.panels[0].text).toContain(
      "objective: Ship the local release",
    );
    expect(result.panels[0].text).toContain("status: active");
    expect(fs.readFileSync(path.join(root, `${goal.id}.json`), "utf8")).toBe(
      before,
    );
    expect(
      parseCliGoalPanels(JSON.stringify(result), {
        id: goal.id,
        name: sample.name,
        scope: "project",
      }).panels,
    ).toHaveLength(1);
  });
  it("uses the fixed host environment to select the configured goal store", async () => {
    allow();
    const { root: ignored, ...fromEnv } = options;
    expect(
      (await readCliGoalExtensionPanels(goal.id, fromEnv)).goalRef.storeId,
    ).toBe(goal.storeId);
  });
  it.each(["disable", "consent", "trust", "uninstall", "policy"])(
    "removes a completed projection after %s before output",
    async (mode) => {
      allow();
      const project = _deps.projectGoalExtensionPanel;
      vi.spyOn(_deps, "projectGoalExtensionPanel").mockImplementation(
        async (...args) => {
          const result = await project(...args);
          if (mode === "disable")
            fs.writeFileSync(path.join(nameDir, ".disabled"), "disabled");
          if (mode === "consent")
            revokeCapabilityConsent(sample.name, { scope: "project" });
          if (mode === "trust")
            untrustPlugin(sample.name, {
              scope: "project",
              workspaceRoot: cwd,
            });
          if (mode === "uninstall")
            fs.unlinkSync(path.join(nameDir, ".active"));
          if (mode === "policy")
            fs.writeFileSync(
              options.managedSettingsFile,
              JSON.stringify({ deniedPlugins: [sample.name] }),
            );
          return result;
        },
      );
      const result = await readCliGoalExtensionPanels(goal.id, options);
      expect(result.panels).toEqual([]);
      expect(result.dropped).toContainEqual(
        expect.objectContaining({
          name: sample.name,
          reason: "admission_changed",
        }),
      );
    },
  );
  it.each(["revision", "same-revision-content", "delete"])(
    "rejects goal %s changes while projecting",
    async (mode) => {
      allow();
      const project = _deps.projectGoalExtensionPanel;
      vi.spyOn(_deps, "projectGoalExtensionPanel").mockImplementation(
        async (...args) => {
          const result = await project(...args);
          if (mode === "revision") setStatus(goal.id, "paused", { root });
          if (mode === "same-revision-content") {
            const record = getGoal(goal.id, { root });
            fs.writeFileSync(
              path.join(root, `${goal.id}.json`),
              JSON.stringify({
                ...record,
                objective: "Changed without a revision",
              }),
            );
          }
          if (mode === "delete")
            fs.unlinkSync(path.join(root, `${goal.id}.json`));
          return result;
        },
      );
      await expect(
        readCliGoalExtensionPanels(goal.id, options),
      ).rejects.toThrow(/CLI_GOAL_SOURCE_CHANGED/);
    },
  );
  it("reads an old record without createdAt repeatedly without rewriting or acquiring authority", async () => {
    allow();
    const file = path.join(root, "legacy.json");
    const raw = JSON.stringify({
      id: "legacy",
      objective: "An old goal",
      status: "paused",
    });
    fs.writeFileSync(file, raw);
    const project = _deps.projectGoalExtensionPanel;
    vi.spyOn(_deps, "projectGoalExtensionPanel").mockImplementation(
      async (...args) => {
        const result = await project(...args);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return result;
      },
    );
    const result = await readCliGoalExtensionPanels("legacy", options);
    expect(result.panels[0].text).toContain("An old goal");
    expect(fs.readFileSync(file, "utf8")).toBe(raw);
    expect(result).not.toHaveProperty("projectRef");
  });
  it.each(["ownerRef", "projectRef"])(
    "rejects schema-less project authority field %s before legacy upgrade",
    async (field) => {
      allow();
      fs.writeFileSync(
        path.join(root, "copied.json"),
        JSON.stringify({
          id: "copied",
          objective: "Foreign project",
          [field]: { id: "foreign" },
        }),
      );
      await expect(
        readCliGoalExtensionPanels("copied", options),
      ).rejects.toThrow(/GOAL_PROJECT_STORE_REQUIRED/);
    },
  );
  it("truncates a long objective for display but detects a change in its unseen tail", async () => {
    allow();
    goal = createGoal(
      { objective: "x".repeat(5000), title: "Long goal" },
      { root },
    );
    const result = await readCliGoalExtensionPanels(goal.id, options);
    expect(result.panels[0].text).toContain("[truncated]");
    const project = _deps.projectGoalExtensionPanel;
    vi.spyOn(_deps, "projectGoalExtensionPanel").mockImplementation(
      async (...args) => {
        const panel = await project(...args);
        fs.writeFileSync(
          path.join(root, `${goal.id}.json`),
          JSON.stringify({ ...goal, objective: "x".repeat(4999) + "y" }),
        );
        return panel;
      },
    );
    await expect(readCliGoalExtensionPanels(goal.id, options)).rejects.toThrow(
      /SOURCE_CHANGED/,
    );
  });
  it("fails closed for corrupt, oversized, or traversal-selected source files", async () => {
    allow();
    fs.writeFileSync(path.join(root, "corrupt.json"), "{bad");
    fs.writeFileSync(path.join(root, "oversized.json"), " ".repeat(65537));
    for (const id of ["corrupt", "oversized", "../elsewhere"]) {
      await expect(readCliGoalExtensionPanels(id, options)).rejects.toThrow(
        /GOAL_RECORD_CORRUPT|GOAL_INVALID_ID/,
      );
    }
  });
  it.runIf(process.platform !== "win32")(
    "rejects a symlinked source without reading its target",
    async () => {
      allow();
      fs.symlinkSync(
        path.join(root, `${goal.id}.json`),
        path.join(root, "linked.json"),
      );
      await expect(
        readCliGoalExtensionPanels("linked", options),
      ).rejects.toThrow(/GOAL_RECORD_CORRUPT/);
    },
  );
  it("does not interpret risk/proposal declarations as standalone CLI authority", async () => {
    allow();
    const file = path.join(nameDir, sample.version, "plugin.json");
    const expanded = structuredClone(sample);
    expanded.goalExtension.proposals = ["task.create"];
    expanded.permissions.goalExtension.push("proposal:task.create");
    fs.writeFileSync(file, JSON.stringify(expanded));
    const result = await readCliGoalExtensionPanels(goal.id, options);
    expect(result.panels).toEqual([]);
    expect(result.dropped).toContainEqual(
      expect.objectContaining({ reason: "unsupported_capabilities" }),
    );
  });
  it("serves the actual goal command as JSON and strips terminal escape sequences in text output", async () => {
    allow();
    vi.stubEnv("CHAINLESSCHAIN_HOME", path.join(temp, "home"));
    vi.stubEnv("CC_PLUGIN_SCOPES", "project");
    vi.stubEnv("CC_PLUGINS", "1");
    vi.stubEnv("CC_MANAGED_SETTINGS", options.managedSettingsFile);
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    goal = createGoal({ objective: "Before\u001b[31mred\u001b[0m" }, { root });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    async function run(json) {
      const program = new Command();
      registerGoalCommand(program);
      await program.parseAsync([
        "node",
        "cc",
        "goal",
        "panels",
        goal.id,
        `--plugin=${sample.name}`,
        "--scope",
        "project",
        ...(json ? ["--json"] : []),
      ]);
    }
    await run(true);
    expect(JSON.parse(log.mock.calls[0][0]).panels).toHaveLength(1);
    log.mockClear();
    await run(false);
    expect(log.mock.calls.flat().join(" ")).toContain("Beforered");
    expect(log.mock.calls.flat().join(" ")).not.toContain("\u001b");
  });
});
