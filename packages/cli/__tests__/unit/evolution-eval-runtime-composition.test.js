import { describe, expect, it, vi } from "vitest";
import {
  EVOLUTION_EVAL_COMPOSITION_UNAVAILABLE_CODE,
  captureEvolutionEvalRuntimeComposition,
  createEvolutionEvalRuntimeComposition,
  createEvolutionEvalRuntimeStageConfiguration,
} from "../../src/lib/evolution/evolution-eval-runtime-composition.js";

describe("production Eval composition admission", () => {
  it.each([
    undefined,
    null,
    {},
    { aggregator: {}, receiptVerifier: {}, durability: {} },
  ])("fails closed for incomplete construction ports (%j)", (options) => {
    expect(() => createEvolutionEvalRuntimeComposition(options)).toThrow(
      expect.objectContaining({
        code: EVOLUTION_EVAL_COMPOSITION_UNAVAILABLE_CODE,
      }),
    );
    expect(() => captureEvolutionEvalRuntimeComposition(options)).toThrow(
      /branded/,
    );
  });

  it("rejects configuration proxies and accessors without invoking them", () => {
    const trap = vi.fn(() => {
      throw new Error("must not run");
    });
    const proxy = new Proxy(
      {},
      { get: trap, ownKeys: trap, getPrototypeOf: trap },
    );
    expect(() => createEvolutionEvalRuntimeComposition(proxy)).toThrow(
      /plain data/,
    );
    expect(() =>
      createEvolutionEvalRuntimeStageConfiguration({ configuration: proxy }),
    ).toThrow(/plain data/);
    const options = {
      descriptor: {},
      aggregatorOptions: {},
      verificationLimits: {},
      durabilityOptions: {},
    };
    Object.defineProperty(options, "aggregatorOptions", {
      enumerable: true,
      get: trap,
    });
    expect(() => createEvolutionEvalRuntimeComposition(options)).toThrow(
      /own data/,
    );
    expect(trap).not.toHaveBeenCalled();
  });

  it.each([async () => ({}), function* () {}, new Proxy(() => ({}), {})])(
    "requires a synchronous non-proxy deployment factory",
    (createComposition) => {
      expect(() =>
        createEvolutionEvalRuntimeStageConfiguration({
          tenantId: "tenant:test",
          runId: "run:test",
          configuration: {
            descriptor: {
              authorityId: "authority:test",
              revision: 1,
              handlerArtifactDigest: `sha256:${"a".repeat(64)}`,
            },
            createComposition,
            planRef: {},
            expectedReceipt: {},
            usage: {},
          },
        }),
      ).toThrow(/synchronous factory/);
    },
  );
});
