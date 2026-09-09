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
import { createGovernedSkillSynthesisAttestorIpcEndpoint } from "../../src/lib/evolution/governed-skill-synthesis-attestor-ipc-endpoint.js";
import { createGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer } from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-operations.js";
import { createGovernedSkillSynthesisAttestorTrustOperatorRegistryApprovalIssuer } from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-operator-registry.js";

const servicePath = fileURLToPath(
  new URL(
    "../../scripts/governed-learning-local-attestor-trust-operations-service.mjs",
    import.meta.url,
  ),
);
const roots = [];
const children = [];
const SERVICE_READY_TIMEOUT_MS = process.platform === "win32" ? 75_000 : 15_000;
const EXPIRY_DELAY_MS = process.platform === "win32" ? 90_000 : 1_000;

function endpoint(root) {
  const id = randomBytes(12).toString("hex");
  return createGovernedSkillSynthesisAttestorIpcEndpoint({
    kind: "trust-operations",
    id,
    temporaryDirectory: root,
  });
}

function waitForLine(
  stream,
  timeoutMs = SERVICE_READY_TIMEOUT_MS,
  closedMessage = () => "",
) {
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
      reject(
        new Error(`operations service closed before ready: ${closedMessage()}`),
      );
    };
    const timer = setTimeout(() => {
      cleanup();
      const detail = closedMessage().trim();
      reject(
        new Error(
          `operations service did not become ready${detail ? `: ${detail}` : ""}`,
        ),
      );
    }, timeoutMs);
    stream.on("data", onData);
    stream.once("error", onError);
    stream.once("close", onClose);
  });
}

async function startService(
  root,
  operator,
  target,
  capabilityToken,
  secrets = {
    artifact: randomBytes(32).toString("base64url"),
    ledger: randomBytes(32).toString("base64url"),
    witness: randomBytes(32).toString("base64url"),
  },
  configuration = {},
) {
  const capabilityIssuedAt =
    configuration.capabilityIssuedAt ??
    new Date(Date.now() - 1_000).toISOString();
  const capabilityExpiresAt =
    configuration.capabilityExpiresAt ??
    new Date(Date.parse(capabilityIssuedAt) + 10 * 60 * 1000).toISOString();
  fs.mkdirSync(path.join(root, "witness"), { recursive: true });
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
      capabilityIssuedAt,
      capabilityExpiresAt,
      capabilityMaxUses: configuration.capabilityMaxUses ?? 64,
      endpoint: target,
      ledgerAuthorityRoot: path.join(root, "authority"),
      ledgerRoot: path.join(root, "events"),
      operatorIdentities: (configuration.operators ?? [operator]).map(
        (entry, index) => ({
          tenantId: "tenant:attestor-trust-ops-service-test",
          operatorId:
            configuration.operatorIds?.[index] ??
            (index === 0 ? "operator:owner" : `operator:member-${index}`),
          publicKeyPem: entry.publicKey.export({
            type: "spki",
            format: "pem",
          }),
        }),
      ),
      operatorRegistryStreamId: "attestor-trust-operator-registry",
      policyId: "policy:personal-ai",
      requiredApprovals: configuration.requiredApprovals ?? 1,
      revision: configuration.revision ?? 1,
      secrets,
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
  const readyLine = await waitForLine(
    child.stdout,
    SERVICE_READY_TIMEOUT_MS,
    () => stderr,
  );
  const ready = JSON.parse(readyLine);
  if (ready.ok !== true) throw new Error(`service failed: ${stderr}`);
  return { child, descriptor: ready.descriptor };
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

async function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("operations service did not exit at capability expiry"));
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    await stopChild(child);
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("attestor trust operations local service", () => {
  it("terminates the isolated writer when its capability expires", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-attestor-ops-expiry-"),
    );
    roots.push(root);
    const capabilityToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + EXPIRY_DELAY_MS).toISOString();
    const started = await startService(
      root,
      generateKeyPairSync("ed25519"),
      endpoint(root),
      capabilityToken,
      undefined,
      {
        capabilityIssuedAt: new Date(Date.now() - 1_000).toISOString(),
        capabilityExpiresAt: expiresAt,
      },
    );
    await waitForExit(started.child, EXPIRY_DELAY_MS + 10_000);
    expect(started.child.exitCode).toBe(0);
  }, 150_000);

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
    const secrets = {
      artifact: randomBytes(32).toString("base64url"),
      ledger: randomBytes(32).toString("base64url"),
      witness: randomBytes(32).toString("base64url"),
    };
    const started = await startService(
      root,
      operator,
      target,
      capabilityToken,
      secrets,
    );
    expect(started.child.pid).not.toBe(process.pid);
    expect(JSON.stringify(started.descriptor)).not.toContain("publicKeyPem");
    expect(started.descriptor.transportSecurity).toMatchObject(
      process.platform === "win32"
        ? {
            acl: "protected-current-logon-dacl",
            peerIdentity: "client-process-token-user-and-logon-sid",
            remoteClients: false,
          }
        : {
            acl: "unix-owner-mode-0600",
            peerIdentity: "capability-authenticated-client",
            remoteClients: false,
          },
    );
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
      transport: "local-ipc-v3",
      service: {
        approvalMode: "single-operator",
        requiredApprovals: 1,
        operators: [
          { operatorId: "operator:owner", keyId: expect.any(String) },
        ],
        operatorRegistryRecovered: false,
        operatorRegistryStreamId: "attestor-trust-operator-registry",
      },
    });
    expect(Object.isFrozen(client.descriptor.service.operators)).toBe(true);
    expect(Object.isFrozen(client.descriptor.service.operators[0])).toBe(true);
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
        eventSequence: 2,
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

    expect(() =>
      createGovernedSkillSynthesisAttestorTrustOperationsClient({
        endpoint: target,
        capabilityToken: randomBytes(32).toString("base64url"),
        descriptor: started.descriptor,
        timeoutMs: 10_000,
      }),
    ).toThrow("capability is invalid");

    await stopChild(started.child);
    const restarted = await startService(
      root,
      operator,
      endpoint(root),
      randomBytes(32).toString("base64url"),
      secrets,
    );
    expect(restarted.descriptor).toMatchObject({
      policyDigest: started.descriptor.policyDigest,
      operatorRegistryRecordDigest:
        started.descriptor.operatorRegistryRecordDigest,
      operatorRegistryRecovered: true,
    });
    await stopChild(restarted.child);
    await expect(
      startService(
        root,
        generateKeyPairSync("ed25519"),
        endpoint(root),
        randomBytes(32).toString("base64url"),
        secrets,
      ),
    ).rejects.toThrow("bootstrap differs from its durable state");
  }, 120_000);

  it("persists a sorted multi-operator quorum genesis", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-attestor-ops-quorum-"),
    );
    roots.push(root);
    const operators = [
      generateKeyPairSync("ed25519"),
      generateKeyPairSync("ed25519"),
      generateKeyPairSync("ed25519"),
    ];
    const secrets = {
      artifact: randomBytes(32).toString("base64url"),
      ledger: randomBytes(32).toString("base64url"),
      witness: randomBytes(32).toString("base64url"),
    };
    const target = endpoint(root);
    const capabilityToken = randomBytes(32).toString("base64url");
    const started = await startService(
      root,
      operators[0],
      target,
      capabilityToken,
      secrets,
      {
        operators,
        operatorIds: ["operator:zeta", "operator:alpha", "operator:middle"],
        requiredApprovals: 2,
      },
    );
    expect(started.descriptor).toMatchObject({
      approvalMode: "multi-operator",
      operatorCount: 3,
      requiredApprovals: 2,
      operatorRegistryRecovered: false,
    });
    expect(started.descriptor.operatorRegistryRecordDigest).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    const client = createGovernedSkillSynthesisAttestorTrustOperationsClient({
      endpoint: target,
      capabilityToken,
      descriptor: started.descriptor,
      timeoutMs: 10_000,
    });
    const alphaIssuer =
      createGovernedSkillSynthesisAttestorTrustOperatorRegistryApprovalIssuer({
        tenantId: "tenant:attestor-trust-ops-service-test",
        operatorId: "operator:alpha",
        privateKey: operators[1].privateKey,
      });
    const middleIssuer =
      createGovernedSkillSynthesisAttestorTrustOperatorRegistryApprovalIssuer({
        tenantId: "tenant:attestor-trust-ops-service-test",
        operatorId: "operator:middle",
        privateKey: operators[2].privateKey,
      });
    const backup = generateKeyPairSync("ed25519");
    const registerRequest = await client.prepareOperatorChange({
      operation: "register",
      operatorId: "operator:backup",
      publicKey: backup.publicKey.export({ type: "spki", format: "pem" }),
    });
    await expect(
      client.executeOperatorChange({
        request: registerRequest,
        approvals: [alphaIssuer.issue(registerRequest)],
      }),
    ).rejects.toThrow("operation_rejected");
    const registered = await client.executeOperatorChange({
      request: registerRequest,
      approvals: [
        alphaIssuer.issue(registerRequest),
        middleIssuer.issue(registerRequest),
      ],
    });
    expect(registered).toMatchObject({
      rebindRequired: true,
      registry: { revision: 2, operatorCount: 4, requiredApprovals: 2 },
    });
    await stopChild(started.child);

    const expandedTarget = endpoint(root);
    const expandedCapability = randomBytes(32).toString("base64url");
    const expandedOperators = [...operators, backup];
    const expanded = await startService(
      root,
      expandedOperators[0],
      expandedTarget,
      expandedCapability,
      secrets,
      {
        operators: expandedOperators,
        operatorIds: [
          "operator:zeta",
          "operator:alpha",
          "operator:middle",
          "operator:backup",
        ],
        requiredApprovals: 2,
        revision: 2,
      },
    );
    expect(expanded.descriptor).toMatchObject({
      operatorCount: 4,
      revision: 2,
      operatorRegistryRecovered: true,
      operatorRegistryRecordDigest: registered.registry.recordDigest,
    });
    const expandedClient =
      createGovernedSkillSynthesisAttestorTrustOperationsClient({
        endpoint: expandedTarget,
        capabilityToken: expandedCapability,
        descriptor: expanded.descriptor,
        timeoutMs: 10_000,
      });
    const zetaIssuer =
      createGovernedSkillSynthesisAttestorTrustOperatorRegistryApprovalIssuer({
        tenantId: "tenant:attestor-trust-ops-service-test",
        operatorId: "operator:zeta",
        privateKey: operators[0].privateKey,
      });
    const revokeRequest = await expandedClient.prepareOperatorChange({
      operation: "revoke",
      operatorId: "operator:zeta",
      keyId: zetaIssuer.keyId,
      reason: "remove the retired quorum operator",
    });
    const revoked = await expandedClient.executeOperatorChange({
      request: revokeRequest,
      approvals: [
        alphaIssuer.issue(revokeRequest),
        middleIssuer.issue(revokeRequest),
      ],
    });
    expect(revoked).toMatchObject({
      rebindRequired: true,
      registry: { revision: 3, operatorCount: 3, requiredApprovals: 2 },
    });
    expect(
      revoked.registry.operators.some(
        (entry) => entry.operatorId === "operator:zeta",
      ),
    ).toBe(false);
    await stopChild(expanded.child);

    const final = await startService(
      root,
      operators[1],
      endpoint(root),
      randomBytes(32).toString("base64url"),
      secrets,
      {
        operators: [operators[1], operators[2], backup],
        operatorIds: ["operator:alpha", "operator:middle", "operator:backup"],
        requiredApprovals: 2,
        revision: 3,
      },
    );
    expect(final.descriptor).toMatchObject({
      revision: 3,
      operatorCount: 3,
      operatorRegistryRecordDigest: revoked.registry.recordDigest,
      operatorRegistryRecovered: true,
    });
  }, 120_000);

  it("rotates a personal operator with the old key and requires service rebind", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-attestor-ops-rotate-"),
    );
    roots.push(root);
    const oldOperator = generateKeyPairSync("ed25519");
    const newOperator = generateKeyPairSync("ed25519");
    const secrets = {
      artifact: randomBytes(32).toString("base64url"),
      ledger: randomBytes(32).toString("base64url"),
      witness: randomBytes(32).toString("base64url"),
    };
    const capabilityToken = randomBytes(32).toString("base64url");
    const target = endpoint(root);
    const started = await startService(
      root,
      oldOperator,
      target,
      capabilityToken,
      secrets,
    );
    const client = createGovernedSkillSynthesisAttestorTrustOperationsClient({
      endpoint: target,
      capabilityToken,
      descriptor: started.descriptor,
      timeoutMs: 10_000,
    });
    const oldIssuer =
      createGovernedSkillSynthesisAttestorTrustOperatorRegistryApprovalIssuer({
        tenantId: "tenant:attestor-trust-ops-service-test",
        operatorId: "operator:owner",
        privateKey: oldOperator.privateKey,
      });
    await expect(
      client.prepareOperatorChange({
        operation: "revoke",
        operatorId: "operator:owner",
        keyId: oldIssuer.keyId,
        reason: "must not remove the last personal operator",
      }),
    ).rejects.toThrow("operation_rejected");
    const request = await client.prepareOperatorChange({
      operation: "rotate",
      operatorId: "operator:owner",
      priorKeyId: oldIssuer.keyId,
      publicKey: newOperator.publicKey.export({
        type: "spki",
        format: "pem",
      }),
      reason: "rotate the personal owner key",
    });
    const approval = oldIssuer.issue(request);
    const changed = await client.executeOperatorChange({
      request,
      approvals: [approval],
    });
    expect(changed).toMatchObject({
      rebindRequired: true,
      persistence: { authenticated: true, durable: true, recovered: false },
      registry: {
        revision: 2,
        requiredApprovals: 1,
        operatorCount: 1,
        operators: [{ operatorId: "operator:owner" }],
      },
    });
    expect(changed.registry.operators[0].keyId).not.toBe(oldIssuer.keyId);
    await expect(
      client.executeOperatorChange({ request, approvals: [approval] }),
    ).resolves.toMatchObject({ persistence: { recovered: true } });
    await expect(
      client.prepare({
        operation: "register",
        serviceId: "kms.after-operator-rotation.test",
        publicKey: generateKeyPairSync("ed25519").publicKey.export({
          type: "spki",
          format: "pem",
        }),
      }),
    ).rejects.toThrow("service_rebind_required");

    await stopChild(started.child);
    const reboundTarget = endpoint(root);
    const reboundCapability = randomBytes(32).toString("base64url");
    const rebound = await startService(
      root,
      newOperator,
      reboundTarget,
      reboundCapability,
      secrets,
      { revision: 2 },
    );
    expect(rebound.descriptor).toMatchObject({
      revision: 2,
      policyDigest: changed.registry.policyDigest,
      operatorRegistryRecordDigest: changed.registry.recordDigest,
      operatorRegistryRecovered: true,
    });
    const reboundClient =
      createGovernedSkillSynthesisAttestorTrustOperationsClient({
        endpoint: reboundTarget,
        capabilityToken: reboundCapability,
        descriptor: rebound.descriptor,
        timeoutMs: 10_000,
      });
    const attestor = generateKeyPairSync("ed25519");
    const attestorRequest = await reboundClient.prepare({
      operation: "register",
      serviceId: "kms.rebound-attestor.test",
      publicKey: attestor.publicKey.export({ type: "spki", format: "pem" }),
    });
    const staleIssuer =
      createGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer({
        tenantId: "tenant:attestor-trust-ops-service-test",
        operatorId: "operator:owner",
        privateKey: oldOperator.privateKey,
      });
    await expect(
      reboundClient.execute({
        request: attestorRequest,
        approvals: [staleIssuer.issue(attestorRequest)],
      }),
    ).rejects.toThrow("operation_rejected");
    const activeIssuer =
      createGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer({
        tenantId: "tenant:attestor-trust-ops-service-test",
        operatorId: "operator:owner",
        privateKey: newOperator.privateKey,
      });
    await expect(
      reboundClient.execute({
        request: attestorRequest,
        approvals: [activeIssuer.issue(attestorRequest)],
      }),
    ).resolves.toMatchObject({
      lifecycle: {
        authenticated: true,
        durable: true,
        operation: "register",
      },
    });
  }, 120_000);
});
