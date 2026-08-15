import { describe, expect, it } from "vitest";
import { buildPluginMarketplaceInstallPreflight } from "../../src/lib/plugin-runtime/marketplace-catalog.js";
import {
  PLUGIN_MARKETPLACE_UPDATE_IMPACT_SCHEMA,
  buildPluginMarketplaceUpdateImpact,
} from "../../src/lib/plugin-runtime/marketplace-impact.js";

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
      sbom: { digest: sha("e") },
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
