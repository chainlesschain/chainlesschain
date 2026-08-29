import { ContextMemoryKernel } from "@chainlesschain/context-memory-kernel";
import { DurableJsonMemoryPort } from "./durable-memory-port.js";
import { JsonlSessionContextPort } from "./jsonl-session-context-port.js";
import {
  createCliAuthority,
  resolveCliContextMemoryCutover,
} from "./authority.js";

export function createCliContextMemoryRuntime(options = {}) {
  const scopeKey = options.scopeKey ||
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
    new DurableJsonMemoryPort({
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
  const kernel = new ContextMemoryKernel({
    sessionPort,
    memoryPort,
    reconciliationPort: memoryPort,
    authorityRegistry: authority.registry,
    writer: authority.writer,
    mode: decision.canonical ? "canonical" : "shadow",
    clock: options.clock || Date.now,
    ...(options.randomUUID ? { randomUUID: options.randomUUID } : {}),
    purgePorts: options.purgePorts || [],
  });
  return Object.freeze({
    decision,
    kernel,
    memoryPort,
    sessionPort,
    authorityRegistry: authority.registry,
    writer: authority.writer,
  });
}
