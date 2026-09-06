import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import { captureSkillCandidateRegistryReader } from "./skill-candidate-registry.js";
import { captureSkillReleaseRegistryReader } from "./skill-release-registry.js";
import { verifyGovernedKnowledgeRecord } from "./governed-knowledge-record.js";
import { governedKnowledgeSourceRef } from "./governed-knowledge-skill-rollback.js";
import { captureWikiRevisionReader } from "./wiki-maintainer-ledger-adapter.js";

export const GOVERNED_KNOWLEDGE_DEPENDENCY_INVENTORY_SCHEMA =
  "chainlesschain.governed-knowledge-dependency-inventory/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const PLANNERS = new WeakMap();
const PLANS = new WeakMap();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function fail(message) {
  throw new Error(`knowledge dependency inventory: ${message}`);
}

function dataRecord(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a plain data object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`${label} must contain only data properties`);
    }
  }
  return value;
}

function sameHead(left, right) {
  return [
    "epoch",
    "ledgerId",
    "identityDigest",
    "sequence",
    "headDigest",
  ].every((key) => left?.[key] === right?.[key]);
}

function orderWikiRuns(affectedRuns, inventories, revisionOwners) {
  const edges = new Map([...affectedRuns].map((run) => [run, new Set()]));
  for (const [run, inventory] of inventories) {
    if (!affectedRuns.has(run)) continue;
    for (const revision of inventory.revisions) {
      for (const sourceRevisionId of revision.wikiSourceRevisionIds) {
        const parent = revisionOwners.get(sourceRevisionId);
        if (parent && parent !== run && affectedRuns.has(parent)) {
          edges.get(run).add(parent);
        }
      }
    }
  }
  const indegree = new Map([...affectedRuns].map((run) => [run, 0]));
  for (const parents of edges.values()) {
    for (const parent of parents)
      indegree.set(parent, indegree.get(parent) + 1);
  }
  const ready = [...affectedRuns]
    .filter((run) => indegree.get(run) === 0)
    .sort();
  const ordered = [];
  while (ready.length > 0) {
    const run = ready.shift();
    ordered.push(run);
    for (const parent of [...edges.get(run)].sort()) {
      indegree.set(parent, indegree.get(parent) - 1);
      if (indegree.get(parent) === 0) {
        ready.push(parent);
        ready.sort();
      }
    }
  }
  if (ordered.length !== affectedRuns.size)
    fail("Wiki source graph contains a cycle");
  return ordered;
}

export function buildGovernedKnowledgeDependencyInventory({
  tenantId,
  knowledgeId,
  contentDigest,
  candidateRegistry,
  releaseRegistry,
  wikiAdapters,
  candidateDisposition = "reject-candidate",
  wikiDisposition = "tombstone",
} = {}) {
  if (
    typeof tenantId !== "string" ||
    !ID.test(tenantId) ||
    typeof knowledgeId !== "string" ||
    !ID.test(knowledgeId) ||
    !DIGEST.test(contentDigest ?? "") ||
    !Array.isArray(wikiAdapters) ||
    wikiAdapters.length < 1 ||
    wikiAdapters.length > 64 ||
    !["reject-candidate", "quarantine"].includes(candidateDisposition) ||
    !["tombstone", "quarantine"].includes(wikiDisposition)
  ) {
    throw new TypeError(
      "bounded knowledge dependency inventory input is required",
    );
  }
  const candidates = captureSkillCandidateRegistryReader(candidateRegistry);
  const releases = captureSkillReleaseRegistryReader(releaseRegistry);
  if (candidates.tenantId !== tenantId || releases.tenantId !== tenantId) {
    throw new TypeError("knowledge dependency inventory tenant differs");
  }
  const readers = wikiAdapters.map(captureWikiRevisionReader);
  if (readers.some((reader) => reader.descriptor.tenantId !== tenantId)) {
    throw new TypeError("knowledge dependency Wiki tenant differs");
  }
  const inventories = new Map();
  let ledgerHead = null;
  let discoveredRuns = null;
  const revisionOwners = new Map();
  for (const reader of readers) {
    const run = reader.descriptor.evolutionRunId;
    if (inventories.has(run)) fail("duplicate Wiki run reader");
    const inventory = reader.readInventory();
    if (ledgerHead && !sameHead(ledgerHead, inventory.ledgerHead)) {
      fail("Wiki inventories do not share one stable ledger head");
    }
    if (
      discoveredRuns &&
      canonical(discoveredRuns) !== canonical(inventory.tenantWikiRunIds)
    ) {
      fail("Wiki inventories disagree about tenant run completeness");
    }
    ledgerHead = inventory.ledgerHead;
    discoveredRuns = inventory.tenantWikiRunIds;
    inventories.set(run, { inventory, reader });
    for (const revision of inventory.revisions) {
      if (revisionOwners.has(revision.revisionId))
        fail("duplicate Wiki revision identity");
      revisionOwners.set(revision.revisionId, run);
    }
  }
  const suppliedRuns = [...inventories.keys()].sort();
  if (canonical(suppliedRuns) !== canonical(discoveredRuns)) {
    fail("Wiki run manifest is incomplete for this tenant ledger");
  }
  const sourceRef = governedKnowledgeSourceRef({ tenantId, knowledgeId });
  const proofs = new Map();
  const wikiProof = (candidate) => {
    if (candidate.derivationMode !== "wiki") return null;
    const run = revisionOwners.get(candidate.wikiRevision);
    if (!run) fail("Wiki-derived artifact references an unconfigured revision");
    if (!proofs.has(candidate.wikiRevision)) {
      proofs.set(
        candidate.wikiRevision,
        inventories.get(run).reader.readKnowledgeProvenance({
          tenantId,
          revisionId: candidate.wikiRevision,
          knowledgeId,
          contentDigest,
        }),
      );
    }
    return proofs.get(candidate.wikiRevision);
  };
  const depends = (candidate) => {
    const proof = wikiProof(candidate);
    return (
      candidate.sourceEvidenceRefs.some(
        (entry) => entry.ref === sourceRef && entry.digest === contentDigest,
      ) || (proof?.affectedPatternIds.length ?? 0) > 0
    );
  };
  const unsafe = (candidate) => {
    const proof = wikiProof(candidate);
    return (
      candidate.sourceEvidenceRefs.some(
        (entry) => entry.ref === sourceRef || entry.digest === contentDigest,
      ) || (proof?.unsafePatternIds.length ?? 0) > 0
    );
  };
  const candidateItems = candidates.readInventory();
  const releaseItems = releases.readInventory();
  const releasesByDigest = new Map(
    releaseItems.releases.map((release) => [release.releaseDigest, release]),
  );
  const affectedActive = releaseItems.active.filter(({ release }) =>
    depends(release.candidate),
  );
  for (const { state, release } of affectedActive) {
    const lastKnownGood = releasesByDigest.get(
      state.lastKnownGoodReleaseDigest,
    );
    if (
      !lastKnownGood ||
      lastKnownGood.releaseDigest === release.releaseDigest ||
      lastKnownGood.skillName !== release.skillName ||
      unsafe(lastKnownGood.candidate)
    ) {
      fail(
        "affected active Skill has no safe distinct last-known-good release",
      );
    }
  }
  const activeDependencies = affectedActive.map(({ release }) => ({
    kind: "active-skill",
    digest: release.releaseDigest,
    disposition: "rollback-active",
  }));
  const candidateDependencies = candidateItems
    .filter(depends)
    .map((candidate) => ({
      kind: "candidate",
      digest: candidate.candidateId,
      disposition: candidateDisposition,
    }));
  const wikiTargets = new Map();
  for (const [run, { inventory, reader }] of inventories) {
    for (const revision of inventory.revisions) {
      const proof = reader.readKnowledgeProvenance({
        tenantId,
        revisionId: revision.revisionId,
        knowledgeId,
        contentDigest,
      });
      if (proof.affectedPatternIds.length > 0) {
        wikiTargets.set(run, revision.stateDigest);
        break;
      }
    }
  }
  const wikiDependencies = orderWikiRuns(
    new Set(wikiTargets.keys()),
    new Map([...inventories].map(([run, value]) => [run, value.inventory])),
    revisionOwners,
  ).map((run) => ({
    kind: "wiki",
    digest: wikiTargets.get(run),
    disposition: wikiDisposition,
  }));
  const dependencies = [
    ...activeDependencies.sort((a, b) => a.digest.localeCompare(b.digest)),
    ...candidateDependencies.sort((a, b) => a.digest.localeCompare(b.digest)),
    ...wikiDependencies,
  ];
  if (dependencies.length < 1 || dependencies.length > 256) {
    fail("dependency result is empty or exceeds the governed record bound");
  }
  const finalCandidates = candidates.readInventory();
  const finalReleases = releases.readInventory();
  if (
    canonical(candidateItems.map(({ candidateId }) => candidateId)) !==
      canonical(finalCandidates.map(({ candidateId }) => candidateId)) ||
    canonical(
      releaseItems.releases.map(({ releaseDigest }) => releaseDigest),
    ) !==
      canonical(
        finalReleases.releases.map(({ releaseDigest }) => releaseDigest),
      ) ||
    canonical(releaseItems.active.map(({ state }) => state.stateDigest)) !==
      canonical(finalReleases.active.map(({ state }) => state.stateDigest))
  ) {
    fail("Candidate or Release inventory changed while planning");
  }
  for (const [run, { inventory, reader }] of inventories) {
    const finalInventory = reader.readInventory();
    if (canonical(inventory) !== canonical(finalInventory)) {
      fail(`Wiki inventory changed while planning run ${run}`);
    }
  }
  const core = {
    schema: GOVERNED_KNOWLEDGE_DEPENDENCY_INVENTORY_SCHEMA,
    tenantId,
    knowledgeId,
    contentDigest,
    candidateDisposition,
    wikiDisposition,
    ledgerHead,
    wikiRuns: suppliedRuns,
    dependencies,
  };
  return freeze({
    ...core,
    inventoryDigest: `sha256:${createHash("sha256").update(canonical(core)).digest("hex")}`,
  });
}

export class GovernedKnowledgeDependencyInventoryPlanner {
  constructor(options = {}) {
    const tenantId = options.tenantId;
    if (typeof tenantId !== "string" || !ID.test(tenantId)) {
      throw new TypeError("dependency inventory planner tenantId is invalid");
    }
    // Capture and validate genuine sources now; the builder rechecks them on
    // every plan so a substituted object can never inherit this authority.
    const candidates = captureSkillCandidateRegistryReader(
      options.candidateRegistry,
    );
    const releases = captureSkillReleaseRegistryReader(options.releaseRegistry);
    const wikiAdapters = Array.isArray(options.wikiAdapters)
      ? [...options.wikiAdapters]
      : null;
    if (
      candidates.tenantId !== tenantId ||
      releases.tenantId !== tenantId ||
      !wikiAdapters ||
      wikiAdapters.length < 1 ||
      wikiAdapters.length > 64
    ) {
      throw new TypeError("dependency inventory planner sources are invalid");
    }
    wikiAdapters.forEach(captureWikiRevisionReader);
    PLANNERS.set(
      this,
      Object.freeze({
        tenantId,
        candidateRegistry: options.candidateRegistry,
        releaseRegistry: options.releaseRegistry,
        wikiAdapters: Object.freeze(wikiAdapters),
        candidateDisposition: options.candidateDisposition,
        wikiDisposition: options.wikiDisposition,
      }),
    );
    Object.freeze(this);
  }

  plan(input) {
    const options = PLANNERS.get(this);
    if (!options)
      throw new TypeError("a genuine dependency planner is required");
    dataRecord(input, "knowledge revocation draft");
    if (
      !["tombstone", "revoke"].includes(input.action) ||
      (Object.hasOwn(input, "dependencies") && input.dependencies.length !== 0)
    ) {
      throw new TypeError(
        "revocation draft must not supply its own dependency plan",
      );
    }
    const inventory = buildGovernedKnowledgeDependencyInventory({
      ...options,
      knowledgeId: input.knowledgeId,
      contentDigest: input.contentDigest,
    });
    const knowledge = verifyGovernedKnowledgeRecord(
      { ...structuredClone(input), dependencies: inventory.dependencies },
      { tenantId: options.tenantId },
    );
    const result = freeze({ inventory, knowledge });
    PLANS.set(result, this);
    return result;
  }
}

Object.freeze(GovernedKnowledgeDependencyInventoryPlanner.prototype);

export function isGovernedKnowledgeDependencyInventoryPlanner(value) {
  return PLANNERS.has(value);
}

export function captureGovernedKnowledgeDependencyInventoryPlan(planner, plan) {
  if (!PLANNERS.has(planner) || PLANS.get(plan) !== planner) {
    throw new TypeError("a genuine dependency inventory plan is required");
  }
  return plan;
}
