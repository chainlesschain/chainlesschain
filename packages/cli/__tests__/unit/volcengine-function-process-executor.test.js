import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
  EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA,
} from "../../src/lib/evolution/evolution-eval-gate.js";
import { createEvolutionEvalChildEvidenceStorePort } from "../../src/lib/evolution/evolution-eval-child-evidence-ledger-adapter.js";
import { createEvolutionEvalProcessSupervisor } from "../../src/lib/evolution/evolution-eval-process-supervisor.js";
import {
  VOLCENGINE_FUNCTION_PROCESS_EXECUTOR_SCHEMA,
  VOLCENGINE_FUNCTION_PROCESS_OPERATION,
  captureVolcengineFunctionProcessResult,
  createVolcengineFunctionProcessExecutor,
  inspectVolcengineFunctionProcessExecutor,
} from "../../src/lib/evolution/volcengine-function-process-executor.js";
import {
  VOLCENGINE_FUNCTION_AUDIT_EVIDENCE_SCHEMA,
  VOLCENGINE_FUNCTION_AUDIT_MODE,
  VOLCENGINE_FUNCTION_EXECUTOR_TYPE,
  VOLCENGINE_FUNCTION_PROCESS_AUTHORITY_SCHEMA,
  VOLCENGINE_FUNCTION_PROCESS_ISOLATION,
  VOLCENGINE_FUNCTION_PROCESS_RECEIPT_SCHEMA,
  VOLCENGINE_FUNCTION_PURPOSE,
  VOLCENGINE_FUNCTION_REQUEST_SCHEMA,
  captureVolcengineFunctionExecutionAuthority,
  createVolcengineFunctionProcessExecutionAuthority,
} from "../../src/lib/evolution/volcengine-function-execution-authority.js";
import {
  VOLCENGINE_FUNCTION_REPLAY_MODE,
  VOLCENGINE_FUNCTION_REPLAY_STORE_SCHEMA,
  VOLCENGINE_FUNCTION_REVOCATION_MODE,
  createVolcengineFunctionReplayStore,
} from "../../src/lib/evolution/volcengine-function-replay-store.js";

const roots = [];
const sha = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
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

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function trust(label) {
  return {
    algorithm: "ed25519",
    issuer: `${label}-issuer`,
    keyId: `${label}-key`,
    trustPolicyDigest: sha(`${label}-policy`),
  };
}

function evidenceStore() {
  const records = [];
  const descriptor = {
    tenantId: "tenant:function-process",
    streamId: "eval-child-stream:function-process",
    authorityId: "authority:function-child-evidence",
    revision: 1,
    handlerArtifactDigest: sha("function-child-evidence-handler"),
  };
  const port = createEvolutionEvalChildEvidenceStorePort({
    descriptor,
    retain: async (request) => {
      records.push(structuredClone(request));
      return {
        authenticated: true,
        durable: true,
        kind: request.kind,
        receiptDigest: request.receiptDigest,
      };
    },
    resolve: async (request) => {
      const record = records.find(
        (entry) => entry.receiptDigest === request.receiptDigest,
      );
      return {
        authenticated: true,
        durable: true,
        ...descriptor,
        kind: request.kind,
        receiptDigest: request.receiptDigest,
        evidence: structuredClone(record.evidence),
      };
    },
  });
  return { port, records };
}

async function fixture(source, { allowWrites = false, durable = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "cc-function-process-"));
  roots.push(root);
  const modulePath = join(root, "function-target.mjs");
  await writeFile(modulePath, source);
  const target = Object.freeze({
    schema: EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA,
    handlerId: "volcengine-function-target",
    handlerRevision: "function-target-v1",
    operation: VOLCENGINE_FUNCTION_PROCESS_OPERATION,
    isolation: "process",
    handlerArtifactDigest: sha(source),
    authority: trust("function-target"),
  });
  const store = durable ? evidenceStore() : null;
  const attest = async ({ purpose, payloadDigest }) => ({
    ...trust(`attest-${purpose}`),
    value: sha(`${purpose}:${payloadDigest}`),
  });
  const supervisor = createEvolutionEvalProcessSupervisor({
    targets: new Map([
      [
        target.handlerId,
        {
          target,
          modulePath,
          exportName: "executeFunction",
          sandboxPolicy: {
            fsWrite: allowWrites ? [root] : [],
            memoryLimitMb: 128,
          },
        },
      ],
    ]),
    authorityDescriptor: {
      schema: EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
      handlerId: "function-process-supervisor",
      handlerRevision: "function-process-supervisor-v1",
      operation: "deadline-supervision",
      handlerArtifactDigest: sha("function-process-supervisor"),
      authority: trust("function-process-supervisor"),
    },
    supervisorRevision: "function-process-supervisor-v1",
    invocationRevision: "function-invocation-v1",
    revocationRevision: "function-revocation-v1",
    attestSupervisor: attest,
    attestInvocation: attest,
    attestRevocation: attest,
    verifyEnforcement: () => true,
    spawnProcess: spawn,
    childEvidenceStore: store?.port ?? null,
  });
  return { root, target, supervisor, store };
}

function request(deadlineAt, overrides = {}) {
  return Object.freeze({
    requestDigest: sha(`request:${deadlineAt}`),
    deadlineAt,
    functionName: "create_note",
    arguments: { title: "bounded title" },
    ...overrides,
  });
}

async function waitForFile(path, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("timed out waiting for child process evidence");
}

describe("Volcengine function process executor", () => {
  it("executes signed target bytes in a child and retains request-bound supervision evidence", async () => {
    const { target, supervisor, store } = await fixture(
      [
        "export async function executeFunction(value) {",
        "  return {",
        "    toolResult: { functionName: value.functionName, pid: process.pid },",
        "    auditEvidence: { requestDigest: value.requestDigest },",
        "  };",
        "}",
      ].join("\n"),
    );
    const executor = createVolcengineFunctionProcessExecutor({
      supervisor,
      target,
    });
    const value = request(new Date(Date.now() + 2_000).toISOString());
    const result = await executor(value, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      toolResult: {
        functionName: "create_note",
        pid: expect.any(Number),
      },
      auditEvidence: { requestDigest: value.requestDigest },
    });
    expect(result.toolResult.pid).not.toBe(process.pid);
    expect(
      captureVolcengineFunctionProcessResult(executor, result),
    ).toMatchObject({
      schema: "chainlesschain.volcengine-function-process-evidence/v1",
      requestDigest: value.requestDigest,
      supervisionReceiptDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      evidenceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(() =>
      captureVolcengineFunctionProcessResult(executor, result),
    ).toThrow("result from the captured");
    expect(inspectVolcengineFunctionProcessExecutor(executor)).toMatchObject({
      schema: VOLCENGINE_FUNCTION_PROCESS_EXECUTOR_SCHEMA,
      mode: "process",
      operation: VOLCENGINE_FUNCTION_PROCESS_OPERATION,
      handlerArtifactDigest: target.handlerArtifactDigest,
      supervisorAuthorityDigest: expect.stringMatching(
        /^sha256:[a-f0-9]{64}$/u,
      ),
    });
    expect(store.records.map(({ kind }) => kind).sort()).toEqual([
      "invocation",
      "revocation",
      "supervision",
    ]);
    expect(
      store.records.every(
        ({ evidence }) => evidence.requestDigest === value.requestDigest,
      ),
    ).toBe(true);
  });

  it("hard-kills a function implementation that ignores cancellation and prevents its late side effect", async () => {
    const source = [
      'import { writeFile } from "node:fs/promises";',
      "export async function executeFunction(value) {",
      "  await writeFile(value.arguments.pidFile, String(process.pid));",
      "  await new Promise((resolve) => setTimeout(resolve, 1400));",
      '  await writeFile(value.arguments.lateFile, "late");',
      "  return { toolResult: { late: true }, auditEvidence: {} };",
      "}",
    ].join("\n");
    const { root, target, supervisor, store } = await fixture(source, {
      allowWrites: true,
    });
    const executor = createVolcengineFunctionProcessExecutor({
      supervisor,
      target,
    });
    const pidFile = join(root, "pid.txt");
    const lateFile = join(root, "late.txt");
    const value = request(new Date(Date.now() + 600).toISOString(), {
      arguments: { pidFile, lateFile },
    });

    await expect(
      executor(value, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      code: "CC_VOLCENGINE_FUNCTION_DEADLINE_EXCEEDED",
    });
    const childPid = Number(await readFile(pidFile, "utf8"));
    expect(childPid).not.toBe(process.pid);
    expect(() => process.kill(childPid, 0)).toThrow();
    await new Promise((resolve) => setTimeout(resolve, 950));
    await expect(readFile(lateFile, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(store.records.map(({ kind }) => kind).sort()).toEqual([
      "revocation",
      "supervision",
    ]);
  });

  it("hard-kills the child when its parent authority aborts before the deadline", async () => {
    const source = [
      'import { writeFile } from "node:fs/promises";',
      "export async function executeFunction(value) {",
      "  await writeFile(value.arguments.pidFile, String(process.pid));",
      "  await new Promise((resolve) => setTimeout(resolve, 1200));",
      '  await writeFile(value.arguments.lateFile, "late");',
      "  return { toolResult: { late: true }, auditEvidence: {} };",
      "}",
    ].join("\n");
    const { root, target, supervisor, store } = await fixture(source, {
      allowWrites: true,
    });
    const executor = createVolcengineFunctionProcessExecutor({
      supervisor,
      target,
    });
    const pidFile = join(root, "abort-pid.txt");
    const lateFile = join(root, "abort-late.txt");
    const value = request(new Date(Date.now() + 4_000).toISOString(), {
      arguments: { pidFile, lateFile },
    });
    const controller = new AbortController();
    const execution = executor(value, { signal: controller.signal });
    const childPid = Number(await waitForFile(pidFile));
    const abortReason = new Error("authority revoked");
    const rejection = expect(execution).rejects.toBe(abortReason);
    controller.abort(abortReason);

    await rejection;
    expect(childPid).not.toBe(process.pid);
    expect(() => process.kill(childPid, 0)).toThrow();
    await new Promise((resolve) => setTimeout(resolve, 1_250));
    await expect(readFile(lateFile, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toMatchObject({
      kind: "revocation",
      evidence: {
        requestDigest: value.requestDigest,
        mode: "hard-terminate",
        wasActive: true,
        activeInvocationTerminated: true,
        revokedAt: expect.any(String),
      },
    });
    expect(Date.parse(store.records[0].evidence.revokedAt)).toBeLessThan(
      Date.parse(value.deadlineAt),
    );
  });

  it("composes with the replay-protected function authority without exposing an in-process implementation", async () => {
    const source = [
      'import { createHash } from "node:crypto";',
      "function canonical(value) {",
      '  if (value === null || typeof value !== "object") return JSON.stringify(value);',
      '  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;',
      '  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;',
      "}",
      "function digest(domain, value) {",
      '  return `sha256:${createHash("sha256").update(`${domain}\\0`).update(canonical(value)).digest("hex")}`;',
      "}",
      "export async function executeFunction(value) {",
      '  const toolResult = { noteId: "note-process", pid: process.pid, success: true };',
      "  return {",
      "    toolResult,",
      "    auditEvidence: {",
      `      schema: ${JSON.stringify(VOLCENGINE_FUNCTION_AUDIT_EVIDENCE_SCHEMA)},`,
      '      authorityId: "authority:process",',
      '      tenantId: "tenant:process",',
      "      handlerArtifactDigest: value.handlerArtifactDigest,",
      '      policyRevision: "policy-process-1",',
      "      requestId: value.requestId,",
      "      requestDigest: value.requestDigest,",
      "      functionPolicyDigest: value.functionPolicyDigest,",
      "      replayReservationDigest: value.replayReservationDigest,",
      "      deadlineAt: value.deadlineAt,",
      '      resultDigest: digest("chainlesschain.volcengine-function-result/v1", toolResult),',
      `      auditEventDigest: ${JSON.stringify(sha("process-audit-event"))},`,
      `      durabilityReceiptDigest: ${JSON.stringify(sha("process-audit-durability"))},`,
      "      authenticated: true,",
      "      durable: true,",
      "      readbackVerified: true,",
      "      completedAt: new Date().toISOString(),",
      "    },",
      "  };",
      "}",
    ].join("\n");
    const { root, target, supervisor } = await fixture(source);
    const executor = createVolcengineFunctionProcessExecutor({
      supervisor,
      target,
    });
    const processDescriptor =
      inspectVolcengineFunctionProcessExecutor(executor);
    const functionPolicies = [
      {
        functionName: "create_note",
        allowedArgumentKeys: ["title"],
        maxArgumentBytes: 1024,
        maxResultBytes: 1024,
        maxExecutionMs: 3_000,
      },
    ];
    const authorityDescriptor = {
      schema: VOLCENGINE_FUNCTION_PROCESS_AUTHORITY_SCHEMA,
      authorityId: "authority:process",
      revocationAuthorityId: "function-revocation:process",
      tenantId: "tenant:process",
      handlerArtifactDigest: target.handlerArtifactDigest,
      policyRevision: "policy-process-1",
      replayStoreId: "replay:process",
      replayRetentionMs: 65_000,
      replayMode: VOLCENGINE_FUNCTION_REPLAY_MODE,
      revocationMode: VOLCENGINE_FUNCTION_REVOCATION_MODE,
      purpose: VOLCENGINE_FUNCTION_PURPOSE,
      allowedFunctions: ["create_note"],
      functionPolicies,
      auditMode: VOLCENGINE_FUNCTION_AUDIT_MODE,
      executionIsolation: VOLCENGINE_FUNCTION_PROCESS_ISOLATION,
      processTargetDigest: processDescriptor.targetDigest,
      processTargetAuthorityDigest: processDescriptor.targetAuthorityDigest,
      processSupervisorAuthorityDigest:
        processDescriptor.supervisorAuthorityDigest,
    };
    const replayStore = createVolcengineFunctionReplayStore({
      rootDir: join(root, "replay"),
      descriptor: {
        schema: VOLCENGINE_FUNCTION_REPLAY_STORE_SCHEMA,
        replayStoreId: authorityDescriptor.replayStoreId,
        authorityId: authorityDescriptor.authorityId,
        revocationAuthorityId: authorityDescriptor.revocationAuthorityId,
        tenantId: authorityDescriptor.tenantId,
        handlerArtifactDigest: authorityDescriptor.handlerArtifactDigest,
        policyRevision: authorityDescriptor.policyRevision,
        retentionMs: authorityDescriptor.replayRetentionMs,
        mode: authorityDescriptor.replayMode,
        revocationMode: authorityDescriptor.revocationMode,
      },
    });
    expect(() =>
      createVolcengineFunctionProcessExecutionAuthority({
        descriptor: {
          ...authorityDescriptor,
          processTargetDigest: sha("substituted-process-target"),
        },
        execute: executor,
        replayStore,
      }),
    ).toThrow("process executor binding does not match authority");
    expect(() =>
      createVolcengineFunctionProcessExecutionAuthority({
        descriptor: authorityDescriptor,
        execute: async () => ({ toolResult: {}, auditEvidence: {} }),
        replayStore,
      }),
    ).toThrow("branded Volcengine function process executor");
    const authority = createVolcengineFunctionProcessExecutionAuthority({
      descriptor: authorityDescriptor,
      execute: executor,
      replayStore,
    });
    const requestedAt = new Date().toISOString();
    const deadlineAt = new Date(Date.parse(requestedAt) + 3_000).toISOString();
    const argumentsValue = { title: "bounded title" };
    const requestCore = {
      schema: VOLCENGINE_FUNCTION_REQUEST_SCHEMA,
      authorityId: authorityDescriptor.authorityId,
      revocationAuthorityId: authorityDescriptor.revocationAuthorityId,
      tenantId: authorityDescriptor.tenantId,
      handlerArtifactDigest: authorityDescriptor.handlerArtifactDigest,
      policyRevision: authorityDescriptor.policyRevision,
      replayStoreId: authorityDescriptor.replayStoreId,
      revocationMode: authorityDescriptor.revocationMode,
      actorDid: "did:test:process-operator",
      purpose: VOLCENGINE_FUNCTION_PURPOSE,
      requestId: "process-request-1",
      senderId: 9,
      executorType: VOLCENGINE_FUNCTION_EXECUTOR_TYPE,
      functionName: "create_note",
      functionPolicyDigest: domainDigest(
        "chainlesschain.volcengine-function-policy/v1",
        functionPolicies[0],
      ),
      arguments: argumentsValue,
      argumentsDigest: domainDigest(
        "chainlesschain.volcengine-function-arguments/v1",
        argumentsValue,
      ),
      requestedAt,
      deadlineAt,
    };
    const port = captureVolcengineFunctionExecutionAuthority(authority);
    expect(port.descriptor).toMatchObject({
      schema: VOLCENGINE_FUNCTION_PROCESS_AUTHORITY_SCHEMA,
      executionIsolation: VOLCENGINE_FUNCTION_PROCESS_ISOLATION,
      processTargetDigest: processDescriptor.targetDigest,
      processTargetAuthorityDigest: processDescriptor.targetAuthorityDigest,
      processSupervisorAuthorityDigest:
        processDescriptor.supervisorAuthorityDigest,
    });
    const result = await port.executeFunction({
      ...requestCore,
      requestDigest: domainDigest(
        "chainlesschain.volcengine-function-request/v6",
        requestCore,
      ),
    });

    expect(result.toolResult).toMatchObject({
      noteId: "note-process",
      success: true,
      pid: expect.any(Number),
    });
    expect(result.toolResult.pid).not.toBe(process.pid);
    expect(result.receipt).toMatchObject({
      schema: VOLCENGINE_FUNCTION_PROCESS_RECEIPT_SCHEMA,
      requestId: "process-request-1",
      executionIsolation: VOLCENGINE_FUNCTION_PROCESS_ISOLATION,
      processTargetDigest: processDescriptor.targetDigest,
      processTargetAuthorityDigest: processDescriptor.targetAuthorityDigest,
      processSupervisorAuthorityDigest:
        processDescriptor.supervisorAuthorityDigest,
      processSupervisionReceiptDigest: expect.stringMatching(
        /^sha256:[a-f0-9]{64}$/u,
      ),
      processEvidenceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      authenticated: true,
      durable: true,
      readbackVerified: true,
    });
  });

  it("requires durable child evidence and rejects an unrelated target operation", async () => {
    const source =
      "export async function executeFunction() { return { safe: true }; }";
    const withoutStore = await fixture(source, { durable: false });
    expect(() =>
      createVolcengineFunctionProcessExecutor({
        supervisor: withoutStore.supervisor,
        target: withoutStore.target,
      }),
    ).toThrow("requires a durable child evidence store");

    const withStore = await fixture(source);
    expect(() =>
      createVolcengineFunctionProcessExecutor({
        supervisor: withStore.supervisor,
        target: { ...withStore.target, operation: "pm-exploration-run" },
      }),
    ).toThrow("requires a process-isolated execution target");

    const executor = createVolcengineFunctionProcessExecutor({
      supervisor: withStore.supervisor,
      target: withStore.target,
    });
    let requestAccesses = 0;
    const accessorRequest = {};
    Object.defineProperty(accessorRequest, "deadlineAt", {
      enumerable: true,
      get() {
        requestAccesses += 1;
        return new Date(Date.now() + 2_000).toISOString();
      },
    });
    await expect(
      executor(accessorRequest, { signal: new AbortController().signal }),
    ).rejects.toThrow("bounded plain JSON data");
    expect(requestAccesses).toBe(0);

    let contextAccesses = 0;
    const accessorContext = {};
    Object.defineProperty(accessorContext, "signal", {
      enumerable: true,
      get() {
        contextAccesses += 1;
        return new AbortController().signal;
      },
    });
    await expect(
      executor(
        request(new Date(Date.now() + 2_000).toISOString()),
        accessorContext,
      ),
    ).rejects.toThrow("requires an abort signal");
    expect(contextAccesses).toBe(0);
  });
});
