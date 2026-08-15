import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PLUGIN_MARKETPLACE_ARTIFACT_READBACK_SCHEMA,
  PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
  buildMarketplacePayloadSbom,
  buildPluginMarketplaceArtifactReadback,
} from "../../src/lib/plugin-runtime/marketplace-artifact-readback.js";
import {
  installFromSource,
  listInstalled,
} from "../../src/lib/plugin-runtime/install.js";

let cwd;
let fixtureRoot;
let source;
let signatureFile;
let publicKeyFile;
let manifestSha256;
let publicKeySha256;
let payloadSbom;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sourceMetadata() {
  return {
    type: "registry",
    source: "https://registry.example/index.json",
    registry: "https://registry.example/index.json",
    package: "artifact-plugin",
    resolvedSource: source,
    catalogAuthority: {
      catalogDigest: "a".repeat(64),
      candidateId: `candidate-${"b".repeat(20)}`,
      candidateDigest: "c".repeat(64),
      governanceStatus: "complete",
      registryStatus: "online",
      versionAuthority: "registry-declared-unverified",
      artifactExpectations: {
        manifest: { status: "declared", sha256: manifestSha256 },
        signature: {
          status: "declared",
          algorithm: "ed25519",
          publicKeySha256,
        },
        sbom: {
          status: "declared",
          format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
          sha256: payloadSbom.digest,
        },
        license: { status: "declared", expression: "Apache-2.0" },
      },
    },
  };
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-artifact-cwd-"));
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-artifact-src-"));
  source = path.join(fixtureRoot, "plugin");
  fs.mkdirSync(source);
  const manifestFile = path.join(source, "plugin.json");
  fs.writeFileSync(
    manifestFile,
    JSON.stringify({
      name: "artifact-plugin",
      version: "1.0.0",
      license: "Apache-2.0",
    }),
    "utf8",
  );
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const manifestBytes = fs.readFileSync(manifestFile);
  const signature = crypto.sign(null, manifestBytes, privateKey);
  signatureFile = path.join(fixtureRoot, "manifest.sig");
  publicKeyFile = path.join(fixtureRoot, "publisher.pem");
  fs.writeFileSync(signatureFile, signature);
  fs.writeFileSync(
    publicKeyFile,
    publicKey.export({ type: "spki", format: "pem" }),
  );
  manifestSha256 = sha256(manifestBytes);
  publicKeySha256 = sha256(publicKey.export({ type: "spki", format: "der" }));
  payloadSbom = buildMarketplacePayloadSbom(source);
});

afterEach(() => {
  for (const dir of [cwd, fixtureRoot]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("marketplace artifact readback", () => {
  it("matches exact installed bytes, license, signing key, and payload SBOM", () => {
    installFromSource(source, {
      scope: "project",
      cwd,
      expectedIdentity: { name: "artifact-plugin", version: "1.0.0" },
      sourceMetadata: sourceMetadata(),
      signature: {
        sha256: manifestSha256,
        signatureFile,
        publicKeyFile,
        requireSignature: true,
      },
    });
    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    const first = buildPluginMarketplaceArtifactReadback({
      root: installed.dir,
      scope: installed.scope,
      source: installed.source,
      observedAt: "2026-08-15T00:00:00.000Z",
    });
    const second = buildPluginMarketplaceArtifactReadback({
      root: installed.dir,
      scope: installed.scope,
      source: installed.source,
      observedAt: "2026-08-16T00:00:00.000Z",
    });

    expect(first).toMatchObject({
      schemaVersion: PLUGIN_MARKETPLACE_ARTIFACT_READBACK_SCHEMA,
      status: "matched",
      comparisons: {
        manifest: { status: "matched", comparable: true },
        license: { status: "matched", comparable: true },
        signature: { status: "matched", comparable: true },
        sbom: { status: "matched", comparable: true },
      },
      claims: {
        registryPublisherIdentityVerified: false,
        remoteSignatureFetched: false,
        remoteSbomFetched: false,
        signatureCryptographicallyReverified: true,
      },
    });
    expect(first.actual.signatureBoundComponentSbom).toMatchObject({
      present: true,
      verified: true,
    });
    expect(first.actual.payloadSbom.files.map((file) => file.path)).toEqual([
      "plugin.json",
    ]);
    expect(first.evidenceDigest).toBe(second.evidenceDigest);
  });

  it("fails closed on manifest, license, signature, and payload drift", () => {
    installFromSource(source, {
      scope: "project",
      cwd,
      sourceMetadata: sourceMetadata(),
      signature: {
        sha256: manifestSha256,
        signatureFile,
        publicKeyFile,
        requireSignature: true,
      },
    });
    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    fs.writeFileSync(
      path.join(installed.dir, "plugin.json"),
      JSON.stringify({
        name: "artifact-plugin",
        version: "1.0.0",
        license: "MIT",
      }),
      "utf8",
    );

    const evidence = buildPluginMarketplaceArtifactReadback({
      root: installed.dir,
      scope: installed.scope,
      source: installed.source,
    });
    expect(evidence.status).toBe("failed");
    expect(evidence.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        "MANIFEST_DIGEST_MISMATCH",
        "LICENSE_MISMATCH",
        "SIGNATURE_NOT_VERIFIED",
        "PAYLOAD_SBOM_DIGEST_MISMATCH",
      ]),
    );
  });

  it("marks external SBOM assertions partial instead of claiming a comparison", () => {
    installFromSource(source, {
      scope: "project",
      cwd,
      sourceMetadata: {
        ...sourceMetadata(),
        catalogAuthority: {
          ...sourceMetadata().catalogAuthority,
          artifactExpectations: {
            ...sourceMetadata().catalogAuthority.artifactExpectations,
            signature: { status: "missing" },
            sbom: {
              status: "declared",
              format: "cyclonedx-json",
              sha256: "d".repeat(64),
            },
          },
        },
      },
      signature: { sha256: manifestSha256 },
    });
    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    const evidence = buildPluginMarketplaceArtifactReadback({
      root: installed.dir,
      scope: installed.scope,
      source: installed.source,
    });

    expect(evidence.status).toBe("partial");
    expect(evidence.comparisons.sbom).toMatchObject({
      status: "not-comparable",
      comparable: false,
    });
    expect(evidence.claims.externalSbomDigestComparable).toBe(false);
  });
});
