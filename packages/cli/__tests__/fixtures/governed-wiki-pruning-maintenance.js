import { createHmac } from "node:crypto";
import { openEvolutionDurableStore } from "./evolution-durable-store.js";
import {
  EvidenceBackedWikiMaintainer,
  WIKI_EVIDENCE_SCHEMA,
  WIKI_MAINTENANCE_REQUEST_SCHEMA,
  digestWikiState as D,
} from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";
import { WikiMaintainerLedgerAdapter } from "../../src/lib/evolution/wiki-maintainer-ledger-adapter.js";
import { GovernedWikiPruning } from "../../src/lib/evolution/governed-wiki-pruning.js";
import { GovernedWikiPruningLedgerAdapter } from "../../src/lib/evolution/governed-wiki-pruning-ledger-adapter.js";
import { GovernedWikiPruningPlanAuthority } from "../../src/lib/evolution/governed-wiki-pruning-plan-authority.js";
import { GovernedWikiPruningMaintenance } from "../../src/lib/evolution/governed-wiki-pruning-maintenance.js";
import { pruningCanonical } from "../../src/lib/evolution/governed-wiki-pruning-journal.js";

const AT = "2026-09-05T00:00:00.000Z";
const sign = (core) =>
  createHmac("sha256", "test-only-non-wiki-effect")
    .update(pruningCanonical(core))
    .digest("hex");

// Actual Wiki/Maintainer, plan authority, controller, journal, artifacts and
// independent file witness. ONLY non-Wiki effects remain signed test fixtures;
// this is not a production rollback/KMS/retrieval implementation.
export function openPruningMaintenanceStore(root, hooks = {}) {
  const resources = openEvolutionDurableStore(root);
  const ledger = resources.backend.ledger;
  const descriptor = {
    tenantId: resources.descriptor.tenantId,
    streamId: resources.descriptor.streamId,
  };
  const wiki = new WikiMaintainerLedgerAdapter({
    descriptor: { ...resources.descriptor, evolutionRunId: "pruning-wiki" },
    artifactPorts: resources.artifactPorts,
    ledgerArtifactResolver: resources.resolver,
    ledger: {
      read: (options) => ledger.read(options),
      verify: () => ledger.verify(),
      appendDomainEvent(input, options) {
        hooks.beforeWikiAppend?.(input, options);
        const result = ledger.appendDomainEvent(input, options);
        hooks.afterWikiAppend?.(input, result);
        return result;
      },
    },
  });
  const maintenance = new GovernedWikiPruningMaintenance({
    descriptor,
    wikiLedgerAdapter: wiki,
  });
  const deletionReceipts = {
    resolve: () => {
      throw new Error("Raw deletion is outside this Wiki fixture");
    },
  };
  const authority = new GovernedWikiPruningPlanAuthority({
    descriptor,
    wikiLedgerAdapter: wiki,
    deletionReceipts,
    wikiMaintenance: maintenance.authorityPorts(),
  });
  const wikiReceiptVerifier = maintenance.operationReceiptVerifier();
  const journal = new GovernedWikiPruningLedgerAdapter({
    descriptor: resources.descriptor,
    artifactPorts: resources.artifactPorts,
    ledgerArtifactResolver: resources.resolver,
    planVerifier: authority.verifier(),
    clock: resources.clock,
    operationReceiptVerifier: {
      verify(input) {
        if (input.request.operation === "wiki-revision")
          return wikiReceiptVerifier.verify(input);
        const { attestation, ...core } = input.receipt;
        return (
          core.requestDigest === input.requestDigest &&
          core.receiptDigest === D(input.request) &&
          attestation === sign(core)
        );
      },
    },
    ledger: {
      read: (options) => ledger.read(options),
      verify: () => ledger.verify(),
      appendDomainEvent(input, options) {
        hooks.beforeJournalAppend?.(input, options);
        const result = ledger.appendDomainEvent(input, options);
        hooks.afterJournalAppend?.(input, result);
        return result;
      },
    },
  });
  const provider = maintenance.createProvider(journal);
  const otherEffect = (call) => {
    if (
      call.request.operation === "dependency-dispositions" &&
      call.request.payload.length !== 0
    )
      throw new Error("real dependency rollback is outside this Wiki fixture");
    hooks.nonWikiEffect?.(call);
    const core = {
      authenticated: true,
      durable: true,
      requestDigest: call.requestDigest,
      receiptDigest: D(call.request),
    };
    return { ...core, attestation: sign(core) };
  };
  const controller = new GovernedWikiPruning({
    descriptor,
    journalStore: journal,
    ports: {
      loadWikiState: wiki.loadWiki,
      resolveDeletionReceipt: deletionReceipts.resolve,
      applyDependencyDispositions: otherEffect,
      applyWikiRevision: provider.applyWikiRevision,
      cryptoShred: () => {
        throw new Error("unexpected Raw deletion");
      },
      publishRetrievalProjection: otherEffect,
      verifyOfflineClosure: () => {
        throw new Error("unexpected online adaptation");
      },
    },
  });
  const evidenceCore = {
    schema: WIKI_EVIDENCE_SCHEMA,
    tenantId: descriptor.tenantId,
    ref: "ev-maintenance",
    sourceDigest: D("retained-source"),
    projectionDigest: D("retained-projection"),
    artifactRef: `artifact://${descriptor.tenantId}/trusted/retained-metadata`,
    trustedProjection: true,
    trustDomain: "test-retained",
    kind: "tool-observation",
    status: "active",
    observedAt: "2026-06-01T00:00:00.000Z",
    expiresAt: null,
    data: { result: "verified" },
  };
  async function writeWiki(operations, requestDigest = null) {
    const maintainer = new EvidenceBackedWikiMaintainer({
      descriptor: {
        tenantId: descriptor.tenantId,
        evolutionRunId: "pruning-wiki",
        maintainerModel: "test:seed",
        rulesDigest: D("seed-rules"),
      },
      policy: {
        trustedProjectionRead: true,
        rawEvidenceRead: false,
        activeSkillWrite: false,
        shell: false,
        network: false,
        secretRead: false,
      },
      ports: wiki.maintainerPorts({
        resolveEvidence: () => ({
          ...evidenceCore,
          envelopeDigest: D(evidenceCore),
        }),
        derive: () => ({ operations }),
      }),
    });
    return maintainer.maintain({
      evidenceRefs: [evidenceCore.ref],
      effectiveAt: AT,
      ...(requestDigest
        ? {
            maintenanceRequest: {
              schema: WIKI_MAINTENANCE_REQUEST_SCHEMA,
              tenantId: descriptor.tenantId,
              requestDigest,
              requestId: `wiki-maintenance:${requestDigest.slice(7)}`,
            },
          }
        : {}),
    });
  }
  async function seed(count = 1) {
    for (let start = 0; start < count; start += 128) {
      await writeWiki(
        Array.from({ length: Math.min(count - start, 128) }, (_, index) => ({
          type: "upsert",
          pattern: {
            patternId: `pat-maintenance-${String(start + index).padStart(4, "0")}`,
            kind: "success",
            summary: `Retained expired procedure ${start + index}`,
            rootCause: "Bounded deterministic pruning",
            procedure: "Verify before using",
            appliesWhen: ["evidence remains valid"],
            doesNotApplyWhen: [],
            positiveEvidence: [evidenceCore.ref],
            negativeEvidence: [],
            contradicts: [],
            supersedes: [],
            confidence: 0.8,
            trustDomains: [],
            lastVerifiedAt: "2026-06-01T00:00:00.000Z",
            expiresAt: "2026-07-01T00:00:00.000Z",
            skillNames: [],
          },
        })),
      );
    }
  }
  const plan = () =>
    controller.plan({
      expectedStateDigest: wiki.loadWiki().stateDigest,
      effectiveAt: AT,
    });
  async function execute() {
    const restored = await journal.load({ tenantId: descriptor.tenantId });
    return controller.execute({ plan: restored.state?.plan ?? (await plan()) });
  }
  async function inspect() {
    const restored = await journal.load({ tenantId: descriptor.tenantId });
    const current = wiki.loadWiki();
    return {
      phase: restored.state?.phase ?? null,
      journalRevision: restored.state?.revision ?? 0,
      operationCount: restored.state?.operationReceipts.length ?? 0,
      wikiRevision: current.state.revision,
      stateDigest: current.stateDigest,
      maintenanceRequestCount: Object.keys(
        current.state.maintenanceRequests ?? {},
      ).length,
      patternStatuses: Object.values(current.state.patterns).map(
        (pattern) => pattern.status,
      ),
      ledgerSequence: ledger.verify().sequence,
      wikiReceipt: restored.state?.operationReceipts[1] ?? null,
    };
  }
  return {
    root,
    resources,
    descriptor,
    wiki,
    maintenance,
    authority,
    journal,
    provider,
    wikiReceiptVerifier,
    controller,
    seed,
    writeWiki,
    plan,
    execute,
    inspect,
  };
}
