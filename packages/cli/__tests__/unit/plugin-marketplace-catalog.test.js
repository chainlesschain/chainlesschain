import { describe, expect, it } from "vitest";
import {
  MAX_MARKETPLACE_CATALOG_SOURCES,
  MAX_MARKETPLACE_DEPENDENCIES_PER_CANDIDATE,
  PLUGIN_MARKETPLACE_CANDIDATE_SELECTION_SCHEMA,
  PLUGIN_MARKETPLACE_CATALOG_SCHEMA,
  PLUGIN_MARKETPLACE_INSTALL_PREFLIGHT_SCHEMA,
  buildPluginMarketplaceCandidateSelection,
  buildPluginMarketplaceCatalog,
  buildPluginMarketplaceInstallPreflight,
  buildPluginMarketplaceInstallPreflightFromSelection,
} from "../../src/lib/plugin-runtime/marketplace-catalog.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const KEY_SHA = "c".repeat(64);

function governedEntry(overrides = {}) {
  return {
    name: "acme-linter",
    version: "2.1.0",
    description: "A governed linter",
    source: "https://git.example/acme/linter.git",
    ref: "v2.1.0",
    sha256: SHA_A,
    signature: {
      algorithm: "ed25519",
      keyId: "org-release-2026",
      publicKeySha256: KEY_SHA,
    },
    sbom: {
      format: "cyclonedx-json",
      digest: SHA_B,
      url: "https://registry.example/sbom/acme.json?token=secret",
    },
    license: "Apache-2.0",
    permissions: {
      process: true,
      network: ["api.example"],
      credential: ["ACME_TOKEN"],
    },
    dependencies: { "shared-tools": "^1.0.0" },
    compatibility: { cc: ">=0.163.0 <0.200.0" },
    health: { status: "healthy", checkedAt: "2026-08-15T00:00:00Z" },
    ...overrides,
  };
}

describe("plugin marketplace catalog governance projection", () => {
  it("derives a pre-clone install authority and defers only a legacy missing version", () => {
    const { preflight } = buildPluginMarketplaceInstallPreflight({
      registryUrl: "https://registry.example/index.json",
      entry: governedEntry({ version: undefined, dependencies: {} }),
      hostVersion: "0.163.8",
      observedAt: "2026-08-15T00:00:00.000Z",
    });

    expect(preflight).toMatchObject({
      schemaVersion: PLUGIN_MARKETPLACE_INSTALL_PREFLIGHT_SCHEMA,
      status: "allowed",
      versionAuthority: "deferred-to-plugin-manifest",
      blockers: [],
      deferred: [{ code: "INVALID_VERSION" }],
      claims: {
        registryMetadataVerified: false,
        pluginBytesFetched: false,
        pluginCodeExecuted: false,
      },
    });
    expect(preflight.catalogDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(preflight.candidateDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(preflight.contentDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("blocks a registry install before clone on dependency and host failures", () => {
    const { preflight } = buildPluginMarketplaceInstallPreflight({
      registryUrl: "https://registry.example/index.json",
      entry: governedEntry({
        dependencies: { missing: "^2.0.0" },
        compatibility: { cc: ">=9.0.0" },
      }),
      installed: {},
      hostVersion: "0.163.8",
    });

    expect(preflight.status).toBe("blocked");
    expect(preflight.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(["MISSING_DEPENDENCY", "HOST_INCOMPATIBLE"]),
    );
  });

  it("projects every governed field without claiming registry assertions are verified", () => {
    const catalog = buildPluginMarketplaceCatalog({
      sources: [
        {
          url: "https://registry.example/index.json?token=secret",
          registry: { name: "acme", plugins: [governedEntry()] },
        },
      ],
      installed: { "shared-tools": "1.4.0" },
      hostVersion: "0.163.8",
      generatedAt: "2026-08-15T00:00:00.000Z",
    });

    expect(catalog.schemaVersion).toBe(PLUGIN_MARKETPLACE_CATALOG_SCHEMA);
    expect(catalog.sources[0].url).toBe("https://registry.example/index.json");
    expect(catalog.claims).toEqual({
      registryMetadataVerified: false,
      pluginBytesFetched: false,
      pluginCodeExecuted: false,
      signatureVerificationStage: "install/load",
    });
    const candidate = catalog.candidates[0];
    expect(candidate.integrity.digest).toMatchObject({
      status: "declared",
      value: SHA_A,
      authority: "registry-declared",
    });
    expect(candidate.integrity.signature).toMatchObject({
      status: "declared",
      verification: "not-verified-at-catalog-time",
      publicKeySha256: KEY_SHA,
    });
    expect(candidate.integrity.sbom).toMatchObject({
      status: "declared",
      digest: SHA_B,
      url: "https://registry.example/sbom/acme.json",
    });
    expect(candidate.license).toMatchObject({
      status: "declared",
      expression: "Apache-2.0",
    });
    expect(candidate.capabilities.declared).toBe(true);
    expect(candidate.capabilities.summary).toContain("credential: ACME_TOKEN");
    expect(candidate.compatibility.status).toBe("compatible");
    expect(candidate.dependencies.status).toBe("satisfied");
    expect(candidate.health.status).toBe("healthy");
    expect(candidate.governance).toMatchObject({
      status: "complete",
      missing: [],
      metadataAuthority: "unverified-registry-assertion",
    });
    expect(candidate.installability).toEqual({
      status: "allowed",
      blockers: [],
    });
    expect(candidate.candidateDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(candidate.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(catalog.dependencyGraph.edges).toHaveLength(1);
    expect(catalog.dependencyGraph.edges[0]).toMatchObject({
      dependency: "shared-tools",
      range: "^1.0.0",
      status: "installed-satisfied",
    });
    expect(catalog.dependencyGraph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "installed",
          name: "shared-tools",
          version: "1.4.0",
        }),
      ]),
    );
  });

  it("has a stable authority digest independent of observation time", () => {
    const input = {
      sources: [
        {
          url: "https://registry.example/index.json",
          registry: { plugins: [governedEntry()] },
        },
      ],
      installed: { "shared-tools": "1.4.0" },
      hostVersion: "0.163.8",
    };
    const first = buildPluginMarketplaceCatalog({
      ...input,
      generatedAt: "2026-08-15T00:00:00.000Z",
    });
    const second = buildPluginMarketplaceCatalog({
      ...input,
      generatedAt: "2026-08-16T00:00:00.000Z",
    });
    expect(first.catalogDigest).toBe(second.catalogDigest);
    expect(first.candidates[0].candidateDigest).toBe(
      second.candidates[0].candidateDigest,
    );
  });

  it("selects the highest version across registries and binds it to install preflight", () => {
    const catalog = buildPluginMarketplaceCatalog({
      sources: [
        {
          url: "https://priority.example/index.json",
          registry: {
            plugins: [governedEntry({ version: "2.2.0", dependencies: {} })],
          },
        },
        {
          url: "https://newer.example/index.json",
          registry: {
            plugins: [governedEntry({ version: "3.0.0", dependencies: {} })],
          },
        },
      ],
      hostVersion: "0.163.8",
    });
    const selection = buildPluginMarketplaceCandidateSelection({
      catalog,
      name: "acme-linter",
      observedAt: "2026-08-15T00:00:00.000Z",
    });

    expect(selection).toMatchObject({
      schemaVersion: PLUGIN_MARKETPLACE_CANDIDATE_SELECTION_SCHEMA,
      status: "allowed",
      sourceCount: 2,
      candidateCount: 2,
      selected: {
        version: "3.0.0",
        registry: { priority: 1 },
      },
      blockers: [],
      claims: {
        unavailableRequestedSourcesIgnored: false,
        lowerRankedFallbackAllowed: false,
      },
    });
    expect(selection.selected.registry.entryIndex).toBe(0);
    expect(selection.selectionDigest).toMatch(/^[a-f0-9]{64}$/);

    const { preflight } = buildPluginMarketplaceInstallPreflightFromSelection({
      catalog,
      selection,
    });
    expect(preflight).toMatchObject({
      status: "allowed",
      catalogDigest: catalog.catalogDigest,
      selectionSchemaVersion: PLUGIN_MARKETPLACE_CANDIDATE_SELECTION_SCHEMA,
      selectionDigest: selection.selectionDigest,
      selectionSourceCount: 2,
      registryVersion: "3.0.0",
    });
  });

  it("keeps selection digests stable and uses source priority only for equivalent version ties", () => {
    const input = {
      sources: [
        {
          url: "https://one.example/index.json",
          registry: {
            plugins: [governedEntry({ dependencies: {} })],
          },
        },
        {
          url: "https://two.example/index.json",
          registry: {
            plugins: [governedEntry({ dependencies: {} })],
          },
        },
      ],
      hostVersion: "0.163.8",
    };
    const firstCatalog = buildPluginMarketplaceCatalog({
      ...input,
      generatedAt: "2026-08-15T00:00:00.000Z",
    });
    const secondCatalog = buildPluginMarketplaceCatalog({
      ...input,
      generatedAt: "2026-08-16T00:00:00.000Z",
    });
    const first = buildPluginMarketplaceCandidateSelection({
      catalog: firstCatalog,
      name: "acme-linter",
      observedAt: "2026-08-15T00:00:00.000Z",
    });
    const second = buildPluginMarketplaceCandidateSelection({
      catalog: secondCatalog,
      name: "acme-linter",
      observedAt: "2026-08-16T00:00:00.000Z",
    });

    expect(first.status).toBe("allowed");
    expect(first.selected.registry.priority).toBe(0);
    expect(first.selectionDigest).toBe(second.selectionDigest);
  });

  it("fails closed instead of ignoring unavailable sources or falling back from a blocked highest version", () => {
    const catalog = buildPluginMarketplaceCatalog({
      sources: [
        {
          url: "https://older.example/index.json",
          registry: {
            plugins: [governedEntry({ version: "2.0.0", dependencies: {} })],
          },
        },
        {
          url: "https://newer.example/index.json",
          registry: {
            plugins: [
              governedEntry({
                version: "3.0.0",
                dependencies: { missing: "^1.0.0" },
              }),
            ],
          },
        },
        {
          url: "https://offline.example/index.json",
          error: { code: "REGISTRY_FETCH_FAILED", message: "token=secret" },
        },
      ],
      hostVersion: "0.163.8",
    });
    const selection = buildPluginMarketplaceCandidateSelection({
      catalog,
      name: "acme-linter",
    });

    expect(selection.status).toBe("blocked");
    expect(selection.selected.version).toBe("3.0.0");
    expect(selection.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(["MISSING_DEPENDENCY", "REGISTRY_SET_INCOMPLETE"]),
    );
    expect(selection.claims.lowerRankedFallbackAllowed).toBe(false);
  });

  it("fails source conflicts closed when the same version resolves differently", () => {
    const catalog = buildPluginMarketplaceCatalog({
      sources: [
        {
          url: "https://one.example/index.json",
          registry: { plugins: [governedEntry()] },
        },
        {
          url: "https://two.example/index.json",
          registry: {
            plugins: [
              governedEntry({
                source: "https://git.example/other/linter.git",
                sha256: SHA_B,
              }),
            ],
          },
        },
      ],
      installed: { "shared-tools": "1.4.0" },
      hostVersion: "0.163.8",
    });

    expect(catalog.summary.conflictCount).toBe(2);
    expect(catalog.candidates).toHaveLength(2);
    for (const candidate of catalog.candidates) {
      expect(candidate.conflict.code).toBe("SOURCE_CONFLICT");
      expect(candidate.installability.status).toBe("blocked");
      expect(candidate.installability.blockers).toContainEqual({
        code: "SOURCE_CONFLICT",
      });
    }
  });

  it("publishes catalog dependency targets and cycles as an explicit graph", () => {
    const catalog = buildPluginMarketplaceCatalog({
      sources: [
        {
          url: "https://registry.example/index.json",
          registry: {
            plugins: [
              governedEntry({
                name: "plugin-a",
                dependencies: { "plugin-b": "^1.0.0" },
              }),
              governedEntry({
                name: "plugin-b",
                version: "1.2.0",
                source: "https://git.example/acme/b.git",
                dependencies: { "plugin-a": "^2.0.0" },
              }),
            ],
          },
        },
      ],
      hostVersion: "0.163.8",
    });

    expect(catalog.dependencyGraph.edges).toHaveLength(2);
    expect(
      catalog.dependencyGraph.edges.every(
        (edge) => edge.status === "catalog-available",
      ),
    ).toBe(true);
    expect(catalog.dependencyGraph.cycles).toHaveLength(1);
    expect(catalog.dependencyGraph.cycles[0]).toHaveLength(2);
  });

  it("makes incomplete metadata and dependency/host problems explicit", () => {
    const catalog = buildPluginMarketplaceCatalog({
      sources: [
        {
          url: "https://registry.example/index.json",
          fromCache: true,
          registry: {
            plugins: [
              {
                name: "minimal",
                version: "1.0.0",
                source: "https://user:password@git.example/minimal.git",
                dependencies: { missing: "^2.0.0" },
                compatibility: { cc: ">=9.0.0" },
              },
            ],
          },
        },
      ],
      installed: {},
      hostVersion: "0.163.8",
      strict: true,
    });

    const candidate = catalog.candidates[0];
    expect(candidate.package.source).toBe("https://git.example/minimal.git");
    expect(candidate.health.status).toBe("cached");
    expect(candidate.governance.missing).toEqual([
      "digest",
      "signature",
      "sbom",
      "license",
      "capabilities",
    ]);
    expect(candidate.installability.status).toBe("blocked");
    expect(candidate.installability.blockers.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "SOURCE_CREDENTIALS_EMBEDDED",
        "MISSING_DEPENDENCY",
        "HOST_INCOMPATIBLE",
        "STRICT_GOVERNANCE_METADATA_REQUIRED",
      ]),
    );
  });

  it("isolates unavailable sources and redacts credential-bearing error URLs", () => {
    const catalog = buildPluginMarketplaceCatalog({
      sources: [
        {
          url: "https://user:pass@broken.example/index.json?token=secret",
          error: {
            code: "REGISTRY_FETCH_FAILED",
            message:
              "GET https://user:pass@broken.example/index.json?token=secret Bearer abc123 failed",
          },
        },
        {
          url: "https://healthy.example/index.json",
          registry: { plugins: [governedEntry()] },
        },
      ],
      installed: { "shared-tools": "1.4.0" },
      hostVersion: "0.163.8",
    });

    expect(catalog.summary.availableSourceCount).toBe(1);
    expect(catalog.summary.unavailableSourceCount).toBe(1);
    expect(catalog.sources[0].url).toBe("https://broken.example/index.json");
    expect(JSON.stringify(catalog.sources[0])).not.toContain("secret");
    expect(JSON.stringify(catalog.sources[0])).not.toContain("abc123");
    expect(JSON.stringify(catalog.sources[0])).not.toContain("user:pass");
    expect(catalog.candidates).toHaveLength(1);
  });

  it("bounds source/dependency fan-out and rejects duplicate source authority", () => {
    expect(() =>
      buildPluginMarketplaceCatalog({
        sources: Array.from(
          { length: MAX_MARKETPLACE_CATALOG_SOURCES + 1 },
          (_, index) => ({
            url: `https://registry-${index}.example/index.json`,
            registry: { plugins: [] },
          }),
        ),
      }),
    ).toThrow(/at most 16 sources/);

    const dependencies = Object.fromEntries(
      Array.from(
        { length: MAX_MARKETPLACE_DEPENDENCIES_PER_CANDIDATE + 1 },
        (_, index) => [`dep-${index}`, "^1.0.0"],
      ),
    );
    const catalog = buildPluginMarketplaceCatalog({
      sources: [
        {
          url: "https://registry.example/index.json?first=1",
          registry: {
            plugins: [governedEntry({ dependencies })],
          },
        },
        {
          url: "https://registry.example/index.json?second=2",
          registry: { plugins: [] },
        },
      ],
      hostVersion: "0.163.8",
    });

    expect(catalog.sources[1]).toMatchObject({
      status: "unavailable",
      error: { code: "DUPLICATE_REGISTRY_SOURCE" },
    });
    expect(catalog.candidates[0].dependencies.declared).toHaveProperty("dep-0");
    expect(
      Object.keys(catalog.candidates[0].dependencies.declared),
    ).toHaveLength(MAX_MARKETPLACE_DEPENDENCIES_PER_CANDIDATE);
    expect(catalog.candidates[0].installability.blockers).toContainEqual({
      code: "DEPENDENCY_LIMIT_EXCEEDED",
    });
  });
});
