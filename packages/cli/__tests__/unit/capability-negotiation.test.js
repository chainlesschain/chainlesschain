/**
 * Bidirectional capability negotiation + N/N-1 downgrade
 * (src/lib/capability-negotiation.js, agent-sdk docs/PROTOCOL.md §1.3).
 *
 * The `cases` block is the SHARED cross-language contract
 * (__tests__/fixtures/capability-negotiation-cases.json): the Java twin
 * (jetbrains-plugin CapabilityNegotiation.java) reads the same file and must
 * agree line-for-line. The rest are JS-side unit tests for the manifest
 * extraction + field-gate application the wire uses.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  negotiateProtocol,
  buildServerOffer,
  normalizeFeatureList,
  applyNegotiationToGate,
  PROTOCOL_FEATURES,
  PROTOCOL_VERSION,
  PROTOCOL_MIN_VERSION,
} from "../../src/lib/capability-negotiation.js";

const FIXTURE = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "fixtures",
      "capability-negotiation-cases.json",
    ),
    "utf-8",
  ),
);

describe("negotiateProtocol — shared cross-language fixture", () => {
  for (const c of FIXTURE.cases) {
    it(c.name, () => {
      const opts = c.featureMinVersion
        ? { featureMinVersion: c.featureMinVersion }
        : {};
      const result = negotiateProtocol(c.server, c.client, opts);
      expect(result.ok).toBe(c.expected.ok);
      expect(result.agreedVersion).toBe(c.expected.agreedVersion);
      expect(result.features).toEqual(c.expected.features);
      expect(result.downgraded).toBe(c.expected.downgraded);
      expect(result.disabledFeatures).toEqual(c.expected.disabledFeatures);
    });
  }
});

describe("negotiateProtocol — defaults + edge shapes", () => {
  it("clientAware reflects whether a client offer was present", () => {
    const server = {
      protocolVersion: 1,
      minProtocolVersion: 1,
      features: PROTOCOL_FEATURES,
    };
    expect(negotiateProtocol(server, null).clientAware).toBe(false);
    expect(negotiateProtocol(server, { protocolVersion: 1 }).clientAware).toBe(
      true,
    );
  });

  it("gives a human reason only when incompatible", () => {
    const server = {
      protocolVersion: 2,
      minProtocolVersion: 2,
      features: ["event_seq"],
    };
    const ok = negotiateProtocol(server, {
      protocolVersion: 2,
      minProtocolVersion: 2,
    });
    expect(ok.reason).toBeNull();
    const bad = negotiateProtocol(server, {
      protocolVersion: 1,
      minProtocolVersion: 1,
    });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/no common protocol version/);
  });

  it("a client with only protocol_version (no min) treats max as its floor", () => {
    // server 1-1, client max=2 (min defaults to 2) → agreed 1, floor max(1,2)=2 → incompatible.
    const server = {
      protocolVersion: 1,
      minProtocolVersion: 1,
      features: ["event_seq"],
    };
    const r = negotiateProtocol(server, { protocolVersion: 2 });
    expect(r.ok).toBe(false);
  });

  it("ignores non-integer / non-positive versions (falls back)", () => {
    const server = { protocolVersion: "x", features: ["trace_id"] };
    const r = negotiateProtocol(server, null);
    expect(r.agreedVersion).toBe(PROTOCOL_VERSION);
    expect(r.features).toEqual(["trace_id"]);
  });

  it("an explicit empty client feature list disables everything", () => {
    const server = {
      protocolVersion: 1,
      minProtocolVersion: 1,
      features: ["event_seq", "trace_id"],
    };
    const r = negotiateProtocol(server, { protocolVersion: 1, features: [] });
    expect(r.features).toEqual([]);
    expect(r.disabledFeatures).toEqual(["event_seq", "trace_id"]);
    expect(r.downgraded).toBe(true);
  });
});

describe("normalizeFeatureList", () => {
  it("accepts arrays, sorts + de-dupes, drops non-strings", () => {
    expect(normalizeFeatureList(["b", "a", "b", 3, null, ""])).toEqual([
      "a",
      "b",
    ]);
  });
  it("accepts the nested-object manifest shape (truthy keys)", () => {
    expect(
      normalizeFeatureList({ trace_id: true, event_seq: false, bare: true }),
    ).toEqual(["bare", "trace_id"]);
  });
  it("returns [] for scalars / null", () => {
    expect(normalizeFeatureList(null)).toEqual([]);
    expect(normalizeFeatureList("trace_id")).toEqual([]);
  });
});

describe("buildServerOffer — from a --capabilities manifest", () => {
  it("extracts version + only the negotiable wire features", () => {
    const manifest = {
      protocol_version: 1,
      min_protocol_version: 1,
      features: {
        bare: true,
        worktree: true,
        event_seq: true,
        tool_use_id: true,
        trace_id: true,
        mcp: { config_file: true },
      },
    };
    const offer = buildServerOffer(manifest);
    expect(offer.protocolVersion).toBe(1);
    expect(offer.minProtocolVersion).toBe(1);
    // runtime capabilities (bare/worktree/mcp) are NOT wire features
    expect(offer.features).toEqual(["event_seq", "tool_use_id", "trace_id"]);
  });

  it("defaults min to min(PROTOCOL_MIN_VERSION, max) when the manifest omits it", () => {
    const offer = buildServerOffer({
      protocol_version: 1,
      features: { trace_id: true },
    });
    expect(offer.minProtocolVersion).toBe(Math.min(PROTOCOL_MIN_VERSION, 1));
    expect(offer.features).toEqual(["trace_id"]);
  });

  it("round-trips: a live server offer with no client keeps every feature", () => {
    const manifest = {
      protocol_version: 1,
      features: { event_seq: true, tool_use_id: true, trace_id: true },
    };
    const r = negotiateProtocol(buildServerOffer(manifest), null);
    expect(r.features).toEqual(["event_seq", "tool_use_id", "trace_id"]);
    expect(r.downgraded).toBe(false);
  });
});

describe("applyNegotiationToGate — teeth on the emit path", () => {
  it("leaves every field stamped for a full-feature result", () => {
    const gate = { seq: true, trace_id: true, tool_use_id: true };
    applyNegotiationToGate({ ok: true, features: PROTOCOL_FEATURES }, gate);
    expect(gate).toEqual({ seq: true, trace_id: true, tool_use_id: true });
  });

  it("suppresses the field of a feature the client dropped", () => {
    const gate = { seq: true, trace_id: true, tool_use_id: true };
    applyNegotiationToGate({ ok: true, features: ["trace_id"] }, gate);
    expect(gate).toEqual({ seq: false, trace_id: true, tool_use_id: false });
  });

  it("does not touch the gate on an incompatible (ok:false) result", () => {
    const gate = { seq: true, trace_id: true, tool_use_id: true };
    applyNegotiationToGate({ ok: false, features: [] }, gate);
    expect(gate).toEqual({ seq: true, trace_id: true, tool_use_id: true });
  });
});
