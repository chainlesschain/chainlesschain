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
const artifactProtocol = require("@chainlesschain/session-core/evolvable-artifact");

const {
  ARTIFACT_TYPE,
  EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
  createEvolvableArtifactPolicy,
  createEvolvableArtifactAuthority,
  createEvolvableArtifactCandidateGate,
} = artifactProtocol;

const CANDIDATE_ID = `sha256:${"c".repeat(64)}`;

function candidateStore({ receipt = {}, readback = {}, onCreate } = {}) {
  const records = new Map();
  const store = {
    create: vi.fn(async (request) => {
      onCreate?.(request);
      const createReceipt = {
        schema: request.schema,
        version: request.version,
        candidateId: CANDIDATE_ID,
        status: request.status,
        persisted: request.persisted,
        skillId: request.skillId,
        sourceDigest: request.sourceDigest,
        derivationMode: request.derivationMode,
        trust: request.trust,
        quarantined: request.quarantined,
        ...receipt,
      };
      const readbackFields =
        typeof readback === "function"
          ? readback(request, createReceipt)
          : readback;
      records.set(createReceipt.candidateId, {
        ...createReceipt,
        sourceEvidence: request.sourceEvidence,
        package: request.package,
        ...readbackFields,
      });
      return createReceipt;
    }),
    read: vi.fn(async (candidateId) => records.get(candidateId) || null),
  };
  return store;
}

function unifiedSkillCandidateGate(onPersist = () => {}) {
  const revision = "skill-sync-policy-v1";
  const allow = () => ({ decision: "allow", policyRevision: revision });
  const authority = createEvolvableArtifactAuthority({
    tenantId: "tenant-a",
    policy: createEvolvableArtifactPolicy({
      type: ARTIFACT_TYPE.SKILL,
      revision,
      admission: allow,
      evaluator: allow,
      activation: allow,
      rollback: allow,
    }),
  });
  return createEvolvableArtifactCandidateGate({
    authority,
    candidateWriter: {
      async persistCandidate(artifact, content) {
        onPersist(artifact, content);
        return {
          schema: EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
          tenantId: artifact.tenantId,
          type: artifact.type,
          artifactId: artifact.artifactId,
          candidateId: artifact.candidate.candidateId,
          contentDigest: artifact.contentDigest,
          artifactDigest: artifact.artifactDigest,
          status: "candidate",
          persisted: true,
        };
      },
    },
  });
}

function stagedImportResult(overrides = {}) {
  return {
    skillId: "portable-skill",
    action: "candidate-staged",
    version: "1.0.0",
    candidateId: CANDIDATE_ID,
    sourceDigest: `sha256:${"d".repeat(64)}`,
    candidateOnly: true,
    persisted: true,
    trust: "untrusted",
    quarantined: true,
    activeMutation: false,
    hotLoaded: false,
    reloadRequired: false,
    ...overrides,
  };
}

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

  it("fails closed when no durable candidate store is wired", async () => {
    const manager = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
    });

    await expect(manager.importSkill(makePackage())).rejects.toMatchObject({
      code: "CC_SKILL_SYNC_CANDIDATE_STORE_UNAVAILABLE",
    });
    expect(fs.existsSync(managedDir)).toBe(false);
  });

  it("can route the legacy sync import through the shared Skill artifact gate", async () => {
    const persisted = vi.fn();
    const manager = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
      artifactCandidateGate: unifiedSkillCandidateGate(persisted),
    });
    const result = await manager.importSkill(makePackage());

    expect(result).toMatchObject({
      action: "candidate-staged",
      candidateOnly: true,
      activeMutation: false,
      hotLoaded: false,
      reloadRequired: false,
    });
    expect(result.candidateId).toBe(result.sourceDigest);
    expect(result.persistenceReceipt.persisted).toBe(true);
    expect(persisted).toHaveBeenCalledOnce();
    expect(persisted.mock.calls[0][0]).toMatchObject({
      tenantId: "tenant-a",
      type: "skill",
      artifactId: "skill:portable-skill",
      release: null,
      activeReleaseId: null,
    });
    expect(persisted.mock.calls[0][1]).toMatchObject({
      format: SKILL_PACKAGE_FORMAT,
      metadata: { skillId: "portable-skill" },
    });
    expect(fs.existsSync(managedDir)).toBe(false);
  });

  it("stages documentation-only imports without changing active components", async () => {
    const skillDir = path.join(managedDir, "portable-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "handler.js"), "stale\n");
    fs.writeFileSync(path.join(skillDir, LOCK_FILENAME), "{}\n");
    const store = candidateStore();
    const manager = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
      candidateStore: store,
    });
    const pkg = makePackage({
      body: skillMarkdown({ handler: false, capabilities: false }),
      handler: null,
    });

    await expect(manager.importSkill(pkg)).resolves.toMatchObject({
      action: "candidate-staged",
      candidateId: CANDIDATE_ID,
      candidateOnly: true,
      persisted: true,
      trust: "untrusted",
      quarantined: true,
      activeMutation: false,
      hotLoaded: false,
    });
    expect(fs.readFileSync(path.join(skillDir, "handler.js"), "utf8")).toBe(
      "stale\n",
    );
    expect(fs.readFileSync(path.join(skillDir, LOCK_FILENAME), "utf8")).toBe(
      "{}\n",
    );
    expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(false);
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "chainlesschain.skill-sync-candidate/v1",
        version: 1,
        skillId: "portable-skill",
        derivationMode: "manual-import",
        trust: "untrusted",
        quarantined: true,
        sourceEvidence: expect.objectContaining({
          digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        }),
      }),
    );
    expect(store.read).toHaveBeenCalledWith(CANDIDATE_ID);
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
    const store = candidateStore();
    const importer = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
      candidateStore: store,
    });

    await expect(importer.importSkill(pkg)).resolves.toMatchObject({
      action: "candidate-staged",
      activeMutation: false,
    });

    expect(store.create.mock.calls[0][0].package.signatureLock).toEqual(lock);
    expect(fs.existsSync(managedDir)).toBe(false);
  });

  it("does not report success for an invalid candidate persistence receipt", async () => {
    const manager = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
      candidateStore: candidateStore({ receipt: { persisted: false } }),
    });

    await expect(manager.importSkill(makePackage())).rejects.toMatchObject({
      code: "CC_SKILL_SYNC_CANDIDATE_PERSISTENCE_FAILED",
    });
    expect(fs.existsSync(managedDir)).toBe(false);
  });

  it("requires an exact, source-bound candidate create receipt", async () => {
    const withExtraField = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
      candidateStore: candidateStore({ receipt: { unexpected: true } }),
    });
    const withWrongSource = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
      candidateStore: candidateStore({
        receipt: { sourceDigest: `sha256:${"d".repeat(64)}` },
      }),
    });
    const withWrongSchema = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
      candidateStore: candidateStore({
        receipt: { schema: "chainlesschain.skill-sync-candidate/v2" },
      }),
    });

    await expect(
      withExtraField.importSkill(makePackage()),
    ).rejects.toMatchObject({
      code: "CC_SKILL_SYNC_CANDIDATE_PERSISTENCE_FAILED",
    });
    await expect(
      withWrongSource.importSkill(makePackage()),
    ).rejects.toMatchObject({
      code: "CC_SKILL_SYNC_CANDIDATE_PERSISTENCE_FAILED",
    });
    await expect(
      withWrongSchema.importSkill(makePackage()),
    ).rejects.toMatchObject({
      code: "CC_SKILL_SYNC_CANDIDATE_PERSISTENCE_FAILED",
    });
  });

  it("rejects missing or canonically different candidate readback", async () => {
    const missingStore = candidateStore();
    missingStore.read.mockResolvedValue(null);
    const missing = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
      candidateStore: missingStore,
    });
    const changed = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
      candidateStore: candidateStore({
        readback: (request) => ({
          package: {
            ...request.package,
            metadata: {
              ...request.package.metadata,
              description: "changed after create",
            },
          },
        }),
      }),
    });
    const extended = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
      candidateStore: candidateStore({
        readback: { unverifiedExtension: true },
      }),
    });

    await expect(missing.importSkill(makePackage())).rejects.toMatchObject({
      code: "CC_SKILL_SYNC_CANDIDATE_PERSISTENCE_FAILED",
    });
    await expect(changed.importSkill(makePackage())).rejects.toMatchObject({
      code: "CC_SKILL_SYNC_CANDIDATE_PERSISTENCE_FAILED",
    });
    await expect(extended.importSkill(makePackage())).rejects.toMatchObject({
      code: "CC_SKILL_SYNC_CANDIDATE_PERSISTENCE_FAILED",
    });
  });

  it("deep-freezes the untrusted quarantined candidate package", async () => {
    let createRequest;
    const store = candidateStore({
      onCreate: (request) => {
        createRequest = request;
      },
    });
    const manager = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
      candidateStore: store,
    });

    await manager.importSkill(
      makePackage({
        metadata: { nested: { value: "before" } },
        signatureLock: { nested: { keyId: "test" } },
      }),
    );

    expect(Object.isFrozen(createRequest)).toBe(true);
    expect(Object.isFrozen(createRequest.package)).toBe(true);
    expect(Object.isFrozen(createRequest.package.metadata.nested)).toBe(true);
    expect(Object.isFrozen(createRequest.package.signatureLock.nested)).toBe(
      true,
    );
    expect(createRequest.trust).toBe("untrusted");
    expect(createRequest.quarantined).toBe(true);
  });

  it.each([
    ["exportedAt", { exportedAt: Date.now() + 10 * 60 * 1000 }],
    ["exportedFrom", { exportedFrom: "x".repeat(257) }],
  ])("rejects an unbounded %s source field", async (_field, sourceOverride) => {
    const store = candidateStore();
    const manager = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
      candidateStore: store,
    });
    const pkg = Object.assign(makePackage(), sourceOverride);

    await expect(manager.importSkill(pkg)).rejects.toMatchObject({
      code: "CC_SKILL_SYNC_SOURCE_INVALID",
    });
    expect(store.create).not.toHaveBeenCalled();
  });

  it("uses the package-level export time for same-version conflicts", async () => {
    const store = candidateStore();
    const localTime = Date.now() - 10_000;
    const manager = new SkillSyncManager({
      skillRegistry: registry({
        getSkill: vi.fn(() => ({ version: "1.0.0", updatedAt: localTime })),
      }),
      managedDir,
      candidateStore: store,
    });
    const pkg = makePackage({ metadata: { exportedAt: 0, updatedAt: 0 } });
    pkg.exportedAt = localTime + 1;

    await expect(manager.importSkill(pkg)).resolves.toMatchObject({
      action: "candidate-staged",
    });
    expect(store.create).toHaveBeenCalledOnce();
  });

  it("rejects unsupported conflict resolutions and remote identity changes", async () => {
    const manager = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
      candidateStore: candidateStore(),
    });

    await expect(
      manager.resolveConflict("portable-skill", "merge", makePackage()),
    ).rejects.toMatchObject({
      code: "CC_SKILL_SYNC_CONFLICT_RESOLUTION_INVALID",
    });
    await expect(
      manager.resolveConflict(
        "portable-skill",
        "use-remote",
        makePackage({ skillId: "different-skill" }),
      ),
    ).rejects.toMatchObject({
      code: "CC_SKILL_SYNC_CONFLICT_IDENTITY_MISMATCH",
    });
  });

  it("emits candidate-staged download semantics without claiming installation", async () => {
    const manager = new SkillSyncManager({
      skillRegistry: registry(),
      managedDir,
      candidateStore: candidateStore(),
    });
    const staged = vi.fn();
    const downloaded = vi.fn();
    manager.on("skill-download-candidate-staged", staged);
    manager.on("skill-downloaded", downloaded);

    await manager._handleDownloadResponse("peer-1", {
      package: makePackage(),
    });

    expect(staged).toHaveBeenCalledWith(
      expect.objectContaining({
        peerId: "peer-1",
        result: expect.objectContaining({ action: "candidate-staged" }),
      }),
    );
    expect(downloaded).not.toHaveBeenCalled();
  });

  it("emits skipped download semantics without claiming installation", async () => {
    const manager = new SkillSyncManager({
      skillRegistry: registry({
        getSkill: vi.fn(() => ({
          version: "2.0.0",
          updatedAt: Date.now(),
        })),
      }),
      managedDir,
    });
    const skipped = vi.fn();
    const downloaded = vi.fn();
    manager.on("skill-download-skipped", skipped);
    manager.on("skill-downloaded", downloaded);

    await manager._handleDownloadResponse("peer-1", {
      package: makePackage(),
    });

    expect(skipped).toHaveBeenCalledWith(
      expect.objectContaining({
        peerId: "peer-1",
        result: expect.objectContaining({ action: "skipped" }),
      }),
    );
    expect(downloaded).not.toHaveBeenCalled();
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

    const result = stagedImportResult();
    finishImport(result);
    await expect(responsePromise).resolves.toEqual({
      success: true,
      data: result,
    });
  });

  it("returns a structured failure for malformed IPC arguments", async () => {
    const handlers = new Map();
    registerSkillSyncIPC({
      syncManager: { importSkill: vi.fn() },
      ipcMain: {
        handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
      },
    });

    await expect(
      handlers.get("skills:sync:import")({}, null),
    ).resolves.toMatchObject({
      success: false,
      code: "CC_SKILL_SYNC_IPC_INVALID_ARGUMENT",
      error: expect.any(String),
    });
  });

  it("preserves manager error codes across the IPC boundary", async () => {
    const handlers = new Map();
    const error = Object.assign(new Error("candidate store unavailable"), {
      code: "CC_SKILL_SYNC_CANDIDATE_STORE_UNAVAILABLE",
    });
    registerSkillSyncIPC({
      syncManager: { importSkill: vi.fn(async () => Promise.reject(error)) },
      ipcMain: {
        handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
      },
    });

    await expect(
      handlers.get("skills:sync:import")({}, { package: {} }),
    ).resolves.toEqual({
      success: false,
      error: "candidate store unavailable",
      code: "CC_SKILL_SYNC_CANDIDATE_STORE_UNAVAILABLE",
    });
  });

  it("rejects a manager result that only claims candidate staging", async () => {
    const handlers = new Map();
    registerSkillSyncIPC({
      syncManager: {
        importSkill: vi.fn(async () => ({
          action: "candidate-staged",
          activeMutation: false,
        })),
      },
      ipcMain: {
        handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
      },
    });

    await expect(
      handlers.get("skills:sync:import")({}, { package: {} }),
    ).resolves.toMatchObject({
      success: false,
      code: "CC_SKILL_SYNC_IMPORT_RESULT_INVALID",
    });
  });

  it("accepts an explicit skipped/no-mutation import outcome", async () => {
    const handlers = new Map();
    const result = {
      skillId: "portable-skill",
      action: "skipped",
      reason: "local-version-newer",
      candidateOnly: true,
      persisted: false,
      activeMutation: false,
      hotLoaded: false,
      reloadRequired: false,
    };
    registerSkillSyncIPC({
      syncManager: { importSkill: vi.fn(async () => result) },
      ipcMain: {
        handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
      },
    });

    await expect(
      handlers.get("skills:sync:import")({}, { package: {} }),
    ).resolves.toEqual({ success: true, data: result });
  });
});
