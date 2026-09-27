import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { create as createTarball } from "tar";
import {
  createReleaseArtifactManifest,
  inspectNpmPackageWebPanel,
  verifyReleaseArtifact,
} from "../../scripts/npm-release-artifact.mjs";
import {
  ARTIFACT_COMMIT,
  artifactFixture,
} from "./linux-subreaper-artifact-fixture.js";

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

function makePackageTarball(
  dir,
  {
    packageName = "chainlesschain",
    packageVersion = "1.2.3",
    changelogVersion = packageVersion,
    mutateSubreaper = () => {},
    index = `<!doctype html>
      <script type="module" src="./assets/index-abc123.js"></script>
      <link rel="stylesheet" href="./assets/index-def456.css">`,
    assets = {
      "index-abc123.js": "console.log('web panel');",
      "index-def456.css": "body { color: #123; }",
    },
  } = {},
) {
  const webPanel = path.join(dir, "package", "src", "assets", "web-panel");
  const assetDir = path.join(webPanel, "assets");
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package", "package.json"),
    `${JSON.stringify({ name: packageName, version: packageVersion })}\n`,
  );
  const changelog = path.join(dir, "package", "src", "data");
  fs.mkdirSync(changelog, { recursive: true });
  fs.writeFileSync(
    path.join(changelog, "changelog.json"),
    `${JSON.stringify({ releases: [{ cliVersion: changelogVersion }] })}\n`,
  );
  fs.writeFileSync(path.join(webPanel, "index.html"), index);
  for (const [name, contents] of Object.entries(assets)) {
    fs.writeFileSync(path.join(assetDir, name), contents);
  }
  const nativeRoot = path.join(dir, "package/src/assets/linux-subreaper");
  for (const arch of ["x64", "arm64"]) {
    const nativeDir = path.join(nativeRoot, `linux-${arch}`);
    fs.mkdirSync(nativeDir, { recursive: true });
    const { image, manifest } = artifactFixture(arch);
    fs.writeFileSync(path.join(nativeDir, "supervisor"), image);
    fs.writeFileSync(
      path.join(nativeDir, "manifest.json"),
      JSON.stringify(manifest),
    );
  }
  const sourceDir = path.join(dir, "package/src/lib/process-execution-broker");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.copyFileSync(
    new URL(
      "../../src/lib/process-execution-broker/linux-subreaper-supervisor.c",
      import.meta.url,
    ),
    path.join(sourceDir, "linux-subreaper-supervisor.c"),
  );
  mutateSubreaper(nativeRoot, sourceDir);
  const tarball = path.join(dir, "chainlesschain-1.2.3.tgz");
  createTarball(
    { cwd: dir, file: tarball, gzip: true, portable: true, sync: true },
    ["package"],
  );
  return tarball;
}

function bindManifestToTarball(manifest, tarball) {
  const rebound = structuredClone(manifest);
  const contents = fs.readFileSync(tarball);
  rebound.artifact = path.basename(tarball);
  rebound.bytes = contents.length;
  rebound.sha256 = crypto.createHash("sha256").update(contents).digest("hex");
  rebound.sha512 = crypto.createHash("sha512").update(contents).digest("hex");
  return rebound;
}

describe("immutable npm release artifact", () => {
  it.each(["missing-arm64", "corrupt-image", "old-commit", "changed-source"])(
    "rejects %s inside a freshly hashed tarball",
    async (kind) => {
      const validDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-release-artifact-"),
      );
      const invalidDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-release-artifact-"),
      );
      dirs.push(validDir, invalidDir);
      const valid = makePackageTarball(validDir);
      const manifest = await createReleaseArtifactManifest({
        tarball: valid,
        version: "1.2.3",
        commit: ARTIFACT_COMMIT,
      });
      const invalid = makePackageTarball(invalidDir, {
        mutateSubreaper(root, sourceDir) {
          if (kind === "missing-arm64")
            fs.unlinkSync(path.join(root, "linux-arm64/supervisor"));
          if (kind === "corrupt-image")
            fs.appendFileSync(
              path.join(root, "linux-x64/supervisor"),
              "tamper",
            );
          if (kind === "changed-source")
            fs.appendFileSync(
              path.join(sourceDir, "linux-subreaper-supervisor.c"),
              "tamper",
            );
          if (kind === "old-commit") {
            const file = path.join(root, "linux-arm64/manifest.json");
            const identity = JSON.parse(fs.readFileSync(file));
            identity.commit = "a".repeat(40);
            fs.writeFileSync(file, JSON.stringify(identity));
          }
        },
      });
      await expect(
        createReleaseArtifactManifest({
          tarball: invalid,
          version: "1.2.3",
          commit: ARTIFACT_COMMIT,
        }),
      ).rejects.toThrow();
      await expect(
        verifyReleaseArtifact(
          invalid,
          bindManifestToTarball(manifest, invalid),
        ),
      ).rejects.toThrow();
    },
  );
  it("records and verifies the exact tarball bytes and Web Panel assets", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-release-artifact-"));
    dirs.push(dir);
    const tarball = makePackageTarball(dir);
    const manifest = await createReleaseArtifactManifest({
      tarball,
      version: "1.2.3",
      commit: ARTIFACT_COMMIT,
    });
    expect(manifest).toMatchObject({
      package: "chainlesschain",
      version: "1.2.3",
      commit: ARTIFACT_COMMIT,
      artifact: "chainlesschain-1.2.3.tgz",
      provenance: "npm --provenance",
      schema: 2,
    });
    expect(manifest.webPanel.assets.map((asset) => asset.path)).toEqual([
      "package/src/assets/web-panel/assets/index-abc123.js",
      "package/src/assets/web-panel/assets/index-def456.css",
    ]);
    expect(manifest.releaseIdentity).toMatchObject({
      packageJson: {
        path: "package/package.json",
        name: "chainlesschain",
        version: "1.2.3",
      },
      changelog: {
        path: "package/src/data/changelog.json",
        cliVersion: "1.2.3",
      },
    });
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.linuxSubreapers.map((value) => value.arch)).toEqual([
      "x64",
      "arm64",
    ]);
    await expect(verifyReleaseArtifact(tarball, manifest)).resolves.toBe(true);
  });

  it("rejects any post-verification tarball mutation", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-release-artifact-"));
    dirs.push(dir);
    const tarball = makePackageTarball(dir);
    const manifest = await createReleaseArtifactManifest({
      tarball,
      version: "1.2.3",
      commit: ARTIFACT_COMMIT,
    });
    fs.appendFileSync(tarball, "tampered");
    await expect(verifyReleaseArtifact(tarball, manifest)).rejects.toThrow(
      /byte length, sha256, sha512/,
    );
  });

  it("rejects a manifest from another commit or version", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-release-artifact-"));
    dirs.push(dir);
    const tarball = makePackageTarball(dir);
    const manifest = await createReleaseArtifactManifest({
      tarball,
      version: "1.2.3",
      commit: ARTIFACT_COMMIT,
    });
    await expect(
      verifyReleaseArtifact(tarball, manifest, {
        version: "1.2.4",
        commit: "release-sha",
      }),
    ).rejects.toThrow(/version, commit/);
  });

  it("rejects an index that references a missing packaged asset", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-release-artifact-"));
    dirs.push(dir);
    const tarball = makePackageTarball(dir, {
      index: `<script type="module" src="./assets/missing.js"></script>
        <link rel="stylesheet" href="./assets/index.css">`,
      assets: {
        "index.css": "body { color: red; }",
        "unreferenced.js": "unused",
      },
    });
    await expect(inspectNpmPackageWebPanel(tarball)).rejects.toThrow(
      /asset is missing.*missing\.js/,
    );
    await expect(
      createReleaseArtifactManifest({
        tarball,
        version: "1.2.3",
        commit: ARTIFACT_COMMIT,
      }),
    ).rejects.toThrow(/asset is missing.*missing\.js/);
  });

  it("rejects an index without a local CSS stylesheet bundle", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-release-artifact-"));
    dirs.push(dir);
    const tarball = makePackageTarball(dir, {
      index: '<script type="module" src="./assets/index.js"></script>',
      assets: {
        "index.js": "console.log('web panel');",
        "unreferenced.css": "body { color: red; }",
      },
    });
    await expect(inspectNpmPackageWebPanel(tarball)).rejects.toThrow(
      /no local CSS stylesheet bundle/,
    );
  });

  it.each([
    ["name", { packageName: "not-chainlesschain" }, /name mismatch/],
    ["version", { packageVersion: "9.9.9" }, /version mismatch/],
    [
      "changelog version",
      { changelogVersion: "1.2.2" },
      /changelog\.json version mismatch/,
    ],
  ])(
    "rejects a packaged %s mismatch during create and verify",
    async (_field, options, expectedError) => {
      const validDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-release-artifact-"),
      );
      const invalidDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-release-artifact-"),
      );
      dirs.push(validDir, invalidDir);
      const validTarball = makePackageTarball(validDir);
      const invalidTarball = makePackageTarball(invalidDir, options);
      const validManifest = await createReleaseArtifactManifest({
        tarball: validTarball,
        version: "1.2.3",
        commit: ARTIFACT_COMMIT,
      });
      await expect(
        createReleaseArtifactManifest({
          tarball: invalidTarball,
          version: "1.2.3",
          commit: ARTIFACT_COMMIT,
        }),
      ).rejects.toThrow(expectedError);
      await expect(
        verifyReleaseArtifact(
          invalidTarball,
          bindManifestToTarball(validManifest, invalidTarball),
        ),
      ).rejects.toThrow(expectedError);
    },
  );

  it("rejects forged release identity and Web Panel attestations", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-release-artifact-"));
    dirs.push(dir);
    const tarball = makePackageTarball(dir);
    const manifest = await createReleaseArtifactManifest({
      tarball,
      version: "1.2.3",
      commit: ARTIFACT_COMMIT,
    });
    const forgedIdentity = structuredClone(manifest);
    forgedIdentity.releaseIdentity.packageJson.version = "9.9.9";
    await expect(
      verifyReleaseArtifact(tarball, forgedIdentity),
    ).rejects.toThrow(/release identity attestation/);

    const forgedWebPanel = structuredClone(manifest);
    forgedWebPanel.webPanel.assets[0].bytes += 1;
    await expect(
      verifyReleaseArtifact(tarball, forgedWebPanel),
    ).rejects.toThrow(/web panel attestation/);
    const forgedNative = structuredClone(manifest);
    forgedNative.linuxSubreapers[0].imageDigest = "sha256:" + "a".repeat(64);
    await expect(verifyReleaseArtifact(tarball, forgedNative)).rejects.toThrow(
      /Linux subreaper attestation/,
    );
  });
});
