import { expect, it } from "vitest";
import { runMemoryCorrectionProviderJourney } from "../fixtures/memory-correction-provider-journey.js";

it("public memory correction reaches physical provider bodies and restarted stream journals", async () => {
  const result = await runMemoryCorrectionProviderJourney({
    evidenceDir: process.env.CC_MEMORY_CORRECTION_EVIDENCE_DIR,
  });
  expect(result.passed).toBe(true);
  expect(result.cleanupComplete).toBe(true);
  expect(result.providerCalls).toBe(4);
  expect(result.results).toHaveLength(2);
  expect(result.referenceBackedCorrection).toEqual({
    errorCode: "memory_correction_content_ref_unsupported",
    recordAndReferenceUnchanged: true,
    additionalProviderCalls: 0,
  });
}, 240_000);
