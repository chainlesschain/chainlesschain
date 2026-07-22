import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

describe("ProcessExecutionBroker credential boundary", () => {
  let previousNative;
  let previousSandboxEnabled;
  let previousCredentialAgent;
  let nativeSpawn;
  let nativeSpawnSync;

  beforeEach(() => {
    previousNative = executionBroker._native;
    previousSandboxEnabled = executionBroker._platformSandboxEnabled;
    previousCredentialAgent = executionBroker._credentialAgent;
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
    executionBroker.flushAuditLog();
  });

  it("passes filtered env and argv to async spawn and audits only redacted args", () => {
    const secret = ["async", "credential", "value"].join("-");
    const rawArg = `--api-token=${secret}`;
    const before = executionBroker.getStats().credFiltered;

    executionBroker.spawn("cc-test-tool", [rawArg], {
      origin: "test:async-credential",
      policy: "allow",
      env: { API_TOKEN: secret, PATH: "safe" },
    });

    expect(nativeSpawn).toHaveBeenCalledOnce();
    const [, args, options] = nativeSpawn.mock.calls[0];
    expect(args).toEqual(["--api-token=***REDACTED***"]);
    expect(options.env.API_TOKEN).toBeUndefined();
    expect(options.env.CC_CRED_REF_API_TOKEN).toMatch(/^cc-cred-/);
    const audit = executionBroker.getAuditLog(1)[0];
    expect(audit).toMatchObject({
      origin: "test:async-credential",
      args: ["--api-token=***REDACTED***"],
      credentialFiltered: true,
      credentialEnvCount: 1,
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
