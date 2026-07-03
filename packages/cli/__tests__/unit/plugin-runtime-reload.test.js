import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { reloadPluginRuntime } from "../../src/lib/plugin-runtime/reload.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";
import {
  probeServers,
  _resetPluginServers,
} from "../../src/lib/lsp/lsp-server-registry.js";
import { _resetPluginLspLoadState } from "../../src/lib/plugin-runtime/lsp.js";

let cwd;

function installFullPlugin(name) {
  const dir = pluginVersionDir("local", name, "1.0.0", { cwd });
  fs.mkdirSync(path.join(dir, "skills", "s"), { recursive: true });
  fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
  fs.mkdirSync(path.join(dir, "hooks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "monitors"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version: "1.0.0" }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "skills", "s", "SKILL.md"),
    "---\nname: s\n---\nx",
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "agents", "rev.md"),
    "---\ndescription: r\n---\nbody",
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, ".lsp.json"),
    JSON.stringify({
      servers: [
        { languageId: "toml", command: "taplo", extensions: [".toml"] },
      ],
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
      },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, ".mcp.json"),
    JSON.stringify({ mcpServers: { m: { command: "m-mcp" } } }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "monitors", "monitors.json"),
    JSON.stringify({ monitors: [{ name: "w", command: "echo", args: ["x"] }] }),
    "utf8",
  );
  return dir;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-preload-"));
  _resetPluginServers();
  _resetPluginLspLoadState();
});
afterEach(() => {
  _resetPluginServers();
  _resetPluginLspLoadState();
  try {
    fs.rmSync(cwd, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("reloadPluginRuntime", () => {
  it("returns a per-component summary of the installed plugins", () => {
    installFullPlugin("toolkit");
    const sum = reloadPluginRuntime({ cwd, scopes: ["local"] });
    expect(sum.plugins).toBe(1);
    expect(sum.skills).toBe(1);
    expect(sum.agents).toBe(1);
    expect(sum.lspRegistered).toBe(1);
    expect(sum.hooks).toBe(1); // one event (SessionStart)
    expect(sum.mcp).toBe(1);
    expect(sum.monitors).toBe(1);
  });

  it("picks up a plugin installed AFTER a first (empty) scan — no restart needed", () => {
    // First scan: nothing installed.
    const first = reloadPluginRuntime({ cwd, scopes: ["local"] });
    expect(first.plugins).toBe(0);
    expect(first.lspRegistered).toBe(0);

    // Install, then reload — the new plugin's LSP server registers this time
    // (the per-root memo was reset), proving hot-reload works.
    installFullPlugin("late");
    const second = reloadPluginRuntime({ cwd, scopes: ["local"] });
    expect(second.plugins).toBe(1);
    expect(second.lspRegistered).toBe(1);
    const toml = probeServers(cwd).find((s) => s.languageId === "toml");
    expect(toml).toBeTruthy();
  });

  it("never throws when nothing is installed", () => {
    expect(() => reloadPluginRuntime({ cwd, scopes: ["local"] })).not.toThrow();
  });
});
