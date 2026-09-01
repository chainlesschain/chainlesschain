import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  SKILL_MUTATION_AUDIT_FAILED_CODE,
  SKILL_MUTATION_CAPABILITY_CONTEXT_MISMATCH_CODE,
  SKILL_MUTATION_CAPABILITY_EXPIRED_CODE,
  SKILL_MUTATION_CAPABILITY_INVALID_CODE,
  SKILL_MUTATION_CAPABILITY_REPLAYED_CODE,
  SKILL_MUTATION_NONCE_REUSED_CODE,
  SKILL_MUTATION_NONCE_ACK_SCHEMA,
  SKILL_MUTATION_NONCE_STORE_FAILED_CODE,
  SKILL_MUTATION_OPERATIONS,
  SKILL_MUTATION_PRINCIPAL_INVALID_CODE,
  SKILL_MUTATION_PRINCIPAL_SCHEMA,
  SKILL_MUTATION_RECEIPT_BINDING_SCHEMA,
  SKILL_MUTATION_RECEIPT_INVALID_CODE,
  SKILL_MUTATION_RECEIPT_KINDS,
  SKILL_MUTATION_RECEIPT_VERIFICATION_SCHEMA,
  SKILL_MUTATION_REQUEST_EXPIRED_CODE,
  SKILL_MUTATION_REQUEST_INVALID_CODE,
  SKILL_MUTATION_ROLES,
  SKILL_MUTATION_SCOPE_DENIED_CODE,
  SKILL_MUTATION_TARGET_SCOPES,
  SkillMutationAuthority,
  buildSkillMutationConsumeContext,
  buildSkillMutationRequest,
  digestSkillMutationDependencyLock,
  digestSkillMutationReceiptEnvelope,
  digestSkillMutationTransitionSubject,
  verifySkillMutationAuditEvent,
  verifySkillMutationConsumptionReceipt,
  verifySkillMutationNonceClaim,
  verifySkillMutationRequest,
} from "../../src/lib/evolution/skill-mutation-authority.js";

const NOW = "2026-09-01T12:00:00.000Z";
const EXPIRES_AT = "2026-09-01T12:04:00.000Z";
const TARGET_DIGEST = `sha256:${"6".repeat(64)}`;
const CANDIDATE_ID = `sha256:${"7".repeat(64)}`;
const ROLLBACK_RELEASE_DIGEST = `sha256:${"8".repeat(64)}`;
const DEPENDENCY_LOCK_DIGEST = digestSkillMutationDependencyLock({
  packages: { vitest: "4.1.10" },
});
const HEAD_DIGEST = `sha256:${"a".repeat(64)}`;

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function redigestAudit(event, overrides) {
  const core = { ...event, ...overrides };
  delete core.auditDigest;
  return {
    ...core,
    auditDigest: `sha256:${createHash("sha256")
      .update(
        `chainlesschain.skill-mutation-audit/v3\0${canonicalJson(core)}`,
        "utf8",
      )
      .digest("hex")}`,
  };
}

function receiptEnvelopes(targetScope, overrides = {}) {
  const active = targetScope === SKILL_MUTATION_TARGET_SCOPES.ACTIVE;
  return {
    candidateReceipt: active ? "signed:candidate:receipt-1" : null,
    evalReceipt: active ? "signed:eval:receipt-1" : null,
    policyReceipt: active ? "signed:policy:receipt-1" : null,
    actorReceipt: "signed:actor:receipt-1",
    parentReceipt: active ? "signed:parent:receipt-1" : null,
    targetReceipt: "signed:target:receipt-1",
    ...overrides,
  };
}

function request(
  targetScope = SKILL_MUTATION_TARGET_SCOPES.ACTIVE,
  overrides = {},
) {
  const input = {
    tenantId: "tenant:alpha",
    audience: "desktop:main",
    operationId: "operation:promote-1",
    operation:
      targetScope === SKILL_MUTATION_TARGET_SCOPES.ACTIVE
        ? SKILL_MUTATION_OPERATIONS.PROMOTE
        : SKILL_MUTATION_OPERATIONS.CREATE_CANDIDATE,
    skillName: "repair-unit-tests",
    targetScope,
    expectedTargetDigest: TARGET_DIGEST,
    expectedTargetRevision: 7,
    expiresAt: EXPIRES_AT,
    nonce: "nonce_authority_0001",
    receipts: receiptEnvelopes(targetScope),
    ...overrides,
  };
  input.transitionSubjectDigest ??= digestSkillMutationTransitionSubject({
    tenantId: input.tenantId,
    skillName: input.skillName,
    operation: input.operation,
    candidateId:
      input.operation === SKILL_MUTATION_OPERATIONS.ROLLBACK
        ? null
        : CANDIDATE_ID,
    rollbackTargetReleaseDigest:
      input.operation === SKILL_MUTATION_OPERATIONS.ROLLBACK
        ? ROLLBACK_RELEASE_DIGEST
        : null,
    dependencyLockDigest:
      input.operation === SKILL_MUTATION_OPERATIONS.CREATE_CANDIDATE
        ? null
        : DEPENDENCY_LOCK_DIGEST,
    expectedActiveContentDigest: input.expectedTargetDigest,
    expectedActiveRevision: input.expectedTargetRevision,
  });
  return buildSkillMutationRequest(input);
}

function consumeContext(mutationRequest, overrides = {}) {
  return buildSkillMutationConsumeContext({
    tenantId: mutationRequest.tenantId,
    audience: mutationRequest.audience,
    operationId: mutationRequest.operationId,
    operation: mutationRequest.operation,
    transitionSubjectDigest: mutationRequest.transitionSubjectDigest,
    skillName: mutationRequest.skillName,
    targetScope: mutationRequest.targetScope,
    expectedTargetDigest: mutationRequest.expectedTargetDigest,
    expectedTargetRevision: mutationRequest.expectedTargetRevision,
    expiresAt: mutationRequest.expiresAt,
    nonce: mutationRequest.nonce,
    ...overrides,
  });
}

function principalResolver(role, overrides = {}) {
  return {
    resolve: vi.fn(async ({ request: context }) => ({
      schema: SKILL_MUTATION_PRINCIPAL_SCHEMA,
      authenticated: true,
      principalId: "principal:controller-1",
      role,
      tenantId: context.tenantId,
      audience: context.audience,
      operationId: context.operationId,
      operation: context.operation,
      transitionSubjectDigest: context.transitionSubjectDigest,
      requestDigest: context.requestDigest,
      expiresAt: context.expiresAt,
      ...overrides,
    })),
  };
}

function receiptVerifier(overrides = {}) {
  return {
    verify: vi.fn(async ({ receipts, request: context, principal }) => {
      if (
        Object.values(receipts).some(
          (envelope) =>
            typeof envelope === "string" && envelope.startsWith("forged:"),
        )
      ) {
        throw new Error("signature verification failed");
      }
      const bindings = {};
      for (const kind of SKILL_MUTATION_RECEIPT_KINDS) {
        const envelope = receipts[`${kind}Receipt`];
        bindings[kind] =
          envelope === null
            ? null
            : {
                schema: SKILL_MUTATION_RECEIPT_BINDING_SCHEMA,
                kind,
                receiptDigest: digestSkillMutationReceiptEnvelope(envelope),
                principalId: principal.principalId,
                role: principal.role,
                ...context,
              };
      }
      const result = {
        schema: SKILL_MUTATION_RECEIPT_VERIFICATION_SCHEMA,
        verified: true,
        bindings,
      };
      return typeof overrides.mutate === "function"
        ? overrides.mutate(result)
        : { ...result, ...overrides };
    }),
  };
}

function durableAuditSink(events, acknowledgement = null) {
  let sequence = 0;
  return {
    append: vi.fn(async (event) => {
      events.push(event);
      sequence += 1;
      if (typeof acknowledgement === "function") {
        return acknowledgement(event, sequence);
      }
      if (acknowledgement !== null) return acknowledgement;
      return {
        persisted: true,
        auditDigest: event.auditDigest,
        headDigest: HEAD_DIGEST,
        sequence,
      };
    }),
  };
}

function durableNonceStore({
  claims = new Map(),
  acknowledgement = null,
} = {}) {
  let sequence = 0;
  return {
    claims,
    claim: vi.fn(async (event) => {
      const verified = verifySkillMutationNonceClaim(event);
      const key = `${verified.tenantId}\0${verified.audience}\0${verified.nonce}`;
      const claimed = !claims.has(key);
      if (claimed) claims.set(key, verified);
      sequence += 1;
      if (typeof acknowledgement === "function") {
        return acknowledgement(verified, sequence, claimed);
      }
      if (acknowledgement !== null) return acknowledgement;
      return {
        schema: SKILL_MUTATION_NONCE_ACK_SCHEMA,
        persisted: true,
        claimed,
        claimDigest: verified.claimDigest,
        expiresAt: verified.expiresAt,
        headDigest: HEAD_DIGEST,
        sequence,
      };
    }),
  };
}

function harness({
  role = SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER,
  principal = principalResolver(role),
  verifier = receiptVerifier(),
  acknowledgement = null,
  nonceStore = durableNonceStore(),
  initialNow = NOW,
} = {}) {
  const events = [];
  let currentTime = initialNow;
  const auditSink = durableAuditSink(events, acknowledgement);
  const authority = new SkillMutationAuthority({
    principalResolver: principal,
    receiptVerifier: verifier,
    auditSink,
    nonceStore,
    now: () => new Date(currentTime),
  });
  return {
    authority,
    auditSink,
    events,
    principal,
    verifier,
    nonceStore,
    setNow(value) {
      currentTime = value;
    },
  };
}

describe("SkillMutationAuthority", () => {
  it("requires all four trusted ports", () => {
    expect(() => new SkillMutationAuthority()).toThrow(/principalResolver/u);
    expect(
      () =>
        new SkillMutationAuthority({
          principalResolver: principalResolver("candidate-writer"),
        }),
    ).toThrow(/receiptVerifier/u);
    expect(
      () =>
        new SkillMutationAuthority({
          principalResolver: principalResolver("candidate-writer"),
          receiptVerifier: receiptVerifier(),
        }),
    ).toThrow(/auditSink/u);
    expect(
      () =>
        new SkillMutationAuthority({
          principalResolver: principalResolver("candidate-writer"),
          receiptVerifier: receiptVerifier(),
          auditSink: durableAuditSink([]),
        }),
    ).toThrow(/nonceStore/u);
  });

  it("builds a strict, canonical request bound to tenant, audience, operation, CAS, expiry, and nonce", () => {
    const first = request();
    const second = buildSkillMutationRequest({
      receipts: Object.fromEntries(Object.entries(first.receipts).reverse()),
      nonce: first.nonce,
      expiresAt: first.expiresAt,
      expectedTargetRevision: first.expectedTargetRevision,
      expectedTargetDigest: first.expectedTargetDigest,
      targetScope: first.targetScope,
      skillName: first.skillName,
      transitionSubjectDigest: first.transitionSubjectDigest,
      operation: first.operation,
      operationId: first.operationId,
      audience: first.audience,
      tenantId: first.tenantId,
    });

    expect(second.requestDigest).toBe(first.requestDigest);
    expect(verifySkillMutationRequest(first)).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.receipts)).toBe(true);
    expect(() =>
      buildSkillMutationRequest({
        ...Object.fromEntries(
          Object.entries(first).filter(
            ([key]) => !["schema", "requestDigest"].includes(key),
          ),
        ),
        role: SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER,
      }),
    ).toThrow(/exactly the supported fields/u);
  });

  it("canonically binds the exact transition subject and rejects ambiguous target unions", () => {
    const firstLock = digestSkillMutationDependencyLock({
      packages: { vitest: "4.1.10", zod: "4.0.0" },
      generation: 2,
    });
    const reorderedLock = digestSkillMutationDependencyLock({
      generation: 2,
      packages: { zod: "4.0.0", vitest: "4.1.10" },
    });
    const subject = {
      tenantId: "tenant:alpha",
      skillName: "repair-unit-tests",
      operation: SKILL_MUTATION_OPERATIONS.PROMOTE,
      candidateId: CANDIDATE_ID,
      rollbackTargetReleaseDigest: null,
      dependencyLockDigest: firstLock,
      expectedActiveContentDigest: TARGET_DIGEST,
      expectedActiveRevision: 7,
    };

    expect(reorderedLock).toBe(firstLock);
    expect(
      digestSkillMutationTransitionSubject({
        expectedActiveRevision: 7,
        dependencyLockDigest: reorderedLock,
        rollbackTargetReleaseDigest: null,
        candidateId: CANDIDATE_ID,
        operation: SKILL_MUTATION_OPERATIONS.PROMOTE,
        expectedActiveContentDigest: TARGET_DIGEST,
        skillName: "repair-unit-tests",
        tenantId: "tenant:alpha",
      }),
    ).toBe(digestSkillMutationTransitionSubject(subject));
    expect(
      digestSkillMutationTransitionSubject({
        ...subject,
        candidateId: `sha256:${"9".repeat(64)}`,
      }),
    ).not.toBe(digestSkillMutationTransitionSubject(subject));
    const prototypeNamedLock = {};
    Object.defineProperty(prototypeNamedLock, "__proto__", {
      value: { pinned: "1.0.0" },
      enumerable: true,
    });
    expect(digestSkillMutationDependencyLock(prototypeNamedLock)).not.toBe(
      digestSkillMutationDependencyLock({}),
    );
    expect(() =>
      digestSkillMutationTransitionSubject({
        ...subject,
        rollbackTargetReleaseDigest: ROLLBACK_RELEASE_DIGEST,
      }),
    ).toThrow(/incompatible/u);
  });

  it("returns an opaque, instance-owned capability and consumes it once", async () => {
    const mutationRequest = request();
    const { authority, events, verifier } = harness();

    const capability = await authority.authorize(mutationRequest);

    expect(Object.keys(capability)).toEqual([]);
    expect(Object.getPrototypeOf(capability)).toBeNull();
    expect(Object.isFrozen(capability)).toBe(true);
    expect(capability.schema).toBeUndefined();
    const consumptionReceipt = await authority.consume(
      capability,
      consumeContext(mutationRequest),
    );
    expect(verifySkillMutationConsumptionReceipt(consumptionReceipt)).toEqual(
      consumptionReceipt,
    );
    expect(consumptionReceipt).toMatchObject({
      consumed: true,
      operation: SKILL_MUTATION_OPERATIONS.PROMOTE,
      transitionSubjectDigest: mutationRequest.transitionSubjectDigest,
      requestDigest: mutationRequest.requestDigest,
      auditDigest: events.at(-1).auditDigest,
    });
    expect(verifier.verify).toHaveBeenCalledOnce();
    expect(
      events.map(({ phase, decision, code }) => ({ phase, decision, code })),
    ).toEqual([
      {
        phase: "authorize",
        decision: "allow",
        code: "CC_SKILL_MUTATION_AUTHORIZED",
      },
      {
        phase: "consume",
        decision: "allow",
        code: "CC_SKILL_MUTATION_CONSUMED",
      },
    ]);
    for (const event of events) {
      expect(Object.isFrozen(event)).toBe(true);
      expect(verifySkillMutationAuditEvent(event)).toEqual(event);
    }
    expect(() =>
      verifySkillMutationAuditEvent(
        redigestAudit(events[0], { phase: "consume" }),
      ),
    ).toThrow(/invalid/u);
    expect(() =>
      verifySkillMutationAuditEvent(
        redigestAudit(events[0], { tenantId: null }),
      ),
    ).toThrow(/complete authorized context/u);
    expect(() =>
      verifySkillMutationConsumptionReceipt({
        ...consumptionReceipt,
        sequence: consumptionReceipt.sequence + 1,
      }),
    ).toThrow(/invalid/u);
  });

  it.each([
    SKILL_MUTATION_ROLES.CANDIDATE_WRITER,
    SKILL_MUTATION_ROLES.PROPOSER,
    SKILL_MUTATION_ROLES.LEARNING,
    SKILL_MUTATION_ROLES.SYNC,
    SKILL_MUTATION_ROLES.MANUAL_IMPORT,
  ])("allows trusted role %s only into candidate scope", async (role) => {
    const { authority, events } = harness({ role });
    const mutationRequest = request(SKILL_MUTATION_TARGET_SCOPES.CANDIDATE);

    const capability = await authority.authorize(mutationRequest);
    await expect(
      authority.consume(capability, consumeContext(mutationRequest)),
    ).resolves.toMatchObject({ consumed: true });
    expect(events[0]).toMatchObject({ role, targetScope: "candidate" });
  });

  it.each([
    SKILL_MUTATION_ROLES.CANDIDATE_WRITER,
    SKILL_MUTATION_ROLES.PROPOSER,
    SKILL_MUTATION_ROLES.LEARNING,
    SKILL_MUTATION_ROLES.SYNC,
    SKILL_MUTATION_ROLES.MANUAL_IMPORT,
  ])("denies active scope to trusted non-controller role %s", async (role) => {
    const { authority, events, verifier } = harness({ role });

    await expect(authority.authorize(request())).rejects.toMatchObject({
      code: SKILL_MUTATION_SCOPE_DENIED_CODE,
      role,
      targetScope: "active",
    });
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({
      decision: "deny",
      code: SKILL_MUTATION_SCOPE_DENIED_CODE,
      role,
    });
  });

  it("does not honor a caller self-reporting promotion-controller", async () => {
    const mutationRequest = { ...request(), role: "promotion-controller" };
    const { authority, principal, events } = harness({
      role: SKILL_MUTATION_ROLES.PROPOSER,
    });

    await expect(authority.authorize(mutationRequest)).rejects.toMatchObject({
      code: SKILL_MUTATION_REQUEST_INVALID_CODE,
    });
    expect(principal.resolve).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({ decision: "deny", role: null });
  });

  it("captures trusted ports privately so callers cannot swap in a stronger role", async () => {
    const principal = principalResolver(SKILL_MUTATION_ROLES.PROPOSER);
    const verifier = receiptVerifier();
    const events = [];
    const auditSink = durableAuditSink(events);
    const nonceStore = durableNonceStore();
    const authority = new SkillMutationAuthority({
      principalResolver: principal,
      receiptVerifier: verifier,
      auditSink,
      nonceStore,
      now: () => new Date(NOW),
    });
    principal.resolve = principalResolver(
      SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER,
    ).resolve;
    verifier.verify = vi.fn(async () => ({ verified: true }));
    auditSink.append = vi.fn(async () => true);
    nonceStore.claim = vi.fn(async () => true);

    expect(Object.isFrozen(authority)).toBe(true);
    expect(authority._audit).toBeUndefined();
    expect(authority._appendAudit).toBeUndefined();
    expect(authority._clock).toBeUndefined();
    await expect(authority.authorize(request())).rejects.toMatchObject({
      code: SKILL_MUTATION_SCOPE_DENIED_CODE,
      role: SKILL_MUTATION_ROLES.PROPOSER,
    });
    expect(events).toHaveLength(1);
  });

  it("rejects an unauthenticated or cross-tenant principal resolution", async () => {
    const unauthenticated = harness({
      principal: principalResolver(SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER, {
        authenticated: false,
      }),
    });
    const crossTenant = harness({
      principal: principalResolver(SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER, {
        tenantId: "tenant:other",
      }),
    });
    const wrongSubject = harness({
      principal: principalResolver(SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER, {
        transitionSubjectDigest: `sha256:${"c".repeat(64)}`,
      }),
    });

    await expect(
      unauthenticated.authority.authorize(request()),
    ).rejects.toMatchObject({ code: SKILL_MUTATION_PRINCIPAL_INVALID_CODE });
    await expect(
      crossTenant.authority.authorize(request()),
    ).rejects.toMatchObject({ code: SKILL_MUTATION_PRINCIPAL_INVALID_CODE });
    await expect(
      wrongSubject.authority.authorize(request()),
    ).rejects.toMatchObject({ code: SKILL_MUTATION_PRINCIPAL_INVALID_CODE });
  });

  it("rejects forged receipts and verifier claims not bound to request context", async () => {
    const forgedRequest = request(SKILL_MUTATION_TARGET_SCOPES.ACTIVE, {
      receipts: receiptEnvelopes(SKILL_MUTATION_TARGET_SCOPES.ACTIVE, {
        evalReceipt: "forged:eval:receipt-1",
      }),
    });
    const forged = harness();
    const misbound = harness({
      verifier: receiptVerifier({
        mutate(result) {
          return {
            ...result,
            bindings: {
              ...result.bindings,
              target: {
                ...result.bindings.target,
                expectedTargetRevision: 999,
              },
            },
          };
        },
      }),
    });
    const wrongActorRole = harness({
      verifier: receiptVerifier({
        mutate(result) {
          return {
            ...result,
            bindings: {
              ...result.bindings,
              actor: {
                ...result.bindings.actor,
                role: SKILL_MUTATION_ROLES.PROPOSER,
              },
            },
          };
        },
      }),
    });

    await expect(
      forged.authority.authorize(forgedRequest),
    ).rejects.toMatchObject({ code: SKILL_MUTATION_RECEIPT_INVALID_CODE });
    await expect(misbound.authority.authorize(request())).rejects.toMatchObject(
      { code: SKILL_MUTATION_RECEIPT_INVALID_CODE },
    );
    await expect(
      wrongActorRole.authority.authorize(request()),
    ).rejects.toMatchObject({ code: SKILL_MUTATION_RECEIPT_INVALID_CODE });
    expect(forged.events[0].decision).toBe("deny");
    expect(misbound.events[0].decision).toBe("deny");
    expect(wrongActorRole.events[0].decision).toBe("deny");
  });

  it("rejects hand-crafted and cross-instance capabilities", async () => {
    const mutationRequest = request();
    const first = harness();
    const second = harness();
    const capability = await first.authority.authorize(mutationRequest);
    const context = consumeContext(mutationRequest);

    await expect(
      first.authority.consume(Object.freeze(Object.create(null)), context),
    ).rejects.toMatchObject({
      code: SKILL_MUTATION_CAPABILITY_INVALID_CODE,
    });
    await expect(
      second.authority.consume(capability, context),
    ).rejects.toMatchObject({
      code: SKILL_MUTATION_CAPABILITY_INVALID_CODE,
    });
    await expect(
      first.authority.consume(capability, context),
    ).resolves.toMatchObject({ consumed: true });
  });

  it.each([
    ["tenant", { tenantId: "tenant:other" }],
    ["audience", { audience: "worker:other" }],
    ["operation id", { operationId: "operation:other" }],
    ["operation", { operation: SKILL_MUTATION_OPERATIONS.ROLLBACK }],
    [
      "transition subject",
      { transitionSubjectDigest: `sha256:${"b".repeat(64)}` },
    ],
    ["skill", { skillName: "other-skill" }],
    ["target digest", { expectedTargetDigest: `sha256:${"f".repeat(64)}` }],
    ["target revision", { expectedTargetRevision: 8 }],
    ["expiry", { expiresAt: "2026-09-01T12:03:00.000Z" }],
    ["nonce", { nonce: "nonce_authority_other" }],
  ])("rejects cross-context capability use: %s", async (_label, override) => {
    const mutationRequest = request();
    const { authority, events } = harness();
    const capability = await authority.authorize(mutationRequest);

    await expect(
      authority.consume(capability, consumeContext(mutationRequest, override)),
    ).rejects.toMatchObject({
      code: SKILL_MUTATION_CAPABILITY_CONTEXT_MISMATCH_CODE,
    });
    expect(events.at(-1)).toMatchObject({
      phase: "consume",
      decision: "deny",
      code: SKILL_MUTATION_CAPABILITY_CONTEXT_MISMATCH_CODE,
    });
    await expect(
      authority.consume(capability, consumeContext(mutationRequest)),
    ).resolves.toMatchObject({ consumed: true });
  });

  it("rejects expired requests and capabilities", async () => {
    const alreadyExpired = harness({ initialNow: EXPIRES_AT });
    await expect(
      alreadyExpired.authority.authorize(request()),
    ).rejects.toMatchObject({ code: SKILL_MUTATION_REQUEST_EXPIRED_CODE });

    const mutationRequest = request();
    const issued = harness();
    const capability = await issued.authority.authorize(mutationRequest);
    issued.setNow("2026-09-01T12:05:00.000Z");
    await expect(
      issued.authority.consume(capability, consumeContext(mutationRequest)),
    ).rejects.toMatchObject({ code: SKILL_MUTATION_CAPABILITY_EXPIRED_CODE });
  });

  it("burns a capability when durable consume audit crosses its expiry", async () => {
    let currentTime = NOW;
    let sequence = 0;
    const events = [];
    const auditSink = {
      append: vi.fn(async (event) => {
        events.push(event);
        sequence += 1;
        if (event.phase === "consume" && event.decision === "allow") {
          currentTime = EXPIRES_AT;
        }
        return {
          persisted: true,
          auditDigest: event.auditDigest,
          headDigest: HEAD_DIGEST,
          sequence,
        };
      }),
    };
    const authority = new SkillMutationAuthority({
      principalResolver: principalResolver(
        SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER,
      ),
      receiptVerifier: receiptVerifier(),
      auditSink,
      nonceStore: durableNonceStore(),
      now: () => new Date(currentTime),
    });
    const mutationRequest = request();
    const capability = await authority.authorize(mutationRequest);
    const context = consumeContext(mutationRequest);

    await expect(authority.consume(capability, context)).rejects.toMatchObject({
      code: SKILL_MUTATION_CAPABILITY_EXPIRED_CODE,
    });
    expect(events.slice(-2)).toMatchObject([
      { phase: "consume", decision: "allow" },
      {
        phase: "consume",
        decision: "deny",
        code: SKILL_MUTATION_CAPABILITY_EXPIRED_CODE,
      },
    ]);
    await expect(authority.consume(capability, context)).rejects.toMatchObject({
      code: SKILL_MUTATION_CAPABILITY_REPLAYED_CODE,
    });
  });

  it("rejects capability replay and duplicate authorization nonce", async () => {
    const mutationRequest = request();
    const { authority } = harness();
    const capability = await authority.authorize(mutationRequest);
    const context = consumeContext(mutationRequest);

    await expect(authority.consume(capability, context)).resolves.toMatchObject(
      { consumed: true },
    );
    await expect(authority.consume(capability, context)).rejects.toMatchObject({
      code: SKILL_MUTATION_CAPABILITY_REPLAYED_CODE,
    });
    await expect(authority.authorize(mutationRequest)).rejects.toMatchObject({
      code: SKILL_MUTATION_NONCE_REUSED_CODE,
    });
  });

  it("rejects nonce replay across authority instances through a durable claim store", async () => {
    const nonceStore = durableNonceStore();
    const first = harness({ nonceStore });
    const second = harness({ nonceStore });

    await expect(first.authority.authorize(request())).resolves.toBeDefined();
    await expect(second.authority.authorize(request())).rejects.toMatchObject({
      code: SKILL_MUTATION_NONCE_REUSED_CODE,
    });
    expect(nonceStore.claim).toHaveBeenCalledTimes(2);
    expect(nonceStore.claims).toHaveProperty("size", 1);
  });

  it("allows exactly one of two concurrent authorizations to claim a nonce", async () => {
    const nonceStore = durableNonceStore();
    const first = harness({ nonceStore });
    const second = harness({ nonceStore });

    const results = await Promise.allSettled([
      first.authority.authorize(request()),
      second.authority.authorize(request()),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected.reason).toMatchObject({
      code: SKILL_MUTATION_NONCE_REUSED_CODE,
    });
    expect(nonceStore.claims.size).toBe(1);
  });

  it("fails closed when durable nonce ownership is ambiguous", async () => {
    const nonceStore = durableNonceStore({
      acknowledgement: () => undefined,
    });
    const { authority, events } = harness({ nonceStore });

    await expect(authority.authorize(request())).rejects.toMatchObject({
      code: SKILL_MUTATION_NONCE_STORE_FAILED_CODE,
    });
    expect(events.at(-1)).toMatchObject({
      phase: "authorize",
      decision: "deny",
      code: SKILL_MUTATION_NONCE_STORE_FAILED_CODE,
    });
  });

  it.each([
    ["undefined", () => undefined],
    ["boolean", () => true],
    [
      "missing head",
      (event, sequence) => ({
        persisted: true,
        auditDigest: event.auditDigest,
        sequence,
      }),
    ],
    [
      "extra field",
      (event, sequence) => ({
        persisted: true,
        auditDigest: event.auditDigest,
        headDigest: HEAD_DIGEST,
        sequence,
        ambiguous: true,
      }),
    ],
    [
      "wrong event digest",
      (_event, sequence) => ({
        persisted: true,
        auditDigest: `sha256:${"b".repeat(64)}`,
        headDigest: HEAD_DIGEST,
        sequence,
      }),
    ],
  ])(
    "fails closed for an ambiguous durable audit acknowledgement: %s",
    async (_label, acknowledgement) => {
      const { authority } = harness({ acknowledgement });

      await expect(authority.authorize(request())).rejects.toMatchObject({
        code: SKILL_MUTATION_AUDIT_FAILED_CODE,
      });
    },
  );

  it("burns a capability when its consumption audit is ambiguous", async () => {
    let calls = 0;
    const acknowledgement = (event, sequence) => {
      calls += 1;
      if (calls > 1) return undefined;
      return {
        persisted: true,
        auditDigest: event.auditDigest,
        headDigest: HEAD_DIGEST,
        sequence,
      };
    };
    const mutationRequest = request();
    const { authority } = harness({ acknowledgement });
    const capability = await authority.authorize(mutationRequest);
    const context = consumeContext(mutationRequest);

    await expect(authority.consume(capability, context)).rejects.toMatchObject({
      code: SKILL_MUTATION_AUDIT_FAILED_CODE,
    });
    await expect(authority.consume(capability, context)).rejects.toMatchObject({
      code: SKILL_MUTATION_AUDIT_FAILED_CODE,
    });
  });
});
