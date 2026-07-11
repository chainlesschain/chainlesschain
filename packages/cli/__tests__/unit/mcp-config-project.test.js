/**
 * loadProjectMcp — project-scoped `.mcp.json` auto-discovery (Claude-Code
 * parity). Reads `.mcp.json` from the git project root (walked up from cwd) +
 * cwd, merges their `mcpServers`, and connects them. A fake MCP client captures
 * which servers would connect (no real process is spawned).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadProjectMcp } from "../../src/runtime/mcp-config.js";

let root, sub;

function write(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj), "utf-8");
}

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
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cc-projmcp-"));
  root = path.join(base, "proj");
  sub = path.join(root, "packages", "x");
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(root, ".git"), "gitdir: /nowhere\n", "utf-8");
  // Project `.mcp.json` is OPT-IN (default-off); enable it for the load tests.
  process.env.CC_PROJECT_MCP = "1";
  // Fingerprint trust store goes to the temp dir, never the real home.
  process.env.CC_PROJECT_MCP_TRUST_STORE = path.join(
    path.dirname(root),
    "trust-store.json",
  );
});

afterEach(() => {
  delete process.env.CC_PROJECT_MCP;
  delete process.env.CC_PROJECT_MCP_TRUST_STORE;
  try {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("loadProjectMcp", () => {
  it("loads the project-root .mcp.json when run from a subdirectory", async () => {
    write(path.join(root, ".mcp.json"), {
      mcpServers: { rooty: { command: "node", args: ["server.js"] } },
    });
    const createClient = fakeClientFactory();
    const res = await loadProjectMcp({ cwd: sub }, { createClient });
    expect(res).toBeTruthy();
    expect(res.connected.map((c) => c.server)).toContain("rooty");
    expect(res.mcpClient.connects.map((c) => c.name)).toEqual(["rooty"]);
  });

  it("a cwd-local .mcp.json overrides the root on a name clash (closest wins)", async () => {
    write(path.join(root, ".mcp.json"), {
      mcpServers: { dup: { command: "ROOT" } },
    });
    write(path.join(sub, ".mcp.json"), {
      mcpServers: { dup: { command: "LOCAL" } },
    });
    const createClient = fakeClientFactory();
    const res = await loadProjectMcp({ cwd: sub }, { createClient });
    const connect = res.mcpClient.connects.find((c) => c.name === "dup");
    expect(connect.cfg.command).toBe("LOCAL");
  });

  it("returns into unchanged when no .mcp.json exists", async () => {
    const into = { mcpClient: {}, connected: [], extraToolDefinitions: [] };
    const res = await loadProjectMcp({ cwd: sub }, { into });
    expect(res).toBe(into);
  });

  it("default-off: does nothing when CC_PROJECT_MCP is unset", async () => {
    write(path.join(root, ".mcp.json"), {
      mcpServers: { rooty: { command: "node" } },
    });
    delete process.env.CC_PROJECT_MCP; // override the beforeEach opt-in
    const createClient = fakeClientFactory();
    const res = await loadProjectMcp({ cwd: sub }, { createClient });
    expect(res).toBeNull();
  });

  it("opt-in can be passed via opts.env without touching process.env", async () => {
    write(path.join(root, ".mcp.json"), {
      mcpServers: { rooty: { command: "node" } },
    });
    delete process.env.CC_PROJECT_MCP;
    const createClient = fakeClientFactory();
    const res = await loadProjectMcp(
      { cwd: sub, env: { CC_PROJECT_MCP: "1" } },
      { createClient },
    );
    expect(res.connected.map((c) => c.server)).toContain("rooty");
  });

  it("a malformed .mcp.json is skipped (best-effort, never throws)", async () => {
    fs.writeFileSync(path.join(root, ".mcp.json"), "{ not json", "utf-8");
    const warnings = [];
    const res = await loadProjectMcp(
      { cwd: sub },
      { writeErr: (s) => warnings.push(s) },
    );
    expect(res).toBeNull();
    expect(warnings.join("")).toMatch(/malformed/);
  });

  it("merges an explicit `into` so --mcp-config / registered win on a clash", async () => {
    // `into` already has a server named "dup" connected; setupMcpFromConfig
    // skips an already-connected name, so the project server does NOT override.
    write(path.join(root, ".mcp.json"), {
      mcpServers: { dup: { command: "PROJECT" }, fresh: { command: "node" } },
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
    const res = await loadProjectMcp({ cwd: sub }, { into });
    const names = res.mcpClient.connects.map((c) => c.name);
    expect(names).toContain("fresh"); // new server connects
    expect(names).not.toContain("dup"); // already-connected name preserved
  });
});

describe("loadProjectMcp — fingerprint re-trust (gap 2026-07-11)", () => {
  it("first use records the fingerprint; a CHANGED file is then refused", async () => {
    const file = path.join(root, ".mcp.json");
    write(file, { mcpServers: { rooty: { command: "node" } } });

    // First load: trusted on first use, servers connect.
    const res1 = await loadProjectMcp(
      { cwd: sub },
      { createClient: fakeClientFactory() },
    );
    expect(res1.mcpClient.connects.map((c) => c.name)).toEqual(["rooty"]);

    // The file changes (e.g. a new commit swaps the command) → refused.
    write(file, { mcpServers: { rooty: { command: "EVIL" } } });
    const warnings = [];
    const res2 = await loadProjectMcp(
      { cwd: sub },
      {
        createClient: fakeClientFactory(),
        writeErr: (s) => warnings.push(s),
      },
    );
    expect(res2).toBeNull(); // nothing loaded
    expect(warnings.join("")).toMatch(/changed since it was last trusted/i);
  });

  it("CC_PROJECT_MCP_TRUST=1 re-trusts the changed file and loads it", async () => {
    const file = path.join(root, ".mcp.json");
    write(file, { mcpServers: { rooty: { command: "node" } } });
    await loadProjectMcp({ cwd: sub }, { createClient: fakeClientFactory() });

    write(file, { mcpServers: { rooty: { command: "node2" } } });
    process.env.CC_PROJECT_MCP_TRUST = "1";
    try {
      const res = await loadProjectMcp(
        { cwd: sub },
        { createClient: fakeClientFactory() },
      );
      expect(res.mcpClient.connects.map((c) => c.name)).toEqual(["rooty"]);
    } finally {
      delete process.env.CC_PROJECT_MCP_TRUST;
    }

    // The new fingerprint is now recorded — a plain re-run loads again.
    const res3 = await loadProjectMcp(
      { cwd: sub },
      { createClient: fakeClientFactory() },
    );
    expect(res3.mcpClient.connects.map((c) => c.name)).toEqual(["rooty"]);
  });

  it("an unchanged file keeps loading without any prompt", async () => {
    const file = path.join(root, ".mcp.json");
    write(file, { mcpServers: { rooty: { command: "node" } } });
    await loadProjectMcp({ cwd: sub }, { createClient: fakeClientFactory() });
    const warnings = [];
    const res = await loadProjectMcp(
      { cwd: sub },
      {
        createClient: fakeClientFactory(),
        writeErr: (s) => warnings.push(s),
      },
    );
    expect(res.mcpClient.connects.map((c) => c.name)).toEqual(["rooty"]);
    expect(warnings.join("")).not.toMatch(/SKIPPING/);
  });
});
