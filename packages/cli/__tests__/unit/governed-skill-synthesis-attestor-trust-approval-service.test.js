import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_IPC_SCHEMA,
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_SERVICE_SCHEMA,
  createGovernedSkillSynthesisAttestorTrustApprovalClient,
  isGovernedSkillSynthesisAttestorTrustApprovalClient,
} from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-approval-client.js";
import { createGovernedSkillSynthesisAttestorTrustIpcAuthorization } from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-ipc-capability.js";
import {
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATION_REQUEST_SCHEMA,
  digestGovernedSkillSynthesisAttestorTrustOperationRequest,
} from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-operations.js";
import {
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_REQUEST_SCHEMA,
  digestGovernedSkillSynthesisAttestorTrustOperatorRegistryChangeRequest,
} from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-operator-registry.js";

const servicePath = fileURLToPath(
  new URL(
    "../../scripts/governed-learning-local-attestor-trust-approval-service.mjs",
    import.meta.url,
  ),
);
const roots = [];
const children = [];

function endpoint(root) {
  const id = randomBytes(12).toString("hex");
  return process.platform === "win32"
    ? `\\\\.\\pipe\\cc-evolution-attestor-trust-approval-${id}`
    : path.join(root, `cc-evolution-attestor-trust-approval-${id}.sock`);
}

function keyIdentity(publicKey) {
  const bytes = publicKey.export({ type: "spki", format: "der" });
  return {
    keyId: `key:ed25519:${createHash("sha256").update(bytes).digest("hex")}`,
    publicKeySpki: bytes.toString("base64url"),
  };
}

function normalRequest(tenantId, currentTime) {
  const target = keyIdentity(generateKeyPairSync("ed25519").publicKey);
  const core = {
    schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATION_REQUEST_SCHEMA,
    tenantId,
    serviceId: "kms.personal-ai.attestor",
    operation: "register",
    keyId: target.keyId,
    publicKeySpki: target.publicKeySpki,
    priorKeyId: null,
    reason: null,
    policyDigest: `sha256:${"a".repeat(64)}`,
    requiredApprovals: 1,
    requestedAt: new Date(currentTime).toISOString(),
    expiresAt: new Date(currentTime + 5 * 60 * 1000).toISOString(),
  };
  return {
    ...core,
    requestDigest:
      digestGovernedSkillSynthesisAttestorTrustOperationRequest(core),
  };
}

function operatorRequest(tenantId, currentTime) {
  const target = keyIdentity(generateKeyPairSync("ed25519").publicKey);
  const core = {
    schema:
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_REQUEST_SCHEMA,
    tenantId,
    policyId: "policy:personal-ai",
    revision: 1,
    policyDigest: `sha256:${"a".repeat(64)}`,
    requiredApprovals: 1,
    operation: "register",
    operatorId: "operator:backup",
    keyId: target.keyId,
    publicKeySpki: target.publicKeySpki,
    priorKeyId: null,
    reason: null,
    requestedAt: new Date(currentTime).toISOString(),
    expiresAt: new Date(currentTime + 5 * 60 * 1000).toISOString(),
  };
  return {
    ...core,
    requestDigest:
      digestGovernedSkillSynthesisAttestorTrustOperatorRegistryChangeRequest(
        core,
      ),
  };
}

function waitForLine(stream, timeoutMs = 15_000, closedMessage = () => "") {
  return new Promise((resolve, reject) => {
    let carry = "";
    const cleanup = () => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("close", onClose);
    };
    const onData = (chunk) => {
      carry += chunk.toString("utf8");
      const newline = carry.indexOf("\n");
      if (newline === -1) return;
      cleanup();
      resolve(carry.slice(0, newline));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`approval service closed: ${closedMessage()}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("approval service did not become ready"));
    }, timeoutMs);
    stream.on("data", onData);
    stream.once("error", onError);
    stream.once("close", onClose);
  });
}

function callRaw(target, request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(target);
    let body = "";
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      body += chunk.toString("utf8");
      const newline = body.indexOf("\n");
      if (newline === -1) return;
      socket.destroy();
      resolve(JSON.parse(body.slice(0, newline)));
    });
    socket.once("error", reject);
  });
}

async function stopChild(child) {
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

afterEach(async () => {
  for (const child of children.splice(0)) await stopChild(child);
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("attestor trust isolated approval service", () => {
  it("signs both request families in another process and pins every response", async () => {
    const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "cc-attestor-approval-")),
    );
    roots.push(root);
    const target = endpoint(root);
    const capabilityToken = randomBytes(32).toString("base64url");
    const capabilityIssuedAt = new Date(Date.now() - 1_000).toISOString();
    const capabilityExpiresAt = new Date(
      Date.parse(capabilityIssuedAt) + 10 * 60 * 1000,
    ).toISOString();
    const operator = generateKeyPairSync("ed25519");
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
        capabilityIssuedAt,
        capabilityExpiresAt,
        capabilityMaxUses: 4,
        tenantId: "tenant:personal-ai",
        operatorId: "operator:owner",
        signerId: "signer:personal-ai-owner",
        policyId: "policy:personal-ai",
        revision: 1,
        policyDigest: `sha256:${"a".repeat(64)}`,
        privateKeyPem: operator.privateKey.export({
          type: "pkcs8",
          format: "pem",
        }),
      })}\n`,
    );
    const ready = JSON.parse(
      await waitForLine(child.stdout, 15_000, () => stderr),
    );
    expect(ready).toMatchObject({
      ok: true,
      descriptor: {
        schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_SERVICE_SCHEMA,
        tenantId: "tenant:personal-ai",
        operatorId: "operator:owner",
        policyId: "policy:personal-ai",
        revision: 1,
        policyDigest: `sha256:${"a".repeat(64)}`,
        capability: {
          expiresAt: capabilityExpiresAt,
          issuedAt: capabilityIssuedAt,
          maxUses: 4,
        },
        transportSecurity:
          process.platform === "win32"
            ? {
                acl: "protected-current-user-dacl",
                peerIdentity: "client-process-token-user-sid",
                remoteClients: false,
              }
            : {
                acl: "unix-owner-mode-0600",
                peerIdentity: "capability-authenticated-client",
                remoteClients: false,
              },
      },
    });
    expect(JSON.stringify(ready)).not.toContain("PRIVATE KEY");
    expect(child.pid).not.toBe(process.pid);
    if (process.platform !== "win32") {
      expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    }

    const client = createGovernedSkillSynthesisAttestorTrustApprovalClient({
      endpoint: target,
      capabilityToken,
      descriptor: ready.descriptor,
      timeoutMs: 10_000,
    });
    expect(isGovernedSkillSynthesisAttestorTrustApprovalClient(client)).toBe(
      true,
    );
    const now = Date.now();
    const trustRequest = normalRequest("tenant:personal-ai", now);
    const replayId = "1".repeat(32);
    const replayFrame = {
      schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_IPC_SCHEMA,
      requestId: replayId,
      capabilityId: ready.descriptor.capability.id,
      clientProcessId: process.pid,
      action: "approve",
      payload: trustRequest,
    };
    replayFrame.authorization =
      createGovernedSkillSynthesisAttestorTrustIpcAuthorization({
        ...replayFrame,
        token: capabilityToken,
      });
    expect(JSON.stringify(replayFrame)).not.toContain(capabilityToken);
    if (process.platform === "win32") {
      const spoofedFrame = {
        ...replayFrame,
        requestId: "2".repeat(32),
        clientProcessId: process.pid + 1,
      };
      spoofedFrame.authorization =
        createGovernedSkillSynthesisAttestorTrustIpcAuthorization({
          ...spoofedFrame,
          token: capabilityToken,
        });
      await expect(callRaw(target, spoofedFrame)).resolves.toMatchObject({
        ok: false,
        requestId: spoofedFrame.requestId,
        code: "peer_identity_denied",
      });
    }
    await expect(callRaw(target, replayFrame)).resolves.toMatchObject({
      ok: true,
      requestId: replayId,
    });
    await expect(callRaw(target, replayFrame)).resolves.toMatchObject({
      ok: false,
      requestId: replayId,
      code: "request_denied",
    });
    const registryRequest = operatorRequest("tenant:personal-ai", now);
    const [trustResult, registryResult] = await Promise.all([
      client.approve(trustRequest),
      client.approveOperatorChange(registryRequest),
    ]);
    expect(trustResult).toMatchObject({
      tenantId: trustRequest.tenantId,
      operatorId: "operator:owner",
      requestDigest: trustRequest.requestDigest,
      attestation: { keyId: ready.descriptor.keyId },
    });
    expect(registryResult).toMatchObject({
      tenantId: registryRequest.tenantId,
      operatorId: "operator:owner",
      requestDigest: registryRequest.requestDigest,
      attestation: { keyId: ready.descriptor.keyId },
    });

    expect(() =>
      createGovernedSkillSynthesisAttestorTrustApprovalClient({
        endpoint: target,
        capabilityToken: randomBytes(32).toString("base64url"),
        descriptor: ready.descriptor,
        timeoutMs: 10_000,
      }),
    ).toThrow("capability is invalid");
    const wrongPolicyCore = {
      ...trustRequest,
      policyDigest: `sha256:${"b".repeat(64)}`,
    };
    delete wrongPolicyCore.requestDigest;
    await expect(
      client.approve({
        ...wrongPolicyCore,
        requestDigest:
          digestGovernedSkillSynthesisAttestorTrustOperationRequest(
            wrongPolicyCore,
          ),
      }),
    ).rejects.toThrow("request denied");
    await expect(client.approve(trustRequest)).rejects.toThrow(
      "request denied",
    );
  }, 30_000);
});
