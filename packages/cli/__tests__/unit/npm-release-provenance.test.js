import { describe, expect, it } from "vitest";
import {
  NPM_RELEASE_AUTHORITY,
  verifyNpmReleaseProvenance,
} from "../../scripts/verify-npm-release-provenance.mjs";

const VERSION = "1.2.3";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const REF = "refs/tags/v-npm-1-2-3";
const SHA512 = "ab".repeat(64);

function statement() {
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        name: `pkg:npm/chainlesschain@${VERSION}`,
        digest: { sha512: SHA512 },
      },
    ],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType:
          "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            ref: REF,
            repository: NPM_RELEASE_AUTHORITY.repository,
            path: NPM_RELEASE_AUTHORITY.workflow,
          },
        },
        internalParameters: { github: { event_name: "push" } },
        resolvedDependencies: [
          {
            uri: `git+${NPM_RELEASE_AUTHORITY.repository}@${REF}`,
            digest: { gitCommit: COMMIT },
          },
        ],
      },
      runDetails: {
        builder: { id: NPM_RELEASE_AUTHORITY.builder },
        metadata: {
          invocationId: `${NPM_RELEASE_AUTHORITY.repository}/actions/runs/123456/attempts/2`,
        },
      },
    },
  };
}

function audit(payload = statement()) {
  return {
    invalid: [],
    missing: [],
    verified: [
      {
        name: "chainlesschain",
        version: VERSION,
        registry: NPM_RELEASE_AUTHORITY.registry,
        attestationBundles: [
          {
            predicateType: "https://slsa.dev/provenance/v1",
            bundle: {
              mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
              dsseEnvelope: {
                payloadType: "application/vnd.in-toto+json",
                payload: Buffer.from(JSON.stringify(payload)).toString(
                  "base64",
                ),
                signatures: [{ sig: "verified-by-npm", keyid: "" }],
              },
            },
          },
        ],
      },
    ],
  };
}

function verify(value) {
  return verifyNpmReleaseProvenance(value, {
    version: VERSION,
    commit: COMMIT,
    ref: REF,
    sha512: SHA512,
  });
}

describe("verified npm release provenance", () => {
  it("binds npm's verified SLSA bundle to the exact release authority", () => {
    expect(verify(audit())).toMatchObject({
      package: "chainlesschain",
      version: VERSION,
      commit: COMMIT,
      ref: REF,
      sha512: SHA512,
      runId: 123456,
      attempt: 2,
      verifier: "npm audit signatures --include-attestations",
      audit: { invalid: 0, missing: 0 },
    });
  });

  it.each([
    [
      "package digest",
      (value) => (value.subject[0].digest.sha512 = "cd".repeat(64)),
      /sha512 mismatch/,
    ],
    [
      "workflow ref",
      (value) =>
        (value.predicate.buildDefinition.externalParameters.workflow.ref =
          "refs/tags/other"),
      /workflow ref mismatch/,
    ],
    [
      "workflow path",
      (value) =>
        (value.predicate.buildDefinition.externalParameters.workflow.path =
          ".github/workflows/other.yml"),
      /workflow path mismatch/,
    ],
    [
      "repository",
      (value) =>
        (value.predicate.buildDefinition.externalParameters.workflow.repository =
          "https://github.com/attacker/repo"),
      /workflow repository mismatch/,
    ],
    [
      "source commit",
      (value) =>
        (value.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit =
          "f".repeat(40)),
      /source Git commit mismatch/,
    ],
    [
      "source ref",
      (value) =>
        (value.predicate.buildDefinition.resolvedDependencies[0].uri =
          "git+https://github.com/chainlesschain/chainlesschain@refs/heads/main"),
      /source repository ref mismatch/,
    ],
    [
      "builder",
      (value) =>
        (value.predicate.runDetails.builder.id =
          "https://example.invalid/runner"),
      /SLSA builder mismatch/,
    ],
    [
      "invocation",
      (value) =>
        (value.predicate.runDetails.metadata.invocationId =
          "https://github.com/attacker/repo/actions/runs/1/attempts/1"),
      /invocation id is outside/,
    ],
  ])("rejects a mismatched %s", (_name, mutate, message) => {
    const payload = statement();
    mutate(payload);
    expect(() => verify(audit(payload))).toThrow(message);
  });

  it("rejects target attestations that npm did not verify", () => {
    const value = audit();
    value.verified = [];
    value.missing = [{ name: "chainlesschain", version: VERSION }];
    expect(() => verify(value)).toThrow(/has no verified npm attestation/);
  });

  it("fails closed when npm reports any invalid package signature", () => {
    const value = audit();
    value.invalid = [{ name: "dependency", version: "9.9.9" }];
    expect(() => verify(value)).toThrow(/invalid package signatures/);
  });

  it("rejects malformed DSSE payloads before parsing provenance", () => {
    const value = audit();
    value.verified[0].attestationBundles[0].bundle.dsseEnvelope.payload = "%%%";
    expect(() => verify(value)).toThrow(/canonical base64/);
  });
});
