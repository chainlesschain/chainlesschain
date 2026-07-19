/**
 * OTLP Exporter - Minimal OTLP/HTTP trace exporter for M6 observability
 * Strictly bounded to observability layer only, no cross-layer calls
 */
export class OTLPTraceExporter {
  constructor(options = {}) {
    this.endpoint = options.endpoint || "http://localhost:4318/v1/traces";
    this._queue = [];
  }

  export(span) {
    const payload = {
      resourceSpans: [{
        resource: { attributes: [{ key: "service.name", value: { stringValue: "cc-cli" } }] },
        scopeSpans: [{
          spans: [{
            traceId: span.traceId,
            spanId: span.spanId,
            name: span.name || "span",
            kind: 1,
            startTimeUnixNano: span.startTime ? BigInt(span.startTime * 1e6).toString() : BigInt(Date.now() * 1e6).toString(),
            endTimeUnixNano: span.endTime ? BigInt(span.endTime * 1e6).toString() : undefined,
            attributes: (span.metadata ? Object.entries(span.metadata).map(([k, v]) => ({ key: k, value: { stringValue: String(v) } })) : []),
          }]
        }]
      }]
    };
    // Fire and forget, no blocking
    fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
    return true;
  }
}

let defaultExporter = null;
export function initOTLPExporter(endpoint) {
  if (!defaultExporter && endpoint) {
    defaultExporter = new OTLPTraceExporter({ endpoint: endpoint.endsWith("/v1/traces") ? endpoint : endpoint.replace(/\/?$/, "/v1/traces") });
    globalThis.ccRuntime?.traceContext.onEnd((span) => defaultExporter.export(span));
  }
  return defaultExporter;
}
