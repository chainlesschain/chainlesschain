import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  installFromDirectory,
  installFromSource,
  updatePlugin,
  finalizePluginUpdate,
  rollbackPluginUpdate,
  listInstalled,
  uninstall,
  setActiveVersion,
  setPluginEnabled,
  isPluginEnabled,
  getActiveVersion,
  MAX_LISTED_PLUGIN_VERSIONS,
  parseGitSource,
  _deps as installDeps,
} from "../../src/lib/plugin-runtime/install.js";
import { execSync } from "node:child_process";
import {
  discoverPlugins,
  pluginVersionDir,
} from "../../src/lib/plugin-runtime/scopes.js";
import {
  PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
  PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
  buildMarketplacePayloadSbom,
  buildRemoteSbomPayloadComparison,
} from "../../src/lib/plugin-runtime/marketplace-artifact-readback.js";

let cwd; // acts as the project root for project/local scopes
let srcRoot; // where source plugin fixtures live

function makeSource(name, version, { withSkill = true, extra = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(srcRoot, `${name}-`));
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version, ...extra }),
    "utf8",
  );
  if (withSkill) {
    const s = path.join(dir, "skills", "hello");
    fs.mkdirSync(s, { recursive: true });
    fs.writeFileSync(
      path.join(s, "SKILL.md"),
      "---\nname: hello\n---\nhi",
      "utf8",
    );
  }
  return dir;
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

function remoteSbomEvidence({
  registryOrigin = "https://registry.example",
  url = "https://registry.example/plugin.cdx.json",
  format = "cyclonedx-json",
  digest = "e".repeat(64),
  bytes = 128,
} = {}) {
  const authority = {
    schemaVersion: "cc-plugin-marketplace-remote-artifact-evidence/v1",
    status: "verified",
    registryOrigin,
    signature: null,
    sbom: {
      status: "digest-verified",
      url,
      format,
      expectedDocumentSha256: digest,
      documentSha256: digest,
      bytes,
      fromCache: false,
    },
    claims: {
      publisherIdentityVerified: false,
      signatureBytesFetched: false,
      publicKeyFingerprintVerified: false,
      manifestSignatureVerified: false,
      sbomDocumentDigestVerified: true,
      sbomPayloadCompared: false,
    },
  };
  return {
    ...authority,
    evidenceDigest: crypto
      .createHash("sha256")
      .update(canonicalJson(authority))
      .digest("hex"),
  };
}

function semanticSourceMetadata(
  src,
  name,
  format = PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
) {
  const payload = buildMarketplacePayloadSbom(src, {
    schemaVersion: format,
  });
  const bytes = Buffer.from(JSON.stringify(payload));
  const documentSha256 = crypto
    .createHash("sha256")
    .update(bytes)
    .digest("hex");
  const artifactUrl = "https://registry.example/plugin.sbom.json";
  return {
    bytes,
    metadata: {
      type: "registry",
      source: "https://registry.example/index.json",
      registry: "https://registry.example/index.json",
      package: name,
      catalogAuthority: {
        catalogDigest: "a".repeat(64),
        candidateId: `candidate-${"b".repeat(20)}`,
        candidateDigest: "c".repeat(64),
        governanceStatus: "complete",
        registryStatus: "online",
        versionAuthority: "registry-declared-unverified",
        artifactExpectations: {
          sbom: {
            status: "declared",
            format,
            payloadSha256: payload.digest,
            url: artifactUrl,
            documentSha256,
          },
        },
        remoteArtifactEvidence: remoteSbomEvidence({
          format,
          digest: documentSha256,
          bytes: bytes.length,
          url: artifactUrl,
        }),
      },
    },
  };
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-inst-cwd-"));
  srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-inst-src-"));
});
afterEach(() => {
  for (const d of [cwd, srcRoot]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

describe("installFromDirectory", () => {
  it("copies a valid plugin into the scope version dir and marks it active", () => {
    const src = makeSource("greeter", "1.0.0");
    const res = installFromDirectory(src, { scope: "project", cwd });
    expect(res).toMatchObject({
      name: "greeter",
      version: "1.0.0",
      scope: "project",
    });
    const dest = pluginVersionDir("project", "greeter", "1.0.0", { cwd });
    expect(fs.existsSync(path.join(dest, "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "skills", "hello", "SKILL.md"))).toBe(
      true,
    );
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("refuses to overwrite an immutable version without force", () => {
    const src = makeSource("greeter", "1.0.0");
    installFromDirectory(src, { scope: "project", cwd });
    expect(() => installFromDirectory(src, { scope: "project", cwd })).toThrow(
      /already installed.*immutable/,
    );
  });

  it("reinstalls with force", () => {
    const src = makeSource("greeter", "1.0.0");
    installFromDirectory(src, { scope: "project", cwd });
    const res = installFromDirectory(src, {
      scope: "project",
      cwd,
      force: true,
    });
    expect(res.version).toBe("1.0.0");
  });

  it("keeps the active bytes intact when a forced reinstall copy fails", () => {
    const original = makeSource("greeter", "1.0.0");
    fs.writeFileSync(
      path.join(original, "skills", "hello", "SKILL.md"),
      "original",
    );
    installFromDirectory(original, { scope: "project", cwd });
    const replacement = makeSource("greeter", "1.0.0");
    fs.writeFileSync(
      path.join(replacement, "skills", "hello", "SKILL.md"),
      "replacement",
    );
    const copyFileSync = installDeps.copyFileSync;
    installDeps.copyFileSync = (from, to) => {
      if (from.endsWith("SKILL.md")) throw new Error("injected copy failure");
      return copyFileSync(from, to);
    };
    try {
      expect(() =>
        installFromDirectory(replacement, {
          scope: "project",
          cwd,
          force: true,
        }),
      ).toThrow(/injected copy failure/);
    } finally {
      installDeps.copyFileSync = copyFileSync;
    }

    const dest = pluginVersionDir("project", "greeter", "1.0.0", { cwd });
    expect(
      fs.readFileSync(path.join(dest, "skills", "hello", "SKILL.md"), "utf8"),
    ).toBe("original");
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("rejects a corrupted staged copy before replacing active bytes", () => {
    const original = makeSource("greeter", "1.0.0");
    installFromDirectory(original, { scope: "project", cwd });
    const replacement = makeSource("greeter", "1.0.0");
    const copyFileSync = installDeps.copyFileSync;
    installDeps.copyFileSync = (from, to) => {
      copyFileSync(from, to);
      if (path.basename(from) === "plugin.json") {
        fs.writeFileSync(to, "{not-json", "utf8");
      }
    };
    try {
      expect(() =>
        installFromDirectory(replacement, {
          scope: "project",
          cwd,
          force: true,
        }),
      ).toThrow(/staged plugin failed load validation/);
    } finally {
      installDeps.copyFileSync = copyFileSync;
    }

    const dest = pluginVersionDir("project", "greeter", "1.0.0", { cwd });
    expect(
      JSON.parse(fs.readFileSync(path.join(dest, "plugin.json"), "utf8")),
    ).toMatchObject({
      name: "greeter",
      version: "1.0.0",
    });
  });

  it("rejects an invalid manifest", () => {
    const src = makeSource("evil", "1.0.0", {
      extra: { skills: [{ name: "x", path: "../../../etc" }] },
    });
    expect(() => installFromDirectory(src, { scope: "project", cwd })).toThrow(
      /manifest is invalid/,
    );
  });
});

describe("installFromSource", () => {
  it("installs from an existing local directory", () => {
    const src = makeSource("greeter", "1.0.0");
    const res = installFromSource(src, { scope: "project", cwd });
    expect(res.name).toBe("greeter");
    const [row] = listInstalled({ cwd, scopes: ["project"] });
    expect(row.source).toMatchObject({
      version: 1,
      type: "local",
      source: path.resolve(src),
    });
  });

  it("replaces untrusted source metadata with installer-owned provenance", () => {
    const src = makeSource("provenance", "1.0.0");
    fs.writeFileSync(
      path.join(src, ".plugin-source.json"),
      JSON.stringify({
        type: "git",
        source: "https://attacker.invalid/forged.git",
      }),
      "utf8",
    );
    installFromSource(src, { scope: "project", cwd });
    const [row] = listInstalled({ cwd, scopes: ["project"] });
    expect(row.source).toMatchObject({
      type: "local",
      source: path.resolve(src),
    });
    expect(row.source.source).not.toContain("attacker.invalid");
  });

  it("persists validated marketplace catalog authority and exact registry identity", () => {
    const src = makeSource("governed", "2.0.0");
    const catalogDigest = "a".repeat(64);
    const candidateId = `candidate-${"b".repeat(20)}`;
    const candidateDigest = "c".repeat(64);
    const selectionDigest = "d".repeat(64);
    installFromSource(src, {
      scope: "project",
      cwd,
      expectedIdentity: { name: "governed", version: "2.0.0" },
      sourceMetadata: {
        type: "registry",
        source: "https://registry.example/index.json?token=secret",
        registry: "https://registry.example/index.json?token=secret",
        package: "governed",
        resolvedSource: "https://git.example/governed.git#v2.0.0",
        catalogAuthority: {
          catalogDigest,
          candidateId,
          candidateDigest,
          selectionDigest,
          selectionSourceCount: 2,
          governanceStatus: "complete",
          registryStatus: "online",
          versionAuthority: "registry-declared-unverified",
        },
      },
    });

    const [row] = listInstalled({ cwd, scopes: ["project"] });
    expect(row.source).toMatchObject({
      type: "registry",
      source: "https://registry.example/index.json",
      catalogAuthority: {
        schemaVersion: "cc-plugin-marketplace-catalog/v1",
        installPreflightSchemaVersion:
          "cc-plugin-marketplace-install-preflight/v1",
        catalogDigest,
        candidateId,
        candidateDigest,
        selectionSchemaVersion: "cc-plugin-marketplace-candidate-selection/v1",
        selectionDigest,
        selectionSourceCount: 2,
        preflightStatus: "allowed",
        governanceStatus: "complete",
      },
    });
    expect(JSON.stringify(row.source)).not.toContain("secret");
  });

  it("rejects registry identity drift and malformed catalog authority before install", () => {
    const src = makeSource("actual-name", "1.0.0");
    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        expectedIdentity: { name: "claimed-name", version: "1.0.0" },
      }),
    ).toThrow(/plugin identity mismatch/);
    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        sourceMetadata: {
          type: "registry",
          source: "https://registry.example/index.json",
          catalogAuthority: {
            catalogDigest: "not-a-digest",
            candidateId: `candidate-${"b".repeat(20)}`,
          },
        },
      }),
    ).toThrow(/catalogAuthority\.catalogDigest/);
    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        sourceMetadata: {
          type: "registry",
          source: "https://registry.example/index.json",
          catalogAuthority: {
            catalogDigest: "a".repeat(64),
            candidateId: `candidate-${"b".repeat(20)}`,
            selectionDigest: "d".repeat(64),
            selectionSourceCount: 17,
          },
        },
      }),
    ).toThrow(/catalogAuthority\.selectionSourceCount/);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);
  });

  it("cross-binds remote artifact evidence to the selected registry and catalog declaration", () => {
    const src = makeSource("remote-sbom", "1.0.0");
    const artifactUrl = "https://registry.example/plugin.cdx.json";
    const documentSha256 = "e".repeat(64);
    const catalogAuthority = (evidence) => ({
      catalogDigest: "a".repeat(64),
      candidateId: `candidate-${"b".repeat(20)}`,
      candidateDigest: "c".repeat(64),
      governanceStatus: "complete",
      registryStatus: "online",
      versionAuthority: "registry-declared-unverified",
      artifactExpectations: {
        sbom: {
          status: "declared",
          format: "cyclonedx-json",
          url: artifactUrl,
          documentSha256,
        },
      },
      remoteArtifactEvidence: evidence,
    });
    const sourceMetadata = (evidence) => ({
      type: "registry",
      source: "https://registry.example/index.json",
      registry: "https://registry.example/index.json",
      package: "remote-sbom",
      catalogAuthority: catalogAuthority(evidence),
    });

    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        sourceMetadata: sourceMetadata(
          remoteSbomEvidence({ url: "https://other.example/plugin.cdx.json" }),
        ),
      }),
    ).toThrow(/does not match catalog URL, format, or digest expectations/);
    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        sourceMetadata: sourceMetadata(
          remoteSbomEvidence({ registryOrigin: "https://other.example" }),
        ),
      }),
    ).toThrow(/registry origin does not match/);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);

    installFromSource(src, {
      scope: "project",
      cwd,
      sourceMetadata: sourceMetadata(remoteSbomEvidence()),
    });
    expect(listInstalled({ cwd, scopes: ["project"] })).toHaveLength(1);
  });

  it("requires fetched bytes for a repository-defined payload SBOM before activation", () => {
    const src = makeSource("semantic-sbom", "1.0.0");
    const sbomBytes = Buffer.from(
      JSON.stringify(buildMarketplacePayloadSbom(src)),
    );
    const documentSha256 = crypto
      .createHash("sha256")
      .update(sbomBytes)
      .digest("hex");
    const artifactUrl = "https://registry.example/plugin.sbom.json";
    const evidence = remoteSbomEvidence({
      format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
      digest: documentSha256,
      bytes: sbomBytes.length,
      url: artifactUrl,
    });
    const sourceMetadata = {
      type: "registry",
      source: "https://registry.example/index.json",
      registry: "https://registry.example/index.json",
      package: "semantic-sbom",
      catalogAuthority: {
        catalogDigest: "a".repeat(64),
        candidateId: `candidate-${"b".repeat(20)}`,
        candidateDigest: "c".repeat(64),
        governanceStatus: "complete",
        registryStatus: "online",
        versionAuthority: "registry-declared-unverified",
        artifactExpectations: {
          sbom: {
            status: "declared",
            format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
            url: artifactUrl,
            documentSha256,
          },
        },
        remoteArtifactEvidence: evidence,
      },
    };

    const authorityWithoutEvidence = { ...sourceMetadata.catalogAuthority };
    delete authorityWithoutEvidence.remoteArtifactEvidence;
    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        sourceMetadata: {
          ...sourceMetadata,
          catalogAuthority: authorityWithoutEvidence,
        },
      }),
    ).toThrow(/payload SBOM evidence is required before plugin activation/i);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);

    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        sourceMetadata,
      }),
    ).toThrow(/SBOM bytes are required before plugin activation/i);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);

    installFromSource(src, {
      scope: "project",
      cwd,
      sourceMetadata,
      remoteSbomBytes: sbomBytes,
    });
    expect(
      listInstalled({ cwd, scopes: ["project"] })[0].source.catalogAuthority
        .remoteSbomPayloadComparison,
    ).toMatchObject({
      status: "matched",
      documentSha256,
      remotePayload: { digest: buildMarketplacePayloadSbom(src).digest },
    });
  });

  it("requires v2 instead of binding legacy v1 documents to Git metadata", () => {
    const src = makeSource("legacy-git-sbom", "1.0.0");
    fs.mkdirSync(path.join(src, ".git"));
    fs.writeFileSync(path.join(src, ".git", "config"), "fixture\n", "utf8");
    const payload = buildMarketplacePayloadSbom(src);
    const bytes = Buffer.from(JSON.stringify(payload));
    const documentSha256 = crypto
      .createHash("sha256")
      .update(bytes)
      .digest("hex");

    expect(() =>
      buildRemoteSbomPayloadComparison({
        remoteArtifactEvidence: remoteSbomEvidence({
          format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
          digest: documentSha256,
          bytes: bytes.length,
        }),
        remoteSbomBytes: bytes,
        installedRoot: src,
      }),
    ).toThrow(/v1 cannot bind Git VCS metadata.*v2 payload format/i);
  });

  it("keeps an incomplete legacy v1 declaration unbound on later replacement", () => {
    const src = makeSource("legacy-unbound-sbom", "1.0.0");
    const payload = buildMarketplacePayloadSbom(src);
    installFromSource(src, {
      scope: "project",
      cwd,
      sourceMetadata: {
        type: "registry",
        source: "https://registry.example/index.json",
        registry: "https://registry.example/index.json",
        package: "legacy-unbound-sbom",
        catalogAuthority: {
          catalogDigest: "a".repeat(64),
          candidateId: `candidate-${"b".repeat(20)}`,
          candidateDigest: "c".repeat(64),
          governanceStatus: "complete",
          registryStatus: "online",
          versionAuthority: "registry-declared-unverified",
          artifactExpectations: {
            sbom: {
              status: "declared",
              format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
              payloadSha256: payload.digest,
            },
          },
        },
      },
    });

    const replacement = makeSource("legacy-unbound-sbom", "2.0.0");
    const upgraded = installFromSource(replacement, {
      scope: "project",
      cwd,
    });
    expect(upgraded.version).toBe("2.0.0");
    expect(
      getActiveVersion("legacy-unbound-sbom", { scope: "project", cwd }),
    ).toBe("2.0.0");
  });

  it("fails closed when evidence is deleted from a complete v1 binding", () => {
    const src = makeSource("legacy-bound-sbom", "1.0.0");
    const semantic = semanticSourceMetadata(
      src,
      "legacy-bound-sbom",
      PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
    );
    const installed = installFromSource(src, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });
    const metadataPath = path.join(installed.dir, ".plugin-source.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    delete metadata.catalogAuthority.remoteArtifactEvidence;
    delete metadata.catalogAuthority.remoteSbomPayloadComparison;
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

    const replacement = makeSource("legacy-bound-sbom", "2.0.0");
    expect(() =>
      installFromSource(replacement, { scope: "project", cwd }),
    ).toThrow(/INSTALLED_SEMANTIC_SBOM_EVIDENCE_INVALID/);
    expect(
      getActiveVersion("legacy-bound-sbom", { scope: "project", cwd }),
    ).toBe("1.0.0");
  });

  it("fails closed when an active semantic install contains an excluded metadata directory", () => {
    const src = makeSource("unsafe-active-sbom", "1.0.0");
    const semantic = semanticSourceMetadata(src, "unsafe-active-sbom");
    const installed = installFromSource(src, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });
    const unsafePath = path.join(installed.dir, ".plugin-lock.json");
    fs.rmSync(unsafePath, { recursive: true, force: true });
    fs.mkdirSync(unsafePath);
    fs.writeFileSync(path.join(unsafePath, "hidden.js"), "hidden\n", "utf8");

    const replacement = makeSource("unsafe-active-sbom", "2.0.0");
    const nextSemantic = semanticSourceMetadata(
      replacement,
      "unsafe-active-sbom",
    );
    expect(() =>
      installFromSource(replacement, {
        scope: "project",
        cwd,
        sourceMetadata: nextSemantic.metadata,
        remoteSbomBytes: nextSemantic.bytes,
      }),
    ).toThrow(/EXISTING_VERSION_UNSAFE_ENTRY/);
    expect(
      getActiveVersion("unsafe-active-sbom", { scope: "project", cwd }),
    ).toBe("1.0.0");
  });

  it("rejects an incomplete v2 declaration before activation", () => {
    const src = makeSource("incomplete-v2-sbom", "1.0.0");
    const payload = buildMarketplacePayloadSbom(src, {
      schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
    });
    const sourceMetadata = {
      type: "registry",
      source: "https://registry.example/index.json",
      registry: "https://registry.example/index.json",
      package: "incomplete-v2-sbom",
      catalogAuthority: {
        catalogDigest: "a".repeat(64),
        candidateId: `candidate-${"b".repeat(20)}`,
        candidateDigest: "c".repeat(64),
        governanceStatus: "complete",
        registryStatus: "online",
        versionAuthority: "registry-declared-unverified",
        artifactExpectations: {
          sbom: {
            status: "declared",
            format: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
            payloadSha256: payload.digest,
          },
        },
      },
    };

    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        sourceMetadata,
      }),
    ).toThrow(/payload SBOM v2 requires complete bound remote evidence/i);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);
  });

  it("blocks direct local replacement and pointer activation from weakening an installed v2 binding", () => {
    const savedUnbound = makeSource("semantic-lineage", "2.0.0");
    installFromSource(savedUnbound, { scope: "project", cwd });

    const bound = makeSource("semantic-lineage", "1.0.0");
    fs.writeFileSync(
      path.join(bound, "skills", "hello", "SKILL.md"),
      "bound",
      "utf8",
    );
    const semantic = semanticSourceMetadata(bound, "semantic-lineage");
    installFromSource(bound, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });
    expect(
      getActiveVersion("semantic-lineage", { scope: "project", cwd }),
    ).toBe("1.0.0");

    expect(() => updatePlugin(savedUnbound, { scope: "project", cwd })).toThrow(
      /SEMANTIC_SBOM_BINDING_DOWNGRADE/,
    );
    expect(
      getActiveVersion("semantic-lineage", { scope: "project", cwd }),
    ).toBe("1.0.0");

    const replacement = makeSource("semantic-lineage", "3.0.0");
    expect(() =>
      installFromSource(replacement, { scope: "project", cwd }),
    ).toThrow(/SEMANTIC_SBOM_BINDING_DOWNGRADE/);
    const active = listInstalled({ cwd, scopes: ["project"] })[0];
    expect(active.version).toBe("1.0.0");
    expect(
      fs.readFileSync(
        path.join(active.dir, "skills", "hello", "SKILL.md"),
        "utf8",
      ),
    ).toBe("bound");
    expect(
      active.source.catalogAuthority.remoteSbomPayloadComparison,
    ).toMatchObject({ status: "matched" });
  });

  it("fails closed when provenance is deleted before a direct replacement", () => {
    const bound = makeSource("missing-lineage", "1.0.0");
    const semantic = semanticSourceMetadata(bound, "missing-lineage");
    const installed = installFromSource(bound, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });
    fs.rmSync(path.join(installed.dir, ".plugin-source.json"));

    const replacement = makeSource("missing-lineage", "2.0.0");
    expect(() =>
      installFromSource(replacement, { scope: "project", cwd }),
    ).toThrow(/source metadata is missing.*remove and reinstall/i);
    expect(getActiveVersion("missing-lineage", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("protects a non-active v2 destination from a forced unbound overwrite", () => {
    const unbound = makeSource("saved-binding", "3.0.0");
    installFromSource(unbound, { scope: "project", cwd });
    const bound = makeSource("saved-binding", "2.0.0");
    fs.writeFileSync(
      path.join(bound, "skills", "hello", "SKILL.md"),
      "protected",
      "utf8",
    );
    const semantic = semanticSourceMetadata(bound, "saved-binding");
    installFromSource(bound, {
      scope: "project",
      cwd,
      sourceMetadata: semantic.metadata,
      remoteSbomBytes: semantic.bytes,
    });
    setActiveVersion("saved-binding", "3.0.0", { scope: "project", cwd });

    const replacement = makeSource("saved-binding", "2.0.0");
    expect(() =>
      installFromSource(replacement, {
        scope: "project",
        cwd,
        force: true,
      }),
    ).toThrow(/SEMANTIC_SBOM_BINDING_DOWNGRADE/);
    expect(getActiveVersion("saved-binding", { scope: "project", cwd })).toBe(
      "3.0.0",
    );
    const protectedDir = pluginVersionDir("project", "saved-binding", "2.0.0", {
      cwd,
    });
    expect(
      fs.readFileSync(
        path.join(protectedDir, "skills", "hello", "SKILL.md"),
        "utf8",
      ),
    ).toBe("protected");
  });

  it("freshly verifies saved v2 bytes before pointer-only activation", () => {
    const first = makeSource("saved-v2", "1.0.0");
    const firstSemantic = semanticSourceMetadata(first, "saved-v2");
    installFromSource(first, {
      scope: "project",
      cwd,
      sourceMetadata: firstSemantic.metadata,
      remoteSbomBytes: firstSemantic.bytes,
    });
    const second = makeSource("saved-v2", "2.0.0");
    const secondSemantic = semanticSourceMetadata(second, "saved-v2");
    const installedSecond = installFromSource(second, {
      scope: "project",
      cwd,
      sourceMetadata: secondSemantic.metadata,
      remoteSbomBytes: secondSemantic.bytes,
    });
    setActiveVersion("saved-v2", "1.0.0", { scope: "project", cwd });
    fs.writeFileSync(
      path.join(installedSecond.dir, "skills", "hello", "SKILL.md"),
      "tampered",
      "utf8",
    );

    expect(() =>
      updatePlugin(second, {
        scope: "project",
        cwd,
        sourceMetadata: secondSemantic.metadata,
      }),
    ).toThrow(/EXISTING_VERSION_PAYLOAD_MISMATCH/);
    expect(getActiveVersion("saved-v2", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("errors on a plain non-remote, non-existent source", () => {
    // A bare word is neither a directory nor a git URL.
    expect(() =>
      installFromSource("this-is-not-a-path-or-url", { scope: "project", cwd }),
    ).toThrow(/not found as a local directory or git URL/);
  });

  it("enforces managed name/source policy before files land on disk", () => {
    const src = makeSource("managed-denied", "1.0.0");
    expect(() =>
      installFromSource(src, {
        scope: "project",
        cwd,
        managedPolicy: { deniedPlugins: ["managed-denied"] },
        policySource: src,
      }),
    ).toThrow(/denied by managed settings/);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);
  });
});

describe("listInstalled", () => {
  it("lists installed plugins across scopes", () => {
    installFromDirectory(makeSource("alpha", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("beta", "0.2.0"), { scope: "local", cwd });
    const rows = listInstalled({ cwd, scopes: ["project", "local"] });
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
    expect(rows.every((r) => r.ok)).toBe(true);
    expect(rows.find((r) => r.name === "alpha")?.versions).toEqual(["1.0.0"]);
  });

  it("bounds the version history while retaining an older active version", () => {
    installFromDirectory(makeSource("bounded", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const nameDir = path.dirname(
      pluginVersionDir("project", "bounded", "1.0.0", { cwd }),
    );
    for (let major = 2; major <= 71; major += 1) {
      fs.mkdirSync(path.join(nameDir, `${major}.0.0`));
    }

    const [row] = listInstalled({ cwd, scopes: ["project"] });
    expect(row.versions).toHaveLength(MAX_LISTED_PLUGIN_VERSIONS);
    expect(row.versions[0]).toBe("71.0.0");
    expect(row.versions.at(-1)).toBe("1.0.0");
    expect(row.versions).not.toContain("8.0.0");
    expect(row.versions).not.toContain("7.0.0");
  });
});

describe("updatePlugin (upgrade from source)", () => {
  it("enforces source-switch and version-downgrade approvals for command callers", () => {
    const gitBacked = makeSource("guarded-update", "2.0.0");
    installFromSource(gitBacked, {
      scope: "project",
      cwd,
      sourceMetadata: {
        type: "git",
        source: "https://git.example/guarded-update.git",
      },
    });

    const localUpgrade = makeSource("guarded-update", "3.0.0");
    expect(() =>
      updatePlugin(localUpgrade, {
        scope: "project",
        cwd,
        enforceUpdateApprovals: true,
      }),
    ).toThrow(/SOURCE_SWITCH_APPROVAL_REQUIRED/);
    updatePlugin(localUpgrade, {
      scope: "project",
      cwd,
      enforceUpdateApprovals: true,
      allowSourceSwitch: true,
    });

    fs.writeFileSync(
      path.join(localUpgrade, "plugin.json"),
      JSON.stringify({ name: "guarded-update", version: "1.0.0" }),
      "utf8",
    );
    expect(() =>
      updatePlugin(localUpgrade, {
        scope: "project",
        cwd,
        enforceUpdateApprovals: true,
      }),
    ).toThrow(/VERSION_DOWNGRADE_APPROVAL_REQUIRED/);
    const downgraded = updatePlugin(localUpgrade, {
      scope: "project",
      cwd,
      enforceUpdateApprovals: true,
      allowDowngrade: true,
    });
    expect(downgraded.version).toBe("1.0.0");

    const otherLocalPath = makeSource("guarded-update", "4.0.0");
    expect(() =>
      updatePlugin(otherLocalPath, {
        scope: "project",
        cwd,
        enforceUpdateApprovals: true,
      }),
    ).toThrow(/SOURCE_SWITCH_APPROVAL_REQUIRED/);
    const switched = updatePlugin(otherLocalPath, {
      scope: "project",
      cwd,
      enforceUpdateApprovals: true,
      allowSourceSwitch: true,
    });
    expect(switched.version).toBe("4.0.0");
  });

  it("does not activate saved bytes whose source differs from the fetched candidate", () => {
    const sourceA = makeSource("pointer-source", "1.0.0");
    const gitA = { type: "git", source: "https://git.example/a.git" };
    installFromSource(sourceA, {
      scope: "project",
      cwd,
      sourceMetadata: gitA,
    });
    const sourceB = makeSource("pointer-source", "2.0.0");
    installFromSource(sourceB, {
      scope: "project",
      cwd,
      sourceMetadata: { type: "git", source: "https://git.example/b.git" },
    });
    setActiveVersion("pointer-source", "1.0.0", { scope: "project", cwd });
    fs.writeFileSync(
      path.join(sourceA, "plugin.json"),
      JSON.stringify({ name: "pointer-source", version: "2.0.0" }),
      "utf8",
    );

    expect(() =>
      updatePlugin(sourceA, {
        scope: "project",
        cwd,
        sourceMetadata: gitA,
        enforceUpdateApprovals: true,
      }),
    ).toThrow(/EXISTING_VERSION_SOURCE_MISMATCH/);
    expect(getActiveVersion("pointer-source", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it.each([
    { label: "local", sourceMetadata: null },
    {
      label: "Git",
      sourceMetadata: {
        type: "git",
        source: "https://git.example/pointer-bytes.git",
      },
    },
    {
      label: "registry",
      sourceMetadata: {
        type: "registry",
        source: "https://registry.example/index.json",
        registry: "https://registry.example/index.json",
        package: "pointer-bytes-registry",
        catalogAuthority: {
          catalogDigest: "a".repeat(64),
          candidateId: `candidate-${"b".repeat(20)}`,
          candidateDigest: "c".repeat(64),
          governanceStatus: "complete",
          registryStatus: "online",
          versionAuthority: "registry-declared-unverified",
          artifactExpectations: {},
        },
      },
    },
  ])(
    "compares the fetched $label payload with saved target bytes before pointer activation",
    ({ label, sourceMetadata }) => {
      const name = `pointer-bytes-${label.toLowerCase()}`;
      const mutableSource = makeSource(name, "2.0.0");
      const sourceOptions = sourceMetadata ? { sourceMetadata } : {};
      const saved = installFromSource(mutableSource, {
        scope: "project",
        cwd,
        ...sourceOptions,
      });
      fs.writeFileSync(
        path.join(mutableSource, "plugin.json"),
        JSON.stringify({ name, version: "3.0.0" }),
        "utf8",
      );
      installFromSource(mutableSource, {
        scope: "project",
        cwd,
        ...sourceOptions,
      });
      fs.writeFileSync(
        path.join(saved.dir, "tampered.js"),
        "tampered\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(mutableSource, "plugin.json"),
        JSON.stringify({ name, version: "2.0.0" }),
        "utf8",
      );

      expect(() =>
        updatePlugin(mutableSource, {
          scope: "project",
          cwd,
          ...sourceOptions,
          enforceUpdateApprovals: true,
          allowDowngrade: true,
        }),
      ).toThrow(/EXISTING_VERSION_PAYLOAD_MISMATCH/);
      expect(getActiveVersion(name, { scope: "project", cwd })).toBe("3.0.0");
    },
  );

  it.each(["link", ".git", "metadata-directory"])(
    "rejects a saved target containing an unsafe %s entry even when the candidate matches",
    (unsafeKind) => {
      const name = `pointer-unsafe-${unsafeKind.replace(/[^a-z]/g, "")}`;
      const mutableSource = makeSource(name, "2.0.0");
      const saved = installFromSource(mutableSource, {
        scope: "project",
        cwd,
      });
      fs.writeFileSync(
        path.join(mutableSource, "plugin.json"),
        JSON.stringify({ name, version: "3.0.0" }),
        "utf8",
      );
      installFromSource(mutableSource, { scope: "project", cwd });
      fs.writeFileSync(
        path.join(mutableSource, "plugin.json"),
        JSON.stringify({ name, version: "2.0.0" }),
        "utf8",
      );

      if (unsafeKind === "link") {
        const outside = fs.mkdtempSync(path.join(srcRoot, "outside-"));
        fs.writeFileSync(path.join(outside, "payload.js"), "outside\n", "utf8");
        const symlinkType = process.platform === "win32" ? "junction" : "dir";
        fs.symlinkSync(
          outside,
          path.join(mutableSource, "escape"),
          symlinkType,
        );
        fs.symlinkSync(outside, path.join(saved.dir, "escape"), symlinkType);
      } else if (unsafeKind === ".git") {
        for (const root of [mutableSource, saved.dir]) {
          fs.mkdirSync(path.join(root, ".git"));
          fs.writeFileSync(
            path.join(root, ".git", "payload.js"),
            "hidden\n",
            "utf8",
          );
        }
      } else {
        fs.rmSync(path.join(saved.dir, ".plugin-lock.json"), { force: true });
        fs.mkdirSync(path.join(saved.dir, ".plugin-lock.json"));
        fs.writeFileSync(
          path.join(saved.dir, ".plugin-lock.json", "payload.js"),
          "hidden\n",
          "utf8",
        );
      }

      expect(() =>
        updatePlugin(mutableSource, {
          scope: "project",
          cwd,
          enforceUpdateApprovals: true,
          allowDowngrade: true,
        }),
      ).toThrow(/EXISTING_VERSION_UNSAFE_ENTRY/);
      expect(getActiveVersion(name, { scope: "project", cwd })).toBe("3.0.0");
    },
  );

  it("rejects a saved target whose version root is a link", () => {
    const name = "pointer-unsafe-root-link";
    const mutableSource = makeSource(name, "2.0.0");
    const saved = installFromSource(mutableSource, {
      scope: "project",
      cwd,
    });
    fs.writeFileSync(
      path.join(mutableSource, "plugin.json"),
      JSON.stringify({ name, version: "3.0.0" }),
      "utf8",
    );
    installFromSource(mutableSource, { scope: "project", cwd });
    fs.writeFileSync(
      path.join(mutableSource, "plugin.json"),
      JSON.stringify({ name, version: "2.0.0" }),
      "utf8",
    );

    const linkedRoot = fs.mkdtempSync(path.join(srcRoot, "saved-root-"));
    const backing = path.join(linkedRoot, "payload");
    fs.renameSync(saved.dir, backing);
    fs.symlinkSync(
      backing,
      saved.dir,
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(() =>
      updatePlugin(mutableSource, {
        scope: "project",
        cwd,
        enforceUpdateApprovals: true,
        allowDowngrade: true,
      }),
    ).toThrow(/EXISTING_VERSION_UNSAFE_ENTRY/);
    expect(getActiveVersion(name, { scope: "project", cwd })).toBe("3.0.0");
  });

  it("installs a NEW version, repoints .active, keeps the old on disk for rollback", () => {
    installFromDirectory(makeSource("widget", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const res = updatePlugin(makeSource("widget", "2.0.0"), {
      scope: "project",
      cwd,
    });
    expect(res.updated).toBe(true);
    expect(res.previousVersion).toBe("1.0.0");
    expect(res.version).toBe("2.0.0");
    expect(getActiveVersion("widget", { scope: "project", cwd })).toBe("2.0.0");
    // old version dir preserved (rollback via `cc plugin use widget 1.0.0`)
    expect(
      fs.existsSync(pluginVersionDir("project", "widget", "1.0.0", { cwd })),
    ).toBe(true);
  });

  it("is a no-op when already at the source version (no --force)", () => {
    const src = makeSource("widget", "1.0.0");
    installFromDirectory(src, { scope: "project", cwd });
    const res = updatePlugin(makeSource("widget", "1.0.0"), {
      scope: "project",
      cwd,
    });
    expect(res.updated).toBe(false);
    expect(res.reinstalled).toBe(false);
    expect(res.version).toBe("1.0.0");
  });

  it("--force reinstalls the same version", () => {
    installFromDirectory(makeSource("widget", "1.0.0"), {
      scope: "project",
      cwd,
    });
    const res = updatePlugin(makeSource("widget", "1.0.0"), {
      scope: "project",
      cwd,
      force: true,
    });
    expect(res.reinstalled).toBe(true);
    expect(res.version).toBe("1.0.0");
  });

  it("installs a plugin that was not yet present", () => {
    const res = updatePlugin(makeSource("fresh", "1.0.0"), {
      scope: "project",
      cwd,
    });
    expect(res.updated).toBe(true);
    expect(res.previousVersion).toBe(null);
    expect(getActiveVersion("fresh", { scope: "project", cwd })).toBe("1.0.0");
  });

  it("restores active version and exact bytes when a transaction rolls back", () => {
    const original = makeSource("widget", "1.0.0");
    fs.writeFileSync(
      path.join(original, "skills", "hello", "SKILL.md"),
      "original",
    );
    installFromDirectory(original, { scope: "project", cwd });

    const sameVersion = makeSource("widget", "1.0.0");
    fs.writeFileSync(
      path.join(sameVersion, "skills", "hello", "SKILL.md"),
      "replacement",
    );
    const reinstall = updatePlugin(sameVersion, {
      scope: "project",
      cwd,
      force: true,
      transactional: true,
    });
    expect(
      fs.readFileSync(
        path.join(reinstall.dir, "skills", "hello", "SKILL.md"),
        "utf8",
      ),
    ).toBe("replacement");
    expect(rollbackPluginUpdate(reinstall)).toEqual({
      rolledBack: true,
      version: "1.0.0",
    });
    expect(
      fs.readFileSync(
        path.join(reinstall.dir, "skills", "hello", "SKILL.md"),
        "utf8",
      ),
    ).toBe("original");

    const upgrade = updatePlugin(makeSource("widget", "2.0.0"), {
      scope: "project",
      cwd,
      transactional: true,
    });
    expect(getActiveVersion("widget", { scope: "project", cwd })).toBe("2.0.0");
    expect(finalizePluginUpdate(upgrade)).toMatchObject({ finalized: true });
    expect(getActiveVersion("widget", { scope: "project", cwd })).toBe("2.0.0");
  });
});

describe("uninstall + rollback", () => {
  it("removes a whole plugin (all versions)", () => {
    installFromDirectory(makeSource("greeter", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("greeter", "2.0.0"), {
      scope: "project",
      cwd,
    });
    const res = uninstall("greeter", { scope: "project", cwd });
    expect(res.removed.sort()).toEqual(["1.0.0", "2.0.0"]);
    expect(listInstalled({ cwd, scopes: ["project"] })).toHaveLength(0);
  });

  it("removes one version and repoints active to the newest remaining", () => {
    installFromDirectory(makeSource("greeter", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("greeter", "2.0.0"), {
      scope: "project",
      cwd,
    });
    // active is 2.0.0 (last installed); remove it → active falls back to 1.0.0
    uninstall("greeter", { scope: "project", cwd, version: "2.0.0" });
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("removing a NON-active version leaves the pinned active version untouched", () => {
    for (const v of ["1.0.0", "2.0.0", "3.0.0"]) {
      installFromDirectory(makeSource("greeter", v), { scope: "project", cwd });
    }
    // Roll back: pin the OLD version as active.
    setActiveVersion("greeter", "1.0.0", { scope: "project", cwd });
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
    // Uninstall an unrelated (non-active) version — the pin must NOT move to the
    // newest remaining (previously it silently jumped 1.0.0 → 2.0.0).
    uninstall("greeter", { scope: "project", cwd, version: "3.0.0" });
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("setActiveVersion pins an older version (rollback)", () => {
    installFromDirectory(makeSource("greeter", "1.0.0"), {
      scope: "project",
      cwd,
    });
    installFromDirectory(makeSource("greeter", "2.0.0"), {
      scope: "project",
      cwd,
    });
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "2.0.0",
    );
    setActiveVersion("greeter", "1.0.0", { scope: "project", cwd });
    expect(getActiveVersion("greeter", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  });

  it("throws pinning a version that isn't installed", () => {
    installFromDirectory(makeSource("greeter", "1.0.0"), {
      scope: "project",
      cwd,
    });
    expect(() =>
      setActiveVersion("greeter", "9.9.9", { scope: "project", cwd }),
    ).toThrow(/not installed/);
  });
});

describe("enable / disable lifecycle", () => {
  it("keeps disabled versions installed but removes them from runtime discovery", () => {
    installFromDirectory(makeSource("switchable", "1.0.0"), {
      scope: "project",
      cwd,
    });
    expect(isPluginEnabled("switchable", { scope: "project", cwd })).toBe(true);

    setPluginEnabled("switchable", false, { scope: "project", cwd });
    expect(isPluginEnabled("switchable", { scope: "project", cwd })).toBe(
      false,
    );
    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toEqual([]);
    expect(listInstalled({ cwd, scopes: ["project"] })[0]).toMatchObject({
      name: "switchable",
      enabled: false,
      versions: ["1.0.0"],
    });

    setPluginEnabled("switchable", true, { scope: "project", cwd });
    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toHaveLength(1);
  });

  it("rejects lifecycle changes for a missing scoped install", () => {
    expect(() =>
      setPluginEnabled("missing", false, { scope: "project", cwd }),
    ).toThrow(/not installed/);
  });
});

describe("parseGitSource", () => {
  it("expands GitHub shorthand owner/repo", () => {
    expect(parseGitSource("acme/widgets")).toEqual({
      url: "https://github.com/acme/widgets.git",
      ref: null,
    });
  });

  it("passes through git URLs and keeps the #ref", () => {
    expect(parseGitSource("https://example.com/p.git#v2")).toEqual({
      url: "https://example.com/p.git",
      ref: "v2",
    });
    expect(parseGitSource("git@github.com:acme/w.git")).toMatchObject({
      url: "git@github.com:acme/w.git",
    });
    expect(parseGitSource("file:///tmp/repo#main")).toEqual({
      url: "file:///tmp/repo",
      ref: "main",
    });
  });

  it("returns null for non-remote strings", () => {
    expect(parseGitSource("./local/dir")).toBeNull();
    expect(parseGitSource("just-a-word")).toBeNull();
  });
});

describe("installFromSource — git (mocked clone)", () => {
  let savedSpawn;
  beforeEach(() => {
    savedSpawn = installDeps.spawnSync;
  });
  afterEach(() => {
    installDeps.spawnSync = savedSpawn;
  });

  it("clones a remote source and installs it", () => {
    const calls = [];
    // Emulate `git clone … <dir>` by materializing a plugin at the target dir.
    installDeps.spawnSync = (cmd, args, options) => {
      calls.push([cmd, args, options]);
      const dir = args[args.length - 1];
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "plugin.json"),
        JSON.stringify({ name: "remote-plugin", version: "3.1.0" }),
        "utf8",
      );
      return { status: 0, stdout: "", stderr: "" };
    };
    const res = installFromSource("acme/widgets", { scope: "project", cwd });
    expect(res).toMatchObject({
      name: "remote-plugin",
      version: "3.1.0",
      source: "https://github.com/acme/widgets.git",
    });
    expect(listInstalled({ cwd, scopes: ["project"] })).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      "git",
      [
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.eol=lf",
        "-c",
        "core.symlinks=false",
        "clone",
        "--depth",
        "1",
        "https://github.com/acme/widgets.git",
        expect.any(String),
      ],
      expect.objectContaining({
        origin: "plugin:install-git",
        policy: "allow",
        scope: "plugin-install",
        shell: false,
      }),
    ]);
  });

  it("transfers a transactional clone handle to the returned install result", () => {
    installDeps.spawnSync = (_cmd, args) => {
      const dir = args[args.length - 1];
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "plugin.json"),
        JSON.stringify({ name: "transactional-remote", version: "1.0.0" }),
        "utf8",
      );
      return { status: 0, stdout: "", stderr: "" };
    };

    const result = installFromSource("acme/transactional", {
      scope: "project",
      cwd,
      transactional: true,
    });
    expect(finalizePluginUpdate(result)).toMatchObject({ finalized: true });
    expect(
      getActiveVersion("transactional-remote", { scope: "project", cwd }),
    ).toBe("1.0.0");
  });

  it("reports a clear error when git is not installed", () => {
    installDeps.spawnSync = () => ({ error: { code: "ENOENT" }, status: null });
    expect(() =>
      installFromSource("acme/widgets", { scope: "project", cwd }),
    ).toThrow(/git is not installed/);
  });

  it("redacts URL credentials and query tokens from returned provenance", () => {
    installDeps.spawnSync = (_cmd, args) => {
      const dir = args[args.length - 1];
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "plugin.json"),
        JSON.stringify({ name: "private-plugin", version: "1.0.0" }),
        "utf8",
      );
      return { status: 0, stdout: "", stderr: "" };
    };
    const res = installFromSource(
      "https://alice:secret@example.com/private.git?token=hidden#main",
      { scope: "project", cwd },
    );
    expect(res.source).toBe("https://example.com/private.git");
    expect(res.ref).toBe("main");
    const [row] = listInstalled({ cwd, scopes: ["project"] });
    expect(row.source).toMatchObject({
      type: "git",
      source: "https://example.com/private.git",
      ref: "main",
    });
    expect(JSON.stringify(row)).not.toContain("secret");
    expect(JSON.stringify(row)).not.toContain("hidden");
  });
});

// Real end-to-end against a LOCAL git repo (offline) — only when git exists.
let gitAvailable = false;
try {
  execSync("git --version", { stdio: "ignore" });
  gitAvailable = true;
} catch {
  gitAvailable = false;
}

describe.skipIf(!gitAvailable)(
  "installFromSource — git (real, local repo)",
  () => {
    it("clones a file:// repo and installs the plugin", () => {
      const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cc-gitrepo-"));
      fs.writeFileSync(
        path.join(repo, "plugin.json"),
        JSON.stringify({ name: "git-plugin", version: "1.0.0" }),
        "utf8",
      );
      const skillDir = path.join(repo, "skills", "gskill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "---\nname: gskill\n---\nx",
        "utf8",
      );
      const git = (args) =>
        execSync(`git ${args}`, { cwd: repo, stdio: "ignore" });
      git("init -q");
      git("-c user.email=t@t -c user.name=t add -A");
      execSync("git -c user.email=t@t -c user.name=t commit -q -m init", {
        cwd: repo,
        stdio: "ignore",
      });

      const url = "file://" + repo.replace(/\\/g, "/");
      try {
        const res = installFromSource(url, { scope: "project", cwd });
        expect(res.name).toBe("git-plugin");
        const rows = listInstalled({ cwd, scopes: ["project"] });
        expect(rows.map((r) => r.name)).toContain("git-plugin");
      } finally {
        try {
          fs.rmSync(repo, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    });
  },
);
