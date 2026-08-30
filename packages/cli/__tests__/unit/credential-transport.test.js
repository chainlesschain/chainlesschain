import { afterEach, describe, expect, it } from "vitest";
import {
  CredentialAgent,
  CREDENTIAL_ERROR_CODES,
} from "../../src/lib/process-execution-broker/credential-agent.js";
import {
  resolveCredentialEnvironmentValue,
  resolveCredentialRefOverTransport,
  TRANSPORT_VERSION,
} from "../../src/lib/process-execution-broker/credential-transport.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

const agents = new Set();

function transportAgent() {
  const agent = new CredentialAgent({ env: {}, transport: true });
  agents.add(agent);
  return agent;
}

afterEach(async () => {
  await Promise.all([...agents].map((agent) => agent.closeTransport()));
  agents.clear();
});

describe("authenticated credential reference transport", () => {
  it("resolves a process/host-bound reference and enforces single use", async () => {
    const agent = transportAgent();
    await agent.waitForTransportReady();
    const secret = "transport-only-secret-value";
    const result = agent.applyWithReport({
      file: process.execPath,
      origin: "test:credential-transport",
      credentialContext: agent.createBrokerContext({
        approvalId: "transport-decision-1",
        process: process.execPath,
        host: "https://api.example.com/v1",
      }),
      env: {
        PATH: process.env.PATH,
        API_TOKEN: secret,
      },
      args: [],
    });

    const refId = result.spawnOptions.env.CC_CRED_REF_API_TOKEN;
    expect(result.spawnOptions.env).toMatchObject({
      CC_CREDENTIAL_TRANSPORT: TRANSPORT_VERSION,
      CC_CREDENTIAL_TARGET_HOST: "api.example.com",
    });
    expect(result.spawnOptions.env.API_TOKEN).toBeUndefined();
    expect(JSON.stringify(result.spawnOptions.env)).not.toContain(secret);

    await expect(
      resolveCredentialRefOverTransport(refId, {
        env: result.spawnOptions.env,
      }),
    ).resolves.toBe(secret);
    await expect(
      resolveCredentialRefOverTransport(refId, {
        env: result.spawnOptions.env,
      }),
    ).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.EXHAUSTED,
    });
    expect(JSON.stringify(agent.getAuditLog())).not.toContain(secret);
  });

  it("rejects a stolen reference without its launch capability", async () => {
    const agent = transportAgent();
    await agent.waitForTransportReady();
    const result = agent.applyWithReport({
      file: process.execPath,
      origin: "test:credential-transport-auth",
      credentialContext: agent.createBrokerContext({
        approvalId: "transport-decision-2",
        process: process.execPath,
      }),
      env: { API_TOKEN: "capability-bound-secret" },
      args: [],
    });
    const refId = result.spawnOptions.env.CC_CRED_REF_API_TOKEN;

    await expect(
      resolveCredentialRefOverTransport(refId, {
        env: {
          ...result.spawnOptions.env,
          CC_CREDENTIAL_AUTH_TOKEN: "attacker-token",
        },
      }),
    ).rejects.toMatchObject({
      code: "CC_CREDENTIAL_TRANSPORT_UNAUTHORIZED",
    });
    await expect(
      resolveCredentialRefOverTransport(refId, {
        env: result.spawnOptions.env,
        host: "evil.example.com",
      }),
    ).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.TARGET_MISMATCH,
    });
  });

  it("serves a real spawnSync child without putting plaintext in its env", async () => {
    await executionBroker._credentialAgent.waitForTransportReady();
    const previousSandboxEnabled = executionBroker._platformSandboxEnabled;
    const secret = "real-sync-transport-secret";
    const transportModuleUrl = new URL(
      "../../src/lib/process-execution-broker/credential-transport.js",
      import.meta.url,
    ).href;
    const childScript = [
      `import { resolveCredentialRefOverTransport } from ${JSON.stringify(transportModuleUrl)};`,
      "const refId = process.env.CC_CRED_REF_API_TOKEN;",
      "const value = await resolveCredentialRefOverTransport(refId);",
      "process.stdout.write(value);",
    ].join("\n");

    executionBroker._platformSandboxEnabled = false;
    try {
      const result = executionBroker.spawnSync(
        process.execPath,
        ["--input-type=module", "-e", childScript],
        {
          origin: "test:credential-transport-real-sync",
          policy: "allow",
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 10_000,
          env: {
            PATH: process.env.PATH,
            SYSTEMROOT: process.env.SYSTEMROOT,
            API_TOKEN: secret,
          },
        },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(secret);
    } finally {
      executionBroker._platformSandboxEnabled = previousSandboxEnabled;
    }
  });

  it("lets a real brokered agent bootstrap API and team credentials by reference", async () => {
    await executionBroker._credentialAgent.waitForTransportReady();
    const previousSandboxEnabled = executionBroker._platformSandboxEnabled;
    const transportModuleUrl = new URL(
      "../../src/lib/process-execution-broker/credential-transport.js",
      import.meta.url,
    ).href;
    const teamToolsModuleUrl = new URL(
      "../../src/lib/agent-team/team-message-tools.js",
      import.meta.url,
    ).href;
    const childScript = [
      `import { resolveCredentialEnvironmentValue } from ${JSON.stringify(transportModuleUrl)};`,
      `import { resolveTeamMessageToolBundle } from ${JSON.stringify(teamToolsModuleUrl)};`,
      'if (process.env.CC_API_KEY || process.env.CC_TEAM_MESSAGE_BRIDGE_TOKEN) throw new Error("plaintext credential leaked");',
      'const apiKey = await resolveCredentialEnvironmentValue("CC_API_KEY");',
      "const bundle = await resolveTeamMessageToolBundle();",
      'if (!apiKey || !bundle?.externalToolExecutors?.team_send) throw new Error("credential bootstrap failed");',
      'process.stdout.write("ok");',
    ].join("\n");

    executionBroker._platformSandboxEnabled = false;
    try {
      const result = executionBroker.spawnSync(
        process.execPath,
        ["--input-type=module", "-e", childScript],
        {
          origin: "test:brokered-agent-credential-bootstrap",
          policy: "allow",
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 10_000,
          env: {
            PATH: process.env.PATH,
            SYSTEMROOT: process.env.SYSTEMROOT,
            CC_API_KEY: "agent-api-key-secret",
            CC_TEAM_MESSAGE_BRIDGE_ENDPOINT: "local-bridge-endpoint",
            CC_TEAM_MESSAGE_BRIDGE_TOKEN: "b".repeat(64),
            CC_TEAM_MESSAGE_BRIDGE_PROTOCOL: "1",
          },
        },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("ok");
    } finally {
      executionBroker._platformSandboxEnabled = previousSandboxEnabled;
    }
  });

  it("prefers neither plaintext nor a reference when both are present", async () => {
    await expect(
      resolveCredentialEnvironmentValue("CC_API_KEY", {
        env: {
          CC_API_KEY: "plaintext",
          CC_CRED_REF_CC_API_KEY: "cc-cred-ambiguous",
        },
      }),
    ).rejects.toMatchObject({ code: "CC_CREDENTIAL_INVALID_REQUEST" });
  });
});
