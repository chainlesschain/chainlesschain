import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";
import { CredentialAgent } from "../../src/lib/process-execution-broker/credential-agent.js";

describe("ProcessExecutionBroker credential boundary", () => {
  let previousNative;
  let previousSandboxEnabled;
  let previousCredentialAgent;
  let previousHooksEventSink;
  let nativeSpawn;
  let nativeSpawnSync;

  beforeEach(() => {
    previousNative = executionBroker._native;
    previousSandboxEnabled = executionBroker._platformSandboxEnabled;
    previousCredentialAgent = executionBroker._credentialAgent;
    previousHooksEventSink = executionBroker._hooksEventSink;
    nativeSpawn = vi.fn(() => {
      const child = new EventEmitter();
      child.pid = 4101;
      return child;
    });
    nativeSpawnSync = vi.fn(() => ({
      status: 0,
      stdout: "ok",
      stderr: "",
    }));
    executionBroker._native = {
      spawn: nativeSpawn,
      spawnSync: nativeSpawnSync,
    };
    executionBroker._platformSandboxEnabled = false;
    executionBroker.flushAuditLog();
  });

  afterEach(() => {
    executionBroker._native = previousNative;
    executionBroker._platformSandboxEnabled = previousSandboxEnabled;
    executionBroker._credentialAgent = previousCredentialAgent;
    executionBroker._setHooksEventSink(previousHooksEventSink);
    executionBroker.flushAuditLog();
  });

  it("passes filtered env and argv to async spawn and audits only redacted args", () => {
    const secret = ["async", "credential", "value"].join("-");
    const rawArg = `--api-token=${secret}`;
    const before = executionBroker.getStats().credFiltered;

    executionBroker.spawn("cc-test-tool", [rawArg], {
      origin: "test:async-credential",
      policy: "allow",
      env: {
        API_TOKEN: secret,
        PATH: "safe",
        CC_SESSION_ID: "session-42",
        CLAUDE_CODE_SESSION_ID: "session-42",
        SERVICE_SESSION: "must-stay-filtered",
      },
    });

    expect(nativeSpawn).toHaveBeenCalledOnce();
    const [, args, options] = nativeSpawn.mock.calls[0];
    expect(args).toEqual(["--api-token=***REDACTED***"]);
    expect(options.env.API_TOKEN).toBeUndefined();
    expect(options.env.CC_CRED_REF_API_TOKEN).toMatch(/^cc-cred-/);
    expect(options.env.CC_SESSION_ID).toBe("session-42");
    expect(options.env.CLAUDE_CODE_SESSION_ID).toBe("session-42");
    expect(options.env.SERVICE_SESSION).toBeUndefined();
    expect(options.env.CC_CRED_REF_SERVICE_SESSION).toMatch(/^cc-cred-/);
    const audit = executionBroker.getAuditLog(1)[0];
    expect(audit).toMatchObject({
      origin: "test:async-credential",
      args: ["--api-token=***REDACTED***"],
      credentialFiltered: true,
      credentialEnvCount: 2,
      credentialArgCount: 1,
    });
    expect(JSON.stringify(audit)).not.toContain(secret);
    expect(executionBroker.getStats().credFiltered).toBe(before + 1);
  });

  it("passes filtered env and argv to sync spawn with the same audit signal", () => {
    const secret = ["sync", "credential", "value"].join("-");
    const rawArg = `--password=${secret}`;

    const result = executionBroker.spawnSync("cc-test-tool", [rawArg], {
      origin: "test:sync-credential",
      policy: "allow",
      env: { SERVICE_SECRET: secret, PATH: "safe" },
    });

    expect(result.status).toBe(0);
    expect(nativeSpawnSync).toHaveBeenCalledOnce();
    const [, args, options] = nativeSpawnSync.mock.calls[0];
    expect(args).toEqual(["--password=***REDACTED***"]);
    expect(options.env.SERVICE_SECRET).toBeUndefined();
    expect(options.env.CC_CRED_REF_SERVICE_SECRET).toMatch(/^cc-cred-/);
    const audit = executionBroker.getAuditLog(1)[0];
    expect(audit).toMatchObject({
      origin: "test:sync-credential",
      args: ["--password=***REDACTED***"],
      credentialFiltered: true,
      credentialEnvCount: 1,
      credentialArgCount: 1,
    });
    expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it("revokes sync-process references before repeated launches exhaust capacity", () => {
    const agent = new CredentialAgent({ env: {}, maxCredentials: 2 });
    executionBroker._credentialAgent = agent;

    for (let index = 0; index < 12; index += 1) {
      expect(() =>
        executionBroker.spawnSync("cc-test-tool", [], {
          origin: "test:sync-credential-capacity",
          policy: "allow",
          env: {
            SERVICE_SECRET: `secret-${index}`,
            PATH: "safe",
          },
        }),
      ).not.toThrow();
    }

    expect(nativeSpawnSync).toHaveBeenCalledTimes(12);
    expect(agent.getInfo()).toMatchObject({
      activeCredentials: 0,
      credentialsTracked: 2,
    });
  });

  it("preserves exact content-free execution-location fences", () => {
    const hookDigest = `sha256:${"a".repeat(64)}`;
    executionBroker.spawnSync("cc-test-tool", [], {
      origin: "test:execution-location-fences",
      policy: "allow",
      env: {
        CC_EXECUTION_LOCATION_POST_SESSION_HOOK_DIGEST: hookDigest,
        CC_EXECUTION_LOCATION_POST_SESSION_HOOK_GENERATION: "7",
        CC_EXECUTION_LOCATION_PROXY_AUTHORITY_ID: "proxy-authority-1",
        CC_EXECUTION_LOCATION_PROXY_AUTHORITY_SECRET: "must-stay-filtered",
      },
    });

    const [, , options] = nativeSpawnSync.mock.calls[0];
    expect(options.env).toMatchObject({
      CC_EXECUTION_LOCATION_POST_SESSION_HOOK_DIGEST: hookDigest,
      CC_EXECUTION_LOCATION_POST_SESSION_HOOK_GENERATION: "7",
      CC_EXECUTION_LOCATION_PROXY_AUTHORITY_ID: "proxy-authority-1",
    });
    expect(
      options.env.CC_EXECUTION_LOCATION_PROXY_AUTHORITY_SECRET,
    ).toBeUndefined();
    expect(
      options.env.CC_CRED_REF_CC_EXECUTION_LOCATION_PROXY_AUTHORITY_SECRET,
    ).toMatch(/^cc-cred-/u);
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      credentialFiltered: true,
      credentialEnvCount: 1,
    });
  });

  it("redacts denied argv before writing the audit record", () => {
    const secret = ["denied", "credential", "value"].join("-");
    expect(() =>
      executionBroker.spawnSync("cc-test-tool", [`--api-key=${secret}`], {
        origin: "test:denied-credential",
        policy: "deny",
      }),
    ).toThrow(/denied/);

    expect(nativeSpawnSync).not.toHaveBeenCalled();
    const audit = executionBroker.getAuditLog(1)[0];
    expect(audit.args).toEqual(["--api-key=***REDACTED***"]);
    expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it("keeps explicitly opaque argv out of audit while preserving launch argv", () => {
    const opaqueCommand = "credential-helper --profile production";
    const hooks = { emit: vi.fn() };
    executionBroker._setHooksEventSink(hooks);

    executionBroker.spawn("/bin/sh", ["-c", opaqueCommand], {
      origin: "test:opaque-argv",
      policy: "allow",
      auditRedactArgIndexes: [1],
    });

    expect(nativeSpawn).toHaveBeenCalledOnce();
    const [, args, options] = nativeSpawn.mock.calls[0];
    expect(args).toEqual(["-c", opaqueCommand]);
    expect(options).not.toHaveProperty("auditRedactArgIndexes");
    const audit = executionBroker.getAuditLog(1)[0];
    expect(audit.args).toEqual(["-c", "***REDACTED***"]);
    expect(JSON.stringify(audit)).not.toContain(opaqueCommand);
    expect(hooks.emit).toHaveBeenCalledWith(
      "tool:start",
      expect.objectContaining({ args: ["-c", "***REDACTED***"] }),
    );
    expect(JSON.stringify(hooks.emit.mock.calls)).not.toContain(opaqueCommand);
  });

  it("fails closed when credential filtering cannot be applied", () => {
    executionBroker._credentialAgent = {
      sanitizeArgs: (args) => ({ sanitizedArgs: [...args] }),
      applyWithReport: () => {
        throw new Error("credential boundary unavailable");
      },
    };

    expect(() =>
      executionBroker.spawnSync("cc-test-tool", [], {
        origin: "test:credential-failure",
        policy: "allow",
      }),
    ).toThrow(/credential boundary unavailable/);
    expect(nativeSpawnSync).not.toHaveBeenCalled();
  });
});
