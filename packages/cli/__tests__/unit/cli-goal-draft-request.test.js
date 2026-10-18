import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProjectGoalConnection } from "../../src/lib/project-goal-connection.js";
import { exportCliGoalDraftRequest } from "../../src/lib/plugin-runtime/cli-goal-draft-request.js";
import {
  createGoalDraftRequest,
  validateGoalDraftRequest,
} from "@chainlesschain/session-core/goal-draft-request-contract";
import {
  trustPlugin,
  _deps as trustDeps,
} from "../../src/lib/plugin-runtime/trust.js";
import {
  consentPluginCapabilities,
  _deps as consentDeps,
} from "../../src/lib/plugin-runtime/capability-consent.js";
import { normalizeCapabilities } from "../../src/lib/plugin-runtime/capabilities.js";
import {
  buildCliGoalDraftRequestArgs,
  parseCliGoalDraftExport,
} from "../../../vscode-extension/src/plugin-manager.js";
vi.mock("../../src/lib/project-goal-connection.js", () => ({
  createProjectGoalConnection: vi.fn(),
}));
let temp, options, sample, snapshot, reads;
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-draft-export-"));
  const cwd = path.join(temp, "workspace");
  sample = JSON.parse(
    fs.readFileSync(
      new URL(
        "../../src/lib/plugin-runtime/examples/goal-description-drafter/plugin.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const dir = path.join(cwd, ".chainlesschain", "plugins", sample.name);
  fs.mkdirSync(path.join(dir, sample.version), { recursive: true });
  fs.writeFileSync(
    path.join(dir, sample.version, "plugin.json"),
    JSON.stringify(sample),
  );
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
    connection: path.join(temp, "private.json"),
    plugin: sample.name,
    scope: "project",
    source: `goal-proposal-${"a".repeat(64)}`,
    requestId: "stable-request",
    title: "Follow-up",
    descriptionFile: "description.txt",
    out: path.join(temp, "request.json"),
    managedSettingsFile: path.join(temp, "managed.json"),
    env: {
      ...process.env,
      CC_PLUGINS: "1",
      CC_PLUGIN_SCOPES: "project",
      CC_PLUGIN_TRANSACTION_HOME: path.join(temp, "transactions"),
    },
  };
  fs.writeFileSync(
    path.join(cwd, options.descriptionFile),
    "Proposed plain text\nwith two lines.",
  );
  snapshot = {
    goalRef: {
      id: "goal-1",
      storeId: "project-goals-12345678-1234-1234-1234-123456789abc",
      revision: 2,
      controlGeneration: 1,
    },
    objective: "Delivery",
    status: "active",
  };
  reads = vi.fn(async () => structuredClone(snapshot));
  createProjectGoalConnection.mockReturnValue({ read: reads });
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
describe("CLI untrusted request-file export", () => {
  it("requires real plugin trust and capability consent before exporting", async () => {
    await expect(exportCliGoalDraftRequest("goal-1", options)).rejects.toThrow(
      "NOT_ADMITTED",
    );
    allow();
    const result = await exportCliGoalDraftRequest("goal-1", options);
    expect(result.state).toBe("request-exported");
    const request = validateGoalDraftRequest(
      JSON.parse(fs.readFileSync(options.out, "utf8")),
    );
    expect(request.proposal.description).toContain("two lines");
    expect(request).not.toHaveProperty("approval");
    expect(request).not.toHaveProperty("key");
  });
  it("never overwrites an existing export", async () => {
    allow();
    fs.writeFileSync(options.out, "Existing");
    await expect(
      exportCliGoalDraftRequest("goal-1", options),
    ).rejects.toThrow();
    expect(fs.readFileSync(options.out, "utf8")).toBe("Existing");
  });
  it("pins the invocation fields and output path before asynchronous connection reads", async () => {
    allow();
    const original = { ...options },
      originalOut = options.out;
    reads.mockImplementationOnce(async () => {
      options.plugin = "different";
      options.scope = "user";
      options.descriptionFile = "different";
      options.out = path.join(temp, "unexpected.json");
      options.env.CC_PLUGIN_SCOPES = "user";
      return structuredClone(snapshot);
    });
    const result = await exportCliGoalDraftRequest("goal-1", options);
    expect(result.file).toBe(originalOut);
    expect(result.declaredPlugin.name).toBe(original.plugin);
    expect(fs.existsSync(options.out)).toBe(false);
  });
  it.each(["goal", "policy", "disable"])(
    "rejects %s changes before writing the export",
    async (kind) => {
      allow();
      reads
        .mockImplementationOnce(async () => structuredClone(snapshot))
        .mockImplementationOnce(async () => {
          if (kind === "goal") snapshot.objective = "Changed";
          if (kind === "policy")
            fs.writeFileSync(
              options.managedSettingsFile,
              JSON.stringify({ deniedPlugins: [sample.name] }),
            );
          if (kind === "disable")
            fs.writeFileSync(
              path.join(
                options.cwd,
                ".chainlesschain",
                "plugins",
                sample.name,
                ".disabled",
              ),
              "disabled",
            );
          return structuredClone(snapshot);
        });
      await expect(
        exportCliGoalDraftRequest("goal-1", options),
      ).rejects.toThrow("SOURCE_CHANGED");
      expect(fs.existsSync(options.out)).toBe(false);
    },
  );
  it("rejects oversized or invalid UTF-8 description files and mismatched stores", async () => {
    allow();
    await expect(
      exportCliGoalDraftRequest("goal-1", {
        ...options,
        expectedStore: "foreign",
      }),
    ).rejects.toThrow("STORE_MISMATCH");
    for (const data of [Buffer.alloc(8193, 97), Buffer.from([255, 254])]) {
      fs.writeFileSync(path.join(options.cwd, options.descriptionFile), data);
      await expect(
        exportCliGoalDraftRequest("goal-1", options),
      ).rejects.toThrow();
    }
    expect(fs.existsSync(options.out)).toBe(false);
  });
  it("validates envelope content, bytes and native-only proposal shape", async () => {
    allow();
    await exportCliGoalDraftRequest("goal-1", options);
    const request = JSON.parse(fs.readFileSync(options.out, "utf8"));
    expect(() =>
      validateGoalDraftRequest({ ...request, approved: true }),
    ).toThrow();
    expect(() =>
      validateGoalDraftRequest({
        ...request,
        contentDigest: `sha256:${"0".repeat(64)}`,
      }),
    ).toThrow();
    expect(() =>
      createGoalDraftRequest({
        ...request,
        proposal: { ...request.proposal, type: "task.create" },
      }),
    ).toThrow();
    expect(() =>
      createGoalDraftRequest({
        ...request,
        proposal: { ...request.proposal, description: "中".repeat(3000) },
      }),
    ).toThrow();
  });
  it("builds fixed IDE argv and accepts only a matching exported-file result", async () => {
    allow();
    const result = await exportCliGoalDraftRequest("goal-1", options),
      input = {
        ...options,
        id: "goal-1",
        name: sample.name,
        expectedStore: snapshot.goalRef.storeId,
      };
    const args = buildCliGoalDraftRequestArgs(input);
    expect(args).toContain(`--out=${options.out}`);
    expect(args).not.toContain("Proposed plain text");
    expect(parseCliGoalDraftExport(JSON.stringify(result), input)?.file).toBe(
      options.out,
    );
    expect(
      parseCliGoalDraftExport(
        JSON.stringify({ ...result, state: "succeeded" }),
        input,
      ),
    ).toBeNull();
    expect(() =>
      buildCliGoalDraftRequestArgs({ ...input, connection: undefined }),
    ).toThrow();
  });
});
