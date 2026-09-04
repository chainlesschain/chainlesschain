import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  computeEvolutionEvalIsolatedTargetDigest,
  computeEvolutionEvalSupervisedResultDigest,
  computeEvolutionEvalTargetAuthorityDigest,
  EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
  EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA,
} from "../../src/lib/evolution/evolution-eval-gate.js";
import {
  createEvolutionEvalProcessSupervisor,
  isEvolutionEvalProcessSupervisor,
} from "../../src/lib/evolution/evolution-eval-process-supervisor.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
const digestBytes = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function trust(label) {
  return {
    algorithm: "ed25519",
    issuer: `${label}-issuer`,
    keyId: `${label}-key`,
    trustPolicyDigest: D(`${label}-policy`),
  };
}

async function fixture(source) {
  const root = await mkdtemp(join(tmpdir(), "cc-eval-process-"));
  const modulePath = join(root, "target.mjs");
  await writeFile(modulePath, source);
  const target = Object.freeze({
    schema: EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA,
    handlerId: "process-target",
    handlerRevision: "target-v1",
    operation: "cell-eval-run",
    isolation: "process",
    handlerArtifactDigest: digestBytes(source),
    authority: trust("target"),
  });
  const authorityDescriptor = {
    schema: EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
    handlerId: "process-supervisor",
    handlerRevision: "supervisor-v1",
    operation: "deadline-supervision",
    handlerArtifactDigest: D("supervisor-handler"),
    authority: trust("supervisor"),
  };
  const attest = async ({ purpose, payloadDigest }) => ({
    ...trust(purpose.includes("invocation") ? "invocation" : "supervisor"),
    value: D(`${purpose}:${payloadDigest}`),
  });
  const supervisor = await createEvolutionEvalProcessSupervisor({
    targets: new Map([
      [target.handlerId, { target, modulePath, exportName: "runTarget" }],
    ]),
    authorityDescriptor,
    supervisorRevision: "supervisor-v1",
    invocationRevision: "invocation-v1",
    revocationRevision: "revocation-v1",
    attestSupervisor: attest,
    attestInvocation: attest,
    attestRevocation: attest,
    verifyEnforcement: () => true,
    spawnProcess: spawn,
  });
  return { root, modulePath, target, supervisor };
}

function requests(target, deadlineAt, payload = { input: "hello" }) {
  const requestDigest = D("supervision-request");
  const capabilityDigest = D("capability");
  const invocationId = "target-invocation-a";
  return {
    supervision: {
      requestDigest,
      invocationNonce: "supervision-a",
      invocationId,
      capabilityDigest,
      operation: target.operation,
      requestedAt: new Date(Date.now() - 10).toISOString(),
      deadlineAt,
      payloadDigest: D("payload"),
      targetDigest: computeEvolutionEvalIsolatedTargetDigest(target),
      targetHandlerId: target.handlerId,
      targetRevision: target.handlerRevision,
      targetAuthorityDigest: computeEvolutionEvalTargetAuthorityDigest(target),
    },
    invocation: {
      requestDigest,
      capabilityDigest,
      invocationId,
      deadlineAt,
      payload,
      target,
    },
  };
}

function capability(supervisor, request) {
  return {
    async invoke(context) {
      const result = await supervisor.invokeTarget(request.invocation, context);
      return {
        value: result.value,
        resultDigest: computeEvolutionEvalSupervisedResultDigest(result.value),
        targetInvocationDigest: D(JSON.stringify(result.evidence)),
      };
    },
    async revoke({ mode }) {
      const receipt = await supervisor.revokeTarget({
        requestDigest: request.supervision.requestDigest,
        capabilityDigest: request.supervision.capabilityDigest,
        targetDigest: request.supervision.targetDigest,
        invocationId: request.supervision.invocationId,
        mode,
        requestedAt:
          mode === "hard-terminate"
            ? request.supervision.deadlineAt
            : new Date().toISOString(),
        deadlineAt: request.supervision.deadlineAt,
      });
      return {
        revocationDigest: D(JSON.stringify(receipt)),
        revocationMode: mode,
        wasActive: receipt.wasActive,
        activeInvocationTerminated: receipt.activeInvocationTerminated,
        terminatedAt: receipt.terminatedAt,
      };
    },
  };
}

describe("Evolution Eval process supervisor", () => {
  it("runs descriptor-bound module bytes in an isolated OS process", async () => {
    const { target, supervisor } = await fixture(
      "export async function runTarget(payload) { return { output: payload.input.toUpperCase(), pid: process.pid }; }",
    );
    expect(isEvolutionEvalProcessSupervisor(supervisor)).toBe(true);
    const request = requests(
      target,
      new Date(Date.now() + 2_000).toISOString(),
    );
    const result = await supervisor.run(
      request.supervision,
      capability(supervisor, request),
    );
    expect(result.value.output).toBe("HELLO");
    expect(result.value.pid).not.toBe(process.pid);
    expect(result.receipt.status).toBe("completed");
    expect(result.receipt.isolation).toBe("process");
  });

  it("hard-kills a hung child and prevents its late filesystem side effect", async () => {
    const source = [
      'import { writeFile } from "node:fs/promises";',
      "export async function runTarget(payload) {",
      "  await writeFile(payload.pidFile, String(process.pid));",
      "  await new Promise((resolve) => setTimeout(resolve, 1500));",
      '  await writeFile(payload.lateFile, "late");',
      "  return { late: true };",
      "}",
    ].join("\n");
    const { root, target, supervisor } = await fixture(source);
    const pidFile = join(root, "pid.txt");
    const lateFile = join(root, "late.txt");
    const request = requests(target, new Date(Date.now() + 500).toISOString(), {
      pidFile,
      lateFile,
    });
    const result = await supervisor.run(
      request.supervision,
      capability(supervisor, request),
    );
    expect(result.receipt.status).toBe("terminated");
    expect(result.receipt.activeInvocationTerminated).toBe(true);
    const childPid = Number(await readFile(pidFile, "utf8"));
    expect(childPid).not.toBe(process.pid);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await expect(readFile(lateFile, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects source drift before spawning the captured target", async () => {
    const { modulePath, target, supervisor } = await fixture(
      "export async function runTarget() { return { safe: true }; }",
    );
    await writeFile(
      modulePath,
      "export async function runTarget() { return { replaced: true }; }",
    );
    const request = requests(
      target,
      new Date(Date.now() + 2_000).toISOString(),
    );
    await expect(supervisor.invokeTarget(request.invocation)).rejects.toThrow(
      "module bytes differ",
    );
  });

  it("fails closed after a target process crash and observes process settlement", async () => {
    const source = [
      'import { writeFile } from "node:fs/promises";',
      "export async function runTarget(payload) {",
      "  await writeFile(payload.pidFile, String(process.pid));",
      '  throw new Error("grader crashed");',
      "}",
    ].join("\n");
    const { root, target, supervisor } = await fixture(source);
    const pidFile = join(root, "crashed-pid.txt");
    const request = requests(
      target,
      new Date(Date.now() + 2_000).toISOString(),
      { pidFile },
    );
    await expect(
      supervisor.run(request.supervision, capability(supervisor, request)),
    ).rejects.toThrow("evaluation target exited");
    const childPid = Number(await readFile(pidFile, "utf8"));
    expect(() => process.kill(childPid, 0)).toThrow();
  });
});
