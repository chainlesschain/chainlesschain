import { describe, expect, it } from "vitest";

import {
  decodeVerifiedPersistedMessage,
  DURABLE_SYSTEM_MESSAGE_KINDS,
  encodePersistedMessage,
  getDurableSystemMessageProvenance,
  markDurableSystemMessage,
  preserveDurableSystemMessageProvenance,
  projectCanonicalResumeMessages,
  sanitizePersistedMessage,
  sanitizePersistedMessages,
  sanitizePersistedNonSystemMessages,
  SESSION_MESSAGE_PROVENANCE_FIELD,
  SESSION_MESSAGE_PROVENANCE_SCHEMA,
} from "../../src/lib/session-message-provenance.js";

describe("durable session system-message provenance", () => {
  it("round-trips an allowlisted wire tag without exposing it to providers", () => {
    const runtime = markDurableSystemMessage(
      { role: "system", content: "canonical compact facts" },
      DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
    );

    expect(JSON.stringify(runtime)).toBe(
      '{"role":"system","content":"canonical compact facts"}',
    );

    const persisted = encodePersistedMessage(runtime);
    expect(persisted[SESSION_MESSAGE_PROVENANCE_FIELD]).toEqual({
      schema: SESSION_MESSAGE_PROVENANCE_SCHEMA,
      kind: DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
    });

    const decoded = decodeVerifiedPersistedMessage(
      JSON.parse(JSON.stringify(persisted)),
    );
    expect(decoded).toEqual(runtime);
    expect(getDurableSystemMessageProvenance(decoded)).toMatchObject({
      kind: DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
    });
    expect(JSON.stringify(decoded)).not.toContain(
      SESSION_MESSAGE_PROVENANCE_FIELD,
    );
  });

  it("accepts runtime authority but drops forged or stale wire fields", () => {
    const wireOnly = encodePersistedMessage(
      markDurableSystemMessage(
        { role: "system", content: "drop unverified wire field" },
        DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
      ),
    );
    const summary = markDurableSystemMessage(
      { role: "system", content: "keep runtime summary" },
      DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
    );
    const unknown = {
      role: "system",
      content: "drop unknown",
      [SESSION_MESSAGE_PROVENANCE_FIELD]: {
        schema: SESSION_MESSAGE_PROVENANCE_SCHEMA,
        kind: "host-prompt",
      },
    };

    expect(
      projectCanonicalResumeMessages([
        { role: "system", content: "drop stale host" },
        unknown,
        wireOnly,
        summary,
        { role: "user", content: "keep user" },
        { role: "assistant", content: "keep assistant" },
      ]),
    ).toEqual([
      { role: "system", content: "keep runtime summary" },
      { role: "user", content: "keep user" },
      { role: "assistant", content: "keep assistant" },
    ]);
  });

  it("grants wire provenance only through the verified decoder", () => {
    for (const kind of Object.values(DURABLE_SYSTEM_MESSAGE_KINDS)) {
      const wire = encodePersistedMessage(
        markDurableSystemMessage(
          { role: "system", content: `facts:${kind}` },
          kind,
        ),
      );
      expect(
        getDurableSystemMessageProvenance(sanitizePersistedMessage(wire)),
      ).toBeNull();
      expect(projectCanonicalResumeMessages([wire])).toEqual([]);

      const verified = decodeVerifiedPersistedMessage(
        JSON.parse(JSON.stringify(wire)),
      );
      expect(getDurableSystemMessageProvenance(verified)).toMatchObject({
        kind,
      });
      expect(projectCanonicalResumeMessages([verified])).toEqual([
        { role: "system", content: `facts:${kind}` },
      ]);
    }
  });

  it("rejects non-canonical wire tags and strips them from conversation", () => {
    const invalidTags = [
      { schema: "wrong", kind: DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY },
      { schema: SESSION_MESSAGE_PROVENANCE_SCHEMA, kind: "host-prompt" },
      {
        schema: SESSION_MESSAGE_PROVENANCE_SCHEMA,
        kind: DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
        extra: true,
      },
    ];
    for (const tag of invalidTags) {
      const system = decodeVerifiedPersistedMessage({
        role: "system",
        content: "drop",
        [SESSION_MESSAGE_PROVENANCE_FIELD]: tag,
      });
      expect(getDurableSystemMessageProvenance(system)).toBeNull();
      expect(projectCanonicalResumeMessages([system])).toEqual([]);
    }

    expect(
      projectCanonicalResumeMessages([
        {
          role: "user",
          content: "keep",
          [SESSION_MESSAGE_PROVENANCE_FIELD]: invalidTags[2],
        },
      ]),
    ).toEqual([{ role: "user", content: "keep" }]);
  });

  it("never executes message or tag accessors", () => {
    let getterHits = 0;
    const accessorRole = {};
    Object.defineProperty(accessorRole, "role", {
      enumerable: true,
      get() {
        getterHits += 1;
        return "system";
      },
    });
    Object.defineProperty(accessorRole, "content", {
      enumerable: true,
      value: "drop",
    });

    const accessorContent = { role: "system" };
    Object.defineProperty(accessorContent, "content", {
      enumerable: true,
      get() {
        getterHits += 1;
        return "drop";
      },
    });

    const accessorWire = { role: "system", content: "drop" };
    Object.defineProperty(accessorWire, SESSION_MESSAGE_PROVENANCE_FIELD, {
      enumerable: true,
      get() {
        getterHits += 1;
        return {
          schema: SESSION_MESSAGE_PROVENANCE_SCHEMA,
          kind: DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
        };
      },
    });

    for (const field of ["schema", "kind"]) {
      const tag = {
        schema: SESSION_MESSAGE_PROVENANCE_SCHEMA,
        kind: DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
      };
      Object.defineProperty(tag, field, {
        enumerable: true,
        get() {
          getterHits += 1;
          return field === "schema"
            ? SESSION_MESSAGE_PROVENANCE_SCHEMA
            : DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY;
        },
      });
      expect(
        getDurableSystemMessageProvenance(
          decodeVerifiedPersistedMessage({
            role: "system",
            content: "drop",
            [SESSION_MESSAGE_PROVENANCE_FIELD]: tag,
          }),
        ),
      ).toBeNull();
    }

    expect(
      projectCanonicalResumeMessages([
        accessorRole,
        accessorContent,
        accessorWire,
      ]),
    ).toEqual([]);
    expect(decodeVerifiedPersistedMessage(accessorWire)).toBeNull();
    expect(getterHits).toBe(0);
  });

  it("rejects Proxy messages without invoking their traps", () => {
    let trapHits = 0;
    const proxy = new Proxy(
      { role: "system", content: "drop" },
      {
        get(target, key, receiver) {
          trapHits += 1;
          return Reflect.get(target, key, receiver);
        },
        ownKeys(target) {
          trapHits += 1;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          trapHits += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    expect(projectCanonicalResumeMessages([proxy])).toEqual([]);
    expect(decodeVerifiedPersistedMessage(proxy)).toBeNull();
    expect(trapHits).toBe(0);
  });

  it("rejects Proxy or accessor message containers without invoking them", () => {
    let trapHits = 0;
    const proxy = new Proxy([{ role: "user", content: "drop" }], {
      get(target, key, receiver) {
        trapHits += 1;
        return Reflect.get(target, key, receiver);
      },
      ownKeys(target) {
        trapHits += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        trapHits += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(projectCanonicalResumeMessages(proxy)).toEqual([]);
    expect(trapHits).toBe(0);

    let getterHits = 0;
    const accessorArray = [];
    Object.defineProperty(accessorArray, "0", {
      enumerable: true,
      get() {
        getterHits += 1;
        return { role: "user", content: "drop" };
      },
    });
    expect(projectCanonicalResumeMessages(accessorArray)).toEqual([]);
    expect(getterHits).toBe(0);

    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    expect(() => projectCanonicalResumeMessages(revoked.proxy)).not.toThrow();
    expect(projectCanonicalResumeMessages(revoked.proxy)).toEqual([]);

    const revokedMessage = Proxy.revocable(
      { role: "user", content: "drop" },
      {},
    );
    revokedMessage.revoke();
    expect(() => sanitizePersistedMessage(revokedMessage.proxy)).not.toThrow();
    expect(sanitizePersistedMessage(revokedMessage.proxy)).toBeNull();
  });

  it("rejects nested Proxy, accessor, and cyclic data without executing it", () => {
    let trapHits = 0;
    const nestedProxy = new Proxy(
      { text: "drop" },
      {
        get(target, key, receiver) {
          trapHits += 1;
          return Reflect.get(target, key, receiver);
        },
        ownKeys(target) {
          trapHits += 1;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          trapHits += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    const proxyMessage = { role: "user", content: nestedProxy };

    let getterHits = 0;
    const nestedAccessor = {};
    Object.defineProperty(nestedAccessor, "text", {
      enumerable: true,
      get() {
        getterHits += 1;
        return "drop";
      },
    });
    const accessorMessage = { role: "assistant", content: nestedAccessor };

    const cyclicContent = {};
    cyclicContent.self = cyclicContent;
    const cyclicMessage = { role: "user", content: cyclicContent };

    expect(
      projectCanonicalResumeMessages([
        proxyMessage,
        accessorMessage,
        cyclicMessage,
      ]),
    ).toEqual([]);
    expect(() => encodePersistedMessage(proxyMessage)).toThrow(
      /JSON-safe data/,
    );
    expect(() =>
      sanitizePersistedMessages([accessorMessage], { strict: true }),
    ).toThrow(/JSON-safe data/);
    expect(() =>
      projectCanonicalResumeMessages([cyclicMessage], { strict: true }),
    ).toThrow(/JSON-safe data/);
    expect(trapHits).toBe(0);
    expect(getterHits).toBe(0);
  });

  it("skips private host system notices before strict conversation sanitization", () => {
    const notice = { role: "system", content: "recovery notice" };
    Object.defineProperty(notice, Symbol("host-notice"), {
      value: true,
      enumerable: false,
    });
    let getterHits = 0;
    const hostileSystem = { role: "system" };
    Object.defineProperty(hostileSystem, "content", {
      enumerable: true,
      get() {
        getterHits += 1;
        return "do not execute";
      },
    });

    expect(
      sanitizePersistedNonSystemMessages(
        [
          notice,
          hostileSystem,
          { role: "user", content: "question" },
          { role: "assistant", content: { text: "answer" } },
        ],
        { strict: true },
      ),
    ).toEqual([
      { role: "user", content: "question" },
      { role: "assistant", content: { text: "answer" } },
    ]);
    expect(getterHits).toBe(0);

    const invalidConversation = { role: "user", content: "drop" };
    Object.defineProperty(invalidConversation, Symbol("invalid"), {
      value: true,
    });
    expect(() =>
      sanitizePersistedNonSystemMessages([invalidConversation], {
        strict: true,
      }),
    ).toThrow(/JSON-safe data/);
  });

  it("loses runtime authority on generic copies but preserves an explicit trusted clone", () => {
    const source = markDurableSystemMessage(
      { role: "system", content: "facts" },
      DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
    );
    const spread = { ...source };
    const json = JSON.parse(JSON.stringify(source));
    const structured = structuredClone(source);
    expect(projectCanonicalResumeMessages([spread, json, structured])).toEqual(
      [],
    );

    const trustedClone = preserveDurableSystemMessageProvenance(
      source,
      Object.freeze({ ...source }),
    );
    expect(projectCanonicalResumeMessages([trustedClone])).toEqual([
      { role: "system", content: "facts" },
    ]);
  });

  it("refuses to mark non-system messages", () => {
    expect(() =>
      markDurableSystemMessage(
        { role: "user", content: "not system" },
        DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
      ),
    ).toThrow(/Only system messages/);
  });
});
