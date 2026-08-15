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
let publicKeyPem;
let publicKeyDocumentSha256;
let signatureBytes;
let signatureSha256;
let remoteSbomDocumentSha256;
let payloadSbom;

const REGISTRY_ORIGIN = "https://registry.example";
const SIGNATURE_URL = `${REGISTRY_ORIGIN}/artifacts/manifest.sig`;
const PUBLIC_KEY_URL = `${REGISTRY_ORIGIN}/artifacts/publisher.pem`;
const SBOM_URL = `${REGISTRY_ORIGIN}/artifacts/plugin.sbom.json`;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function remoteArtifactEvidence(mutate = null) {
  const authority = {
    schemaVersion: "cc-plugin-marketplace-remote-artifact-evidence/v1",
    status: "verified",
    registryOrigin: REGISTRY_ORIGIN,
    signature: {
      status: "fetched",
      url: SIGNATURE_URL,
      signatureSha256,
      bytes: signatureBytes.length,
      fromCache: false,
      publicKey: {
        url: PUBLIC_KEY_URL,
        documentSha256: publicKeyDocumentSha256,
        spkiSha256: publicKeySha256,
        bytes: Buffer.byteLength(publicKeyPem),
        fromCache: false,
      },
    },
    sbom: {
      status: "digest-verified",
      url: SBOM_URL,
      format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
      expectedDocumentSha256: remoteSbomDocumentSha256,
      documentSha256: remoteSbomDocumentSha256,
      bytes: 31,
      fromCache: false,
    },
    claims: {
      publisherIdentityVerified: false,
      signatureBytesFetched: true,
      publicKeyFingerprintVerified: true,
      manifestSignatureVerified: false,
      sbomDocumentDigestVerified: true,
      sbomPayloadCompared: false,
    },
  };
  mutate?.(authority);
  return {
    ...authority,
    evidenceDigest: sha256(canonicalJson(authority)),
  };
}

function sourceMetadata({ remoteExpectations = false, evidence = false } = {}) {
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
          ...(remoteExpectations
            ? {
                url: SIGNATURE_URL,
                publicKeyUrl: PUBLIC_KEY_URL,
                documentSha256: signatureSha256,
                publicKeyDocumentSha256,
              }
            : {}),
        },
        sbom: {
          status: "declared",
          format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
          sha256: payloadSbom.digest,
          ...(remoteExpectations
            ? {
                url: SBOM_URL,
                documentSha256: remoteSbomDocumentSha256,
              }
            : {}),
        },
        license: { status: "declared", expression: "Apache-2.0" },
      },
      ...(evidence ? { remoteArtifactEvidence: remoteArtifactEvidence() } : {}),
    },
  };
}

function installSigned(metadata = sourceMetadata()) {
  installFromSource(source, {
    scope: "project",
    cwd,
    expectedIdentity: { name: "artifact-plugin", version: "1.0.0" },
    sourceMetadata: metadata,
    signature: {
      sha256: manifestSha256,
      signatureFile,
      publicKeyFile,
      requireSignature: true,
    },
  });
  return listInstalled({ cwd, scopes: ["project"] })[0];
}

function sourceWithEvidence(installedSource, evidence) {
  return {
    ...installedSource,
    catalogAuthority: {
      ...installedSource.catalogAuthority,
      remoteArtifactEvidence: evidence,
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
  signatureBytes = crypto.sign(null, manifestBytes, privateKey);
  signatureFile = path.join(fixtureRoot, "manifest.sig");
  publicKeyFile = path.join(fixtureRoot, "publisher.pem");
  publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  fs.writeFileSync(signatureFile, signatureBytes);
  fs.writeFileSync(publicKeyFile, publicKeyPem);
  manifestSha256 = sha256(manifestBytes);
  publicKeySha256 = sha256(publicKey.export({ type: "spki", format: "der" }));
  publicKeyDocumentSha256 = sha256(Buffer.from(publicKeyPem));
  signatureSha256 = sha256(signatureBytes);
  remoteSbomDocumentSha256 = sha256(Buffer.from('{"bomFormat":"CycloneDX"}\n'));
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
        remoteArtifactEvidenceSelfConsistent: false,
        remoteSbomDigestVerifiedAtInstallRecorded: false,
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

  it("binds self-consistent install-time remote evidence to the installed lock and catalog", () => {
    const installed = installSigned(
      sourceMetadata({ remoteExpectations: true, evidence: true }),
    );

    const result = buildPluginMarketplaceArtifactReadback({
      root: installed.dir,
      scope: installed.scope,
      source: installed.source,
    });

    expect(result).toMatchObject({
      status: "matched",
      comparisons: {
        remoteSignature: { status: "matched", comparable: true },
        remoteSbom: { status: "matched", comparable: true },
      },
      actual: {
        remoteArtifacts: {
          registryOrigin: REGISTRY_ORIGIN,
          expectedRegistryOrigin: REGISTRY_ORIGIN,
          registryOriginMatches: true,
          signature: {
            publicKeyDocumentMatches: true,
            installedPublicKeyDocumentSha256: publicKeyDocumentSha256,
            boundToInstalledLock: true,
          },
          sbom: {
            digestVerifiedAtInstallRecorded: true,
            currentDocumentBytesAvailable: false,
            currentDocumentRehashed: false,
          },
        },
      },
      claims: {
        remoteSignatureFetched: true,
        remoteSignatureBoundToInstalledLock: true,
        remoteSbomFetched: true,
        remoteArtifactEvidenceSelfConsistent: true,
        remoteSbomDigestVerifiedAtInstallRecorded: true,
      },
    });
    expect(result.claims).not.toHaveProperty(
      "remoteArtifactEvidenceRevalidated",
    );
    expect(result.claims).not.toHaveProperty(
      "externalSbomDocumentDigestVerified",
    );
  });

  it("keeps legacy URL expectations without remote evidence partial and non-blocking", () => {
    const installed = installSigned(
      sourceMetadata({ remoteExpectations: true }),
    );

    const result = buildPluginMarketplaceArtifactReadback({
      root: installed.dir,
      scope: installed.scope,
      source: installed.source,
    });

    expect(result.status).toBe("partial");
    expect(result.blockers).toEqual([]);
    expect(result.comparisons).toMatchObject({
      remoteSignature: { status: "not-observed", comparable: false },
      remoteSbom: { status: "not-observed", comparable: false },
    });
    expect(result.claims).toMatchObject({
      remoteSignatureFetched: false,
      remoteSignatureBoundToInstalledLock: false,
      remoteSbomFetched: false,
      remoteArtifactEvidenceSelfConsistent: false,
      remoteSbomDigestVerifiedAtInstallRecorded: false,
    });
  });

  it("fails closed when present remote evidence is not self-consistent", () => {
    const installed = installSigned(
      sourceMetadata({ remoteExpectations: true, evidence: true }),
    );
    const invalidEvidence = {
      ...installed.source.catalogAuthority.remoteArtifactEvidence,
      evidenceDigest: "0".repeat(64),
    };

    const result = buildPluginMarketplaceArtifactReadback({
      root: installed.dir,
      scope: installed.scope,
      source: sourceWithEvidence(installed.source, invalidEvidence),
    });

    expect(result.status).toBe("failed");
    expect(result.comparisons).toMatchObject({
      remoteSignature: { status: "mismatch", comparable: true },
      remoteSbom: { status: "mismatch", comparable: true },
    });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        "REMOTE_ARTIFACT_EVIDENCE_INVALID",
        "REMOTE_SIGNATURE_EVIDENCE_MISMATCH",
        "REMOTE_SBOM_EVIDENCE_MISMATCH",
      ]),
    );
    expect(result.claims).toMatchObject({
      remoteArtifactEvidenceSelfConsistent: false,
      remoteSignatureBoundToInstalledLock: false,
      remoteSbomDigestVerifiedAtInstallRecorded: false,
    });
  });

  it("rejects self-hashed evidence with a non-HTTP artifact URL", () => {
    const installed = installSigned(
      sourceMetadata({ remoteExpectations: true, evidence: true }),
    );
    const invalidEvidence = remoteArtifactEvidence((authority) => {
      authority.signature.url = "file:///tmp/manifest.sig";
    });

    const result = buildPluginMarketplaceArtifactReadback({
      root: installed.dir,
      scope: installed.scope,
      source: sourceWithEvidence(installed.source, invalidEvidence),
    });

    expect(result.status).toBe("failed");
    expect(result.remoteArtifactEvidence).toMatchObject({
      present: true,
      valid: false,
      authority: null,
    });
    expect(result.comparisons.remoteSignature).toMatchObject({
      status: "mismatch",
      comparable: true,
    });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        "REMOTE_ARTIFACT_EVIDENCE_INVALID",
        "REMOTE_SIGNATURE_EVIDENCE_MISMATCH",
      ]),
    );
  });

  it("cross-checks the raw locked public-key document, not only its SPKI fingerprint", () => {
    const installed = installSigned(
      sourceMetadata({ remoteExpectations: true, evidence: true }),
    );
    const lockPath = path.join(installed.dir, ".plugin-lock.json");
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    lock.publicKeyPem = `${lock.publicKeyPem}\n`;
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), "utf8");

    const result = buildPluginMarketplaceArtifactReadback({
      root: installed.dir,
      scope: installed.scope,
      source: installed.source,
    });

    expect(result.actual.signature.verified).toBe(true);
    expect(result.comparisons.signature.status).toBe("matched");
    expect(result.actual.remoteArtifacts.signature).toMatchObject({
      publicKeyMatches: true,
      publicKeyDocumentMatches: false,
      boundToInstalledLock: false,
    });
    expect(result.comparisons.remoteSignature.status).toBe("mismatch");
    expect(result.blockers).toContainEqual({
      code: "REMOTE_SIGNATURE_EVIDENCE_MISMATCH",
    });
    expect(result.claims.remoteSignatureBoundToInstalledLock).toBe(false);
  });

  it.each([
    {
      label: "registry origin",
      mutate(authority) {
        authority.registryOrigin = "https://mirror.example";
      },
      comparison: "remoteSignature",
      blocker: "REMOTE_ARTIFACT_REGISTRY_ORIGIN_MISMATCH",
      claim: "remoteSignatureBoundToInstalledLock",
    },
    {
      label: "signature URL",
      mutate(authority) {
        authority.signature.url =
          "https://registry.example/artifacts/other.sig";
      },
      comparison: "remoteSignature",
      blocker: "REMOTE_SIGNATURE_EVIDENCE_MISMATCH",
      claim: "remoteSignatureBoundToInstalledLock",
    },
    {
      label: "SBOM URL",
      mutate(authority) {
        authority.sbom.url =
          "https://registry.example/artifacts/other.sbom.json";
      },
      comparison: "remoteSbom",
      blocker: "REMOTE_SBOM_EVIDENCE_MISMATCH",
      claim: "remoteSbomDigestVerifiedAtInstallRecorded",
    },
    {
      label: "SBOM format",
      mutate(authority) {
        authority.sbom.format = "cyclonedx-json";
      },
      comparison: "remoteSbom",
      blocker: "REMOTE_SBOM_EVIDENCE_MISMATCH",
      claim: "remoteSbomDigestVerifiedAtInstallRecorded",
    },
  ])(
    "fails closed when internally consistent evidence changes its $label binding",
    ({ mutate, comparison, blocker, claim }) => {
      const installed = installSigned(
        sourceMetadata({ remoteExpectations: true, evidence: true }),
      );
      const changedEvidence = remoteArtifactEvidence(mutate);

      const result = buildPluginMarketplaceArtifactReadback({
        root: installed.dir,
        scope: installed.scope,
        source: sourceWithEvidence(installed.source, changedEvidence),
      });

      expect(result.status).toBe("failed");
      expect(result.remoteArtifactEvidence.valid).toBe(true);
      expect(result.comparisons[comparison]).toMatchObject({
        status: "mismatch",
        comparable: true,
      });
      expect(result.blockers.map((item) => item.code)).toContain(blocker);
      expect(result.claims.remoteArtifactEvidenceSelfConsistent).toBe(true);
      expect(result.claims[claim]).toBe(false);
    },
  );

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
