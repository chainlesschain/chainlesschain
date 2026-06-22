"use strict";

/**
 * project-inventory tests — the offline census behind `cc init --memory`
 * (previously untested). Covers readmeSynopsis (markdown synopsis extraction),
 * inventoryProject (package.json / lockfile→PM / config markers / CI count /
 * language census / SKIP_DIRS / workspaces both shapes / existingMemory) and
 * renderMemoryFile (the generated cc.md). Driven by an in-memory fake fs over
 * POSIX paths via the deps seam — no real I/O.
 */

import { describe, it, expect } from "vitest";
import pathDefault from "path";
import {
  readmeSynopsis,
  inventoryProject,
  renderMemoryFile,
  SKIP_DIRS,
} from "../project-inventory.js";

const P = pathDefault.posix;

/** Build a fake fs from a { absPosixPath: content } map. Dirs are derived. */
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
    const out = new Map(); // name -> isDir
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

const inv = (files, opts = {}) =>
  inventoryProject("/proj", { deps: { fs: makeFs(files), path: P }, ...opts });

// --------------------------------------------------------------------------- //
// readmeSynopsis
// --------------------------------------------------------------------------- //
describe("readmeSynopsis", () => {
  it("returns null for empty input", () => {
    expect(readmeSynopsis(null)).toBe(null);
    expect(readmeSynopsis("")).toBe(null);
  });

  it("skips headings, badges and bare HTML, returns first real paragraph", () => {
    const md = [
      "# My Project",
      "![badge](x.svg)",
      "[![ci](a)](b)",
      "<p>html</p>",
      "",
      "This is the real summary line.",
      "Second line of the same paragraph.",
      "",
      "Later paragraph ignored.",
    ].join("\n");
    expect(readmeSynopsis(md)).toBe(
      "This is the real summary line. Second line of the same paragraph.",
    );
  });

  it("returns null when there is no prose (only headings)", () => {
    expect(readmeSynopsis("# Title\n## Sub")).toBe(null);
  });

  it("truncates to maxChars with an ellipsis", () => {
    const out = readmeSynopsis("x".repeat(50), 10);
    expect(out).toBe("xxxxxxxxxx…");
    expect(out.length).toBe(11);
  });
});

// --------------------------------------------------------------------------- //
// inventoryProject
// --------------------------------------------------------------------------- //
describe("inventoryProject", () => {
  it("reads name/description from package.json", () => {
    const r = inv({
      "/proj/package.json": JSON.stringify({ name: "acme", description: "d" }),
    });
    expect(r.name).toBe("acme");
    expect(r.description).toBe("d");
  });

  it("falls back to folder basename when no package.json", () => {
    expect(inv({ "/proj/foo.txt": "x" }).name).toBe("proj");
  });

  it("detects package manager from lockfile (first match wins)", () => {
    expect(inv({ "/proj/pnpm-lock.yaml": "" }).packageManager).toBe("pnpm");
    expect(inv({ "/proj/yarn.lock": "" }).packageManager).toBe("yarn");
    expect(inv({ "/proj/foo.txt": "" }).packageManager).toBe(null);
  });

  it("collects deduped tooling config markers", () => {
    const r = inv({
      "/proj/tsconfig.json": "{}",
      "/proj/vite.config.js": "",
      "/proj/vite.config.ts": "", // same label "Vite" — deduped
    });
    expect(r.configs).toContain("TypeScript");
    expect(r.configs.filter((c) => c === "Vite").length).toBe(1);
  });

  it("counts CI workflow files", () => {
    const r = inv({
      "/proj/.github/workflows/ci.yml": "",
      "/proj/.github/workflows/release.yaml": "",
      "/proj/.github/workflows/notes.md": "", // not yaml
    });
    expect(r.ciWorkflows).toBe(2);
  });

  it("censuses languages by extension, sorted desc, skipping SKIP_DIRS", () => {
    const r = inv({
      "/proj/a.ts": "",
      "/proj/src/b.ts": "",
      "/proj/src/c.js": "",
      "/proj/node_modules/d.ts": "", // skipped
    });
    const langs = Object.fromEntries(r.languages);
    expect(langs.TypeScript).toBe(2); // a.ts + src/b.ts, NOT node_modules
    expect(langs.JavaScript).toBe(1);
    expect(r.languages[0][0]).toBe("TypeScript"); // sorted desc
  });

  it("tracks top-level directories with file counts", () => {
    const r = inv({
      "/proj/src/a.js": "",
      "/proj/src/b.js": "",
      "/proj/docs/c.md": "",
    });
    const dirs = Object.fromEntries(r.topDirs);
    expect(dirs.src).toBe(2);
    expect(dirs.docs).toBe(1);
  });

  it("reads workspaces in both array and {packages} shapes", () => {
    expect(
      inv({ "/proj/package.json": JSON.stringify({ workspaces: ["a", "b"] }) })
        .workspaces,
    ).toEqual(["a", "b"]);
    expect(
      inv({
        "/proj/package.json": JSON.stringify({
          workspaces: { packages: ["x"] },
        }),
      }).workspaces,
    ).toEqual(["x"]);
  });

  it("lists scripts and existing memory files", () => {
    const r = inv({
      "/proj/package.json": JSON.stringify({
        scripts: { build: "tsc", test: "vitest" },
      }),
      "/proj/CLAUDE.md": "x",
    });
    expect(r.scripts).toEqual([
      ["build", "tsc"],
      ["test", "vitest"],
    ]);
    expect(r.existingMemory).toContain("CLAUDE.md");
  });

  it("derives synopsis from README.md", () => {
    const r = inv({ "/proj/README.md": "# T\n\nHello world synopsis." });
    expect(r.synopsis).toBe("Hello world synopsis.");
  });

  it("respects maxDepth (deep files beyond cap not counted)", () => {
    const r = inv({ "/proj/a/b/c/deep.ts": "" }, { maxDepth: 1 });
    expect(Object.fromEntries(r.languages).TypeScript).toBeUndefined();
  });

  it("SKIP_DIRS includes the usual heavy directories", () => {
    expect(SKIP_DIRS.has("node_modules")).toBe(true);
    expect(SKIP_DIRS.has("target")).toBe(true);
  });
});

// --------------------------------------------------------------------------- //
// renderMemoryFile
// --------------------------------------------------------------------------- //
describe("renderMemoryFile", () => {
  const base = {
    name: "acme",
    description: null,
    synopsis: "A cool tool.",
    packageManager: "npm",
    configs: ["TypeScript", "Vitest"],
    ciWorkflows: 3,
    workspaces: ["packages/*"],
    scripts: [
      ["build", "tsc"],
      ["test", "vitest"],
    ],
    languages: [
      ["TypeScript", 10],
      ["JavaScript", 2],
    ],
    topDirs: [["src", 10]],
    truncated: false,
    existingMemory: ["CLAUDE.md"],
  };

  it("renders title, overview, stack, commands and layout", () => {
    const md = renderMemoryFile(base, { date: "2026-06-22" });
    expect(md).toContain("# acme — Project Memory");
    expect(md).toContain("2026-06-22");
    expect(md).toContain("A cool tool.");
    expect(md).toContain("TypeScript (10), JavaScript (2)");
    expect(md).toContain("Package manager: npm");
    expect(md).toContain("CI: GitHub Actions (3 workflows)");
    expect(md).toContain("`npm run build` — `tsc`");
    expect(md).toContain("Workspaces: packages/*");
    expect(md).toContain("`src/` — 10 files");
  });

  it("imports existing memory files via @-include (excluding cc.md)", () => {
    const md = renderMemoryFile({
      ...base,
      existingMemory: ["cc.md", "CLAUDE.md"],
    });
    expect(md).toContain("@CLAUDE.md");
    expect(md).not.toContain("@cc.md");
  });

  it("caps the script list at 12 with a remainder note", () => {
    const scripts = Array.from({ length: 15 }, (_, i) => [`s${i}`, `cmd${i}`]);
    const md = renderMemoryFile({ ...base, scripts });
    expect(md).toContain("… 3 more scripts");
  });

  it("notes a truncated scan", () => {
    const md = renderMemoryFile({ ...base, truncated: true });
    expect(md).toContain("scan truncated");
  });
});
