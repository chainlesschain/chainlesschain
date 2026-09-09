import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerEvolutionAttestorTrustCommands } from "../../src/commands/evolution-attestor-trust.js";
import { createGovernedSkillSynthesisAttestorTrustOperationsCliHost } from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-operations-cli-host.js";
import { createGovernedSkillSynthesisAttestorTrustOperationsClient } from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-operations-client.js";
import {
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATION_REQUEST_SCHEMA,
  digestGovernedSkillSynthesisAttestorTrustOperationRequest,
} from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-operations.js";

const roots = [];
const servers = [];
const NOW = Date.parse("2026-09-09T08:00:00.000Z");

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
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

async function fixture({ transformPrepareResult = (value) => value } = {}) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-attestor-trust-cli-")),
  );
  roots.push(root);
  const id = createHash("sha256").update(root).digest("hex").slice(0, 24);
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\cc-evolution-attestor-trust-ops-${id}`
      : path.join(root, `cc-evolution-attestor-trust-ops-${id}.sock`);
  const service = Object.freeze({
    schema:
      "chainlesschain.governed-skill-synthesis-attestor-trust-operations-service/v2",
    tenantId: "tenant:personal-ai",
    authorizationStreamId: "attestor-trust-authorizations",
    policyId: "personal-ai-attestor-policy",
    revision: 1,
    policyDigest: digest("personal-ai-policy"),
    requiredApprovals: 1,
    operatorCount: 1,
    operatorRegistryStreamId: "attestor-trust-operator-registry",
    operatorRegistryRecordDigest: digest("operator-registry-record"),
    operatorRegistryRecovered: true,
    approvalMode: "single-operator",
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
      const result =
        message.action === "prepare"
          ? transformPrepareResult(requestFor(message.payload, service))
          : {
              executed: true,
              requestDigest: message.payload.request.requestDigest,
              approvalCount: message.payload.approvals.length,
            };
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
    capabilityToken: "a".repeat(64),
    descriptor: service,
    timeoutMs: 5_000,
  });
  return {
    root,
    calls,
    host: createGovernedSkillSynthesisAttestorTrustOperationsCliHost({
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
    writeDocument(approvalPath, { externallySigned: true });

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
      "execute",
      requestPath,
      approvalPath,
    ]);
    expect(JSON.parse(printed.mock.calls[1][0])).toEqual({
      executed: true,
      requestDigest: request.requestDigest,
      approvalCount: 1,
    });
    expect(h.calls.map((entry) => entry.action)).toEqual([
      "prepare",
      "execute",
    ]);
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
});
