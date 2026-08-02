import { describe, expect, it } from "vitest";

import {
  decodePersistedMessage,
  DURABLE_SYSTEM_MESSAGE_KINDS,
  encodePersistedMessage,
  getDurableSystemMessageProvenance,
  markDurableSystemMessage,
  projectCanonicalResumeMessages,
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

    const decoded = decodePersistedMessage(
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

  it("drops stale and unknown system provenance from canonical resume", () => {
    const summary = encodePersistedMessage(
      markDurableSystemMessage(
        { role: "system", content: "keep summary" },
        DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
      ),
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
        summary,
        { role: "user", content: "keep user" },
        { role: "assistant", content: "keep assistant" },
      ]),
    ).toEqual([
      { role: "system", content: "keep summary" },
      { role: "user", content: "keep user" },
      { role: "assistant", content: "keep assistant" },
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
