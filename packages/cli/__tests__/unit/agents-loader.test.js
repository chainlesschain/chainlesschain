/**
 * Unit tests for the `.claude/agents/*.md` subagent loader. Pure (fs/path/home
 * injected) so discovery + parse + tool normalization run without real files.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeTools,
  parseAgentFile,
  discoverAgents,
  getAgent,
} from "../../src/lib/agents.js";

// A tiny in-memory fs shim covering just what the loader uses.
function memFs(files) {
  // files: { "/abs/path.md": "content" }; dirs derived from keys.
  const dirEntries = (dir) => {
    const out = new Map();
    for (const p of Object.keys(files)) {
      if (!p.startsWith(dir + "/")) continue;
      const rest = p.slice(dir.length + 1);
      const seg = rest.split("/")[0];
      const isDir = rest.includes("/");
      out.set(seg, isDir);
    }
    if (out.size === 0) {
      const err = new Error("ENOENT");
      throw err;
    }
    return [...out].map(([name, isDir]) => ({
      name,
      isDirectory: () => isDir,
      isFile: () => !isDir,
    }));
  };
  return {
    readdirSync: (dir) => dirEntries(dir),
    readFileSync: (p) => {
      if (!(p in files)) throw new Error("ENOENT");
      return files[p];
    },
  };
}

// posix-style path so the in-memory keys line up cross-platform.
const path = {
  join: (...p) => p.join("/").replace(/\/+/g, "/"),
  relative: (base, full) => full.slice(base.length + 1),
};

describe("normalizeTools", () => {
  it("splits a comma/space string", () => {
    expect(normalizeTools("read_file, run_shell  list_dir")).toEqual([
      "read_file",
      "run_shell",
      "list_dir",
    ]);
  });
  it("passes arrays through, trims, drops empties", () => {
    expect(normalizeTools(["a", " b ", ""])).toEqual(["a", "b"]);
  });
  it("returns null for nullish / empty (inherit all)", () => {
    expect(normalizeTools(null)).toBeNull();
    expect(normalizeTools("")).toBeNull();
    expect(normalizeTools([])).toBeNull();
  });
});

describe("parseAgentFile", () => {
  it("parses frontmatter (camelCased) + body as systemPrompt", () => {
    const fs = memFs({
      "/p/x.md": `---\ndescription: A reviewer\ntools: read_file, search_files\nmodel: claude-sonnet-4-6\n---\nYou are a strict reviewer.`,
    });
    const a = parseAgentFile("/p/x.md", "project", { deps: { fs } });
    expect(a).toMatchObject({
      scope: "project",
      description: "A reviewer",
      tools: ["read_file", "search_files"],
      model: "claude-sonnet-4-6",
      systemPrompt: "You are a strict reviewer.",
    });
  });
  it("treats a body-only file as an all-tools agent", () => {
    const fs = memFs({ "/p/y.md": "Just a prompt." });
    const a = parseAgentFile("/p/y.md", "project", { deps: { fs } });
    expect(a.tools).toBeNull();
    expect(a.systemPrompt).toBe("Just a prompt.");
  });
});

describe("discoverAgents", () => {
  const opts = (files) => ({ deps: { fs: memFs(files), path }, home: "/home" });

  it("derives names from paths and nests dirs with ':'", () => {
    const o = opts({
      "/cwd/.claude/agents/reviewer.md": "R",
      "/cwd/.claude/agents/review/security.md": "S",
    });
    const names = discoverAgents("/cwd", o).map((a) => a.name);
    expect(names).toEqual(["review:security", "reviewer"]);
  });

  it("lets frontmatter name override the filename", () => {
    const o = opts({ "/cwd/.claude/agents/x.md": "---\nname: custom\n---\nbody" });
    expect(discoverAgents("/cwd", o)[0].name).toBe("custom");
  });

  it("project scope shadows personal on a name clash", () => {
    const o = opts({
      "/home/.claude/agents/dup.md": "personal",
      "/cwd/.claude/agents/dup.md": "project",
    });
    const all = discoverAgents("/cwd", o);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ scope: "project", systemPrompt: "project" });
  });

  it("getAgent accepts ':' or '/' forms and a leading slash", () => {
    const o = opts({ "/cwd/.claude/agents/review/security.md": "S" });
    expect(getAgent("review:security", "/cwd", o)?.systemPrompt).toBe("S");
    expect(getAgent("/review/security", "/cwd", o)?.systemPrompt).toBe("S");
    expect(getAgent("nope", "/cwd", o)).toBeNull();
  });
});
