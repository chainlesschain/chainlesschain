import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MarkdownSkill } from "../markdown-skill.js";
import { SkillMdParser } from "../skill-md-parser.js";
import {
  LOCK_FILENAME,
  buildSkillSignatureLock,
  inspectSkillExecution,
  preflightSkillPath,
} from "../skill-execution-security.js";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_SKILL_ROOT = path.resolve(TEST_DIRECTORY, "..", "builtin");
const AUDITED_BUNDLED_SKILLS = [
  {
    skillId: "color-picker",
    executionCapabilities: ["data:result", "data:task", "runtime:random"],
  },
  {
    skillId: "text-transformer",
    executionCapabilities: ["data:result", "data:task", "runtime:crypto"],
  },
];

function writeSkill(root, overrides = {}) {
  const skillDir = path.join(root, overrides.dirName || "test-skill");
  fs.mkdirSync(skillDir, { recursive: true });
  const executionCapabilities = overrides.executionCapabilities ?? [
    "data:task",
    "data:result",
  ];
  const skillMd = `---
name: ${overrides.name || "test-skill"}
description: Security test skill
version: 1.0.0
handler: ./handler.js
execution-capabilities: [${executionCapabilities.join(", ")}]
---

# Security test
`;
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd);
  fs.writeFileSync(
    path.join(skillDir, "handler.js"),
    overrides.handler ||
      "module.exports = { execute: async (task) => ({ success: true, value: task.value }) };\n",
  );
  return {
    skillDir,
    definition: {
      name: overrides.name || "test-skill",
      description: "Security test skill",
      version: "1.0.0",
      handler: "./handler.js",
      executionCapabilities,
      source: overrides.source || "managed",
      sourcePath: path.join(skillDir, "SKILL.md"),
      body: "# Security test",
    },
  };
}

function createSigningIdentity() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const fingerprint = crypto
    .createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  return { privateKey, publicKey, fingerprint };
}

function signSkill(fixture, identity) {
  const lock = buildSkillSignatureLock(fixture.definition, {
    privateKey: identity.privateKey,
    publicKey: identity.publicKey,
    allowedRoot: fixture.skillDir,
  });
  fs.writeFileSync(
    path.join(fixture.skillDir, LOCK_FILENAME),
    JSON.stringify(lock, null, 2),
  );
}

describe("skill execution supply-chain boundary", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-skill-security-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects lexical handler escapes before module resolution", () => {
    const fixture = writeSkill(tempDir);
    fs.writeFileSync(
      path.join(tempDir, "outside.js"),
      "module.exports = {};\n",
    );
    fixture.definition.handler = "./../outside.js";

    expect(() =>
      inspectSkillExecution(fixture.definition, {
        allowedRoot: fixture.skillDir,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_SKILL_HANDLER_ESCAPE" }),
    );
  });

  it("rejects a SKILL.md symlink instead of following it", () => {
    const fixture = writeSkill(tempDir, { dirName: "real" });
    const linkedDir = path.join(tempDir, "linked");
    fs.mkdirSync(linkedDir);
    fs.rmSync(path.join(linkedDir, "SKILL.md"), { force: true });
    try {
      fs.symlinkSync(
        path.join(fixture.skillDir, "SKILL.md"),
        path.join(linkedDir, "SKILL.md"),
        "file",
      );
    } catch (error) {
      if (["EPERM", "EACCES"].includes(error.code)) return;
      throw error;
    }

    expect(() => preflightSkillPath(linkedDir, tempDir)).toThrowError(
      expect.objectContaining({ code: "CC_SKILL_COMPONENT_UNSAFE" }),
    );
  });

  it("rejects a hard-linked handler instead of treating it as contained", () => {
    const fixture = writeSkill(tempDir);
    const outsidePath = path.join(tempDir, "outside-hardlink.js");
    fs.writeFileSync(outsidePath, "module.exports = {};\n");
    fs.rmSync(path.join(fixture.skillDir, "handler.js"));
    fs.linkSync(outsidePath, path.join(fixture.skillDir, "handler.js"));

    expect(() =>
      inspectSkillExecution(fixture.definition, {
        allowedRoot: fixture.skillDir,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_SKILL_COMPONENT_UNSAFE" }),
    );
  });

  it("verifies the current component manifest with a pinned Ed25519 key", () => {
    const fixture = writeSkill(tempDir);
    const identity = createSigningIdentity();
    signSkill(fixture, identity);

    const inspection = inspectSkillExecution(fixture.definition, {
      allowedRoot: fixture.skillDir,
      trustedSkillKeySha256: [identity.fingerprint],
    });

    expect(inspection).toMatchObject({
      mode: "external-isolated",
      signed: true,
      trusted: true,
      capabilityManifestValid: true,
      publicKeySha256: identity.fingerprint,
    });
  });

  it("invalidates the signature when handler bytes change", () => {
    const fixture = writeSkill(tempDir);
    const identity = createSigningIdentity();
    signSkill(fixture, identity);
    fs.appendFileSync(
      path.join(fixture.skillDir, "handler.js"),
      "// tampered\n",
    );

    const inspection = inspectSkillExecution(fixture.definition, {
      allowedRoot: fixture.skillDir,
      trustedSkillKeySha256: [identity.fingerprint],
    });

    expect(inspection.signed).toBe(false);
    expect(inspection.signatureReason).toContain("does not match");
  });

  it("rejects parsed metadata captured from different SKILL.md bytes", () => {
    const fixture = writeSkill(tempDir);
    fixture.definition._sourceContentSha256 = "0".repeat(64);

    expect(() =>
      inspectSkillExecution(fixture.definition, {
        allowedRoot: fixture.skillDir,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_SKILL_SOURCE_IDENTITY_MISMATCH" }),
    );
  });

  it("requires an explicit capability manifest before signing", () => {
    const fixture = writeSkill(tempDir, { executionCapabilities: [] });
    const identity = createSigningIdentity();

    expect(() => signSkill(fixture, identity)).toThrow(
      /capability manifest is required/i,
    );
  });

  it("blocks unsigned external handlers before require()", async () => {
    const fixture = writeSkill(tempDir, {
      handler: 'throw new Error("handler was imported");\n',
    });
    fixture.definition._skillSecurityPolicy = {
      allowedRoot: fixture.skillDir,
      trustedBundledRoot: path.join(tempDir, "not-bundled"),
      trustedSkillKeySha256: [],
    };
    const skill = new MarkdownSkill(fixture.definition);

    await expect(skill.execute({ value: 1 })).rejects.toMatchObject({
      code: "CC_SKILL_SIGNATURE_REQUIRED",
    });
    expect(
      require.cache[path.join(fixture.skillDir, "handler.js")],
    ).toBeUndefined();
  });

  it("blocks a valid signature when its signer is not pinned", async () => {
    const fixture = writeSkill(tempDir);
    signSkill(fixture, createSigningIdentity());
    fixture.definition._skillSecurityPolicy = {
      allowedRoot: fixture.skillDir,
      trustedBundledRoot: path.join(tempDir, "not-bundled"),
      trustedSkillKeySha256: [],
    };
    const skill = new MarkdownSkill(fixture.definition);

    await expect(skill.execute({})).rejects.toMatchObject({
      code: "CC_SKILL_SIGNER_UNTRUSTED",
    });
  });

  it("routes a trusted external handler only through the isolated executor", async () => {
    const fixture = writeSkill(tempDir, {
      handler: 'throw new Error("handler was imported into Electron main");\n',
    });
    const identity = createSigningIdentity();
    signSkill(fixture, identity);
    const policy = {
      allowedRoot: fixture.skillDir,
      trustedBundledRoot: path.join(tempDir, "not-bundled"),
      trustedSkillKeySha256: [identity.fingerprint],
    };
    fixture.definition._skillSecurityPolicy = policy;
    fixture.definition._executionSecurity = inspectSkillExecution(
      fixture.definition,
      policy,
    );
    const isolatedExecutor = vi.fn(async (request) => ({
      success: true,
      digest: request.contentDigest,
    }));
    fixture.definition._externalHandlerExecutor = isolatedExecutor;
    const skill = new MarkdownSkill(fixture.definition);

    const result = await skill.execute({ value: 2 });

    expect(result.success).toBe(true);
    expect(isolatedExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: "test-skill",
        handlerFileName: "handler.js",
        handlerSource: expect.stringContaining("Electron main"),
        executionCapabilities: ["data:result", "data:task"],
        publicKeySha256: identity.fingerprint,
      }),
    );
    expect(isolatedExecutor.mock.calls[0][0]).not.toHaveProperty("handlerPath");
    expect(
      require.cache[path.join(fixture.skillDir, "handler.js")],
    ).toBeUndefined();
  });

  it.each(AUDITED_BUNDLED_SKILLS)(
    "enforces the shipped $skillId capability audit",
    async ({ skillId, executionCapabilities }) => {
      const sourcePath = path.join(BUILTIN_SKILL_ROOT, skillId, "SKILL.md");
      const parser = new SkillMdParser({ strictValidation: false });
      const definition = await parser.parseFile(sourcePath);
      definition.source = "bundled";

      const inspection = inspectSkillExecution(definition, {
        allowedRoot: BUILTIN_SKILL_ROOT,
        trustedBundledRoot: BUILTIN_SKILL_ROOT,
      });

      expect(inspection).toMatchObject({
        packageOwned: true,
        bundledCapabilityMigrated: true,
        capabilityManifestValid: true,
        executionCapabilities,
      });
      expect(inspection.bundledCapabilityAuditDigest).toMatch(/^[a-f0-9]{64}$/);
    },
  );

  it("rejects capability broadening or handler drift for an audited bundled Skill", () => {
    const auditedHandler = fs.readFileSync(
      path.join(BUILTIN_SKILL_ROOT, "text-transformer", "handler.js"),
      "utf8",
    );
    const policy = {
      allowedRoot: tempDir,
      trustedBundledRoot: tempDir,
      trustedSkillKeySha256: [],
    };
    const broadened = writeSkill(tempDir, {
      name: "text-transformer",
      dirName: "text-transformer",
      source: "bundled",
      executionCapabilities: [
        "data:result",
        "data:task",
        "runtime:crypto",
        "filesystem:read",
      ],
      handler: auditedHandler,
    });

    expect(() =>
      inspectSkillExecution(broadened.definition, policy),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_CAPABILITY_AUDIT_FAILED",
      }),
    );

    const driftRoot = path.join(tempDir, "drift-root");
    const drifted = writeSkill(driftRoot, {
      name: "text-transformer",
      dirName: "text-transformer",
      source: "bundled",
      executionCapabilities: ["data:result", "data:task", "runtime:crypto"],
      handler: `${auditedHandler}\n// unreviewed source drift\n`,
    });
    expect(() =>
      inspectSkillExecution(drifted.definition, {
        ...policy,
        allowedRoot: driftRoot,
        trustedBundledRoot: driftRoot,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_CAPABILITY_AUDIT_FAILED",
      }),
    );
  });

  it("rejects an execution capability declaration without a bundled audit entry", () => {
    const fixture = writeSkill(tempDir, { source: "bundled" });

    expect(() =>
      inspectSkillExecution(fixture.definition, {
        allowedRoot: tempDir,
        trustedBundledRoot: tempDir,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_CAPABILITY_AUDIT_FAILED",
      }),
    );
  });

  it("permits package-owned bundled handlers but detects post-discovery drift", async () => {
    const fixture = writeSkill(tempDir, {
      source: "bundled",
      executionCapabilities: [],
    });
    const policy = {
      allowedRoot: tempDir,
      trustedBundledRoot: tempDir,
      trustedSkillKeySha256: [],
    };
    fixture.definition._skillSecurityPolicy = policy;
    fixture.definition._executionSecurity = inspectSkillExecution(
      fixture.definition,
      policy,
    );
    const skill = new MarkdownSkill(fixture.definition);

    await expect(skill.execute({ value: 7 })).resolves.toMatchObject({
      success: true,
      value: 7,
    });

    const driftFixture = writeSkill(tempDir, {
      name: "drift-skill",
      dirName: "drift-skill",
      source: "bundled",
      executionCapabilities: [],
    });
    driftFixture.definition._skillSecurityPolicy = policy;
    driftFixture.definition._executionSecurity = inspectSkillExecution(
      driftFixture.definition,
      policy,
    );
    fs.appendFileSync(
      path.join(driftFixture.skillDir, "handler.js"),
      "// changed after discovery\n",
    );
    const driftSkill = new MarkdownSkill(driftFixture.definition);

    await expect(driftSkill.execute({})).rejects.toMatchObject({
      code: "CC_SKILL_DIGEST_DRIFT",
    });
  });
});
