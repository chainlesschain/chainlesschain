import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  EvolutionArtifactPorts,
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EvolutionLedger,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_LEDGER_MAX_EVENTS,
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
} from "./evolution-ledger.js";
import { SkillPromotionReviewLedgerAdapter } from "./skill-promotion-review-ledger-adapter.js";
import { EvolutionRunLedgerAdapter } from "./evolution-run-ledger-adapter.js";
import { EvolutionWorkbenchBatchExecutor } from "./evolution-workbench-batch-executor.js";
import {
  buildEvolutionWorkbenchProjection,
  filterEvolutionWorkbenchProjection,
  isEvolutionWorkbenchDataSource,
  createEvolutionWorkbenchDataSource,
} from "./evolution-workbench-projection.js";
import {
  verifyWorkbenchBatchPlan,
  buildWorkbenchBatchItemRequest,
  verifyWorkbenchHumanDecisionResponse,
  buildWorkbenchExecutionItem,
} from "./evolution-workbench-review-protocol.js";
import {
  capturePruningData as capture,
  pruningCanonical as canonical,
} from "./governed-wiki-pruning-journal.js";

export const WORKBENCH_REVIEW_PREPARATION_SCHEMA =
  "chainlesschain.evolution-workbench-review-preparation/v1";
export const WORKBENCH_REVIEW_SETTLEMENT_SCHEMA =
  "chainlesschain.evolution-workbench-review-settlement/v1";
const TYPES = Object.freeze({
  projection: [
    "evolution-workbench-projection",
    "evolution.workbench.projection.retained",
  ],
  prepared: [
    "evolution-workbench-review-preparation",
    "evolution.workbench.review.prepared",
  ],
  committed: [
    "evolution-workbench-review-settlement",
    "evolution.workbench.review.committed",
  ],
});
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PROJECTION_READERS = new WeakSet();
const ADAPTER_PROJECTION_READERS = new WeakMap();
export function captureWorkbenchProjectionReader(value) {
  if (!PROJECTION_READERS.has(value))
    throw new TypeError(
      "a genuine Workbench retained projection reader is required",
    );
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
  error.code = "CC_EVOLUTION_WORKBENCH_REVIEW_LEDGER_INVALID";
  throw error;
}
function method(owner, name) {
  if (!owner || types.isProxy(owner))
    throw new TypeError(`${name} fixed port is required`);
  const fn = Object.getOwnPropertyDescriptor(owner, name)?.value;
  if (typeof fn !== "function" || types.isProxy(fn))
    throw new TypeError(`${name} fixed own method is required`);
  return fn.bind(owner);
}

// All effects and recovery evidence use the same real ArtifactPorts/Ledger.
// Deployment owns the human provider and BOTH current signature verifiers.
// No default identity, signer, test key, in-memory journal or success fallback.
export class EvolutionWorkbenchReviewLedgerAdapter {
  #ledger;
  #put;
  #resolve;
  #source;
  #review;
  #requestHuman;
  #verifyHuman;
  #now;
  constructor({
    descriptor,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    projectionSource,
    decisionVerifier,
    humanDecisionProvider,
    humanDecisionVerifier,
    now = Date.now,
  } = {}) {
    const d = capture(descriptor);
    for (const key of [
      "tenantId",
      "artifactTenantId",
      "streamId",
      "runId",
      "skillName",
      "audience",
    ])
      if (
        typeof d[key] !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u.test(d[key])
      )
        throw new TypeError(`Workbench ${key} is invalid`);
    if (d.purpose !== "evolution-ledger")
      throw new TypeError("Workbench requires evolution-ledger purpose");
    if (
      types.isProxy(ledger) ||
      types.isProxy(artifactPorts) ||
      !(ledger instanceof EvolutionLedger) ||
      !(artifactPorts instanceof EvolutionArtifactPorts) ||
      !isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)
    )
      throw new TypeError(
        "Workbench requires actual Ledger and ArtifactPorts with a branded resolver",
      );
    if (
      !isEvolutionWorkbenchDataSource(projectionSource) ||
      projectionSource.tenantId !== d.tenantId ||
      projectionSource.runId !== d.runId ||
      projectionSource.skillName !== d.skillName
    )
      throw new TypeError(
        "Workbench requires a same-scope branded projection source",
      );
    if (typeof now !== "function" || types.isProxy(now))
      throw new TypeError("Workbench clock is required");
    this.descriptor = d;
    // Capture concrete implementations; caller-shaped Ledger methods cannot
    // manufacture recovery evidence or broaden the read to another backend.
    this.#ledger = Object.freeze({
      read: () =>
        EvolutionLedger.prototype.read.call(ledger, {
          limit: EVOLUTION_LEDGER_MAX_EVENTS,
        }),
      verify: EvolutionLedger.prototype.verify.bind(ledger),
      appendDomainEvent:
        EvolutionLedger.prototype.appendDomainEvent.bind(ledger),
    });
    this.#put =
      EvolutionArtifactPorts.prototype.putCanonical.bind(artifactPorts);
    this.#resolve = ledgerArtifactResolver;
    this.#source = projectionSource;
    this.#requestHuman = method(humanDecisionProvider, "request");
    this.#verifyHuman = method(humanDecisionVerifier, "verify");
    this.#now = now;
    this.#review = new SkillPromotionReviewLedgerAdapter({
      descriptor: d,
      artifactPorts: { putCanonical: this.#put },
      ledger: this.#ledger,
      ledgerArtifactResolver,
      decisionVerifier: { verify: method(decisionVerifier, "verify") },
      now,
    });
    const reader = Object.freeze({
      descriptor: d,
      matchesLedger: (value) => value === ledger,
      read: ({ tenantId, projectionDigest }) => {
        if (tenantId !== d.tenantId)
          fail("Workbench projection tenant differs");
        const entry = this.#projection(projectionDigest);
        return capture({
          projection: entry.value,
          artifactRef: entry.event.subjectRef,
          sequence: entry.event.sequence,
          eventDigest: entry.event.eventDigest,
        });
      },
      readReview: (packetDigest) => this.#review.readReview(packetDigest),
    });
    PROJECTION_READERS.add(reader);
    ADAPTER_PROJECTION_READERS.set(this, reader);
    Object.freeze(this);
  }

  createProjectionReader() {
    return ADAPTER_PROJECTION_READERS.get(this);
  }

  #stable(head) {
    if (this.#ledger.verify().headDigest !== head.headDigest)
      fail(
        "Workbench Ledger changed during authentication; retry from durable state",
      );
  }
  #scope(value) {
    if (
      value?.tenantId !== this.descriptor.tenantId ||
      value.runId !== this.descriptor.runId ||
      value.skillName !== this.descriptor.skillName
    )
      fail("Workbench record crossed its tenant/run/Skill scope");
    return value;
  }
  #records() {
    const head = this.#ledger.verify();
    const events = this.#ledger.read();
    if (events.length !== head.sequence)
      fail("Workbench Ledger history is incomplete");
    const eventTypes = new Set(Object.values(TYPES).map(([, type]) => type));
    const selected = events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        eventTypes.has(event.type) &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId,
    );
    if (selected.length > 10_000)
      fail("Workbench review history exceeds its bounded capacity");
    const result = selected.map((event) => {
      const type = Object.values(TYPES).find(
        ([, value]) => value === event.type,
      )[0];
      if (
        event.artifactTenantId !== this.descriptor.artifactTenantId ||
        event.skillName !== this.descriptor.skillName ||
        event.decision !== "committed" ||
        event.reason !== type
      )
        fail("Workbench event durable scope is invalid");
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
        fail("Workbench artifact resolution was substituted");
      const record = capture(JSON.parse(resolved.bytes.toString("utf8")));
      if (
        canonical(record) !== resolved.bytes.toString("utf8") ||
        record.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
        record.tenantId !== this.descriptor.artifactTenantId ||
        record.type !== type ||
        record.audience !== this.descriptor.audience ||
        record.purpose !== this.descriptor.purpose ||
        record.retention !== "ledger"
      )
        fail("Workbench artifact durable binding is invalid");
      const value = this.#scope(record.value);
      const kind = Object.keys(TYPES).find((name) => TYPES[name][0] === type);
      const key =
        kind === "projection"
          ? value.projectionDigest
          : kind === "prepared"
            ? value.request?.requestDigest
            : value.requestDigest;
      if (
        !DIGEST.test(key ?? "") ||
        event.eventId !== `${event.type}.${key.slice(7)}` ||
        event.sourceRefs.length !== (kind === "projection" ? 0 : 2) ||
        (kind === "prepared" &&
          value.schema !== WORKBENCH_REVIEW_PREPARATION_SCHEMA) ||
        (kind === "committed" &&
          value.schema !== WORKBENCH_REVIEW_SETTLEMENT_SCHEMA)
      )
        fail("Workbench event identity or schema is invalid");
      return { event, value };
    });
    this.#stable(head);
    return { head, records: result };
  }
  #find(kind, key, snapshot = this.#records()) {
    if (!DIGEST.test(key ?? "")) fail("Workbench record key is invalid");
    const eventId = `${TYPES[kind][1]}.${key.slice(7)}`;
    const matches = snapshot.records.filter(
      ({ event }) => event.eventId === eventId,
    );
    if (matches.length > 1) fail("Workbench record has duplicate events");
    if (matches[0] && matches[0].event.type !== TYPES[kind][1])
      fail("Workbench event type was substituted");
    return matches[0] ?? null;
  }
  #projection(projectionDigest, snapshot = this.#records()) {
    const entry = this.#find("projection", projectionDigest, snapshot);
    if (
      !entry ||
      entry.value.projectionDigest !== projectionDigest ||
      entry.event.sourceRefs.length !== 0
    )
      fail("Workbench retained source projection is missing or substituted");
    filterEvolutionWorkbenchProjection(entry.value, { limit: 1 });
    return entry;
  }
  #append(kind, key, value, sourceRefs, head) {
    sourceRefs = sortedRefs(sourceRefs);
    const [type, eventType] = TYPES[kind];
    const eventId = `${eventType}.${key.slice(7)}`;
    const check = () => {
      const entry = this.#find(kind, key);
      if (
        !entry ||
        !same(entry.value, value) ||
        !same(entry.event.sourceRefs, sourceRefs)
      )
        fail(
          "Workbench durable record is absent or conflicts with this request",
        );
      return entry;
    };
    this.#stable(head);
    const published = this.#put(type, value, {
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
    });
    if (
      published?.receipt?.persisted !== true ||
      published.receipt.readbackVerified !== true ||
      published.receipt.integrityVerified !== true ||
      published.receipt.retention !== "ledger"
    )
      fail("Workbench record was not durably retained");
    try {
      const receipt = this.#ledger.appendDomainEvent(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "committed",
          eventId,
          reason: type,
          skillName: this.descriptor.skillName,
          sourceRefs,
          subjectRef: published.ref,
          tenantId: this.descriptor.tenantId,
          timestamp: new Date(Number(this.#now())).toISOString(),
          type: eventType,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
      if (
        receipt?.authenticated !== true ||
        receipt.durable !== true ||
        receipt.eventId !== eventId
      )
        fail("Workbench Ledger append was not durable");
    } catch (cause) {
      // A lost acknowledgement is recoverable only from exact authenticated
      // bytes; a failed CAS or conflicting response is never an empty success.
      try {
        return check();
      } catch {
        throw cause;
      }
    }
    return check();
  }

  async loadCurrentProjection() {
    const head = this.#ledger.verify();
    const result = await buildEvolutionWorkbenchProjection(this.#source, {
      observedAt: new Date(Number(this.#now())).toISOString(),
    });
    this.#stable(head);
    return capture(this.#scope(result));
  }
  async retainProjection({ tenantId, projection: input }) {
    if (tenantId !== this.descriptor.tenantId)
      fail("Workbench projection tenant differs");
    const projection = this.#scope(capture(input));
    filterEvolutionWorkbenchProjection(projection, { limit: 1 });
    const snapshot = this.#records();
    const existing = this.#find(
      "projection",
      projection.projectionDigest,
      snapshot,
    );
    if (existing) {
      if (
        !same(
          this.#projection(projection.projectionDigest, snapshot).value,
          projection,
        )
      )
        fail("Workbench retained projection differs");
    } else {
      const rebuilt = await buildEvolutionWorkbenchProjection(this.#source, {
        observedAt: projection.observedAt,
      });
      if (!same(rebuilt, projection))
        fail("Workbench projection differs from its authenticated source");
      this.#stable(snapshot.head);
      this.#append(
        "projection",
        projection.projectionDigest,
        projection,
        [],
        snapshot.head,
      );
    }
    return {
      authenticated: true,
      durable: true,
      projectionDigest: projection.projectionDigest,
    };
  }

  async #context(input) {
    const { plan: rawPlan, request: rawRequest } = capture(input);
    const plan = this.#scope(
      verifyWorkbenchBatchPlan(rawPlan, this.descriptor.tenantId),
    );
    const snapshot = this.#records();
    const projection = this.#projection(plan.sourceProjectionDigest, snapshot);
    verifyWorkbenchBatchPlan(plan, this.descriptor.tenantId, projection.value);
    const review = await this.#review.readReview(rawRequest.packetDigest);
    const request = buildWorkbenchBatchItemRequest(plan, review.packet);
    const candidate = projection.value.candidates.find(
      (entry) => entry.packetDigest === request.packetDigest,
    );
    if (
      !same(request, rawRequest) ||
      candidate?.candidateId !== review.packet.candidateId ||
      candidate?.candidateContentDigest !==
        review.packet.candidateContentDigest ||
      review.packetSequence >= projection.event.sequence
    )
      fail(
        "Workbench review request differs from its retained projection or actual packet",
      );
    this.#stable(snapshot.head);
    return { plan, request, review, projection, snapshot };
  }
  async #state(context) {
    const { plan, request, review, projection, snapshot } = context;
    const prepared = this.#find("prepared", request.requestDigest, snapshot);
    const committed = this.#find("committed", request.requestDigest, snapshot);
    if (!prepared) {
      if (committed) fail("Workbench settlement has no preparation");
      return null;
    }
    const response = prepared.value.response;
    const expected = {
      schema: WORKBENCH_REVIEW_PREPARATION_SCHEMA,
      tenantId: plan.tenantId,
      runId: plan.runId,
      skillName: plan.skillName,
      plan,
      request,
      response,
    };
    if (
      !same(prepared.value, expected) ||
      !same(
        prepared.event.sourceRefs,
        sortedRefs([projection.event.subjectRef, review.packetRef]),
      ) ||
      prepared.event.sequence <= projection.event.sequence
    )
      fail("Workbench preparation binding is invalid");
    if (
      review.decision &&
      (!same(review.decision, response.decision) ||
        review.decisionSequence <= prepared.event.sequence)
    )
      fail("Workbench actual review decision conflicts with its preparation");
    verifyWorkbenchHumanDecisionResponse(
      response,
      request,
      review.packet,
      review.decision
        ? Date.parse(response.decision.decidedAt)
        : Number(this.#now()),
    );
    if ((await this.#verifyHuman({ request, response })) !== true)
      fail("Workbench human decision signature verification failed");
    this.#stable(snapshot.head);
    const item = buildWorkbenchExecutionItem(request, response);
    if (committed) {
      const expectedSettlement = this.#settlement(
        plan,
        request,
        response,
        item,
      );
      if (
        !review.decision ||
        !same(committed.value, expectedSettlement) ||
        committed.event.sequence <= review.decisionSequence ||
        !same(
          committed.event.sourceRefs,
          sortedRefs([prepared.event.subjectRef, review.decisionRef]),
        )
      )
        fail("Workbench settlement has no exact authenticated review effect");
    }
    return capture({
      status: committed
        ? "committed"
        : review.decision
          ? "applied"
          : "prepared",
      response,
      item,
    });
  }
  #settlement(plan, request, response, item) {
    return capture({
      schema: WORKBENCH_REVIEW_SETTLEMENT_SCHEMA,
      tenantId: plan.tenantId,
      runId: plan.runId,
      skillName: plan.skillName,
      planDigest: plan.planDigest,
      requestDigest: request.requestDigest,
      responseDigest: response.responseDigest,
      item,
    });
  }
  async loadExecutionItem(input) {
    return this.#state(await this.#context(input));
  }
  async prepareDecision(input) {
    const { response: rawResponse, ...binding } = capture(input);
    const context = await this.#context(binding);
    const existing = await this.#state(context);
    const { plan, request, review, projection, snapshot } = context;
    if (existing) {
      if (!same(existing.response, rawResponse))
        fail("Workbench human response conflicts with prepared decision");
    } else {
      if (review.decision)
        fail("Workbench packet already has a decision outside this request");
      const response = verifyWorkbenchHumanDecisionResponse(
        rawResponse,
        request,
        review.packet,
        Number(this.#now()),
      );
      if ((await this.#verifyHuman({ request, response })) !== true)
        fail("Workbench human decision signature verification failed");
      this.#stable(snapshot.head);
      this.#append(
        "prepared",
        request.requestDigest,
        capture({
          schema: WORKBENCH_REVIEW_PREPARATION_SCHEMA,
          tenantId: plan.tenantId,
          runId: plan.runId,
          skillName: plan.skillName,
          plan,
          request,
          response,
        }),
        [projection.event.subjectRef, review.packetRef],
        snapshot.head,
      );
    }
    return {
      authenticated: true,
      durable: true,
      responseDigest: rawResponse.responseDigest,
    };
  }
  async retainDecision(input) {
    const data = capture(input);
    const state = await this.loadExecutionItem({
      plan: data.plan,
      request: data.request,
    });
    if (
      !state ||
      !same(state.response, data.response) ||
      !same(state.response.decision, data.decision) ||
      data.packetDigest !== data.request.packetDigest
    )
      fail("Workbench decision has no exact durable preparation");
    if (state.status === "prepared")
      await this.#review.retainDecision({
        packetDigest: data.packetDigest,
        decision: data.decision,
      });
    const readback = await this.loadExecutionItem({
      plan: data.plan,
      request: data.request,
    });
    if (!readback || readback.status === "prepared")
      fail("Workbench actual review effect is missing");
    return { persisted: true, receiptDigest: data.decision.receiptDigest };
  }
  async commitExecutionItem(input) {
    const data = capture(input);
    const context = await this.#context({
      plan: data.plan,
      request: data.request,
    });
    const state = await this.#state(context);
    if (
      !state ||
      state.status === "prepared" ||
      !same(state.response, data.response) ||
      !same(state.item, data.item)
    )
      fail("Workbench execution has no exact authenticated review effect");
    if (state.status !== "committed") {
      const prepared = this.#find(
        "prepared",
        data.request.requestDigest,
        context.snapshot,
      );
      this.#append(
        "committed",
        data.request.requestDigest,
        this.#settlement(data.plan, data.request, data.response, data.item),
        [prepared.event.subjectRef, context.review.decisionRef],
        context.snapshot.head,
      );
    }
    const readback = await this.loadExecutionItem({
      plan: data.plan,
      request: data.request,
    });
    if (readback?.status !== "committed")
      fail("Workbench settlement readback is missing");
    return {
      authenticated: true,
      durable: true,
      itemDigest: readback.item.itemDigest,
    };
  }
  createExecutor() {
    return new EvolutionWorkbenchBatchExecutor({
      tenantId: this.descriptor.tenantId,
      now: this.#now,
      ports: {
        loadProjection: async ({ tenantId, projectionDigest }) => {
          if (tenantId !== this.descriptor.tenantId)
            fail("Workbench projection tenant differs");
          return this.#projection(projectionDigest).value;
        },
        resolvePacket: async ({ tenantId, packetDigest }) => {
          if (tenantId !== this.descriptor.tenantId)
            fail("Workbench packet tenant differs");
          return (await this.#review.readReview(packetDigest)).packet;
        },
        requestHumanDecision: this.#requestHuman,
        verifyHumanDecision: this.#verifyHuman,
        loadExecutionItem: this.loadExecutionItem.bind(this),
        prepareDecision: this.prepareDecision.bind(this),
        retainDecision: this.retainDecision.bind(this),
        commitExecutionItem: this.commitExecutionItem.bind(this),
      },
    });
  }
  async resume() {
    const snapshot = this.#records();
    const plans = new Map();
    for (const { event, value } of snapshot.records)
      if (
        event.type === TYPES.committed[1] &&
        !this.#find("prepared", value.requestDigest, snapshot)
      )
        fail("Workbench settlement has no preparation");
    for (const { event, value } of snapshot.records)
      if (event.type === TYPES.prepared[1]) {
        const plan = this.#scope(
          verifyWorkbenchBatchPlan(value.plan, this.descriptor.tenantId),
        );
        const context = await this.#context({ plan, request: value.request });
        const state = await this.#state(context);
        if (!state) fail("Workbench recovery preparation is missing");
        plans.set(plan.planDigest, plan);
      }
    this.#stable(snapshot.head);
    const result = [];
    const executor = this.createExecutor();
    for (const plan of plans.values()) {
      let incomplete = false;
      for (const packetDigest of plan.packetDigests) {
        const { packet } = await this.#review.readReview(packetDigest);
        const request = buildWorkbenchBatchItemRequest(plan, packet);
        const state = await this.loadExecutionItem({ plan, request });
        if (state?.status !== "committed") incomplete = true;
      }
      if (incomplete) result.push(await executor.execute(plan));
    }
    return Object.freeze(result);
  }
}

// Deployment assembly: Run and Review readers cannot be replaced with caller
// summaries. Transition/outcome/Pilot authorities still belong to deployment;
// this supplies the real review leg, not identity or Registry rollback powers.
export function createEvolutionWorkbenchReviewRuntime(options = {}) {
  const {
    descriptor,
    ledger,
    artifactPorts,
    ledgerArtifactResolver,
    decisionVerifier,
    transitionAdapter,
    invocationReceiptSource = null,
    pilotSource = null,
    now = Date.now,
  } = options;
  const fixedLedger = Object.freeze({
    read: () =>
      EvolutionLedger.prototype.read.call(ledger, {
        limit: EVOLUTION_LEDGER_MAX_EVENTS,
      }),
    verify: EvolutionLedger.prototype.verify.bind(ledger),
    appendDomainEvent: EvolutionLedger.prototype.appendDomainEvent.bind(ledger),
  });
  const shared = {
    descriptor,
    ledger: fixedLedger,
    artifactPorts: {
      putCanonical:
        EvolutionArtifactPorts.prototype.putCanonical.bind(artifactPorts),
    },
    ledgerArtifactResolver,
    now,
  };
  const runAdapter = new EvolutionRunLedgerAdapter(shared);
  const reviewAdapter = new SkillPromotionReviewLedgerAdapter({
    ...shared,
    decisionVerifier: { verify: method(decisionVerifier, "verify") },
  });
  const projectionSource = createEvolutionWorkbenchDataSource({
    tenantId: descriptor.tenantId,
    runId: descriptor.runId,
    skillName: descriptor.skillName,
    runAdapter,
    reviewAdapter,
    transitionAdapter,
    invocationReceiptSource,
    pilotSource,
  });
  const adapter = new EvolutionWorkbenchReviewLedgerAdapter({
    ...options,
    projectionSource,
  });
  return Object.freeze({
    projectionLoader: Object.freeze({
      load: adapter.loadCurrentProjection.bind(adapter),
    }),
    projectionAuthority: Object.freeze({
      retain: adapter.retainProjection.bind(adapter),
    }),
    batchExecutor: adapter.createExecutor(),
    projectionReader: adapter.createProjectionReader(),
    resume: adapter.resume.bind(adapter),
  });
}
