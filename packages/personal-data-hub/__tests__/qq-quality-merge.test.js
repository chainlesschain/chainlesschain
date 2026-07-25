"use strict";

import { describe, expect, it } from "vitest";

const { mergeQqEntityConflict, _internal } = require("../lib/qq-quality-merge");

const NOW = 1_700_000_000_000;
const SCOPE = "account:qq-pc:aaaaaaaa";
const CANONICAL_ID = "c2c_msg_table:9007199254740993123";
const CANONICAL_SOURCE_IDENTITY = {
  adapter: "qq-pc",
  scope: SCOPE,
  originalId: CANONICAL_ID,
};

function source(overrides = {}) {
  return {
    adapter: "qq-pc",
    adapterVersion: "0.1.0",
    capturedAt: NOW,
    capturedBy: "sqlite",
    scope: SCOPE,
    originalId: CANONICAL_ID,
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    id: "event-canonical",
    type: "event",
    subtype: "message",
    occurredAt: NOW,
    actor: "person-self",
    content: { title: "message", text: "" },
    source: source(),
    extra: { platform: "qq" },
    ingestedAt: NOW,
    ...overrides,
  };
}

function merge(existing, incoming, entityType = existing.type) {
  return mergeQqEntityConflict({
    entityType,
    existing,
    incoming,
    matchedBy: ["source"],
    sourceIdentity: CANONICAL_SOURCE_IDENTITY,
  });
}

describe("QQ field-level quality merge", () => {
  it("keeps rich message evidence while accepting newer mutable state", () => {
    const existing = event({
      actor: "person-qq-10001",
      participants: ["person-qq-10001", "person-qq-self"],
      content: {
        title: "Project discussion",
        text: "The complete desktop message",
      },
      extra: {
        platform: "qq",
        messageId: "9007199254740993123",
        senderUid: "u_10001",
        peerName: "Alice",
        readState: 0,
        textResolved: true,
        rawRow: {
          40001: "9007199254740993123",
          40020: "u_10001",
          40800: Buffer.from("rich-body"),
        },
        provenance: { direct: { database: "nt_msg.db" } },
        observationProducer: "qq-pc/direct",
      },
    });
    const incoming = event({
      actor: "person-self",
      participants: [],
      content: { title: "(empty)", text: "" },
      source: source({ capturedAt: NOW + 100 }),
      extra: {
        platform: "qq",
        messageId: null,
        senderUid: null,
        peerName: null,
        readState: 1,
        textResolved: false,
        rawRow: { 40001: "9007199254740993123" },
        provenance: { android: { snapshot: true } },
        observationProducer: "qq-pc/android",
      },
      ingestedAt: NOW + 100,
    });

    const resolved = merge(existing, incoming);

    expect(resolved).toMatchObject({
      id: "event-canonical",
      actor: "person-qq-10001",
      participants: ["person-qq-10001", "person-qq-self"],
      content: {
        title: "Project discussion",
        text: "The complete desktop message",
      },
      source: {
        adapter: "qq-pc",
        scope: SCOPE,
        originalId: CANONICAL_ID,
        capturedAt: NOW + 100,
      },
      extra: {
        messageId: "9007199254740993123",
        senderUid: "u_10001",
        peerName: "Alice",
        readState: 1,
        textResolved: true,
        provenance: {
          direct: { database: "nt_msg.db" },
          android: { snapshot: true },
        },
        observationProducers: ["qq-pc/direct", "qq-pc/android"],
      },
      ingestedAt: NOW + 100,
    });
    expect(resolved.extra.rawRow).toEqual(existing.extra.rawRow);
    expect(resolved.extra).not.toHaveProperty("observationProducer");
  });

  it("combines the best fields from different producers without a global rank", () => {
    const direct = event({
      actor: "person-qq-10001",
      participants: ["person-qq-10001"],
      content: { title: "(待解析消息体)", text: "" },
      extra: {
        platform: "qq",
        senderUin: "10001",
        rawRow: { 40001: CANONICAL_ID },
        textResolved: false,
        observationProducer: "qq-pc/direct",
      },
    });
    const sidecar = event({
      actor: "person-self",
      participants: ["person-self", "person-qq-10001"],
      topics: ["topic-qq-group-20002"],
      content: {
        title: "Readable message",
        text: "Decoded protobuf text",
      },
      extra: {
        platform: "qq",
        senderUin: null,
        senderName: "Alice",
        rawRow: null,
        textResolved: true,
        observationProducer: "qq-pc/sidecar",
      },
      ingestedAt: NOW + 10,
    });

    const resolved = merge(direct, sidecar);

    expect(resolved.actor).toBe("person-qq-10001");
    expect(resolved.participants).toEqual(["person-qq-10001", "person-self"]);
    expect(resolved.topics).toEqual(["topic-qq-group-20002"]);
    expect(resolved.content).toMatchObject({
      title: "Readable message",
      text: "Decoded protobuf text",
    });
    expect(resolved.extra).toMatchObject({
      senderUin: "10001",
      senderName: "Alice",
      textResolved: true,
      rawRow: { 40001: CANONICAL_ID },
      observationProducers: ["qq-pc/direct", "qq-pc/sidecar"],
    });
  });

  it("does not let an older observation regress read state", () => {
    const newer = event({
      extra: { platform: "qq", readState: 1 },
      ingestedAt: NOW + 100,
    });
    const older = event({
      extra: { platform: "qq", readState: 0 },
      ingestedAt: NOW,
    });

    expect(merge(newer, older).extra.readState).toBe(1);
  });

  it("unions person names and identifiers with human names first", () => {
    const existing = {
      id: "person-canonical",
      type: "person",
      subtype: "contact",
      names: ["10001"],
      identifiers: { qq: ["10001"], qqUid: ["u_10001"] },
      source: source({ originalId: "person:10001" }),
      extra: { platform: "qq", remark: null, verified: true },
      ingestedAt: NOW,
    };
    const incoming = {
      ...existing,
      id: "person-incoming",
      names: ["Alice Remark", "Alice", "10001"],
      identifiers: { qq: "10001", qqUid: ["u_10001", "u_alias"] },
      extra: { platform: "qq", remark: "Alice Remark", verified: null },
      ingestedAt: NOW + 10,
    };

    const resolved = mergeQqEntityConflict({
      entityType: "person",
      existing,
      incoming,
      sourceIdentity: {
        ...CANONICAL_SOURCE_IDENTITY,
        originalId: "person:10001",
      },
    });

    expect(resolved.names).toEqual(["Alice Remark", "Alice", "10001"]);
    expect(resolved.identifiers).toEqual({
      qq: ["10001"],
      qqUid: ["u_10001", "u_alias"],
    });
    expect(resolved.extra).toMatchObject({
      remark: "Alice Remark",
      verified: true,
    });
  });

  it("prefers a human group name and unions topic lineage", () => {
    const existing = {
      id: "topic-canonical",
      type: "topic",
      name: "20002",
      derivedFromEvents: ["event-1"],
      source: source({ originalId: "topic:20002" }),
      extra: { platform: "qq", troopUin: "20002", memberCount: 0 },
      ingestedAt: NOW,
    };
    const incoming = {
      ...existing,
      id: "topic-incoming",
      name: "Engineering Group",
      derivedFromEvents: ["event-2"],
      extra: { platform: "qq", memberCount: 42, ownerUin: "10001" },
      ingestedAt: NOW + 10,
    };

    const resolved = mergeQqEntityConflict({
      entityType: "topic",
      existing,
      incoming,
      sourceIdentity: {
        ...CANONICAL_SOURCE_IDENTITY,
        originalId: "topic:20002",
      },
    });

    expect(resolved).toMatchObject({
      id: "topic-canonical",
      name: "Engineering Group",
      derivedFromEvents: ["event-1", "event-2"],
      extra: {
        troopUin: "20002",
        memberCount: 42,
        ownerUin: "10001",
      },
    });
  });

  it("fails closed when canonical source identities differ", () => {
    const existing = event();
    const incoming = event({
      id: "event-other",
      source: source({ originalId: "c2c_msg_table:2" }),
    });

    expect(() =>
      mergeQqEntityConflict({
        entityType: "event",
        existing,
        incoming,
        sourceIdentity: null,
      }),
    ).toThrow(
      expect.objectContaining({ code: "QQ_CANONICAL_IDENTITY_CONFLICT" }),
    );
  });

  it("rejects accidental use for a non-QQ entity", () => {
    const existing = event({
      source: source({ adapter: "wechat" }),
      extra: { platform: "wechat" },
    });
    const incoming = { ...existing, id: "event-other" };

    expect(() =>
      mergeQqEntityConflict({
        entityType: "event",
        existing,
        incoming,
        sourceIdentity: null,
      }),
    ).toThrow(expect.objectContaining({ code: "QQ_QUALITY_RESOLVER_NON_QQ" }));
  });

  it("deep merge never lets null erase populated evidence", () => {
    expect(
      _internal.deepMergePopulated(
        {
          sender: { uid: "u_1", name: "Alice" },
          values: ["direct"],
        },
        {
          sender: { uid: null, name: "Alice Remark" },
          values: ["android"],
        },
      ),
    ).toEqual({
      sender: { uid: "u_1", name: "Alice Remark" },
      values: ["direct", "android"],
    });
  });
});
