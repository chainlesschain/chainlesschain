import { describe, expect, it } from "vitest";
import {
  buildMcpEffectContract,
  mcpEffectDescriptorFields,
  normalizeMcpToolAnnotations,
} from "../../src/lib/mcp-effect-contract.js";

describe("MCP effect contract", () => {
  it("preserves standard annotations without treating them as trust", () => {
    const fields = mcpEffectDescriptorFields({
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });

    expect(fields).toMatchObject({
      isReadOnly: true,
      riskLevel: "low",
      effectContract: {
        version: 1,
        declaredEffect: "read",
        authorizedEffect: null,
        sourceTrusted: false,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    });
  });

  it("never infers read-only from a low risk label", () => {
    const contract = buildMcpEffectContract({ riskLevel: "low" });
    expect(contract).toMatchObject({
      declaredEffect: "unknown",
      authorizedEffect: null,
      sourceTrusted: false,
      riskLevel: "medium",
    });
  });

  it("keeps source trust separate from destructive effect", () => {
    const contract = buildMcpEffectContract(
      { annotations: { readOnlyHint: false, destructiveHint: true } },
      { sourceTrusted: true, provenance: "managed-settings" },
    );
    expect(contract).toMatchObject({
      declaredEffect: "destructive",
      authorizedEffect: null,
      sourceTrusted: true,
      riskLevel: "high",
      provenance: "managed-settings",
    });
  });

  it("accepts explicit legacy boolean fields but not truthy strings", () => {
    expect(normalizeMcpToolAnnotations({ isReadOnly: true }).readOnlyHint).toBe(
      true,
    );
    expect(
      normalizeMcpToolAnnotations({ isReadOnly: "true" }).readOnlyHint,
    ).toBeNull();
  });
});
