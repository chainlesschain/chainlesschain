import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { finalizeNativeArtifact } from "../../scripts/finalize-native-artifact.mjs";
import { createNativeReleaseManifest } from "../../scripts/create-native-release-manifest.mjs";

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("native CLI release manifest", () => {
  it("finalizes signed artifacts and emits deterministic update entries", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-native-release-"));
    dirs.push(dir);
    for (const target of ["node20-linux-x64", "node20-win-x64"]) {
      const artifact = path.join(
        dir,
        `chainlesschain-${target}${target.includes("win") ? ".exe" : ""}`,
      );
      fs.writeFileSync(artifact, `binary-${target}`);
      fs.writeFileSync(
        `${artifact}.pack-manifest.json`,
        JSON.stringify({
          schema: 1,
          cliVersion: "1.2.3",
          gitCommit: "abc123",
          gitDirty: false,
          targets: [target],
        }),
      );
      const bundle = `${artifact}.sigstore.json`;
      fs.writeFileSync(bundle, "signature");
      finalizeNativeArtifact({ artifact, target, signatureBundle: bundle });
    }
    const manifest = createNativeReleaseManifest({
      artifactsDir: dir,
      baseUrl: "https://example.test/releases/v1",
      publishedAt: "2026-08-01T00:00:00Z",
      expectedCommit: "abc123",
      requiredTargets: ["node20-linux-x64", "node20-win-x64"],
    });
    expect(manifest.latest).toMatchObject({
      cliVersion: "1.2.3",
      commit: "abc123",
    });
    expect(manifest.latest.artifacts).toHaveLength(2);
    expect(manifest.latest.artifacts[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.latest.artifacts[0].signature).toMatch(/sigstore\.json$/);
    expect(manifest.minimumUpdaterSchema).toBe(1);
  });

  it("rejects dirty or unsigned artifact metadata", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-native-release-"));
    dirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "bad.pack-manifest.json"),
      JSON.stringify({
        cliVersion: "1.2.3",
        gitCommit: "abc",
        gitDirty: true,
        signed: false,
      }),
    );
    expect(() =>
      createNativeReleaseManifest({
        artifactsDir: dir,
        baseUrl: "https://example.test/release",
      }),
    ).toThrow(/clean and signed/);
  });

  it("recomputes artifact bytes and rejects sidecar tampering", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-native-release-"));
    dirs.push(dir);
    const target = "node20-linux-x64";
    const artifact = path.join(dir, `chainlesschain-${target}`);
    fs.writeFileSync(artifact, "original");
    fs.writeFileSync(
      `${artifact}.pack-manifest.json`,
      JSON.stringify({
        schema: 1,
        cliVersion: "1.2.3",
        gitCommit: "abc123",
        gitDirty: false,
        targets: [target],
      }),
    );
    const bundle = `${artifact}.sigstore.json`;
    fs.writeFileSync(bundle, "signature");
    finalizeNativeArtifact({ artifact, target, signatureBundle: bundle });
    fs.appendFileSync(artifact, "tampered");

    expect(() =>
      createNativeReleaseManifest({
        artifactsDir: dir,
        baseUrl: "https://example.test/releases/v1",
      }),
    ).toThrow(/digest metadata mismatch/);
  });
});
