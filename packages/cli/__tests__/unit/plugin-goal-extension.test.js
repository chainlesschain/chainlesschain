import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeGoalExtension,
  checkGoalExtensionCompatibility,
  requiredGoalExtensionCapabilities,
  summarizeGoalExtension,
} from "../../src/lib/plugin-runtime/goal-extension-contract.js";
import {
  normalizeCapabilities,
  diffCapabilities,
  describeCapabilities,
} from "../../src/lib/plugin-runtime/capabilities.js";
import {
  capabilityConsentStatus,
  capabilitiesAreEmpty,
  consentPluginCapabilities,
  revokeCapabilityConsent,
  _deps as consentDeps,
} from "../../src/lib/plugin-runtime/capability-consent.js";
import { parsePluginManifest } from "../../src/lib/plugin-runtime/manifest.js";
import {
  _deps,
  collectGoalExtensions,
  projectGoalExtensionEvent,
  projectGoalExtensionPanel,
  proposeGoalExtensionAction,
} from "../../src/lib/plugin-runtime/goal-extensions.js";

const sampleDir = fileURLToPath(
  new URL(
    "../../src/lib/plugin-runtime/examples/project-delivery-assistant/",
    import.meta.url,
  ),
);
const sample = JSON.parse(
  fs.readFileSync(path.join(sampleDir, "plugin.json"), "utf8"),
);
const declaration = normalizeGoalExtension(
  sample.goalExtension,
  sample.permissions,
);
const host = {
  id: "cli",
  version: "0.166.104",
  capabilities: requiredGoalExtensionCapabilities(declaration),
};
const ref = { name: sample.name, version: sample.version, scope: "project" };
const source = {
  id: "goal-1",
  storeId: "project-store",
  revision: 2,
  controlGeneration: 1,
};
let temp;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (temp) {
    fs.rmSync(temp, { recursive: true, force: true });
    temp = undefined;
  }
});

describe("goal extension real files and management output", () => {
  it("requires stored consent and observes disable, uninstall and policy changes", () => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-goal-extension-io-"));
    const nameDir = path.join(temp, ".chainlesschain", "plugins", sample.name);
    const installedDir = path.join(nameDir, sample.version);
    fs.mkdirSync(installedDir, { recursive: true });
    fs.writeFileSync(
      path.join(installedDir, "plugin.json"),
      JSON.stringify(sample),
    );
    fs.writeFileSync(path.join(nameDir, ".active"), sample.version);
    const policyFile = path.join(temp, "managed-settings.json");
    fs.writeFileSync(policyFile, "{}");
    vi.stubEnv("CC_PLUGIN_TRANSACTION_HOME", path.join(temp, "transactions"));
    vi.spyOn(consentDeps, "storePath").mockReturnValue(
      path.join(temp, "consent.json"),
    );
    // Workspace trust is covered independently; discovery, policy, durable
    // consent and lifecycle reads here use real files.
    vi.spyOn(_deps, "isPluginTrusted").mockReturnValue(true);
    const options = {
      cwd: temp,
      managedSettingsFile: policyFile,
      env: { ...process.env, CC_PLUGINS: "1", CC_PLUGIN_SCOPES: "project" },
      host,
    };
    expect(collectGoalExtensions(options)).toMatchObject({
      extensions: [],
      dropped: [{ reason: "consent_required" }],
    });
    consentPluginCapabilities(sample.name, {
      scope: "project",
      version: sample.version,
      capabilities: normalizeCapabilities(sample.permissions),
    });
    expect(collectGoalExtensions(options).extensions).toHaveLength(1);
    fs.writeFileSync(
      policyFile,
      JSON.stringify({ deniedPlugins: [sample.name] }),
    );
    expect(collectGoalExtensions(options).dropped[0].reason).toBe(
      "policy_blocked",
    );
    fs.writeFileSync(policyFile, "{}");
    expect(collectGoalExtensions(options).extensions).toHaveLength(1);
    fs.writeFileSync(path.join(nameDir, ".disabled"), "disabled");
    expect(collectGoalExtensions(options).dropped[0].reason).toBe("disabled");
    fs.unlinkSync(path.join(nameDir, ".disabled"));
    revokeCapabilityConsent(sample.name, { scope: "project" });
    expect(collectGoalExtensions(options).dropped[0].reason).toBe(
      "consent_required",
    );
    fs.unlinkSync(path.join(nameDir, ".active"));
    expect(collectGoalExtensions(options).extensions).toEqual([]);
  });
  it("CLI validate reports declarations without granting consent or activating a host", async () => {
    const { Command } = await import("commander");
    const { registerPluginCommand } = await import(
      "../../src/commands/plugin.js"
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    registerPluginCommand(program);
    await program.parseAsync([
      "node",
      "cc",
      "plugin",
      "validate",
      sampleDir,
      "--json",
    ]);
    const result = JSON.parse(log.mock.calls[0][0]);
    expect(result.ok).toBe(true);
    expect(result.goalExtensionSummary).toMatchObject({
      status: "declaration-only",
      runtimeAvailable: false,
      hosts: { cli: ">=0.166.104", jetbrains: ">=0.4.166" },
    });
    expect(result.goalExtension.proposals).toContain("task.create");
  });
});

describe("goal extension declarations and consent", () => {
  it("parses the shipped data-only prototype without legacy code components", () => {
    const parsed = parsePluginManifest(sampleDir);
    expect(parsed.ok).toBe(true);
    expect(parsed.goalExtension).toEqual(declaration);
    expect(parsed.components.hooks).toBeNull();
    expect(parsed.components.bin).toEqual([]);
    expect(summarizeGoalExtension(parsed)).toMatchObject({
      status: "declaration-only",
      runtimeAvailable: false,
      apiCompatible: true,
    });
  });
  it("retains legacy behavior without granting the new API", () => {
    expect(normalizeGoalExtension(undefined)).toBeNull();
    expect(checkGoalExtensionCompatibility(null, host)).toEqual({
      compatible: false,
      reason: "legacy_unsupported",
    });
    expect(summarizeGoalExtension({})).toEqual({
      status: "legacy",
      runtimeAvailable: false,
    });
  });
  it.each([
    "handler",
    "module",
    "script",
    "html",
    "approved",
    "receipt",
    "actor",
  ])("rejects extension authority/code field %s", (field) => {
    expect(() =>
      normalizeGoalExtension(
        { ...sample.goalExtension, [field]: "forged" },
        sample.permissions,
      ),
    ).toThrow(/unsupported field/);
  });
  it("rejects executable panels, unknown events, duplicates and unbounded declarations", () => {
    const panel = sample.goalExtension.panels[0];
    expect(() =>
      normalizeGoalExtension(
        { ...sample.goalExtension, panels: [{ ...panel, html: "<script>" }] },
        sample.permissions,
      ),
    ).toThrow(/unsupported/);
    for (const events of [
      ["goal.execute"],
      ["goal.status.changed", "goal.status.changed"],
      Array(17).fill("goal.status.changed"),
    ]) {
      expect(() =>
        normalizeGoalExtension(
          { ...sample.goalExtension, events },
          sample.permissions,
        ),
      ).toThrow(/unique list/);
    }
    expect(() =>
      normalizeGoalExtension(
        { ...sample.goalExtension, hosts: { cli: "banana" } },
        sample.permissions,
      ),
    ).toThrow(/semver range/);
    expect(() =>
      normalizeGoalExtension(
        { ...sample.goalExtension, panels: [{ ...panel, fallback: "html" }] },
        sample.permissions,
      ),
    ).toThrow(/must be text/);
  });
  it("requires raw explicit goal capabilities; legacy coercions cannot grant them", () => {
    for (const permissions of [
      undefined,
      {},
      { goalExtension: true },
      { goalExtension: "event:goal.status.changed" },
      { goalExtension: ["*"] },
    ]) {
      expect(() =>
        normalizeGoalExtension(sample.goalExtension, permissions),
      ).toThrow();
    }
    expect(() =>
      normalizeGoalExtension(sample.goalExtension, { goalExtension: [] }),
    ).toThrow(/requires permissions/);
  });
  it("records invalid declarations as manifest errors", () => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-goal-extension-"));
    fs.writeFileSync(
      path.join(temp, "plugin.json"),
      JSON.stringify({ ...sample, permissions: {} }),
    );
    const parsed = parsePluginManifest(temp);
    expect(parsed.ok).toBe(false);
    expect(summarizeGoalExtension(parsed).status).toBe("invalid");
  });
  it.each([
    [{ ...declaration, apiVersion: "2.0.0" }, host, "unsupported_api"],
    [{ ...declaration, apiVersion: "1.1.0" }, host, "unsupported_api"],
    [declaration, { ...host, id: "mobile" }, "unsupported_host"],
    [declaration, { ...host, version: "0.1.0" }, "host_version_mismatch"],
    [declaration, { ...host, version: "invalid" }, "host_version_mismatch"],
    [declaration, { ...host, capabilities: [] }, "unsupported_capabilities"],
  ])(
    "rejects incompatible contracts with a distinct reason",
    (extension, candidate, reason) => {
      expect(
        checkGoalExtensionCompatibility(extension, candidate),
      ).toMatchObject({ compatible: false, reason });
    },
  );
  it("does not turn a syntactically valid future API into a corrupted manifest", () => {
    const future = normalizeGoalExtension(
      { ...sample.goalExtension, apiVersion: "2.0.0" },
      sample.permissions,
    );
    expect(future.apiVersion).toBe("2.0.0");
    expect(checkGoalExtensionCompatibility(declaration, host).compatible).toBe(
      true,
    );
  });
  it("old canonical consent cannot cover new grants; widened goal permissions require consent", () => {
    const old = normalizeCapabilities({ process: true });
    const next = normalizeCapabilities({
      process: true,
      ...sample.permissions,
    });
    expect(
      capabilitiesAreEmpty(normalizeCapabilities(sample.permissions)),
    ).toBe(false);
    expect(
      capabilityConsentStatus(next, { version: "1.0.0", capabilities: old }),
    ).toMatchObject({ consented: false });
    expect(
      capabilityConsentStatus(next, { capabilities: next }).consented,
    ).toBe(true);
    const narrow = normalizeCapabilities({
      goalExtension: ["event:goal.status.changed"],
    });
    expect(
      capabilityConsentStatus(next, { capabilities: narrow }).consented,
    ).toBe(false);
    expect(
      capabilityConsentStatus(narrow, { capabilities: next }).consented,
    ).toBe(true);
    expect(diffCapabilities(old, next).added).toContain(
      "goalExtension:proposal:task.create",
    );
    expect(describeCapabilities(next).join(" ")).toContain(
      "host authorization required",
    );
  });
});

describe("mandatory goal extension host boundary", () => {
  let plugin;
  let authorize;
  let options;
  beforeEach(() => {
    plugin = {
      ...ref,
      enabled: true,
      manifest: parsePluginManifest(sampleDir),
    };
    vi.spyOn(_deps, "discoverPlugins").mockImplementation(() => [plugin]);
    vi.spyOn(_deps, "loadManagedPluginPolicy").mockReturnValue(null);
    vi.spyOn(_deps, "filterByManagedPolicy").mockImplementation((plugins) => ({
      kept: plugins,
      dropped: [],
    }));
    vi.spyOn(_deps, "isPluginTrusted").mockReturnValue(true);
    vi.spyOn(_deps, "isPluginCapabilityConsented").mockReturnValue(true);
    authorize = vi.fn().mockResolvedValue(true);
    options = { host, authorize };
  });
  it("checks mandatory consent even when legacy enforcement flags are off", () => {
    expect(
      collectGoalExtensions({
        ...options,
        env: { CC_REQUIRE_PLUGIN_CAPABILITY_CONSENT: "0" },
      }).extensions,
    ).toHaveLength(1);
    _deps.isPluginCapabilityConsented.mockReturnValue(false);
    expect(collectGoalExtensions(options)).toMatchObject({
      extensions: [],
      dropped: [{ reason: "consent_required" }],
    });
    expect(_deps.loadManagedPluginPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ fresh: true }),
    );
  });
  it.each([
    [
      "disabled",
      (p) => {
        p.enabled = false;
      },
    ],
    [
      "invalid_plugin",
      (p) => {
        p.runtimeBlocked = true;
      },
    ],
    [
      "capabilities_undeclared",
      (p) => {
        p.manifest.capabilitiesDeclared = false;
      },
    ],
    [
      "legacy_unsupported",
      (p) => {
        p.manifest.goalExtension = null;
      },
    ],
  ])("rejects %s", (reason, mutate) => {
    mutate(plugin);
    expect(collectGoalExtensions(options)).toMatchObject({
      extensions: [],
      dropped: [{ reason }],
    });
  });
  it("rejects managed denial, missing trust, corrupt consent and unavailable discovery", () => {
    _deps.filterByManagedPolicy.mockReturnValue({ kept: [], dropped: [{}] });
    expect(collectGoalExtensions(options).dropped[0].reason).toBe(
      "policy_blocked",
    );
    _deps.filterByManagedPolicy.mockImplementation((plugins) => ({
      kept: plugins,
    }));
    _deps.isPluginTrusted.mockReturnValue(false);
    expect(collectGoalExtensions(options).dropped[0].reason).toBe("untrusted");
    _deps.isPluginTrusted.mockReturnValue(true);
    _deps.isPluginCapabilityConsented.mockImplementation(() => {
      throw new Error("bad store");
    });
    expect(collectGoalExtensions(options).dropped[0].reason).toBe(
      "authorization_unavailable",
    );
    _deps.discoverPlugins.mockImplementation(() => {
      throw new Error("no disk");
    });
    expect(collectGoalExtensions(options)).toMatchObject({
      extensions: [],
      dropped: [{ reason: "discovery_unavailable" }],
    });
  });
  it("projects only authorized event fields and freezes their view", async () => {
    options.readEvent = vi.fn().mockResolvedValue({
      summary: "One overdue task",
      occurredAt: "2026-10-18T00:00:00Z",
      token: "secret",
      receipt: { status: "success" },
    });
    const event = await projectGoalExtensionEvent(
      ref,
      { type: "risk.review.completed", goalRef: source },
      options,
    );
    expect(Object.keys(event).sort()).toEqual([
      "goalRef",
      "occurredAt",
      "summary",
      "type",
    ]);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.goalRef)).toBe(true);
    expect(authorize).toHaveBeenCalledTimes(2);
  });
  it("does not read unauthorized source data, even with admitted capabilities", async () => {
    options.readEvent = vi.fn();
    authorize.mockResolvedValue("yes");
    await expect(
      projectGoalExtensionEvent(
        ref,
        { type: "risk.review.completed", goalRef: source },
        options,
      ),
    ).rejects.toThrow(/authorization denied/);
    expect(options.readEvent).not.toHaveBeenCalled();
  });
  it.each(["disable", "uninstall", "consent", "source", "event"])(
    "drops a late event after %s revocation",
    async (mode) => {
      options.readEvent = async () => {
        if (mode === "disable") plugin.enabled = false;
        if (mode === "uninstall") _deps.discoverPlugins.mockReturnValue([]);
        if (mode === "consent")
          _deps.isPluginCapabilityConsented.mockReturnValue(false);
        if (mode === "source") authorize.mockResolvedValue(false);
        if (mode === "event") plugin.manifest.goalExtension.events = [];
        return { summary: "old result", occurredAt: "2026-10-18T00:00:00Z" };
      };
      await expect(
        projectGoalExtensionEvent(
          ref,
          { type: "risk.review.completed", goalRef: source },
          options,
        ),
      ).rejects.toThrow();
    },
  );
  it("queues only an explicitly pending proposal", async () => {
    options.enqueueProposal = vi.fn().mockResolvedValue({
      proposalId: "proposal-1",
      state: "pending-confirmation",
    });
    const proposal = {
      type: "task.create",
      goalRef: source,
      sourceRef: "risk-review:1",
      requestId: "request-1",
      title: "Follow up",
      description: "Review overdue work",
    };
    const result = await proposeGoalExtensionAction(ref, proposal, options);
    expect(result).toEqual({
      proposalId: "proposal-1",
      state: "pending-confirmation",
    });
    expect(options.enqueueProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "pending-confirmation",
        goalRef: source,
      }),
    );
    options.enqueueProposal.mockResolvedValue({
      proposalId: "proposal-1",
      status: "succeeded",
      receipt: "fake",
    });
    await expect(
      proposeGoalExtensionAction(ref, proposal, options),
    ).rejects.toThrow(/invalid host proposal receipt/);
  });
  it.each(["actor", "approved", "receipt", "actionRun", "status", "command"])(
    "rejects proposal authority field %s before the queue",
    async (field) => {
      options.enqueueProposal = vi.fn();
      await expect(
        proposeGoalExtensionAction(
          ref,
          {
            type: "task.create",
            goalRef: source,
            sourceRef: "r1",
            title: "x",
            description: "y",
            [field]: "forged",
          },
          options,
        ),
      ).rejects.toThrow(/unsupported/);
      expect(options.enqueueProposal).not.toHaveBeenCalled();
    },
  );
  it("pins proposal parameters before async authorization and rejects disabled queues", async () => {
    const proposal = {
      type: "task.create",
      goalRef: { ...source },
      sourceRef: "r1",
      requestId: "request-1",
      title: "original",
      description: "original",
    };
    authorize.mockImplementation(async () => {
      proposal.title = "changed";
      proposal.goalRef.revision = 99;
      return true;
    });
    options.enqueueProposal = vi
      .fn()
      .mockResolvedValue({ proposalId: "p1", state: "pending-confirmation" });
    await proposeGoalExtensionAction(ref, proposal, options);
    expect(options.enqueueProposal).toHaveBeenCalledWith(
      expect.objectContaining({ title: "original", goalRef: source }),
    );
    authorize.mockImplementation(async () => {
      plugin.enabled = false;
      return true;
    });
    options.enqueueProposal.mockClear();
    await expect(
      proposeGoalExtensionAction(ref, proposal, options),
    ).rejects.toThrow(/not currently admitted/);
    expect(options.enqueueProposal).not.toHaveBeenCalled();
  });
  it("provides an authorized text fallback without leaking undeclared panel fields", async () => {
    options.readPanel = vi.fn().mockResolvedValue({
      objective: "Deliver",
      status: "active",
      riskSummary: "One risk",
      receiptSummary: "Pending",
      credential: "secret",
    });
    const panel = await projectGoalExtensionPanel(
      ref,
      { panelId: "delivery-evidence", goalRef: source },
      options,
    );
    expect(panel).toMatchObject({ format: "text", slot: "goal.evidence" });
    expect(panel.text).toContain("riskSummary: One risk");
    expect(panel.text).not.toContain("secret");
    expect(authorize).toHaveBeenCalledTimes(2);
  });
  it("rejects panel changes during I/O and missing host adapters", async () => {
    options.readPanel = async () => {
      plugin.manifest.goalExtension.panels[0].fields = [];
      return {
        objective: "Deliver",
        status: "active",
        riskSummary: "None",
        receiptSummary: "None",
      };
    };
    await expect(
      projectGoalExtensionPanel(
        ref,
        { panelId: "delivery-evidence", goalRef: source },
        options,
      ),
    ).rejects.toThrow(/changed during projection/);
    await expect(
      proposeGoalExtensionAction(
        ref,
        {
          type: "task.create",
          goalRef: source,
          sourceRef: "r1",
          requestId: "request-1",
          title: "x",
          description: "y",
        },
        options,
      ),
    ).rejects.toThrow(/queue unavailable/);
  });
  it("uses the inspected workspace for trust instead of the process workspace", () => {
    const inspectedWorkspace = path.join(os.tmpdir(), "workspace-b");
    _deps.isPluginTrusted.mockImplementation(
      (candidate) => candidate.workspaceRoot === process.cwd(),
    );
    expect(
      collectGoalExtensions({ ...options, cwd: inspectedWorkspace }).extensions,
    ).toEqual([]);
    expect(_deps.isPluginTrusted).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: inspectedWorkspace }),
    );
    _deps.isPluginTrusted.mockImplementation(
      (candidate) => candidate.workspaceRoot === inspectedWorkspace,
    );
    expect(
      collectGoalExtensions({ ...options, cwd: inspectedWorkspace }).extensions,
    ).toHaveLength(1);
  });
  it("pins host options across asynchronous reads while rechecking current admission", async () => {
    const workspaceA = path.join(os.tmpdir(), "workspace-a");
    const workspaceB = path.join(os.tmpdir(), "workspace-b");
    options.cwd = workspaceA;
    options.host = { ...host, capabilities: [...host.capabilities] };
    let revokedA = false;
    _deps.discoverPlugins.mockImplementation(({ cwd }) =>
      cwd === workspaceA && revokedA ? [] : [plugin],
    );
    options.readEvent = async () => {
      revokedA = true;
      options.cwd = workspaceB;
      options.host.version = "9.0.0";
      return { summary: "old result", occurredAt: "2026-10-18T00:00:00Z" };
    };
    await expect(
      projectGoalExtensionEvent(
        ref,
        { type: "risk.review.completed", goalRef: source },
        options,
      ),
    ).rejects.toThrow(/not currently admitted/);
    expect(
      _deps.discoverPlugins.mock.calls.every(
        ([opts]) => opts.cwd === workspaceA,
      ),
    ).toBe(true);
  });
});
