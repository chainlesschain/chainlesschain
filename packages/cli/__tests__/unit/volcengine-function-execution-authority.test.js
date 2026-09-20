import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  VOLCENGINE_FUNCTION_AUDIT_EVIDENCE_SCHEMA,
  VOLCENGINE_FUNCTION_AUDIT_MODE,
  VOLCENGINE_FUNCTION_AUTHORITY_SCHEMA,
  VOLCENGINE_FUNCTION_EXECUTOR_TYPE,
  VOLCENGINE_FUNCTION_PURPOSE,
  VOLCENGINE_FUNCTION_RECEIPT_SCHEMA,
  VOLCENGINE_FUNCTION_REQUEST_SCHEMA,
  captureVolcengineFunctionExecutionAuthority,
  createVolcengineFunctionExecutionAuthority,
  digestVolcengineFunctionResult,
} from "../../src/lib/evolution/volcengine-function-execution-authority.js";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");

function canonical(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function domainDigest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;
}

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function functionPolicies() {
  return [
    {
      functionName: "create_note",
      allowedArgumentKeys: ["content", "title"],
      maxArgumentBytes: 1024,
      maxResultBytes: 1024,
    },
    {
      functionName: "read_file",
      allowedArgumentKeys: ["path"],
      maxArgumentBytes: 512,
      maxResultBytes: 2048,
    },
  ];
}

function functionPolicyDigest(functionName = "create_note") {
  const policy = functionPolicies().find(
    (entry) => entry.functionName === functionName,
  );
  if (!policy) return sha(`missing-policy:${functionName}`);
  return domainDigest("chainlesschain.volcengine-function-policy/v1", policy);
}

function descriptor(overrides = {}) {
  return {
    schema: VOLCENGINE_FUNCTION_AUTHORITY_SCHEMA,
    authorityId: "authority:test",
    tenantId: "tenant:test",
    handlerArtifactDigest: sha("signed-deployment"),
    policyRevision: "policy-1",
    purpose: VOLCENGINE_FUNCTION_PURPOSE,
    allowedFunctions: ["create_note", "read_file"],
    functionPolicies: functionPolicies(),
    auditMode: VOLCENGINE_FUNCTION_AUDIT_MODE,
    ...overrides,
  };
}

function request(overrides = {}) {
  const args = overrides.arguments || { title: "bounded title" };
  const core = {
    schema: VOLCENGINE_FUNCTION_REQUEST_SCHEMA,
    authorityId: "authority:test",
    tenantId: "tenant:test",
    handlerArtifactDigest: sha("signed-deployment"),
    policyRevision: "policy-1",
    actorDid: "did:test:operator",
    purpose: VOLCENGINE_FUNCTION_PURPOSE,
    requestId: "request-1",
    senderId: 7,
    executorType: VOLCENGINE_FUNCTION_EXECUTOR_TYPE,
    functionName: "create_note",
    functionPolicyDigest: functionPolicyDigest(
      overrides.functionName || "create_note",
    ),
    arguments: args,
    argumentsDigest: domainDigest(
      "chainlesschain.volcengine-function-arguments/v1",
      args,
    ),
    requestedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
  return {
    ...core,
    requestDigest: domainDigest(
      "chainlesschain.volcengine-function-request/v2",
      core,
    ),
  };
}

function responseFor(value, toolResult, overrides = {}) {
  return {
    toolResult,
    auditEvidence: {
      schema: VOLCENGINE_FUNCTION_AUDIT_EVIDENCE_SCHEMA,
      authorityId: "authority:test",
      tenantId: "tenant:test",
      handlerArtifactDigest: sha("signed-deployment"),
      policyRevision: "policy-1",
      requestId: value.requestId,
      requestDigest: value.requestDigest,
      functionPolicyDigest: value.functionPolicyDigest,
      resultDigest: digestVolcengineFunctionResult(toolResult),
      auditEventDigest: sha("audit-event"),
      durabilityReceiptDigest: sha("durability-receipt"),
      authenticated: true,
      durable: true,
      readbackVerified: true,
      completedAt: new Date(NOW).toISOString(),
      ...overrides,
    },
  };
}

function setup(overrides = {}) {
  const execute = vi.fn(
    overrides.execute ||
      (async (value) =>
        responseFor(value, { noteId: "note-1", success: true })),
  );
  const authority = createVolcengineFunctionExecutionAuthority({
    descriptor: descriptor(overrides.descriptor),
    execute,
    now: () => NOW,
  });
  return {
    authority,
    execute,
    port: captureVolcengineFunctionExecutionAuthority(authority),
  };
}

describe("Volcengine function execution authority", () => {
  it("rejects legacy v1 authority descriptors", () => {
    expect(() =>
      createVolcengineFunctionExecutionAuthority({
        descriptor: descriptor({
          schema: "chainlesschain.volcengine-function-authority/v1",
        }),
        execute: vi.fn(),
      }),
    ).toThrow("Volcengine function authority descriptor is invalid");
  });

  it("issues a result-bound receipt only after authenticated durable readback", async () => {
    const { authority, execute, port } = setup();

    const response = await port.executeFunction(request());

    expect(Object.isFrozen(authority)).toBe(true);
    expect(Reflect.ownKeys(authority)).toEqual([]);
    expect(execute).toHaveBeenCalledOnce();
    expect(response.toolResult).toEqual({ noteId: "note-1", success: true });
    expect(response.receipt).toMatchObject({
      schema: VOLCENGINE_FUNCTION_RECEIPT_SCHEMA,
      authorityId: "authority:test",
      tenantId: "tenant:test",
      handlerArtifactDigest: sha("signed-deployment"),
      policyRevision: "policy-1",
      actorDid: "did:test:operator",
      purpose: VOLCENGINE_FUNCTION_PURPOSE,
      requestId: "request-1",
      senderId: 7,
      functionName: "create_note",
      functionPolicyDigest: functionPolicyDigest(),
      auditMode: VOLCENGINE_FUNCTION_AUDIT_MODE,
      auditEventDigest: sha("audit-event"),
      durabilityReceiptDigest: sha("durability-receipt"),
      authenticated: true,
      durable: true,
      readbackVerified: true,
    });
    expect(response.receipt.resultDigest).toBe(
      digestVolcengineFunctionResult(response.toolResult),
    );
  });

  it("rejects forged authorities", () => {
    expect(() =>
      captureVolcengineFunctionExecutionAuthority(Object.freeze({})),
    ).toThrow("branded Volcengine function execution authority");
  });

  it("rejects request digest tampering before execution", async () => {
    const { execute, port } = setup();

    await expect(
      port.executeFunction({ ...request(), requestDigest: sha("tampered") }),
    ).rejects.toThrow("Volcengine function request is invalid");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an invalid authority clock before execution", async () => {
    const execute = vi.fn();
    const port = captureVolcengineFunctionExecutionAuthority(
      createVolcengineFunctionExecutionAuthority({
        descriptor: descriptor(),
        execute,
        now: () => Number.NaN,
      }),
    );

    await expect(port.executeFunction(request())).rejects.toThrow(
      "Volcengine function authority clock is invalid",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects exact and request-id replays before repeating a side effect", async () => {
    const { execute, port } = setup();
    const first = request();

    await expect(port.executeFunction(first)).resolves.toBeDefined();
    await expect(port.executeFunction(first)).rejects.toThrow(
      "Volcengine function request was replayed",
    );

    const changedArguments = { title: "different title" };
    await expect(
      port.executeFunction(
        request({
          requestId: first.requestId,
          arguments: changedArguments,
          argumentsDigest: domainDigest(
            "chainlesschain.volcengine-function-arguments/v1",
            changedArguments,
          ),
        }),
      ),
    ).rejects.toThrow("Volcengine function request was replayed");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("reserves a request before awaiting execution", async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const { execute, port } = setup({
      execute: async (value) => {
        await pending;
        return responseFor(value, { success: true });
      },
    });
    const signedRequest = request();
    const first = port.executeFunction(signedRequest);

    await expect(port.executeFunction(signedRequest)).rejects.toThrow(
      "Volcengine function request was replayed",
    );
    release();
    await expect(first).resolves.toBeDefined();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("keeps a failed request reserved because its side-effect status is unknown", async () => {
    const { execute, port } = setup({
      execute: async () => {
        throw new Error("private downstream failure");
      },
    });
    const signedRequest = request();

    await expect(port.executeFunction(signedRequest)).rejects.toThrow(
      "private downstream failure",
    );
    await expect(port.executeFunction(signedRequest)).rejects.toThrow(
      "Volcengine function request was replayed",
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects functions outside the signed descriptor allowlist", async () => {
    const { execute, port } = setup();
    const denied = request({ functionName: "delete_note" });

    await expect(port.executeFunction(denied)).rejects.toThrow(
      "Volcengine function request is invalid",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires policies to exactly cover the signed function allowlist", () => {
    expect(() =>
      createVolcengineFunctionExecutionAuthority({
        descriptor: descriptor({
          functionPolicies: [functionPolicies()[0]],
        }),
        execute: vi.fn(),
      }),
    ).toThrow("must exactly cover the allowlist");
  });

  it("rejects argument fields and byte sizes outside the function policy", async () => {
    const { execute, port } = setup();

    await expect(
      port.executeFunction(
        request({ arguments: { title: "ok", privatePath: "secret" } }),
      ),
    ).rejects.toThrow("arguments violate policy");
    await expect(
      port.executeFunction(
        request({ arguments: { title: "x".repeat(2048) }, requestId: "large" }),
      ),
    ).rejects.toThrow("arguments is too large");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects results outside the function policy byte budget", async () => {
    const { execute, port } = setup({
      execute: async (value) =>
        responseFor(value, { content: "x".repeat(2048) }),
    });

    await expect(port.executeFunction(request())).rejects.toThrow(
      "result is too large",
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects unverified or result-mismatched audit evidence", async () => {
    for (const auditOverride of [
      { readbackVerified: false },
      { resultDigest: sha("other-result") },
      { functionPolicyDigest: sha("other-policy") },
    ]) {
      const { port } = setup({
        execute: async (value) =>
          responseFor(value, { success: true }, auditOverride),
      });
      await expect(port.executeFunction(request())).rejects.toThrow(
        "Volcengine function audit evidence is invalid",
      );
    }
  });

  it("does not invoke accessor arguments", async () => {
    const { execute, port } = setup();
    const accessor = vi.fn(() => "private value");
    const args = {};
    Object.defineProperty(args, "title", {
      enumerable: true,
      get: accessor,
    });
    const malicious = request();
    Object.defineProperty(malicious, "arguments", {
      enumerable: true,
      value: args,
    });

    await expect(port.executeFunction(malicious)).rejects.toThrow(
      "accessor fields",
    );
    expect(accessor).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
