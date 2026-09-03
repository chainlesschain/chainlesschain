import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createSkillVectorProcessAuthority } from "../../src/lib/skill-vector-process-authority.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, "../fixtures");
const PROVIDER = path.join(FIXTURES, "skill-vector-provider-worker.mjs");
const VERIFIER = path.join(FIXTURES, "skill-vector-verifier-worker.mjs");
const D = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const fileDigest = (filePath) => D(fs.readFileSync(filePath));

function worker(identity, entryPath, overrides = {}) {
  const executablePath = fs.realpathSync.native(process.execPath);
  const environment =
    process.platform === "win32"
      ? {
          SystemRoot: process.env.SystemRoot,
          TEMP: os.tmpdir(),
          TMP: os.tmpdir(),
          WINDIR: process.env.WINDIR,
        }
      : {};
  return {
    identity,
    executablePath,
    executableDigest: fileDigest(executablePath),
    entryPath,
    entryDigest: fileDigest(entryPath),
    arguments: [],
    cwd: FIXTURES,
    environment,
    ...overrides,
  };
}

function authority(overrides = {}) {
  return createSkillVectorProcessAuthority({
    tenantId: "tenant:a",
    provider: worker("provider:fixture", PROVIDER),
    verifier: worker("verifier:fixture", VERIFIER),
    ...overrides,
  });
}

function skill(id) {
  return {
    id,
    displayName: id,
    description: `${id} description`,
    category: "engineering",
    tags: ["testing"],
    executionIdentity: { contentDigest: D(id) },
  };
}

describe("Skill vector process authority", () => {
  it("routes through independently pinned provider and verifier processes", async () => {
    process.env.CC_SKILL_VECTOR_PARENT_SECRET = "must-not-leak";
    try {
      await expect(
        authority().score({
          query: "repair tests",
          skills: [skill("repair"), skill("docs")],
        }),
      ).resolves.toMatchObject({
        scores: {
          [D("repair")]: 1,
          [D("docs")]: 0.5,
        },
        evidence: {
          status: "verified",
          tenantId: "tenant:a",
          modelId: "fixture:embedding",
          modelRevision: "fixture:revision:1",
          skillCount: 2,
        },
      });
    } finally {
      delete process.env.CC_SKILL_VECTOR_PARENT_SECRET;
    }
  }, 20_000);

  it("rejects a shared provider/verifier entry and mutable descriptors", () => {
    expect(() =>
      authority({
        verifier: worker("verifier:fixture", PROVIDER),
      }),
    ).toThrow(/must be independent/u);
    expect(() =>
      authority({
        provider: new Proxy(worker("provider:fixture", PROVIDER), {}),
      }),
    ).toThrow(/provider is invalid/u);
  });

  it("fails before launch when a pinned entry digest does not match", () => {
    expect(() =>
      authority({
        provider: worker("provider:fixture", PROVIDER, {
          entryDigest: D("substituted"),
        }),
      }),
    ).toThrow(/entry digest changed/u);
  });

  it("fails closed on timeout, non-JSON and oversized output", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-vector-worker-"));
    const workerPath = path.join(tempDir, "worker.mjs");
    try {
      fs.writeFileSync(workerPath, "setTimeout(() => {}, 60_000);\n", {
        mode: 0o600,
      });
      const timed = authority({
        provider: worker("provider:timeout", workerPath, { cwd: tempDir }),
        timeoutMs: 50,
      });
      await expect(
        timed.score({ query: "repair", skills: [skill("repair")] }),
      ).rejects.toMatchObject({ code: "CC_SKILL_VECTOR_PROCESS_TIMEOUT" });

      fs.writeFileSync(workerPath, 'process.stdout.write("not-json");\n', {
        mode: 0o600,
      });
      const malformed = authority({
        provider: worker("provider:malformed", workerPath, { cwd: tempDir }),
      });
      await expect(
        malformed.score({ query: "repair", skills: [skill("repair")] }),
      ).rejects.toMatchObject({
        code: "CC_SKILL_VECTOR_PROCESS_INVALID_JSON",
      });

      fs.writeFileSync(
        workerPath,
        'process.stdout.write("x".repeat(1024));\n',
        { mode: 0o600 },
      );
      const oversized = authority({
        provider: worker("provider:oversized", workerPath, { cwd: tempDir }),
        maxOutputBytes: 32,
      });
      await expect(
        oversized.score({ query: "repair", skills: [skill("repair")] }),
      ).rejects.toMatchObject({
        code: "CC_SKILL_VECTOR_PROCESS_OUTPUT_LIMIT",
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15_000);
});
