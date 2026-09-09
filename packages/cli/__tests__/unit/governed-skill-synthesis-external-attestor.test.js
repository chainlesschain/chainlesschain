import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTATION_SCHEMA,
  GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTOR_SCHEMA,
  createGovernedSkillSynthesisExternalAttestationAuthority,
  isGovernedSkillSynthesisExternalAttestationAuthority,
} from "../../src/lib/evolution/governed-skill-synthesis-external-attestor.js";

const servicePath = fileURLToPath(
  new URL(
    "../../scripts/governed-learning-local-attestor-service.mjs",
    import.meta.url,
  ),
);
const roots = [];
const children = [];

function endpoint(root) {
  const id = randomBytes(12).toString("hex");
  return process.platform === "win32"
    ? `\\\\.\\pipe\\cc-evolution-attestor-${id}`
    : path.join(root, `cc-evolution-attestor-${id}.sock`);
}

function waitForLine(stream, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let carry = "";
    const timer = setTimeout(
      () => reject(new Error("local attestor did not become ready")),
      timeoutMs,
    );
    stream.on("data", (chunk) => {
      carry += chunk.toString("utf8");
      const newline = carry.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timer);
      resolve(carry.slice(0, newline));
    });
    stream.once("error", reject);
  });
}

async function startService({ endpoint: target, capabilityToken, serviceId }) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const child = spawn(process.execPath, [servicePath], {
    env:
      process.platform === "win32"
        ? {
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
            TEMP: process.env.TEMP,
            TMP: process.env.TMP,
          }
        : {},
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(child);
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.stdin.end(
    `${JSON.stringify({
      endpoint: target,
      capabilityToken,
      serviceId,
      privateKeyPem,
    })}\n`,
  );
  const ready = JSON.parse(await waitForLine(child.stdout));
  if (ready.ok !== true) throw new Error(`attestor failed: ${stderr}`);
  return { child, publicKeyPem, privateKeyPem };
}

const request = Object.freeze({
  receiptDigest: `sha256:${"a".repeat(64)}`,
  candidateDigest: `sha256:${"b".repeat(64)}`,
  descriptor: Object.freeze({
    authorityId: "authority:external-attestor-test",
    revision: 4,
    handlerArtifactDigest: `sha256:${"c".repeat(64)}`,
  }),
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(resolve, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("governed Skill synthesis external attestor", () => {
  it("keeps the private key outside the CLI authority and verifies the service signature", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-external-attestor-"),
    );
    roots.push(root);
    const target = endpoint(root);
    const capabilityToken = randomBytes(32).toString("base64url");
    const serviceId = "kms.local-attestor.test";
    const service = await startService({
      endpoint: target,
      capabilityToken,
      serviceId,
    });
    const authority = createGovernedSkillSynthesisExternalAttestationAuthority({
      endpoint: target,
      capabilityToken,
      publicKeyPem: service.publicKeyPem,
      serviceId,
      timeoutMs: 5_000,
    });
    const attestation = await authority.attestReceipt(request);

    expect(
      isGovernedSkillSynthesisExternalAttestationAuthority(authority),
    ).toBe(true);
    expect(authority.descriptor).toMatchObject({
      schema: GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTOR_SCHEMA,
      algorithm: "Ed25519",
      isolation: "external-service",
      serviceId,
      transport: "local-ipc-v1",
    });
    expect(attestation).toMatchObject({
      schema: GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTATION_SCHEMA,
      attestorSchema: GOVERNED_SKILL_SYNTHESIS_EXTERNAL_ATTESTOR_SCHEMA,
      isolation: "external-service",
    });
    expect(JSON.stringify(authority)).not.toContain(service.privateKeyPem);
    expect(JSON.stringify(authority)).not.toContain(capabilityToken);
    expect(() =>
      createGovernedSkillSynthesisExternalAttestationAuthority({
        endpoint: target,
        capabilityToken,
        publicKeyPem: service.publicKeyPem,
        privateKeyPem: service.privateKeyPem,
        serviceId,
      }),
    ).toThrow("unexpected fields");
    expect(() =>
      createGovernedSkillSynthesisExternalAttestationAuthority({
        endpoint: target,
        capabilityToken,
        publicKeyPem: service.privateKeyPem,
        serviceId,
      }),
    ).toThrow("must not contain a private key");
    await expect(
      authority.verifyAttestation({ ...request, attestation }),
    ).resolves.toBe(true);
    await expect(
      authority.verifyAttestation({
        ...request,
        candidateDigest: `sha256:${"d".repeat(64)}`,
        attestation,
      }),
    ).resolves.toBe(false);
  });

  it("rejects an invalid capability and unsafe endpoint substitution", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-external-deny-"),
    );
    roots.push(root);
    const target = endpoint(root);
    const service = await startService({
      endpoint: target,
      capabilityToken: randomBytes(32).toString("base64url"),
      serviceId: "kms.local-attestor.deny",
    });
    const authority = createGovernedSkillSynthesisExternalAttestationAuthority({
      endpoint: target,
      capabilityToken: randomBytes(32).toString("base64url"),
      publicKeyPem: service.publicKeyPem,
      serviceId: "kms.local-attestor.deny",
    });
    await expect(authority.attestReceipt(request)).rejects.toThrow();
    expect(() =>
      createGovernedSkillSynthesisExternalAttestationAuthority({
        endpoint:
          process.platform === "win32"
            ? "\\\\.\\pipe\\untrusted"
            : "relative.sock",
        capabilityToken: randomBytes(32).toString("base64url"),
        publicKeyPem: service.publicKeyPem,
        serviceId: "kms.local-attestor.deny",
      }),
    ).toThrow("endpoint");
  });
});
