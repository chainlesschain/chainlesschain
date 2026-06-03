export function createTelemetryRecord(metric = {}, meta = {}) {
  return {
    kind: metric.kind || "telemetry",
    provider: metric.provider || null,
    model: metric.model || null,
    source: metric.source || null,
    strategy: metric.strategy || null,
    variant: metric.variant || metric.abVariant || null,
    savedTokens:
      typeof metric.savedTokens === "number"
        ? metric.savedTokens
        : typeof metric.saved === "number"
          ? metric.saved
          : null,
    originalTokens:
      typeof metric.originalTokens === "number" ? metric.originalTokens : null,
    compressedTokens:
      typeof metric.compressedTokens === "number" ? metric.compressedTokens : null,
    ratio: typeof metric.ratio === "number" ? metric.ratio : null,
    timestamp: metric.timestamp || Date.now(),
    meta,
  };
}
