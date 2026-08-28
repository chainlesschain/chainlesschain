import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  SKILL_PACKAGE_FORMAT,
  SkillSyncManager,
  calculateSkillPackageChecksum,
} from "../skill-sync-manager.js";
import {
  LOCK_FILENAME,
  buildSkillSignatureLock,
} from "../skill-execution-security.js";
import { registerSkillSyncIPC } from "../skill-sync-ipc.js";

function skillMarkdown({
  name = "portable-skill",
  version = "1.0.0",
  handler = true,
  capabilities = true,
} = {}) {
  return `---
name: ${name}
description: Portable security test skill
version: ${version}
${handler ? "handler: ./handler.js" : ""}
${capabilities ? "execution-capabilities: [data:task, data:result]" : ""}
---

# Portable skill
`;
}

function makePackage(overrides = {}) {
  const skillId = overrides.skillId || "portable-skill";
  const version = overrides.version || "1.0.0";
  const pkg = {
    format: SKILL_PACKAGE_FORMAT,
    metadata: {
      skillId,
      name: skillId,
      version,
      category: "testing",
      description: "Portable security test skill",
      source: "managed",
      executionCapabilities: ["data:task", "data:result"],
      ...(overrides.metadata || {}),
    },
    body:
      overrides.body ??
      skillMarkdown({
        name: skillId,
        version,
        handler: overrides.handler !== null,
        capabilities: overrides.capabilities !== false,
      }),
    handler:
      overrides.handler === undefined
        ? "module.exports = { execute: async () => ({ success: true }) };\n"
        : overrides.handler,
    signatureLock: overrides.signatureLock || null,
    exportedAt: Date.now(),
    exportedFrom: "test-device",
  };
  pkg.checksum = calculateSkillPackageChecksum(pkg);
  return pkg;
}

function registry(overrides = {}) {
  return {
    getSkill: vi.fn(() => null),
    getAllSkills: vi.fn(() => []),
    hotLoadSkill: vi.fn(() => true),
    ...overrides,
  };
}

describe("SkillSyncManager package boundary", () => {
  let tempDir;
  let managedDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-skill-sync-"));
    managedDir = path.join(tempDir, "managed");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects package identifiers that could escape the managed root", async () => {
    const manager = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
    });
    const pkg = makePackage({ skillId: "../../outside" });

    await expect(manager.importSkill(pkg)).rejects.toMatchObject({
      code: "CC_SKILL_NAME_INVALID",
    });
    expect(fs.existsSync(path.join(tempDir, "outside"))).toBe(false);
  });

  it("rejects oversized components before creating the managed root", async () => {
    const manager = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
    });
    const pkg = makePackage({ body: "x".repeat(256 * 1024 + 1) });

    await expect(manager.importSkill(pkg)).rejects.toMatchObject({
      code: "CC_SKILL_PACKAGE_TOO_LARGE",
    });
    expect(fs.existsSync(managedDir)).toBe(false);
  });

  it.each([
    ["name", makePackage({ body: skillMarkdown({ name: "different-skill" }) })],
    [
      "version",
      makePackage({
        version: "2.0.0",
        body: skillMarkdown({ version: "1.0.0" }),
      }),
    ],
  ])("rejects %s metadata that differs from SKILL.md", async (_field, pkg) => {
    const manager = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
    });

    await expect(manager.importSkill(pkg)).rejects.toThrow(/does not match/i);
  });

  it("rejects executable packages without an explicit capability manifest", async () => {
    const manager = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
    });
    const pkg = makePackage({ capabilities: false });

    await expect(manager.importSkill(pkg)).rejects.toThrow(
      /capability manifest/i,
    );
  });

  it("rejects a package whose component checksum was changed", async () => {
    const manager = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
    });
    const pkg = makePackage();
    pkg.handler += "// modified in transit\n";

    await expect(manager.importSkill(pkg)).rejects.toThrow(
      /checksum mismatch/i,
    );
    expect(fs.existsSync(managedDir)).toBe(false);
  });

  it("replaces stale executable components when importing documentation only", async () => {
    const skillDir = path.join(managedDir, "portable-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "handler.js"), "stale\n");
    fs.writeFileSync(path.join(skillDir, LOCK_FILENAME), "{}\n");
    const manager = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
    });
    const pkg = makePackage({
      body: skillMarkdown({ handler: false, capabilities: false }),
      handler: null,
    });

    await expect(manager.importSkill(pkg)).resolves.toMatchObject({
      action: "imported",
      reloadRequired: true,
    });
    expect(fs.existsSync(path.join(skillDir, "handler.js"))).toBe(false);
    expect(fs.existsSync(path.join(skillDir, LOCK_FILENAME))).toBe(false);
  });

  it("preserves the detached Ed25519 lock across export and import", async () => {
    const sourceDir = path.join(tempDir, "source", "portable-skill");
    fs.mkdirSync(sourceDir, { recursive: true });
    const sourcePath = path.join(sourceDir, "SKILL.md");
    const body = skillMarkdown();
    fs.writeFileSync(sourcePath, body);
    fs.writeFileSync(
      path.join(sourceDir, "handler.js"),
      "module.exports = { execute: async () => ({ success: true }) };\n",
    );
    const definition = {
      name: "portable-skill",
      description: "Portable security test skill",
      version: "1.0.0",
      category: "testing",
      handler: "./handler.js",
      executionCapabilities: ["data:task", "data:result"],
      source: "managed",
      sourcePath,
    };
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const lock = buildSkillSignatureLock(definition, {
      privateKey,
      publicKey,
      allowedRoot: sourceDir,
    });
    fs.writeFileSync(
      path.join(sourceDir, LOCK_FILENAME),
      JSON.stringify(lock, null, 2),
    );
    const exportedSkill = {
      skillId: "portable-skill",
      name: "Portable skill",
      version: "1.0.0",
      category: "testing",
      description: "Portable security test skill",
      source: "managed",
      getDefinition: () => definition,
    };
    const exporter = new SkillSyncManager({
      skillRegistry: registry({ getSkill: vi.fn(() => exportedSkill) }),
      managedDir: path.join(tempDir, "unused"),
    });
    const pkg = exporter.exportSkill("portable-skill");
    const importer = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
    });

    await importer.importSkill(pkg);

    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(managedDir, "portable-skill", LOCK_FILENAME),
          "utf8",
        ),
      ),
    ).toEqual(lock);
  });

  it("rejects escaped handlers during export", () => {
    const sourceDir = path.join(tempDir, "source", "portable-skill");
    fs.mkdirSync(sourceDir, { recursive: true });
    const sourcePath = path.join(sourceDir, "SKILL.md");
    fs.writeFileSync(
      sourcePath,
      skillMarkdown().replace("./handler.js", "./../outside.js"),
    );
    fs.writeFileSync(
      path.join(tempDir, "source", "outside.js"),
      "module.exports = {};\n",
    );
    const definition = {
      name: "portable-skill",
      version: "1.0.0",
      handler: "./../outside.js",
      executionCapabilities: ["data:task", "data:result"],
      source: "managed",
      sourcePath,
    };
    const manager = new SkillSyncManager({
      skillRegistry: registry({
        getSkill: vi.fn(() => ({
          skillId: "portable-skill",
          source: "managed",
          getDefinition: () => definition,
        })),
      }),
      managedDir,
    });

    expect(() => manager.exportSkill("portable-skill")).toThrowError(
      expect.objectContaining({ code: "CC_SKILL_HANDLER_ESCAPE" }),
    );
  });
});

describe("Skill sync IPC async boundary", () => {
  it("does not report import success before asynchronous validation finishes", async () => {
    const handlers = new Map();
    const ipcMain = {
      handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    };
    let finishImport;
    const importPromise = new Promise((resolve) => {
      finishImport = resolve;
    });
    registerSkillSyncIPC({
      syncManager: { importSkill: vi.fn(() => importPromise) },
      ipcMain,
    });
    const handler = handlers.get("skills:sync:import");
    let settled = false;
    const responsePromise = handler({}, { package: {} }).then((response) => {
      settled = true;
      return response;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    finishImport({ action: "imported" });
    await expect(responsePromise).resolves.toEqual({
      success: true,
      data: { action: "imported" },
    });
  });
});
