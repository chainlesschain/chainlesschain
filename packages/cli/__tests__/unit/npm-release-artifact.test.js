import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createReleaseArtifactManifest,
  verifyReleaseArtifact,
} from "../../scripts/npm-release-artifact.mjs";

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("immutable npm release artifact", () => {
  it("records and verifies the exact tarball bytes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-release-artifact-"));
    dirs.push(dir);
    const tarball = path.join(dir, "chainlesschain-1.2.3.tgz");
    fs.writeFileSync(tarball, "immutable package bytes");
    const manifest = createReleaseArtifactManifest({
      tarball,
      version: "1.2.3",
      commit: "abc123",
    });
    expect(manifest).toMatchObject({
      package: "chainlesschain",
      version: "1.2.3",
      commit: "abc123",
      artifact: "chainlesschain-1.2.3.tgz",
      provenance: "npm --provenance",
    });
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyReleaseArtifact(tarball, manifest)).toBe(true);
  });

  it("rejects any post-verification tarball mutation", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-release-artifact-"));
    dirs.push(dir);
    const tarball = path.join(dir, "chainlesschain-1.2.3.tgz");
    fs.writeFileSync(tarball, "original");
    const manifest = createReleaseArtifactManifest({
      tarball,
      version: "1.2.3",
      commit: "abc123",
    });
    fs.appendFileSync(tarball, "tampered");
    expect(() => verifyReleaseArtifact(tarball, manifest)).toThrow(
      /byte length, sha256, sha512/,
    );
  });

  it("rejects a manifest from another commit or version", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-release-artifact-"));
    dirs.push(dir);
    const tarball = path.join(dir, "chainlesschain-1.2.3.tgz");
    fs.writeFileSync(tarball, "immutable package bytes");
    const manifest = createReleaseArtifactManifest({
      tarball,
      version: "1.2.3",
      commit: "old-sha",
    });
    expect(() =>
      verifyReleaseArtifact(tarball, manifest, {
        version: "1.2.4",
        commit: "release-sha",
      }),
    ).toThrow(/version, commit/);
  });
});
