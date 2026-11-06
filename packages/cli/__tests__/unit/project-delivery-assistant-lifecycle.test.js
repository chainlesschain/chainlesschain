import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  installFromDirectory,
  setPluginEnabled,
  uninstall,
} from "../../src/lib/plugin-runtime/install.js";
import {
  trustPlugin,
  _deps as trustDeps,
} from "../../src/lib/plugin-runtime/trust.js";
import {
  consentPluginCapabilities,
  revokeCapabilityConsent,
  _deps as consentDeps,
} from "../../src/lib/plugin-runtime/capability-consent.js";
import { normalizeCapabilities } from "../../src/lib/plugin-runtime/capabilities.js";
import { cliGoalExtensionHost } from "../../src/lib/plugin-runtime/cli-goal-capabilities.js";
import { collectGoalExtensions } from "../../src/lib/plugin-runtime/goal-extensions.js";
import { exportCliGoalDraftAccess } from "../../src/lib/plugin-runtime/cli-goal-drafts.js";

const source = fileURLToPath(
  new URL(
    "../../src/lib/plugin-runtime/examples/project-delivery-assistant",
    import.meta.url,
  ),
);
const sample = JSON.parse(
  fs.readFileSync(path.join(source, "plugin.json"), "utf8"),
);
let directory, cwd, options, installOptions;
function consent(manifest = sample) {
  consentPluginCapabilities(manifest.name, {
    scope: "project",
    version: manifest.version,
    capabilities: normalizeCapabilities(manifest.permissions),
  });
}
function trust(manifest = sample) {
  trustPlugin(manifest.name, {
    scope: "project",
    version: manifest.version,
    workspaceRoot: cwd,
  });
}
function admission() {
  return collectGoalExtensions({
    ...options,
    host: cliGoalExtensionHost(["proposal:task.description.update"]),
  });
}
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-delivery-assistant-"));
  cwd = path.join(directory, "workspace");
  fs.mkdirSync(cwd);
  vi.stubEnv(
    "CC_PLUGIN_TRANSACTION_HOME",
    path.join(directory, "transactions"),
  );
  vi.stubEnv("CC_MANAGED_SETTINGS", path.join(directory, "policy.json"));
  vi.spyOn(trustDeps, "storePath").mockReturnValue(
    path.join(directory, "trust.json"),
  );
  vi.spyOn(trustDeps, "workspaceTrustStorePath").mockReturnValue(
    path.join(directory, "workspace-trust.json"),
  );
  vi.spyOn(consentDeps, "storePath").mockReturnValue(
    path.join(directory, "consent.json"),
  );
  fs.writeFileSync(process.env.CC_MANAGED_SETTINGS, "{}");
  options = {
    cwd,
    plugin: sample.name,
    scope: "project",
    managedSettingsFile: process.env.CC_MANAGED_SETTINGS,
    env: { ...process.env, CC_PLUGINS: "1", CC_PLUGIN_SCOPES: "project" },
    out: path.join(directory, "access.json"),
  };
  installOptions = {
    cwd,
    scope: "project",
    managedSettingsFile: options.managedSettingsFile,
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});
describe("installable project delivery assistant", () => {
  it("installs the shipped source without code entrypoints and requires trust plus full consent", async () => {
    const installed = installFromDirectory(source, installOptions);
    expect(installed).toMatchObject({
      name: sample.name,
      version: "0.3.0",
      scope: "project",
    });
    expect(admission().dropped[0].reason).toBe("untrusted");
    trust();
    expect(admission().dropped[0].reason).toBe("consent_required");
    consent();
    expect(admission().extensions).toHaveLength(1);
    await exportCliGoalDraftAccess(options);
    const access = JSON.parse(fs.readFileSync(options.out, "utf8"));
    expect(access.plugin.name).toBe(sample.name);
    expect(access.schema).toBe("chainlesschain.goal-draft-access/v1");
    expect(JSON.stringify(access)).not.toMatch(/endpoint|"key"|task.create/);
  });
  it("preserves exported references through disable/uninstall, and only exports again on explicit re-request after reinstall", async () => {
    installFromDirectory(source, installOptions);
    trust();
    consent();
    await exportCliGoalDraftAccess(options);
    const original = fs.readFileSync(options.out);
    setPluginEnabled(sample.name, false, installOptions);
    await expect(
      exportCliGoalDraftAccess({
        ...options,
        out: path.join(directory, "disabled.json"),
      }),
    ).rejects.toThrow("NOT_ADMITTED");
    expect(admission().dropped[0].reason).toBe("disabled");
    uninstall(sample.name, installOptions);
    expect(admission().extensions).toEqual([]);
    expect(fs.readFileSync(options.out)).toEqual(original);
    installFromDirectory(source, installOptions);
    expect(fs.existsSync(path.join(directory, "disabled.json"))).toBe(false);
    expect(fs.readFileSync(options.out)).toEqual(original);
    await exportCliGoalDraftAccess({
      ...options,
      out: path.join(directory, "explicit-resume.json"),
    });
    expect(
      fs.readFileSync(path.join(directory, "explicit-resume.json")),
    ).toEqual(original);
    revokeCapabilityConsent(sample.name, { scope: "project" });
    expect(admission().dropped[0].reason).toBe("consent_required");
  });
  it("requires version trust and new creation consent when upgrading the previous combined assistant", () => {
    const candidate = path.join(directory, "source");
    fs.mkdirSync(candidate);
    const old = structuredClone(sample);
    old.version = "0.2.0";
    old.permissions.goalExtension = old.permissions.goalExtension.filter(
      (value) => value !== "proposal:task.create",
    );
    old.goalExtension.proposals = ["task.description.update"];
    fs.writeFileSync(path.join(candidate, "plugin.json"), JSON.stringify(old));
    installFromDirectory(candidate, installOptions);
    trust(old);
    consent(old);
    expect(admission().extensions).toHaveLength(1);
    fs.writeFileSync(
      path.join(candidate, "plugin.json"),
      JSON.stringify(sample),
    );
    installFromDirectory(candidate, installOptions);
    expect(admission().dropped[0].reason).toBe("untrusted");
    trust();
    expect(admission().dropped[0].reason).toBe("consent_required");
    consent();
    expect(admission().extensions[0].version).toBe(sample.version);
  });
});
