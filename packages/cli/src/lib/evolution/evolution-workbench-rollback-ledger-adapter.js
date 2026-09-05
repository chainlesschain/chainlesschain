import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  EvolutionLedger,
  EVOLUTION_LEDGER_MAX_EVENTS,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
} from "./evolution-ledger.js";
import {
  EvolutionArtifactPorts,
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import { captureSkillReleaseRegistryReader } from "./skill-release-registry.js";
import { captureSkillReleaseOperationReader } from "./evolution-ledger-ports.js";
import { captureSkillRollbackProvider } from "./skill-promotion-controller.js";
import {
  verifySkillMutationRequest,
  digestSkillMutationTransitionSubject,
} from "./skill-mutation-authority.js";
import { verifySkillPromotionReviewDecision } from "./skill-promotion-review.js";
import { captureWorkbenchProjectionReader } from "./evolution-workbench-review-ledger-adapter.js";
import {
  EvolutionWorkbenchRollbackExecutor,
  verifyEvolutionWorkbenchRollbackPlan,
  buildEvolutionWorkbenchRollbackPlan,
  buildEvolutionWorkbenchRollbackRequest,
  buildEvolutionWorkbenchRollbackReceipt,
} from "./evolution-workbench-version-control.js";
import {
  verifyWorkbenchRollbackAuthorization,
  WORKBENCH_ROLLBACK_POLICY_SCHEMA,
} from "./evolution-workbench-rollback-authorization.js";
import {
  capturePruningData as capture,
  pruningCanonical as canonical,
} from "./governed-wiki-pruning-journal.js";

export const WORKBENCH_ROLLBACK_PREPARATION_SCHEMA =
  "chainlesschain.evolution-workbench-rollback-preparation/v1";
export const WORKBENCH_ROLLBACK_SETTLEMENT_SCHEMA =
  "chainlesschain.evolution-workbench-rollback-settlement/v1";
const TYPES = {
  prepared: [
    "evolution-workbench-rollback-preparation",
    "evolution.workbench.rollback.prepared",
    WORKBENCH_ROLLBACK_PREPARATION_SCHEMA,
  ],
  committed: [
    "evolution-workbench-rollback-settlement",
    "evolution.workbench.rollback.committed",
    WORKBENCH_ROLLBACK_SETTLEMENT_SCHEMA,
  ],
};
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
// Only this adapter can mint a mutation context, after it authenticated the
// durable human preparation and exact current active/LKG state. The token is
// invisible in the existing wire shape and cannot be reconstructed from JSON.
const MUTATION_CONTEXTS = new WeakMap();
export function consumeWorkbenchRollbackMutationContext(
  value,
  registry,
  ledger,
  descriptor,
) {
  const context = MUTATION_CONTEXTS.get(value);
  if (
    !context ||
    context.registry !== registry ||
    context.ledger !== ledger ||
    canonical(context.descriptor) !== canonical(descriptor)
  )
    throw new TypeError(
      "a live same-store, same-scope Workbench rollback mutation context is required",
    );
  MUTATION_CONTEXTS.delete(value);
  return value;
}
const same = (a, b) => canonical(a) === canonical(b);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortedRefs = (refs) =>
  [...refs].sort(
    (a, b) => compare(a.ref, b.ref) || compare(a.digest, b.digest),
  );
function fail(message) {
  const error = new Error(message);
  error.code = "CC_EVOLUTION_WORKBENCH_ROLLBACK_INVALID";
  throw error;
}
function fixed(owner, name) {
  if (!owner || types.isProxy(owner))
    throw new TypeError(`${name} fixed port is required`);
  const method = Object.getOwnPropertyDescriptor(owner, name)?.value;
  if (typeof method !== "function" || types.isProxy(method))
    throw new TypeError(`${name} fixed own method is required`);
  return method.bind(owner);
}
function bindRegistry(registry, transactionLedger, tenantId) {
  const reader = captureSkillReleaseRegistryReader(registry);
  if (
    reader.tenantId !== tenantId ||
    !reader.matchesTransactionLedger(transactionLedger)
  )
    throw new TypeError(
      "Workbench rollback Registry/transaction Ledger binding differs",
    );
  return {
    registry: reader,
    operations: captureSkillReleaseOperationReader(transactionLedger),
  };
}

// The Workbench journal never substitutes for Registry effect evidence. Both
// readers must re-open real release bytes and authenticate the same Ledger.
export class EvolutionWorkbenchRollbackLedgerAdapter {
  #registryIdentity;
  #ledgerIdentity;
  #ledger;
  #put;
  #resolve;
  #projection;
  #writer;
  #reader;
  #rollback;
  #authorize;
  #human;
  #verifyHuman;
  #now;
  constructor({
    descriptor,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    projectionReader,
    releaseRegistry,
    transactionLedger,
    rollbackProvider,
    authorizationProvider,
    verifierReleaseRegistry,
    verifierTransactionLedger,
    humanRollbackProvider,
    humanRollbackVerifier,
    now = Date.now,
  } = {}) {
    this.descriptor = capture(descriptor);
    this.#projection = captureWorkbenchProjectionReader(projectionReader);
    if (
      !same(this.descriptor, this.#projection.descriptor) ||
      !this.#projection.matchesLedger(ledger)
    )
      throw new TypeError(
        "Workbench rollback requires the exact retained projection Ledger and scope",
      );
    if (
      !(ledger instanceof EvolutionLedger) ||
      types.isProxy(ledger) ||
      !(artifactPorts instanceof EvolutionArtifactPorts) ||
      types.isProxy(artifactPorts) ||
      !isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)
    )
      throw new TypeError(
        "Workbench rollback requires actual Ledger/ArtifactPorts",
      );
    if (
      releaseRegistry === verifierReleaseRegistry ||
      transactionLedger === verifierTransactionLedger
    )
      throw new TypeError(
        "Workbench rollback requires independent Registry/transaction readers",
      );
    this.#writer = bindRegistry(
      releaseRegistry,
      transactionLedger,
      descriptor.tenantId,
    );
    this.#reader = bindRegistry(
      verifierReleaseRegistry,
      verifierTransactionLedger,
      descriptor.tenantId,
    );
    if (
      !this.#writer.operations.matchesLedger(ledger) ||
      this.#reader.operations.matchesLedger(ledger)
    )
      throw new TypeError(
        "Workbench release writer must share the projection Ledger, with an independent verifier",
      );
    this.#rollback = captureSkillRollbackProvider(
      rollbackProvider,
      releaseRegistry,
    ).rollback;
    this.#authorize = fixed(authorizationProvider, "authorizeRollback");
    this.#human = fixed(humanRollbackProvider, "authorize");
    this.#verifyHuman = fixed(humanRollbackVerifier, "verify");
    if (typeof now !== "function" || types.isProxy(now))
      throw new TypeError("Workbench rollback clock is required");
    this.#now = now;
    this.#registryIdentity = releaseRegistry;
    this.#ledgerIdentity = ledger;
    this.#ledger = Object.freeze({
      read: () =>
        EvolutionLedger.prototype.read.call(ledger, {
          limit: EVOLUTION_LEDGER_MAX_EVENTS,
        }),
      verify: EvolutionLedger.prototype.verify.bind(ledger),
      append: EvolutionLedger.prototype.appendDomainEvent.bind(ledger),
    });
    this.#put =
      EvolutionArtifactPorts.prototype.putCanonical.bind(artifactPorts);
    this.#resolve = ledgerArtifactResolver;
    this.#sameLedger();
    Object.freeze(this);
  }
  #sameLedger() {
    const left = this.#writer.operations.currentContext().checkpoint;
    const right = this.#reader.operations.currentContext().checkpoint;
    if (
      ["epoch", "ledgerId", "identityDigest", "sequence", "headDigest"].some(
        (key) => left[key] !== right[key],
      )
    )
      fail(
        "Workbench independent release readers disagree on the current Ledger",
      );
    return left;
  }
  #stable(head) {
    if (this.#ledger.verify().headDigest !== head.headDigest)
      fail("Workbench rollback Ledger changed during authentication");
  }
  #scope(value) {
    if (
      ["tenantId", "runId", "skillName"].some(
        (key) => value?.[key] !== this.descriptor[key],
      )
    )
      fail("Workbench rollback record scope differs");
    return value;
  }
  #snapshot() {
    const head = this.#ledger.verify();
    const events = this.#ledger.read();
    if (events.length !== head.sequence)
      fail("Workbench rollback Ledger history is incomplete");
    const selected = events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        Object.values(TYPES).some(([, type]) => type === event.type) &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId,
    );
    if (selected.length > 10_000)
      fail("Workbench rollback history exceeds its budget");
    const rows = selected.map((event) => {
      const [kind, [type, , schema]] = Object.entries(TYPES).find(
        ([, spec]) => spec[1] === event.type,
      );
      const resolved = this.#resolve({
        epoch: head.epoch,
        ledgerId: head.ledgerId,
        tenantId: this.descriptor.artifactTenantId,
        ref: event.subjectRef,
      });
      if (
        resolved?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
        resolved.authenticated !== true ||
        resolved.found !== true ||
        resolved.ref !== event.subjectRef.ref ||
        resolved.digest !== event.subjectRef.digest ||
        !Buffer.isBuffer(resolved.bytes) ||
        resolved.bytes.length > 1024 * 1024 ||
        `sha256:${createHash("sha256").update(resolved.bytes).digest("hex")}` !==
          event.subjectRef.digest
      )
        fail("Workbench rollback artifact resolution is invalid");
      const record = capture(JSON.parse(resolved.bytes.toString("utf8")));
      if (
        canonical(record) !== resolved.bytes.toString("utf8") ||
        record.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
        record.tenantId !== this.descriptor.artifactTenantId ||
        record.audience !== this.descriptor.audience ||
        record.purpose !== "evolution-ledger" ||
        record.retention !== "ledger" ||
        record.type !== type
      )
        fail("Workbench rollback artifact durable binding is invalid");
      const value = this.#scope(record.value);
      if (
        value.schema !== schema ||
        !DIGEST.test(value.planDigest ?? "") ||
        event.eventId !== `${event.type}.${value.planDigest.slice(7)}` ||
        event.artifactTenantId !== this.descriptor.artifactTenantId ||
        event.skillName !== this.descriptor.skillName ||
        event.decision !== "committed" ||
        event.reason !== type ||
        event.sourceRefs.length !== (kind === "prepared" ? 4 : 2)
      )
        fail("Workbench rollback event binding is invalid");
      return { kind, event, value };
    });
    this.#stable(head);
    return { head, events, rows };
  }
  #find(kind, planDigest, snapshot) {
    const rows = snapshot.rows.filter(
      (row) => row.kind === kind && row.value.planDigest === planDigest,
    );
    if (rows.length > 1) fail("Workbench rollback has duplicate records");
    return rows[0] ?? null;
  }
  #append(kind, value, refs, head) {
    this.#stable(head);
    const [type, eventType] = TYPES[kind];
    const sourceRefs = sortedRefs(refs);
    const published = this.#put(type, capture(value), {
      audience: this.descriptor.audience,
      purpose: "evolution-ledger",
      retention: "ledger",
    });
    if (
      published?.receipt?.persisted !== true ||
      published.receipt.readbackVerified !== true ||
      published.receipt.integrityVerified !== true ||
      published.receipt.retention !== "ledger"
    )
      fail("Workbench rollback artifact is not durable");
    const readback = () => {
      const result = this.#find(kind, value.planDigest, this.#snapshot());
      if (
        !result ||
        !same(result.value, value) ||
        !same(result.event.sourceRefs, sourceRefs)
      )
        fail("Workbench rollback append has no exact durable readback");
      return result;
    };
    try {
      const result = this.#ledger.append(
        {
          type: eventType,
          eventId: `${eventType}.${value.planDigest.slice(7)}`,
          tenantId: this.descriptor.tenantId,
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          skillName: this.descriptor.skillName,
          decision: "committed",
          reason: type,
          timestamp: new Date(Number(this.#now())).toISOString(),
          subjectRef: published.ref,
          sourceRefs,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
      if (result?.authenticated !== true || result.durable !== true)
        fail("Workbench rollback append is not durable");
    } catch (cause) {
      try {
        return readback();
      } catch {
        throw cause;
      }
    }
    return readback();
  }
  async #context(input) {
    const plan = verifyEvolutionWorkbenchRollbackPlan(
      input,
      this.descriptor.tenantId,
    );
    const snapshot = this.#snapshot();
    const retained = this.#projection.read({
      tenantId: plan.tenantId,
      projectionDigest: plan.sourceProjectionDigest,
    });
    if (
      plan.skillName !== this.descriptor.skillName ||
      buildEvolutionWorkbenchRollbackPlan(retained.projection, plan)
        .planDigest !== plan.planDigest
    )
      fail("Workbench rollback plan differs from its retained source");
    const fromReview = await this.#projection.readReview(plan.fromPacketDigest);
    const toReview = await this.#projection.readReview(plan.toPacketDigest);
    for (const [prefix, review] of [
      ["from", fromReview],
      ["to", toReview],
    ]) {
      if (
        review.packet.candidateId !== plan[`${prefix}CandidateId`] ||
        review.packet.candidateContentDigest !==
          plan[`${prefix}ContentDigest`] ||
        review.packet.skillName !== plan.skillName ||
        review.packetSequence >= retained.sequence
      )
        fail(
          "Workbench rollback Review packet differs from the planned candidate",
        );
    }
    const target = retained.projection.candidates.find(
      (item) => item.packetDigest === plan.toPacketDigest,
    );
    if (
      !toReview.decision ||
      toReview.decision.decision !== "approved" ||
      target.decision.receiptDigest !== toReview.decision.receiptDigest ||
      toReview.decisionSequence >= retained.sequence
    )
      fail("Workbench rollback target lacks exact durable human approval");
    this.#stable(snapshot.head);
    return { plan, retained, fromReview, toReview, snapshot };
  }
  #releases(plan, basis) {
    const output = [];
    for (const reader of [this.#writer, this.#reader]) {
      const from = reader.registry.readRelease(basis.fromReleaseDigest);
      const target = reader.registry.readRelease(basis.targetReleaseDigest);
      if (
        !from ||
        !target ||
        from.releaseDigest === target.releaseDigest ||
        from.tenantId !== plan.tenantId ||
        target.tenantId !== plan.tenantId ||
        from.skillName !== plan.skillName ||
        target.skillName !== plan.skillName ||
        from.contentDigest !== plan.fromContentDigest ||
        target.contentDigest !== plan.toContentDigest ||
        from.candidate.candidateId !== plan.fromCandidateId ||
        target.candidate.candidateId !== plan.toCandidateId
      )
        fail("Workbench rollback releases differ from the planned candidates");
      output.push({ from, target });
    }
    if (!same(output[0], output[1]))
      fail("Workbench independent release content/lock differs");
    return output[0];
  }
  #basis(plan, active, request) {
    const targetReleaseDigest = active.state.lastKnownGoodReleaseDigest;
    const partial = {
      fromReleaseDigest: active.release.releaseDigest,
      targetReleaseDigest,
    };
    const { target } = this.#releases(plan, partial);
    if (active.state.stateDigest !== plan.expectedActiveStateDigest)
      fail("Workbench rollback active state changed from the approved plan");
    return capture({
      ...partial,
      tenantId: plan.tenantId,
      skillName: plan.skillName,
      operationId: `workbench-rollback:${request.requestDigest.slice(7)}`,
      operation: "rollback",
      targetScope: "active",
      expectedTargetDigest: plan.fromContentDigest,
      expectedTargetRevision: active.state.revision,
      expectedActiveStateDigest: active.state.stateDigest,
      dependencyLockDigest: target.dependencyLockDigest,
      transitionSubjectDigest: digestSkillMutationTransitionSubject({
        tenantId: plan.tenantId,
        skillName: plan.skillName,
        operation: "rollback",
        candidateId: null,
        rollbackTargetReleaseDigest: targetReleaseDigest,
        dependencyLockDigest: target.dependencyLockDigest,
        expectedActiveContentDigest: plan.fromContentDigest,
        expectedActiveRevision: active.state.revision,
      }),
    });
  }
  #active(skillName) {
    this.#sameLedger();
    const left = this.#writer.registry.readActive(skillName);
    const right = this.#reader.registry.readActive(skillName);
    if (!left || !same(left, right))
      fail("Workbench independent active state differs");
    return left;
  }
  #policy(prepared) {
    return canonical({
      schema: WORKBENCH_ROLLBACK_POLICY_SCHEMA,
      tenantId: this.descriptor.tenantId,
      planDigest: prepared.value.planDigest,
      authorizationReceiptDigest: prepared.value.authorization.receiptDigest,
      preparationRef: prepared.event.subjectRef,
    });
  }
  #proof(context, prepared, requireCurrent = false) {
    const { plan, snapshot } = context;
    const { basis, request } = prepared.value;
    this.#sameLedger();
    const results = [this.#writer, this.#reader].map(
      (reader) =>
        reader.operations.resolveOperation({
          tenantId: plan.tenantId,
          skillName: plan.skillName,
          operationId: basis.operationId,
          context: reader.operations.currentContext(),
        }).result,
    );
    if (!same(results[0], results[1]))
      fail("Workbench independent rollback effect differs");
    const result = results[0];
    if (!result) {
      this.#stable(snapshot.head);
      return null;
    }
    if (result.projection.status !== "committed")
      fail(
        "Workbench release transaction is pending; reopen Registry for recovery",
      );
    const { intent, previous, projection, finalizationEvidence } = result;
    const { target } = this.#releases(plan, basis);
    const expectedBasis = this.#basis(
      plan,
      {
        state: previous,
        release: this.#writer.registry.readRelease(
          previous.activeReleaseDigest,
        ),
      },
      request,
    );
    if (
      !same(expectedBasis, basis) ||
      intent.operation !== "rollback" ||
      intent.operationId !== basis.operationId ||
      intent.targetReleaseDigest !== basis.targetReleaseDigest ||
      intent.expectedParentDigest !== plan.fromContentDigest ||
      intent.dependencyLockDigest !== target.dependencyLockDigest ||
      result.preparationCheckpoint.sequence <= prepared.event.sequence ||
      intent.mutationRequest.receipts.policyReceipt !==
        this.#policy(prepared) ||
      intent.mutationRequest.transitionSubjectDigest !==
        basis.transitionSubjectDigest ||
      !finalizationEvidence ||
      finalizationEvidence.eventDigest !== projection.headDigest
    )
      fail(
        "Workbench release transaction is not the exact authorized rollback",
      );
    const finalizations = snapshot.events.filter(
      (event) =>
        event.eventDigest === finalizationEvidence.eventDigest &&
        event.type === "skill.release.finalize",
    );
    if (finalizations.length !== 1)
      fail("Workbench rollback finalization is absent from this Ledger");
    if (requireCurrent) {
      const active = this.#active(plan.skillName);
      if (
        projection.current !== true ||
        active.state.transactionId !== intent.transactionId ||
        active.state.stateDigest !== projection.stateDigest ||
        active.release.releaseDigest !== basis.targetReleaseDigest
      )
        fail(
          "Workbench rollback effect is no longer the current active release",
        );
    }
    this.#stable(snapshot.head);
    return { result, finalizationRef: finalizations[0].subjectRef };
  }
  #activeAtPreparation(plan, prepared) {
    const event = prepared.event;
    const values = [this.#writer, this.#reader].map((reader) => {
      const history = reader.operations.readReleaseHistory({
        tenantId: plan.tenantId,
        skillName: plan.skillName,
        context: {
          mode: "checkpoint",
          checkpoint: {
            epoch: event.epoch,
            ledgerId: event.ledgerId,
            identityDigest: event.identityDigest,
            sequence: event.sequence,
            headDigest: event.eventDigest,
          },
        },
      });
      const last = history.operations
        .filter((operation) => operation.projection.status === "committed")
        .at(-1);
      const state = last
        ? {
            revision: last.projection.revision,
            stateDigest: last.projection.stateDigest,
            activeReleaseDigest: last.intent.targetReleaseDigest,
            lastKnownGoodReleaseDigest:
              last.intent.operation === "rollback"
                ? last.intent.targetReleaseDigest
                : (last.previous.activeReleaseDigest ??
                  last.intent.targetReleaseDigest),
          }
        : history.migration?.value.state;
      if (!state) fail("Workbench preparation has no historical active state");
      return {
        state,
        release: reader.registry.readRelease(state.activeReleaseDigest),
      };
    });
    if (!same(values[0], values[1]))
      fail("Workbench historical preparation states differ");
    return values[0];
  }
  async #load(context, historicalPreparation = false) {
    const { plan, retained, fromReview, toReview, snapshot } = context;
    const prepared = this.#find("prepared", plan.planDigest, snapshot);
    const committed = this.#find("committed", plan.planDigest, snapshot);
    if (!prepared) {
      if (committed) fail("Workbench rollback settlement lacks preparation");
      return null;
    }
    const { authorization, basis } = prepared.value;
    const request = buildEvolutionWorkbenchRollbackRequest(
      plan,
      authorization.receiptDigest,
    );
    const expected = this.#preparationValue(
      plan,
      request,
      authorization,
      basis,
    );
    if (
      !same(prepared.value, expected) ||
      prepared.event.sequence <= retained.sequence ||
      !same(
        prepared.event.sourceRefs,
        sortedRefs([
          retained.artifactRef,
          fromReview.packetRef,
          toReview.packetRef,
          toReview.decisionRef,
        ]),
      )
    )
      fail("Workbench rollback preparation lineage differs");
    const proof = this.#proof(context, prepared);
    const authorizationTime = proof
      ? Date.parse(proof.result.intent.authorityReceipt.occurredAt)
      : historicalPreparation
        ? Date.parse(prepared.event.timestamp)
        : Number(this.#now());
    verifyWorkbenchRollbackAuthorization(
      authorization,
      plan,
      authorizationTime,
    );
    verifySkillPromotionReviewDecision(
      toReview.decision,
      toReview.packet,
      authorizationTime,
    );
    if ((await this.#verifyHuman({ plan, authorization })) !== true)
      fail("Workbench rollback human signature verification failed");
    if (!proof) {
      verifyWorkbenchRollbackAuthorization(
        authorization,
        plan,
        historicalPreparation ? authorizationTime : Number(this.#now()),
      );
      verifySkillPromotionReviewDecision(
        toReview.decision,
        toReview.packet,
        historicalPreparation ? authorizationTime : Number(this.#now()),
      );
      if (
        !same(
          this.#basis(
            plan,
            historicalPreparation
              ? this.#activeAtPreparation(plan, prepared)
              : this.#active(plan.skillName),
            request,
          ),
          basis,
        )
      )
        fail("Workbench rollback preparation target changed");
    }
    if (committed) {
      if (
        !proof ||
        !same(committed.value, this.#settlementValue(plan, request, proof)) ||
        !same(
          committed.event.sourceRefs,
          sortedRefs([prepared.event.subjectRef, proof.finalizationRef]),
        ) ||
        committed.event.sequence <= proof.result.projection.sequence
      )
        fail("Workbench rollback settlement has no exact Registry effect");
    }
    this.#stable(snapshot.head);
    return { prepared, committed, proof, request, authorization, basis };
  }
  #preparationValue(plan, request, authorization, basis) {
    return capture({
      schema: WORKBENCH_ROLLBACK_PREPARATION_SCHEMA,
      tenantId: this.descriptor.tenantId,
      runId: this.descriptor.runId,
      skillName: this.descriptor.skillName,
      planDigest: plan.planDigest,
      plan,
      request,
      authorization,
      basis,
    });
  }
  #settlementValue(plan, request, proof) {
    const { intent, projection } = proof.result;
    const receipt = buildEvolutionWorkbenchRollbackReceipt(
      plan,
      request,
      projection.receiptDigest,
      {
        stateDigest: projection.stateDigest,
        contentDigest: plan.toContentDigest,
      },
    );
    return capture({
      schema: WORKBENCH_ROLLBACK_SETTLEMENT_SCHEMA,
      tenantId: this.descriptor.tenantId,
      runId: this.descriptor.runId,
      skillName: this.descriptor.skillName,
      planDigest: plan.planDigest,
      transactionId: intent.transactionId,
      intentDigest: intent.intentDigest,
      receipt,
    });
  }
  async authorizeHumanRollback({ plan: input }) {
    const context = await this.#context(input);
    const existing = await this.#load(context);
    let authorization = existing?.authorization;
    if (!existing) {
      const { plan, retained, fromReview, toReview, snapshot } = context;
      // Preflight exact active/LKG identities before presenting a human prompt.
      const active = this.#active(plan.skillName);
      this.#basis(plan, active, { requestDigest: plan.planDigest });
      verifySkillPromotionReviewDecision(
        toReview.decision,
        toReview.packet,
        Number(this.#now()),
      );
      authorization = verifyWorkbenchRollbackAuthorization(
        await this.#human({ plan }),
        plan,
        Number(this.#now()),
      );
      if ((await this.#verifyHuman({ plan, authorization })) !== true)
        fail("Workbench rollback human signature verification failed");
      verifyWorkbenchRollbackAuthorization(
        authorization,
        plan,
        Number(this.#now()),
      );
      const request = buildEvolutionWorkbenchRollbackRequest(
        plan,
        authorization.receiptDigest,
      );
      const basis = this.#basis(plan, this.#active(plan.skillName), request);
      this.#stable(snapshot.head);
      this.#append(
        "prepared",
        this.#preparationValue(plan, request, authorization, basis),
        [
          retained.artifactRef,
          fromReview.packetRef,
          toReview.packetRef,
          toReview.decisionRef,
        ],
        snapshot.head,
      );
    }
    return capture({
      authenticated: true,
      durable: true,
      automated: false,
      planDigest: input.planDigest,
      receiptDigest: authorization.receiptDigest,
    });
  }
  async #requestContext(input) {
    const request = capture(input);
    const snapshot = this.#snapshot();
    const prepared = this.#find("prepared", request.planDigest, snapshot);
    if (!prepared || !same(prepared.value.request, request))
      fail("Workbench rollback request has no exact durable preparation");
    const context = await this.#context(prepared.value.plan);
    return { context, state: await this.#load(context) };
  }
  async applyRollback(input) {
    let { context, state } = await this.#requestContext(input);
    if (!state.proof) {
      const policyReceipt = this.#policy(state.prepared);
      const deadline = Math.min(
        Date.parse(state.authorization.expiresAt),
        Date.parse(context.toReview.decision.expiresAt),
      );
      const expected = capture({
        ...state.basis,
        policyReceipt,
        planDigest: context.plan.planDigest,
        authorizationReceiptDigest: state.authorization.receiptDigest,
        expiresAt: new Date(deadline).toISOString(),
      });
      MUTATION_CONTEXTS.set(expected, {
        registry: this.#registryIdentity,
        ledger: this.#ledgerIdentity,
        descriptor: this.descriptor,
      });
      let raw;
      try {
        raw = await this.#authorize(expected);
      } finally {
        // Legacy authority ports need not consume the token, but may not keep
        // it alive after this exact request has returned or failed.
        MUTATION_CONTEXTS.delete(expected);
      }
      if (!raw || types.isProxy(raw))
        fail("Workbench mutation authorization must be own data");
      const fields = Object.getOwnPropertyDescriptors(raw);
      if (
        Reflect.ownKeys(fields).length !== 2 ||
        !fields.request ||
        !fields.capability ||
        [fields.request, fields.capability].some(
          (field) => !("value" in field) || !field.enumerable,
        )
      )
        fail(
          "Workbench mutation authorization requires exact request/capability fields",
        );
      const request = verifySkillMutationRequest(fields.request.value);
      if (Date.parse(request.expiresAt) > deadline)
        fail("Workbench mutation authorization outlives human approval");
      for (const key of [
        "tenantId",
        "skillName",
        "operationId",
        "operation",
        "targetScope",
        "expectedTargetDigest",
        "expectedTargetRevision",
        "transitionSubjectDigest",
      ])
        if (request[key] !== state.basis[key])
          fail("Workbench mutation authority authorized another transition");
      if (request.receipts.policyReceipt !== policyReceipt)
        fail(
          "Workbench mutation policy is not bound to the persisted human authorization",
        );
      // Capability issuance may append audit records. Refresh all inputs after
      // it, including current revocation/freshness, before consuming authority.
      ({ context, state } = await this.#requestContext(input));
      if (state.proof)
        fail("Workbench rollback changed while mutation authority was pending");
      verifyWorkbenchRollbackAuthorization(
        state.authorization,
        context.plan,
        Number(this.#now()),
      );
      verifySkillPromotionReviewDecision(
        context.toReview.decision,
        context.toReview.packet,
        Number(this.#now()),
      );
      await this.#rollback({
        authorization: { request, capability: fields.capability.value },
        targetReleaseDigest: state.basis.targetReleaseDigest,
      });
      ({ context, state } = await this.#requestContext(input));
    }
    const proof = this.#proof(context, state.prepared, true);
    if (!proof)
      fail(
        "Workbench rollback has no independently authenticated Registry effect",
      );
    return capture({
      authenticated: true,
      durable: true,
      requestDigest: state.request.requestDigest,
      receiptDigest: proof.result.projection.receiptDigest,
    });
  }
  async readActiveState({ tenantId, skillName }) {
    if (
      tenantId !== this.descriptor.tenantId ||
      skillName !== this.descriptor.skillName
    )
      fail("Workbench active-state scope differs");
    const active = this.#active(skillName);
    return capture({
      authenticated: true,
      durable: true,
      tenantId,
      skillName,
      contentDigest: active.release.contentDigest,
      stateDigest: active.state.stateDigest,
    });
  }
  async commitRollback({ receipt: input }) {
    const receipt = capture(input);
    const prepared = this.#find(
      "prepared",
      receipt.planDigest,
      this.#snapshot(),
    );
    if (!prepared) fail("Workbench rollback receipt has no preparation");
    const context = await this.#context(prepared.value.plan);
    const state = await this.#load(context);
    await this.#settle(context, state, receipt, true);
    return {
      authenticated: true,
      durable: true,
      receiptDigest: receipt.receiptDigest,
    };
  }
  async #settle(context, state, expectedReceipt, requireCurrent) {
    const proof = this.#proof(context, state.prepared, requireCurrent);
    if (!proof) fail("Workbench rollback receipt has no Registry effect");
    const value = this.#settlementValue(context.plan, state.request, proof);
    if (expectedReceipt !== null && !same(expectedReceipt, value.receipt))
      fail("Workbench rollback receipt differs from actual Registry effect");
    if (!state.committed)
      this.#append(
        "committed",
        value,
        [state.prepared.event.subjectRef, proof.finalizationRef],
        context.snapshot.head,
      );
    const readback = await this.#load(await this.#context(context.plan));
    if (!readback.committed)
      fail("Workbench rollback settlement was not durably read back");
    return value.receipt;
  }
  createExecutor() {
    return new EvolutionWorkbenchRollbackExecutor({
      tenantId: this.descriptor.tenantId,
      ports: {
        loadProjection: async (input) =>
          this.#projection.read(input).projection,
        authorizeHumanRollback: this.authorizeHumanRollback.bind(this),
        applyRollback: this.applyRollback.bind(this),
        readActiveState: this.readActiveState.bind(this),
        commitRollback: this.commitRollback.bind(this),
      },
    });
  }
  // Unlike resume(), startup reconciliation cannot request authority or switch
  // Registry state. Expired/stale pending plans remain pending for explicit action.
  async reconcileCommitted() {
    const snapshot = this.#snapshot();
    for (const row of snapshot.rows)
      if (
        row.kind === "committed" &&
        !this.#find("prepared", row.value.planDigest, snapshot)
      )
        fail("Workbench rollback settlement lacks preparation");
    const plans = snapshot.rows
      .filter((row) => row.kind === "prepared")
      .map((row) => row.value.plan);
    const settledReceipts = [];
    const deferredPlanDigests = [];
    for (const plan of plans) {
      const context = await this.#context(plan);
      const state = await this.#load(context, true);
      if (!state) fail("Workbench recovery preparation is missing");
      if (!state.proof) deferredPlanDigests.push(plan.planDigest);
      else if (!state.committed)
        settledReceipts.push(await this.#settle(context, state, null, false));
    }
    return capture({ settledReceipts, deferredPlanDigests });
  }
  async resume() {
    const snapshot = this.#snapshot();
    for (const row of snapshot.rows)
      if (
        row.kind === "committed" &&
        !this.#find("prepared", row.value.planDigest, snapshot)
      )
        fail("Workbench rollback settlement lacks preparation");
    const plans = snapshot.rows
      .filter((row) => row.kind === "prepared")
      .map((row) => row.value.plan);
    const receipts = [];
    for (const plan of plans) {
      const context = await this.#context(plan);
      const state = await this.#load(context);
      if (!state.committed) {
        // A later legitimate release must not strand a completed rollback's
        // accounting. Authenticate the historical effect and only settle it;
        // explicit execute() still requires the effect to be current.
        receipts.push(
          state.proof
            ? await this.#settle(context, state, null, false)
            : await this.createExecutor().execute(plan),
        );
      }
    }
    return Object.freeze(receipts);
  }
}

export function createEvolutionWorkbenchRollbackRuntime(options) {
  const adapter = new EvolutionWorkbenchRollbackLedgerAdapter(options);
  return Object.freeze({
    rollbackExecutor: adapter.createExecutor(),
    activeStateReader: Object.freeze({
      read: adapter.readActiveState.bind(adapter),
    }),
    reconcileCommitted: adapter.reconcileCommitted.bind(adapter),
    resume: adapter.resume.bind(adapter),
  });
}
