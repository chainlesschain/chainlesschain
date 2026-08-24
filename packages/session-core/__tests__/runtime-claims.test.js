import { describe, it, expect } from "vitest";
import runtimeClaims from "../lib/runtime-claims.js";

const {
  RUNTIME_MODE,
  TERMINAL_EVIDENCE_KIND,
  createRuntimeClaims,
  hasTerminalSuccessEvidence,
} = runtimeClaims;

const RECEIPT = `sha256:${"a".repeat(64)}`;

describe("runtime claims", () => {
  it("publishes mutually exclusive mode flags", () => {
    expect(createRuntimeClaims({ mode: RUNTIME_MODE.SIMULATED })).toEqual({
      schema: "cc-runtime-claims/v1",
      mode: "simulated",
      validateOnly: false,
      simulated: true,
      realExecution: false,
      durable: false,
      crashSafe: false,
      isolatedWrites: false,
    });
  });

  it("rejects unknown modes", () => {
    expect(() => createRuntimeClaims({ mode: "maybe" })).toThrow(
      /Unsupported runtime mode/,
    );
  });

  it("requires real execution, a success event and an immutable receipt", () => {
    const claims = createRuntimeClaims({ mode: RUNTIME_MODE.REAL_EXECUTION });
    const evidence = [
      {
        kind: TERMINAL_EVIDENCE_KIND.RUNTIME_EVENT,
        outcome: "completed",
        source: "codex-exec-jsonl-v1",
      },
      {
        kind: TERMINAL_EVIDENCE_KIND.OUTPUT_RECEIPT,
        digest: RECEIPT,
      },
    ];
    expect(hasTerminalSuccessEvidence(claims, evidence)).toBe(true);
    expect(hasTerminalSuccessEvidence(claims, evidence.slice(0, 1))).toBe(
      false,
    );
    expect(
      hasTerminalSuccessEvidence(
        createRuntimeClaims({ mode: RUNTIME_MODE.SIMULATED }),
        evidence,
      ),
    ).toBe(false);
  });
});
