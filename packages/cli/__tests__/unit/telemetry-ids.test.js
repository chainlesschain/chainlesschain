/**
 * Unified OTel id/attribute normalization (P2) — canonical ids, content
 * redaction default-off, and cardinality bounding. Pure module.
 */
import { describe, it, expect } from "vitest";
import {
  buildTelemetryAttributes,
  sanitizeIdValue,
  redactContent,
  allowedAttributeKeys,
  auditAttributes,
  TELEMETRY_ID_KEYS,
  TELEMETRY_CONTENT_SENTINEL,
} from "../../src/lib/telemetry-ids.js";

describe("sanitizeIdValue", () => {
  it("keeps id charset, caps length, strips control/whitespace", () => {
    expect(sanitizeIdValue("sess 01\n02")).toBe("sess_01_02");
    expect(sanitizeIdValue("wf.run-42:a/b@x")).toBe("wf.run-42:a/b@x");
    expect(sanitizeIdValue("x".repeat(200))).toHaveLength(128);
    expect(sanitizeIdValue("")).toBeUndefined();
    expect(sanitizeIdValue(null)).toBeUndefined();
    expect(sanitizeIdValue(1234)).toBe("1234"); // non-string stringified
  });
});

describe("buildTelemetryAttributes — canonical ids", () => {
  it("maps mixed aliases to stable OTel keys", () => {
    const attrs = buildTelemetryAttributes({
      sessionId: "S1",
      turn_id: "T1",
      toolUseId: "tu_1",
      parentAgentId: "A0",
      "agent.id": "A1",
      workflowRunId: "wf_9",
      permissionDecisionId: "pd_3",
      checkpointId: "cp_2",
      promptId: "p_7",
    });
    expect(attrs["session.id"]).toBe("S1");
    expect(attrs["turn.id"]).toBe("T1");
    expect(attrs["prompt.id"]).toBe("p_7");
    expect(attrs["tool_use.id"]).toBe("tu_1");
    expect(attrs["agent.id"]).toBe("A1");
    expect(attrs["parent_agent.id"]).toBe("A0");
    expect(attrs["workflow.run_id"]).toBe("wf_9");
    expect(attrs["permission.decision_id"]).toBe("pd_3");
    expect(attrs["checkpoint.id"]).toBe("cp_2");
  });

  it("omits absent ids (no empty keys)", () => {
    const attrs = buildTelemetryAttributes({ sessionId: "S1" });
    expect(Object.keys(attrs)).toEqual(["session.id"]);
  });

  it("exposes the full id key set", () => {
    expect(TELEMETRY_ID_KEYS).toContain("permission.decision_id");
    expect(TELEMETRY_ID_KEYS).toHaveLength(9);
  });
});

describe("content redaction (default off)", () => {
  it("redacts prompt/response/tool arguments by default", () => {
    const attrs = buildTelemetryAttributes({
      sessionId: "S1",
      prompt: "secret user text",
      response: "model answer",
      toolArguments: { path: "/etc/passwd" },
    });
    expect(attrs["content.prompt"]).toBe(TELEMETRY_CONTENT_SENTINEL);
    expect(attrs["content.response"]).toBe(TELEMETRY_CONTENT_SENTINEL);
    expect(attrs["content.tool_arguments"]).toBe(TELEMETRY_CONTENT_SENTINEL);
  });

  it("emits content only when explicitly opted in, still length-capped", () => {
    const attrs = buildTelemetryAttributes(
      { prompt: "hello", toolArguments: { a: 1 } },
      { includeContent: true },
    );
    expect(attrs["content.prompt"]).toBe("hello");
    expect(attrs["content.tool_arguments"]).toBe('{"a":1}');

    const big = redactContent("z".repeat(9000), true);
    expect(big.endsWith("…[truncated]")).toBe(true);
    expect(big.length).toBeLessThan(9000);
  });

  it("omits content keys when no content present", () => {
    const attrs = buildTelemetryAttributes({ sessionId: "S1" });
    expect(attrs["content.prompt"]).toBeUndefined();
  });
});

describe("cardinality bounding + audit", () => {
  it("only emits allow-listed keys — foreign keys are dropped", () => {
    const attrs = buildTelemetryAttributes({
      sessionId: "S1",
      randomUserLabel: "high-cardinality-value",
      email: "a@b.com",
    });
    expect(attrs.randomUserLabel).toBeUndefined();
    expect(attrs.email).toBeUndefined();
    for (const k of Object.keys(attrs)) {
      expect(allowedAttributeKeys()).toContain(k);
    }
  });

  it("auditAttributes flags foreign keys and un-redacted content", () => {
    expect(auditAttributes({ "session.id": "S1" })).toEqual([]);
    const bad = auditAttributes({
      "user.email": "a@b.com",
      "content.prompt": "leaked!",
    });
    expect(bad).toEqual([
      { key: "user.email", reason: "key-not-allowlisted" },
      { key: "content.prompt", reason: "content-not-redacted" },
    ]);
    // opted-in content is allowed
    expect(
      auditAttributes({ "content.prompt": "shown" }, { includeContent: true }),
    ).toEqual([]);
  });
});
