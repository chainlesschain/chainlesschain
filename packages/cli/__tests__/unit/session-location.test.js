import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import {
  SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA,
  projectCurrentExecutionLocation,
  projectExecutionLocationComparison,
  projectExecutionLocationHandoff,
  projectSessionExecutionLocation,
} from "../../src/commands/session-location.js";
import {
  EXECUTION_LOCATION_HANDOFF_FACTS_SCHEMA,
  createExecutionLocationBinding,
} from "../../src/lib/execution-location-contract.js";

const DIGEST = `sha256:${"c".repeat(64)}`;
const VALID_FACTS_FIXTURE = fileURLToPath(
  new URL(
    "../fixtures/execution-location-handoff-facts-valid.json",
    import.meta.url,
  ),
);
const BINDING = createExecutionLocationBinding({
  location: "local",
  observed: true,
  observedAt: "2026-08-15T00:00:00.000Z",
  source: {
    cwd: "/repo",
    git: { root: "/repo", head: "refs/heads/main", commit: "d".repeat(40) },
  },
  runtime: {
    platform: "linux",
    arch: "x64",
    nodeVersion: "v22.12.0",
    tools: ["node"],
  },
  policy: {
    network: "restricted",
    sandbox: "strong",
    dataBoundary: { kind: "repository", root: "/repo" },
  },
});

const AUTHORITY = Object.freeze({
  sessionId: "session-1",
  headHash: "e".repeat(64),
  eventCount: 4,
  binding: BINDING,
});

describe("session execution-location projections", () => {
  it("distinguishes current observation from verified session authority", () => {
    expect(
      projectCurrentExecutionLocation(
        {},
        { captureAmbientExecutionLocation: () => BINDING },
      ),
    ).toMatchObject({
      schema: SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA,
      authority: "current-process-observation",
      binding: BINDING,
    });

    expect(
      projectSessionExecutionLocation("session-1", {
        getVerifiedSessionExecutionLocationAuthority: () => AUTHORITY,
      }),
    ).toMatchObject({
      authority: "verified-session-start",
      sessionId: "session-1",
      headHash: AUTHORITY.headHash,
      eventCount: 4,
      binding: BINDING,
    });
  });

  it("builds comparison and handoff projections from injected authorities", () => {
    const deps = {
      captureAmbientExecutionLocation: () => BINDING,
      getVerifiedSessionExecutionLocationAuthority: () => AUTHORITY,
      readHandoffFacts: () => ({
        schema: EXECUTION_LOCATION_HANDOFF_FACTS_SCHEMA,
        authority: {
          sessionId: AUTHORITY.sessionId,
          headHash: AUTHORITY.headHash,
          eventCount: AUTHORITY.eventCount,
        },
        target: {
          configured: true,
          evidenceId: "ssh-attestation-1",
          networkPolicy: "restricted",
          sandboxStrength: "strong",
          dataBoundary: { kind: "declared", root: "/srv/repo" },
          capabilities: ["node"],
        },
        git: { status: "clean", baseCommit: "d".repeat(40) },
        strategy: { kind: "commit", ref: "d".repeat(40) },
        summary: { included: true, digest: DIGEST },
        permissions: { included: true, digest: DIGEST },
        artifacts: [],
        credentials: [],
        requiredCapabilities: ["node"],
      }),
    };

    expect(projectExecutionLocationComparison({}, deps).currentLocation).toBe(
      "local",
    );
    expect(
      projectExecutionLocationHandoff("session-1", "ssh", "facts.json", deps),
    ).toMatchObject({
      allowed: true,
      session: { sessionId: "session-1", headHash: AUTHORITY.headHash },
      target: { location: "ssh" },
    });
  });

  it("reads a bounded, regular handoff facts fixture through the real reader", () => {
    const preview = projectExecutionLocationHandoff(
      "session-1",
      "ssh",
      VALID_FACTS_FIXTURE,
      {
        getVerifiedSessionExecutionLocationAuthority: () => AUTHORITY,
      },
    );

    expect(preview).toMatchObject({
      allowed: true,
      target: { evidenceId: "ssh-attestation-fixture-1" },
      transfer: { credentialValuesTransferred: false },
    });
  });
});
