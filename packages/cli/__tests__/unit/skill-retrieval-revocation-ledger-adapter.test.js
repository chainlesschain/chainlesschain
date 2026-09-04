import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import {
  SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
  digestSkillRevocationDependencyRequest,
} from "../../src/lib/evolution/skill-revocation-propagation.js";
import {
  SKILL_RETRIEVAL_REVOCATION_STATE_SCHEMA,
  digestSkillRetrievalRevocationState,
  openSkillRetrievalRevocationAuthority,
} from "../../src/lib/evolution/skill-retrieval-revocation-authority.js";
import {
  SKILL_RETRIEVAL_REVOCATION_LEDGER_CONFLICT_CODE,
  SKILL_RETRIEVAL_REVOCATION_LEDGER_CORRUPT_CODE,
  SKILL_RETRIEVAL_REVOCATION_LEDGER_EVENT_TYPE,
  SkillRetrievalRevocationLedgerAdapter,
} from "../../src/lib/evolution/skill-retrieval-revocation-ledger-adapter.js";

const NOW = "2026-09-05T14:00:00.000Z";
const TENANT_ID = "tenant:retrieval-revocation";
const ARTIFACT_TENANT_ID = "artifact-tenant-retrieval-revocation";
const roots = [];

afterEach(() => {
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
    keyId: `key://tests/retrieval-revocation-${label}`,
    trustPolicyDigest: digest(`${label}-policy`),
  });
  const secret = `test-only-retrieval-revocation-${label}-secret`;
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
  let nextDescriptor = -100_000;
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
    path.join(fs.realpathSync(os.tmpdir()), "cc-retrieval-revocation-ledger-"),
  );
  roots.push(root);
  const now = Date.parse(NOW);
  const artifactSecret = "test-only-retrieval-revocation-artifact-secret";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/retrieval-revocation-artifacts";
  const policyDigest = digest("retrieval-revocation-artifact-policy");
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
          decisionExpiresAt: "2026-09-05T14:01:00.000Z",
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
    artifactPorts,
    resolver,
    backendOptions: {
      rootDir: path.join(root, "ledger-events"),
      authorityRootDir: path.join(root, "ledger-authority"),
      witnessFilePath: path.join(witnessRoot, "checkpoint.json"),
      witnessId: "retrieval-revocation-ledger-witness",
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
  return new SkillRetrievalRevocationLedgerAdapter({
    descriptor: {
      tenantId: TENANT_ID,
      artifactTenantId: ARTIFACT_TENANT_ID,
      streamId: "retrieval-revocations:main",
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
    },
    artifactPorts: storage.artifactPorts,
    ledger,
    ledgerArtifactResolver: storage.resolver,
    now: () => Date.parse(NOW),
  });
}

function request(contentDigest, suffix = "one") {
  const core = {
    schema: SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
    tenantId: TENANT_ID,
    streamId: "pilot:retrieval-revocations",
    operationId: `skill-revocation:${digest(`transition-${suffix}`).slice(7)}:${digest(`dependency-${suffix}`).slice(7)}`,
    transitionDigest: digest(`transition-${suffix}`),
    candidateId: digest(`candidate-${suffix}`),
    skillName: "safe-refactor",
    occurredAt: NOW,
    sourceReceiptDigest: digest(`source-receipt-${suffix}`),
    resolutionDigest: digest(`resolution-${suffix}`),
    dependency: {
      kind: "retrieval-index",
      ref: `skill-content:${TENANT_ID}:safe-refactor`,
      digest: contentDigest,
      disposition: "invalidate",
    },
  };
  return Object.freeze({
    ...core,
    requestDigest: digestSkillRevocationDependencyRequest(core),
  });
}

describe("SkillRetrievalRevocationLedgerAdapter", () => {
  it("recovers a commit acknowledgement loss and reopens the invalidation from real files", async () => {
    const storage = resources();
    const firstBackend = createEvolutionLedgerFileBackend(
      storage.backendOptions,
    );
    let loseAck = true;
    const ledger = {
      read: firstBackend.ledger.read.bind(firstBackend.ledger),
      verify: firstBackend.ledger.verify.bind(firstBackend.ledger),
      appendDomainEvent(input, options) {
        const receipt = firstBackend.ledger.appendDomainEvent(input, options);
        if (loseAck) {
          loseAck = false;
          throw new Error("simulated retrieval ledger response loss");
        }
        return receipt;
      },
    };
    const firstAdapter = adapter(storage, ledger);
    const first = await openSkillRetrievalRevocationAuthority({
      tenantId: TENANT_ID,
      ports: firstAdapter.persistencePorts(),
    });
    const contentDigest = digest("skill-content-one");
    await expect(
      first.invalidateRetrieval(request(contentDigest)),
    ).resolves.toMatchObject({
      authenticated: true,
      durable: true,
      dependencyDigest: contentDigest,
      disposition: "invalidate",
    });

    const reopenedBackend = createEvolutionLedgerFileBackend(
      storage.backendOptions,
    );
    const reopenedAdapter = adapter(storage, reopenedBackend.ledger);
    const reopened = await openSkillRetrievalRevocationAuthority({
      tenantId: TENANT_ID,
      ports: reopenedAdapter.persistencePorts(),
    });
    expect(
      reopened.inspect({
        skillName: "safe-refactor",
        contentDigest,
      }),
    ).toMatchObject({ invalidated: true, tenantId: TENANT_ID });
    expect(reopenedBackend.ledger.verify()).toMatchObject({ sequence: 1 });
    expect(reopenedBackend.ledger.read()[0].type).toBe(
      SKILL_RETRIEVAL_REVOCATION_LEDGER_EVENT_TYPE,
    );
  });

  it("maintains exact source lineage across multiple state revisions", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const subject = adapter(storage, backend.ledger);
    const authority = await openSkillRetrievalRevocationAuthority({
      tenantId: TENANT_ID,
      ports: subject.persistencePorts(),
    });
    const firstDigest = digest("skill-content-one");
    const secondDigest = digest("skill-content-two");
    await authority.invalidateRetrieval(request(firstDigest, "one"));
    await authority.invalidateRetrieval(request(secondDigest, "two"));

    const events = backend.ledger.read();
    expect(events).toHaveLength(2);
    expect(events[1].sourceRefs).toEqual([events[0].subjectRef]);
    expect(
      authority.inspect({
        skillName: "safe-refactor",
        contentDigest: firstDigest,
      }).invalidated,
    ).toBe(true);
    expect(
      authority.inspect({
        skillName: "safe-refactor",
        contentDigest: secondDigest,
      }).invalidated,
    ).toBe(true);
  });

  it("rejects cross-tenant loads and stale competing state commits", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const subject = adapter(storage, backend.ledger);
    expect(() => subject.load({ tenantId: "tenant:other" })).toThrow(
      "load tenant is invalid",
    );
    const first = await openSkillRetrievalRevocationAuthority({
      tenantId: TENANT_ID,
      ports: subject.persistencePorts(),
    });
    const stale = await openSkillRetrievalRevocationAuthority({
      tenantId: TENANT_ID,
      ports: subject.persistencePorts(),
    });
    await first.invalidateRetrieval(
      request(digest("skill-content-one"), "one"),
    );
    const current = subject.load({ tenantId: TENANT_ID }).state;
    const erasingCore = {
      schema: SKILL_RETRIEVAL_REVOCATION_STATE_SCHEMA,
      tenantId: TENANT_ID,
      revision: 2,
      invalidations: {},
    };
    expect(() =>
      subject.commit({
        state: {
          ...erasingCore,
          stateDigest: digestSkillRetrievalRevocationState(erasingCore),
        },
        expectedStateDigest: current.stateDigest,
      }),
    ).toThrow(
      expect.objectContaining({
        code: SKILL_RETRIEVAL_REVOCATION_LEDGER_CORRUPT_CODE,
      }),
    );
    await expect(
      stale.invalidateRetrieval(request(digest("skill-content-two"), "two")),
    ).rejects.toMatchObject({
      code: SKILL_RETRIEVAL_REVOCATION_LEDGER_CONFLICT_CODE,
    });
    expect(backend.ledger.verify()).toMatchObject({ sequence: 1 });
  });
});
