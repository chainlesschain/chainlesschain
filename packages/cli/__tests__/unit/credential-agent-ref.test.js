import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_ERROR_CODES,
  CredentialAgent,
} from "../../src/lib/process-execution-broker/credential-agent.js";

function thrownCode(action) {
  try {
    action();
  } catch (error) {
    return error.code;
  }
  throw new Error("Expected action to throw");
}

function resolutionContext(agent, process, host = null) {
  return {
    agentId: agent.getInfo().agentId,
    process,
    host,
  };
}

describe("CredentialAgent reference lifecycle", () => {
  it("keeps filtering fail-closed when CC_CRED_AGENT_DISABLE is set", () => {
    const secret = "disabled-mode-long-lived-secret";
    const agent = new CredentialAgent({
      env: { CC_CRED_AGENT_DISABLE: "true" },
    });

    const result = agent.applyWithReport({
      file: "curl",
      origin: "test:disable",
      env: {
        PATH: "safe",
        API_TOKEN: secret,
      },
      args: [`--api-token=${secret}`],
    });

    expect(result.spawnOptions.args).toEqual(["--api-token=***REDACTED***"]);
    expect(result.spawnOptions.env).toEqual({ PATH: "safe" });
    expect(result.report).toMatchObject({
      agentDisabled: true,
      mode: "redact-only-disabled",
      refsIssued: 0,
      envCount: 1,
      argCount: 1,
    });
    expect(
      thrownCode(() =>
        agent.issueCredentialRef({
          approved: true,
          approvalId: "approval-1",
          process: "curl",
          key: "API_TOKEN",
          value: secret,
        }),
      ),
    ).toBe(CREDENTIAL_ERROR_CODES.DISABLED);
    expect(
      thrownCode(() =>
        agent.resolveCredentialRef("cc-cred-untrusted", {
          agentId: agent.getInfo().agentId,
          process: "curl",
        }),
      ),
    ).toBe(CREDENTIAL_ERROR_CODES.DISABLED);

    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(agent.getAuditLog())).not.toContain(secret);
  });

  it("revokes existing references when the disable switch is activated", () => {
    const env = {};
    const agent = new CredentialAgent({ env });
    const refId = agent.issueCredentialRef({
      approved: true,
      approvalId: "decision-before-disable",
      process: "curl",
      key: "API_TOKEN",
      value: "must-not-resurrect",
      maxUses: 2,
    });
    const target = resolutionContext(agent, "curl");

    env.CC_CRED_AGENT_DISABLE = "1";
    expect(thrownCode(() => agent.resolveCredentialRef(refId, target))).toBe(
      CREDENTIAL_ERROR_CODES.DISABLED,
    );

    delete env.CC_CRED_AGENT_DISABLE;
    expect(thrownCode(() => agent.resolveCredentialRef(refId, target))).toBe(
      CREDENTIAL_ERROR_CODES.REVOKED,
    );
  });

  it("requires an approval and process target before issuing a reference", () => {
    const agent = new CredentialAgent({ env: {} });

    expect(
      thrownCode(() =>
        agent.issueCredentialRef({
          process: "curl",
          key: "API_TOKEN",
          value: "not-approved",
        }),
      ),
    ).toBe(CREDENTIAL_ERROR_CODES.APPROVAL_REQUIRED);
    expect(
      thrownCode(() =>
        agent.issueCredentialRef({
          approved: true,
          process: "curl",
          key: "API_TOKEN",
          value: "missing-approval-id",
        }),
      ),
    ).toBe(CREDENTIAL_ERROR_CODES.APPROVAL_REQUIRED);
    expect(
      thrownCode(() =>
        agent.issueCredentialRef({
          approved: true,
          approvalId: "approval-2",
          key: "API_TOKEN",
          value: "missing-target",
        }),
      ),
    ).toBe(CREDENTIAL_ERROR_CODES.TARGET_REQUIRED);
    expect(
      thrownCode(() =>
        agent.issueCredentialRef({
          approved: true,
          approvalId: "approval-3",
          process: "curl",
          key: "API_TOKEN",
          value: "invalid-lifetime",
          ttlMs: 0,
        }),
      ),
    ).toBe(CREDENTIAL_ERROR_CODES.INVALID_REQUEST);
  });

  it("redacts without issuing when an explicit broker context is unapproved", () => {
    const secret = "unapproved-context-secret";
    const agent = new CredentialAgent({ env: {} });
    const result = agent.applyWithReport({
      file: "curl",
      credentialContext: {
        approved: false,
        approvalId: "denied-decision",
        target: {
          process: "curl",
          host: "api.example.com",
        },
      },
      env: { API_TOKEN: secret },
      args: [`--api-token=${secret}`],
    });

    expect(result.spawnOptions.env).toEqual({});
    expect(result.spawnOptions.args).toEqual(["--api-token=***REDACTED***"]);
    expect(result.report).toMatchObject({
      refsIssued: 0,
      mode: "redact-only",
      filtered: true,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("issues resolvable env and argv refs without leaking plaintext", () => {
    const envSecret = "environment-credential-value";
    const argSecret = "argument-credential-value";
    const agent = new CredentialAgent({ env: {} });
    const credentialContext = agent.createBrokerContext({
      approvalId: "decision-42",
      process: "curl",
      host: "https://API.Example.com:443/path",
      ttlMs: 5_000,
    });

    const result = agent.applyWithReport({
      file: "curl",
      origin: "test:reference",
      credentialContext,
      env: {
        PATH: "safe",
        API_TOKEN: envSecret,
      },
      args: [`--api-key=${argSecret}`],
    });

    const envRef = result.spawnOptions.env.CC_CRED_REF_API_TOKEN;
    const argRef = result.spawnOptions.env.CC_CRED_ARG_REF_0;
    expect(envRef).toMatch(/^cc-cred-/);
    expect(argRef).toMatch(/^cc-cred-/);
    expect(result.spawnOptions.args).toEqual(["--api-key=***REDACTED***"]);
    expect(result.spawnOptions.env).toMatchObject({
      PATH: "safe",
      CC_CREDENTIAL_TRANSPORT: "broker-api",
    });
    expect(result.spawnOptions.env.API_TOKEN).toBeUndefined();
    expect(result.report).toMatchObject({
      mode: "broker-reference",
      refsIssued: 2,
      targetBound: true,
    });

    const target = resolutionContext(agent, "curl", "api.example.com");
    expect(agent.resolveCredentialRef(envRef, target)).toBe(envSecret);
    expect(agent.resolveCredentialRef(argRef, target)).toBe(argSecret);

    const serializedChild = JSON.stringify(result.spawnOptions);
    const serializedAudit = JSON.stringify(agent.getAuditLog());
    expect(serializedChild).not.toContain(envSecret);
    expect(serializedChild).not.toContain(argSecret);
    expect(serializedAudit).not.toContain(envSecret);
    expect(serializedAudit).not.toContain(argSecret);
    expect(serializedAudit).not.toContain(envRef);
    expect(serializedAudit).not.toContain(argRef);
  });

  it("rejects expired references and clears their usable value", () => {
    let now = 10_000;
    const secret = "short-lived-expiring-secret";
    const agent = new CredentialAgent({
      env: {},
      now: () => now,
      defaultTtlMs: 100,
    });
    const refId = agent.issueCredentialRef({
      approved: true,
      approvalId: "decision-expiry",
      process: "curl",
      host: "api.example.com",
      key: "API_TOKEN",
      value: secret,
      ttlMs: 100,
    });

    now += 100;
    expect(
      thrownCode(() =>
        agent.resolveCredentialRef(
          refId,
          resolutionContext(agent, "curl", "api.example.com"),
        ),
      ),
    ).toBe(CREDENTIAL_ERROR_CODES.EXPIRED);
    expect(JSON.stringify(agent.getAuditLog())).not.toContain(secret);
  });

  it("rejects cross-process and cross-host resolution without consuming a use", () => {
    const agent = new CredentialAgent({ env: {} });
    const refId = agent.issueCredentialRef({
      approved: true,
      approvalId: "decision-target",
      process: "curl",
      host: "api.example.com",
      key: "API_TOKEN",
      value: "target-bound-secret",
      maxUses: 1,
    });

    expect(
      thrownCode(() =>
        agent.resolveCredentialRef(
          refId,
          resolutionContext(agent, "powershell", "api.example.com"),
        ),
      ),
    ).toBe(CREDENTIAL_ERROR_CODES.TARGET_MISMATCH);
    expect(
      thrownCode(() =>
        agent.resolveCredentialRef(
          refId,
          resolutionContext(agent, "curl", "evil.example.com"),
        ),
      ),
    ).toBe(CREDENTIAL_ERROR_CODES.TARGET_MISMATCH);
    expect(
      agent.resolveCredentialRef(
        refId,
        resolutionContext(agent, "curl", "api.example.com"),
      ),
    ).toBe("target-bound-secret");
  });

  it("requires the issuing agent identity during resolution", () => {
    const agent = new CredentialAgent({ env: {} });
    const refId = agent.issueCredentialRef({
      approved: true,
      approvalId: "decision-agent",
      process: "curl",
      key: "API_TOKEN",
      value: "agent-bound-secret",
    });

    expect(
      thrownCode(() =>
        agent.resolveCredentialRef(refId, {
          agentId: "different-agent",
          process: "curl",
        }),
      ),
    ).toBe(CREDENTIAL_ERROR_CODES.AGENT_MISMATCH);
  });

  it("rejects repeated use of a single-use reference", () => {
    const agent = new CredentialAgent({ env: {} });
    const refId = agent.issueCredentialRef({
      approved: true,
      approvalId: "decision-single-use",
      process: "curl",
      key: "API_TOKEN",
      value: "single-use-secret",
    });
    const target = resolutionContext(agent, "curl");

    expect(agent.resolveCredentialRef(refId, target)).toBe("single-use-secret");
    expect(thrownCode(() => agent.resolveCredentialRef(refId, target))).toBe(
      CREDENTIAL_ERROR_CODES.EXHAUSTED,
    );
  });

  it("supports a bounded number of uses and audits only fingerprints", () => {
    const secret = "bounded-use-secret";
    const agent = new CredentialAgent({ env: {} });
    const refId = agent.issueCredentialRef({
      approved: true,
      approvalId: "decision-bounded",
      process: "curl",
      host: "api.example.com",
      key: "API_TOKEN",
      value: secret,
      maxUses: 2,
    });
    const target = resolutionContext(agent, "curl", "api.example.com");

    expect(agent.resolveCredentialRef(refId, target)).toBe(secret);
    expect(agent.resolveCredentialRef(refId, target)).toBe(secret);
    expect(thrownCode(() => agent.resolveCredentialRef(refId, target))).toBe(
      CREDENTIAL_ERROR_CODES.EXHAUSTED,
    );

    const serializedAudit = JSON.stringify(agent.getAuditLog());
    expect(serializedAudit).not.toContain(secret);
    expect(serializedAudit).not.toContain(refId);
    expect(serializedAudit).toContain("refFingerprint");
  });

  it("strips inherited credential-agent control variables", () => {
    const agent = new CredentialAgent({ env: {} });
    const result = agent.applyWithReport({
      file: "echo",
      env: {
        PATH: "safe",
        CC_CRED_REF_API_TOKEN: "attacker-controlled-ref",
        CC_CRED_ARG_REF_0: "attacker-controlled-arg-ref",
        CC_CREDENTIAL_AGENT_ID: "attacker-controlled-agent",
      },
      args: [],
    });

    expect(result.spawnOptions.env).toEqual({ PATH: "safe" });
    expect(result.report).toMatchObject({
      filtered: true,
      refsIssued: 0,
      mode: "redact-only",
    });
  });
});
