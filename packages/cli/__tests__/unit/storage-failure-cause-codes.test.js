import { describe, expect, it, vi } from "vitest";
import {
  storageFailureCauseCodes as codes,
  storageFailureCauseSuffix as suffix,
  storageFailureCodesFromMessage as parse,
  recordStorageFailureStage as recordStage,
  storageFailureStage as stage,
  storageFailureStageFromMessage as parseStage,
  storageFailureReason as reason,
  storageFailureReasonFromMessage as parseReason,
  recordStorageFailureReason as recordReason,
} from "../../src/lib/storage-failure-cause-codes.js";

describe("bounded storage failure diagnostics", () => {
  it.each([
    "auth-clock-backward",
    "auth-envelope-expired",
    "auth-authority-lease-expired",
    "release-clock-backward",
    "release-envelope-expired",
    "release-authority-lease-expired",
  ])("retains the private %s tag on the original frozen error", (token) => {
    const cause = Object.freeze({ code: "EIO" });
    const error = Object.freeze(
      Object.assign(
        new Error(
          token.startsWith("auth-")
            ? "artifact authority expired before envelope authentication completed"
            : "artifact authority expired before canonical bytes could be released",
          {
            cause,
          },
        ),
        { code: "CC_EVOLUTION_ARTIFACT_EXPIRED" },
      ),
    );
    const original = Object.getOwnPropertyDescriptors(error);
    expect(recordReason(error, token)).toBe(error);
    expect(reason(error)).toBe(token);
    expect(parseReason(suffix(error))).toBe(token);
    expect(codes(error)).toEqual(["CC_EVOLUTION_ARTIFACT_EXPIRED", "EIO"]);
    expect(parse(suffix(error))).toEqual(codes(error));
    expect(Object.getOwnPropertyDescriptors(error)).toEqual(original);
    expect(error.cause).toBe(cause);
    expect(error).not.toHaveProperty("storageReason");
    expect(suffix(error)).not.toContain(error.message);
    expect(
      parseReason(` [storage_reason: ${token}] [storage_cause_codes: EIO]`),
    ).toBeNull();
  });

  it("rejects unrecognized branch tags and non-owned or mismatched codes without executing user code", () => {
    const touched = vi.fn(() => {
      throw new Error("must not execute");
    });
    const proxy = new Proxy(
      {},
      { getOwnPropertyDescriptor: touched, get: touched },
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const getter = Object.defineProperty({}, "code", { get: touched });
    for (const error of [
      proxy,
      revoked.proxy,
      getter,
      Object.create({ code: "CC_EVOLUTION_ARTIFACT_EXPIRED" }),
      { code: "EIO" },
      null,
      undefined,
      1,
    ]) {
      expect(recordReason(error, "release-clock-backward")).toBe(error);
      expect(reason(error)).toBeNull();
    }
    const error = { code: "CC_EVOLUTION_ARTIFACT_EXPIRED" };
    for (const invalid of ["private-path", "release-clock-window", {}, null]) {
      expect(recordReason(error, invalid)).toBe(error);
      expect(reason(error)).toBeNull();
    }
    recordReason(error, "release-clock-backward");
    error.code = "EIO";
    expect(reason(error)).toBeNull();
    expect(touched).not.toHaveBeenCalled();
  });

  it("prefers branch tags while retaining bounded own-cause traversal", () => {
    const inner = Object.assign(
      new Error("artifact pathname changed during bounded read"),
      {
        code: "CC_ARTIFACT_BOUNDED_READ_FAILED",
      },
    );
    const tagged = Object.assign(new Error("private", { cause: inner }), {
      code: "CC_EVOLUTION_ARTIFACT_EXPIRED",
    });
    recordReason(tagged, "release-authority-lease-expired");
    expect(reason(tagged)).toBe("release-authority-lease-expired");
    let outer = tagged;
    for (let index = 0; index < 5; index++) outer = { cause: outer };
    expect(reason(outer)).toBe("release-authority-lease-expired");
    expect(reason({ cause: outer })).toBeNull();
  });

  it("retains a prefix reader infrastructure failure without exposing its text", () => {
    const error = Object.assign(new Error("private worker detail"), {
      code: "CC_EVOLUTION_LEDGER_PREFIX_READER_FAILED",
    });
    expect(codes(error)).toEqual(["CC_EVOLUTION_LEDGER_PREFIX_READER_FAILED"]);
    expect(parse(suffix(error))).toEqual(codes(error));
    expect(suffix(error)).not.toContain("private");
  });
  it("retains the bounded-file and held-parent failure codes", () => {
    expect(
      codes({
        code: "CC_ARTIFACT_BOUNDED_READ_FAILED",
        cause: {
          code: "SECURE_FILE_IDENTITY_PARENT_RACE",
          cause: {
            code: "SECURE_FILE_IDENTITY_INVALID_PARENT",
          },
        },
      }),
    ).toEqual([
      "CC_ARTIFACT_BOUNDED_READ_FAILED",
      "SECURE_FILE_IDENTITY_PARENT_RACE",
      "SECURE_FILE_IDENTITY_INVALID_PARENT",
    ]);
  });
  it("keeps fixed stages private and preserves frozen original errors and causes", () => {
    const cause = Object.freeze({ code: "CC_ARTIFACT_BOUNDED_READ_FAILED" });
    const error = Object.freeze(new Error("private path", { cause }));
    expect(recordStage(error, "model-projection", "read-bytes")).toBe(error);
    const outer = new Error("outer", { cause: error });
    expect(stage(outer)).toEqual({
      artifactType: "model-projection",
      phase: "read-bytes",
    });
    expect(Object.isFrozen(stage(outer))).toBe(true);
    expect(Reflect.ownKeys(error)).toEqual(["stack", "message", "cause"]);
    const marker = suffix(outer);
    expect(marker).toBe(
      " [storage_stage: model-projection/read-bytes] [storage_cause_codes: CC_ARTIFACT_BOUNDED_READ_FAILED]",
    );
    expect(parse(marker)).toEqual(codes(outer));
    expect(parseStage(marker)).toEqual(stage(outer));
    expect(error.cause).toBe(cause);
  });
  it("rejects forged stage properties and never executes metadata accessors", () => {
    const touched = vi.fn(() => {
      throw new Error("private");
    });
    const proxy = new Proxy(
      {},
      {
        get: touched,
        getOwnPropertyDescriptor: touched,
        getPrototypeOf: touched,
      },
    );
    const object = {
      get cause() {
        return touched();
      },
      storageStage: { artifactType: "model-projection", phase: "read-bytes" },
    };
    expect(stage(object)).toBeNull();
    expect(recordStage(proxy, "model-projection", "read-bytes")).toBe(proxy);
    expect(stage(proxy)).toBeNull();
    expect(recordStage(object, proxy, "read-bytes")).toBe(object);
    expect(recordStage(object, "model-projection", proxy)).toBe(object);
    expect(stage(object)).toBeNull();
    expect(touched).not.toHaveBeenCalled();
    recordStage(object, "private-arbitrary-type", "publish");
    expect(stage(object)).toEqual({ artifactType: "other", phase: "publish" });
    expect(suffix(object)).not.toContain("private");
  });
  it("accepts only complete fixed stage suffixes, with or without cause codes", () => {
    expect(
      parseStage("private [storage_stage: trusted-projection/pre-index]"),
    ).toEqual({ artifactType: "trusted-projection", phase: "pre-index" });
    for (const input of [
      " [storage_stage: private/pre-index]",
      " [storage_stage: model-projection/private]",
      " [storage_stage: model-projection/read-bytes/extra]",
      " [storage_stage: model-projection/read-bytes",
      "[storage_stage: model-projection/read-bytes]",
      " [storage_stage: model-projection/read-bytes] trailing",
      " [storage_stage: model-projection/read-bytes] [storage_cause_codes: PRIVATE]",
      " [storage_stage: model-projection/read-bytes] private [storage_cause_codes: EPERM]",
      {
        toString() {
          throw new Error("private");
        },
      },
    ])
      expect(parseStage(input)).toBeNull();
  });
  it("preserves known nested failure codes without copying error text or paths", () => {
    const original = Object.assign(new Error("private path and payload"), {
      code: "EPERM",
    });
    const artifact = Object.assign(
      new Error("private artifact", { cause: original }),
      { code: "CC_EVOLUTION_ARTIFACT_STORE_FAILED" },
    );
    const outer = new Error("opaque wrapper", { cause: artifact });
    expect(codes(outer)).toEqual([
      "CC_EVOLUTION_ARTIFACT_STORE_FAILED",
      "EPERM",
    ]);
    const marker = suffix(outer);
    expect(marker).not.toContain("private");
    expect(parse("original operator error" + marker)).toEqual(codes(outer));
    expect(outer.cause).toBe(artifact);
    expect(artifact.cause).toBe(original);
  });
  it("never invokes code/cause accessors, Proxy traps or coercion hooks", () => {
    const touched = vi.fn(() => {
      throw new Error("diagnostic must not call user code");
    });
    const getters = {};
    Object.defineProperties(getters, {
      code: { get: touched },
      cause: { get: touched },
    });
    const proxy = new Proxy(
      {},
      {
        get: touched,
        getOwnPropertyDescriptor: touched,
        getPrototypeOf: touched,
      },
    );
    const hostileCode = { toString: touched, [Symbol.toPrimitive]: touched };
    for (const error of [
      getters,
      proxy,
      { code: hostileCode },
      Object.create(proxy),
    ])
      expect(codes(error)).toEqual([]);
    expect(parse(hostileCode)).toEqual([]);
    expect(touched).not.toHaveBeenCalled();
  });
  it("bounds cyclic/deep causes and omits arbitrary lookalike codes", () => {
    const first = { code: "EPERM" },
      second = { code: "EIO", cause: first };
    first.cause = second;
    expect(codes(first)).toEqual(["EPERM", "EIO"]);
    expect(
      codes({ code: "CC_EVOLUTION_PRIVATE_CREDENTIAL_MUST_NOT_LEAK" }),
    ).toEqual([]);
    let deep = { code: "ENOSPC" };
    for (let i = 0; i < 6; i++) deep = { cause: deep };
    expect(codes(deep)).toEqual([]);
  });
  it("strictly reprojects only supported complete markers with owned identifiers", () => {
    expect(parse("secret [storage_cause_codes: EPERM -> EIO]")).toEqual([
      "EPERM",
      "EIO",
    ]);
    for (const value of [
      "private EPERM",
      "[storage_cause_codes: EPERM]", // missing exact marker boundary
      "secret [storage_cause_codes: EPERM",
      "secret [storage_cause_codes: SECRET]",
      "secret [storage_cause_codes: EPERM] trailing",
      "secret [storage_cause_codes: ]",
      "secret [storage_cause_codes: " +
        Array(7).fill("EPERM").join(" -> ") +
        "]",
    ])
      expect(parse(value)).toEqual([]);
    const result = parse("x".repeat(10000) + " [storage_cause_codes: EPERM]");
    expect(result).toEqual(["EPERM"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(suffix({ message: "private", code: "unknown" })).toBe("");
  });
});
describe("finite storage failure reasons", () => {
  const boundedCode = "CC_ARTIFACT_BOUNDED_READ_FAILED";
  const boundedMessage = "artifact pathname changed during bounded read";
  const reasonMarker = " [storage_reason: bounded-pathname-changed]";
  const codesMarker = " [storage_cause_codes: CC_ARTIFACT_BOUNDED_READ_FAILED]";
  const known = () =>
    Object.assign(new Error(boundedMessage), { code: boundedCode });

  it.each([
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "ArtifactStore root physical identity changed",
      "store-root-identity",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "ArtifactStore files root physical identity changed",
      "store-files-identity",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "ArtifactStore sealed directory identity or reader changed",
      "sealed-directory-or-reader",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "stored artifact history directory identity changed",
      "history-directory-identity",
    ],
    [
      "CC_ARTIFACT_BOUNDED_READ_FAILED",
      "artifact path and descriptor identities differ",
      "bounded-path-handle",
    ],
    [
      "CC_ARTIFACT_BOUNDED_READ_FAILED",
      "artifact descriptor changed during bounded read",
      "bounded-descriptor-changed",
    ],
    [
      "CC_ARTIFACT_BOUNDED_READ_FAILED",
      "artifact pathname changed during bounded read",
      "bounded-pathname-changed",
    ],
    [
      "CC_ARTIFACT_BOUNDED_READ_FAILED",
      "artifact path is not physically canonical",
      "bounded-path-canonical",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "ArtifactStore index physical identity changed",
      "index-physical-changed",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "ArtifactStore index realpath changed or escaped its root",
      "index-realpath-changed",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "ArtifactStore index descriptor is replaced or oversized",
      "index-path-handle",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "ArtifactStore index changed while its descriptor was read",
      "index-descriptor-changed",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "ArtifactStore index pathname changed during descriptor read",
      "index-pathname-changed",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "ArtifactStore index generation changed during readback",
      "index-generation-changed",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "ArtifactStore.get is not bound to the trusted index snapshot",
      "index-get-unbound",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "ArtifactStore index entry was replaced during readback",
      "index-entry-changed",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "ArtifactStore index entry was replaced during ledger readback",
      "index-ledger-entry-changed",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "ArtifactStore index changed during ledger batch readback",
      "index-batch-changed",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "ArtifactStore index changed during ledger history readback",
      "index-history-changed",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "ArtifactStore post-read integrity verification threw",
      "artifact-post-read-hook",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
      "stored artifact bytes do not match the signed recordDigest",
      "artifact-record-digest",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_EXPIRED",
      "evolution artifact envelope is not currently valid",
      "envelope-validity-window",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_EXPIRED",
      "artifact authority expired before envelope authentication completed",
      "authentication-clock-window",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_EXPIRED",
      "artifact authority expired before canonical bytes could be released",
      "release-clock-window",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_EXPIRED",
      "artifact publish authority expired before envelope signing completed",
      "signing-clock-window",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_EXPIRED",
      "artifact authority expired before ledger batch release",
      "batch-clock-window",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_EXPIRED",
      "artifact authority expired before ledger history release",
      "history-clock-window",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_AUTHORITY_DENIED",
      "artifact authority clock moved backwards",
      "authority-clock-backward",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_AUTHORITY_DENIED",
      "current artifact authority denied or returned an unbound decision",
      "authority-decision-unbound",
    ],
    [
      "CC_EVOLUTION_ARTIFACT_AUTHORITY_DENIED",
      "artifact envelope is stale under current policy or revocation authority",
      "authority-policy-stale",
    ],
  ])("recognizes only the exact %s / %s guard", (code, message, expected) => {
    const error = Object.freeze(Object.assign(new Error(message), { code }));
    const before = Object.getOwnPropertyDescriptors(error);
    expect(reason(error)).toBe(expected);
    expect(parseReason(suffix(error))).toBe(expected);
    expect(parse(suffix(error))).toEqual([code]);
    expect(Object.getOwnPropertyDescriptors(error)).toEqual(before);
    expect(reason({ code: "EPERM", message })).toBeNull();
    expect(reason({ code, message: message + " private path" })).toBeNull();
    expect(reason({ code, message: "private prefix " + message })).toBeNull();
    expect(suffix(error)).not.toContain(message);
  });

  it("keeps the deepest recognized own cause without changing error identity", () => {
    const inner = Object.freeze(known());
    const error = Object.freeze(
      Object.assign(
        new Error("ArtifactStore post-read integrity verification threw", {
          cause: inner,
        }),
        { code: "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED" },
      ),
    );
    recordStage(error, "model-projection", "read-bytes");
    const outer = Object.freeze(new Error("private wrapper", { cause: error }));
    expect(reason(outer)).toBe("bounded-pathname-changed");
    const marker = suffix(outer);
    expect(marker).toBe(
      reasonMarker +
        " [storage_stage: model-projection/read-bytes]" +
        " [storage_cause_codes: CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED -> CC_ARTIFACT_BOUNDED_READ_FAILED]",
    );
    expect(parseReason(marker)).toBe(reason(outer));
    expect(parseStage(marker)).toEqual(stage(outer));
    expect(parse(marker)).toEqual(codes(outer));
    expect(outer.cause).toBe(error);
    expect(error.cause).toBe(inner);
    expect(marker).not.toContain("private");
  });

  it("does not traverse inherited fields or invoke getters, coercion, or Proxy traps", () => {
    const touched = vi.fn(() => {
      throw new Error("must not execute");
    });
    const proxy = new Proxy(
      {},
      {
        get: touched,
        getOwnPropertyDescriptor: touched,
        getPrototypeOf: touched,
      },
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const getters = {};
    Object.defineProperties(getters, {
      code: { get: touched },
      message: { get: touched },
      cause: { get: touched },
    });
    const messageGetter = Object.defineProperty(
      { code: boundedCode },
      "message",
      { get: touched },
    );
    const causeGetter = Object.defineProperty({}, "cause", { get: touched });
    const hostile = { toString: touched, [Symbol.toPrimitive]: touched };
    for (const error of [
      proxy,
      revoked.proxy,
      Object.create(proxy),
      getters,
      messageGetter,
      causeGetter,
      Object.create({ code: boundedCode, message: boundedMessage }),
      Object.assign(Object.create({ code: boundedCode }), {
        message: boundedMessage,
      }),
      Object.assign(Object.create({ message: boundedMessage }), {
        code: boundedCode,
      }),
      Object.create({ cause: known() }),
      { code: hostile, message: boundedMessage },
      { code: boundedCode, message: hostile },
      { code: new String(boundedCode), message: boundedMessage },
      { code: boundedCode, message: new String(boundedMessage) },
      Object.assign(() => {}, { code: boundedCode, message: boundedMessage }),
      null,
      undefined,
      3,
      "private",
    ])
      expect(reason(error)).toBeNull();
    expect(reason({ cause: proxy })).toBeNull();
    expect(reason({ cause: revoked.proxy })).toBeNull();
    const retained = Object.assign(known(), { cause: proxy });
    expect(reason(retained)).toBe("bounded-pathname-changed");
    expect(parseReason(hostile)).toBeNull();
    expect(touched).not.toHaveBeenCalled();
  });

  it("bounds cycles and recognizes at most six own cause objects", () => {
    const cyclic = known();
    cyclic.cause = cyclic;
    expect(reason(cyclic)).toBe("bounded-pathname-changed");
    let deep = known();
    for (let index = 0; index < 5; index++) deep = { cause: deep };
    expect(reason(deep)).toBe("bounded-pathname-changed");
    expect(reason({ cause: deep })).toBeNull();
    expect(
      reason({ cause: { code: boundedCode, message: "unknown private" } }),
    ).toBeNull();
    expect(suffix({ code: boundedCode, message: "unknown private" })).toBe(
      codesMarker,
    );
  });

  it("accepts only a known reason with exact framing and its matching code suffix", () => {
    expect(
      parseReason("private".repeat(1000) + reasonMarker + codesMarker),
    ).toBe("bounded-pathname-changed");
    expect(
      parseReason(
        reasonMarker +
          " [storage_stage: model-projection/read-bytes]" +
          codesMarker,
      ),
    ).toBe("bounded-pathname-changed");
    for (const text of [
      reasonMarker,
      codesMarker,
      reasonMarker + " [storage_stage: model-projection/read-bytes]",
      reasonMarker + " [storage_cause_codes: EPERM]",
      reasonMarker + codesMarker + " trailing",
      reasonMarker + " extra" + codesMarker,
      reasonMarker + " [storage_stage: private/read-bytes]" + codesMarker,
      reasonMarker +
        " [storage_stage: model-projection/read-bytes] extra" +
        codesMarker,
      reasonMarker +
        codesMarker +
        " [storage_stage: model-projection/read-bytes]",
      reasonMarker + codesMarker + codesMarker,
      reasonMarker +
        " [storage_cause_codes: CC_ARTIFACT_BOUNDED_READ_FAILED -> CC_ARTIFACT_BOUNDED_READ_FAILED]",
      " [storage_reason: private]" + codesMarker,
      " [storage_reason: bounded-pathname-changed" + codesMarker,
      "[storage_reason: bounded-pathname-changed]" + codesMarker,
      reasonMarker + "x".repeat(1024) + codesMarker,
    ])
      expect(parseReason(text)).toBeNull();
  });
});
