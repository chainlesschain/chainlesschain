import { describe, expect, it } from "vitest";

import {
  buildMcpConnectArgs,
  buildMcpRemoveArgs,
  buildMcpServersArgs,
  buildPluginAddArgs,
  buildPluginInstalledArgs,
  buildPluginTrustArgs,
  buildPluginUninstallArgs,
  buildSkillListArgs,
  parseMcpServers,
  parsePluginInstalled,
  parseSkillList,
} from "../../../vscode-extension/src/plugin-manager.js";

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
  it("distinguishes unreadable (null) from empty ([])", () => {
    expect(parsePluginInstalled("not json")).toBeNull();
    expect(parsePluginInstalled("[]")).toEqual([]);
    expect(parseMcpServers("nope")).toBeNull();
    expect(parseSkillList("{}")).toBeNull();
  });

  it("parses plugin installed rows with scope + manifest validity", () => {
    const rows = parsePluginInstalled(
      JSON.stringify([
        { name: "a", version: "1.0.0", scope: "user", dir: "/x", ok: true },
        { name: "b", scope: "project", ok: false },
        { noName: true },
      ]),
    );
    expect(rows).toEqual([
      { name: "a", version: "1.0.0", scope: "user", dir: "/x", ok: true },
      { name: "b", version: "", scope: "project", dir: "", ok: false },
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
