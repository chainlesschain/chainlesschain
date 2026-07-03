/**
 * loadPluginMcp + resolveAgentMcp plugin wiring (Phase 3.3g — installed-plugin
 * `.mcp.json` servers reach the agent's MCP tool surface). A fake MCP client
 * captures which servers would connect (no real process is spawned). Plugin MCP
 * loads by DEFAULT (unlike the opt-in project `.mcp.json`) because a plugin only
 * contributes when installed AND trusted — but registered/project servers still
 * win on a name clash, and `pluginMcp:false` hard-skips it.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadPluginMcp,
  resolveAgentMcp,
} from "../../src/runtime/mcp-config.js";

let cwd;

/** A fake MCPClient that records connects and advertises one tool per server. */
function fakeClientFactory() {
  const connects = [];
  const client = {
    servers: new Map(),
    connects,
    setSessionId() {},
    async connect(name, cfg) {
      connects.push({ name, cfg });
      this.servers.set(name, cfg);
      return { tools: [{ name: "ping", inputSchema: { type: "object" } }] };
    },
  };
  return () => client;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugmcp-"));
});
afterEach(() => {
  try {
    fs.rmSync(cwd, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("loadPluginMcp", () => {
  it("connects the servers a collector returns", async () => {
    const collect = () => ({
      servers: { weather: { command: "weather-mcp", args: ["--stdio"] } },
      sources: ["/x/.mcp.json"],
    });
    const createClient = fakeClientFactory();
    const res = await loadPluginMcp({ cwd }, { collect, createClient });
    expect(res).toBeTruthy();
    expect(res.mcpClient.connects.map((c) => c.name)).toEqual(["weather"]);
    expect(res.connected.map((c) => c.server)).toContain("weather");
  });

  it("returns into unchanged when no plugin declares MCP servers", async () => {
    const collect = () => ({ servers: {}, sources: [] });
    const into = { mcpClient: {}, connected: [], extraToolDefinitions: [] };
    const res = await loadPluginMcp({ cwd }, { collect, into });
    expect(res).toBe(into);
  });

  it("never throws when the collector fails; falls back to into", async () => {
    const collect = () => {
      throw new Error("boom");
    };
    const into = { sentinel: true };
    const res = await loadPluginMcp({ cwd }, { collect, into });
    expect(res).toBe(into);
  });

  it("registered/project servers (already connected in into) win on a name clash", async () => {
    const collect = () => ({
      servers: { dup: { command: "PLUGIN" }, fresh: { command: "node" } },
      sources: [],
    });
    const client = fakeClientFactory()();
    client.servers.set("dup", { command: "EXPLICIT" }); // pretend already connected
    const into = {
      mcpClient: client,
      extraToolDefinitions: [],
      externalToolExecutors: {},
      externalToolDescriptors: {},
      connected: [],
      resources: [],
      prompts: [],
    };
    const res = await loadPluginMcp({ cwd }, { collect, into });
    const names = res.mcpClient.connects.map((c) => c.name);
    expect(names).toContain("fresh"); // new plugin server connects
    expect(names).not.toContain("dup"); // already-connected name preserved
  });
});

describe("resolveAgentMcp — plugin MCP step", () => {
  const baseDeps = {
    loadMcpConfig: async () => null,
    loadRegisteredMcp: async () => null,
    loadProjectMcp: async (_o, d) => d.into || null,
    loadIdeMcp: async (_o, d) => d.into || null,
    loadPdhMcp: async (_o, d) => d.into || null,
    loadJetbrainsMcp: async (_o, d) => d.into || null,
    isInIdeTerminal: () => false,
    isInPdhTerminal: () => false,
    isInJetbrainsContext: () => false,
    mcpPolicy: {},
  };

  it("invokes loadPluginMcp by default (no opt-in flag)", async () => {
    let called = false;
    const res = await resolveAgentMcp(
      { cwd },
      {
        ...baseDeps,
        loadPluginMcp: async (_o, d) => {
          called = true;
          return d.into || { fromPlugin: true };
        },
      },
    );
    expect(called).toBe(true);
    expect(res).toEqual({ fromPlugin: true });
  });

  it("pluginMcp:false hard-skips the plugin step", async () => {
    let called = false;
    await resolveAgentMcp(
      { cwd, pluginMcp: false },
      {
        ...baseDeps,
        loadPluginMcp: async () => {
          called = true;
          return null;
        },
      },
    );
    expect(called).toBe(false);
  });

  it("--strict-mcp-config skips the plugin step", async () => {
    let called = false;
    await resolveAgentMcp(
      { cwd, strict: true, mcpConfigPath: "/tmp/x.json" },
      {
        ...baseDeps,
        loadMcpConfig: async () => ({ strictResult: true }),
        loadPluginMcp: async () => {
          called = true;
          return null;
        },
      },
    );
    expect(called).toBe(false);
  });
});
