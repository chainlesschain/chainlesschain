/**
 * Unit tests: src/lib/packer/project-assets-collector.js
 *
 * Covers the skip matrix, hard-rejection rules, secret-scan, SHA stability,
 * bundled-skills parse, and oversize detection described in
 * docs/design/CC_PACK_项目模式_设计文档.md §6.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectProjectAssets } from "../../src/lib/packer/project-assets-collector.js";
import { PackError } from "../../src/lib/packer/errors.js";

function seedProject(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(
      abs,
      typeof content === "string" ? content : Buffer.from(content),
    );
  }
}

function minimalProject() {
  return {
    ".chainlesschain/config.json": JSON.stringify({
      name: "test-agent",
      version: "1.0.0",
    }),
    ".chainlesschain/rules.md": "# rules\n",
  };
}

describe("collectProjectAssets", () => {
  let projectRoot;
  let tempDir;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-proj-src-"));
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-proj-tmp-"));
  });

  afterEach(() => {
    for (const d of [projectRoot, tempDir]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  // ── Baseline ──────────────────────────────────────────────────────────
  it("copies the minimal project and populates metadata", () => {
    seedProject(projectRoot, minimalProject());
    const r = collectProjectAssets({ projectRoot, tempDir });
    expect(r.projectName).toBe("test-agent");
    expect(r.fileCount).toBe(2);
    expect(r.totalBytes).toBeGreaterThan(0);
    expect(r.bundledSkills).toEqual([]);
    expect(r.secretsFound).toBe(0);
    expect(
      fs.existsSync(path.join(r.projectDir, ".chainlesschain", "config.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(r.projectDir, ".chainlesschain", "rules.md")),
    ).toBe(true);
  });

  it("produces a stable SHA across repeated runs on the same tree", () => {
    seedProject(projectRoot, minimalProject());
    const a = collectProjectAssets({ projectRoot, tempDir });
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "cc-proj-tmp-"));
    const b = collectProjectAssets({ projectRoot, tempDir: tempDir2 });
    fs.rmSync(tempDir2, { recursive: true, force: true });
    expect(a.configSha).toBe(b.configSha);
    expect(a.configSha).toMatch(/^[a-f0-9]{64}$/);
  });

  it("SHA changes when any file content changes", () => {
    seedProject(projectRoot, minimalProject());
    const a = collectProjectAssets({ projectRoot, tempDir });
    fs.writeFileSync(
      path.join(projectRoot, ".chainlesschain", "rules.md"),
      "# rules v2\n",
    );
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "cc-proj-tmp-"));
    const b = collectProjectAssets({ projectRoot, tempDir: tempDir2 });
    fs.rmSync(tempDir2, { recursive: true, force: true });
    expect(a.configSha).not.toBe(b.configSha);
  });

  // ── Missing source ────────────────────────────────────────────────────
  it("throws when .chainlesschain/ is missing", () => {
    expect(() => collectProjectAssets({ projectRoot, tempDir })).toThrow(
      PackError,
    );
    expect(() => collectProjectAssets({ projectRoot, tempDir })).toThrow(
      /requires .* to be a directory/,
    );
  });

  it("throws when config.json is missing inside .chainlesschain/", () => {
    fs.mkdirSync(path.join(projectRoot, ".chainlesschain"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(projectRoot, ".chainlesschain", "rules.md"), "");
    expect(() => collectProjectAssets({ projectRoot, tempDir })).toThrow(
      /config\.json/,
    );
  });

  it("throws when config.json is malformed JSON", () => {
    seedProject(projectRoot, {
      ...minimalProject(),
      ".chainlesschain/config.json": "{ not json",
    });
    expect(() => collectProjectAssets({ projectRoot, tempDir })).toThrow(
      /not valid JSON/,
    );
  });

  it("throws when config.json has empty name", () => {
    seedProject(projectRoot, {
      ".chainlesschain/config.json": JSON.stringify({ name: "   " }),
    });
    expect(() => collectProjectAssets({ projectRoot, tempDir })).toThrow(
      /non-empty "name"/,
    );
  });

  // ── Skip rules ────────────────────────────────────────────────────────
  it("skips node_modules/ anywhere below .chainlesschain/", () => {
    seedProject(projectRoot, {
      ...minimalProject(),
      ".chainlesschain/node_modules/foo/index.js": "junk",
      ".chainlesschain/nested/node_modules/bar/index.js": "junk",
    });
    const r = collectProjectAssets({ projectRoot, tempDir });
    expect(r.manifest.some((m) => m.rel.includes("node_modules"))).toBe(false);
  });

  it("skips .git/, .cache/, dist/ directories", () => {
    seedProject(projectRoot, {
      ...minimalProject(),
      ".chainlesschain/.git/HEAD": "ref: ...",
      ".chainlesschain/.cache/blob": "x",
      ".chainlesschain/dist/bundle.js": "x",
    });
    const r = collectProjectAssets({ projectRoot, tempDir });
    for (const m of r.manifest) {
      expect(m.rel).not.toMatch(/\/(.git|.cache|dist)\//);
    }
  });

  it("skips *.log files", () => {
    seedProject(projectRoot, {
      ...minimalProject(),
      ".chainlesschain/debug.log": "x",
      ".chainlesschain/skills/foo/run.log": "x",
    });
    const r = collectProjectAssets({ projectRoot, tempDir });
    expect(r.manifest.some((m) => m.rel.endsWith(".log"))).toBe(false);
  });

  it("preserves .gitignore inside .chainlesschain/ (dotfile not in skip list)", () => {
    seedProject(projectRoot, {
      ...minimalProject(),
      ".chainlesschain/.gitignore": "node_modules/\n",
    });
    const r = collectProjectAssets({ projectRoot, tempDir });
    expect(r.manifest.some((m) => m.rel === ".gitignore")).toBe(true);
  });

  // ── Skill node_modules rejection ──────────────────────────────────────
  it("rejects when a skill contains node_modules/", () => {
    seedProject(projectRoot, {
      ...minimalProject(),
      ".chainlesschain/skills/my-skill/skill.md": "---\nname: my-skill\n---\n",
      ".chainlesschain/skills/my-skill/node_modules/left-pad/index.js": "junk",
    });
    expect(() => collectProjectAssets({ projectRoot, tempDir })).toThrow(
      /Skill "my-skill" contains node_modules/,
    );
  });

  // ── Size cap ──────────────────────────────────────────────────────────
  it("rejects when total size exceeds 50MB", () => {
    seedProject(projectRoot, minimalProject());
    // 51 × 1MB chunks
    const big = Buffer.alloc(1024 * 1024, "x");
    for (let i = 0; i < 51; i++) {
      const p = path.join(projectRoot, ".chainlesschain", `blob-${i}.bin`);
      fs.writeFileSync(p, big);
    }
    expect(() => collectProjectAssets({ projectRoot, tempDir })).toThrow(
      /exceeds .* Pass --force-large-project/,
    );
  });

  it("--force-large-project bypasses the 50MB cap", () => {
    seedProject(projectRoot, minimalProject());
    const big = Buffer.alloc(1024 * 1024, "x");
    for (let i = 0; i < 51; i++) {
      fs.writeFileSync(
        path.join(projectRoot, ".chainlesschain", `blob-${i}.bin`),
        big,
      );
    }
    const r = collectProjectAssets({
      projectRoot,
      tempDir,
      forceLargeProject: true,
    });
    expect(r.fileCount).toBeGreaterThan(50);
    expect(r.totalBytes).toBeGreaterThan(50 * 1024 * 1024);
  });

  // ── Secret scan ───────────────────────────────────────────────────────
  it("rejects config.json with an apiKey set", () => {
    seedProject(projectRoot, {
      ".chainlesschain/config.json": JSON.stringify({
        name: "leaky-agent",
        llm: { providers: { openai: { apiKey: "sk-XXX" } } },
      }),
    });
    expect(() => collectProjectAssets({ projectRoot, tempDir })).toThrow(
      /sensitive field/,
    );
    try {
      collectProjectAssets({ projectRoot, tempDir });
    } catch (e) {
      expect(e.exitCode).toBe(16); // EXIT.SECRETS
    }
  });

  it("--allow-secrets bypasses the secret scan with a warning", () => {
    seedProject(projectRoot, {
      ".chainlesschain/config.json": JSON.stringify({
        name: "leaky-agent",
        llm: { providers: { openai: { apiKey: "sk-XXX" } } },
      }),
    });
    const warnings = [];
    const r = collectProjectAssets({
      projectRoot,
      tempDir,
      allowSecrets: true,
      logger: { log: (m) => warnings.push(m) },
    });
    expect(r.secretsFound).toBe(1);
    expect(warnings.some((m) => /WARNING.*1 secret/.test(m))).toBe(true);
  });

  // ── Bundled skills ────────────────────────────────────────────────────
  it("parses skill.md frontmatter and lists skills by name", () => {
    seedProject(projectRoot, {
      ...minimalProject(),
      ".chainlesschain/skills/triage/skill.md":
        "---\nname: medical-triage\ncategory: persona\n---\n# Body\n",
      ".chainlesschain/skills/other/skill.md": "---\nname: other-skill\n---\n",
      ".chainlesschain/skills/no-meta/skill.md": "no frontmatter",
      ".chainlesschain/skills/no-md/readme.txt": "x",
    });
    const r = collectProjectAssets({ projectRoot, tempDir });
    const names = r.bundledSkills.map((s) => s.name).sort();
    expect(names).toEqual(["medical-triage", "other-skill"]);
  });
});
