import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { collectPluginMcpServers } from "../../src/lib/plugin-runtime/mcp.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";
import {
  trustPlugin,
  _deps as trustDeps,
  _resetTrustWarnings,
} from "../../src/lib/plugin-runtime/trust.js";

let cwd;
let storeFile;
let savedStorePath;

function installMcpPlugin(scope, name, mcpJson, { manifest = {} } = {}) {
  const dir = pluginVersionDir(scope, name, "1.0.0", { cwd });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version: "1.0.0", ...manifest }),
    "utf8",
  );
  if (mcpJson !== undefined) {
    fs.writeFileSync(
      path.join(dir, ".mcp.json"),
      JSON.stringify(mcpJson),
      "utf8",
    );
  }
  return dir;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pmcp-"));
  // Isolate the trust store so we never touch the real user-data dir.
  storeFile = path.join(cwd, "trust.json");
  savedStorePath = trustDeps.storePath;
  trustDeps.storePath = () => storeFile;
  _resetTrustWarnings();
});
afterEach(() => {
  trustDeps.storePath = savedStorePath;
  try {
    fs.rmSync(cwd, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("collectPluginMcpServers", () => {
  it("collects `mcpServers` from a trusted (local-scope) plugin's .mcp.json", () => {
    installMcpPlugin("local", "weather", {
      mcpServers: {
        weather: { command: "weather-mcp", args: ["--stdio"] },
      },
    });
    const { servers } = collectPluginMcpServers({ cwd, scopes: ["local"] });
    expect(Object.keys(servers)).toEqual(["weather"]);
    expect(servers.weather.command).toBe("weather-mcp");
    expect(servers.weather.args).toEqual(["--stdio"]);
  });

  it("accepts the bare `servers` key too", () => {
    installMcpPlugin("local", "db", {
      servers: { pg: { command: "pg-mcp" } },
    });
    const { servers } = collectPluginMcpServers({ cwd, scopes: ["local"] });
    expect(servers.pg.command).toBe("pg-mcp");
  });

  it("merges servers from multiple plugins; first wins on a name clash", () => {
    installMcpPlugin("local", "a", {
      mcpServers: { shared: { command: "from-a" }, only_a: { command: "a" } },
    });
    installMcpPlugin("local", "b", {
      mcpServers: { shared: { command: "from-b" }, only_b: { command: "b" } },
    });
    const { servers } = collectPluginMcpServers({
      cwd,
      scopes: ["local", "local"],
    });
    expect(Object.keys(servers).sort()).toEqual(["only_a", "only_b", "shared"]);
    // A plugin cannot silently override another's already-registered server.
    expect(["from-a", "from-b"]).toContain(servers.shared.command);
  });

  it("reports the source file for a contributing plugin", () => {
    installMcpPlugin("local", "weather", {
      mcpServers: { weather: { command: "weather-mcp" } },
    });
    const { sources } = collectPluginMcpServers({ cwd, scopes: ["local"] });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toContain(".mcp.json");
  });

  it("returns empty when no plugin declares MCP servers", () => {
    installMcpPlugin("local", "noop", undefined);
    const { servers, sources } = collectPluginMcpServers({
      cwd,
      scopes: ["local"],
    });
    expect(servers).toEqual({});
    expect(sources).toEqual([]);
  });

  it("never throws on a broken plugin manifest", () => {
    const dir = pluginVersionDir("local", "broken", "1.0.0", { cwd });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin.json"), "{ not json", "utf8");
    expect(() =>
      collectPluginMcpServers({ cwd, scopes: ["local"] }),
    ).not.toThrow();
  });

  it("skips a plugin whose manifest failed validation (path traversal)", () => {
    installMcpPlugin(
      "local",
      "evil",
      { mcpServers: { x: { command: "x" } } },
      { manifest: { skills: [{ name: "esc", path: "../../../etc" }] } },
    );
    expect(collectPluginMcpServers({ cwd, scopes: ["local"] }).servers).toEqual(
      {},
    );
  });
});

describe("collectPluginMcpServers — trust gating (MCP spawns commands)", () => {
  it("does NOT load an UNTRUSTED project plugin's MCP server, but does after trust", () => {
    installMcpPlugin("project", "weather", {
      mcpServers: { weather: { command: "weather-mcp" } },
    });

    // Untrusted project scope → gated out (an MCP server would spawn a command).
    expect(
      collectPluginMcpServers({ cwd, scopes: ["project"] }).servers,
    ).toEqual({});

    // Trust it → now its server is collected.
    trustPlugin("weather", { scope: "project", version: "1.0.0" });
    const { servers } = collectPluginMcpServers({ cwd, scopes: ["project"] });
    expect(servers.weather.command).toBe("weather-mcp");
  });
});
