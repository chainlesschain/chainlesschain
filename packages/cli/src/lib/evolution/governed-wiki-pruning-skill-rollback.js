import { captureSkillReleaseRegistryReader } from "./skill-release-registry.js";
import { types } from "node:util";
import { captureSkillReleaseOperationReader } from "./evolution-ledger-ports.js";
import { captureSkillRollbackProvider } from "./skill-promotion-controller.js";
import {
  verifySkillMutationRequest,
  digestSkillMutationTransitionSubject,
} from "./skill-mutation-authority.js";
import { digestWikiState } from "./evidence-backed-wiki-maintainer.js";
import {
  capturePruningData,
  pruningDigest,
  pruningOperationCalls,
  verifyPruningJournalPlan,
} from "./governed-wiki-pruning-journal.js";

const PROVIDERS = new WeakMap();
export const WIKI_PRUNING_SKILL_ROLLBACK_SCHEMA =
  "chainlesschain.wiki-pruning-skill-rollback/v1";

function fail(message) {
  const error = new Error(message);
  error.code = "CC_WIKI_PRUNING_SKILL_ROLLBACK_INVALID";
  throw error;
}
export function captureWikiPruningSkillRollback(value, tenantId) {
  const provider = PROVIDERS.get(value);
  if (!provider || provider.tenantId !== tenantId)
    throw new TypeError(
      "a same-tenant branded pruning Skill rollback provider is required",
    );
  return provider;
}

// A real ReleaseRegistry/controller effect, never a rollback boolean or an
// independent revoke record. The enclosing Wiki provider supplies the source
// it authenticated with its branded history reader and exact journal context.
// All release transactions MUST be on that same Ledger, so a later finalize
// cannot retrospectively authenticate an earlier pruning checkpoint.
export class GovernedWikiPruningSkillRollback {
  #registry;
  #operations;
  #rollback;
  #authorize;
  #tenantId;

  constructor({
    tenantId,
    releaseRegistry,
    transactionLedger,
    rollbackProvider,
    authorizationProvider,
  } = {}) {
    this.#registry = captureSkillReleaseRegistryReader(releaseRegistry);
    this.#operations = captureSkillReleaseOperationReader(transactionLedger);
    const executor = captureSkillRollbackProvider(
      rollbackProvider,
      releaseRegistry,
    );
    if (
      this.#registry.tenantId !== tenantId ||
      executor.tenantId !== tenantId ||
      !this.#registry.matchesTransactionLedger(transactionLedger)
    )
      throw new TypeError(
        "pruning rollback registry/ledger tenant binding differs",
      );
    const authorize = authorizationProvider?.authorizeRollback;
    if (typeof authorize !== "function")
      throw new TypeError("rollback authorization provider is required");
    this.#tenantId = tenantId;
    this.#rollback = executor.rollback;
    this.#authorize = authorize.bind(authorizationProvider);
    PROVIDERS.set(
      this,
      Object.freeze({
        tenantId,
        apply: (input, refresh) => this.#apply(input, refresh),
        verify: (input) => this.#verify(input),
      }),
    );
    Object.freeze(this);
  }

  #input(input) {
    const {
      plan: candidate,
      source,
      context,
      requireCurrent = false,
    } = capturePruningData(input);
    const plan = verifyPruningJournalPlan(candidate, this.#tenantId);
    if (
      source?.trusted !== true ||
      source.state?.tenantId !== this.#tenantId ||
      source.stateDigest !== plan.wikiStateDigest ||
      digestWikiState(source.state) !== plan.wikiStateDigest ||
      typeof requireCurrent !== "boolean"
    )
      fail("rollback source differs from the pruning Wiki baseline");
    const groups = new Map();
    for (const item of plan.dependencyDispositions) {
      if (item.action !== "rollback") continue;
      if (!Array.isArray(item.skillNames) || item.skillNames.length === 0)
        fail("rollback has no Skill dependency");
      for (const name of item.skillNames) {
        if (!groups.has(name)) groups.set(name, new Set());
        groups.get(name).add(item.patternId);
      }
    }
    if (groups.size > 4096)
      fail("rollback Skill count exceeds the pruning action budget");
    const skills = [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([skillName, patternIds]) => ({
        skillName,
        patternIds: [...patternIds].sort(),
        operationId: `pruning-rollback:${pruningDigest(
          "chainlesschain.wiki-pruning-skill-operation/v1",
          {
            requestDigest: pruningOperationCalls(plan)[0].requestDigest,
            skillName,
          },
        ).slice(7)}`,
      }));
    return { plan, source, context, requireCurrent, skills };
  }

  #validateReleases(input, skill, from, target) {
    if (
      !from ||
      !target ||
      from.tenantId !== this.#tenantId ||
      target.tenantId !== this.#tenantId ||
      from.skillName !== skill.skillName ||
      target.skillName !== skill.skillName ||
      from.releaseDigest === target.releaseDigest
    )
      fail("rollback does not select distinct same-tenant releases");
    const decisions =
      input.source.state.skillImpact?.[skill.skillName]?.decisions ?? [];
    const patternsFor = (release) => {
      const accepted = decisions.filter(
        (item) =>
          item.candidateId === release.candidate.candidateId &&
          item.outcome === "accepted",
      );
      if (!accepted.length)
        fail("release has no authenticated candidate-to-pattern lineage");
      return new Set(accepted.flatMap((item) => item.patternRefs));
    };
    const affected = patternsFor(from);
    if (skill.patternIds.some((id) => !affected.has(id)))
      fail("active release is not the planned dependent candidate");
    const deleted = new Set(
      input.plan.deletions.map((item) => item.evidenceRef),
    );
    for (const id of patternsFor(target)) {
      const pattern = input.source.state.patterns[id];
      if (
        !pattern ||
        [...pattern.positiveEvidence, ...pattern.negativeEvidence].some((ref) =>
          deleted.has(ref),
        )
      )
        fail("last-known-good release still depends on deleted evidence");
    }
    // Direct recordings must not be hidden behind an empty Wiki pattern list.
    const deletedRefs = new Set(
      input.plan.deletions.flatMap((item) => [
        item.evidenceRef,
        item.artifactRef,
        item.rawArtifactRef,
      ]),
    );
    if (
      target.candidate.sourceEvidenceRefs.some(({ ref }) =>
        deletedRefs.has(ref),
      )
    )
      fail("last-known-good release directly references deleted evidence");
  }

  #resolve(input, skill) {
    return this.#operations.resolveOperation({
      tenantId: this.#tenantId,
      skillName: skill.skillName,
      operationId: skill.operationId,
      context: input.context,
    }).result;
  }
  #receipt(input, skill, result) {
    if (result.projection.status !== "committed")
      fail(
        "rollback transaction is prepared but not committed; reopen the registry for recovery",
      );
    const { intent, projection, previous } = result;
    if (
      intent.operation !== "rollback" ||
      intent.operationId !== skill.operationId ||
      intent.skillName !== skill.skillName ||
      intent.targetReleaseDigest !== previous.lastKnownGoodReleaseDigest ||
      previous.activeReleaseDigest === intent.targetReleaseDigest
    )
      fail("settled release transaction is not the exact pruning rollback");
    const from = this.#registry.readRelease(previous.activeReleaseDigest);
    const target = this.#registry.readRelease(intent.targetReleaseDigest);
    this.#validateReleases(input, skill, from, target);
    if (
      intent.expectedParentDigest !== from.contentDigest ||
      intent.dependencyLockDigest !== target.dependencyLockDigest
    )
      fail("rollback content/dependency lock binding differs");
    if (input.requireCurrent) {
      const current = this.#registry.readActive(skill.skillName);
      if (
        projection.current !== true ||
        current?.state.transactionId !== intent.transactionId ||
        current.state.stateDigest !== projection.stateDigest ||
        current.release.releaseDigest !== target.releaseDigest
      )
        fail("active release changed after the pruning rollback");
    }
    const core = {
      schema: WIKI_PRUNING_SKILL_ROLLBACK_SCHEMA,
      tenantId: this.#tenantId,
      skillName: skill.skillName,
      planDigest: input.plan.planDigest,
      pruningRequestDigest: pruningOperationCalls(input.plan)[0].requestDigest,
      operationId: skill.operationId,
      transactionId: intent.transactionId,
      fromReleaseDigest: from.releaseDigest,
      targetReleaseDigest: target.releaseDigest,
      previousStateDigest: previous.stateDigest,
      resultStateDigest: projection.stateDigest,
      intentDigest: intent.intentDigest,
      authorityReceiptDigest: intent.authorityReceiptDigest,
      releaseReceiptDigest: projection.receiptDigest,
      epoch: projection.epoch,
      ledgerId: projection.ledgerId,
      sequence: projection.sequence,
      eventDigest: projection.headDigest,
    };
    return capturePruningData({
      ...core,
      receiptDigest: pruningDigest(WIKI_PRUNING_SKILL_ROLLBACK_SCHEMA, core),
    });
  }

  #verify(value) {
    const input = this.#input(value);
    const receipts = [];
    for (const skill of input.skills) {
      const result = this.#resolve(input, skill);
      if (!result) return null;
      receipts.push(this.#receipt(input, skill, result));
    }
    return capturePruningData(receipts);
  }

  async #apply(value, refresh) {
    if (typeof refresh !== "function")
      fail("a fresh pruning journal authorization is required");
    const input = this.#input({ ...value, requireCurrent: true });
    if (input.context.mode !== "current")
      fail("historical checkpoints cannot authorize new rollback effects");
    const pending = [];
    for (const skill of input.skills) {
      const existing = this.#resolve(input, skill);
      if (existing) {
        this.#receipt(input, skill, existing);
        continue;
      }
      const active = this.#registry.readActive(skill.skillName);
      if (!active) fail("planned dependent Skill has no active release");
      const target = this.#registry.readRelease(
        active.state.lastKnownGoodReleaseDigest,
      );
      this.#validateReleases(input, skill, active.release, target);
      pending.push({ skill, active, target });
    }
    if (pending.length === 0) return { changed: false };
    // Preflight every pending Skill before mutating the first. One real
    // operation per call lets the enclosing journal refresh its full head.
    const { skill, active, target } = pending[0];
    const expected = Object.freeze({
      tenantId: this.#tenantId,
      skillName: skill.skillName,
      operationId: skill.operationId,
      operation: "rollback",
      targetScope: "active",
      expectedTargetDigest: active.release.contentDigest,
      expectedTargetRevision: active.state.revision,
      targetReleaseDigest: target.releaseDigest,
      transitionSubjectDigest: digestSkillMutationTransitionSubject({
        tenantId: this.#tenantId,
        skillName: skill.skillName,
        operation: "rollback",
        candidateId: null,
        rollbackTargetReleaseDigest: target.releaseDigest,
        dependencyLockDigest: target.dependencyLockDigest,
        expectedActiveContentDigest: active.release.contentDigest,
        expectedActiveRevision: active.state.revision,
      }),
    });
    const authorization = await this.#authorize(expected);
    if (
      !authorization ||
      typeof authorization !== "object" ||
      types.isProxy(authorization)
    )
      fail("rollback authorization must be own data");
    const fields = Object.getOwnPropertyDescriptors(authorization);
    if (
      Reflect.ownKeys(fields).length !== 2 ||
      !fields.request ||
      !fields.capability ||
      [fields.request, fields.capability].some(
        (field) => !("value" in field) || !field.enumerable,
      )
    )
      fail(
        "rollback authorization must have exact own request/capability fields",
      );
    const request = verifySkillMutationRequest(fields.request.value);
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
      if (request[key] !== expected[key])
        fail("rollback authority authorized a different transition");
    // Issuing authorization may itself append authority audit events. The
    // enclosing branded journal must reauthenticate the SAME plan at its new
    // current head; reusing the pre-authorization head would reject real audit.
    const refreshed = this.#input({
      ...(await refresh()),
      requireCurrent: true,
    });
    if (
      refreshed.plan.planDigest !== input.plan.planDigest ||
      refreshed.context.mode !== "current"
    )
      fail(
        "pruning authorization changed while requesting rollback permission",
      );
    if (this.#resolve(refreshed, skill) !== null)
      fail("rollback changed while authorization was pending");
    await this.#rollback({
      authorization: { request, capability: fields.capability.value },
      targetReleaseDigest: target.releaseDigest,
    });
    return { changed: true };
  }
}
