import { captureWikiRevisionReader } from "./wiki-maintainer-ledger-adapter.js";
import { captureRawDeletionLedgerReader } from "./evolution-raw-deletion-ledger-adapter.js";
import { capturePruningData } from "./governed-wiki-pruning-journal.js";
import { GovernedWikiPruning } from "./governed-wiki-pruning.js";
import { GovernedWikiPruningLedgerAdapter } from "./governed-wiki-pruning-ledger-adapter.js";
import { GovernedWikiPruningPlanAuthority } from "./governed-wiki-pruning-plan-authority.js";
import { GovernedWikiPruningMaintenance } from "./governed-wiki-pruning-maintenance.js";
import { GovernedWikiPruningRawShred } from "./governed-wiki-pruning-raw-shred.js";
import { GovernedWikiPruningRetrieval } from "./governed-wiki-pruning-retrieval.js";

// Deployment composition, not an acknowledgement-port harness. Every effect
// and verifier below is a concrete repository implementation. The caller owns
// the physical Ledger/ArtifactStore and independent privacy/KMS/release keys.
// No fallback signer, fake successful shred, or task-time self-modification.
export function createGovernedWikiPruningRuntime({
  descriptor: input,
  artifactPorts,
  ledgerArtifactResolver,
  ledger,
  wikiLedgerAdapter,
  deletionLedgerAdapter,
  skillRollbackProvider = null,
  keyAuthority,
  clock = Date.now,
} = {}) {
  const descriptor = capturePruningData(input);
  const wiki = captureWikiRevisionReader(wikiLedgerAdapter);
  const raw = captureRawDeletionLedgerReader(
    deletionLedgerAdapter,
    descriptor.tenantId,
    descriptor.streamId,
  );
  for (const key of ["tenantId", "artifactTenantId", "audience", "purpose"])
    if (
      wiki.descriptor[key] !== descriptor[key] ||
      raw.descriptor[key] !== descriptor[key]
    )
      throw new TypeError(
        "pruning runtime stores must share the exact deployment scope",
      );
  const maintenance = new GovernedWikiPruningMaintenance({
    descriptor,
    wikiLedgerAdapter,
    skillRollbackProvider,
  });
  const authority = new GovernedWikiPruningPlanAuthority({
    descriptor,
    wikiLedgerAdapter,
    deletionReceipts: { resolve: raw.resolveDeletionReceipt },
    wikiMaintenance: maintenance.authorityPorts(),
  });
  const rawShred = new GovernedWikiPruningRawShred({
    descriptor,
    deletionLedgerAdapter,
    keyAuthority,
  });
  const retrieval = new GovernedWikiPruningRetrieval({
    descriptor,
    wikiLedgerAdapter,
    skillRollbackProvider,
    artifactPorts,
    ledgerArtifactResolver,
    ledger,
    clock,
  });
  const wikiReceiptVerifier = maintenance.operationReceiptVerifier();
  const rawReceiptVerifier = rawShred.operationReceiptVerifier();
  const retrievalReceiptVerifier = retrieval.operationReceiptVerifier();
  const journal = new GovernedWikiPruningLedgerAdapter({
    descriptor,
    artifactPorts,
    ledgerArtifactResolver,
    ledger,
    clock,
    planVerifier: authority.verifier(),
    operationReceiptVerifier: {
      async verifyAll(inputs) {
        const wikiInputs = [];
        for (const input of inputs) {
          switch (input.request.operation) {
            case "dependency-dispositions":
            case "wiki-revision":
              wikiInputs.push(input);
              break;
            case "crypto-shred":
              if (!(await rawReceiptVerifier.verify(input))) return false;
              break;
            case "retrieval-projection":
              if (!(await retrievalReceiptVerifier.verify(input))) return false;
              break;
            default:
              return false;
          }
        }
        return !wikiInputs.length || wikiReceiptVerifier.verifyMany(wikiInputs);
      },
      verify(input) {
        switch (input.request.operation) {
          case "dependency-dispositions":
          case "wiki-revision":
            return wikiReceiptVerifier.verify(input);
          case "crypto-shred":
            return rawReceiptVerifier.verify(input);
          case "retrieval-projection":
            return retrievalReceiptVerifier.verify(input);
          default:
            return false;
        }
      },
    },
  });
  const provider = maintenance.createProvider(journal);
  const rawProvider = rawShred.createProvider(journal);
  const retrievalProvider = retrieval.createProvider(journal);
  const controller = new GovernedWikiPruning({
    descriptor,
    journalStore: journal,
    ports: {
      loadWikiState: wiki.loadWiki,
      resolveDeletionReceipt: raw.resolveDeletionReceipt,
      ...provider,
      ...rawProvider,
      ...retrievalProvider,
      verifyOfflineClosure() {
        throw new Error(
          "task-time online adaptation is not enabled by the pruning runtime",
        );
      },
    },
  });
  return Object.freeze({
    descriptor,
    controller,
    journal,
    maintenance,
    authority,
    rawShred,
    retrieval,
    provider,
    rawProvider,
    retrievalProvider,
    wikiReceiptVerifier,
    rawReceiptVerifier,
    retrievalReceiptVerifier,
    plan: (input) => controller.plan(input),
    execute: (input) => controller.execute(input),
    resume: (input) => controller.resume(input),
    retrievalReader: retrieval.createProposerReader({
      journalStore: journal,
      policy: { proposerWikiRead: true, executionAgentWikiRead: false },
    }),
  });
}
