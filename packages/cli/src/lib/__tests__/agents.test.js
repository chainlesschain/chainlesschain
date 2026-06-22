"use strict";

/**
 * agents tests — user-defined subagent discovery (.claude/agents/*.md), the
 * Claude-Code parity layer, previously untested. Covers normalizeTools,
 * parseAgentFile (frontmatter + body=systemPrompt, defaults, bad YAML),
 * discoverAgents (path-derived names with `:`, frontmatter name override,
 * project-shadows-personal precedence, sorting) and getAgent (colon/slash/
 * leading-slash lookup). In-memory fake fs over POSIX paths via the deps seam;
 * no `.git` present so projectRootBase resolves to null (cwd+home dirs only).
 */

import { describe, it, expect } from "vitest";
import pathDefault from "path";
import {
  normalizeTools,
  parseAgentFile,
  discoverAgents,
  getAgent,
} from "../agents.js";

const P = pathDefault.posix;

function makeFs(files) {
  const contents = new Map(Object.entries(files));
  const fileSet = new Set(contents.keys());
  const dirSet = new Set(["/"]);
  for (const f of fileSet) {
    let d = P.dirname(f);
    while (d && !dirSet.has(d)) {
      dirSet.add(d);
      d = P.dirname(d);
    }
  }
  const childrenOf = (dir) => {
    const out = new Map();
    for (const f of fileSet)
      if (P.dirname(f) === dir) out.set(P.basename(f), false);
    for (const d of dirSet)
      if (d !== "/" && P.dirname(d) === dir) out.set(P.basename(d), true);
    return out;
  };
  return {
    readFileSync(p) {
      if (!fileSet.has(p)) {
        const e = new Error("ENOENT");
        e.code = "ENOENT";
        throw e;
      }
      return contents.get(p);
    },
    existsSync(p) {
      return fileSet.has(p) || dirSet.has(p);
    },
    statSync(p) {
      if (!fileSet.has(p) && !dirSet.has(p)) {
        const e = new Error("ENOENT");
        e.code = "ENOENT";
        throw e;
      }
      const isDir = dirSet.has(p);
      return { isDirectory: () => isDir, isFile: () => !isDir };
    },
    readdirSync(p, opts) {
      if (!dirSet.has(p)) {
        const e = new Error("ENOENT");
        e.code = "ENOENT";
        throw e;
      }
      const kids = childrenOf(p);
      if (opts && opts.withFileTypes) {
        return [...kids].map(([name, isDir]) => ({
          name,
          isDirectory: () => isDir,
          isFile: () => !isDir,
        }));
      }
      return [...kids.keys()];
    },
  };
}

const discover = (files, home = "/home/u") =>
  discoverAgents("/proj", { deps: { fs: makeFs(files), path: P }, home });

// --------------------------------------------------------------------------- //
// normalizeTools
// --------------------------------------------------------------------------- //
describe("normalizeTools", () => {
  it("returns null for null/undefined", () => {
    expect(normalizeTools(null)).toBe(null);
    expect(normalizeTools(undefined)).toBe(null);
  });

  it("splits a comma/space string into a trimmed list", () => {
    expect(normalizeTools("read, write,  run")).toEqual([
      "read",
      "write",
      "run",
    ]);
    expect(normalizeTools("a b c")).toEqual(["a", "b", "c"]);
  });

  it("normalizes an array, dropping empties", () => {
    expect(normalizeTools(["read", "", "  write "])).toEqual(["read", "write"]);
  });

  it("returns null when nothing remains", () => {
    expect(normalizeTools("")).toBe(null);
    expect(normalizeTools([" ", ""])).toBe(null);
  });
});

// --------------------------------------------------------------------------- //
// parseAgentFile
// --------------------------------------------------------------------------- //
describe("parseAgentFile", () => {
  const parse = (content, opts) =>
    parseAgentFile("/a.md", "project", {
      deps: { fs: makeFs({ "/a.md": content }) },
      ...opts,
    });

  it("returns null when the file cannot be read", () => {
    expect(
      parseAgentFile("/missing.md", "project", { deps: { fs: makeFs({}) } }),
    ).toBe(null);
  });

  it("uses the whole body as systemPrompt when there is no frontmatter", () => {
    const a = parse("You are a helpful agent.");
    expect(a.systemPrompt).toBe("You are a helpful agent.");
    expect(a.name).toBe(null);
    expect(a.description).toBe("");
    expect(a.tools).toBe(null);
    expect(a.model).toBe(null);
  });

  it("parses frontmatter metadata and trims the body", () => {
    const a = parse(
      "---\nname: sec\ndescription: security review\ntools: read, grep\nmodel: opus\n---\n\nReview for vulns.\n",
    );
    expect(a.name).toBe("sec");
    expect(a.description).toBe("security review");
    expect(a.tools).toEqual(["read", "grep"]);
    expect(a.model).toBe("opus");
    expect(a.systemPrompt).toBe("Review for vulns.");
  });

  it("accepts a YAML array for tools", () => {
    const a = parse("---\ntools:\n  - read\n  - write\n---\nbody");
    expect(a.tools).toEqual(["read", "write"]);
  });

  it("falls back to defaults on invalid YAML frontmatter", () => {
    const a = parse("---\n: : bad : yaml :\n---\nthe body");
    expect(a.name).toBe(null);
    expect(a.systemPrompt).toBe("the body");
  });
});

// --------------------------------------------------------------------------- //
// discoverAgents
// --------------------------------------------------------------------------- //
describe("discoverAgents", () => {
  it("derives names from the path with ':' for nesting", () => {
    const agents = discover({
      "/proj/.claude/agents/reviewer.md": "Review.",
      "/proj/.claude/agents/sec/audit.md": "Audit.",
    });
    const names = agents.map((a) => a.name);
    expect(names).toEqual(["reviewer", "sec:audit"]); // sorted
  });

  it("lets frontmatter name override the path-derived name", () => {
    const agents = discover({
      "/proj/.claude/agents/x.md": "---\nname: custom\n---\nbody",
    });
    expect(agents[0].name).toBe("custom");
  });

  it("project scope shadows personal on a name clash", () => {
    const agents = discover({
      "/proj/.claude/agents/reviewer.md": "PROJECT version.",
      "/home/u/.claude/agents/reviewer.md": "PERSONAL version.",
      "/home/u/.claude/agents/helper.md": "Helper.",
    });
    const reviewer = agents.find((a) => a.name === "reviewer");
    expect(reviewer.scope).toBe("project");
    expect(reviewer.systemPrompt).toBe("PROJECT version.");
    // personal-only agent still discovered
    expect(agents.find((a) => a.name === "helper").scope).toBe("personal");
  });

  it("returns [] when no agent dirs exist", () => {
    expect(discover({ "/proj/readme.md": "x" })).toEqual([]);
  });
});

// --------------------------------------------------------------------------- //
// getAgent
// --------------------------------------------------------------------------- //
describe("getAgent", () => {
  const files = {
    "/proj/.claude/agents/sec/audit.md": "---\ndescription: d\n---\nAudit.",
  };
  const get = (name) =>
    getAgent(name, "/proj", {
      deps: { fs: makeFs(files), path: P },
      home: "/home/u",
    });

  it("looks up by colon name", () => {
    expect(get("sec:audit")?.description).toBe("d");
  });

  it("accepts slash and leading-slash forms", () => {
    expect(get("sec/audit")?.name).toBe("sec:audit");
    expect(get("/sec/audit")?.name).toBe("sec:audit");
  });

  it("returns null for an unknown agent", () => {
    expect(get("nope")).toBe(null);
  });
});
