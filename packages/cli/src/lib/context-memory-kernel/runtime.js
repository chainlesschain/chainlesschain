import { createLocalSemanticSource } from "./local-semantic-source.js";
import { ContextMemoryKernel } from "@chainlesschain/context-memory-kernel";
import { SegmentedMemoryPort } from "./segmented-memory-port.js";
import { JsonlSessionContextPort } from "./jsonl-session-context-port.js";
import { CliLegacyMemoryPrivacyPurgePort } from "./privacy-purge-port.js";
import {
  createCliAuthority,
  resolveCliContextMemoryCutover,
} from "./authority.js";

export function createCliContextMemoryRuntime(options = {}) {
  const scopeKey =
    options.scopeKey ||
    (options.sessionId ? `cli:session:${options.sessionId}` : "cli:memory");
  const decision = resolveCliContextMemoryCutover({
    env: options.env,
    scopeKey,
  });
  const authority = createCliAuthority({
    decision,
    now: options.clock || Date.now,
  });
  const memoryPort =
    options.memoryPort ||
    new SegmentedMemoryPort({
      queryIndexCacheMode:
        options.memoryQueryIndexCacheMode ||
        (options.env || process.env).CC_CONTEXT_MEMORY_QUERY_CACHE ||
        "validate-disk",
      readOnly: !decision.canonical,
      ...(options.memoryFilePath ? { filePath: options.memoryFilePath } : {}),
    });
  const sessionPort =
    options.sessionPort ||
    (options.sessionId
      ? new JsonlSessionContextPort({
          sessionId: options.sessionId,
          allowedSinks: options.allowedSinks || ["*"],
        })
      : null);
  const purgePorts = options.purgePorts || [
    new CliLegacyMemoryPrivacyPurgePort({
      ...(options.legacyMemoryStorePath
        ? { memoryStorePath: options.legacyMemoryStorePath }
        : {}),
      ...(options.legacyDb ? { legacyDb: options.legacyDb } : {}),
    }),
  ];
  const kernel = new ContextMemoryKernel({
    sessionPort,
    memoryPort,
    reconciliationPort: memoryPort,
    authorityRegistry: authority.registry,
    writer: authority.writer,
    mode: decision.canonical ? "canonical" : "shadow",
    clock: options.clock || Date.now,
    ...(options.randomUUID ? { randomUUID: options.randomUUID } : {}),
    purgePorts,
  });
  const semanticSource = createLocalSemanticSource({
    memoryPort,
    env: options.env || process.env,
    clock: options.clock || Date.now,
  });
  async function recallMemory(request, controls = {}) {
    controls.signal?.throwIfAborted();
    const useLocalSource =
      decision.canonical &&
      request.semanticCandidates === undefined &&
      semanticSource.isEnabled() &&
      request.query !== "*";
    const sourceRevision = useLocalSource
      ? await memoryPort.getRevision(controls)
      : null;
    controls.signal?.throwIfAborted();
    const candidates = useLocalSource
      ? await semanticSource.candidates(request, controls)
      : undefined;
    controls.signal?.throwIfAborted();
    const result = await kernel.recallMemory(
      {
        ...request,
        ...(candidates === undefined ? {} : { semanticCandidates: candidates }),
      },
      controls,
    );
    controls.signal?.throwIfAborted();
    if (sourceRevision !== null && result.memoryRevision !== sourceRevision) {
      const error = new Error(
        "Memory changed during local semantic inference; prepare a fresh recall",
      );
      error.code = "revision_conflict";
      error.noReplay = true;
      throw error;
    }
    return result;
  }
  return Object.freeze({
    recallMemory,
    decision,
    kernel,
    memoryPort,
    sessionPort,
    authorityRegistry: authority.registry,
    writer: authority.writer,
  });
}
