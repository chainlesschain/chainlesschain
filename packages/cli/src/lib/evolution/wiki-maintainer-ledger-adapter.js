import { createHash } from "node:crypto";
import { resolveKnowledgeWikiSourceProvenance } from "./knowledge-wiki-source-provenance.js";
import {
  EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES,
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
  captureEvolutionLedgerBatchResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_LEDGER_MAX_EVENTS,
} from "./evolution-ledger.js";
import {
  WIKI_REVISION_SCHEMA,
  WIKI_STATE_SCHEMA,
  createEmptyWikiState,
  digestWikiState,
} from "./evidence-backed-wiki-maintainer.js";

export const WIKI_LEDGER_EVENT_TYPE = "wiki.revision.committed";
export const WIKI_LEDGER_CONFLICT_CODE = "CC_EVOLUTION_WIKI_REVISION_CONFLICT";
import {
  WIKI_LEDGER_CORRUPT_CODE,
  verifyWikiRevision as verifyRevision,
  verifyWikiRequestTransition as verifyRequestTransition,
} from "./wiki-revision-protocol.js";
export { WIKI_LEDGER_CORRUPT_CODE } from "./wiki-revision-protocol.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REVISION_ID = /^wiki:[a-f0-9]{64}$/u;
const READERS = new WeakMap();

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${name} is required`);
  return value;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function captureMethod(owner, name, label) {
  const method = owner?.[name];
  if (typeof method !== "function")
    throw new TypeError(`${label}.${name} is required`);
  return (...args) => Reflect.apply(method, owner, args);
}

function parseRecord(resolution, descriptor) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    !DIGEST.test(resolution.digest ?? "") ||
    !DIGEST.test(resolution.receiptDigest ?? "") ||
    !Buffer.isBuffer(resolution.bytes) ||
    resolution.bytes.length > EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES
  ) {
    fail(
      WIKI_LEDGER_CORRUPT_CODE,
      "Wiki artifact resolution is not authenticated and complete",
    );
  }
  let record;
  try {
    record = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(resolution.bytes),
    );
  } catch {
    fail(WIKI_LEDGER_CORRUPT_CODE, "Wiki artifact is not canonical JSON");
  }
  const revision = record?.value;
  if (
    record?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    record.tenantId !== descriptor.artifactTenantId ||
    record.audience !== descriptor.audience ||
    record.purpose !== descriptor.purpose ||
    record.retention !== "ledger" ||
    record.type !== "wiki-revision" ||
    revision?.schema !== WIKI_REVISION_SCHEMA ||
    revision.tenantId !== descriptor.tenantId ||
    revision.evolutionRunId !== descriptor.evolutionRunId ||
    revision.state?.schema !== WIKI_STATE_SCHEMA ||
    revision.state.tenantId !== descriptor.tenantId ||
    revision.stateDigest !== digestWikiState(revision.state) ||
    revision.state.revisionId !== revision.revisionId ||
    !REVISION_ID.test(revision.revisionId ?? "")
  ) {
    fail(
      WIKI_LEDGER_CORRUPT_CODE,
      "Wiki artifact record or revision binding is invalid",
    );
  }
  return verifyRevision(revision, descriptor);
}

function normalizeDescriptor(input) {
  return Object.freeze({
    tenantId: requiredString(input?.tenantId, "tenantId"),
    artifactTenantId: requiredString(
      input?.artifactTenantId,
      "artifactTenantId",
    ),
    evolutionRunId: requiredString(input?.evolutionRunId, "evolutionRunId"),
    audience: requiredString(input?.audience, "audience"),
    purpose: requiredString(input?.purpose, "purpose"),
  });
}

export class WikiMaintainerLedgerAdapter {
  #putCanonical;
  #readLedger;
  #verifyLedger;
  #appendDomainEvent;
  #resolveArtifact;
  #resolveArtifactBatch;

  constructor({
    descriptor,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
  } = {}) {
    this.descriptor = normalizeDescriptor(descriptor);
    this.#putCanonical = captureMethod(
      artifactPorts,
      "putCanonical",
      "artifactPorts",
    );
    this.#readLedger = captureMethod(ledger, "read", "ledger");
    this.#verifyLedger = captureMethod(ledger, "verify", "ledger");
    this.#appendDomainEvent = captureMethod(
      ledger,
      "appendDomainEvent",
      "ledger",
    );
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    this.#resolveArtifact = ledgerArtifactResolver;
    this.#resolveArtifactBatch = captureEvolutionLedgerBatchResolver(
      ledgerArtifactResolver,
    );
    Object.freeze(this);
    READERS.set(
      this,
      Object.freeze({
        descriptor: this.descriptor,
        matchesLedger: (candidate) => candidate === ledger,
        loadWiki: () => this.#loadWiki(),
        readInventory: () => this.#readInventory(),
        readRevision: (input) => this.#readRevision(input),
        readKnowledgeProvenance: (input) =>
          this.#readKnowledgeProvenance(input),
        readStateRevision: (input) => this.#readStateRevision(input),
        findStateRevision: (input) => this.#readStateRevision(input, false),
        resolveHistory: (input) => this.#resolveHistory(input),
        resolveAtCheckpoint: (input) => this.#resolveHistory(input, true),
      }),
    );
  }

  #history({
    sourceDigest = null,
    allowed = [],
    checkpoint = null,
    inventory = false,
    revisionId = null,
    stateRevisionDigest = null,
  } = {}) {
    // read() already authenticates its snapshot. Resolve against that snapshot's
    // identity, then compare the entire event range with a fresh authority head.
    // This avoids a redundant pre-read scan without caching authorization.
    const events = this.#readLedger({ limit: EVOLUTION_LEDGER_MAX_EVENTS });
    if (!Array.isArray(events) || events.length > EVOLUTION_LEDGER_MAX_EVENTS)
      fail(
        WIKI_LEDGER_CORRUPT_CODE,
        "EvolutionLedger read did not return events",
      );
    const tail = events.at(-1);
    if (checkpoint) {
      const boundary = events[checkpoint.sequence - 1];
      if (
        !boundary ||
        ["epoch", "ledgerId", "identityDigest"].some(
          (key) => checkpoint[key] !== boundary[key],
        ) ||
        checkpoint.headDigest !== boundary.eventDigest
      ) {
        fail(
          WIKI_LEDGER_CONFLICT_CODE,
          "Wiki checkpoint is not in this authenticated ledger",
        );
      }
    }
    if (
      tail &&
      (typeof tail.epoch !== "string" ||
        typeof tail.ledgerId !== "string" ||
        !DIGEST.test(tail.identityDigest ?? "") ||
        !DIGEST.test(tail.eventDigest ?? "") ||
        events.some(
          (event, index) =>
            event.sequence !== index + 1 ||
            event.epoch !== tail.epoch ||
            event.ledgerId !== tail.ledgerId ||
            event.identityDigest !== tail.identityDigest,
        ))
    ) {
      fail(
        WIKI_LEDGER_CORRUPT_CODE,
        "Wiki ledger read has incomplete sequence or identity bindings",
      );
    }
    const matches = events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === WIKI_LEDGER_EVENT_TYPE &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.evolutionRunId,
    );
    const tenantWikiRunIds = [
      ...new Set(
        events
          .filter(
            (event) =>
              event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
              event.type === WIKI_LEDGER_EVENT_TYPE &&
              event.tenantId === this.descriptor.tenantId,
          )
          .map((event) => requiredString(event.correlationId, "correlationId")),
      ),
    ].sort();
    let state = createEmptyWikiState(this.descriptor.tenantId);
    let viewState = state;
    let latest = null;
    let selectedRevision = null;
    let source = sourceDigest === digestWikiState(state) ? state : null;
    const successors = [];
    const revisions = [];
    let retainedBytes = 0;
    let batch = [];
    for (const [index, event] of matches.entries()) {
      const previous = latest;
      if (
        !Number.isSafeInteger(event.sequence) ||
        event.sequence <= (previous?.event.sequence ?? 0) ||
        event.artifactTenantId !== this.descriptor.artifactTenantId ||
        event.decision !== "committed" ||
        event.skillName !== null ||
        !Array.isArray(event.sourceRefs) ||
        digestWikiState(event.sourceRefs) !==
          digestWikiState(previous ? [previous.event.subjectRef] : [])
      ) {
        fail(WIKI_LEDGER_CORRUPT_CODE, "Wiki ledger event lineage is invalid");
      }
      // Four revisions at most (4 MiB of payload), retained only while this
      // synchronous chunk is checked. Full index readback and fresh authority
      // remain inside each batch; no snapshot survives this history read.
      if (index % 4 === 0)
        batch = this.#resolveArtifactBatch(
          matches.slice(index, index + 4).map((item) => ({
            epoch: tail.epoch,
            ledgerId: tail.ledgerId,
            ref: item.subjectRef,
            tenantId: this.descriptor.artifactTenantId,
          })),
        );
      const revision = this.#resolveEvent(event, tail, batch[index % 4]);
      const inView =
        checkpoint === null || event.sequence <= checkpoint.sequence;
      // Before durable maintenance requests, v1 genesis did not contain that
      // map. Accept only the exact known legacy genesis, never an arbitrary
      // caller-supplied predecessor or a modern revision with missing fields.
      if (
        !previous &&
        !Object.hasOwn(revision, "maintenanceRequestId") &&
        !Object.hasOwn(revision.state, "maintenanceRequests") &&
        revision.priorStateDigest !== digestWikiState(state)
      ) {
        const legacyGenesis = {
          ...createEmptyWikiState(this.descriptor.tenantId),
        };
        delete legacyGenesis.maintenanceRequests;
        if (revision.priorStateDigest === digestWikiState(legacyGenesis)) {
          state = freeze(legacyGenesis);
          if (inView) {
            viewState = state;
            source = sourceDigest === revision.priorStateDigest ? state : null;
          }
        }
      }
      if (
        revision.revision !== state.revision + 1 ||
        revision.priorStateDigest !== digestWikiState(state) ||
        event.eventId !== `wiki.revision.${revision.revisionId.slice(5)}` ||
        event.timestamp !== revision.effectiveAt
      ) {
        fail(
          WIKI_LEDGER_CORRUPT_CODE,
          "Wiki revision does not extend its authenticated predecessor",
        );
      }
      verifyRequestTransition(state, revision);
      if (inventory) {
        const wikiSourceRevisionIds = [
          ...new Set(
            Object.values(revision.state.evidence)
              .flatMap((entry) => [entry.ref, entry.artifactRef])
              .filter(
                (ref) =>
                  typeof ref === "string" &&
                  ref.startsWith(`wiki-source://${this.descriptor.tenantId}/wiki:`),
              )
              .map((ref) => ref.slice(ref.lastIndexOf("/") + 1)),
          ),
        ].sort();
        revisions.push(
          freeze({
            revision: revision.revision,
            revisionId: revision.revisionId,
            priorStateDigest: revision.priorStateDigest,
            stateDigest: revision.stateDigest,
            artifactRef: event.subjectRef,
            wikiSourceRevisionIds,
            checkpoint: {
              epoch: event.epoch,
              ledgerId: event.ledgerId,
              identityDigest: event.identityDigest,
              sequence: event.sequence,
              headDigest: event.eventDigest,
            },
          }),
        );
      }
      if (
        revision.revisionId === revisionId ||
        revision.stateDigest === stateRevisionDigest
      ) {
        if (selectedRevision)
          fail(WIKI_LEDGER_CORRUPT_CODE, "Wiki revision identity is ambiguous");
        selectedRevision = {
          trusted: true,
          state: revision.state,
          stateDigest: revision.stateDigest,
          revisionId: revision.revisionId,
          checkpoint: {
            epoch: event.epoch,
            ledgerId: event.ledgerId,
            identityDigest: event.identityDigest,
            sequence: event.sequence,
            headDigest: event.eventDigest,
          },
          artifactRef: event.subjectRef,
        };
      }
      if (source && inView) {
        if (
          !revision.maintenanceRequestDigest ||
          revision.maintenanceRequestDigest !== allowed[successors.length]
        ) {
          fail(
            WIKI_LEDGER_CONFLICT_CODE,
            "Wiki has successors outside the authorized maintenance sequence",
          );
        }
        retainedBytes += Buffer.byteLength(JSON.stringify(revision), "utf8");
        if (retainedBytes > 8 * EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES) {
          fail(
            WIKI_LEDGER_CORRUPT_CODE,
            "Wiki successor history exceeds its retained byte budget",
          );
        }
        successors.push({
          revision,
          eventDigest: event.eventDigest,
          artifactRef: event.subjectRef,
          predecessorHead: {
            epoch: event.epoch,
            ledgerId: event.ledgerId,
            identityDigest: event.identityDigest,
            sequence: event.sequence - 1,
            headDigest: event.prevDigest,
          },
        });
      } else if (inView && sourceDigest === revision.stateDigest) {
        source = revision.state;
      }
      if (inView) viewState = revision.state;
      latest = { event, revision };
      state = revision.state;
    }
    const head = this.#verifyLedger();
    if (
      head.sequence !== events.length ||
      head.headDigest !== (tail?.eventDigest ?? null) ||
      (tail &&
        ["identityDigest", "epoch", "ledgerId"].some(
          (key) => tail[key] !== head[key],
        ))
    ) {
      fail(
        WIKI_LEDGER_CONFLICT_CODE,
        "Wiki ledger changed while authenticating history",
      );
    }
    return {
      head,
      latest,
      state,
      viewState,
      source,
      successors,
      selectedRevision,
      revisions,
      tenantWikiRunIds,
    };
  }

  #readInventory() {
    const { head, revisions, tenantWikiRunIds } = this.#history({
      inventory: true,
    });
    return freeze({
      authenticated: true,
      descriptor: this.descriptor,
      ledgerHead: head,
      revisions,
      tenantWikiRunIds,
    });
  }

  #readKnowledgeProvenance({
    tenantId,
    revisionId,
    knowledgeId,
    contentDigest,
  } = {}) {
    if (
      tenantId !== this.descriptor.tenantId ||
      !REVISION_ID.test(revisionId ?? "") ||
      typeof knowledgeId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u.test(knowledgeId) ||
      !DIGEST.test(contentDigest ?? "")
    )
      throw new TypeError(
        "Wiki Knowledge provenance requires exact source identities",
      );
    const events = this.#readLedger({ limit: EVOLUTION_LEDGER_MAX_EVENTS });
    const tail = Array.isArray(events) ? events.at(-1) : null;
    if (
      !tail ||
      events.length > EVOLUTION_LEDGER_MAX_EVENTS ||
      events.some(
        (event, index) =>
          event.sequence !== index + 1 ||
          ["epoch", "ledgerId", "identityDigest"].some(
            (key) => event[key] !== tail[key],
          ),
      )
    )
      fail(
        WIKI_LEDGER_CORRUPT_CODE,
        "Wiki provenance event range is incomplete",
      );
    const selected = events.find(
      (event) =>
        event.eventId === `wiki.revision.${revisionId.slice(5)}` &&
        event.tenantId === tenantId,
    );
    const sources = events.filter(
      (event) =>
        event.type === WIKI_LEDGER_EVENT_TYPE &&
        event.tenantId === tenantId &&
        event.sequence <= (selected?.sequence ?? 0),
    );
    const positions = new Map(
      sources.map((event, index) => [event.sequence, index]),
    );
    // Same bounded four-subject read as normal Wiki history. Retain no proof
    // across calls and never resolve a future revision as an earlier source.
    let batchStart = -1;
    let batch = [];
    const proof = resolveKnowledgeWikiSourceProvenance({
      events,
      descriptor: this.descriptor,
      revisionId,
      knowledge: { knowledgeId, contentDigest },
      resolveSubject: (event) => {
        const position = positions.get(event.sequence);
        const start = position - (position % 4);
        if (start !== batchStart) {
          batch = this.#resolveArtifactBatch(
            sources.slice(start, start + 4).map((item) => ({
              epoch: tail.epoch,
              ledgerId: tail.ledgerId,
              tenantId: this.descriptor.artifactTenantId,
              ref: item.subjectRef,
            })),
          );
          batchStart = start;
        }
        const resolution = batch[position - start];
        if (
          resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
          resolution.authenticated !== true ||
          resolution.found !== true ||
          resolution.ref !== event.subjectRef.ref ||
          resolution.digest !== event.subjectRef.digest ||
          !DIGEST.test(resolution.receiptDigest ?? "") ||
          !Buffer.isBuffer(resolution.bytes) ||
          resolution.bytes.length > EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES ||
          `sha256:${createHash("sha256").update(resolution.bytes).digest("hex")}` !==
            event.subjectRef.digest
        )
          fail(
            WIKI_LEDGER_CORRUPT_CODE,
            "Wiki provenance subject is not authenticated and exactly bound",
          );
        return resolution.bytes;
      },
    });
    const head = this.#verifyLedger();
    if (
      head.sequence !== events.length ||
      head.headDigest !== tail.eventDigest ||
      ["epoch", "ledgerId", "identityDigest"].some(
        (key) => head[key] !== tail[key],
      )
    )
      fail(
        WIKI_LEDGER_CONFLICT_CODE,
        "Wiki ledger changed while authenticating source provenance",
      );
    return freeze({
      authenticated: true,
      tenantId,
      ...proof,
      ledgerHead: head,
    });
  }

  // Immutable provenance, not an authorization to use an obsolete Wiki as current.
  // Authenticate the full present history, retaining only the selected revision.
  #readRevision({ tenantId, revisionId } = {}) {
    if (
      tenantId !== this.descriptor.tenantId ||
      !REVISION_ID.test(revisionId ?? "")
    )
      throw new TypeError(
        "Wiki provenance requires an exact tenant and revisionId",
      );
    const { head, selectedRevision } = this.#history({ revisionId });
    if (!selectedRevision)
      fail(
        WIKI_LEDGER_CONFLICT_CODE,
        "Wiki revision is not in authenticated history",
      );
    return freeze({
      authenticated: true,
      tenantId,
      evolutionRunId: this.descriptor.evolutionRunId,
      ...selectedRevision,
      ledgerHead: head,
    });
  }

  // Content-addressed original state lookup, without authorizing intervening
  // changes. Effect consumers still replay their exact permitted successors.
  #readStateRevision({ tenantId, stateDigest } = {}, required = true) {
    if (
      tenantId !== this.descriptor.tenantId ||
      !DIGEST.test(stateDigest ?? "")
    )
      throw new TypeError(
        "Wiki source requires an exact tenant and state digest",
      );
    const { head, selectedRevision } = this.#history({
      stateRevisionDigest: stateDigest,
    });
    // A scoped lookup may prove absence only after authenticating the complete
    // run. Corrupt/missing bytes and concurrent ledger changes still throw.
    if (!selectedRevision && !required) return null;
    if (!selectedRevision)
      fail(
        WIKI_LEDGER_CONFLICT_CODE,
        "Wiki state revision is not in authenticated history",
      );
    return freeze({
      authenticated: true,
      tenantId,
      evolutionRunId: this.descriptor.evolutionRunId,
      ...selectedRevision,
      ledgerHead: head,
    });
  }

  #resolveEvent(event, authority, capturedResolution = null) {
    const resolution =
      capturedResolution ??
      this.#resolveArtifact({
        epoch: authority.epoch,
        ledgerId: authority.ledgerId,
        ref: event.subjectRef,
        tenantId: this.descriptor.artifactTenantId,
      });
    if (
      resolution?.ref !== event.subjectRef.ref ||
      resolution.digest !== event.subjectRef.digest
    ) {
      fail(
        WIKI_LEDGER_CORRUPT_CODE,
        "Wiki ledger event resolved a substituted artifact",
      );
    }
    return parseRecord(resolution, this.descriptor);
  }

  loadWiki = () => this.#loadWiki();

  #loadWiki() {
    const { state } = this.#history();
    return freeze({
      trusted: true,
      state,
      stateDigest: digestWikiState(state),
    });
  }

  resolveHistory(input) {
    return this.#resolveHistory(input);
  }

  resolveAtCheckpoint(input) {
    return this.#resolveHistory(input, true);
  }

  // Provenance only: callers must authorize the plan and independently check
  // the successor's actual operation/state, not treat a request digest as an
  // effect receipt. Allowed digests describe an ordered prefix, not a set.
  #resolveHistory(
    {
      tenantId,
      stateDigest,
      allowedMaintenanceRequestDigests = [],
      checkpoint = null,
    } = {},
    historical = false,
  ) {
    if (historical) {
      const fields = [
        "epoch",
        "ledgerId",
        "identityDigest",
        "sequence",
        "headDigest",
      ];
      if (
        !checkpoint ||
        typeof checkpoint !== "object" ||
        Array.isArray(checkpoint) ||
        Object.keys(checkpoint).length !== fields.length ||
        fields.some((key) => !Object.hasOwn(checkpoint, key)) ||
        typeof checkpoint.epoch !== "string" ||
        typeof checkpoint.ledgerId !== "string" ||
        !DIGEST.test(checkpoint.identityDigest ?? "") ||
        !DIGEST.test(checkpoint.headDigest ?? "") ||
        !Number.isSafeInteger(checkpoint.sequence) ||
        checkpoint.sequence < 1 ||
        checkpoint.sequence > EVOLUTION_LEDGER_MAX_EVENTS
      ) {
        throw new TypeError(
          "Wiki historical read requires an exact authenticated checkpoint",
        );
      }
      checkpoint = Object.freeze({ ...checkpoint });
    } else if (checkpoint !== null) {
      throw new TypeError(
        "current Wiki history cannot be downgraded to a checkpoint view",
      );
    }
    if (
      tenantId !== this.descriptor.tenantId ||
      !DIGEST.test(stateDigest ?? "") ||
      !Array.isArray(allowedMaintenanceRequestDigests) ||
      allowedMaintenanceRequestDigests.length > 128
    ) {
      throw new TypeError(
        "Wiki history requires an exact tenant, baseline, and bounded request sequence",
      );
    }
    const allowed = [];
    const length = allowedMaintenanceRequestDigests.length;
    for (let index = 0; index < length; index += 1) {
      const value = allowedMaintenanceRequestDigests[index];
      if (!DIGEST.test(value ?? "") || allowed.includes(value)) {
        throw new TypeError(
          "Wiki history request digests must be unique and dense",
        );
      }
      allowed.push(value);
    }
    const { head, viewState, source, successors } = this.#history({
      sourceDigest: stateDigest,
      allowed,
      checkpoint,
    });
    if (!source) {
      fail(
        WIKI_LEDGER_CONFLICT_CODE,
        "Wiki baseline is not in authenticated history",
      );
    }
    return freeze({
      authenticated: true,
      tenantId,
      evolutionRunId: this.descriptor.evolutionRunId,
      source: { trusted: true, state: source, stateDigest },
      current: {
        trusted: true,
        state: viewState,
        stateDigest: digestWikiState(viewState),
      },
      successors,
      ledgerHead: head,
      scope: historical ? "checkpoint" : "current",
      checkpoint,
    });
  }

  commitRevision = ({
    expectedStateDigest,
    revision,
    expectedLedgerHead,
  } = {}) => {
    const headKeys = [
      "epoch",
      "ledgerId",
      "identityDigest",
      "sequence",
      "headDigest",
    ];
    if (expectedLedgerHead !== undefined) {
      if (
        !expectedLedgerHead ||
        typeof expectedLedgerHead !== "object" ||
        Array.isArray(expectedLedgerHead) ||
        Object.keys(expectedLedgerHead).length !== headKeys.length ||
        headKeys.some((key) => !Object.hasOwn(expectedLedgerHead, key)) ||
        typeof expectedLedgerHead.epoch !== "string" ||
        typeof expectedLedgerHead.ledgerId !== "string" ||
        !DIGEST.test(expectedLedgerHead.identityDigest ?? "") ||
        !Number.isSafeInteger(expectedLedgerHead.sequence) ||
        expectedLedgerHead.sequence < 0 ||
        (expectedLedgerHead.sequence === 0
          ? expectedLedgerHead.headDigest !== null
          : !DIGEST.test(expectedLedgerHead.headDigest ?? ""))
      ) {
        throw new TypeError("Wiki expected ledger head is invalid");
      }
      expectedLedgerHead = Object.freeze({ ...expectedLedgerHead });
    }
    if (
      !DIGEST.test(expectedStateDigest ?? "") ||
      revision?.schema !== WIKI_REVISION_SCHEMA ||
      revision.tenantId !== this.descriptor.tenantId ||
      revision.evolutionRunId !== this.descriptor.evolutionRunId ||
      revision.stateDigest !== digestWikiState(revision.state) ||
      revision.state.revisionId !== revision.revisionId ||
      !REVISION_ID.test(revision.revisionId ?? "")
    ) {
      throw new TypeError("Wiki revision commit request is invalid");
    }
    // Own the revision before handing it to any persistence callback.
    revision = freeze(
      structuredClone(verifyRevision(revision, this.descriptor)),
    );
    const { head, latest, state: currentState } = this.#history();
    if (
      expectedLedgerHead &&
      headKeys.some((key) => expectedLedgerHead[key] !== head[key])
    ) {
      fail(
        WIKI_LEDGER_CONFLICT_CODE,
        "Wiki authorization ledger head changed before revision commit",
      );
    }
    const currentDigest = digestWikiState(currentState);
    if (currentDigest !== expectedStateDigest) {
      if (
        latest?.revision.revisionId === revision.revisionId &&
        currentDigest === revision.stateDigest
      ) {
        return Object.freeze({
          committed: true,
          recovered: true,
          revisionId: revision.revisionId,
          stateDigest: revision.stateDigest,
          evolutionRunId: this.descriptor.evolutionRunId,
        });
      }
      fail(
        WIKI_LEDGER_CONFLICT_CODE,
        "Wiki state changed before revision commit",
      );
    }
    if (
      revision.revision !== currentState.revision + 1 ||
      revision.priorStateDigest !== currentDigest
    ) {
      fail(
        WIKI_LEDGER_CONFLICT_CODE,
        "Wiki revision does not extend the current state",
      );
    }
    verifyRequestTransition(currentState, revision);
    const published = this.#putCanonical("wiki-revision", revision, {
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
    });
    if (
      !published?.ref ||
      published.receipt?.persisted !== true ||
      published.receipt?.readbackVerified !== true ||
      published.receipt?.integrityVerified !== true ||
      published.receipt?.retention !== "ledger"
    ) {
      fail(
        WIKI_LEDGER_CORRUPT_CODE,
        "Wiki revision artifact was not durably read back",
      );
    }
    const eventId = `wiki.revision.${revision.revisionId.slice("wiki:".length)}`;
    const receipt = this.#appendDomainEvent(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: this.descriptor.evolutionRunId,
        decision: "committed",
        eventId,
        reason: `wiki revision ${revision.revision} committed`,
        skillName: null,
        sourceRefs: latest ? [latest.event.subjectRef] : [],
        subjectRef: published.ref,
        tenantId: this.descriptor.tenantId,
        timestamp: revision.effectiveAt,
        type: WIKI_LEDGER_EVENT_TYPE,
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
    if (
      receipt?.authenticated !== true ||
      receipt?.committed !== true ||
      receipt?.durable !== true ||
      receipt.eventId !== eventId ||
      !DIGEST.test(receipt.receiptDigest ?? "")
    ) {
      fail(
        WIKI_LEDGER_CORRUPT_CODE,
        "Wiki ledger did not confirm a durable authenticated append",
      );
    }
    const stored = this.#history().latest;
    if (
      stored?.revision.revisionId !== revision.revisionId ||
      stored.revision.stateDigest !== revision.stateDigest
    ) {
      fail(
        WIKI_LEDGER_CORRUPT_CODE,
        "Wiki revision readback differs after ledger commit",
      );
    }
    return Object.freeze({
      committed: true,
      recovered: false,
      revisionId: revision.revisionId,
      stateDigest: revision.stateDigest,
      evolutionRunId: this.descriptor.evolutionRunId,
      ledgerReceiptDigest: receipt.receiptDigest,
    });
  };

  maintainerPorts({ resolveEvidence, derive } = {}) {
    if (typeof resolveEvidence !== "function" || typeof derive !== "function") {
      throw new TypeError("resolveEvidence and derive ports are required");
    }
    return Object.freeze({
      loadWiki: () => this.#loadWiki(),
      commitRevision: this.commitRevision,
      resolveEvidence,
      derive,
    });
  }
}

export function captureWikiRevisionReader(adapter) {
  const reader = READERS.get(adapter);
  if (!reader)
    throw new TypeError(
      "a branded WikiMaintainerLedgerAdapter reader is required",
    );
  return reader;
}

export function createWikiMaintainerLedgerAdapter(options) {
  return new WikiMaintainerLedgerAdapter(options);
}
