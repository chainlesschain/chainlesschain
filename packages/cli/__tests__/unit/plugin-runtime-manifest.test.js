import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  parsePluginManifest,
  summarizeComponents,
  findManifestPath,
  isWithin,
} from "../../src/lib/plugin-runtime/manifest.js";

let root;

function write(rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    typeof content === "string" ? content : JSON.stringify(content),
    "utf8",
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-"));
});
afterEach(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("isWithin", () => {
  it("accepts self and children, rejects escapes and absolutes", () => {
    expect(isWithin("/a/b", "/a/b")).toBe(true);
    expect(isWithin("/a/b", "/a/b/c/d")).toBe(true);
    expect(isWithin("/a/b", "/a")).toBe(false);
    expect(isWithin("/a/b", "/a/b/../../etc")).toBe(false);
  });
});

describe("findManifestPath", () => {
  it("prefers .chainlesschain-plugin/plugin.json over legacy top-level", () => {
    write(".chainlesschain-plugin/plugin.json", {
      name: "p",
      version: "1.0.0",
    });
    write("plugin.json", { name: "legacy", version: "1.0.0" });
    expect(findManifestPath(root)).toBe(
      path.join(root, ".chainlesschain-plugin", "plugin.json"),
    );
  });

  it("falls back to legacy top-level plugin.json", () => {
    write("plugin.json", { name: "legacy", version: "1.0.0" });
    expect(findManifestPath(root)).toBe(path.join(root, "plugin.json"));
  });
});

describe("parsePluginManifest — metadata validation", () => {
  it("errors when no manifest exists", () => {
    const m = parsePluginManifest(root);
    expect(m.ok).toBe(false);
    expect(m.errors.join()).toMatch(/no manifest found/);
  });

  it("errors on missing name and version", () => {
    write("plugin.json", { description: "x" });
    const m = parsePluginManifest(root);
    expect(m.ok).toBe(false);
    expect(m.errors.join()).toMatch(/name is required/);
    expect(m.errors.join()).toMatch(/version is required/);
  });

  it("errors on invalid semver", () => {
    write("plugin.json", { name: "p", version: "not-semver" });
    const m = parsePluginManifest(root);
    expect(m.ok).toBe(false);
    expect(m.errors.join()).toMatch(/not valid semver/);
  });

  it("errors on non-JSON manifest", () => {
    write("plugin.json", "{ this is not json ");
    const m = parsePluginManifest(root);
    expect(m.ok).toBe(false);
    expect(m.errors.join()).toMatch(/not valid JSON/);
  });

  it("accepts a minimal valid manifest", () => {
    write("plugin.json", { name: "p", version: "1.2.3", description: "hi" });
    const m = parsePluginManifest(root);
    expect(m.ok).toBe(true);
    expect(m.metadata).toMatchObject({
      name: "p",
      version: "1.2.3",
      description: "hi",
    });
  });
});

describe("parsePluginManifest — component discovery by convention", () => {
  beforeEach(() => {
    write(".chainlesschain-plugin/plugin.json", {
      name: "full",
      version: "0.1.0",
    });
    write("skills/greet/SKILL.md", "# greet");
    write("skills/farewell/SKILL.md", "# bye");
    write("agents/reviewer.md", "reviewer agent");
    write("hooks/hooks.json", {
      hooks: [{ name: "preEdit" }, { name: "postEdit" }],
    });
    write(".mcp.json", { mcpServers: { fs: {}, git: {} } });
    write(".lsp.json", {
      servers: [
        {
          languageId: "toml",
          command: "taplo",
          args: ["lsp", "stdio"],
          extensions: [".toml"],
        },
      ],
    });
    write("monitors/monitors.json", { monitors: [{ name: "log-watch" }] });
    write("bin/tool.sh", "#!/bin/sh\necho hi");
    write("settings.json", { theme: "dark" });
  });

  it("discovers every component type", () => {
    const m = parsePluginManifest(root);
    expect(m.ok).toBe(true);
    const counts = summarizeComponents(m);
    expect(counts).toEqual({
      skills: 2,
      agents: 1,
      hooks: 2,
      mcp: 2,
      lsp: 1,
      monitors: 1,
      bin: 1,
      settings: 1,
    });
  });

  it("parses .lsp.json server entries", () => {
    const m = parsePluginManifest(root);
    expect(m.components.lsp[0]).toMatchObject({
      languageId: "toml",
      command: "taplo",
      args: ["lsp", "stdio"],
      extensions: [".toml"],
    });
  });

  it("resolves skill paths inside the plugin root", () => {
    const m = parsePluginManifest(root);
    const names = m.components.skills.map((s) => s.name).sort();
    expect(names).toEqual(["farewell", "greet"]);
    for (const s of m.components.skills) {
      expect(isWithin(root, s.absPath)).toBe(true);
    }
  });
});

describe("parsePluginManifest — explicit declarations + security", () => {
  it("honors explicit manifest.skills over convention", () => {
    write("plugin.json", {
      name: "p",
      version: "1.0.0",
      skills: [{ name: "custom", path: "custom-skill" }],
    });
    write("custom-skill/SKILL.md", "# custom");
    write("skills/ignored/SKILL.md", "# ignored"); // convention ignored when explicit
    const m = parsePluginManifest(root);
    expect(m.components.skills.map((s) => s.name)).toEqual(["custom"]);
  });

  it("rejects a skill path that escapes the plugin root", () => {
    write("plugin.json", {
      name: "evil",
      version: "1.0.0",
      skills: [{ name: "esc", path: "../../../etc" }],
    });
    const m = parsePluginManifest(root);
    expect(m.ok).toBe(false);
    expect(m.errors.join()).toMatch(/escapes the plugin root/);
  });

  it("rejects an absolute component path", () => {
    write("plugin.json", {
      name: "evil",
      version: "1.0.0",
      skills: [{ name: "abs", path: "/etc/passwd" }],
    });
    const m = parsePluginManifest(root);
    expect(m.ok).toBe(false);
    expect(m.errors.join()).toMatch(/absolute paths are not allowed/);
  });

  it("warns (not errors) when a declared skill path is missing", () => {
    write("plugin.json", {
      name: "p",
      version: "1.0.0",
      skills: [{ name: "gone", path: "skills/gone" }],
    });
    const m = parsePluginManifest(root);
    expect(m.ok).toBe(true);
    expect(m.warnings.join()).toMatch(/path not found/);
    expect(m.components.skills).toHaveLength(0);
  });
});

describe("parsePluginManifest — declared capabilities + options schema (P1)", () => {
  it("normalizes permissions + optionsSchema onto the manifest", () => {
    write("plugin.json", {
      name: "p",
      version: "1.0.0",
      permissions: { process: true, network: ["api.example.com"] },
      optionsSchema: { apiKey: { type: "string", sensitive: true } },
    });
    const m = parsePluginManifest(root);
    expect(m.ok).toBe(true);
    expect(m.capabilitiesDeclared).toBe(true);
    expect(m.capabilities.process).toBe(true);
    expect(m.capabilities.network.domains).toEqual(["api.example.com"]);
    expect(m.optionsSchema.apiKey).toMatchObject({
      sensitive: true,
      scope: "user",
    });
  });

  it("a legacy manifest with no permissions block gets no capability warnings", () => {
    write("plugin.json", { name: "p", version: "1.0.0" });
    write(".mcp.json", { mcpServers: [{ name: "srv" }] });
    const m = parsePluginManifest(root);
    expect(m.capabilitiesDeclared).toBe(false);
    expect(m.warnings.join()).not.toMatch(/capability:/);
  });

  it("warns when a declared plugin ships an MCP server without the mcp capability", () => {
    write("plugin.json", {
      name: "p",
      version: "1.0.0",
      permissions: { process: true },
    });
    write(".mcp.json", { mcpServers: [{ name: "srv" }] });
    const m = parsePluginManifest(root);
    expect(m.ok).toBe(true);
    expect(m.warnings.join()).toMatch(/capability:.*mcp/);
  });
});
