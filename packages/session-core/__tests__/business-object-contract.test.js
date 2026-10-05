import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import contracts from "../lib/business-object-contract.js";

const {
  BUSINESS_OBJECT_TYPES,
  BUSINESS_OBJECT_SCHEMA,
  digestBusinessObjectContent: digest,
  createBusinessObjectRef: ref,
  validateBusinessObjectRef: validateRef,
  createBusinessActionRequest: action,
  validateBusinessActionRequest: validateAction,
  assertBusinessActionReplay: replay,
  createBusinessActionRun: run,
  validateBusinessActionRun: validateRun,
} = contracts;
const require = createRequire(import.meta.url);
const copy = (value) => JSON.parse(JSON.stringify(value));
const target = (overrides = {}) =>
  ref({
    type: "Task",
    id: "task-1",
    sourceKind: "desktop.project-task",
    scope: { kind: "organization", id: "org-a" },
    version: 3,
    ...overrides,
  });
const request = (overrides = {}) =>
  action({
    actionType: "task.assign",
    actionVersion: 1,
    target: target(),
    expectedVersion: 3,
    input: { assigneeDid: "did:key:worker-1" },
    idempotencyKey: "request-1",
    ...overrides,
  });
const evidence = (id) => ({ id, digest: digest({ id }) });
const result = (overrides = {}) =>
  run({
    id: "run-1",
    request: request(),
    status: "succeeded",
    afterVersion: 4,
    startedAt: "2026-10-06T01:00:00.000Z",
    completedAt: "2026-10-06T01:00:01.000Z",
    executionRef: evidence("execution-1"),
    evidenceRefs: [evidence("readback-1")],
    ...overrides,
  });

describe("business content versions and object references", () => {
  it("is available from the package root and public subpath", () => {
    const exported = require("@chainlesschain/session-core/business-object-contract");
    expect(
      require("@chainlesschain/session-core").createBusinessObjectRef,
    ).toBe(exported.createBusinessObjectRef);
    expect(exported.validateBusinessObjectRef(copy(target()))).toEqual(
      target(),
    );
  });

  it.each(BUSINESS_OBJECT_TYPES)(
    "accepts a %s reference with explicit scope and source",
    (type) => {
      const value = target({ type });
      expect(value.schema).toBe(BUSINESS_OBJECT_SCHEMA);
      expect(validateRef(copy(value))).toEqual(value);
      expect(Object.isFrozen(value.scope)).toBe(true);
    },
  );

  it("uses canonical content versions and preserves meaningful ordered arrays", () => {
    expect(digest({ b: { d: 2, c: 1 }, a: [true, null] })).toBe(
      digest({ a: [true, null], b: { c: 1, d: 2 } }),
    );
    expect(digest([1, 2])).not.toBe(digest([2, 1]));
    expect(target({ version: digest({ title: "revised" }) }).version).toMatch(
      /^sha256:/,
    );
  });

  it.each([
    undefined,
    NaN,
    Infinity,
    1n,
    () => {},
    new Date(),
    new Map(),
    [undefined],
    [, 1],
  ])("rejects non-JSON content %#", (value) =>
    expect(() => digest(value)).toThrow(),
  );

  it("rejects accessors, proxies, cycles, hidden fields and executable serializers without invoking them", () => {
    const getter = vi.fn(() => "private");
    const accessor = Object.defineProperty({}, "secret", {
      get: getter,
      enumerable: true,
    });
    const toJSON = vi.fn(() => ({}));
    const proxyTrap = vi.fn();
    const proxy = new Proxy({}, { ownKeys: proxyTrap });
    const cycle = {};
    cycle.self = cycle;
    const hidden = Object.defineProperty({}, "secret", { value: "private" });
    for (const value of [accessor, { toJSON }, proxy, cycle, hidden]) {
      expect(() => digest(value)).toThrow();
    }
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
    expect(proxyTrap).not.toHaveBeenCalled();
  });

  it("bounds depth, aggregate bytes and nodes", () => {
    let depth = {};
    for (let i = 0; i < 30; i++) depth = { next: depth };
    for (const value of [
      depth,
      { text: "x".repeat(65537) },
      Array(4096).fill(null),
    ]) {
      expect(() => digest(value)).toThrow(/bounds/);
    }
  });

  it("hashes __proto__ as data without changing prototypes", () => {
    const value = JSON.parse('{"__proto__":{"admin":true},"id":"one"}');
    expect(digest(value)).not.toBe(digest({ id: "one" }));
    expect({}.admin).toBeUndefined();
  });

  it.each([
    { type: "Unknown" },
    { sourceKind: "" },
    { id: "../private?token=value" },
    { scope: { kind: "organization", id: "" } },
    { scope: { kind: "global", id: "all" } },
    { version: 0 },
    { version: "3" },
    { version: Number.MAX_SAFE_INTEGER + 1 },
    { schemaVersion: 2 },
    { content: "not a reference" },
  ])("rejects ambiguous or extra reference fields %#", (override) => {
    expect(() => target(override)).toThrow();
  });

  it("rejects unrecognized serialized schemas and detaches caller-owned values", () => {
    expect(() => validateRef({ ...target(), schemaVersion: 2 })).toThrow(
      /schema/,
    );
    const scope = { kind: "personal", id: "owner-a" };
    const value = target({ scope });
    scope.id = "owner-b";
    expect(value.scope.id).toBe("owner-a");
    expect(Object.isFrozen(scope)).toBe(false);
  });
});

describe("business action binding", () => {
  it("round trips a request and rejects mutation of every binding field", () => {
    const original = request();
    expect(validateAction(copy(original))).toEqual(original);
    const variants = [
      { ...original, actionType: "task.close" },
      { ...original, actionVersion: 2 },
      { ...original, target: target({ id: "task-2" }) },
      { ...original, expectedVersion: 4 },
      { ...original, input: { assigneeDid: "did:key:someone-else" } },
      { ...original, idempotencyKey: "request-2" },
      { ...original, invocationDigest: digest("unrelated") },
      { ...original, inputDigest: digest("unrelated") },
      { ...original, schemaVersion: 2 },
    ];
    for (const value of variants) expect(() => validateAction(value)).toThrow();
  });

  it("binds source, scope, target, revision and parameters to reused idempotency keys", () => {
    const original = request();
    expect(replay(original, request())).toBe(true);
    const variants = [
      request({ target: target({ sourceKind: "desktop.board-task" }) }),
      request({
        target: target({ scope: { kind: "organization", id: "org-b" } }),
      }),
      request({ target: target({ id: "task-2" }) }),
      request({ target: target({ version: 4 }), expectedVersion: 4 }),
      request({ input: { assigneeDid: "did:key:worker-2" } }),
      request({ actionType: "task.reassign" }),
    ];
    for (const value of variants) {
      expect(value.actionDigest).not.toBe(original.actionDigest);
      expect(() => replay(original, value)).toThrow(/idempotency conflict/);
    }
  });

  it("separates action content from distinct invocation identity", () => {
    const first = request();
    const second = request({ idempotencyKey: "request-2" });
    expect(first.actionDigest).toBe(second.actionDigest);
    expect(first.invocationDigest).not.toBe(second.invocationDigest);
    expect(() => replay(first, second)).toThrow();
  });

  it("does not change identity when object keys are reordered", () => {
    expect(request({ input: { a: 1, b: 2 } }).invocationDigest).toBe(
      request({ input: { b: 2, a: 1 } }).invocationDigest,
    );
  });

  it.each([
    { expectedVersion: 4 },
    { actionVersion: 0 },
    { actionType: "task assign" },
    { input: [] },
    { input: null },
    { input: "parameters" },
    { idempotencyKey: "https://service/?token=secret" },
    { approve: true },
  ])("rejects malformed action input %#", (override) => {
    expect(() => request(override)).toThrow();
  });

  it("does not mutate or retain writable request parameters", () => {
    const input = { nested: { assignee: "worker-1" } };
    const value = request({ input });
    input.nested.assignee = "worker-2";
    expect(value.input.nested.assignee).toBe("worker-1");
    expect(Object.isFrozen(value.input.nested)).toBe(true);
  });
});

describe("business action run projection", () => {
  it("can project a valid near-limit request without retaining its payload budget", () => {
    const large = request({ input: { text: "x".repeat(64800) } });
    expect(validateAction(large)).toEqual(large);
    const value = result({
      request: large,
      evidenceRefs: Array.from({ length: 64 }, (_, index) =>
        evidence(`evidence-${index}`),
      ),
    });
    expect(validateRun(value)).toEqual(value);
    expect(JSON.stringify(value).length).toBeLessThan(12000);
    expect(value).not.toHaveProperty("input");
  });

  it("projects a valid deeply nested request without spending extra nesting depth", () => {
    let input = { value: "nested" };
    for (let depth = 0; depth < 22; depth += 1) input = { next: input };
    const nested = request({ input });
    expect(validateAction(nested)).toEqual(nested);
    expect(validateRun(result({ request: nested })).status).toBe("succeeded");
  });

  it("does not invoke run wrapper getters or proxy traps while extracting a request", () => {
    const getter = vi.fn(() => request());
    const wrapper = {
      id: "run-1",
      status: "running",
      startedAt: "2026-10-06T01:00:00.000Z",
    };
    Object.defineProperty(wrapper, "request", {
      enumerable: true,
      get: getter,
    });
    expect(() => run(wrapper)).toThrow(/data properties/);
    expect(getter).not.toHaveBeenCalled();
    const proxyTrap = vi.fn();
    expect(() => run(new Proxy({}, { ownKeys: proxyTrap }))).toThrow(/Plain/);
    expect(proxyTrap).not.toHaveBeenCalled();
  });

  it.each(["succeeded", "failed", "unknown"])(
    "rejects regressed numeric revisions for %s",
    (status) => {
      expect(() => result({ status, afterVersion: 2 })).toThrow(/revision/);
      expect(() =>
        validateRun({ ...result({ status }), afterVersion: 2 }),
      ).toThrow(/revision/);
      expect(result({ status, afterVersion: 3 }).afterVersion).toBe(3);
    },
  );

  it("contains only typed references and digest bindings, without request content", () => {
    const value = result({
      request: request({
        input: {
          token: "private-token-value",
          body: "sensitive-document-content",
        },
        idempotencyKey: "private-correlation-key",
      }),
    });
    const encoded = JSON.stringify(value);
    expect(encoded).not.toContain("private-token-value");
    expect(encoded).not.toContain("sensitive-document-content");
    expect(encoded).not.toContain("private-correlation-key");
    expect(validateRun(copy(value))).toEqual(value);
    expect(Object.isFrozen(value.evidenceRefs[0])).toBe(true);
  });

  it.each(["failed", "cancelled", "unknown", "denied"])(
    "preserves %s as a distinct terminal outcome",
    (status) => {
      const value = result({
        status,
        afterVersion: null,
        executionRef: null,
        evidenceRefs: [],
      });
      expect(validateRun(value).status).toBe(status);
    },
  );

  it.each(["queued", "running"])("does not mark %s complete", (status) => {
    expect(
      result({ status, afterVersion: null, completedAt: null }).completedAt,
    ).toBeNull();
    expect(() => result({ status, afterVersion: null })).toThrow(/completion/);
  });

  it.each([
    { afterVersion: null },
    { executionRef: null },
    { evidenceRefs: [] },
    { status: "completed" },
    { status: "simulated" },
    { status: "cancelled" },
    { completedAt: null },
    { completedAt: "2026-10-05T01:00:00.000Z" },
    { startedAt: "2026-10-06" },
    { traceId: "https://server/?token=secret" },
    { executionRef: evidence("https://user:password@server") },
    { evidenceRefs: [evidence("C:/private/file.txt")] },
    { evidenceRefs: [evidence("one"), evidence("one")] },
    { evidenceRefs: [{ ...evidence("one"), content: "private" }] },
    { output: { token: "private" } },
    { approvalRef: { id: "approval-1" } },
  ])(
    "rejects unsupported success claims and untyped payloads %#",
    (override) => {
      expect(() => result(override)).toThrow();
    },
  );

  it("validates bindings and rejects arbitrary fields in serialized run records", () => {
    const original = result();
    expect(() =>
      validateRun({ ...original, target: target({ id: "task-2" }) }),
    ).toThrow(/binding/);
    expect(() =>
      validateRun({ ...original, error: "private-diagnostic" }),
    ).toThrow(/fields/);
    expect(() => validateRun({ ...original, schemaVersion: 2 })).toThrow(
      /schema/,
    );
  });
});
