import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerEvolutionAttestorTrustCommands } from "../../src/commands/evolution-attestor-trust.js";
import { createGovernedSkillSynthesisAttestorTrustApprovalClient } from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-approval-client.js";
import { createGovernedSkillSynthesisAttestorIpcEndpoint } from "../../src/lib/evolution/governed-skill-synthesis-attestor-ipc-endpoint.js";
import { createGovernedSkillSynthesisAttestorTrustOperationsCliHost } from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-operations-cli-host.js";
import { governedSkillSynthesisAttestorTrustIpcCapabilityId } from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-ipc-capability.js";
import { createGovernedSkillSynthesisAttestorTrustOperationsClient } from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-operations-client.js";
import {
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATION_REQUEST_SCHEMA,
  createGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer,
  digestGovernedSkillSynthesisAttestorTrustOperationRequest,
} from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-operations.js";
import {
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_REQUEST_SCHEMA,
  createGovernedSkillSynthesisAttestorTrustOperatorRegistryApprovalIssuer,
  digestGovernedSkillSynthesisAttestorTrustOperatorRegistryChangeRequest,
} from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-operator-registry.js";

const roots = [];
const servers = [];
const NOW = Date.parse("2026-09-09T08:00:00.000Z");

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function policyDigest(value) {
  return `sha256:${createHash("sha256")
    .update("chainlesschain.attestor-trust-operations-policy/v1")
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function writeDocument(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function requestFor(operation, descriptor) {
  const key = createPublicKey(operation.publicKey);
  const spki = key.export({ type: "spki", format: "der" });
  const core = {
    schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATION_REQUEST_SCHEMA,
    tenantId: descriptor.tenantId,
    serviceId: operation.serviceId,
    operation: operation.operation,
    keyId: `key:ed25519:${createHash("sha256").update(spki).digest("hex")}`,
    publicKeySpki: spki.toString("base64url"),
    priorKeyId: null,
    reason: null,
    policyDigest: descriptor.policyDigest,
    requiredApprovals: descriptor.requiredApprovals,
    requestedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 5 * 60 * 1000).toISOString(),
  };
  return {
    ...core,
    requestDigest:
      digestGovernedSkillSynthesisAttestorTrustOperationRequest(core),
  };
}

function operatorRequestFor(operation, descriptor) {
  const key = createPublicKey(operation.publicKey);
  const spki = key.export({ type: "spki", format: "der" });
  const core = {
    schema:
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_REQUEST_SCHEMA,
    tenantId: descriptor.tenantId,
    policyId: descriptor.policyId,
    revision: descriptor.revision,
    policyDigest: descriptor.policyDigest,
    requiredApprovals: descriptor.requiredApprovals,
    operation: operation.operation,
    operatorId: operation.operatorId,
    keyId: `key:ed25519:${createHash("sha256").update(spki).digest("hex")}`,
    publicKeySpki: spki.toString("base64url"),
    priorKeyId: null,
    reason: null,
    requestedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 5 * 60 * 1000).toISOString(),
  };
  return {
    ...core,
    requestDigest:
      digestGovernedSkillSynthesisAttestorTrustOperatorRegistryChangeRequest(
        core,
      ),
  };
}

async function fixture({
  approvalPolicyOverrides = {},
  transformPrepareResult = (value) => value,
} = {}) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-attestor-trust-cli-")),
  );
  roots.push(root);
  const id = createHash("sha256").update(root).digest("hex").slice(0, 24);
  const endpoint = createGovernedSkillSynthesisAttestorIpcEndpoint({
    kind: "trust-operations",
    id,
    temporaryDirectory: root,
  });
  const approvalEndpoint = createGovernedSkillSynthesisAttestorIpcEndpoint({
    kind: "trust-approval",
    id,
    temporaryDirectory: root,
  });
  const operatorKeys = generateKeyPairSync("ed25519");
  const operatorSpki = operatorKeys.publicKey.export({
    type: "spki",
    format: "der",
  });
  const operators = [
    {
      operatorId: "operator:personal-owner",
      keyId: `key:ed25519:${createHash("sha256")
        .update(operatorSpki)
        .digest("hex")}`,
    },
  ];
  const policy = {
    tenantId: "tenant:personal-ai",
    policyId: "personal-ai-attestor-policy",
    revision: 1,
    requiredApprovals: 1,
    operators,
  };
  const operationsCapabilityToken = "a".repeat(64);
  const approvalCapabilityToken = "b".repeat(64);
  const capabilityWindow = {
    issuedAt: new Date(NOW - 1_000).toISOString(),
    expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
    maxUses: 16,
  };
  const transportSecurity = {
    acl:
      process.platform === "win32"
        ? "protected-current-logon-dacl"
        : "unix-owner-mode-0600",
    aclDigest: digest("test-transport-acl"),
    peerIdentity:
      process.platform === "win32"
        ? "client-process-token-user-and-logon-sid"
        : "capability-authenticated-client",
    principalDigest: digest("test-transport-principal"),
    remoteClients: false,
  };
  const service = Object.freeze({
    schema:
      "chainlesschain.governed-skill-synthesis-attestor-trust-operations-service/v6",
    capability: {
      id: governedSkillSynthesisAttestorTrustIpcCapabilityId({
        service: "attestor-trust-operations",
        token: operationsCapabilityToken,
      }),
      ...capabilityWindow,
    },
    tenantId: policy.tenantId,
    authorizationStreamId: "attestor-trust-authorizations",
    policyId: policy.policyId,
    revision: policy.revision,
    policyDigest: policyDigest(policy),
    requiredApprovals: policy.requiredApprovals,
    operatorCount: 1,
    operators,
    operatorRegistryStreamId: "attestor-trust-operator-registry",
    operatorRegistryRecordDigest: digest("operator-registry-record"),
    operatorRegistryRecovered: true,
    approvalMode: "single-operator",
    transportSecurity,
  });
  const calls = [];
  const server = net.createServer((socket) => {
    let body = "";
    socket.on("data", (chunk) => {
      body += chunk.toString("utf8");
      const newline = body.indexOf("\n");
      if (newline === -1) return;
      const message = JSON.parse(body.slice(0, newline));
      calls.push(message);
      let result;
      if (message.action === "prepare") {
        result = transformPrepareResult(requestFor(message.payload, service));
      } else if (message.action === "operator-prepare") {
        result = operatorRequestFor(message.payload, service);
      } else if (message.action === "operator-execute") {
        result = {
          rebindRequired: true,
          registry: {
            revision: service.revision + 1,
            requestDigest: message.payload.request.requestDigest,
          },
        };
      } else {
        result = {
          executed: true,
          requestDigest: message.payload.request.requestDigest,
          approvalCount: message.payload.approvals.length,
        };
      }
      socket.end(
        `${JSON.stringify({ ok: true, requestId: message.requestId, result })}\n`,
      );
    });
  });
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, resolve);
  });
  const client = createGovernedSkillSynthesisAttestorTrustOperationsClient({
    endpoint,
    capabilityToken: operationsCapabilityToken,
    descriptor: service,
    timeoutMs: 5_000,
    now: () => NOW,
  });
  const trustIssuer =
    createGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer({
      tenantId: service.tenantId,
      operatorId: "operator:personal-owner",
      privateKey: operatorKeys.privateKey,
      now: () => NOW,
    });
  const registryIssuer =
    createGovernedSkillSynthesisAttestorTrustOperatorRegistryApprovalIssuer({
      tenantId: service.tenantId,
      operatorId: "operator:personal-owner",
      privateKey: operatorKeys.privateKey,
      now: () => NOW,
    });
  const approvalServer = net.createServer((socket) => {
    let body = "";
    socket.on("data", (chunk) => {
      body += chunk.toString("utf8");
      const newline = body.indexOf("\n");
      if (newline === -1) return;
      const message = JSON.parse(body.slice(0, newline));
      const result =
        message.action === "approve"
          ? trustIssuer.issue(message.payload)
          : registryIssuer.issue(message.payload);
      socket.end(
        `${JSON.stringify({ ok: true, requestId: message.requestId, result })}\n`,
      );
    });
  });
  servers.push(approvalServer);
  await new Promise((resolve, reject) => {
    approvalServer.once("error", reject);
    approvalServer.listen(approvalEndpoint, resolve);
  });
  const approvalClient =
    createGovernedSkillSynthesisAttestorTrustApprovalClient({
      endpoint: approvalEndpoint,
      capabilityToken: approvalCapabilityToken,
      descriptor: {
        schema:
          "chainlesschain.governed-skill-synthesis-attestor-trust-approval-service/v4",
        capability: {
          id: governedSkillSynthesisAttestorTrustIpcCapabilityId({
            service: "attestor-trust-approval",
            token: approvalCapabilityToken,
          }),
          ...capabilityWindow,
        },
        tenantId: service.tenantId,
        operatorId: trustIssuer.operatorId,
        signerId: "signer:personal-owner",
        keyId: trustIssuer.keyId,
        policyId: service.policyId,
        revision: service.revision,
        policyDigest: service.policyDigest,
        publicKeySpki: operatorSpki.toString("base64url"),
        transportSecurity,
        ...approvalPolicyOverrides,
      },
      timeoutMs: 5_000,
      now: () => NOW,
    });
  return {
    root,
    calls,
    host: createGovernedSkillSynthesisAttestorTrustOperationsCliHost({
      approvalClient,
      client,
      now: () => NOW,
    }),
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
    ),
  );
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("evolution attestor-trust CLI", () => {
  it("prepares an exclusive plan and executes it with one personal approval", async () => {
    const h = await fixture();
    const operationPath = path.join(h.root, "register-operation.json");
    const requestPath = path.join(h.root, "register-request.json");
    const approvalPath = path.join(h.root, "alice-approval.json");
    const operation = {
      operation: "register",
      serviceId: "kms.personal-attestor",
      publicKey: generateKeyPairSync("ed25519").publicKey.export({
        type: "spki",
        format: "pem",
      }),
    };
    writeDocument(operationPath, operation);

    const root = new Command().exitOverride();
    registerEvolutionAttestorTrustCommands(root.command("evolution"), {
      attestorTrustOperationsHost: h.host,
    });
    const printed = vi.spyOn(console, "log").mockImplementation(() => {});
    await root.parseAsync([
      "node",
      "cc",
      "evolution",
      "attestor-trust",
      "prepare",
      operationPath,
      "--out",
      requestPath,
    ]);
    const prepared = JSON.parse(printed.mock.calls[0][0]);
    expect(prepared).toMatchObject({
      created: true,
      operation: "register",
      serviceId: "kms.personal-attestor",
      requiredApprovals: 1,
    });
    const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    expect(request.requestDigest).toBe(prepared.requestDigest);
    expect(h.host).not.toHaveProperty("client");

    await root.parseAsync([
      "node",
      "cc",
      "evolution",
      "attestor-trust",
      "approve",
      requestPath,
      "--out",
      approvalPath,
    ]);
    expect(JSON.parse(printed.mock.calls[1][0])).toMatchObject({
      created: true,
      operatorId: "operator:personal-owner",
      requestDigest: request.requestDigest,
    });

    await root.parseAsync([
      "node",
      "cc",
      "evolution",
      "attestor-trust",
      "execute",
      requestPath,
      approvalPath,
    ]);
    expect(JSON.parse(printed.mock.calls[2][0])).toEqual({
      executed: true,
      requestDigest: request.requestDigest,
      approvalCount: 1,
    });
    expect(h.calls.map((entry) => entry.action)).toEqual([
      "prepare",
      "execute",
    ]);
    expect(
      h.calls.every(
        (entry) =>
          !Object.hasOwn(entry, "capabilityToken") &&
          /^sha256:[a-f0-9]{64}$/u.test(entry.capabilityId) &&
          /^[A-Za-z0-9_-]{43}$/u.test(entry.authorization),
      ),
    ).toBe(true);
  });

  it("does not overwrite an existing plan", async () => {
    const h = await fixture();
    const operationPath = path.join(h.root, "operation.json");
    const requestPath = path.join(h.root, "request.json");
    writeDocument(operationPath, {
      operation: "register",
      serviceId: "kms.personal-attestor",
      publicKey: generateKeyPairSync("ed25519").publicKey.export({
        type: "spki",
        format: "pem",
      }),
    });
    writeDocument(requestPath, { retained: true });

    await expect(
      h.host.prepare({ operationPath, outputPath: requestPath }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(JSON.parse(fs.readFileSync(requestPath, "utf8"))).toEqual({
      retained: true,
    });
  });

  it("rejects an unbranded deployment host and wrong approval cardinality", async () => {
    const root = new Command().exitOverride();
    registerEvolutionAttestorTrustCommands(root.command("evolution"), {
      attestorTrustOperationsHost: {},
    });
    await expect(
      root.parseAsync([
        "node",
        "cc",
        "evolution",
        "attestor-trust",
        "prepare",
        "operation.json",
        "--out",
        "request.json",
      ]),
    ).rejects.toThrow("trusted deployment host");

    const h = await fixture();
    await expect(
      h.host.execute({
        requestPath: path.join(h.root, "request.json"),
        approvalPaths: ["same.json", "same.json"],
      }),
    ).rejects.toThrow("exactly 1 approval file");
  });

  it("rejects an approval signer pinned to a stale policy revision", async () => {
    await expect(
      fixture({ approvalPolicyOverrides: { revision: 2 } }),
    ).rejects.toThrow("operations policy boundary");
  });

  it("rejects a signer that is not an active registry operator", async () => {
    await expect(
      fixture({
        approvalPolicyOverrides: { operatorId: "operator:former-owner" },
      }),
    ).rejects.toThrow("not an active registry operator");
  });

  it("rejects linked operation files before contacting the service", async () => {
    const h = await fixture();
    const operationPath = path.join(h.root, "operation.json");
    const linkedPath = path.join(h.root, "linked-operation.json");
    writeDocument(operationPath, { operation: "revoke" });
    fs.linkSync(operationPath, linkedPath);

    await expect(
      h.host.prepare({
        operationPath: linkedPath,
        outputPath: path.join(h.root, "request.json"),
      }),
    ).rejects.toThrow("regular, single-link file");
    expect(h.calls).toHaveLength(0);
  });

  it("rejects a policy-valid plan that substitutes the requested operation", async () => {
    const h = await fixture({
      transformPrepareResult(value) {
        const core = {
          ...value,
          serviceId: "kms.substituted-attestor",
        };
        delete core.requestDigest;
        return {
          ...core,
          requestDigest:
            digestGovernedSkillSynthesisAttestorTrustOperationRequest(core),
        };
      },
    });
    const operationPath = path.join(h.root, "operation.json");
    const requestPath = path.join(h.root, "request.json");
    writeDocument(operationPath, {
      operation: "register",
      serviceId: "kms.personal-attestor",
      publicKey: generateKeyPairSync("ed25519").publicKey.export({
        type: "spki",
        format: "pem",
      }),
    });

    await expect(
      h.host.prepare({ operationPath, outputPath: requestPath }),
    ).rejects.toThrow("substituted its operation");
    expect(fs.existsSync(requestPath)).toBe(false);
  });

  it("routes operator registry prepare and execute through secure files", async () => {
    const h = await fixture();
    const operationPath = path.join(h.root, "operator-register.json");
    const requestPath = path.join(h.root, "operator-request.json");
    const approvalPath = path.join(h.root, "operator-approval.json");
    writeDocument(operationPath, {
      operation: "register",
      operatorId: "operator:backup",
      publicKey: generateKeyPairSync("ed25519").publicKey.export({
        type: "spki",
        format: "pem",
      }),
    });
    const root = new Command().exitOverride();
    registerEvolutionAttestorTrustCommands(root.command("evolution"), {
      attestorTrustOperationsHost: h.host,
    });
    const printed = vi.spyOn(console, "log").mockImplementation(() => {});
    await root.parseAsync([
      "node",
      "cc",
      "evolution",
      "attestor-trust",
      "operator-prepare",
      operationPath,
      "--out",
      requestPath,
    ]);
    expect(JSON.parse(printed.mock.calls[0][0])).toMatchObject({
      created: true,
      operation: "register",
      operatorId: "operator:backup",
      requiredApprovals: 1,
      revision: 1,
    });
    await root.parseAsync([
      "node",
      "cc",
      "evolution",
      "attestor-trust",
      "operator-approve",
      requestPath,
      "--out",
      approvalPath,
    ]);
    expect(JSON.parse(printed.mock.calls[1][0])).toMatchObject({
      created: true,
      operatorId: "operator:personal-owner",
    });
    await root.parseAsync([
      "node",
      "cc",
      "evolution",
      "attestor-trust",
      "operator-execute",
      requestPath,
      approvalPath,
    ]);
    expect(JSON.parse(printed.mock.calls[2][0])).toMatchObject({
      rebindRequired: true,
      registry: { revision: 2 },
    });
    expect(h.calls.map((entry) => entry.action)).toEqual([
      "operator-prepare",
      "operator-execute",
    ]);
  });
});
