/**
 * Offline protocol replay (P1-9 "离线协议回放" of
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md). Pure module: no fs /
 * clock / RNG. Replays a recorded stream-json session under a negotiation to
 * (a) reproduce the on-wire frames (gated-off fields stripped) and (b) audit a
 * recording for forward-compat violations (a field a peer at the agreed version
 * must not have received). The gateable field set is projected from the ONE
 * canonical capability-manifest, so it can't drift from the negotiated features.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  GATEABLE_FIELDS,
  gateFromNegotiation,
  replayFrame,
  replaySession,
  auditRecordedSession,
  sessionDigest,
} from "../../src/lib/protocol-replay.js";
import { toFieldGate } from "../../src/lib/capability-manifest.js";
import { PROTOCOL_VERSION } from "../../src/lib/capability-negotiation.js";

const GOLDEN_PATH = fileURLToPath(
  new URL("../fixtures/protocol-session.golden.ndjson", import.meta.url),
);
const GOLDEN_FRAMES = readFileSync(GOLDEN_PATH, "utf-8")
  .trim()
  .split(/\r?\n/)
  .map((l) => JSON.parse(l));

// A tiny recorded session captured at FULL capability (every negotiable wire
// field present): seq + trace_id + tool_use_id.
const RECORDED = [
  { type: "system", subtype: "init", seq: 1, trace_id: "tr-abc" },
  {
    type: "tool_use",
    name: "read_file",
    seq: 2,
    trace_id: "tr-abc",
    tool_use_id: "tu-1",
  },
  {
    type: "tool_result",
    seq: 3,
    trace_id: "tr-abc",
    tool_use_id: "tu-1",
    content: "ok",
  },
  { type: "result", subtype: "success", seq: 4, trace_id: "tr-abc" },
];

const FULL_SERVER = {
  protocolVersion: PROTOCOL_VERSION,
  minProtocolVersion: 1,
  features: ["event_seq", "trace_id", "tool_use_id"],
};

describe("GATEABLE_FIELDS", () => {
  it("is exactly the single-sourced wire field set, sorted + de-duped", () => {
    const expected = [...new Set(Object.values(toFieldGate()))].sort();
    expect(GATEABLE_FIELDS).toEqual(expected);
    // The three protocol-v1 wire fields.
    expect(GATEABLE_FIELDS).toEqual(["seq", "tool_use_id", "trace_id"]);
  });
});

describe("gateFromNegotiation", () => {
  it("legacy peer (no client offer) enables every server wire feature", () => {
    const { gate, enabledFields, gatedFields } = gateFromNegotiation({
      server: FULL_SERVER,
      client: null,
    });
    expect(gate).toEqual({ seq: true, trace_id: true, tool_use_id: true });
    expect(enabledFields).toEqual(["seq", "tool_use_id", "trace_id"]);
    expect(gatedFields).toEqual([]);
  });

  it("client that narrows features gates the omitted ones OFF", () => {
    const { gate, enabledFields, gatedFields } = gateFromNegotiation({
      server: FULL_SERVER,
      client: { protocolVersion: PROTOCOL_VERSION, features: ["event_seq"] },
    });
    expect(gate.seq).toBe(true);
    expect(gate.trace_id).not.toBe(true);
    expect(gate.tool_use_id).not.toBe(true);
    expect(enabledFields).toEqual(["seq"]);
    expect(gatedFields).toEqual(["tool_use_id", "trace_id"]);
  });

  it("incompatible negotiation fails closed — every gateable field OFF", () => {
    const { negotiation, gatedFields, enabledFields } = gateFromNegotiation({
      server: { protocolVersion: 1, minProtocolVersion: 1, features: [] },
      // client demands a version floor the server can't meet
      client: { protocolVersion: 2, minProtocolVersion: 2 },
    });
    expect(negotiation.ok).toBe(false);
    expect(enabledFields).toEqual([]);
    expect(gatedFields).toEqual(GATEABLE_FIELDS);
  });
});

describe("replayFrame", () => {
  it("strips gated-off wire fields, keeps everything else, no mutation", () => {
    const gate = { seq: true, trace_id: false, tool_use_id: false };
    const frame = {
      type: "tool_use",
      name: "read_file",
      seq: 2,
      trace_id: "tr",
      tool_use_id: "tu-1",
    };
    const out = replayFrame(frame, gate);
    expect(out).toEqual({ type: "tool_use", name: "read_file", seq: 2 });
    // input untouched
    expect(frame.trace_id).toBe("tr");
  });

  it("passes non-object frames through unchanged", () => {
    expect(replayFrame(null, {})).toBeNull();
    expect(replayFrame("x", {})).toBe("x");
  });
});

describe("replaySession", () => {
  it("full capability → frames unchanged, stable digest", () => {
    const a = replaySession(RECORDED, { server: FULL_SERVER, client: null });
    expect(a.frames).toEqual(RECORDED);
    // deterministic
    const b = replaySession(RECORDED, { server: FULL_SERVER, client: null });
    expect(b.digest).toBe(a.digest);
  });

  it("downgraded client → trace_id + tool_use_id stripped, digest differs", () => {
    const full = replaySession(RECORDED, { server: FULL_SERVER, client: null });
    const down = replaySession(RECORDED, {
      server: FULL_SERVER,
      client: { protocolVersion: PROTOCOL_VERSION, features: ["event_seq"] },
    });
    for (const f of down.frames) {
      expect(f).not.toHaveProperty("trace_id");
      expect(f).not.toHaveProperty("tool_use_id");
    }
    // seq survives
    expect(down.frames[1].seq).toBe(2);
    expect(down.digest).not.toBe(full.digest);
  });

  it("empty / non-array input → no frames, stable empty digest", () => {
    expect(replaySession([], { server: FULL_SERVER }).frames).toEqual([]);
    expect(replaySession(undefined, { server: FULL_SERVER }).digest).toBe(
      sessionDigest([]),
    );
  });
});

describe("auditRecordedSession", () => {
  it("recording that obeys the negotiation → ok, no violations", () => {
    // Replay to the wire under a downgrade, then audit the RESULT — it must obey.
    const down = replaySession(RECORDED, {
      server: FULL_SERVER,
      client: { protocolVersion: PROTOCOL_VERSION, features: ["event_seq"] },
    });
    const audit = auditRecordedSession(down.frames, {
      server: FULL_SERVER,
      client: { protocolVersion: PROTOCOL_VERSION, features: ["event_seq"] },
    });
    expect(audit.ok).toBe(true);
    expect(audit.violations).toEqual([]);
  });

  it("recording carrying a gated-off field → violation with index + field + type", () => {
    // The full recording carries trace_id/tool_use_id but negotiation only has seq.
    const audit = auditRecordedSession(RECORDED, {
      server: FULL_SERVER,
      client: { protocolVersion: PROTOCOL_VERSION, features: ["event_seq"] },
    });
    expect(audit.ok).toBe(false);
    // frame 0 leaks trace_id; frame 1 leaks trace_id + tool_use_id; etc.
    expect(audit.violations).toContainEqual({
      index: 0,
      field: "trace_id",
      type: "system",
    });
    expect(audit.violations).toContainEqual({
      index: 1,
      field: "tool_use_id",
      type: "tool_use",
    });
  });

  it("incompatible negotiation → every present wire field is a violation (fail-closed)", () => {
    const audit = auditRecordedSession(RECORDED, {
      server: { protocolVersion: 1, minProtocolVersion: 1, features: [] },
      client: { protocolVersion: 2, minProtocolVersion: 2 },
    });
    expect(audit.ok).toBe(false);
    // frame 0 has seq + trace_id → 2 violations; every present gateable field flagged
    const frame0 = audit.violations
      .filter((v) => v.index === 0)
      .map((v) => v.field);
    expect(frame0.sort()).toEqual(["seq", "trace_id"]);
  });

  it("skips non-object frames without throwing", () => {
    const audit = auditRecordedSession([null, "x", { type: "t", seq: 1 }], {
      server: FULL_SERVER,
      client: { protocolVersion: PROTOCOL_VERSION, features: [] },
    });
    // only the real frame's seq is a violation (features:[] gates seq off)
    expect(audit.violations).toEqual([{ index: 2, field: "seq", type: "t" }]);
  });
});

describe("golden recording", () => {
  // Pins the checked-in fixture: full-capability replay of the golden session is
  // frame-identical (nothing stripped) and audits clean. A change to gating that
  // altered the on-wire shape would flip this — the offline replay drift guard.
  it("golden fixture replays byte-identical at full capability + audits clean", () => {
    const replayed = replaySession(GOLDEN_FRAMES, {
      server: FULL_SERVER,
      client: null,
    });
    expect(replayed.frames).toEqual(GOLDEN_FRAMES);
    const audit = auditRecordedSession(GOLDEN_FRAMES, {
      server: FULL_SERVER,
      client: null,
    });
    expect(audit.ok).toBe(true);
  });

  it("golden fixture under a v1/event_seq-only client strips the 5 extra fields", () => {
    const audit = auditRecordedSession(GOLDEN_FRAMES, {
      server: FULL_SERVER,
      client: { protocolVersion: PROTOCOL_VERSION, features: ["event_seq"] },
    });
    expect(audit.ok).toBe(false);
    // 4 trace_id (one per frame) + 2 tool_use_id (tool_use + tool_result) = 6
    expect(audit.violations).toHaveLength(6);
  });
});

describe("sessionDigest", () => {
  it("is key-order independent", () => {
    const a = sessionDigest([{ type: "x", seq: 1, trace_id: "t" }]);
    const b = sessionDigest([{ trace_id: "t", seq: 1, type: "x" }]);
    expect(a).toBe(b);
  });

  it("changes when a field value changes", () => {
    const a = sessionDigest([{ type: "x", seq: 1 }]);
    const b = sessionDigest([{ type: "x", seq: 2 }]);
    expect(a).not.toBe(b);
  });
});
