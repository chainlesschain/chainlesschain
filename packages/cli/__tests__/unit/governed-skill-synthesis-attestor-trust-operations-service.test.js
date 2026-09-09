import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  createGovernedSkillSynthesisAttestorTrustOperationsClient,
  isGovernedSkillSynthesisAttestorTrustOperationsClient,
} from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-operations-client.js";
import { createGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer } from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-operations.js";

const servicePath = fileURLToPath(
  new URL(
    "../../scripts/governed-learning-local-attestor-trust-operations-service.mjs",
    import.meta.url,
  ),
);
const roots = [];
const children = [];

function endpoint(root) {
  const id = randomBytes(12).toString("hex");
  return process.platform === "win32"
    ? `\\\\.\\pipe\\cc-evolution-attestor-trust-ops-${id}`
    : path.join(root, `cc-evolution-attestor-trust-ops-${id}.sock`);
}

function waitForLine(stream, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let carry = "";
    const timer = setTimeout(
      () => reject(new Error("operations service did not become ready")),
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

async function startService(root, operator, target, capabilityToken) {
  fs.mkdirSync(path.join(root, "witness"));
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
      artifactRoot: path.join(root, "artifacts"),
      authorityNamespace: "attestor-trust-ops-test",
      authorizationStreamId: "attestor-trust-authorizations",
      capabilityToken,
      endpoint: target,
      ledgerAuthorityRoot: path.join(root, "authority"),
      ledgerRoot: path.join(root, "events"),
      operatorIdentities: [
        {
          tenantId: "tenant:attestor-trust-ops-service-test",
          operatorId: "operator:owner",
          publicKeyPem: operator.publicKey.export({
            type: "spki",
            format: "pem",
          }),
        },
      ],
      policyId: "policy:personal-ai",
      requiredApprovals: 1,
      revision: 1,
      secrets: {
        artifact: randomBytes(32).toString("base64url"),
        ledger: randomBytes(32).toString("base64url"),
        witness: randomBytes(32).toString("base64url"),
      },
      trustDescriptor: {
        tenantId: "tenant:attestor-trust-ops-service-test",
        artifactTenantId: "tenant:attestor-trust-ops-service-test",
        streamId: "attestor-trust-lifecycle",
        audience: "evolution-runtime",
        purpose: "evolution-ledger",
      },
      witnessFile: path.join(root, "witness", "checkpoint.json"),
      witnessId: "attestor-trust-ops-test-witness",
    })}\n`,
  );
  const ready = JSON.parse(await waitForLine(child.stdout));
  if (ready.ok !== true) throw new Error(`service failed: ${stderr}`);
  return { child, descriptor: ready.descriptor };
}

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

describe("attestor trust operations local service", () => {
  it("keeps the writer in another process and accepts only signed IPC work", async () => {
    const root = fs.mkdtempSync(
      path.join(
        fs.realpathSync.native(os.tmpdir()),
        "cc-attestor-ops-service-",
      ),
    );
    roots.push(root);
    const operator = generateKeyPairSync("ed25519");
    const attestor = generateKeyPairSync("ed25519");
    const target = endpoint(root);
    const capabilityToken = randomBytes(32).toString("base64url");
    const started = await startService(root, operator, target, capabilityToken);
    expect(started.child.pid).not.toBe(process.pid);
    expect(JSON.stringify(started.descriptor)).not.toContain("publicKeyPem");
    const client = createGovernedSkillSynthesisAttestorTrustOperationsClient({
      endpoint: target,
      capabilityToken,
      descriptor: started.descriptor,
      timeoutMs: 10_000,
    });
    expect(isGovernedSkillSynthesisAttestorTrustOperationsClient(client)).toBe(
      true,
    );
    expect(client).not.toHaveProperty("registerKey");
    expect(client.descriptor).toMatchObject({
      isolation: "external-service",
      transport: "local-ipc-v1",
      service: {
        approvalMode: "single-operator",
        requiredApprovals: 1,
      },
    });
    const request = await client.prepare({
      operation: "register",
      serviceId: "kms.attestor-ops-service.test",
      publicKey: attestor.publicKey.export({ type: "spki", format: "pem" }),
    });
    const issuer =
      createGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer({
        tenantId: "tenant:attestor-trust-ops-service-test",
        operatorId: "operator:owner",
        privateKey: operator.privateKey,
      });
    const approval = issuer.issue(request);
    const result = await client.execute({ request, approvals: [approval] });
    expect(result).toMatchObject({
      persistence: {
        authenticated: true,
        durable: true,
        recovered: false,
        eventSequence: 1,
      },
      lifecycle: {
        authenticated: true,
        durable: true,
        recovered: false,
        operation: "register",
      },
    });
    await expect(
      client.execute({ request, approvals: [approval] }),
    ).resolves.toMatchObject({
      persistence: { recovered: true },
      lifecycle: { recovered: true },
    });

    const unauthorized =
      createGovernedSkillSynthesisAttestorTrustOperationsClient({
        endpoint: target,
        capabilityToken: randomBytes(32).toString("base64url"),
        descriptor: started.descriptor,
        timeoutMs: 10_000,
      });
    await expect(
      unauthorized.prepare({
        operation: "revoke",
        serviceId: "kms.attestor-ops-service.test",
        keyId: result.lifecycle.keyId,
        reason: "must not reach the writer",
      }),
    ).rejects.toMatchObject({
      code: "CC_ATTESTOR_TRUST_OPERATIONS_DENIED",
    });
  }, 60_000);
});
