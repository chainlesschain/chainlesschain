import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const secureFsMocks = vi.hoisted(() => ({
  ensurePrivateDirectory: vi.fn(),
  ensurePrivateFile: vi.fn(),
}));

vi.mock("../../src/lib/secure-fs.js", () => secureFsMocks);

import {
  SKILL_CANDIDATE_SCHEMA,
  SkillCandidateRegistry,
  buildSkillCandidateDraft,
  verifySkillCandidateDraft,
} from "../../src/lib/evolution/skill-candidate-registry.js";

const EVIDENCE_DIGEST = `sha256:${"1".repeat(64)}`;

function draftInput(overrides = {}) {
  return {
    skillName: "repair-unit-tests",
    parentDigest: null,
    sourceEvidenceRefs: [
      {
        ref: "recording://runs/run-1",
        digest: EVIDENCE_DIGEST,
      },
    ],
    derivationMode: "record-replay",
    wikiRevision: null,
    proposerModel: null,
    targetRuntimes: ["desktop", "cli"],
    requestedCapabilities: ["workspace.write", "workspace.read"],
    evalRunId: null,
    content: "---\nname: repair-unit-tests\n---\n\nRun the focused tests.\n",
    ...overrides,
  };
}

function artifactPath(rootDir, candidateId) {
  return path.join(rootDir, `${candidateId.slice("sha256:".length)}.json`);
}

function capturedError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error("expected callback to throw");
}

describe("SkillCandidateRegistry", () => {
  let tempRoot;
  let registryRoot;

  beforeEach(() => {
    secureFsMocks.ensurePrivateDirectory.mockClear();
    secureFsMocks.ensurePrivateFile.mockClear();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-skill-candidates-"));
    registryRoot = path.join(tempRoot, "registry", "candidates");
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("builds deterministic, deeply immutable drafts with canonical sets", () => {
    const evidence = [
      {
        ref: "wiki://patterns/z-last",
        digest: `sha256:${"2".repeat(64)}`,
      },
      {
        ref: "recording://runs/run-1",
        digest: EVIDENCE_DIGEST,
      },
    ];
    const first = buildSkillCandidateDraft(
      draftInput({ sourceEvidenceRefs: evidence }),
    );
    const second = buildSkillCandidateDraft(
      draftInput({
        sourceEvidenceRefs: [...evidence].reverse(),
        targetRuntimes: ["cli", "desktop"],
        requestedCapabilities: ["workspace.read", "workspace.write"],
      }),
    );

    expect(first.schema).toBe(SKILL_CANDIDATE_SCHEMA);
    expect(first.status).toBe("draft");
    expect(first.candidateId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.contentDigest).toBe(
      `sha256:${crypto
        .createHash("sha256")
        .update(first.content, "utf8")
        .digest("hex")}`,
    );
    expect(first.targetRuntimes).toEqual(["cli", "desktop"]);
    expect(first.requestedCapabilities).toEqual([
      "workspace.read",
      "workspace.write",
    ]);
    expect(first.sourceEvidenceRefs.map((entry) => entry.ref)).toEqual([
      "recording://runs/run-1",
      "wiki://patterns/z-last",
    ]);
    expect(second.candidateId).toBe(first.candidateId);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sourceEvidenceRefs)).toBe(true);
    expect(Object.isFrozen(first.sourceEvidenceRefs[0])).toBe(true);
    expect(verifySkillCandidateDraft(first)).toEqual(first);
  });

  it("rejects extra fields, unsafe names, unbound evidence, and evaluated drafts", () => {
    expect(
      capturedError(() =>
        buildSkillCandidateDraft({ ...draftInput(), unexpected: true }),
      ).code,
    ).toBe("SKILL_CANDIDATE_INVALID");
    expect(
      capturedError(() =>
        buildSkillCandidateDraft(draftInput({ skillName: "../active" })),
      ).code,
    ).toBe("SKILL_CANDIDATE_INVALID");
    expect(
      capturedError(() =>
        buildSkillCandidateDraft(
          draftInput({
            sourceEvidenceRefs: [
              { ref: "../../secret", digest: EVIDENCE_DIGEST },
            ],
          }),
        ),
      ).code,
    ).toBe("SKILL_CANDIDATE_INVALID");
    expect(
      capturedError(() =>
        buildSkillCandidateDraft(draftInput({ evalRunId: "eval-1" })),
      ).code,
    ).toBe("SKILL_CANDIDATE_INVALID");
  });

  it("enforces derivation-specific provenance before writing a draft", () => {
    expect(
      capturedError(() =>
        buildSkillCandidateDraft(draftInput({ sourceEvidenceRefs: [] })),
      ).code,
    ).toBe("SKILL_CANDIDATE_INVALID");
    expect(
      capturedError(() =>
        buildSkillCandidateDraft(
          draftInput({ derivationMode: "wiki", wikiRevision: null }),
        ),
      ).code,
    ).toBe("SKILL_CANDIDATE_INVALID");
    expect(
      capturedError(() =>
        buildSkillCandidateDraft(
          draftInput({
            derivationMode: "wiki",
            wikiRevision: "wiki://repository/revision-42",
            proposerModel: null,
          }),
        ),
      ).code,
    ).toBe("SKILL_CANDIDATE_INVALID");

    const wikiDraft = buildSkillCandidateDraft(
      draftInput({
        derivationMode: "wiki",
        wikiRevision: "wiki://repository/revision-42",
        proposerModel: {
          provider: "google",
          model: "gemini-3.5-flash",
          version: "2026-08-27",
        },
      }),
    );
    expect(wikiDraft.wikiRevision).toBe("wiki://repository/revision-42");
    expect(wikiDraft.proposerModel).toEqual({
      provider: "google",
      model: "gemini-3.5-flash",
      version: "2026-08-27",
    });

    for (const derivationMode of ["record-replay", "manual-import"]) {
      expect(
        capturedError(() =>
          buildSkillCandidateDraft(
            draftInput({
              derivationMode,
              wikiRevision: "wiki://repository/revision-42",
            }),
          ),
        ).code,
      ).toBe("SKILL_CANDIDATE_INVALID");
    }
  });

  it("publishes once, reads by digest, lists drafts, and never overwrites", () => {
    const registry = new SkillCandidateRegistry({
      rootDir: registryRoot,
      secure: false,
    });
    const first = registry.create(draftInput());
    const filePath = artifactPath(registry.rootDir, first.candidate.candidateId);
    const before = fs.statSync(filePath);
    const beforeBytes = fs.readFileSync(filePath);

    const duplicate = registry.create(draftInput());
    const after = fs.statSync(filePath);

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.candidate).toEqual(first.candidate);
    expect(after.ino).toBe(before.ino);
    expect(fs.readFileSync(filePath)).toEqual(beforeBytes);
    expect(registry.read(first.candidate.candidateId)).toEqual(first.candidate);
    expect(registry.list()).toEqual([first.candidate]);
    expect(
      fs
        .readdirSync(registry.rootDir)
        .filter((name) => name.endsWith(".json")),
    ).toHaveLength(1);
  });

  it("requires ACL enforcement for an existing secure registry and artifact", () => {
    fs.mkdirSync(registryRoot, { recursive: true });
    const registry = new SkillCandidateRegistry({ rootDir: registryRoot });

    const result = registry.create(draftInput());

    expect(secureFsMocks.ensurePrivateDirectory).toHaveBeenCalledWith(
      path.resolve(registryRoot),
      {
        applyWindowsAcl: true,
        failIfUnavailable: true,
      },
    );
    expect(secureFsMocks.ensurePrivateFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.candidate-.*\.tmp$/u),
      {
        applyWindowsAcl: true,
        failIfUnavailable: true,
      },
    );
    expect(registry.read(result.candidate.candidateId)).toEqual(
      result.candidate,
    );
  });

  it("handles a competing identical publisher through exclusive hard-link CAS", () => {
    const fsImpl = Object.create(fs);
    let intercepted = false;
    fsImpl.linkSync = (source, destination) => {
      if (!intercepted) {
        intercepted = true;
        fs.linkSync(source, destination);
        const error = new Error("simulated concurrent winner");
        error.code = "EEXIST";
        throw error;
      }
      return fs.linkSync(source, destination);
    };
    const registry = new SkillCandidateRegistry({
      rootDir: registryRoot,
      secure: false,
      fsImpl,
    });

    const result = registry.create(draftInput());

    expect(intercepted).toBe(true);
    expect(result.created).toBe(false);
    expect(registry.read(result.candidate.candidateId)).toEqual(
      result.candidate,
    );
    expect(
      fs.readdirSync(registry.rootDir).some((name) => name.endsWith(".tmp")),
    ).toBe(false);
  });

  it("removes a partial temporary write and never exposes it as a candidate", () => {
    const fsImpl = Object.create(fs);
    fsImpl.writeFileSync = (descriptor, bytes) => {
      fs.writeSync(descriptor, bytes.subarray(0, 17));
      const error = new Error("simulated disk failure");
      error.code = "EIO";
      throw error;
    };
    const registry = new SkillCandidateRegistry({
      rootDir: registryRoot,
      secure: false,
      fsImpl,
    });

    const error = capturedError(() => registry.create(draftInput()));

    expect(error).toMatchObject({
      code: "SKILL_CANDIDATE_WRITE_FAILED",
      commitState: "not-committed",
    });
    expect(fs.readdirSync(registry.rootDir)).toEqual([]);
    expect(registry.list()).toEqual([]);
  });

  it("ignores crash-left temporary files while failing closed on artifact tampering", () => {
    const registry = new SkillCandidateRegistry({
      rootDir: registryRoot,
      secure: false,
    });
    fs.writeFileSync(
      path.join(registry.rootDir, ".candidate-crash.tmp"),
      '{"partial":',
      "utf8",
    );
    expect(registry.list()).toEqual([]);

    const { candidate } = registry.create(draftInput());
    const filePath = artifactPath(registry.rootDir, candidate.candidateId);
    const bytes = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(filePath, bytes.replace("focused", "altered"), "utf8");

    expect(capturedError(() => registry.read(candidate.candidateId)).code).toBe(
      "SKILL_CANDIDATE_CORRUPT",
    );
  });

  it("rejects traversal identifiers and symlinked artifact paths", () => {
    const registry = new SkillCandidateRegistry({
      rootDir: registryRoot,
      secure: false,
    });
    expect(capturedError(() => registry.read("../../active")).code).toBe(
      "SKILL_CANDIDATE_INVALID",
    );

    const { candidate } = registry.create(draftInput());
    const filePath = artifactPath(registry.rootDir, candidate.candidateId);
    fs.unlinkSync(filePath);
    const targetDirectory = path.join(tempRoot, "symlink-target");
    fs.mkdirSync(targetDirectory);
    try {
      fs.symlinkSync(
        targetDirectory,
        filePath,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (["EACCES", "EPERM"].includes(error?.code)) return;
      throw error;
    }

    expect(capturedError(() => registry.read(candidate.candidateId)).code).toBe(
      "SKILL_CANDIDATE_CORRUPT",
    );
  });

  it("rejects a symlinked registry root before any candidate write", () => {
    const realRoot = path.join(tempRoot, "real-root");
    const linkedRoot = path.join(tempRoot, "linked-root");
    fs.mkdirSync(realRoot);
    try {
      fs.symlinkSync(
        realRoot,
        linkedRoot,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (["EACCES", "EPERM"].includes(error?.code)) return;
      throw error;
    }

    expect(
      capturedError(
        () =>
          new SkillCandidateRegistry({
            rootDir: linkedRoot,
            secure: false,
          }),
      ).code,
    ).toBe("SKILL_CANDIDATE_STORE_UNSAFE");
    expect(fs.readdirSync(realRoot)).toEqual([]);
  });
});
