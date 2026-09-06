import { types } from "node:util";
import { captureWikiRevisionReader } from "./wiki-maintainer-ledger-adapter.js";
import { captureSkillReleaseOperationReader } from "./evolution-ledger-ports.js";
import { governedKnowledgeSourceRef } from "./governed-knowledge-skill-rollback.js";
import { deriveWikiTargetTombstoneRevision } from "./wiki-target-tombstone-revision.js";
import {
  createGovernedKnowledgeDependencyAuthority,
  GOVERNED_KNOWLEDGE_DEPENDENCY_RESULT_SCHEMA,
  digestGovernedKnowledgeDependencyResult,
} from "./governed-knowledge-dependency-authority.js";
import {
  capturePruningData as captureData,
  pruningCanonical as canonical,
  pruningDigest as digest,
} from "./governed-wiki-pruning-journal.js";

const SCHEMA = "chainlesschain.knowledge-wiki-tombstone/v1";
const HEAD_KEYS = [
  "epoch",
  "ledgerId",
  "identityDigest",
  "sequence",
  "headDigest",
];
const RULES = Object.freeze({
  schema: SCHEMA,
  batchSize: 128,
  source: "exact-Knowledge-URI-and-content-digest",
  effect: "target-only-tombstone",
  unrelatedFacts: "preserve-verbatim",
  minCorroboratingSources: 2,
  decayHalfLifeDays: 30,
  staleConfidenceFloor: 0.2,
});
const RULES_DIGEST = digest(SCHEMA, RULES);
const MULTIHOP_SCHEMA = "chainlesschain.knowledge-wiki-tombstone/v2";
const MULTIHOP_RULES_DIGEST = digest(MULTIHOP_SCHEMA, {
  ...RULES,
  schema: MULTIHOP_SCHEMA,
  source: "authenticated-pinned-Wiki-exact-Knowledge-ancestry",
});
function fail(message) {
  throw new Error(`Knowledge Wiki tombstone: ${message}`);
}
const same = (left, right) => canonical(left) === canonical(right);
function matchHead(checkpoint, head) {
  return HEAD_KEYS.every((key) => checkpoint[key] === head[key]);
}
function bind(wikiAdapter, transactionLedger, tenantId) {
  const wiki = captureWikiRevisionReader(wikiAdapter);
  if (wiki.descriptor.tenantId !== tenantId)
    throw new TypeError("Knowledge Wiki tenant differs");
  const operations = captureSkillReleaseOperationReader(transactionLedger);
  if (!operations.matchesWikiAdapter(wikiAdapter))
    throw new TypeError(
      "Wiki disposition requires the same genuine ledger, not matching caller-supplied head metadata",
    );
  return Object.freeze({ wiki, operations });
}
function partsFor(source, request, provenance) {
  const sourceRef = governedKnowledgeSourceRef(request);
  const refs = new Set(
    Object.values(source.state.evidence)
      .filter(
        (entry) =>
          (entry.ref === sourceRef || entry.artifactRef === sourceRef) &&
          entry.sourceDigest === request.contentDigest,
      )
      .map((entry) => entry.ref),
  );
  const directIds = Object.values(source.state.patterns)
    .filter((pattern) => {
      const evidence = [
        ...pattern.positiveEvidence,
        ...pattern.negativeEvidence,
      ];
      if (evidence.some((ref) => !source.state.evidence[ref]))
        fail("pattern has unresolved source evidence");
      return evidence.some((ref) => refs.has(ref));
    })
    .map((pattern) => pattern.patternId)
    .sort();
  const targetIds = provenance.affectedPatternIds;
  const operations = targetIds.map((patternId) => ({
    type: "tombstone",
    patternId,
    reason: "governed-knowledge-revocation",
  }));
  if (!operations.length)
    fail("Wiki source does not identify the revoked Knowledge");
  // Existing direct-only preparations retain their exact v1 batch identity and
  // deterministic revision bytes. Newly discovered ancestry gets a distinct
  // v2 contract, pinned to the original revision rather than today's head.
  const sourceProofDigest = same(directIds, targetIds)
    ? null
    : digest(`${MULTIHOP_SCHEMA}/source`, {
        revisionId: provenance.revisionId,
        stateDigest: provenance.stateDigest,
        checkpoint: provenance.checkpoint,
        affectedPatternIds: targetIds,
      });
  const count = Math.ceil(operations.length / RULES.batchSize);
  if (count > 128)
    fail("Wiki disposition exceeds the authenticated history bound");
  return Array.from({ length: count }, (_, index) => {
    const batch = operations.slice(
      index * RULES.batchSize,
      (index + 1) * RULES.batchSize,
    );
    return {
      operations: batch,
      ...(sourceProofDigest ? { sourceProofDigest } : {}),
      requestDigest: digest(
        `${sourceProofDigest ? MULTIHOP_SCHEMA : SCHEMA}/batch`,
        {
          requestDigest: request.requestDigest,
          index,
          count,
          operations: batch,
          ...(sourceProofDigest ? { sourceProofDigest } : {}),
        },
      ),
    };
  });
}
function derive(reader, source, part, fence) {
  return deriveWikiTargetTombstoneRevision({
    source,
    operations: part.operations,
    requestDigest: part.requestDigest,
    effectiveAt: fence.evidence.timestamp,
    descriptor: {
      tenantId: reader.wiki.descriptor.tenantId,
      evolutionRunId: reader.wiki.descriptor.evolutionRunId,
      maintainerModel: part.sourceProofDigest
        ? "deterministic:knowledge-wiki-tombstone/v2"
        : "deterministic:knowledge-wiki-tombstone/v1",
      rulesDigest: part.sourceProofDigest
        ? MULTIHOP_RULES_DIGEST
        : RULES_DIGEST,
      minCorroboratingSources: RULES.minCorroboratingSources,
      decayHalfLifeDays: RULES.decayHalfLifeDays,
      staleConfidenceFloor: RULES.staleConfidenceFloor,
    },
  });
}
async function prove(reader, request, context, original) {
  if (
    request.dependency.kind !== "wiki" ||
    request.dependency.disposition !== "tombstone"
  )
    fail("only an exact wiki / tombstone dependency is supported");
  const admission = reader.operations.resolveKnowledgeRevocation({
    tenantId: request.tenantId,
    operationDigest: request.operationDigest,
    context,
  });
  const fence = admission.fence;
  if (!fence || fence.record.deviceId !== request.deviceId)
    fail("missing exact prepared revocation");
  const knowledge = fence.record.knowledge;
  for (const key of [
    "tenantId",
    "knowledgeId",
    "action",
    "contentDigest",
    "revocationReceiptDigest",
  ])
    if (knowledge[key] !== request[key])
      fail("prepared Knowledge binding differs");
  if (!knowledge.dependencies.some((entry) => same(entry, request.dependency)))
    fail("Wiki dependency is not in the prepared operation");
  // The dependency digest binds the original complete Wiki STATE, not just a
  // pattern ID, caller-selected evidence subset or latest mutable Wiki label.
  if (
    !matchHead(context.checkpoint, original.ledgerHead) ||
    original.checkpoint.sequence >= fence.sequence
  )
    fail("Wiki source must precede preparation on this same current ledger");
  const provenance = reader.wiki.readKnowledgeProvenance({
    tenantId: request.tenantId,
    revisionId: original.revisionId,
    knowledgeId: request.knowledgeId,
    contentDigest: request.contentDigest,
  });
  if (
    provenance.stateDigest !== original.stateDigest ||
    !same(provenance.checkpoint, original.checkpoint) ||
    !matchHead(context.checkpoint, provenance.ledgerHead)
  )
    fail("Wiki ancestry does not bind the original state and current ledger");
  const parts = partsFor(original, request, provenance);
  const history = reader.wiki.resolveHistory({
    tenantId: request.tenantId,
    stateDigest: request.dependency.digest,
    allowedMaintenanceRequestDigests: parts.map((part) => part.requestDigest),
  });
  if (
    !matchHead(context.checkpoint, history.ledgerHead) ||
    history.successors.length > parts.length
  )
    fail("Wiki disposition history differs from its current authorization");
  let source = history.source;
  for (const [index, entry] of history.successors.entries()) {
    if (entry.predecessorHead.sequence < fence.sequence)
      fail("Wiki effect predates its prepared Knowledge authorization");
    const expected = await derive(reader, source, parts[index], fence);
    if (!same(expected, entry.revision))
      fail("Wiki successor does not match the exact target-only tombstones");
    source = {
      trusted: true,
      state: expected.state,
      stateDigest: expected.stateDigest,
    };
  }
  if (
    !same(source, history.current) ||
    !same(reader.operations.currentContext(), context)
  )
    fail("Wiki or ledger changed during effect verification");
  return Object.freeze({
    fence,
    parts,
    history,
    current: source,
    complete: history.successors.length === parts.length,
    checkpoint: context.checkpoint,
  });
}

export function createGovernedKnowledgeWikiTombstoneAuthority({
  tenantId,
  deviceId,
  wikiLedgerAdapter,
  transactionLedger,
  verifierWikiLedgerAdapter,
  verifierTransactionLedger,
  providerDescriptor,
  verifierDescriptor,
  additionalWikiTargets = [],
} = {}) {
  if (
    wikiLedgerAdapter === verifierWikiLedgerAdapter ||
    transactionLedger === verifierTransactionLedger
  )
    throw new TypeError(
      "Wiki disposition requires independent genuine readers",
    );
  if (
    types.isProxy(additionalWikiTargets) ||
    !Array.isArray(additionalWikiTargets) ||
    Object.getPrototypeOf(additionalWikiTargets) !== Array.prototype ||
    additionalWikiTargets.length > 63 ||
    Reflect.ownKeys(additionalWikiTargets).length !==
      additionalWikiTargets.length + 1
  )
    throw new TypeError(
      "Wiki disposition targets must be a bounded dense array",
    );
  const targets = [{ wikiLedgerAdapter, verifierWikiLedgerAdapter }];
  for (let index = 0; index < additionalWikiTargets.length; index += 1) {
    const property = Object.getOwnPropertyDescriptor(
      additionalWikiTargets,
      String(index),
    );
    const target = property?.value;
    if (
      !target ||
      types.isProxy(target) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(target)) ||
      Reflect.ownKeys(target).length !== 2
    )
      throw new TypeError(
        "Wiki disposition target must contain two fixed readers",
      );
    const left = Object.getOwnPropertyDescriptor(target, "wikiLedgerAdapter");
    const right = Object.getOwnPropertyDescriptor(
      target,
      "verifierWikiLedgerAdapter",
    );
    if (!left || !right || !("value" in left) || !("value" in right))
      throw new TypeError("Wiki disposition target must not use accessors");
    targets.push({
      wikiLedgerAdapter: left.value,
      verifierWikiLedgerAdapter: right.value,
    });
  }
  const runs = new Set();
  const bindings = targets.map((target) => {
    if (target.wikiLedgerAdapter === target.verifierWikiLedgerAdapter)
      throw new TypeError(
        "Wiki disposition requires independent genuine readers",
      );
    const provider = bind(
      target.wikiLedgerAdapter,
      transactionLedger,
      tenantId,
    );
    const verifier = bind(
      target.verifierWikiLedgerAdapter,
      verifierTransactionLedger,
      tenantId,
    );
    if (!same(provider.wiki.descriptor, verifier.wiki.descriptor))
      throw new TypeError("Wiki disposition reader scopes differ");
    const run = provider.wiki.descriptor.evolutionRunId;
    if (runs.has(run))
      throw new TypeError(
        "Wiki disposition runs must be unique, not duplicate",
      );
    runs.add(run);
    return Object.freeze({
      provider,
      verifier,
      commit: target.wikiLedgerAdapter.commitRevision,
    });
  });
  const { provider, verifier } = bindings[0];
  const left = provider.operations.currentContext().checkpoint;
  const right = verifier.operations.currentContext().checkpoint;
  if (
    ["epoch", "ledgerId", "identityDigest"].some(
      (key) => left[key] !== right[key],
    )
  )
    throw new TypeError("Wiki disposition readers belong to different ledgers");
  const providerIdentity = captureData(providerDescriptor);
  const verifierIdentity = captureData(verifierDescriptor);
  async function proofPair(request) {
    const context = provider.operations.currentContext();
    if (!same(context, verifier.operations.currentContext()))
      fail("independent ledger heads differ");
    let selected = null;
    for (const binding of bindings) {
      const query = {
        tenantId: request.tenantId,
        stateDigest: request.dependency.digest,
      };
      const original = binding.provider.wiki.findStateRevision(query);
      const independentOriginal =
        binding.verifier.wiki.findStateRevision(query);
      if (!same(original, independentOriginal))
        fail("independent Wiki target lookup differs");
      if (original) {
        if (selected)
          fail("Wiki target resolves to more than one configured run");
        selected = { binding, original, independentOriginal };
      }
    }
    if (!selected)
      fail("Wiki target is absent from the configured authenticated runs");
    const primary = await prove(
      selected.binding.provider,
      request,
      context,
      selected.original,
    );
    const independent = await prove(
      selected.binding.verifier,
      request,
      context,
      selected.independentOriginal,
    );
    if (!same(primary, independent))
      fail("independent Wiki effect proof differs");
    return { proof: primary, binding: selected.binding };
  }
  function resultFor(request, proof) {
    const core = {
      schema: GOVERNED_KNOWLEDGE_DEPENDENCY_RESULT_SCHEMA,
      tenantId,
      deviceId,
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      knowledgeId: request.knowledgeId,
      revocationReceiptDigest: request.revocationReceiptDigest,
      dependencyKind: request.dependency.kind,
      dependencyDigest: request.dependency.digest,
      dependencyDisposition: request.dependency.disposition,
      authorityId: providerIdentity.authorityId,
      authorityRevision: providerIdentity.revision,
      handlerArtifactDigest: providerIdentity.handlerArtifactDigest,
      applied: true,
      durable: true,
      idempotent: true,
      appliedAt: proof.fence.evidence.timestamp,
    };
    const { algorithm, keyId, value } = proof.fence.evidence.signature;
    return captureData({
      ...core,
      resultDigest: digestGovernedKnowledgeDependencyResult(core),
      attestation: { algorithm, keyId, value },
    });
  }
  return createGovernedKnowledgeDependencyAuthority({
    tenantId,
    deviceId,
    providerDescriptor: providerIdentity,
    verifierDescriptor: verifierIdentity,
    provider: Object.freeze({
      async apply(request) {
        let { proof, binding } = await proofPair(request);
        while (!proof.complete) {
          const done = proof.history.successors.length;
          const revision = await derive(
            binding.provider,
            proof.current,
            proof.parts[done],
            proof.fence,
          );
          let commitError = null;
          try {
            binding.commit({
              expectedStateDigest: proof.current.stateDigest,
              expectedLedgerHead: proof.checkpoint,
              revision,
            });
          } catch (error) {
            commitError = error;
          }
          // Lost acknowledgements are resolved from independently replayed
          // actual history, never from a provider's success flag.
          const next = (await proofPair(request)).proof;
          if (next.history.successors.length !== done + 1) {
            if (commitError) throw commitError;
            fail("Wiki commit did not durably advance the authorized sequence");
          }
          proof = next;
        }
        return resultFor(request, proof);
      },
    }),
    verifier: Object.freeze({
      async verify({ request, result }) {
        const { proof } = await proofPair(request);
        if (!proof.complete || !same(result, resultFor(request, proof)))
          fail(
            "Wiki disposition is not completely and independently confirmed",
          );
        return captureData({
          authenticated: true,
          durable: true,
          tenantId,
          deviceId,
          operationId: request.operationId,
          requestDigest: request.requestDigest,
          resultDigest: result.resultDigest,
          providerAuthorityId: providerIdentity.authorityId,
          providerRevision: providerIdentity.revision,
          verifierAuthorityId: verifierIdentity.authorityId,
          verifierRevision: verifierIdentity.revision,
          verificationReceiptDigest: digest(`${SCHEMA}/verification`, {
            requestDigest: request.requestDigest,
            resultDigest: result.resultDigest,
            proof,
            verifierIdentity,
          }),
        });
      },
    }),
  });
}
