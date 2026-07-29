import { describe, expect, it } from "vitest";
import { collectOtlpStatus } from "../../src/commands/status.js";

describe("cc status OpenTelemetry section", () => {
  it("is stable and machine-readable when Collector export is disabled", () => {
    expect(collectOtlpStatus(null)).toEqual({
      enabled: false,
      protocol: "http/json",
      tracesEndpoint: null,
      metricsEndpoint: null,
      queued: 0,
      queueCapacity: 0,
      queuePressure: "normal",
      enqueued: 0,
      exported: 0,
      retried: 0,
      dropped: 0,
      permanentFailures: 0,
      recovered: 0,
      spoolErrors: 0,
      configurationErrors: [],
      lastError: null,
    });
  });

  it("surfaces endpoint, backpressure and delivery counters from the runtime", () => {
    const stats = {
      enabled: true,
      protocol: "http/json",
      tracesEndpoint: "https://otel.example/v1/traces",
      metricsEndpoint: "https://otel.example/v1/metrics",
      queued: 80,
      queueCapacity: 100,
      queuePressure: "high",
      retried: 4,
      dropped: 2,
      permanentFailures: 1,
    };
    expect(
      collectOtlpStatus({
        getStats: () => stats,
      }),
    ).toBe(stats);
  });
});
