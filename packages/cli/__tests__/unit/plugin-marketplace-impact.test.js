import { describe, expect, it } from "vitest";
import { buildPluginMarketplaceInstallPreflight } from "../../src/lib/plugin-runtime/marketplace-catalog.js";
import {
  PLUGIN_MARKETPLACE_UPDATE_IMPACT_SCHEMA,
  buildPluginMarketplaceUpdateImpact,
} from "../../src/lib/plugin-runtime/marketplace-impact.js";
import {
  PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
  PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
} from "../../src/lib/plugin-runtime/marketplace-artifact-readback.js";

const sha = (character) => character.repeat(64);

function candidate(overrides = {}) {
  return {
    name: "impact-plugin",
    version: "2.0.0",
    source: "https://git.example/impact.git",
    ref: "v2.0.0",
    sha256: sha("b"),
    signature: {
      algorithm: "ed25519",
      keyId: "org-key",
      publicKeySha256: sha("c"),
    },
    sbom: { digest: sha("d"), format: "cyclonedx-json" },
    license: "Apache-2.0",
    permissions: { process: true, network: ["api.example"] },
    dependencies: { helper: "^2.0.0" },
    compatibility: { cc: ">=0.163.0" },
    health: { status: "healthy" },
    ...overrides,
  };
}

function preflight(
  entry = candidate(),
  registryUrl = "https://registry.example/index.json",
) {
  return buildPluginMarketplaceInstallPreflight({
    registryUrl,
    entry,
    installed: { helper: "2.1.0" },
    hostVersion: "0.163.8",
    observedAt: "2026-08-15T00:00:00.000Z",
  }).preflight;
}

function installed(overrides = {}) {
  return {
    name: "impact-plugin",
    version: "1.0.0",
    scope: "project",
    source: {
      type: "registry",
      source: "https://registry.example/index.json",
      registry: "https://registry.example/index.json",
      resolvedSource: "https://git.example/impact.git",
      ref: "v1.0.0",
    },
    integrity: {
      signature: { verified: true, manifestSha256: sha("a") },
      sbom: {
        digest: sha("f"),
        payloadSha256: sha("e"),
        payloadSchema: "cc-plugin-marketplace-payload-sbom/v1",
      },
    },
    license: { expression: "MIT" },
    capabilities: {
      process: false,
      network: { any: false, domains: [] },
      filesystem: { roots: [] },
      mcp: false,
      monitor: false,
      credential: { names: [] },
    },
    dependencies: { helper: "^1.0.0" },
    ...overrides,
  };
}

describe("plugin marketplace update impact", () => {
  it("uses the v2 contract for cross-scope authority", () => {
    expect(PLUGIN_MARKETPLACE_UPDATE_IMPACT_SCHEMA).toBe(
      "cc-plugin-marketplace-update-impact/v2",
    );
  });

  it("projects version/source/integrity/license/capability/dependency changes", () => {
    const impact = buildPluginMarketplaceUpdateImpact({
      preflight: preflight(),
      installed: installed(),
      observedAt: "2026-08-15T01:00:00.000Z",
    });

    expect(impact.schemaVersion).toBe(PLUGIN_MARKETPLACE_UPDATE_IMPACT_SCHEMA);
    expect(impact.status).toBe("review-required");
    expect(impact.changes.version.kind).toBe("major-upgrade");
    expect(impact.changes.source).toMatchObject({
      kind: "same-registry-update",
      requiresApproval: false,
    });
    expect(impact.changes.integrity.manifestDigest.status).toBe("changed");
    expect(impact.changes.license.status).toBe("changed");
    expect(impact.changes.capabilities.added).toEqual(
      expect.arrayContaining(["process", "network:api.example"]),
    );
    expect(impact.changes.dependencies.changed).toEqual([
      { name: "helper", from: "^1.0.0", to: "^2.0.0" },
    ]);
    expect(impact.requiredApprovals.map((item) => item.code)).toContain(
      "CAPABILITY_WIDENING_CONSENT_REQUIRED",
    );
    expect(impact.claims).toMatchObject({
      candidateMetadataVerified: false,
      candidateBytesFetched: false,
      candidateCodeExecuted: false,
    });
  });

  it("requires an explicit approval when registry authority changes", () => {
    const impact = buildPluginMarketplaceUpdateImpact({
      preflight: preflight(
        candidate(),
        "https://other-registry.example/index.json",
      ),
      installed: installed(),
    });

    expect(impact.changes.source).toMatchObject({
      kind: "source-switch",
      requiresApproval: true,
    });
    expect(impact.requiredApprovals).toContainEqual({
      code: "SOURCE_SWITCH_APPROVAL_REQUIRED",
      detail: "source-switch",
    });
  });

  it("binds an effective scope transition and physical source switch into the digest", () => {
    const project = installed({
      scope: "project",
      source: {
        ...installed().source,
        source: "https://other-registry.example/index.json",
        registry: "https://other-registry.example/index.json",
      },
    });
    const impact = buildPluginMarketplaceUpdateImpact({
      preflight: preflight(),
      installed: project,
      installedScopes: [project],
      targetScope: "local",
    });

    expect(impact.changes.scopeAuthority).toMatchObject({
      targetScope: "local",
      effectiveFrom: "project",
      effectiveTo: "local",
      changed: true,
      candidateWouldBeEffective: true,
      sourceSwitchScopes: ["project"],
    });
    expect(impact.requiredApprovals).toContainEqual({
      code: "SOURCE_SWITCH_APPROVAL_REQUIRED",
      detail: "scopes: project",
    });
    expect(impact.installedScopes).toHaveLength(1);
    expect(impact.impactDigest).not.toBe(
      buildPluginMarketplaceUpdateImpact({
        preflight: preflight(),
        installed: project,
        targetScope: "local",
      }).impactDigest,
    );
  });

  it("blocks a candidate weaker than a shadowed physical scope binding", () => {
    const project = installed({
      scope: "project",
      integrity: {
        signature: { verified: true, manifestSha256: sha("a") },
        sbom: {
          payloadSha256: sha("d"),
          payloadSchema: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
          semanticPayloadFormat:
            PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
        },
      },
    });
    const local = installed({ scope: "local", version: "1.5.0" });
    const impact = buildPluginMarketplaceUpdateImpact({
      preflight: preflight(),
      installed: local,
      installedScopes: [project, local],
      targetScope: "local",
    });

    expect(impact.status).toBe("blocked");
    expect(impact.changes.scopeAuthority).toMatchObject({
      effectiveFrom: "local",
      effectiveTo: "local",
      semanticDowngradeScopes: ["project"],
    });
    expect(impact.blockers).toContainEqual({
      code: "SEMANTIC_SBOM_BINDING_DOWNGRADE",
      detail: "scopes: project",
    });
  });

  it("keeps remote SBOM document hashes separate from local payload hashes", () => {
    const documentSha256 = sha("d");
    const impact = buildPluginMarketplaceUpdateImpact({
      preflight: preflight(
        candidate({
          sbom: {
            format: "cyclonedx-json",
            url: "https://registry.example/artifacts/plugin.cdx.json",
            documentSha256,
          },
        }),
      ),
      installed: installed({
        source: {
          ...installed().source,
          catalogAuthority: {
            remoteArtifactEvidence: {
              evidenceDigest: sha("f"),
              sbom: { documentSha256 },
            },
          },
        },
        integrity: {
          signature: { verified: true, manifestSha256: sha("a") },
          sbom: { digest: documentSha256 },
        },
      }),
    });

    expect(impact.changes.integrity.sbomDigest).toMatchObject({
      from: null,
      to: null,
      status: "unknown",
      changed: false,
    });
    expect(impact.changes.integrity.sbomDocumentDigest).toMatchObject({
      from: documentSha256,
      to: documentSha256,
      status: "same",
      changed: false,
    });
  });

  it("compares payload digests only when both sides use the marketplace payload schema", () => {
    const payloadSha256 = sha("d");
    const impact = buildPluginMarketplaceUpdateImpact({
      preflight: preflight(candidate({ sbom: { digest: payloadSha256 } })),
      installed: installed({
        integrity: {
          signature: { verified: true, manifestSha256: sha("a") },
          sbom: {
            digest: sha("f"),
            payloadSha256,
            payloadSchema: "cc-plugin-marketplace-payload-sbom/v1",
          },
        },
      }),
    });

    expect(impact.changes.integrity.sbomDigest).toMatchObject({
      from: payloadSha256,
      to: payloadSha256,
      status: "same",
      changed: false,
    });
  });

  it("does not compare a payload digest labeled with another schema", () => {
    const payloadSha256 = sha("d");
    const impact = buildPluginMarketplaceUpdateImpact({
      preflight: preflight(candidate({ sbom: { digest: payloadSha256 } })),
      installed: installed({
        integrity: {
          signature: { verified: true, manifestSha256: sha("a") },
          sbom: {
            payloadSha256,
            payloadSchema: "cyclonedx-json",
          },
        },
      }),
    });

    expect(impact.changes.integrity.sbomDigest).toMatchObject({
      from: null,
      to: payloadSha256,
      status: "unknown",
      changed: false,
    });
  });

  it("preserves a same-format v2 semantic binding without a false SBOM change", () => {
    const payloadSha256 = sha("d");
    const impact = buildPluginMarketplaceUpdateImpact({
      preflight: preflight(
        candidate({
          sbom: {
            format: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
            digest: payloadSha256,
            url: "https://registry.example/artifacts/plugin.sbom.json",
            documentSha256: sha("e"),
          },
        }),
      ),
      installed: installed({
        integrity: {
          signature: { verified: true, manifestSha256: sha("a") },
          sbom: {
            payloadSha256,
            payloadSchema: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
            semanticPayloadFormat:
              PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
          },
        },
      }),
    });

    expect(impact.changes.integrity.sbomDigest).toMatchObject({
      status: "same",
      changed: false,
    });
    expect(impact.changes.integrity.semanticPayloadBinding).toEqual({
      from: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
      to: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
      kind: "same",
      changed: false,
      downgraded: false,
    });
    expect(impact.blockers).not.toContainEqual({
      code: "SEMANTIC_SBOM_BINDING_DOWNGRADE",
    });
  });

  it.each([
    {
      label: "an external format",
      sbom: {
        format: "cyclonedx-json",
        url: "https://registry.example/artifacts/plugin.cdx.json",
        documentSha256: sha("e"),
      },
      kind: "removed",
      to: null,
    },
    { label: "a missing declaration", sbom: null, kind: "removed", to: null },
    {
      label: "the weaker v1 format",
      sbom: {
        format: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
        url: "https://registry.example/artifacts/plugin.sbom.json",
        documentSha256: sha("e"),
      },
      kind: "weakened",
      to: PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
    },
  ])(
    "blocks replacing a v2 semantic binding with $label",
    ({ sbom, kind, to }) => {
      const impact = buildPluginMarketplaceUpdateImpact({
        preflight: preflight(candidate({ sbom })),
        installed: installed({
          integrity: {
            signature: { verified: true, manifestSha256: sha("a") },
            sbom: {
              payloadSha256: sha("d"),
              payloadSchema: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
              semanticPayloadFormat:
                PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
            },
          },
        }),
      });

      expect(impact.status).toBe("blocked");
      expect(impact.changes.integrity.semanticPayloadBinding).toMatchObject({
        from: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
        to,
        kind,
        changed: true,
        downgraded: true,
      });
      expect(impact.blockers).toContainEqual({
        code: "SEMANTIC_SBOM_BINDING_DOWNGRADE",
      });
    },
  );

  it("requires an explicit approval for a version downgrade", () => {
    const impact = buildPluginMarketplaceUpdateImpact({
      preflight: preflight(candidate({ version: "0.9.0" })),
      installed: installed(),
    });

    expect(impact.changes.version.kind).toBe("downgrade");
    expect(impact.requiredApprovals).toContainEqual({
      code: "VERSION_DOWNGRADE_APPROVAL_REQUIRED",
    });
  });

  it("requires a registry-declared version when updating an existing install", () => {
    const deferred = preflight(candidate({ version: undefined }));
    const updateImpact = buildPluginMarketplaceUpdateImpact({
      preflight: deferred,
      installed: installed(),
    });
    const newInstallImpact = buildPluginMarketplaceUpdateImpact({
      preflight: deferred,
      installed: null,
    });

    expect(updateImpact.status).toBe("blocked");
    expect(updateImpact.changes.version.kind).toBe(
      "candidate-version-deferred",
    );
    expect(updateImpact.blockers).toContainEqual({
      code: "REGISTRY_VERSION_REQUIRED_FOR_UPDATE",
    });
    expect(newInstallImpact.blockers).not.toContainEqual({
      code: "REGISTRY_VERSION_REQUIRED_FOR_UPDATE",
    });
  });

  it("is deterministic across observation times and propagates preflight blockers", () => {
    const blocked = preflight(
      candidate({ dependencies: { missing: "^9.0.0" } }),
    );
    const first = buildPluginMarketplaceUpdateImpact({
      preflight: blocked,
      installed: installed(),
      observedAt: "2026-08-15T01:00:00.000Z",
    });
    const second = buildPluginMarketplaceUpdateImpact({
      preflight: blocked,
      installed: installed(),
      observedAt: "2026-08-16T01:00:00.000Z",
    });

    expect(first.status).toBe("blocked");
    expect(first.blockers.map((item) => item.code)).toContain(
      "MISSING_DEPENDENCY",
    );
    expect(first.impactDigest).toBe(second.impactDigest);
  });
});
