import assert from "node:assert/strict";
import test from "node:test";
import { nativePublicPlanningContext } from "../scripts/verify01-native-task-campaign.mjs";

test("old public manifests keep their original launcher options", () => {
  assert.deepEqual(nativePublicPlanningContext(null), {});
  assert.deepEqual(
    nativePublicPlanningContext({ versions: { cli: "0.166.136" } }),
    {},
  );
});

test("an explicitly bound released CLI retains the 32768-token planning window", () => {
  const manifest = {
    versions: { cli: "0.166.138" },
    publicGeneratorProof: { path: "proof.json", digest: "bound elsewhere" },
    diagnosticExecution: { contextWindowTokens: 32768 },
  };
  assert.deepEqual(nativePublicPlanningContext(manifest), {
    contextWindowTokens: 32768,
  });
  for (const tokens of [16384, 65536, "32768", null]) {
    assert.throws(() =>
      nativePublicPlanningContext({
        ...manifest,
        diagnosticExecution: { contextWindowTokens: tokens },
      }),
    );
  }
  assert.throws(() =>
    nativePublicPlanningContext({
      ...manifest,
      publicGeneratorProof: undefined,
    }),
  );
  assert.throws(() =>
    nativePublicPlanningContext({
      ...manifest,
      versions: { cli: "0.166.136" },
    }),
  );
  assert.throws(() =>
    nativePublicPlanningContext({
      ...manifest,
      diagnosticExecution: { contextWindowTokens: 32768, modelTurns: 100 },
    }),
  );
});
