import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { discoverPluginAgentLayers } from "../../src/lib/plugin-runtime/agents.js";
import { discoverAgents } from "../../src/lib/agents.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";

let cwd;

function installAgentPlugin(scope, name, agents, { manifest = {} } = {}) {
  const dir = pluginVersionDir(scope, name, "1.0.0", { cwd });
  fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version: "1.0.0", ...manifest }),
    "utf8",
  );
  for (const [file, body] of Object.entries(agents)) {
    const p = path.join(dir, "agents", file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body, "utf8");
  }
  return dir;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pagent-"));
});
afterEach(() => {
  try {
    fs.rmSync(cwd, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("discoverPluginAgentLayers", () => {
  it("returns the agents/ dir of a plugin that ships one", () => {
    installAgentPlugin("local", "toolkit", {
      "reviewer.md": "---\ndescription: reviews\n---\nReview it.",
    });
    const layers = discoverPluginAgentLayers({ cwd, scopes: ["local"] });
    expect(layers).toHaveLength(1);
    expect(layers[0].name).toBe("toolkit");
    expect(layers[0].dir).toContain(path.join("toolkit", "1.0.0", "agents"));
  });

  it("skips a plugin with no agents/ dir", () => {
    const dir = pluginVersionDir("local", "noagents", "1.0.0", { cwd });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({ name: "noagents", version: "1.0.0" }),
      "utf8",
    );
    expect(discoverPluginAgentLayers({ cwd, scopes: ["local"] })).toEqual([]);
  });

  it("skips a plugin whose manifest failed validation", () => {
    installAgentPlugin(
      "local",
      "evil",
      { "x.md": "body" },
      { manifest: { skills: [{ name: "esc", path: "../../../etc" }] } },
    );
    expect(discoverPluginAgentLayers({ cwd, scopes: ["local"] })).toEqual([]);
  });

  it("never throws on a broken plugin manifest", () => {
    const dir = pluginVersionDir("local", "broken", "1.0.0", { cwd });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin.json"), "{ not json", "utf8");
    expect(() =>
      discoverPluginAgentLayers({ cwd, scopes: ["local"] }),
    ).not.toThrow();
  });
});

describe("discoverAgents — plugin agents reach the agent chain", () => {
  it("surfaces a plugin's agent as a named subagent (scope 'plugin')", () => {
    installAgentPlugin("local", "toolkit", {
      "sec.md": "---\ndescription: security\ntools: read_file\n---\nAudit.",
    });
    const agents = discoverAgents(cwd, { scopes: ["local"], home: cwd });
    const sec = agents.find((a) => a.name === "sec");
    expect(sec).toBeTruthy();
    expect(sec.scope).toBe("plugin");
    expect(sec.description).toBe("security");
    expect(sec.tools).toEqual(["read_file"]);
    expect(sec.systemPrompt).toBe("Audit.");
  });

  it("a user's own project agent SHADOWS a plugin agent of the same name", () => {
    installAgentPlugin("local", "toolkit", {
      "sec.md": "---\ndescription: from-plugin\n---\nPLUGIN.",
    });
    // User's own project agent of the same name.
    const userAgents = path.join(cwd, ".chainlesschain", "agents");
    fs.mkdirSync(userAgents, { recursive: true });
    fs.writeFileSync(
      path.join(userAgents, "sec.md"),
      "---\ndescription: from-user\n---\nUSER.",
      "utf8",
    );
    const agents = discoverAgents(cwd, { scopes: ["local"], home: cwd });
    const sec = agents.filter((a) => a.name === "sec");
    expect(sec).toHaveLength(1); // no duplicate
    expect(sec[0].description).toBe("from-user"); // user wins
    expect(sec[0].scope).toBe("project");
  });

  it("includePlugins:false excludes plugin agents", () => {
    installAgentPlugin("local", "toolkit", {
      "only.md": "---\ndescription: x\n---\nbody",
    });
    const agents = discoverAgents(cwd, {
      scopes: ["local"],
      home: cwd,
      includePlugins: false,
    });
    expect(agents.find((a) => a.name === "only")).toBeUndefined();
  });
});
