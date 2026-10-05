// Deterministic diagnostic peer only. Formal provider drivers do not consume
// this trace and production CLI output remains unchanged.
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

export function canonicalTraceOffset(traceFile) {
  try {
    return fs.statSync(traceFile).size;
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
}

export async function waitForCanonicalCommands(
  traceFile,
  { offset, deadline, requiredSessionId },
) {
  while (true) {
    if (Date.now() >= deadline)
      throw new Error("Canonical diagnostic command drain deadline exceeded");
    const bytes = fs.readFileSync(traceFile);
    if (bytes.length < offset)
      throw new Error("Canonical diagnostic trace was truncated");
    const text = bytes.subarray(offset).toString("utf8");
    const lines = text.split("\n");
    const partial = lines.pop();
    const pending = new Map();
    const started = new Set();
    const unrelatedFailures = [];
    let targetCompleted = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      if (
        record.direction !== "command" ||
        !["canonical-session-show", "canonical-session-show-complete"].includes(
          record.command,
        )
      )
        continue;
      if (typeof record.commandId !== "string" || !record.commandId)
        throw new Error("Canonical diagnostic command identity missing");
      if (record.command === "canonical-session-show") {
        if (started.has(record.commandId))
          throw new Error("Duplicate canonical diagnostic command start");
        started.add(record.commandId);
        const target =
          requiredSessionId === undefined ||
          (Array.isArray(record.args) &&
            record.args.at(-2) === "--" &&
            record.args.at(-1) === requiredSessionId);
        pending.set(record.commandId, target);
      } else {
        if (!pending.has(record.commandId))
          throw new Error("Unmatched canonical diagnostic command completion");
        const target = pending.get(record.commandId);
        pending.delete(record.commandId);
        if (
          record.signal !== null ||
          !Number.isInteger(record.code) ||
          (target && record.code !== 0)
        )
          throw new Error(
            `Canonical diagnostic command failed: ${record.code}/${record.signal}`,
          );
        if (target) targetCompleted++;
        else if (record.code !== 0)
          unrelatedFailures.push({
            commandId: record.commandId,
            code: record.code,
          });
      }
    }
    if (!pending.size && !partial) {
      if (requiredSessionId !== undefined && !targetCompleted)
        throw new Error(
          "Target session has no completed canonical history command",
        );
      return {
        started: started.size,
        completed: started.size,
        ...(requiredSessionId === undefined
          ? {}
          : { requiredSessionId, targetCompleted, unrelatedFailures }),
      };
    }
    await delay(Math.min(50, Math.max(1, deadline - Date.now())));
  }
}
