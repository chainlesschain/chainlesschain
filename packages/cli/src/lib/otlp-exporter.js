/**
 * Backward-compatible facade. The canonical implementation lives under
 * `lib/observability/`; keeping this module avoids breaking plugin imports.
 */
import { OtlpExporter, initObservability } from "./observability/index.js";

export class OTLPTraceExporter extends OtlpExporter {
  export(span) {
    return this.exportSpans([span]);
  }
}

export function initOTLPExporter(endpoint) {
  return initObservability({ endpoint }).exporter;
}

export { OtlpExporter };
