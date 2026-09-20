import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const {
  AUTHORITY_SCHEMA,
  AUDIT_MODE,
  EXECUTOR_TYPE,
  PURPOSE,
  RECEIPT_SCHEMA,
  REQUEST_SCHEMA,
  createVolcengineFunctionExecutionHost,
  createVolcengineFunctionExecutor,
  digestVolcengineFunctionResult,
} = require("../volcengine-function-capability");

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function authorization(overrides = {}) {
  return {
    actorDid: "did:test:operator",
    operation: "execute-function-calling",
    purpose: PURPOSE,
    senderId: 7,
    tenantId: "tenant:test",
    ...overrides,
  };
}

function policiesFor(allowedFunctions) {
  const definitions = {
    create_note: {
      functionName: "create_note",
      allowedArgumentKeys: ["content", "title"],
      maxArgumentBytes: 1024,
      maxResultBytes: 1024,
      maxExecutionMs: 1000,
    },
    read_file: {
      functionName: "read_file",
      allowedArgumentKeys: ["path"],
      maxArgumentBytes: 512,
      maxResultBytes: 2048,
      maxExecutionMs: 1000,
    },
  };
  return allowedFunctions.map((name) => definitions[name]);
}

function responseFor(request, toolResult, overrides = {}) {
  return {
    toolResult,
    receipt: {
      schema: RECEIPT_SCHEMA,
      authorityId: "authority:test",
      tenantId: request.tenantId,
      handlerArtifactDigest: sha("handler"),
      policyRevision: "policy-1",
      actorDid: request.actorDid,
      purpose: PURPOSE,
      requestId: request.requestId,
      senderId: request.senderId,
      functionName: request.functionName,
      functionPolicyDigest: request.functionPolicyDigest,
      deadlineAt: request.deadlineAt,
      requestDigest: request.requestDigest,
      resultDigest: digestVolcengineFunctionResult(toolResult),
      auditMode: AUDIT_MODE,
      auditEventDigest: sha("audit-event"),
      durabilityReceiptDigest: sha("durability-receipt"),
      authenticated: true,
      durable: true,
      readbackVerified: true,
      completedAt: new Date().toISOString(),
      ...overrides,
    },
  };
}

function setup({
  allowedFunctions = ["create_note"],
  execute,
  descriptorOverrides = {},
} = {}) {
  const authority = Object.freeze({});
  const executeFunction = vi.fn(
    execute ||
      (async (request) =>
        responseFor(request, { noteId: "note-1", success: true })),
  );
  const captureAuthority = vi.fn((candidate) => {
    if (candidate !== authority) throw new TypeError("unbranded authority");
    return {
      descriptor: {
        schema: AUTHORITY_SCHEMA,
        authorityId: "authority:test",
        tenantId: "tenant:test",
        handlerArtifactDigest: sha("handler"),
        policyRevision: "policy-1",
        purpose: PURPOSE,
        allowedFunctions,
        functionPolicies: policiesFor(allowedFunctions),
        auditMode: AUDIT_MODE,
        ...descriptorOverrides,
      },
      executeFunction,
    };
  });
  const host = createVolcengineFunctionExecutionHost(
    authority,
    captureAuthority,
  );
  return { authority, captureAuthority, executeFunction, host };
}

function expectGovernanceFailure(error) {
  expect(error).toMatchObject({
    message: "Governed Volcengine function execution failed",
    code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
  });
}

describe("Volcengine function capability", () => {
  it.each(["v1", "v2"])(
    "rejects legacy %s authority descriptors",
    (version) => {
      expect(() =>
        setup({
          descriptorOverrides: {
            schema: `chainlesschain.volcengine-function-authority/${version}`,
          },
        }),
      ).toThrow("Volcengine function authority descriptor is invalid");
    },
  );

  it("binds an opaque host to actor, tenant, sender, purpose and result receipt", async () => {
    const { host, executeFunction } = setup();
    const executor = createVolcengineFunctionExecutor(host, {
      authorization: authorization(),
      executorType: EXECUTOR_TYPE,
    });

    const result = await executor.execute("create_note", {
      title: "bounded title",
    });

    expect(Object.isFrozen(host)).toBe(true);
    expect(Reflect.ownKeys(host)).toEqual([]);
    expect(result).toEqual({ noteId: "note-1", success: true });
    expect(Object.isFrozen(result)).toBe(true);
    expect(executeFunction).toHaveBeenCalledTimes(1);
    const request = executeFunction.mock.calls[0][0];
    expect(request).toMatchObject({
      schema: REQUEST_SCHEMA,
      authorityId: "authority:test",
      tenantId: "tenant:test",
      handlerArtifactDigest: sha("handler"),
      policyRevision: "policy-1",
      actorDid: "did:test:operator",
      purpose: PURPOSE,
      senderId: 7,
      executorType: EXECUTOR_TYPE,
      functionName: "create_note",
      functionPolicyDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      deadlineAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
      arguments: { title: "bounded title" },
    });
    expect(request.argumentsDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(request.requestDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.arguments)).toBe(true);
  });

  it("rejects forged hosts, legacy executor selectors and tenant mismatch", () => {
    const { host } = setup();
    for (const create of [
      () =>
        createVolcengineFunctionExecutor(Object.freeze({}), {
          authorization: authorization(),
          executorType: EXECUTOR_TYPE,
        }),
      () =>
        createVolcengineFunctionExecutor(host, {
          authorization: authorization(),
          executorType: "database",
        }),
      () =>
        createVolcengineFunctionExecutor(host, {
          authorization: authorization({ tenantId: "tenant:foreign" }),
          executorType: EXECUTOR_TYPE,
        }),
    ]) {
      try {
        create();
        throw new Error("expected governance failure");
      } catch (error) {
        expectGovernanceFailure(error);
      }
    }
  });

  it("blocks functions outside the authority allowlist before side effects", async () => {
    const { host, executeFunction } = setup();
    const executor = createVolcengineFunctionExecutor(host, {
      authorization: authorization(),
      executorType: EXECUTOR_TYPE,
    });

    let error;
    try {
      await executor.execute("read_file", { path: "private-path" });
    } catch (cause) {
      error = cause;
    }

    expectGovernanceFailure(error);
    expect(executeFunction).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toContain("private-path");
  });

  it("blocks argument fields and sizes outside the signed function policy", async () => {
    const { host, executeFunction } = setup();
    const executor = createVolcengineFunctionExecutor(host, {
      authorization: authorization(),
      executorType: EXECUTOR_TYPE,
    });

    for (const args of [
      { title: "ok", privatePath: "secret" },
      { title: "x".repeat(2048) },
    ]) {
      let error;
      try {
        await executor.execute("create_note", args);
      } catch (cause) {
        error = cause;
      }
      expectGovernanceFailure(error);
    }
    expect(executeFunction).not.toHaveBeenCalled();
  });

  it("blocks results outside the signed function policy", async () => {
    const { host, executeFunction } = setup({
      execute: async (request) =>
        responseFor(request, { content: "x".repeat(2048) }),
    });
    const executor = createVolcengineFunctionExecutor(host, {
      authorization: authorization(),
      executorType: EXECUTOR_TYPE,
    });

    await expect(
      executor.execute("create_note", { title: "bounded" }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(executeFunction).toHaveBeenCalledOnce();
  });

  it("rejects accessor arguments without invoking the accessor or authority", async () => {
    const { host, executeFunction } = setup();
    const executor = createVolcengineFunctionExecutor(host, {
      authorization: authorization(),
      executorType: EXECUTOR_TYPE,
    });
    const accessor = vi.fn(() => "private value");
    const args = {};
    Object.defineProperty(args, "title", {
      enumerable: true,
      get: accessor,
    });

    let error;
    try {
      await executor.execute("create_note", args);
    } catch (cause) {
      error = cause;
    }

    expectGovernanceFailure(error);
    expect(accessor).not.toHaveBeenCalled();
    expect(executeFunction).not.toHaveBeenCalled();
  });

  it("fails closed when the durable receipt does not bind the result", async () => {
    const privateReason = "private authority receipt reason";
    const { host } = setup({
      execute: async (request) =>
        responseFor(
          request,
          { success: true },
          {
            resultDigest: privateReason,
          },
        ),
    });
    const executor = createVolcengineFunctionExecutor(host, {
      authorization: authorization(),
      executorType: EXECUTOR_TYPE,
    });

    let error;
    try {
      await executor.execute("create_note", {});
    } catch (cause) {
      error = cause;
    }

    expectGovernanceFailure(error);
    expect(JSON.stringify(error)).not.toContain(privateReason);
  });

  it("fails closed when the durable receipt substitutes the function policy", async () => {
    const { host } = setup({
      execute: async (request) =>
        responseFor(
          request,
          { success: true },
          {
            functionPolicyDigest: sha("substituted-policy"),
          },
        ),
    });
    const executor = createVolcengineFunctionExecutor(host, {
      authorization: authorization(),
      executorType: EXECUTOR_TYPE,
    });

    await expect(executor.execute("create_note", {})).rejects.toMatchObject({
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
    });
  });

  it("fails closed when the durable receipt completes after the signed deadline", async () => {
    const { host } = setup({
      execute: async (request) =>
        responseFor(
          request,
          { success: true },
          { completedAt: new Date(Date.now() + 60_000).toISOString() },
        ),
    });
    const executor = createVolcengineFunctionExecutor(host, {
      authorization: authorization(),
      executorType: EXECUTOR_TYPE,
    });

    await expect(executor.execute("create_note", {})).rejects.toMatchObject({
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
    });
  });

  it("fails closed without exposing authority exceptions", async () => {
    const privateReason = "private database path and stack";
    const { host } = setup({
      execute: async () => {
        throw new Error(privateReason);
      },
    });
    const executor = createVolcengineFunctionExecutor(host, {
      authorization: authorization(),
      executorType: EXECUTOR_TYPE,
    });

    let error;
    try {
      await executor.execute("create_note", {});
    } catch (cause) {
      error = cause;
    }

    expectGovernanceFailure(error);
    expect(error.message).not.toContain(privateReason);
    expect(error.cause).toBeUndefined();
  });
});
