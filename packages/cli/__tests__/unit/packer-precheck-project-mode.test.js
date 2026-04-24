/**
 * Unit tests: src/lib/packer/precheck.js — project-mode detection.
 *
 * Covers the 4-case matrix from docs/design/CC_PACK_项目模式_设计文档.md §3:
 *
 *   projectMode flag       config present       expected projectMode
 *   ──────────────────     ──────────────       ────────────────────
 *   undefined (default)    yes                  true  (auto-detect on)
 *   undefined (default)    no                   false (auto-detect off)
 *   true  (--project)      yes                  true
 *   true  (--project)      no                   PackError thrown
 *   false (--no-project)   yes                  false (explicit opt-out)
 *   false (--no-project)   no                   false
 *
 * Plus: --project-config-override path handling, and schema validation
 * (missing `name`, malformed JSON).
 *
 * precheck() resolves cliRoot via import.meta.url — that points at the real
 * packages/cli tree regardless of projectRoot, so these tests use the real
 * CLI's node_modules and only need tmpDir scaffolding for .chainlesschain/.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  precheck,
  resolveProjectMode,
  sanitizeProjectName,
} from "../../src/lib/packer/precheck.js";
import { PackError } from "../../src/lib/packer/errors.js";

// precheck() also enforces clean git + projectRoot existence. Every test
// below uses allowDirty:true and a fresh tmpDir so those upstream checks
// never dominate.

describe("precheck — project-mode detection", () => {
  let tmpDir;
  const validConfig = { name: "test-agent", version: "1.0.0" };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pre-proj-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  function writeConfig(content = validConfig) {
    const ccDir = path.join(tmpDir, ".chainlesschain");
    fs.mkdirSync(ccDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccDir, "config.json"),
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
      "utf-8",
    );
    return path.join(ccDir, "config.json");
  }

  // ── auto-detect (projectMode === undefined) ──────────────────────────
  it("auto-detects project mode when .chainlesschain/config.json exists", () => {
    const configPath = writeConfig();
    const r = precheck({ projectRoot: tmpDir, allowDirty: true });
    expect(r.projectMode).toBe(true);
    expect(r.projectConfigPath).toBe(configPath);
  });

  it("falls back to CLI-only mode when no config present", () => {
    const r = precheck({ projectRoot: tmpDir, allowDirty: true });
    expect(r.projectMode).toBe(false);
    expect(r.projectConfigPath).toBeNull();
  });

  // ── --project (explicit on) ──────────────────────────────────────────
  it("--project succeeds when config present", () => {
    const configPath = writeConfig();
    const r = precheck({
      projectRoot: tmpDir,
      allowDirty: true,
      projectMode: true,
    });
    expect(r.projectMode).toBe(true);
    expect(r.projectConfigPath).toBe(configPath);
  });

  it("--project throws PackError when config missing", () => {
    expect(() =>
      precheck({
        projectRoot: tmpDir,
        allowDirty: true,
        projectMode: true,
      }),
    ).toThrow(PackError);
    expect(() =>
      precheck({
        projectRoot: tmpDir,
        allowDirty: true,
        projectMode: true,
      }),
    ).toThrow(/--project mode requires a config\.json/);
  });

  it("--project PackError uses exit code 10 (PRECHECK)", () => {
    try {
      precheck({
        projectRoot: tmpDir,
        allowDirty: true,
        projectMode: true,
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PackError);
      expect(e.exitCode).toBe(10);
    }
  });

  // ── --no-project (explicit off) ──────────────────────────────────────
  it("--no-project ignores config even when present", () => {
    writeConfig();
    const r = precheck({
      projectRoot: tmpDir,
      allowDirty: true,
      projectMode: false,
    });
    expect(r.projectMode).toBe(false);
    expect(r.projectConfigPath).toBeNull();
  });

  it("--no-project works when no config present", () => {
    const r = precheck({
      projectRoot: tmpDir,
      allowDirty: true,
      projectMode: false,
    });
    expect(r.projectMode).toBe(false);
    expect(r.projectConfigPath).toBeNull();
  });

  // ── --project-config-override ────────────────────────────────────────
  it("--project-config-override accepts absolute path", () => {
    const altPath = path.join(tmpDir, "alt-config.json");
    fs.writeFileSync(altPath, JSON.stringify(validConfig), "utf-8");
    const r = precheck({
      projectRoot: tmpDir,
      allowDirty: true,
      projectConfigOverride: altPath,
    });
    expect(r.projectMode).toBe(true);
    expect(r.projectConfigPath).toBe(altPath);
  });

  it("--project-config-override accepts projectRoot-relative path", () => {
    fs.writeFileSync(
      path.join(tmpDir, "alt.json"),
      JSON.stringify(validConfig),
      "utf-8",
    );
    const r = precheck({
      projectRoot: tmpDir,
      allowDirty: true,
      projectConfigOverride: "alt.json",
    });
    expect(r.projectMode).toBe(true);
    expect(r.projectConfigPath).toBe(path.resolve(tmpDir, "alt.json"));
  });

  it("--project + override pointing at missing file throws", () => {
    expect(() =>
      precheck({
        projectRoot: tmpDir,
        allowDirty: true,
        projectMode: true,
        projectConfigOverride: "nope.json",
      }),
    ).toThrow(/requires a config\.json/);
  });

  // ── schema validation ────────────────────────────────────────────────
  it("rejects malformed JSON config", () => {
    writeConfig("{ not valid json }");
    expect(() =>
      precheck({ projectRoot: tmpDir, allowDirty: true, projectMode: true }),
    ).toThrow(/not valid JSON/);
  });

  it("rejects config missing required `name` field", () => {
    writeConfig({ version: "1.0.0" });
    expect(() =>
      precheck({ projectRoot: tmpDir, allowDirty: true, projectMode: true }),
    ).toThrow(/missing required field "name"/);
  });

  it("rejects config with empty `name` field", () => {
    writeConfig({ name: "   ", version: "1.0.0" });
    expect(() =>
      precheck({ projectRoot: tmpDir, allowDirty: true, projectMode: true }),
    ).toThrow(/missing required field "name"/);
  });

  it("auto-detect still runs schema check when config exists", () => {
    writeConfig({ version: "1.0.0" }); // no name
    expect(() => precheck({ projectRoot: tmpDir, allowDirty: true })).toThrow(
      /missing required field "name"/,
    );
  });
});

// Pure unit tests for the helper — no fs.existsSync(projectRoot) / git checks
// interfere here, so we can isolate each branch of the matrix.
describe("resolveProjectMode — pure helper", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pre-resolve-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("returns projectMode:false immediately when flag=false (skips fs entirely)", () => {
    // Even if a config is sitting there, explicit --no-project wins.
    fs.mkdirSync(path.join(tmpDir, ".chainlesschain"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".chainlesschain", "config.json"),
      JSON.stringify({ name: "ignored" }),
    );
    const r = resolveProjectMode({
      projectRoot: tmpDir,
      projectMode: false,
      projectConfigOverride: null,
    });
    expect(r).toEqual({
      projectMode: false,
      projectConfigPath: null,
      projectName: null,
    });
  });

  it("handles the 4-case matrix cleanly", () => {
    const configPath = path.join(tmpDir, ".chainlesschain", "config.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const writeValid = () =>
      fs.writeFileSync(configPath, JSON.stringify({ name: "x" }));
    const clear = () => fs.rmSync(configPath, { force: true });

    // 1. undefined + present → on
    writeValid();
    expect(
      resolveProjectMode({
        projectRoot: tmpDir,
        projectMode: undefined,
        projectConfigOverride: null,
      }).projectMode,
    ).toBe(true);

    // 2. undefined + absent → off
    clear();
    expect(
      resolveProjectMode({
        projectRoot: tmpDir,
        projectMode: undefined,
        projectConfigOverride: null,
      }).projectMode,
    ).toBe(false);

    // 3. true + present → on
    writeValid();
    expect(
      resolveProjectMode({
        projectRoot: tmpDir,
        projectMode: true,
        projectConfigOverride: null,
      }).projectMode,
    ).toBe(true);

    // 4. true + absent → throw
    clear();
    expect(() =>
      resolveProjectMode({
        projectRoot: tmpDir,
        projectMode: true,
        projectConfigOverride: null,
      }),
    ).toThrow(PackError);

    // 5. false + present → off (does not validate schema)
    writeValid();
    expect(
      resolveProjectMode({
        projectRoot: tmpDir,
        projectMode: false,
        projectConfigOverride: null,
      }).projectMode,
    ).toBe(false);
  });
});

describe("sanitizeProjectName", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-san-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("lowercases and strips non-alphanumeric chars", () => {
    // trailing "!" → "-" → stripped by trailing-dash rule
    expect(sanitizeProjectName("My Medical Agent!")).toBe("my-medical-agent");
  });

  it("replaces spaces with dashes and collapses consecutive dashes", () => {
    // "foo  bar" → "foo--bar" → collapse → "foo-bar"; "__" is kept as-is
    expect(sanitizeProjectName("foo  bar__baz")).toBe("foo-bar__baz");
    expect(sanitizeProjectName("a---b")).toBe("a-b");
  });

  it("strips leading and trailing dashes", () => {
    expect(sanitizeProjectName("-foo-")).toBe("foo");
  });

  it("passthrough for already-valid names", () => {
    expect(sanitizeProjectName("my-project-v2")).toBe("my-project-v2");
    expect(sanitizeProjectName("agent_01")).toBe("agent_01");
  });

  it("appends -proj to Windows reserved names", () => {
    expect(sanitizeProjectName("CON")).toBe("con-proj");
    expect(sanitizeProjectName("NUL")).toBe("nul-proj");
    expect(sanitizeProjectName("com1")).toBe("com1-proj");
    expect(sanitizeProjectName("LPT9")).toBe("lpt9-proj");
  });

  it("truncates at 64 characters", () => {
    const long = "a".repeat(100);
    expect(sanitizeProjectName(long)).toBe("a".repeat(64));
  });

  it("throws PackError when sanitized result is empty", () => {
    expect(() => sanitizeProjectName("---")).toThrow(PackError);
    expect(() => sanitizeProjectName("!!!")).toThrow(PackError);
    expect(() => sanitizeProjectName("")).toThrow(PackError);
  });

  it("throws PackError with PRECHECK exit code (10)", () => {
    try {
      sanitizeProjectName("!!!");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PackError);
      expect(e.exitCode).toBe(10);
    }
  });

  it("precheck returns sanitized projectName for project mode", () => {
    const ccDir = path.join(tmpDir, ".chainlesschain");
    fs.mkdirSync(ccDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccDir, "config.json"),
      JSON.stringify({ name: "My Agent" }),
      "utf-8",
    );
    const r = precheck({ projectRoot: tmpDir, allowDirty: true });
    expect(r.projectMode).toBe(true);
    expect(r.projectName).toBe("my-agent");
  });

  it("precheck returns projectName:null in CLI-only mode", () => {
    const r = precheck({ projectRoot: tmpDir, allowDirty: true });
    expect(r.projectMode).toBe(false);
    expect(r.projectName).toBeNull();
  });
});
