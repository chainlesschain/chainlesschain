import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PLUGIN_MARKETPLACE_ARTIFACT_READBACK_SCHEMA,
  PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
  PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
  PLUGIN_MARKETPLACE_REMOTE_SBOM_PAYLOAD_COMPARISON_SCHEMA,
  buildMarketplacePayloadSbom,
  buildPluginMarketplaceArtifactReadback,
  parseMarketplacePayloadSbomDocument,
} from "../../src/lib/plugin-runtime/marketplace-artifact-readback.js";
import { buildPluginSbom } from "../../src/lib/plugin-runtime/signature.js";
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
let remoteSbomBytes;
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
      bytes: remoteSbomBytes.length,
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

function canonicalSourceMetadata() {
  payloadSbom = buildMarketplacePayloadSbom(source, {
    schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
  });
  remoteSbomBytes = Buffer.from(JSON.stringify(payloadSbom));
  remoteSbomDocumentSha256 = sha256(remoteSbomBytes);
  const metadata = sourceMetadata({ remoteExpectations: true, evidence: true });
  metadata.catalogAuthority.artifactExpectations.sbom = {
    ...metadata.catalogAuthority.artifactExpectations.sbom,
    format: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
    payloadSha256: payloadSbom.digest,
  };
  const evidenceAuthority = {
    ...metadata.catalogAuthority.remoteArtifactEvidence,
  };
  delete evidenceAuthority.evidenceDigest;
  evidenceAuthority.sbom.format =
    PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA;
  metadata.catalogAuthority.remoteArtifactEvidence = {
    ...evidenceAuthority,
    evidenceDigest: sha256(canonicalJson(evidenceAuthority)),
  };
  return metadata;
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
    remoteSbomBytes: metadata.catalogAuthority.remoteArtifactEvidence?.sbom
      ? remoteSbomBytes
      : null,
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
  payloadSbom = buildMarketplacePayloadSbom(source);
  remoteSbomBytes = Buffer.from(JSON.stringify(payloadSbom));
  remoteSbomDocumentSha256 = sha256(remoteSbomBytes);
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
        remoteSbomPayload: { status: "matched", comparable: true },
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
            payloadComparisonPresent: true,
            payloadComparisonValid: true,
            currentPayloadMatches: true,
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
        remoteSbomPayloadComparisonRecorded: true,
        remoteSbomPayloadComparisonSelfConsistent: true,
        remoteSbomRecordedPayloadMatchesCurrentInstall: true,
      },
    });
    expect(result.remoteSbomPayloadComparison).toMatchObject({
      present: true,
      valid: true,
      currentPayloadMatches: true,
      authority: {
        schemaVersion: PLUGIN_MARKETPLACE_REMOTE_SBOM_PAYLOAD_COMPARISON_SCHEMA,
        status: "matched",
        remotePayload: {
          digest: payloadSbom.digest,
          fileCount: payloadSbom.fileCount,
          totalBytes: payloadSbom.totalBytes,
        },
      },
    });
    expect(result.claims).not.toHaveProperty(
      "remoteArtifactEvidenceRevalidated",
    );
    expect(result.claims).not.toHaveProperty(
      "externalSbomDocumentDigestVerified",
    );
  });

  it.each([".plugin-lock.json", ".git"])(
    "rejects an unsafe semantic-install %s directory instead of excluding it from evidence",
    (entryName) => {
      const installed = installSigned(canonicalSourceMetadata());
      const unsafePath = path.join(installed.dir, entryName);
      fs.rmSync(unsafePath, { recursive: true, force: true });
      fs.mkdirSync(unsafePath);
      fs.writeFileSync(path.join(unsafePath, "hidden.js"), "hidden\n", "utf8");

      expect(() =>
        buildPluginMarketplaceArtifactReadback({
          root: installed.dir,
          scope: installed.scope,
          source: installed.source,
        }),
      ).toThrow(/EXISTING_VERSION_UNSAFE_ENTRY/);
    },
  );

  it("fails complete legacy v1 URL expectations without remote evidence", () => {
    const installed = installSigned(sourceMetadata());

    const result = buildPluginMarketplaceArtifactReadback({
      root: installed.dir,
      scope: installed.scope,
      source: sourceMetadata({ remoteExpectations: true }),
    });

    expect(result.status).toBe("failed");
    expect(result.blockers).toContainEqual({
      code: "REMOTE_SBOM_PAYLOAD_COMPARISON_MISSING",
    });
    expect(result.comparisons).toMatchObject({
      remoteSignature: { status: "not-observed", comparable: false },
      remoteSbom: { status: "not-observed", comparable: false },
      remoteSbomPayload: { status: "mismatch", comparable: true },
    });
    expect(result.claims).toMatchObject({
      remoteSignatureFetched: false,
      remoteSignatureBoundToInstalledLock: false,
      remoteSbomFetched: false,
      remoteArtifactEvidenceSelfConsistent: false,
      remoteSbomDigestVerifiedAtInstallRecorded: false,
    });
  });

  it("fails when evidence and comparison are deleted from a complete v1 binding", () => {
    const installed = installSigned(
      sourceMetadata({ remoteExpectations: true, evidence: true }),
    );
    const strippedSource = structuredClone(installed.source);
    delete strippedSource.catalogAuthority.remoteArtifactEvidence;
    delete strippedSource.catalogAuthority.remoteSbomPayloadComparison;

    const result = buildPluginMarketplaceArtifactReadback({
      root: installed.dir,
      scope: installed.scope,
      source: strippedSource,
    });

    expect(result.status).toBe("failed");
    expect(result.comparisons.remoteSbomPayload).toMatchObject({
      status: "mismatch",
      comparable: true,
    });
    expect(result.blockers).toContainEqual({
      code: "REMOTE_SBOM_PAYLOAD_COMPARISON_MISSING",
    });
  });

  it("fails when a v2 declaration is stripped to an incomplete expectation", () => {
    const installed = installSigned(sourceMetadata());
    const strippedSource = structuredClone(installed.source);
    strippedSource.catalogAuthority.artifactExpectations.sbom = {
      status: "declared",
      format: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
      payloadSha256: payloadSbom.digest,
    };
    delete strippedSource.catalogAuthority.remoteArtifactEvidence;
    delete strippedSource.catalogAuthority.remoteSbomPayloadComparison;

    const result = buildPluginMarketplaceArtifactReadback({
      root: installed.dir,
      scope: installed.scope,
      source: strippedSource,
    });

    expect(result.status).toBe("failed");
    expect(result.comparisons.remoteSbomPayload).toMatchObject({
      status: "mismatch",
      comparable: true,
    });
    expect(result.blockers).toContainEqual({
      code: "REMOTE_SBOM_PAYLOAD_COMPARISON_MISSING",
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

  it("fails closed when the persisted semantic comparison checksum is corrupted", () => {
    const installed = installSigned(
      sourceMetadata({ remoteExpectations: true, evidence: true }),
    );
    const forgedSource = {
      ...installed.source,
      catalogAuthority: {
        ...installed.source.catalogAuthority,
        remoteSbomPayloadComparison: {
          ...installed.source.catalogAuthority.remoteSbomPayloadComparison,
          comparisonDigest: "0".repeat(64),
        },
      },
    };

    const result = buildPluginMarketplaceArtifactReadback({
      root: installed.dir,
      scope: installed.scope,
      source: forgedSource,
    });

    expect(result.status).toBe("failed");
    expect(result.remoteSbomPayloadComparison).toMatchObject({
      present: true,
      valid: false,
      reason: "comparison digest is invalid",
    });
    expect(result.comparisons.remoteSbomPayload).toMatchObject({
      status: "mismatch",
      comparable: true,
    });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        "REMOTE_SBOM_PAYLOAD_COMPARISON_INVALID",
        "REMOTE_SBOM_PAYLOAD_MISMATCH",
      ]),
    );
    expect(result.claims).toMatchObject({
      remoteSbomPayloadComparisonRecorded: false,
      remoteSbomPayloadComparisonSelfConsistent: false,
      remoteSbomRecordedPayloadMatchesCurrentInstall: false,
    });
  });

  it("detects current payload drift even when the catalog omitted a payload digest", () => {
    const metadata = sourceMetadata({
      remoteExpectations: true,
      evidence: true,
    });
    delete metadata.catalogAuthority.artifactExpectations.sbom.sha256;
    const installed = installSigned(metadata);
    fs.writeFileSync(path.join(installed.dir, "drift.js"), "drift\n", "utf8");

    const result = buildPluginMarketplaceArtifactReadback({
      root: installed.dir,
      scope: installed.scope,
      source: installed.source,
    });

    expect(result.status).toBe("failed");
    expect(result.comparisons.sbom).toMatchObject({
      status: "unbound",
      comparable: false,
    });
    expect(result.remoteSbomPayloadComparison).toMatchObject({
      present: true,
      valid: true,
      currentPayloadMatches: false,
    });
    expect(result.comparisons.remoteSbomPayload).toMatchObject({
      status: "mismatch",
      comparable: true,
    });
    expect(result.blockers).toContainEqual({
      code: "REMOTE_SBOM_PAYLOAD_MISMATCH",
    });
    expect(result.claims.remoteSbomRecordedPayloadMatchesCurrentInstall).toBe(
      false,
    );
  });

  it("keeps the comparison explicitly local when every writable record is recomputed", () => {
    const installed = installSigned(
      sourceMetadata({ remoteExpectations: true, evidence: true }),
    );
    fs.writeFileSync(path.join(installed.dir, "drift.js"), "drift\n", "utf8");

    // The source metadata, comparison checksum, and component SBOM are all
    // locally writable and unkeyed. Recomputing every one can restore a
    // self-consistent readback, so none of these fields may claim publisher
    // authentication or prove what bytes were present at install time.
    const metadataPath = path.join(installed.dir, ".plugin-source.json");
    const rewritten = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    const rewrittenPayload = buildMarketplacePayloadSbom(installed.dir);
    const pretendRemoteBytes = Buffer.from(JSON.stringify(rewrittenPayload));
    const pretendDocumentSha256 = sha256(pretendRemoteBytes);
    const oldEvidenceAuthority = structuredClone(
      rewritten.catalogAuthority.remoteArtifactEvidence,
    );
    delete oldEvidenceAuthority.evidenceDigest;
    const evidenceAuthority = {
      ...oldEvidenceAuthority,
      sbom: {
        ...oldEvidenceAuthority.sbom,
        expectedDocumentSha256: pretendDocumentSha256,
        documentSha256: pretendDocumentSha256,
        bytes: pretendRemoteBytes.length,
      },
    };
    const rewrittenEvidence = {
      ...evidenceAuthority,
      evidenceDigest: sha256(canonicalJson(evidenceAuthority)),
    };
    const payloadSummary = {
      schemaVersion: rewrittenPayload.schemaVersion,
      digest: rewrittenPayload.digest,
      fileCount: rewrittenPayload.fileCount,
      totalBytes: rewrittenPayload.totalBytes,
    };
    const comparisonAuthority = {
      schemaVersion: PLUGIN_MARKETPLACE_REMOTE_SBOM_PAYLOAD_COMPARISON_SCHEMA,
      status: "matched",
      remoteArtifactEvidenceDigest: rewrittenEvidence.evidenceDigest,
      format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
      documentSha256: pretendDocumentSha256,
      remotePayload: payloadSummary,
      installedPayload: payloadSummary,
    };
    rewritten.catalogAuthority.artifactExpectations.sbom = {
      ...rewritten.catalogAuthority.artifactExpectations.sbom,
      sha256: rewrittenPayload.digest,
      payloadSha256: rewrittenPayload.digest,
      documentSha256: pretendDocumentSha256,
    };
    rewritten.catalogAuthority.remoteArtifactEvidence = rewrittenEvidence;
    rewritten.catalogAuthority.remoteSbomPayloadComparison = {
      ...comparisonAuthority,
      comparisonDigest: sha256(canonicalJson(comparisonAuthority)),
    };
    fs.writeFileSync(metadataPath, JSON.stringify(rewritten, null, 2), "utf8");

    const lockPath = path.join(installed.dir, ".plugin-lock.json");
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    lock.sbom = buildPluginSbom(installed.dir);
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), "utf8");

    const [rewrittenInstall] = listInstalled({ cwd, scopes: ["project"] });
    const result = buildPluginMarketplaceArtifactReadback({
      root: rewrittenInstall.dir,
      scope: rewrittenInstall.scope,
      source: rewrittenInstall.source,
    });

    expect(result.status).toBe("matched");
    expect(result.claims).toMatchObject({
      registryPublisherIdentityVerified: false,
      remoteSbomPayloadComparisonRecorded: true,
      remoteSbomPayloadComparisonSelfConsistent: true,
      remoteSbomRecordedPayloadMatchesCurrentInstall: true,
    });
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

describe("repository marketplace payload SBOM parser", () => {
  it("preserves v1 documents while v2 excludes VCS metadata and binds entry types", () => {
    fs.mkdirSync(path.join(source, ".git"));
    fs.writeFileSync(path.join(source, ".git", "config"), "fixture\n", "utf8");

    const legacy = buildMarketplacePayloadSbom(source);
    const typed = buildMarketplacePayloadSbom(source, {
      schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
    });

    expect(legacy).toMatchObject({
      schemaVersion: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
      exclusions: [".plugin-lock.json", ".plugin-source.json"],
    });
    expect(legacy.files).toContainEqual(
      expect.objectContaining({ path: ".git/config" }),
    );
    expect(legacy.files[0]).not.toHaveProperty("type");
    expect(typed).toMatchObject({
      schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
      exclusions: [".git", ".plugin-lock.json", ".plugin-source.json"],
    });
    expect(typed.files.map((file) => file.path)).not.toContain(".git/config");
    expect(typed.files.every((file) => file.type === "file")).toBe(true);
    expect(
      parseMarketplacePayloadSbomDocument(Buffer.from(JSON.stringify(legacy)), {
        format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
      }),
    ).toEqual(legacy);
    expect(
      parseMarketplacePayloadSbomDocument(Buffer.from(JSON.stringify(typed)), {
        format: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
      }),
    ).toEqual(typed);
  });

  it.skipIf(process.platform === "win32")(
    "distinguishes a symlink from a regular file with identical bytes",
    () => {
      const linkPath = path.join(source, "link.txt");
      fs.writeFileSync(linkPath, "target.txt", "utf8");
      const regular = buildMarketplacePayloadSbom(source, {
        schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
      });
      fs.unlinkSync(linkPath);
      fs.symlinkSync("target.txt", linkPath);
      const linked = buildMarketplacePayloadSbom(source, {
        schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
      });

      expect(
        regular.files.find((file) => file.path === "link.txt"),
      ).toMatchObject({ type: "file" });
      expect(
        linked.files.find((file) => file.path === "link.txt"),
      ).toMatchObject({ type: "symlink" });
      expect(linked.digest).not.toBe(regular.digest);

      fs.unlinkSync(linkPath);
      const rawTarget = Buffer.from([0xff]);
      fs.symlinkSync(rawTarget, linkPath);
      const rawLinked = buildMarketplacePayloadSbom(source, {
        schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
      });
      expect(
        rawLinked.files.find((file) => file.path === "link.txt"),
      ).toMatchObject({
        type: "symlink",
        bytes: rawTarget.length,
        sha256: sha256(rawTarget),
      });
    },
  );

  it("rejects an unknown v2 entry type", () => {
    const typed = buildMarketplacePayloadSbom(source, {
      schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
    });
    typed.files[0].type = "device";

    expect(() =>
      parseMarketplacePayloadSbomDocument(Buffer.from(JSON.stringify(typed)), {
        format: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
      }),
    ).toThrow(/file type is invalid/i);
  });

  it.each([
    {
      label: "unexpected fields",
      mutate(value) {
        value.untrusted = true;
      },
      message: /shape is invalid/i,
    },
    {
      label: "traversal paths",
      mutate(value) {
        value.files[0].path = "../plugin.json";
      },
      message: /file path is invalid/i,
    },
    {
      label: "uppercase file digests",
      mutate(value) {
        value.files[0].sha256 = value.files[0].sha256.toUpperCase();
      },
      message: /file digest is invalid/i,
    },
    {
      label: "forged inventory digests",
      mutate(value) {
        value.digest = "0".repeat(64);
      },
      message: /digest mismatch/i,
    },
  ])("rejects $label", ({ mutate, message }) => {
    const value = structuredClone(payloadSbom);
    mutate(value);

    expect(() =>
      parseMarketplacePayloadSbomDocument(Buffer.from(JSON.stringify(value)), {
        format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
      }),
    ).toThrow(message);
  });

  it("rejects invalid UTF-8 and ignores formats without repository semantics", () => {
    expect(() =>
      parseMarketplacePayloadSbomDocument(Buffer.from([0xff]), {
        format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
      }),
    ).toThrow(/valid UTF-8/i);
    expect(
      parseMarketplacePayloadSbomDocument(Buffer.from("not json"), {
        format: "cyclonedx-json",
      }),
    ).toBeNull();
  });
});
