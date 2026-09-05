import { createHash, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { request as httpRequest } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { createBaseProgram } from "../../src/program-base.js";
import { registerMarketplaceCommand } from "../../src/commands/marketplace.js";
import { dispatchManifestEntry } from "../../src/lazy-dispatch.js";
import * as publicBadges from "../../src/lib/evolution/governed-skill-marketplace-badge.js";
import {
  createGovernedSkillMarketplaceCandidateInstaller,
  digestGovernedSkillMarketplaceCandidatePermissions,
  serializeGovernedSkillMarketplaceCandidatePackage,
} from "../../src/lib/evolution/governed-skill-marketplace-candidate.js";
import {
  buildSkillCandidateDraft,
  deriveSkillCandidateTenantKey,
  SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
  SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA,
} from "../../src/lib/evolution/skill-candidate-registry.js";
import {
  buildSkillDependencyLock,
  buildSkillRuntimeManifest,
  buildSkillTargetMatrix,
} from "../../src/lib/evolution/skill-execution-manifest.js";
import {
  createGovernedSkillMarketplaceCliHost,
  isGovernedSkillMarketplaceCliHost,
} from "../../src/lib/evolution/governed-skill-marketplace-cli-host.js";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import {
  GovernedSkillMarketplace,
  buildGovernedSkillMarketplaceManifest,
  digestGovernedSkillMarketplaceState,
} from "../../src/lib/evolution/governed-skill-marketplace.js";
import {
  GOVERNED_SKILL_MARKETPLACE_LEDGER_CORRUPT_CODE,
  GOVERNED_SKILL_MARKETPLACE_LEDGER_EVENT_TYPE,
  GovernedSkillMarketplaceLedgerAdapter,
} from "../../src/lib/evolution/governed-skill-marketplace-ledger-adapter.js";
import {
  SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
  digestSkillRevocationDependencyRequest,
} from "../../src/lib/evolution/skill-revocation-propagation.js";

const NOW = "2026-09-05T15:00:00.000Z";
const TENANT_ID = "tenant:marketplace-ledger";
const ARTIFACT_TENANT_ID = "artifact-tenant-marketplace-ledger";
const TARGET = {
  model: "qwen-3.5-9b",
  os: "linux-x64",
  tool: "cli",
  runtime: "node-22.12.0",
};
const roots = [];
const adapterStorage = new WeakMap();
const badgeServers = [];

afterEach(async () => {
  for (const service of badgeServers.splice(0)) await service.close();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(domain, value = domain) {
  const bytes =
    arguments.length === 1 ? String(value) : `${domain}\0${canonical(value)}`;
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function signingAuthority(label) {
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://tests/marketplace-ledger-${label}`,
    trustPolicyDigest: digest(`${label}-policy`),
  });
  const secret = `test-only-marketplace-ledger-${label}-secret`;
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  return Object.freeze({
    trust,
    signer: Object.freeze({
      sign: ({ message }) => Object.freeze({ ...trust, value: sign(message) }),
    }),
    verifier: Object.freeze({
      verify: ({ message, signature }) =>
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value === sign(message),
    }),
  });
}

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -120_000;
  return {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    closeSync(descriptor) {
      if (directories.delete(descriptor)) return;
      return fs.closeSync(descriptor);
    },
    fsyncSync(descriptor) {
      if (directories.has(descriptor)) return;
      try {
        return fs.fsyncSync(descriptor);
      } catch (error) {
        if (
          process.platform === "win32" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.fstatSync(descriptor).isDirectory()
        ) {
          return;
        }
        throw error;
      }
    },
    openSync(target, flags, mode) {
      try {
        return fs.openSync(target, flags, mode);
      } catch (error) {
        if (
          process.platform === "win32" &&
          flags === "r" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.statSync(target).isDirectory()
        ) {
          const descriptor = nextDescriptor;
          nextDescriptor -= 1;
          directories.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
  };
}

function resources() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-marketplace-ledger-"),
  );
  roots.push(root);
  const now = Date.parse(NOW);
  const artifactSecret = "test-only-marketplace-artifact-secret";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/marketplace-ledger-artifacts";
  const policyDigest = digest("marketplace-ledger-artifact-policy");
  const sign = (message) =>
    createHmac("sha256", artifactSecret).update(message).digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => now,
    }),
    audience: "evolution-runtime",
    tenantId: ARTIFACT_TENANT_ID,
    now: () => now,
    envelopeSigner: {
      sign: ({ message }) => ({ algorithm, keyId, value: sign(message) }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === algorithm &&
        signature.keyId === keyId &&
        signature.value === sign(message),
    },
    currentAuthorityResolver: {
      resolve(request) {
        const core = {
          action: request.action,
          algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt: NOW,
          decisionExpiresAt: "2026-09-05T15:01:00.000Z",
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || keyId,
          policyDigest,
          policyRevision: 1,
          purpose: request.purpose,
          requestedAt: request.requestedAt,
          retention: request.retention,
          revocationRevision: 1,
          revoked: false,
          schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
          tenantId: request.tenantId,
          type: request.type,
        };
        return {
          ...core,
          receiptDigest: digest(
            "chainlesschain.evolution-artifact-authority-decision/v1",
            core,
          ),
        };
      },
    },
  });
  const resolver = artifactPorts.createEvolutionLedgerArtifactResolver({
    purpose: "evolution-ledger",
  });
  const witnessRoot = path.join(root, "witness");
  fs.mkdirSync(witnessRoot, { mode: 0o700 });
  return {
    root,
    artifactPorts,
    resolver,
    backendOptions: {
      rootDir: path.join(root, "ledger-events"),
      authorityRootDir: path.join(root, "ledger-authority"),
      witnessFilePath: path.join(witnessRoot, "checkpoint.json"),
      witnessId: "governed-marketplace-ledger-witness",
      ledgerAuthority: signingAuthority("ledger"),
      witnessAuthority: signingAuthority("witness"),
      artifactResolver: resolver,
      fsImpl: durableFilesystem(),
      secure: false,
      clock: () => now,
    },
  };
}

function adapter(storage, ledger) {
  const value = new GovernedSkillMarketplaceLedgerAdapter({
    descriptor: {
      tenantId: TENANT_ID,
      artifactTenantId: ARTIFACT_TENANT_ID,
      streamId: "governed-marketplace:main",
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
    },
    artifactPorts: storage.artifactPorts,
    ledger,
    ledgerArtifactResolver: storage.resolver,
    now: () => Date.parse(NOW),
  });
  adapterStorage.set(value, storage);
  return value;
}

function marketplace(ledgerAdapter) {
  return new GovernedSkillMarketplace({
    tenantId: TENANT_ID,
    ports: {
      ...ledgerAdapter.persistencePorts(),
      verifySignature: async () => true,
      adapt: async ({ manifest, cell }) => ({
        authenticated: true,
        manifestDigest: manifest.manifestDigest,
        evalReceiptDigest: cell.evalReceiptDigest,
        outputDigest: digest("adapted-output"),
        adapterDigest: digest("target-adapter"),
      }),
      transition: async ({ request, requestDigest }) => ({
        authenticated: true,
        durable: true,
        requestDigest,
        nextStage: request.nextStage,
        receiptDigest: digest(`transition:${request.nextStage}`),
      }),
      verifyPilot: async ({ state, nextStage }) => ({
        authenticated: true,
        accepted: true,
        stateDigest: state.stateDigest,
        nextStage,
        receiptDigest: digest(`pilot:${nextStage}`),
      }),
      verifyRevocation: async ({ state }) => ({
        authenticated: true,
        revoked: true,
        manifestDigest: state.manifestDigest,
        receiptDigest: digest("marketplace-revocation"),
      }),
    },
  });
}

function manifest(version = "2.0.0") {
  return buildGovernedSkillMarketplaceManifest(
    {
      tenantId: TENANT_ID,
      skillName: "safe-refactor",
      version,
      sourceModel: "qwen-3.6-27b",
      packageDigest: digest(`package:${version}`),
      sourceCommitDigest: digest(`commit:${version}`),
      sbomDigest: digest(`sbom:${version}`),
      dependencyLockDigest: digest(`lock:${version}`),
      permissionManifestDigest: digest(`permissions:${version}`),
      targetMatrixDigest: digest(`matrix:${version}`),
      evalBadgeDigest: digest(`badge:${version}`),
      lineage: [digest(`evidence:${version}`)],
      compatibilityMatrix: [
        {
          ...TARGET,
          accepted: true,
          safetyPassed: true,
          qualityScore: 0.9,
          sampleCount: 100,
          evalReceiptDigest: digest(`target-eval:${version}`),
        },
      ],
    },
    "signed-marketplace-manifest-value",
  );
}

function packageFixture(version = "2.0.0", target = TARGET) {
  const dependencyLock = buildSkillDependencyLock({
    tenantId: TENANT_ID,
    lock: { packages: { "fixture-tool": version } },
  });
  const runtimeManifest = buildSkillRuntimeManifest({
    tenantId: TENANT_ID,
    runtimes: [
      {
        runtimeId: target.tool,
        descriptor: { platform: target.os, runtime: target.runtime },
      },
    ],
  });
  const cells = [
    {
      cellId: "cli-linux",
      runtimeId: target.tool,
      targetEnvironmentRef: "environment:marketplace-cli",
      environmentDigest: digest("fixture-environment"),
    },
  ];
  const targetMatrix = buildSkillTargetMatrix({
    tenantId: TENANT_ID,
    dependencyLock,
    runtimeManifest,
    cells,
  });
  const input = {
    tenantId: TENANT_ID,
    skillName: "safe-refactor",
    derivationMode: "manual-import",
    sourceEvidenceRefs: [
      {
        ref: `evidence:marketplace-${version}`,
        digest: digest(`evidence:${version}`),
      },
    ],
    dependencyLock,
    runtimeManifest,
    targetMatrix,
    requestedCapabilities: ["file:read"],
  };
  const context = {
    expectedEnvironmentBindings: cells,
    expectedTargetMatrixRoot: targetMatrix.targetMatrixRoot,
  };
  const source = buildSkillCandidateDraft(
    { ...input, content: `# Safe refactor\nSource guidance ${version}.\n` },
    context,
  );
  const candidate = buildSkillCandidateDraft(
    {
      ...input,
      content: `# Safe refactor\nTarget-specific guidance ${version}.\n`,
    },
    context,
  );
  const packageBytes =
    serializeGovernedSkillMarketplaceCandidatePackage(source);
  const adaptedBytes =
    serializeGovernedSkillMarketplaceCandidatePackage(candidate);
  const sbomBytes = Buffer.from(
    canonical({ components: [{ name: "fixture-tool", version }] }),
  );
  const byteDigest = (value) =>
    `sha256:${createHash("sha256").update(value).digest("hex")}`;
  return {
    source,
    candidate,
    context,
    packageBytes,
    adaptedBytes,
    sbomBytes,
    packageDigest: byteDigest(packageBytes),
    adaptedOutputDigest: byteDigest(adaptedBytes),
    sbomDigest: byteDigest(sbomBytes),
  };
}

function catalogManifest(version = "2.0.0", target = TARGET) {
  const pack = packageFixture(version, target);
  const core = { ...manifest(version) };
  delete core.manifestDigest;
  delete core.signature;
  const value = buildGovernedSkillMarketplaceManifest(
    {
      ...core,
      compatibilityMatrix: core.compatibilityMatrix.map((cell) => ({
        ...cell,
        ...target,
      })),
      packageDigest: pack.packageDigest,
      sbomDigest: pack.sbomDigest,
      dependencyLockDigest: pack.candidate.dependencyLockDigest,
      targetMatrixDigest: pack.candidate.targetMatrixRoot,
      permissionManifestDigest:
        digestGovernedSkillMarketplaceCandidatePermissions(pack.candidate),
    },
    "placeholder-catalog-signature",
  );
  return Object.freeze({
    ...value,
    signature: createHmac("sha256", "test-only-catalog-key")
      .update(value.manifestDigest)
      .digest("base64"),
  });
}

function candidateInstaller(storage, artifacts, extra = {}, target = TARGET) {
  const descriptor = {
    schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
    authorityId: "authority:marketplace-test-admission",
    trust: "trusted",
    revision: 1,
    handlerArtifactDigest: digest("test-marketplace-admission"),
  };
  const authority = {
    ...descriptor,
    resolve(request) {
      const pack = ["2.0.0", "3.0.0"]
        .map((version) => packageFixture(version, target))
        .find(
          ({ candidate }) =>
            candidate.targetMatrixRoot === request.proposedTargetMatrixRoot,
        );
      if (
        !pack ||
        request.tenantId !== TENANT_ID ||
        request.skillName !== "safe-refactor"
      )
        return false;
      return {
        ...descriptor,
        schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA,
        admitted: true,
        tenantId: TENANT_ID,
        skillName: "safe-refactor",
        dependencyLockDigest: pack.candidate.dependencyLockDigest,
        runtimeManifestDigest: pack.candidate.runtimeManifestDigest,
        ...pack.context,
      };
    },
  };
  return createGovernedSkillMarketplaceCandidateInstaller({
    tenantId: TENANT_ID,
    registryOptions: {
      rootDir: path.join(storage.root, "marketplace-candidates"),
      targetMatrixAdmissionAuthority: authority,
      fsImpl: durableFilesystem(),
      secure: false,
      ...extra,
    },
    artifacts,
  });
}

// Real durable persistence and signed listings; deployment adapter/Pilot authorities are fixtures.
function cliHost(ledgerAdapter, overrides = {}) {
  const fixtureTarget = overrides.fixtureTarget ?? TARGET;
  const ports = {
    verifySignature: vi.fn(
      async ({ manifest: value }) =>
        value.signature ===
        createHmac("sha256", "test-only-catalog-key")
          .update(value.manifestDigest)
          .digest("base64"),
    ),
    adapt: vi.fn(async ({ manifest: value, cell }) => ({
      authenticated: true,
      manifestDigest: value.manifestDigest,
      evalReceiptDigest: cell.evalReceiptDigest,
      outputDigest: packageFixture(value.version, fixtureTarget)
        .adaptedOutputDigest,
      adapterDigest: digest("test-adapter"),
    })),
    verifyPilot: vi.fn(async ({ state, nextStage, pilotReceipt }) => ({
      authenticated: true,
      accepted:
        pilotReceipt ===
        `receipt:pilot:${nextStage}:${state.stateDigest.slice(7)}`,
      stateDigest: state.stateDigest,
      nextStage,
      receiptDigest: digest(`pilot:${state.stateDigest}:${nextStage}`),
    })),
    verifyRevocation: vi.fn(async ({ state, revocationReceipt }) => ({
      authenticated: true,
      revoked:
        revocationReceipt === `receipt:revoke:${state.stateDigest.slice(7)}`,
      manifestDigest: state.manifestDigest,
      receiptDigest: digest(`revoke:${state.stateDigest}`),
    })),
    transition: vi.fn(async ({ request, requestDigest }) => ({
      authenticated: true,
      durable: true,
      requestDigest,
      nextStage: request.nextStage,
      receiptDigest: digest(requestDigest),
    })),
    ...overrides.ports,
  };
  const catalog = overrides.catalog ?? {
    resolve: vi.fn(async ({ version }) =>
      catalogManifest(version ?? "2.0.0", fixtureTarget),
    ),
  };
  const artifacts = overrides.artifacts ?? {
    resolve: vi.fn(async ({ version }) =>
      packageFixture(version, fixtureTarget),
    ),
  };
  const storage = adapterStorage.get(ledgerAdapter);
  const installer = Object.hasOwn(overrides, "candidateInstaller")
    ? overrides.candidateInstaller
    : storage
      ? candidateInstaller(
          storage,
          artifacts,
          overrides.registryOptions,
          fixtureTarget,
        )
      : undefined;
  const host = createGovernedSkillMarketplaceCliHost({
    tenantId: TENANT_ID,
    target: overrides.target ?? TARGET,
    ledgerAdapter,
    candidateInstaller: installer,
    ports,
    catalog,
  });
  return {
    host,
    ports,
    catalog,
    candidateInstaller: installer,
    artifacts,
    storage,
  };
}

function installRequest(version = "2.0.0", expectedStateDigest = null) {
  return {
    skillName: "safe-refactor",
    version,
    manifestDigest: catalogManifest(version).manifestDigest,
    expectedStateDigest,
  };
}

function cliProgram(host) {
  const program = createBaseProgram()
    .exitOverride()
    .configureOutput({
      writeOut: () => {},
      writeErr: () => {},
    });
  registerMarketplaceCommand(program, { marketplaceHost: host });
  return program;
}

function candidateEntries(storage) {
  const directory = path.join(
    storage.root,
    "marketplace-candidates",
    "tenants",
    deriveSkillCandidateTenantKey(TENANT_ID),
  );
  return fs.existsSync(directory) ? fs.readdirSync(directory) : [];
}

async function publicBadge(harness, options = {}) {
  const service = await publicBadges.startGovernedSkillMarketplaceBadgeServer({
    marketplaceHost: harness.host,
    skillName: "safe-refactor",
    version: "2.0.0",
    manifestDigest: catalogManifest().manifestDigest,
    port: 0,
    ...options,
  });
  badgeServers.push(service);
  return service;
}

function badgeHarness(overrides = {}) {
  const storage = resources();
  const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
  return { ...cliHost(adapter(storage, backend.ledger), overrides), backend };
}

describe("public marketplace Eval badge", () => {
  it("serves a real read-only HTML/JSON page without tenant, candidate or private receipt data", async () => {
    const harness = badgeHarness();
    const service = await publicBadge(harness);
    const response = await fetch(service.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get("content-security-policy")).not.toContain(
      "unsafe-inline",
    );
    const html = await response.text();
    const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    expect(response.headers.get("content-security-policy")).toContain(
      `sha256-${createHash("sha256").update(style).digest("base64")}`,
    );
    expect(html).toContain("已核验的评测快照");
    expect(html).toContain("safe-refactor");
    expect(html).not.toContain("<script");
    const json = await (await fetch(`${service.url}badge.json`)).json();
    expect(json).toMatchObject({
      skillName: "safe-refactor",
      version: "2.0.0",
      revoked: false,
      manifestDigest: catalogManifest().manifestDigest,
      target: TARGET,
    });
    expect(new Date(json.expiresAt) - new Date(json.verifiedAt)).toBe(600_000);
    expect(Object.keys(json).sort()).toEqual(
      [
        "schema",
        "skillName",
        "version",
        "manifestDigest",
        "sourceModel",
        "sourceCommitDigest",
        "packageDigest",
        "sbomDigest",
        "dependencyLockDigest",
        "permissionManifestDigest",
        "targetMatrixDigest",
        "evalBadgeDigest",
        "evalReceiptDigest",
        "qualityScore",
        "sampleCount",
        "adaptedOutputDigest",
        "target",
        "revoked",
        "verifiedAt",
        "expiresAt",
        "checkedAt",
      ].sort(),
    );
    for (const value of [
      TENANT_ID,
      ARTIFACT_TENANT_ID,
      "candidateBinding",
      "signature",
      "receipt:pilot",
    ])
      expect(JSON.stringify(json)).not.toContain(value);
    expect(harness.ports.adapt).toHaveBeenCalledOnce();
    expect(harness.ports.transition).not.toHaveBeenCalled();
    expect(harness.artifacts.resolve).not.toHaveBeenCalled();
    expect(harness.backend.ledger.verify().sequence).toBe(0);
    expect(candidateEntries(harness.storage)).toEqual([]);
  });

  it("shows a historical revocation after a newer version and real ledger reopening", async () => {
    const harness = badgeHarness();
    const { state } = await harness.host.install(installRequest());
    const service = await publicBadge(harness);
    const revoked = await harness.host.revoke({
      skillName: state.skillName,
      expectedStateDigest: state.stateDigest,
      receiptRef: `receipt:revoke:${state.stateDigest.slice(7)}`,
    });
    await harness.host.install(installRequest("3.0.0", revoked.stateDigest));
    const adaptationCount = harness.ports.adapt.mock.calls.length;
    expect(
      await (await fetch(`${service.url}badge.json`)).json(),
    ).toMatchObject({ revoked: true, version: "2.0.0" });
    expect(await (await fetch(service.url)).text()).toContain(
      "已撤销 · 不可用于安装",
    );
    expect(harness.ports.adapt).toHaveBeenCalledTimes(adaptationCount);
    const reopened = createEvolutionLedgerFileBackend(
      harness.storage.backendOptions,
    );
    const next = cliHost(adapter(harness.storage, reopened.ledger));
    const fresh = await publicBadge(next);
    expect(await (await fetch(`${fresh.url}badge.json`)).json()).toMatchObject({
      revoked: true,
    });
    expect(reopened.ledger.verify().sequence).toBe(3);
  });

  it("fails closed on changed catalog or revoked signing trust without leaking errors", async () => {
    const harness = badgeHarness();
    const service = await publicBadge(harness);
    const originalSignature =
      harness.ports.verifySignature.getMockImplementation();
    harness.ports.verifySignature.mockImplementation(async () => {
      throw new Error("PRIVATE_INTERNAL_RECEIPT_PATH");
    });
    const denied = await fetch(service.url);
    expect(denied.status).toBe(503);
    expect(await denied.text()).not.toContain("PRIVATE_INTERNAL");
    harness.ports.verifySignature.mockImplementation(originalSignature);
    harness.catalog.resolve.mockResolvedValue(catalogManifest("3.0.0"));
    expect((await fetch(service.url)).status).toBe(503);
    expect(harness.ports.adapt).toHaveBeenCalledOnce();
  });

  it("expires a published evaluation without re-running adaptation for public requests", async () => {
    let time = Date.now();
    const harness = badgeHarness();
    const service = await publicBadge(harness, {
      snapshotTtlMs: 1000,
      now: () => time,
    });
    expect((await fetch(service.url)).status).toBe(200);
    time += 1000;
    expect((await fetch(service.url)).status).toBe(503);
    expect(harness.ports.adapt).toHaveBeenCalledOnce();
    time -= 2000;
    expect((await fetch(service.url)).status).toBe(503);
  });

  it("bounds timed-out verifiers and retains the concurrency slot until settlement", async () => {
    let blocked = false;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const harness = badgeHarness({
      catalog: {
        resolve: async () => {
          if (blocked) await gate;
          return catalogManifest();
        },
      },
    });
    const service = await publicBadge(harness, {
      requestTimeoutMs: 20,
      maxConcurrentRequests: 1,
    });
    try {
      blocked = true;
      expect((await fetch(service.url)).status).toBe(503);
      expect((await fetch(service.url)).status).toBe(429);
    } finally {
      blocked = false;
      release();
    }
    await new Promise((resolve) => setImmediate(resolve));
    expect((await fetch(service.url)).status).toBe(200);
    expect(harness.ports.adapt).toHaveBeenCalledOnce();
  });

  it("rejects mutation methods, bodies and undeclared paths while supporting HEAD", async () => {
    const service = await publicBadge(badgeHarness());
    expect(
      (await fetch(service.url, { method: "POST", body: "install" })).status,
    ).toBe(405);
    expect((await fetch(`${service.url}badge.json?skill=private`)).status).toBe(
      404,
    );
    expect((await fetch(`${service.url}install`)).status).toBe(404);
    const head = await fetch(service.url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const status = await new Promise((resolve, reject) => {
      const request = httpRequest(
        service.url,
        { method: "GET", headers: { "Content-Length": "1" } },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        },
      );
      request.once("error", reject);
      request.end("x");
    });
    expect(status).toBe(400);
  });

  it("requires the real host, explicit version/pin and bounded publication settings", async () => {
    const harness = badgeHarness();
    for (const options of [
      { marketplaceHost: {} },
      { marketplaceHost: new Proxy(harness.host, {}) },
      { version: null },
      { manifestDigest: digest("wrong") },
      { listen: "attacker.example" },
      { port: 65536 },
      { snapshotTtlMs: 0 },
    ])
      await expect(publicBadge(harness, options)).rejects.toThrow();
    expect(harness.ports.adapt).not.toHaveBeenCalled();
  });

  it("escapes page data and never treats metadata as executable markup", () => {
    const html = publicBadges.renderGovernedSkillMarketplaceBadge({
      skillName: '</title><script>alert("x")</script>',
      version: "<img src=x onerror=alert(1)>",
      target: { model: "<svg/onload=alert(1)>" },
      qualityScore: 0.9,
      sampleCount: 100,
      revoked: false,
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<svg");
    expect(html).toContain("&lt;script&gt;");
  });

  it("wires the CLI publication command to the exact selected host and cleans signal handlers", async () => {
    const harness = badgeHarness();
    const server = new EventEmitter();
    const close = vi.fn(async () => server.emit("close"));
    const start = vi
      .spyOn(publicBadges, "startGovernedSkillMarketplaceBadgeServer")
      .mockResolvedValue({ server, close, url: "http://127.0.0.1:1234/" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const prior = process.listeners("SIGTERM");
    try {
      await cliProgram(harness.host).parseAsync(
        [
          "marketplace",
          "serve-badge",
          "safe-refactor",
          "--skill-version",
          "2.0.0",
          "--manifest",
          catalogManifest().manifestDigest,
          "--port",
          "1234",
          "--snapshot-seconds",
          "30",
        ],
        { from: "user" },
      );
      expect(start).toHaveBeenCalledOnce();
      const { marketplaceHost: forwardedHost, ...forwarded } =
        start.mock.calls[0][0];
      // Chai treats an object's async inspect() as its synchronous debug hook.
      expect(forwardedHost === harness.host).toBe(true);
      expect(forwarded).toEqual({
        skillName: "safe-refactor",
        version: "2.0.0",
        manifestDigest: catalogManifest().manifestDigest,
        listen: "127.0.0.1",
        port: 1234,
        snapshotTtlMs: 30_000,
      });
      expect(log).toHaveBeenCalledWith(
        "Public Eval badge: http://127.0.0.1:1234/",
      );
      const added = process
        .listeners("SIGTERM")
        .filter((listener) => !prior.includes(listener));
      expect(added).toHaveLength(1);
      added[0]();
      await Promise.resolve();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      server.emit("close");
    }
    expect(process.listeners("SIGTERM")).toEqual(prior);
  });
});

describe("governed marketplace CLI with real durable storage", () => {
  it("passes the Skill version through the real root parser instead of printing the CLI version", async () => {
    const { host, storage, backend } = badgeHarness();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await cliProgram(host).parseAsync(
      ["marketplace", "inspect", "safe-refactor", "--skill-version", "3.0.0"],
      { from: "user" },
    );
    expect(JSON.parse(log.mock.lastCall[0])).toMatchObject({
      version: "3.0.0",
      manifestDigest: catalogManifest("3.0.0").manifestDigest,
    });
    await cliProgram(host).parseAsync(
      [
        "marketplace",
        "install",
        "safe-refactor",
        "--skill-version",
        "3.0.0",
        "--manifest",
        catalogManifest("3.0.0").manifestDigest,
      ],
      { from: "user" },
    );
    const staged = JSON.parse(log.mock.lastCall[0]);
    expect(staged).toMatchObject({
      status: "candidate-staged",
      state: { version: "3.0.0" },
      materialized: true,
    });
    const candidateFile = `${staged.state.candidateBinding.candidateId.slice(7)}.json`;
    // The tenant directory also contains its registry identity marker.
    expect(candidateEntries(storage)).toContain(candidateFile);
    expect(
      fs.readFileSync(
        path.join(
          storage.root,
          "marketplace-candidates",
          "tenants",
          deriveSkillCandidateTenantKey(TENANT_ID),
          candidateFile,
        ),
      ),
    ).toEqual(packageFixture("3.0.0").adaptedBytes);
    expect(backend.ledger.verify().sequence).toBe(1);
  });

  it("drives Desktop bootstrap/client/IPC through the real governed host and durable candidate files", async () => {
    const require = createRequire(import.meta.url);
    const {
      createDesktopGovernedSkillMarketplaceHost,
    } = require("../../../../desktop-app-vue/src/main/marketplace/governed-skill-marketplace-host.js");
    const {
      registerAIInitializers,
    } = require("../../../../desktop-app-vue/src/main/bootstrap/ai-initializer.js");
    const {
      registerSkillMarketplaceIPC,
    } = require("../../../../desktop-app-vue/src/main/marketplace/skill-marketplace-ipc.js");
    const desktopTarget = {
      ...TARGET,
      tool: "desktop",
      os: "win32-x64",
      runtime: "electron-39",
    };
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const { host } = cliHost(adapter(storage, backend.ledger), {
      target: desktopTarget,
      fixtureTarget: desktopTarget,
    });
    const bridgeOptions = {
      importHostModule: async () => ({ isGovernedSkillMarketplaceCliHost }),
    };
    await expect(
      createDesktopGovernedSkillMarketplaceHost({}, bridgeOptions),
    ).rejects.toThrow("branded host");
    const facade = await createDesktopGovernedSkillMarketplaceHost(
      host,
      bridgeOptions,
    );
    const registrations = new Map();
    registerAIInitializers({
      register: (entry) => registrations.set(entry.name, entry),
    });
    const db = {
      exec: vi.fn(),
      prepare: vi.fn(() => {
        throw new Error("legacy database writes are forbidden");
      }),
    };
    const client = await registrations
      .get("skillMarketplace")
      .init({ database: { db }, governedSkillMarketplaceHost: facade });
    const mainFrame = { parent: null, url: "http://127.0.0.1:5173" };
    const mainWindow = { webContents: { mainFrame } };
    const event = { sender: mainWindow.webContents, senderFrame: mainFrame };
    const handlers = new Map();
    registerSkillMarketplaceIPC({
      skillMarketplace: client,
      mainWindow,
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    });
    const invoke = (channel, input) => handlers.get(channel)(event, input);
    expect(handlers.size).toBe(20);
    mainFrame.url = "https://untrusted.invalid/";
    expect(() => handlers.get("skill-market:capabilities")(event, {})).toThrow(
      "trusted Desktop main frame",
    );
    mainFrame.url = "http://127.0.0.1:5173";
    expect(() =>
      handlers.get("skill-market:install")(
        { sender: {}, senderFrame: mainFrame },
        {},
      ),
    ).toThrow("trusted Desktop main frame");
    expect(() =>
      handlers.get("skill-market:inspect")(
        { sender: event.sender, senderFrame: {} },
        {},
      ),
    ).toThrow("trusted Desktop main frame");
    await expect(
      invoke("skill-market:capabilities", {}),
    ).resolves.toMatchObject({ available: true, target: desktopTarget });
    const inspected = await invoke("skill-market:inspect", {
      skillId: "safe-refactor",
      version: "2.0.0",
    });
    await expect(
      invoke("skill-market:install", {
        skillId: "safe-refactor",
        skillData: { name: "forged", manifestDigest: inspected.manifestDigest },
      }),
    ).rejects.toThrow("unsupported fields");
    await expect(
      invoke("skill-market:install", {
        skillId: "safe-refactor",
        skillData: {},
        target: TARGET,
      }),
    ).rejects.toThrow("unsupported fields");
    const installed = await invoke("skill-market:install", {
      skillId: "safe-refactor",
      skillData: {
        version: inspected.version,
        manifestDigest: inspected.manifestDigest,
      },
    });
    expect(installed).toMatchObject({
      materialized: true,
      activated: false,
      state: { target: desktopTarget },
    });
    const pack = packageFixture("2.0.0", desktopTarget);
    const filePath = path.join(
      storage.root,
      "marketplace-candidates",
      "tenants",
      deriveSkillCandidateTenantKey(TENANT_ID),
      `${installed.state.candidateBinding.candidateId.slice(7)}.json`,
    );
    expect(fs.readFileSync(filePath)).toEqual(pack.adaptedBytes);
    await expect(invoke("skill-market:get-installed")).resolves.toMatchObject([
      { status: "candidate", materialized: true, activated: false },
    ]);
    await expect(
      invoke("skill-market:auto-update", {
        skillId: "safe-refactor",
        enabled: true,
      }),
    ).rejects.toThrow("each update requires");
    await expect(
      invoke("skill-market:rollout", {
        skillId: "safe-refactor",
        expectedStateDigest: installed.state.stateDigest,
        receiptRef: "receipt:invalid",
      }),
    ).rejects.toThrow("exact-stage pilot receipt");
    const shadow = await invoke("skill-market:rollout", {
      skillId: "safe-refactor",
      expectedStateDigest: installed.state.stateDigest,
      receiptRef: `receipt:pilot:shadow:${installed.state.stateDigest.slice(7)}`,
    });
    expect(shadow.stage).toBe("shadow");
    const revoked = await invoke("skill-market:uninstall", {
      skillId: "safe-refactor",
      expectedStateDigest: shadow.stateDigest,
      receiptRef: `receipt:revoke:${shadow.stateDigest.slice(7)}`,
    });
    expect(revoked).toMatchObject({ stage: "rolled-back", revoked: true });
    const update = await invoke("skill-market:inspect", {
      skillId: "safe-refactor",
      version: "3.0.0",
    });
    await expect(
      invoke("skill-market:update", {
        skillId: "safe-refactor",
        skillData: {
          version: update.version,
          manifestDigest: update.manifestDigest,
        },
      }),
    ).rejects.toThrow("exact version and state digest");
    const updated = await invoke("skill-market:update", {
      skillId: "safe-refactor",
      skillData: {
        version: update.version,
        manifestDigest: update.manifestDigest,
        expectedStateDigest: revoked.stateDigest,
      },
    });
    expect(updated).toMatchObject({
      materialized: true,
      activated: false,
      state: { version: "3.0.0", stage: "candidate" },
    });
    expect(db.prepare).not.toHaveBeenCalled();
    const reopened = createEvolutionLedgerFileBackend(storage.backendOptions);
    const next = cliHost(adapter(storage, reopened.ledger), {
      target: desktopTarget,
      fixtureTarget: desktopTarget,
    });
    await expect(next.host.list()).resolves.toMatchObject({
      total: 1,
      items: [updated.state],
    });
    await expect(next.host.list({ offset: 1, limit: 1 })).resolves.toEqual({
      items: [],
      total: 1,
      offset: 1,
      limit: 1,
    });
    await expect(next.host.list({ limit: 501 })).rejects.toThrow("list bounds");
    await expect(next.host.list({ offset: -1 })).rejects.toThrow("list bounds");
    expect(reopened.ledger.verify().sequence).toBe(4);
  }, 60_000);

  it("allows a fresh CLI host to revoke a corrupt on-disk candidate without opening its registry", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const { state } = await cliHost(
      adapter(storage, backend.ledger),
    ).host.install(installRequest());
    const filePath = path.join(
      storage.root,
      "marketplace-candidates",
      "tenants",
      deriveSkillCandidateTenantKey(TENANT_ID),
      `${state.candidateBinding.candidateId.slice(7)}.json`,
    );
    fs.writeFileSync(filePath, "corrupted candidate bytes");
    const reopened = createEvolutionLedgerFileBackend(storage.backendOptions);
    const { host, ports } = cliHost(adapter(storage, reopened.ledger));
    await expect(host.state({ skillName: "safe-refactor" })).rejects.toThrow(
      "not bounded UTF-8 JSON",
    );
    const revoked = await host.revoke({
      skillName: "safe-refactor",
      expectedStateDigest: state.stateDigest,
      receiptRef: `receipt:revoke:${state.stateDigest.slice(7)}`,
    });
    expect(revoked).toMatchObject({ stage: "rolled-back", revoked: true });
    expect(ports.transition).toHaveBeenCalledOnce();
    await expect(host.state({ skillName: "safe-refactor" })).resolves.toEqual(
      revoked,
    );
    expect(reopened.ledger.verify().sequence).toBe(2);
  });
  it("requires explicit CAS to materialize legacy metadata-only state before rollout", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const real = adapter(storage, backend.ledger);
    const legacy = await marketplace(real).stage({
      manifest: catalogManifest(),
      target: TARGET,
    });
    const { host, ports } = cliHost(real);
    await expect(
      host.rollout({
        skillName: "safe-refactor",
        expectedStateDigest: legacy.stateDigest,
        receiptRef: "receipt:pilot",
      }),
    ).rejects.toThrow("candidate binding");
    expect(ports.verifyPilot).not.toHaveBeenCalled();
    await expect(host.install(installRequest())).rejects.toThrow(
      "baseline changed",
    );
    const result = await host.install(
      installRequest("2.0.0", legacy.stateDigest),
    );
    expect(result).toMatchObject({
      materialized: true,
      state: { previousStateDigest: legacy.stateDigest, stage: "candidate" },
    });
    expect(result.state.candidateBinding.candidateId).toBe(
      packageFixture().candidate.candidateId,
    );
    expect(backend.ledger.verify().sequence).toBe(2);
  });

  it("does not report materialized success if the file disappears during Ledger commit", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const candidate = packageFixture().candidate;
    const filePath = path.join(
      storage.root,
      "marketplace-candidates",
      "tenants",
      deriveSkillCandidateTenantKey(TENANT_ID),
      `${candidate.candidateId.slice(7)}.json`,
    );
    const ledger = {
      read: backend.ledger.read.bind(backend.ledger),
      verify: backend.ledger.verify.bind(backend.ledger),
      appendDomainEvent(input, options) {
        const receipt = backend.ledger.appendDomainEvent(input, options);
        fs.unlinkSync(filePath);
        return receipt;
      },
    };
    await expect(
      cliHost(adapter(storage, ledger)).host.install(installRequest()),
    ).rejects.toThrow("not found");
    expect(backend.ledger.verify().sequence).toBe(1);
  });

  it("recovers publication across a hard-exited installer process and independently verifies the committed file", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const pack = packageFixture();
    const manifest = catalogManifest();
    const input = {
      candidate: pack.candidate,
      inspected: {
        manifest,
        target: TARGET,
        adapted: { outputDigest: pack.adaptedOutputDigest },
      },
      ...Object.fromEntries(
        ["packageBytes", "adaptedBytes", "sbomBytes"].map((key) => [
          key,
          pack[key].toString("base64"),
        ]),
      ),
    };
    const inputPath = path.join(storage.root, "candidate-worker-input.json");
    fs.writeFileSync(inputPath, JSON.stringify(input));
    const run = (operation) =>
      spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL(
              "../integration/helpers/marketplace-candidate-worker.mjs",
              import.meta.url,
            ),
          ),
          storage.root,
          operation,
        ],
        { encoding: "utf8", timeout: 30_000, windowsHide: true },
      );
    const crashed = run("materialize-crash");
    expect(crashed.status, crashed.error?.message || crashed.stderr).toBe(97);
    expect(backend.ledger.verify().sequence).toBe(0);
    const { host } = cliHost(adapter(storage, backend.ledger));
    const { state } = await host.install(installRequest());
    fs.writeFileSync(inputPath, JSON.stringify({ ...input, state }));
    const verified = run("verify");
    expect(verified.status, verified.error?.message || verified.stderr).toBe(0);
    expect(JSON.parse(verified.stdout)).toEqual(state.candidateBinding);
    await expect(host.install(installRequest())).resolves.toMatchObject({
      recovered: true,
      state,
    });
    expect(backend.ledger.verify().sequence).toBe(1);
  }, 60_000);

  it.each([
    "dependencyLockDigest",
    "targetMatrixDigest",
    "permissionManifestDigest",
    "lineage",
  ])(
    "rejects signed %s claims that differ from actual candidate bytes",
    async (field) => {
      const storage = resources();
      const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
      const core = {
        ...catalogManifest(),
        [field]:
          field === "lineage"
            ? [digest("other-evidence")]
            : digest("other-execution"),
      };
      delete core.manifestDigest;
      delete core.signature;
      const unsigned = buildGovernedSkillMarketplaceManifest(
        core,
        "placeholder-catalog-signature",
      );
      const changed = {
        ...unsigned,
        signature: createHmac("sha256", "test-only-catalog-key")
          .update(unsigned.manifestDigest)
          .digest("base64"),
      };
      const { host } = cliHost(adapter(storage, backend.ledger), {
        catalog: { resolve: async () => changed },
      });
      await expect(
        host.install({
          ...installRequest(),
          manifestDigest: changed.manifestDigest,
        }),
      ).rejects.toThrow("differ from the signed manifest");
      expect(backend.ledger.verify().sequence).toBe(0);
      expect(candidateEntries(storage)).toEqual([]);
    },
  );

  it("does not replace a materialized candidate binding during rollout", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const real = adapter(storage, backend.ledger);
    const { state } = await cliHost(real).host.install(installRequest());
    const bindingCore = {
      ...state.candidateBinding,
      candidateId: digest("substituted-candidate"),
    };
    delete bindingCore.bindingDigest;
    const core = {
      ...state,
      stage: "shadow",
      transitionRequestDigest: digest("transition"),
      transitionReceiptDigest: digest("receipt"),
      candidateBinding: {
        ...bindingCore,
        bindingDigest: digest(
          "chainlesschain.governed-skill-marketplace-candidate-binding/v1",
          bindingCore,
        ),
      },
    };
    delete core.stateDigest;
    expect(() =>
      real.commit({
        state: {
          ...core,
          stateDigest: digestGovernedSkillMarketplaceState(core),
        },
        expectedStateDigest: state.stateDigest,
        event: "marketplace.advanced",
      }),
    ).toThrow("immutable candidateBinding");
    expect(backend.ledger.verify().sequence).toBe(1);
  });

  it("requires a genuine candidate installer, not a caller-supplied write receipt", () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const real = adapter(storage, backend.ledger);
    const { candidateInstaller: installer } = cliHost(real);
    for (const fake of [
      undefined,
      {},
      { tenantId: TENANT_ID, materialize: () => ({ durable: true }) },
      new Proxy(installer, {}),
    ]) {
      expect(() => cliHost(real, { candidateInstaller: fake })).toThrow(
        "branded marketplace candidate installer",
      );
    }
    expect(backend.ledger.verify().sequence).toBe(0);
  });

  it("writes exact adapted content and dependency files before publishing the marketplace state", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const pack = packageFixture();
    const filePath = path.join(
      storage.root,
      "marketplace-candidates",
      "tenants",
      deriveSkillCandidateTenantKey(TENANT_ID),
      `${pack.candidate.candidateId.slice(7)}.json`,
    );
    const ledger = {
      read: backend.ledger.read.bind(backend.ledger),
      verify: backend.ledger.verify.bind(backend.ledger),
      appendDomainEvent(input, options) {
        expect(fs.readFileSync(filePath)).toEqual(pack.adaptedBytes);
        return backend.ledger.appendDomainEvent(input, options);
      },
    };
    const { host } = cliHost(adapter(storage, ledger));
    const result = await host.install(installRequest());
    expect(result).toMatchObject({
      status: "candidate-staged",
      materialized: true,
      activated: false,
    });
    expect(result.state.candidateBinding).toMatchObject({
      candidateId: pack.candidate.candidateId,
      contentDigest: pack.candidate.contentDigest,
      dependencyLockDigest: pack.candidate.dependencyLockDigest,
      runtimeManifestDigest: pack.candidate.runtimeManifestDigest,
      targetMatrixRoot: pack.candidate.targetMatrixRoot,
    });
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toMatchObject({
      content: pack.candidate.content,
      dependencyLock: pack.candidate.dependencyLock,
    });
    expect(fs.readFileSync(filePath)).not.toEqual(pack.packageBytes);
    const reopened = createEvolutionLedgerFileBackend(storage.backendOptions);
    await expect(
      cliHost(adapter(storage, reopened.ledger)).host.state({
        skillName: "safe-refactor",
      }),
    ).resolves.toEqual(result.state);
    expect(reopened.ledger.verify().sequence).toBe(1);
  });

  it("recovers a candidate-only crash window before the marketplace Ledger append", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const ledger = {
      read: backend.ledger.read.bind(backend.ledger),
      verify: backend.ledger.verify.bind(backend.ledger),
      appendDomainEvent() {
        throw new Error("simulated crash after candidate publication");
      },
    };
    const first = cliHost(adapter(storage, ledger));
    await expect(first.host.install(installRequest())).rejects.toThrow(
      "simulated crash",
    );
    expect(backend.ledger.verify().sequence).toBe(0);
    const directory = path.join(
      storage.root,
      "marketplace-candidates",
      "tenants",
      deriveSkillCandidateTenantKey(TENANT_ID),
    );
    const entries = fs.readdirSync(directory);
    expect(entries).toHaveLength(2); // One tenant marker and one immutable candidate, no active pointer.
    const reopened = createEvolutionLedgerFileBackend(storage.backendOptions);
    const second = cliHost(adapter(storage, reopened.ledger));
    await expect(second.host.install(installRequest())).resolves.toMatchObject({
      materialized: true,
    });
    expect(fs.readdirSync(directory)).toEqual(entries);
    expect(reopened.ledger.verify().sequence).toBe(1);
  });

  it("blocks reads and rollout when the candidate file is missing but still permits emergency revocation", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const { host, ports } = cliHost(adapter(storage, backend.ledger));
    const { state } = await host.install(installRequest());
    const filePath = path.join(
      storage.root,
      "marketplace-candidates",
      "tenants",
      deriveSkillCandidateTenantKey(TENANT_ID),
      `${state.candidateBinding.candidateId.slice(7)}.json`,
    );
    fs.unlinkSync(filePath);
    await expect(host.state({ skillName: "safe-refactor" })).rejects.toThrow(
      "not found",
    );
    await expect(host.install(installRequest())).rejects.toThrow("not found");
    await expect(
      host.rollout({
        skillName: "safe-refactor",
        expectedStateDigest: state.stateDigest,
        receiptRef: `receipt:pilot:shadow:${state.stateDigest.slice(7)}`,
      }),
    ).rejects.toThrow("not found");
    expect(ports.transition).not.toHaveBeenCalled();
    const revoked = await host.revoke({
      skillName: "safe-refactor",
      expectedStateDigest: state.stateDigest,
      receiptRef: `receipt:revoke:${state.stateDigest.slice(7)}`,
    });
    expect(revoked).toMatchObject({ stage: "rolled-back", revoked: true });
    await expect(host.state({ skillName: "safe-refactor" })).resolves.toEqual(
      revoked,
    );
  });

  it.each(["packageBytes", "adaptedBytes", "sbomBytes"])(
    "rejects substituted %s before creating a candidate or marketplace event",
    async (field) => {
      const storage = resources();
      const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
      const { host } = cliHost(adapter(storage, backend.ledger), {
        artifacts: {
          resolve: async () => ({
            ...packageFixture(),
            [field]: Buffer.from("substituted"),
          }),
        },
      });
      await expect(host.install(installRequest())).rejects.toThrow(
        "digest mismatch",
      );
      expect(candidateEntries(storage)).toEqual([]);
      expect(backend.ledger.verify().sequence).toBe(0);
    },
  );

  it("passes the same governed host through lazy and eager entrypoints", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const { host } = cliHost(adapter(storage, backend.ledger));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fallback = vi.fn(() => {
      throw new Error("unexpected compatibility fallback");
    });
    await dispatchManifestEntry(
      [
        "node",
        "cc",
        "marketplace",
        "install",
        "safe-refactor",
        "--manifest",
        catalogManifest().manifestDigest,
      ],
      {
        name: "marketplace",
        module: "./commands/marketplace.js",
        register: "registerMarketplaceCommand",
      },
      {
        createBaseProgram: async () => createBaseProgram().exitOverride(),
        loadCommandDependencies: async () => ({ marketplaceHost: host }),
        loadFullProgram: fallback,
      },
    );
    const staged = JSON.parse(log.mock.lastCall[0]);
    const { createProgram } = await import("../../src/index.js");
    const eager = createProgram({
      commandDependencies: { marketplace: { marketplaceHost: host } },
    });
    await eager.parseAsync(["marketplace", "state", "safe-refactor"], {
      from: "user",
    });
    expect(JSON.parse(log.mock.lastCall[0])).toEqual(staged.state);
    expect(fallback).not.toHaveBeenCalled();
    expect(backend.ledger.verify().sequence).toBe(1);
  }, 60_000);

  it("requires a same-tenant branded adapter and snapshots the deployment target", () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const real = adapter(storage, backend.ledger);
    for (const fake of [
      {},
      Object.create(GovernedSkillMarketplaceLedgerAdapter.prototype),
      new Proxy(real, {}),
    ]) {
      expect(() => cliHost(fake)).toThrow("branded marketplace ledger adapter");
    }
    expect(() =>
      createGovernedSkillMarketplaceCliHost({
        tenantId: "tenant:other",
        ledgerAdapter: real,
      }),
    ).toThrow("same-tenant");
    const input = { ...TARGET };
    const { host } = cliHost(real, { target: input });
    input.model = "other";
    expect(host.target).toEqual(TARGET);
    expect(isGovernedSkillMarketplaceCliHost(host)).toBe(true);
    expect(isGovernedSkillMarketplaceCliHost(new Proxy(host, {}))).toBe(false);
    expect(() => cliHost(real, { target: { ...TARGET, extra: true } })).toThrow(
      "target",
    );
    expect(() =>
      cliHost(real, {
        target: {
          ...TARGET,
          get model() {
            throw new Error("getter ran");
          },
        },
      }),
    ).toThrow("data fields");
  });

  it("routes inspect/install/state through the real marketplace registrar and reopens one candidate", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const { host } = cliHost(adapter(storage, backend.ledger));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await cliProgram(host).parseAsync(
      ["marketplace", "inspect", "safe-refactor"],
      { from: "user" },
    );
    const inspected = JSON.parse(log.mock.lastCall[0]);
    expect(inspected).toMatchObject({
      target: TARGET,
      sampleCount: 100,
      state: null,
    });
    expect(inspected).not.toHaveProperty("signature");
    await cliProgram(host).parseAsync(
      [
        "marketplace",
        "install",
        "safe-refactor",
        "--manifest",
        inspected.manifestDigest,
      ],
      { from: "user" },
    );
    const staged = JSON.parse(log.mock.lastCall[0]);
    expect(staged).toMatchObject({
      status: "candidate-staged",
      activated: false,
      recovered: false,
      state: { stage: "candidate" },
    });
    const reopened = createEvolutionLedgerFileBackend(storage.backendOptions);
    const next = cliHost(adapter(storage, reopened.ledger));
    await cliProgram(next.host).parseAsync(
      ["marketplace", "state", "safe-refactor"],
      { from: "user" },
    );
    expect(JSON.parse(log.mock.lastCall[0])).toEqual(staged.state);
    await expect(next.host.install(installRequest())).resolves.toMatchObject({
      recovered: true,
      state: staged.state,
    });
    expect(reopened.ledger.verify().sequence).toBe(1);
  });

  it("recovers a durable stage acknowledgement loss without duplicating an event", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const ledger = {
      read: backend.ledger.read.bind(backend.ledger),
      verify: backend.ledger.verify.bind(backend.ledger),
      appendDomainEvent(input, options) {
        backend.ledger.appendDomainEvent(input, options);
        throw new Error("simulated lost stage acknowledgement");
      },
    };
    const { host } = cliHost(adapter(storage, ledger));
    await expect(host.install(installRequest())).resolves.toMatchObject({
      recovered: true,
      status: "candidate-staged",
    });
    const reopened = createEvolutionLedgerFileBackend(storage.backendOptions);
    await expect(
      cliHost(adapter(storage, reopened.ledger)).host.install(installRequest()),
    ).resolves.toMatchObject({ recovered: true });
    expect(reopened.ledger.verify().sequence).toBe(1);
  });

  it("pins manifest and baseline, requires exact-stage Pilot authority and prevents revoked-version resurrection", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const { host, ports } = cliHost(adapter(storage, backend.ledger));
    await expect(
      host.install({
        ...installRequest(),
        manifestDigest: digest("substitution"),
      }),
    ).rejects.toThrow("manifest changed");
    let { state } = await host.install(installRequest());
    await expect(host.install(installRequest("3.0.0"))).rejects.toThrow(
      "baseline changed",
    );
    const stagedDigest = state.stateDigest;
    for (const nextStage of ["shadow", "canary", "active"]) {
      const args = {
        skillName: "safe-refactor",
        expectedStateDigest: state.stateDigest,
      };
      await expect(
        host.rollout({ ...args, receiptRef: "receipt:unverified" }),
      ).rejects.toThrow("exact-stage pilot receipt");
      state = await host.rollout({
        ...args,
        receiptRef: `receipt:pilot:${nextStage}:${state.stateDigest.slice(7)}`,
      });
      expect(state.stage).toBe(nextStage);
    }
    expect(ports.transition).toHaveBeenCalledTimes(3);
    await expect(
      host.rollout({
        skillName: "safe-refactor",
        expectedStateDigest: stagedDigest,
        receiptRef: "receipt:old",
      }),
    ).rejects.toThrow("baseline changed");
    await expect(
      host.install(installRequest("2.0.0", state.stateDigest)),
    ).rejects.toThrow("already staged, advanced or revoked");
    await expect(
      host.revoke({
        skillName: "safe-refactor",
        expectedStateDigest: state.stateDigest,
        receiptRef: "receipt:unverified",
      }),
    ).rejects.toThrow("revocation is invalid");
    const revoked = await host.revoke({
      skillName: "safe-refactor",
      expectedStateDigest: state.stateDigest,
      receiptRef: `receipt:revoke:${state.stateDigest.slice(7)}`,
    });
    expect(revoked).toMatchObject({ revoked: true, stage: "rolled-back" });
    await expect(
      host.install(installRequest("2.0.0", revoked.stateDigest)),
    ).rejects.toThrow("was revoked");
    const updated = await host.install(
      installRequest("3.0.0", revoked.stateDigest),
    );
    expect(updated.state).toMatchObject({
      version: "3.0.0",
      stage: "candidate",
      previousStateDigest: revoked.stateDigest,
    });
    const reopened = createEvolutionLedgerFileBackend(storage.backendOptions);
    await expect(
      cliHost(adapter(storage, reopened.ledger)).host.install(
        installRequest("2.0.0", updated.state.stateDigest),
      ),
    ).rejects.toThrow("was revoked");
    expect(reopened.ledger.verify().sequence).toBe(6);
    expect(ports.transition).toHaveBeenCalledTimes(4);
  });

  it("rejects catalog, signature, target, adapter and transition substitutions before committing", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const real = adapter(storage, backend.ledger);
    await expect(
      cliHost(real, {
        catalog: { resolve: async () => catalogManifest("3.0.0") },
      }).host.install(installRequest()),
    ).rejects.toThrow("different Skill or version");
    await expect(
      cliHost(real, {
        ports: { verifySignature: async () => false },
      }).host.install(installRequest()),
    ).rejects.toThrow("signature is invalid");
    await expect(
      cliHost(real, {
        target: { ...TARGET, model: "unassessed-model" },
      }).host.install(installRequest()),
    ).rejects.toThrow();
    await expect(
      cliHost(real, {
        ports: { adapt: async () => ({ authenticated: true }) },
      }).host.install(installRequest()),
    ).rejects.toThrow("bind its output");
    expect(backend.ledger.verify().sequence).toBe(0);
    const { host, ports } = cliHost(real);
    const staged = await host.install(installRequest());
    ports.verifySignature = () => false; // Captured deployment callables cannot be replaced later.
    await expect(host.install(installRequest())).resolves.toMatchObject({
      recovered: true,
    });
    const { host: untrustedTransition } = cliHost(real, {
      ports: {
        transition: async () => ({ authenticated: true, durable: false }),
      },
    });
    await expect(
      untrustedTransition.rollout({
        skillName: "safe-refactor",
        expectedStateDigest: staged.state.stateDigest,
        receiptRef: `receipt:pilot:shadow:${staged.state.stateDigest.slice(7)}`,
      }),
    ).rejects.toThrow("durably apply");
    await expect(
      cliHost(real, { target: { ...TARGET, os: "other-os" } }).host.state({
        skillName: "safe-refactor",
      }),
    ).rejects.toThrow("another deployment target");
    expect(backend.ledger.verify().sequence).toBe(1);
  });

  it("fails closed without a branded host and rejects client authority/force options", async () => {
    const fake = {
      inspect: vi.fn(),
      install: vi.fn(),
      rollout: vi.fn(),
      revoke: vi.fn(),
      state: vi.fn(),
    };
    for (const host of [null, fake]) {
      for (const args of [
        [
          "serve-badge",
          "safe-refactor",
          "--skill-version",
          "2.0.0",
          "--manifest",
          digest("manifest"),
        ],
        ["inspect", "safe-refactor"],
        ["state", "safe-refactor"],
        ["install", "safe-refactor", "--manifest", digest("manifest")],
        [
          "rollout",
          "safe-refactor",
          "--expected-state",
          digest("state"),
          "--receipt",
          "receipt:pilot",
        ],
        [
          "revoke",
          "safe-refactor",
          "--expected-state",
          digest("state"),
          "--receipt",
          "receipt:revoke",
        ],
      ])
        await expect(
          cliProgram(host).parseAsync(["marketplace", ...args], {
            from: "user",
          }),
        ).rejects.toThrow("trusted deployment host");
    }
    for (const callable of Object.values(fake))
      expect(callable).not.toHaveBeenCalled();
    await expect(
      cliProgram(fake).parseAsync(
        [
          "marketplace",
          "install",
          "safe-refactor",
          "--manifest",
          digest("manifest"),
          "--force",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow("unknown option");
    await expect(
      cliProgram(fake).parseAsync(
        [
          "marketplace",
          "rollout",
          "safe-refactor",
          "--expected-state",
          digest("state"),
          "--receipt",
          "receipt:pilot",
          "--stage",
          "active",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow("unknown option");
  });
});

function revocationRequest(state) {
  const core = {
    schema: SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
    tenantId: TENANT_ID,
    streamId: "pilot:marketplace-revocations",
    operationId: `skill-revocation:${digest("transition").slice(7)}:${digest("marketplace-dependency").slice(7)}`,
    transitionDigest: digest("transition"),
    candidateId: digest("candidate"),
    skillName: "safe-refactor",
    occurredAt: NOW,
    sourceReceiptDigest: digest("source-receipt"),
    resolutionDigest: digest("resolution"),
    dependency: {
      kind: "marketplace-badge",
      ref: `marketplace-state:${TENANT_ID}:safe-refactor`,
      digest: state.stateDigest,
      disposition: "revoke",
    },
  };
  return Object.freeze({
    ...core,
    requestDigest: digestSkillRevocationDependencyRequest(core),
  });
}

describe("GovernedSkillMarketplaceLedgerAdapter", () => {
  it("reopens a staged and revoked marketplace state from real Ledger files", async () => {
    const storage = resources();
    const firstBackend = createEvolutionLedgerFileBackend(
      storage.backendOptions,
    );
    const firstAdapter = adapter(storage, firstBackend.ledger);
    const first = marketplace(firstAdapter);
    const staged = await first.stage({
      manifest: manifest(),
      target: TARGET,
      expectedStateDigest: null,
    });
    const request = revocationRequest(staged);
    const revoked = await first.revokeMarketplaceBadge(request);
    expect(revoked).toMatchObject({
      authenticated: true,
      durable: true,
      disposition: "revoke",
    });

    const reopenedBackend = createEvolutionLedgerFileBackend(
      storage.backendOptions,
    );
    const reopenedAdapter = adapter(storage, reopenedBackend.ledger);
    const reopened = marketplace(reopenedAdapter);
    await expect(reopened.revokeMarketplaceBadge(request)).resolves.toEqual(
      revoked,
    );
    expect(reopenedAdapter.load({ skillName: "safe-refactor" })).toMatchObject({
      stage: "rolled-back",
      revoked: true,
      revocationPropagationRequestDigest: request.requestDigest,
    });
    expect(reopenedBackend.ledger.verify()).toMatchObject({ sequence: 2 });
    expect(reopenedBackend.ledger.read().map(({ type }) => type)).toEqual([
      GOVERNED_SKILL_MARKETPLACE_LEDGER_EVENT_TYPE,
      GOVERNED_SKILL_MARKETPLACE_LEDGER_EVENT_TYPE,
    ]);
  });

  it("recovers a revocation append response loss without duplicating state", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    let loseRevocationAck = false;
    const ledger = {
      read: backend.ledger.read.bind(backend.ledger),
      verify: backend.ledger.verify.bind(backend.ledger),
      appendDomainEvent(input, options) {
        const receipt = backend.ledger.appendDomainEvent(input, options);
        if (loseRevocationAck) {
          loseRevocationAck = false;
          throw new Error("simulated marketplace ledger response loss");
        }
        return receipt;
      },
    };
    const ledgerAdapter = adapter(storage, ledger);
    const subject = marketplace(ledgerAdapter);
    const staged = await subject.stage({
      manifest: manifest(),
      target: TARGET,
      expectedStateDigest: null,
    });
    loseRevocationAck = true;
    await expect(
      subject.revokeMarketplaceBadge(revocationRequest(staged)),
    ).resolves.toMatchObject({ durable: true, disposition: "revoke" });
    expect(backend.ledger.verify()).toMatchObject({ sequence: 2 });
  });

  it("rejects immutable package replacement across an advance", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const ledgerAdapter = adapter(storage, backend.ledger);
    const subject = marketplace(ledgerAdapter);
    const staged = await subject.stage({
      manifest: manifest(),
      target: TARGET,
      expectedStateDigest: null,
    });
    const core = {
      ...staged,
      packageDigest: digest("substituted-package"),
      stage: "shadow",
      transitionRequestDigest: digest("transition-request"),
      transitionReceiptDigest: digest("transition-receipt"),
    };
    delete core.stateDigest;
    expect(() =>
      ledgerAdapter.commit({
        state: {
          ...core,
          stateDigest: digestGovernedSkillMarketplaceState(core),
        },
        expectedStateDigest: staged.stateDigest,
        event: "marketplace.advanced",
      }),
    ).toThrow(
      expect.objectContaining({
        code: GOVERNED_SKILL_MARKETPLACE_LEDGER_CORRUPT_CODE,
      }),
    );
    expect(backend.ledger.verify()).toMatchObject({ sequence: 1 });
  });
});
