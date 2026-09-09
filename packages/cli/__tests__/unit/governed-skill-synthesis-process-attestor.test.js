import { generateKeyPairSync, sign } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import executionBroker from "../../src/lib/process-execution-broker/index.js";
import {
  GOVERNED_SKILL_SYNTHESIS_EVALUATION_ATTESTATION_SCHEMA,
  GOVERNED_SKILL_SYNTHESIS_PROCESS_ATTESTOR_SCHEMA,
  createGovernedSkillSynthesisProcessAttestationAuthority,
  isGovernedSkillSynthesisProcessAttestationAuthority,
} from "../../src/lib/evolution/governed-skill-synthesis-process-attestor.js";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

function childFixture(onInput) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let input = "";
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      input += chunk.toString("utf8");
      callback();
    },
    final(callback) {
      queueMicrotask(() => onInput({ child, input }));
      callback();
    },
  });
  child.kill = vi.fn((signal) => {
    queueMicrotask(() => child.emit("close", null, signal));
    return true;
  });
  return child;
}

const request = Object.freeze({
  receiptDigest: `sha256:${"a".repeat(64)}`,
  candidateDigest: `sha256:${"b".repeat(64)}`,
  descriptor: Object.freeze({
    authorityId: "authority:process-attestor-test",
    revision: 2,
    handlerArtifactDigest: `sha256:${"c".repeat(64)}`,
  }),
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("governed Skill synthesis process attestor", () => {
  it("signs in a fixed process and verifies with only the public key", async () => {
    const keyPair = keys();
    let launch;
    let workerRequest;
    vi.spyOn(executionBroker, "spawn").mockImplementation(
      (command, args, options) => {
        launch = { command, args, options };
        return childFixture(({ child, input }) => {
          workerRequest = JSON.parse(input);
          const message = Buffer.from(
            `${GOVERNED_SKILL_SYNTHESIS_EVALUATION_ATTESTATION_SCHEMA}\0${canonical(
              {
                receiptDigest: workerRequest.receiptDigest,
                candidateDigest: workerRequest.candidateDigest,
                evaluatorDescriptor: workerRequest.evaluatorDescriptor,
                attestor: workerRequest.attestor,
              },
            )}`,
          );
          const { schema: attestorSchema, ...execution } =
            workerRequest.attestor;
          child.stdout.end(
            `${JSON.stringify({
              ok: true,
              attestation: {
                schema: GOVERNED_SKILL_SYNTHESIS_EVALUATION_ATTESTATION_SCHEMA,
                attestorSchema,
                ...execution,
                signature: sign(null, message, keyPair.privateKey).toString(
                  "base64",
                ),
              },
            })}\n`,
          );
          child.emit("close", 0, null);
        });
      },
    );
    const authority = createGovernedSkillSynthesisProcessAttestationAuthority({
      privateKeyPem: keyPair.privateKeyPem,
      publicKeyPem: keyPair.publicKeyPem,
      timeoutMs: 1_000,
      memoryLimitMb: 64,
    });
    const attestation = await authority.attestReceipt(request);

    expect(isGovernedSkillSynthesisProcessAttestationAuthority(authority)).toBe(
      true,
    );
    expect(authority.descriptor).toMatchObject({
      schema: GOVERNED_SKILL_SYNTHESIS_PROCESS_ATTESTOR_SCHEMA,
      algorithm: "Ed25519",
      isolation: "process",
      credentialDelivery: "single-use-broker-reference",
      credentialTarget: "governed-skill-attestor.local",
      credentialMaxUses: 1,
      credentialTtlMs: 6_000,
      persistentProcessAuditRequired: true,
    });
    expect(launch.command).toBe(process.execPath);
    expect(launch.args.join(" ")).not.toContain(keyPair.privateKeyPem);
    expect(JSON.stringify(workerRequest)).not.toContain(keyPair.privateKeyPem);
    expect(launch.options).toMatchObject({
      credentialTargetHost: "governed-skill-attestor.local",
      credentialMaxUses: 1,
      credentialTtlMs: 6_000,
      requirePersistentAudit: true,
      sandboxPolicy: {
        profile: "network-only",
        requiredBoundaries: [
          "privilege-reduction",
          "process-tree",
          "resource-limits",
        ],
      },
    });
    expect(await authority.verifyAttestation({ ...request, attestation })).toBe(
      true,
    );
    expect(
      await authority.verifyAttestation({
        ...request,
        receiptDigest: `sha256:${"d".repeat(64)}`,
        attestation,
      }),
    ).toBe(false);
    expect(
      await authority.verifyAttestation({
        ...request,
        candidateDigest: `sha256:${"e".repeat(64)}`,
        attestation,
      }),
    ).toBe(false);
  });

  it("hard-terminates a signer that exceeds its deadline", async () => {
    vi.useFakeTimers();
    const keyPair = keys();
    let child;
    vi.spyOn(executionBroker, "spawn").mockImplementation(() => {
      child = childFixture(() => {});
      return child;
    });
    const authority = createGovernedSkillSynthesisProcessAttestationAuthority({
      privateKeyPem: keyPair.privateKeyPem,
      publicKeyPem: keyPair.publicKeyPem,
      timeoutMs: 1_000,
    });
    const pending = authority.attestReceipt(request);
    const rejection = expect(pending).rejects.toMatchObject({
      code: "LEARNING_SYNTHESIS_PROCESS_ATTESTOR_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await rejection;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("rejects mismatched keys and does not brand plain objects", () => {
    const first = keys();
    const second = keys();
    expect(() =>
      createGovernedSkillSynthesisProcessAttestationAuthority({
        privateKeyPem: first.privateKeyPem,
        publicKeyPem: second.publicKeyPem,
      }),
    ).toThrow("does not match");
    expect(
      isGovernedSkillSynthesisProcessAttestationAuthority({
        attestReceipt: vi.fn(),
        verifyAttestation: vi.fn(),
      }),
    ).toBe(false);
  });
});
