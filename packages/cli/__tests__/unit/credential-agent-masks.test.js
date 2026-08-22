import { describe, expect, it, vi } from "vitest";
import {
  CredentialAgent,
  extractCredentialMasks,
} from "../../src/lib/process-execution-broker/credential-agent.js";

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTQyIiwiZXhwIjoxNzAwMDAwMDAwLCJwcm9qZWN0IjoicHJpdmF0ZSJ9.signature-that-is-long-enough";
const AWS_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
const AWS_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const SIGV4_SIGNATURE =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("CredentialAgent structured credential masks", () => {
  it("redacts JWTs while retaining only a bounded claim-name projection", () => {
    const result = extractCredentialMasks(`token=${JWT}`);

    expect(result.sanitized).not.toContain(JWT);
    expect(result.masks).toEqual([
      {
        kind: "jwt",
        claimKeys: ["exp", "project", "sub"],
        algorithm: "HS256",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("user-42");
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("reports a no-match extraction without revealing input text", () => {
    const onExtractNoMatch = vi.fn();
    const result = extractCredentialMasks("ordinary command --flag", {
      onExtractNoMatch,
    });

    expect(result).toEqual({ sanitized: "ordinary command --flag", masks: [] });
    expect(onExtractNoMatch).toHaveBeenCalledWith({
      reason: "no_match",
      inputLength: "ordinary command --flag".length,
    });
    expect(JSON.stringify(onExtractNoMatch.mock.calls)).not.toContain(
      "ordinary command",
    );
  });

  it("masks AWS key pairs and SigV4 credentials without exposing either secret", () => {
    const pair = extractCredentialMasks(
      `AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY} AWS_SECRET_ACCESS_KEY=${AWS_SECRET}`,
    );
    expect(pair.sanitized).not.toContain(AWS_ACCESS_KEY);
    expect(pair.sanitized).not.toContain(AWS_SECRET);
    expect(pair.masks.map((mask) => mask.kind)).toEqual([
      "aws_access_key_id",
      "aws_secret_access_key",
      "aws_credential_pair",
    ]);

    const sigv4 = `Authorization: AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY}/20260822/us-east-1/execute-api/aws4_request, SignedHeaders=host;x-amz-date, Signature=${SIGV4_SIGNATURE}`;
    const agent = new CredentialAgent({ env: { CC_CRED_AGENT_DISABLE: "1" } });
    const sanitized = agent.sanitizeArgs(["-H", sigv4]);

    expect(sanitized.sanitizedArgs.join("\n")).not.toContain(AWS_ACCESS_KEY);
    expect(sanitized.sanitizedArgs.join("\n")).not.toContain(SIGV4_SIGNATURE);
    expect(sanitized.redacted[0]).toMatchObject({
      index: 1,
      pattern: "header-structured-secret",
      masks: expect.arrayContaining([
        expect.objectContaining({ kind: "aws_sigv4_credential" }),
        expect.objectContaining({ kind: "aws_sigv4_signature" }),
      ]),
    });
    expect(JSON.stringify(sanitized)).not.toContain(AWS_ACCESS_KEY);
    expect(JSON.stringify(sanitized)).not.toContain(SIGV4_SIGNATURE);
  });
});
