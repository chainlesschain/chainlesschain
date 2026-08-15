import { describe, expect, it } from "vitest";
import {
  EXECUTION_LOCATION_BINDING_SCHEMA,
  EXECUTION_LOCATION_CATALOG_SCHEMA,
  EXECUTION_LOCATION_HANDOFF_FACTS_SCHEMA,
  EXECUTION_LOCATION_HANDOFF_SCHEMA,
  buildExecutionLocationCatalog,
  buildExecutionLocationHandoffPreview,
  createExecutionLocationBinding,
  normalizeExecutionLocationBinding,
} from "../../src/lib/execution-location-contract.js";
import { captureAmbientExecutionLocation } from "../../src/lib/execution-location-runtime.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const SESSION_AUTHORITY = Object.freeze({
  sessionId: "session-contract-1",
  headHash: "f".repeat(64),
  eventCount: 7,
});

function binding(overrides = {}) {
  return createExecutionLocationBinding({
    location: "local",
    observedAt: "2026-08-15T00:00:00.000Z",
    observed: true,
    source: {
      cwd: "/work/app",
      git: {
        root: "/work/app",
        head: "refs/heads/feature/location",
        commit: "b".repeat(40),
      },
    },
    runtime: {
      platform: "linux",
      arch: "x64",
      nodeVersion: "v22.12.0",
      tools: ["node", "git", "chainlesschain-cli"],
    },
    model: { provider: "test", name: "model", credentialSource: "env" },
    permissions: { status: "declared", file: "write", shell: true },
    policy: {
      network: "restricted",
      sandbox: "strong",
      dataBoundary: { kind: "repository", root: "/work/app" },
    },
    ...overrides,
  });
}

describe("execution-location binding and catalog", () => {
  it("creates a versioned, normalized session binding", () => {
    const result = binding();

    expect(result.schema).toBe(EXECUTION_LOCATION_BINDING_SCHEMA);
    expect(result.runtime.tools).toEqual(["chainlesschain-cli", "git", "node"]);
    expect(result.permissions).toMatchObject({
      status: "declared",
      file: "write",
      shell: true,
      network: false,
    });
    expect(result.controlPlane.remoteControl).toBe(
      "controls-local-execution-only",
    );
  });

  it("drops unknown fields but rejects any secret-bearing value", () => {
    expect(() =>
      createExecutionLocationBinding({
        location: "ssh",
        credentials: [
          { name: "GH_TOKEN", source: "env", scope: "repo", value: "secret" },
        ],
      }),
    ).toThrow(/secret material|credential values/);

    expect(
      normalizeExecutionLocationBinding({
        ...binding(),
        ignored: "not persisted",
      }),
    ).not.toHaveProperty("ignored");
  });

  it("compares current facts with conservative, unconfigured targets", () => {
    const catalog = buildExecutionLocationCatalog(binding());

    expect(catalog.schema).toBe(EXECUTION_LOCATION_CATALOG_SCHEMA);
    expect(
      catalog.locations.find((entry) => entry.location === "local"),
    ).toMatchObject({
      availability: "current",
      capabilities: { launch: "available", resume: "available" },
    });
    expect(
      catalog.locations.find((entry) => entry.location === "ssh"),
    ).toMatchObject({
      availability: "requires-configuration",
      capabilities: {
        launch: "requires-configuration",
        resume: "requires-configuration",
      },
      policy: { network: "unknown", sandbox: "unknown" },
    });
    expect(
      catalog.locations.find((entry) => entry.location === "container"),
    ).toMatchObject({
      extension: "chainlesschain",
    });
    expect(
      catalog.locations.find((entry) => entry.location === "wsl"),
    ).toMatchObject({
      availability: "unavailable",
      capabilities: {
        launch: "not-implemented",
        resume: "not-implemented",
      },
    });
    expect(catalog.controlPlane.remoteControl.executionLocation).toBe(false);
  });
});

describe("execution-location handoff preview", () => {
  it("fails closed without target, Git, summary, permission, and capability evidence", () => {
    const preview = buildExecutionLocationHandoffPreview({
      sourceBinding: binding(),
      sourceAuthority: SESSION_AUTHORITY,
      target: "ssh",
      facts: { schema: EXECUTION_LOCATION_HANDOFF_FACTS_SCHEMA },
    });

    expect(preview.schema).toBe(EXECUTION_LOCATION_HANDOFF_SCHEMA);
    expect(preview.allowed).toBe(false);
    expect(preview.blockers).toEqual(
      expect.arrayContaining([
        "target-configuration-evidence-missing",
        "target-network-policy-unknown",
        "target-sandbox-strength-unknown",
        "target-data-boundary-unknown",
        "git-state-unknown",
        "session-summary-missing",
        "permission-handoff-missing",
      ]),
    );
  });

  it("allows an evidenced patch handoff while transferring credential references only", () => {
    const preview = buildExecutionLocationHandoffPreview({
      sourceBinding: binding(),
      sourceAuthority: SESSION_AUTHORITY,
      target: "ssh",
      facts: {
        schema: EXECUTION_LOCATION_HANDOFF_FACTS_SCHEMA,
        authority: SESSION_AUTHORITY,
        target: {
          configured: true,
          evidenceId: "ssh-host-attestation-2026-08-15",
          networkPolicy: "restricted",
          sandboxStrength: "strong",
          dataBoundary: { kind: "declared", root: "/srv/app" },
          capabilities: ["git", "node"],
        },
        git: { status: "dirty", baseCommit: "b".repeat(40) },
        strategy: { kind: "patch", artifactDigest: DIGEST },
        summary: { included: true, digest: DIGEST },
        permissions: { included: true, digest: DIGEST },
        artifacts: [{ name: "working-tree.patch", digest: DIGEST }],
        credentials: [{ name: "GH_TOKEN", source: "env", scope: "repo:read" }],
        requiredCapabilities: ["git", "node"],
      },
    });

    expect(preview.allowed).toBe(true);
    expect(preview.blockers).toEqual([]);
    expect(preview.transfer.credentialRefs).toEqual([
      { name: "GH_TOKEN", source: "env", scope: "repo:read" },
    ]);
    expect(preview.transfer.credentialValuesTransferred).toBe(false);
    expect(JSON.stringify(preview)).not.toContain("credential value");
  });

  it("blocks credential values and missing target capabilities", () => {
    const preview = buildExecutionLocationHandoffPreview({
      sourceBinding: binding(),
      sourceAuthority: SESSION_AUTHORITY,
      target: "cloud",
      facts: {
        schema: EXECUTION_LOCATION_HANDOFF_FACTS_SCHEMA,
        authority: SESSION_AUTHORITY,
        target: {
          configured: true,
          evidenceId: "cloud-attestation-1",
          networkPolicy: "restricted",
          sandboxStrength: "partial",
          dataBoundary: { kind: "declared", root: "/workspace" },
          capabilities: ["git"],
        },
        git: { status: "clean", baseCommit: "b".repeat(40) },
        strategy: { kind: "commit", ref: "b".repeat(40) },
        summary: { included: true, digest: DIGEST },
        permissions: { included: true, digest: DIGEST },
        artifacts: [],
        credentials: [{ name: "CLOUD", token: "must-not-leak" }],
        requiredCapabilities: ["node"],
      },
    });

    expect(preview.allowed).toBe(false);
    expect(preview.blockers).toContain("credential-value-present");
    expect(preview.blockers).toContain("target-capability-unavailable:node");
    expect(JSON.stringify(preview)).not.toContain("must-not-leak");
  });

  it("blocks stale handoff facts after the verified session head advances", () => {
    const preview = buildExecutionLocationHandoffPreview({
      sourceBinding: binding(),
      sourceAuthority: SESSION_AUTHORITY,
      target: "ssh",
      facts: {
        schema: EXECUTION_LOCATION_HANDOFF_FACTS_SCHEMA,
        authority: { ...SESSION_AUTHORITY, eventCount: 6 },
        target: {
          configured: true,
          evidenceId: "ssh-host-attestation-1",
          networkPolicy: "restricted",
          sandboxStrength: "strong",
          dataBoundary: { kind: "declared", root: "/srv/app" },
          capabilities: [],
        },
        git: { status: "clean", baseCommit: "b".repeat(40) },
        strategy: { kind: "commit", ref: "b".repeat(40) },
        summary: { included: true, digest: DIGEST },
        permissions: { included: true, digest: DIGEST },
        artifacts: [],
        credentials: [],
        requiredCapabilities: [],
      },
    });

    expect(preview.allowed).toBe(false);
    expect(preview.blockers).toContain("session-authority-evidence-mismatch");
  });
});

describe("ambient execution-location capture", () => {
  it("records signal names, never environment values", () => {
    const unavailableFs = {
      existsSync: () => false,
      lstatSync: () => {
        throw new Error("missing");
      },
    };
    const result = captureAmbientExecutionLocation(
      { provider: "test", model: "model" },
      {
        fs: unavailableFs,
        env: { WSL_DISTRO_NAME: "private-distro-name" },
        cwd: () => "/workspace",
        platform: "linux",
        arch: "x64",
        nodeVersion: "v22.12.0",
        now: () => "2026-08-15T00:00:00.000Z",
      },
    );

    expect(result.location).toBe("wsl");
    expect(result.signals).toEqual(["WSL_DISTRO_NAME"]);
    expect(JSON.stringify(result)).not.toContain("private-distro-name");
  });
});
