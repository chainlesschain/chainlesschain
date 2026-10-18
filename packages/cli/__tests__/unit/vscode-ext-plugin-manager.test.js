import { describe, expect, it } from "vitest";

import {
  buildCliGoalPanelsArgs,
  parseCliGoalPanels,
  formatCliGoalPanels,
  buildMcpConnectArgs,
  buildMcpRemoveArgs,
  buildMcpServersArgs,
  buildPluginAddArgs,
  buildPluginConsentArgs,
  buildPluginInstalledArgs,
  buildPluginLifecycleArgs,
  buildPluginTrustArgs,
  buildPluginUninstallArgs,
  buildPluginUpgradeArgs,
  buildPluginUseArgs,
  buildSkillListArgs,
  parseMcpServers,
  parsePluginInstalled,
  parsePluginUpgradeResult,
  parseSkillList,
} from "../../../vscode-extension/src/plugin-manager.js";

describe("CLI goal panel presentation", () => {
  const selection = { id: "goal-1", name: "viewer", scope: "project" };
  const result = {
    schema: "chainlesschain.goal-extension-panels.v1",
    snapshot: true,
    observedAt: "2026-10-18T00:00:00.000Z",
    goalRef: {
      id: "goal-1",
      storeId: "cli-store",
      revision: 2,
      controlGeneration: 0,
    },
    panels: [
      {
        plugin: { name: "viewer", scope: "project", version: "0.1.0" },
        id: "progress",
        slot: "goal.summary",
        format: "text",
        text: "<img src=x onerror=alert(1)>",
      },
    ],
    dropped: [],
  };
  it("builds an explicit plugin/scope read and rejects unsafe goal selections", () => {
    expect(buildCliGoalPanelsArgs("goal-1", "viewer", "project")).toEqual([
      "goal",
      "panels",
      "goal-1",
      "--plugin=viewer",
      "--scope",
      "project",
      "--json",
    ]);
    expect(() =>
      buildCliGoalPanelsArgs("../goal", "viewer", "project"),
    ).toThrow();
    expect(() =>
      buildCliGoalPanelsArgs("--help", "viewer", "project"),
    ).toThrow();
    expect(() => buildCliGoalPanelsArgs("goal-1", "viewer", "org")).toThrow();
  });
  it("accepts an evidence text slot only for an explicitly selected desktop connection", () => {
    const raw = {
      ...result,
      source: "desktop-project",
      panels: [
        {
          ...result.panels[0],
          slot: "goal.evidence",
          text: "Historical risk: insufficient-data; unresolved receipt",
        },
      ],
    };
    expect(
      parseCliGoalPanels(JSON.stringify(raw), {
        ...selection,
        connection: "private.json",
      }),
    ).not.toBeNull();
    expect(
      parseCliGoalPanels(
        JSON.stringify({ ...raw, source: undefined }),
        selection,
      ),
    ).toBeNull();
    expect(
      parseCliGoalPanels(
        JSON.stringify({
          ...raw,
          panels: [{ ...raw.panels[0], format: "html" }],
        }),
        { ...selection, connection: "private.json" },
      ),
    ).toBeNull();
  });
  it("retains plaintext without treating embedded markup or receipt claims as instructions", () => {
    const parsed = parseCliGoalPanels(
      JSON.stringify({ ...result, approved: true, receipt: "forged" }),
      selection,
    );
    expect(formatCliGoalPanels(parsed)).toContain(
      "<img src=x onerror=alert(1)>",
    );
    expect(parsed).not.toHaveProperty("receipt");
    expect(parsed).not.toHaveProperty("approved");
  });
  it("rejects another goal/plugin, invalid revisions, HTML panels and unknown schemas", () => {
    for (const patch of [
      { snapshot: false },
      { schema: "unknown" },
      { goalRef: { ...result.goalRef, id: "other" } },
      { goalRef: { ...result.goalRef, revision: 2.5 } },
      { panels: [{ ...result.panels[0], format: "html" }] },
      {
        panels: [
          {
            ...result.panels[0],
            plugin: { ...result.panels[0].plugin, scope: "user" },
          },
        ],
      },
    ]) {
      expect(
        parseCliGoalPanels(JSON.stringify({ ...result, ...patch }), selection),
      ).toBeNull();
    }
    expect(parseCliGoalPanels("x".repeat(131073), selection)).toBeNull();
  });
  it("reports an unavailable projection without fabricating an empty successful panel", () => {
    const parsed = parseCliGoalPanels(
      JSON.stringify({
        ...result,
        panels: [],
        dropped: [{ name: "viewer", reason: "consent_required" }],
      }),
      selection,
    );
    expect(formatCliGoalPanels(parsed)).toContain("No authorized goal panels");
    expect(formatCliGoalPanels(parsed)).toContain("consent_required");
  });
});

describe("plugin/MCP manager argv builders", () => {
  it("targets the unified plugin runtime commands", () => {
    expect(buildPluginInstalledArgs()).toEqual([
      "plugin",
      "installed",
      "--json",
    ]);
    expect(buildPluginTrustArgs("p1", true)).toEqual(["plugin", "trust", "p1"]);
    expect(buildPluginTrustArgs("p1", false)).toEqual([
      "plugin",
      "untrust",
      "p1",
    ]);
    // The row's install scope must be forwarded: the CLI defaults trust and
    // untrust to --scope project, but the panel installs at user scope — an
    // unscoped untrust of a user-scope plugin exits 0 WITHOUT revoking.
    expect(buildPluginTrustArgs("p1", true, "user")).toEqual([
      "plugin",
      "trust",
      "p1",
      "--scope",
      "user",
    ]);
    expect(buildPluginTrustArgs("p1", false, "user")).toEqual([
      "plugin",
      "untrust",
      "p1",
      "--scope",
      "user",
    ]);
    expect(buildPluginUninstallArgs("p1", "project")).toEqual([
      "plugin",
      "uninstall",
      "p1",
      "--scope",
      "project",
    ]);
    expect(buildPluginUseArgs("p1", "1.0.0", "project")).toEqual([
      "plugin",
      "use",
      "p1",
      "1.0.0",
      "--scope",
      "project",
    ]);
    expect(buildPluginLifecycleArgs("p1", false, "local")).toEqual([
      "plugin",
      "disable",
      "p1",
      "--scope",
      "local",
      "--json",
    ]);
    expect(buildPluginLifecycleArgs("p1", true, "user")).toEqual([
      "plugin",
      "enable",
      "p1",
      "--scope",
      "user",
      "--json",
    ]);
    expect(
      buildPluginUpgradeArgs("p1", {
        scope: "project",
        registry: "https://registry.example/plugins.json",
        packageName: "p1",
        grantCapabilities: true,
      }),
    ).toEqual([
      "plugin",
      "upgrade",
      "p1",
      "--scope",
      "project",
      "--registry",
      "https://registry.example/plugins.json",
      "--grant-capabilities",
      "--json",
    ]);
    expect(buildPluginConsentArgs("p1", "status", "user")).toEqual([
      "plugin",
      "consent",
      "p1",
      "--scope",
      "user",
      "--json",
    ]);
    expect(buildPluginConsentArgs("p1", "grant", "user")).toEqual([
      "plugin",
      "consent",
      "p1",
      "--scope",
      "user",
      "--grant",
      "--json",
    ]);
    expect(buildPluginConsentArgs("p1", "revoke", "user")).toEqual([
      "plugin",
      "consent",
      "p1",
      "--scope",
      "user",
      "--revoke",
    ]);
    expect(buildPluginAddArgs("./dir")).toEqual([
      "plugin",
      "add",
      "./dir",
      "--json",
    ]);
    expect(
      buildPluginAddArgs("pkg", { registry: "https://r.example" }),
    ).toEqual([
      "plugin",
      "add",
      "pkg",
      "--registry",
      "https://r.example",
      "--json",
    ]);
    expect(buildMcpServersArgs()).toEqual(["mcp", "servers", "--json"]);
    expect(buildMcpRemoveArgs("srv")).toEqual(["mcp", "remove", "srv"]);
    expect(buildMcpConnectArgs("srv")).toEqual([
      "mcp",
      "connect",
      "srv",
      "--json",
    ]);
    expect(buildSkillListArgs()).toEqual(["skill", "list", "--json"]);
  });
});

describe("plugin/MCP manager parsers", () => {
  it("keeps goal declarations separate from runtime admission", () => {
    const rows = parsePluginInstalled(
      JSON.stringify([
        {
          name: "declared",
          goalExtension: {
            status: "declaration-only",
            apiVersion: "1.0.0",
            apiCompatible: true,
            runtimeAvailable: true,
            approved: true,
            hosts: { vscode: ">=0.37.149", mobile: "*" },
          },
        },
        {
          name: "unknown",
          goalExtension: { status: "active", runtimeAvailable: true },
        },
        { name: "corrupt", goalExtension: ["active"] },
        { name: "legacy" },
      ]),
    );
    expect(rows[0].goalExtension).toEqual({
      status: "declaration-only",
      apiVersion: "1.0.0",
      apiCompatible: true,
      runtimeAvailable: false,
      hosts: { vscode: ">=0.37.149" },
    });
    expect(rows[1].goalExtension.status).toBe("unknown");
    expect(rows[2].goalExtension).toMatchObject({
      status: "unknown",
      runtimeAvailable: false,
    });
    expect(rows[3]).not.toHaveProperty("goalExtension");
  });
  it("distinguishes unreadable (null) from empty ([])", () => {
    expect(parsePluginInstalled("not json")).toBeNull();
    expect(parsePluginInstalled("[]")).toEqual([]);
    expect(parseMcpServers("nope")).toBeNull();
    expect(parseSkillList("{}")).toBeNull();
    expect(parsePluginUpgradeResult("not json")).toBeNull();
  });

  it("parses activated and automatically rolled-back upgrades", () => {
    expect(
      parsePluginUpgradeResult(
        JSON.stringify({
          name: "a",
          version: "2.0.0",
          previousVersion: "1.0.0",
          updated: true,
        }),
      ),
    ).toMatchObject({
      activationStatus: "activated",
      version: "2.0.0",
      previousVersion: "1.0.0",
    });
    expect(
      parsePluginUpgradeResult(
        JSON.stringify({
          name: "a",
          version: "2.0.0",
          activationStatus: "rolled_back",
          rollbackVersion: "1.0.0",
          rollbackReason: "capability_consent_required",
          capabilities: {
            consented: false,
            reason: "capabilities widened",
            declared: ["process", "network:*"],
            added: ["network:*"],
          },
        }),
      ),
    ).toEqual({
      name: "a",
      version: "2.0.0",
      previousVersion: "",
      activationStatus: "rolled_back",
      rollbackVersion: "1.0.0",
      rollbackReason: "capability_consent_required",
      capabilitiesGranted: false,
      capabilities: {
        consented: false,
        reason: "capabilities widened",
        declared: ["process", "network:*"],
        added: ["network:*"],
      },
    });
    expect(
      parsePluginUpgradeResult('{"activationStatus":"partially_active"}'),
    ).toBeNull();
  });

  it("parses plugin installed rows with scope + manifest validity", () => {
    const rows = parsePluginInstalled(
      JSON.stringify([
        {
          name: "a",
          version: "1.0.0",
          versions: ["2.0.0", "1.0.0", null],
          scope: "user",
          dir: "/x",
          ok: true,
          enabled: false,
          source: {
            type: "registry",
            source: "https://registry.example/plugins.json",
            registry: "https://registry.example/plugins.json",
            package: "a",
            ref: "v1.0.0",
          },
          integrity: {
            signature: {
              present: true,
              verified: true,
              manifestSha256: "m",
              publicKeySha256: "k",
            },
            sbom: {
              present: true,
              digest: "d",
              fileCount: 4,
              totalBytes: 123,
            },
          },
          policy: {
            managed: true,
            source: "/managed.json",
            allowed: false,
            reason: "denied",
            requireSigned: true,
          },
        },
        { name: "b", scope: "project", ok: false },
        { noName: true },
      ]),
    );
    expect(rows).toEqual([
      {
        name: "a",
        version: "1.0.0",
        versions: ["2.0.0", "1.0.0"],
        scope: "user",
        dir: "/x",
        ok: true,
        enabled: false,
        source: {
          type: "registry",
          source: "https://registry.example/plugins.json",
          ref: "v1.0.0",
          registry: "https://registry.example/plugins.json",
          resolvedSource: "",
          package: "a",
          offline: false,
        },
        integrity: {
          signature: {
            present: true,
            verified: true,
            reason: "",
            manifestSha256: "m",
            publicKeySha256: "k",
          },
          sbom: {
            present: true,
            digest: "d",
            fileCount: 4,
            totalBytes: 123,
          },
        },
        policy: {
          managed: true,
          source: "/managed.json",
          allowed: false,
          reason: "denied",
          requireSigned: true,
        },
      },
      {
        name: "b",
        version: "",
        versions: [],
        scope: "project",
        dir: "",
        ok: false,
        enabled: true,
        source: null,
        integrity: {
          signature: {
            present: false,
            verified: false,
            reason: "",
            manifestSha256: "",
            publicKeySha256: "",
          },
          sbom: {
            present: false,
            digest: "",
            fileCount: 0,
            totalBytes: 0,
          },
        },
        policy: {
          managed: false,
          source: "",
          allowed: true,
          reason: "",
          requireSigned: false,
        },
      },
    ]);
  });

  it("parses policy-annotated MCP servers", () => {
    const rows = parseMcpServers(
      JSON.stringify([
        {
          name: "good",
          url: "https://x",
          _transport: "https",
          autoConnect: 1,
          _allowed: true,
        },
        {
          name: "blocked",
          command: "node srv.js",
          _allowed: false,
          _reason: "http not allowed",
        },
      ]),
    );
    expect(rows[0]).toMatchObject({
      name: "good",
      transport: "https",
      autoConnect: true,
      allowed: true,
    });
    expect(rows[1]).toMatchObject({
      name: "blocked",
      command: "node srv.js",
      allowed: false,
      reason: "http not allowed",
    });
  });

  it("parses skills tolerating id/name variants", () => {
    const rows = parseSkillList(
      JSON.stringify([
        { id: "s1", name: "Skill One", category: "ai", source: "bundled" },
        { name: "only-name" },
        { neither: true },
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "s1", name: "Skill One" });
    expect(rows[1]).toMatchObject({ id: "only-name", name: "only-name" });
  });
});
