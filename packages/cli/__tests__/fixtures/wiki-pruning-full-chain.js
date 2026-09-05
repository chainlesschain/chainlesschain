import { openPruningRollbackStore } from "./wiki-pruning-skill-rollback.js";
import { openPruningKeyAuthority } from "./wiki-pruning-key-authority.js";
import { createGovernedWikiPruningRuntime } from "../../src/lib/evolution/governed-wiki-pruning-runtime.js";
import { WIKI_PRUNING_JOURNAL_EVENT_TYPE } from "../../src/lib/evolution/governed-wiki-pruning-ledger-adapter.js";

export async function openPruningFullChain(root, options = {}) {
  const keyAuthority = openPruningKeyAuthority(root, options);
  const h = await openPruningRollbackStore(root, {
    ...options,
    keyAuthority,
    realRetrieval: true,
  });
  const ledger = h.resources.backend.ledger;
  const runtime = createGovernedWikiPruningRuntime({
    descriptor: h.resources.descriptor,
    artifactPorts: h.resources.artifactPorts,
    ledgerArtifactResolver: h.resources.resolver,
    wikiLedgerAdapter: h.wiki,
    deletionLedgerAdapter: h.deletionSource.adapter,
    skillRollbackProvider: h.rollback,
    keyAuthority,
    clock: h.resources.clock,
    ledger: {
      read: (input) => ledger.read(input),
      verify: () => ledger.verify(),
      appendDomainEvent(input, context) {
        const journal = input.type === WIKI_PRUNING_JOURNAL_EVENT_TYPE;
        (journal
          ? options.beforeJournalAppend
          : options.beforeRetrievalAppend)?.(input, context);
        const result = ledger.appendDomainEvent(input, context);
        (journal ? options.afterJournalAppend : options.afterRetrievalAppend)?.(
          input,
          result,
        );
        return result;
      },
    },
  });
  return {
    ...h,
    ...runtime,
    keyAuthority,
    runtime,
    plan: h.plan,
    async execute() {
      const resumed = await runtime.resume();
      return resumed ?? runtime.execute({ plan: await h.plan() });
    },
  };
}
