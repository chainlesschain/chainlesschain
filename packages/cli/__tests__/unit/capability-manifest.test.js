/**
 * Canonical capability manifest (P1-9 single-source generator from
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md). Pure module: no RNG /
 * clock / fs. The load-bearing tests are the DRIFT GUARDS — they assert the
 * live, hand-authored constants in capability-negotiation.js and
 * headless-manifest.js still equal the manifest's projection, so a v2 field
 * added to one place but not the manifest fails the build.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CAPABILITY_MANIFEST,
  toProtocolFeatures,
  toFeatureMinVersion,
  toFieldGate,
  toServerOffer,
  toAgentFeatureFlags,
  buildCompatFixture,
  capabilityDigest,
  renderBehaviorMatrix,
  renderProtocolDoc,
  diffCapabilities,
} from "../../src/lib/capability-manifest.js";
import {
  PROTOCOL_VERSION,
  PROTOCOL_MIN_VERSION,
  PROTOCOL_FEATURES,
  FEATURE_MIN_VERSION,
  negotiateProtocol,
  applyNegotiationToGate,
} from "../../src/lib/capability-negotiation.js";
import { buildAgentCapabilities } from "../../src/lib/headless-manifest.js";

describe("drift guard: manifest ⇄ capability-negotiation.js", () => {
  it("protocol version + min match the negotiation constants", () => {
    expect(CAPABILITY_MANIFEST.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(CAPABILITY_MANIFEST.minProtocolVersion).toBe(PROTOCOL_MIN_VERSION);
  });

  it("toProtocolFeatures() equals PROTOCOL_FEATURES (same keys, same order)", () => {
    expect(toProtocolFeatures()).toEqual(PROTOCOL_FEATURES);
  });

  it("toFeatureMinVersion() equals FEATURE_MIN_VERSION", () => {
    expect(toFeatureMinVersion()).toEqual(FEATURE_MIN_VERSION);
  });

  it("toFieldGate() matches the fields the negotiator actually stamps", () => {
    // FEATURE_TO_FIELD is private; prove the field names via the live gate.
    const result = { ok: true, features: PROTOCOL_FEATURES };
    const gate = applyNegotiationToGate(result, {});
    const stamped = Object.keys(gate)
      .filter((k) => gate[k] === true)
      .sort();
    const manifestFields = Object.values(toFieldGate()).sort();
    expect(manifestFields).toEqual(stamped);
  });

  it("toServerOffer() drives negotiateProtocol to a full-feature agreement", () => {
    const res = negotiateProtocol(toServerOffer(), null);
    expect(res.ok).toBe(true);
    expect(res.agreedVersion).toBe(PROTOCOL_VERSION);
    expect(res.features).toEqual([...PROTOCOL_FEATURES].sort());
  });
});

describe("drift guard: manifest ⇄ headless-manifest.js", () => {
  it("toAgentFeatureFlags() deep-equals buildAgentCapabilities().features", () => {
    expect(toAgentFeatureFlags()).toEqual(buildAgentCapabilities().features);
  });

  it("permission modes / io formats match the live capability manifest", () => {
    const caps = buildAgentCapabilities();
    expect([...CAPABILITY_MANIFEST.permissionModes]).toEqual(
      caps.permission_modes,
    );
    expect([...CAPABILITY_MANIFEST.outputFormats]).toEqual(caps.output_formats);
    expect([...CAPABILITY_MANIFEST.inputFormats]).toEqual(caps.input_formats);
  });
});

describe("buildCompatFixture", () => {
  it("is deterministic and carries a digest", () => {
    const a = buildCompatFixture();
    const b = buildCompatFixture();
    expect(a).toEqual(b);
    expect(a.digest).toBe(capabilityDigest());
    expect(a.features).toEqual(PROTOCOL_FEATURES);
  });

  it("the fixture a JetBrains/VS twin pins negotiates cleanly", () => {
    const fixture = buildCompatFixture();
    const res = negotiateProtocol(
      {
        protocolVersion: fixture.protocolVersion,
        minProtocolVersion: fixture.minProtocolVersion,
        features: fixture.features,
      },
      { protocolVersion: fixture.protocolVersion, features: fixture.features },
    );
    expect(res.ok).toBe(true);
    expect(res.features).toEqual([...fixture.features].sort());
  });
});

describe("capabilityDigest", () => {
  it("changes when a wire feature changes, stable otherwise", () => {
    const base = capabilityDigest();
    expect(capabilityDigest()).toBe(base);
    const mutated = {
      ...CAPABILITY_MANIFEST,
      wireFeatures: [
        ...CAPABILITY_MANIFEST.wireFeatures,
        { key: "v2_field", field: "v2", minVersion: 2, description: "x" },
      ],
    };
    expect(capabilityDigest(mutated)).not.toBe(base);
  });
});

describe("renderBehaviorMatrix / renderProtocolDoc", () => {
  it("matrix has one row per wire feature with its field + min version", () => {
    const rows = renderBehaviorMatrix();
    expect(rows.map((r) => r.feature)).toEqual(PROTOCOL_FEATURES);
    for (const r of rows) {
      expect(r.negotiable).toBe(true);
      expect(typeof r.field).toBe("string");
      expect(r.minVersion).toBeGreaterThanOrEqual(1);
    }
  });

  it("doc renders every feature, is deterministic, ends with a newline", () => {
    const doc = renderProtocolDoc();
    expect(doc).toBe(renderProtocolDoc());
    for (const f of PROTOCOL_FEATURES) expect(doc).toContain(`\`${f}\``);
    expect(doc.endsWith("\n")).toBe(true);
  });

  // CI byte-diff drift guard (P1-9 "renderProtocolDoc 接进 CI byte-diff 签入副本"):
  // the checked-in generated doc MUST equal the manifest projection byte-for-byte.
  // A v2 wire field added to CAPABILITY_MANIFEST but not regenerated here (via
  // `npm run docs:protocol`) fails this test — the same guarantee gen-cli-
  // reference gives, but run inside the suite so drift can never merge green.
  it("checked-in PROTOCOL_CAPABILITY_MANIFEST.generated.md matches renderProtocolDoc() byte-for-byte", () => {
    const docPath = fileURLToPath(
      new URL(
        "../../../../docs/cli/PROTOCOL_CAPABILITY_MANIFEST.generated.md",
        import.meta.url,
      ),
    );
    const committed = readFileSync(docPath, "utf-8");
    expect(committed).toBe(renderProtocolDoc());
  });
});

describe("diffCapabilities", () => {
  it("no change → empty diff", () => {
    const d = diffCapabilities(CAPABILITY_MANIFEST, CAPABILITY_MANIFEST);
    expect(d.protocolChange).toBeNull();
    expect(d.addedWireFeatures).toEqual([]);
    expect(d.removedWireFeatures).toEqual([]);
    expect(d.changedWireFeatures).toEqual([]);
  });

  it("detects an added wire feature (release-notes signal)", () => {
    const prev = {
      ...CAPABILITY_MANIFEST,
      wireFeatures: CAPABILITY_MANIFEST.wireFeatures.filter(
        (f) => f.key !== "trace_id",
      ),
    };
    const d = diffCapabilities(prev, CAPABILITY_MANIFEST);
    expect(d.addedWireFeatures).toEqual(["trace_id"]);
    expect(d.removedWireFeatures).toEqual([]);
  });

  it("detects a protocol bump and a runtime feature removal", () => {
    const next = {
      ...CAPABILITY_MANIFEST,
      protocolVersion: 2,
      runtimeFeatures: CAPABILITY_MANIFEST.runtimeFeatures.filter(
        (k) => k !== "worktree",
      ),
    };
    const d = diffCapabilities(CAPABILITY_MANIFEST, next);
    expect(d.protocolChange).toEqual({ from: 1, to: 2 });
    expect(d.removedRuntimeFeatures).toEqual(["worktree"]);
  });

  it("detects a field/min-version change on an existing feature", () => {
    const next = {
      ...CAPABILITY_MANIFEST,
      wireFeatures: CAPABILITY_MANIFEST.wireFeatures.map((f) =>
        f.key === "event_seq" ? { ...f, minVersion: 2 } : f,
      ),
    };
    const d = diffCapabilities(CAPABILITY_MANIFEST, next);
    expect(d.changedWireFeatures).toHaveLength(1);
    expect(d.changedWireFeatures[0].feature).toBe("event_seq");
    expect(d.changedWireFeatures[0].to.minVersion).toBe(2);
  });
});
