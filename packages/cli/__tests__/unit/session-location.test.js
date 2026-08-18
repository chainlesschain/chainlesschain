import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import {
  SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA,
  createSessionExecutionLocationResultBundle,
  projectCurrentExecutionLocation,
  projectExecutionLocationComparison,
  projectExecutionLocationHandoff,
  projectSessionExecutionLocation,
  verifySessionExecutionLocationResultBundle,
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
  it("routes result bundle creation and verification through exact session authorities", () => {
    const handoffAuthority = {
      ...AUTHORITY,
      authority: "verified-session-location-handoff",
      bindingEventHash: "b".repeat(64),
      bindingEventCount: 3,
      locationHandoff: {
        handoffId: `sha256:${"4".repeat(64)}`,
        source: {
          sessionId: AUTHORITY.sessionId,
          headHash: "a".repeat(64),
          eventCount: 2,
        },
      },
    };
    const reads = [];
    const created = { schema: "cc-execution-location-result-bundle/v1" };
    expect(
      createSessionExecutionLocationResultBundle(
        "session-1",
        {
          resultId: "result-1",
          summary: "/repo/summary.txt",
          diff: "/repo/result.diff",
          artifact: ["application/json=/repo/artifact.json"],
          evidence: ["text/plain=/repo/evidence.txt"],
        },
        {
          getVerifiedSessionExecutionLocationAuthority: () => handoffAuthority,
          readExecutionLocationResultFile: (filePath, options) => {
            reads.push({ filePath, options });
            return Buffer.from(filePath);
          },
          createExecutionLocationResultBundle: (input) => {
            expect(input).toMatchObject({
              sessionAuthority: expect.objectContaining({
                sessionId: "session-1",
                locationHandoff: handoffAuthority.locationHandoff,
              }),
              resultId: "result-1",
              artifacts: [{ mediaType: "application/json" }],
              evidence: [{ mediaType: "text/plain" }],
            });
            return created;
          },
        },
      ),
    ).toBe(created);
    expect(reads).toHaveLength(4);
    expect(reads.every((entry) => entry.options.boundaryRoot === "/repo")).toBe(
      true,
    );

    const verification = {
      schema: "cc-execution-location-result-verification/v1",
    };
    const sourceAuthority = { ...AUTHORITY, authority: "verified-session-start" };
    expect(
      verifySessionExecutionLocationResultBundle(
        "session-1",
        "/repo/bundle.json",
        `sha256:${"4".repeat(64)}`,
        {
          getVerifiedSessionExecutionLocationAuthority: () => sourceAuthority,
          readExecutionLocationResultBundle: (filePath, options) => {
            expect(filePath).toBe("/repo/bundle.json");
            expect(options.boundaryRoot).toBe("/repo");
            return { bundleDigest: DIGEST };
          },
          verifyExecutionLocationResultBundle: (input) => {
            expect(input).toEqual({
              bundle: { bundleDigest: DIGEST },
              sourceAuthority: expect.objectContaining({
                sessionId: "session-1",
                headHash: AUTHORITY.headHash,
                eventCount: 4,
              }),
              expectedHandoffId: `sha256:${"4".repeat(64)}`,
            });
            return verification;
          },
        },
      ),
    ).toBe(verification);
  });

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
