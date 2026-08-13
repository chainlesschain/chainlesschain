import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  REPL_RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE,
  createReplRuntimeLedgerTerminalLatch,
  resolveReplMeteredSessionId,
  resolveReplPromptSuggestionGenerator,
} from "../../src/repl/agent-repl.js";

describe("REPL runtime-ledger terminal latch", () => {
  it("is session-local, trips once, and blocks every later operation", () => {
    const onTrip = vi.fn();
    const latch = createReplRuntimeLedgerTerminalLatch({ onTrip });
    const otherSession = createReplRuntimeLedgerTerminalLatch();
    const marker = Object.assign(new Error("private disk path"), {
      runtimeLedgerPersistence: true,
    });

    expect(latch.trip(new Error("ordinary provider failure"))).toBeNull();
    const terminal = latch.trip(marker);
    expect(terminal.message).toBe(
      REPL_RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE,
    );
    expect(terminal.message).not.toContain("private disk path");
    expect(terminal.runtimeLedgerPersistence).toBe(true);
    expect(latch.isTripped()).toBe(true);
    expect(() => latch.assertOpen()).toThrow(terminal);
    expect(latch.trip(new Error("later failure"))).toBe(terminal);
    expect(onTrip).toHaveBeenCalledOnce();
    expect(otherSession.isTripped()).toBe(false);
  });

  it("meters only durable JSONL sessions and forces local suggestions there", () => {
    const customGenerator = vi.fn();
    expect(resolveReplMeteredSessionId(true, "session-1")).toBe("session-1");
    expect(resolveReplMeteredSessionId(false, "legacy-session")).toBeNull();
    expect(resolveReplMeteredSessionId(true, null)).toBeNull();
    expect(resolveReplPromptSuggestionGenerator(true, customGenerator)).toBe(
      undefined,
    );
    expect(resolveReplPromptSuggestionGenerator(false, customGenerator)).toBe(
      customGenerator,
    );
  });

  it("routes every direct createChatFn surface and Advisor through one meter", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../src/repl/agent-repl.js", import.meta.url)),
      "utf8",
    );

    expect(source.match(/runMeteredDirectModelCall\(/g)).toHaveLength(1);
    expect(source.match(/createChatFn\(/g)).toHaveLength(3);
    expect(
      source.match(/_runReplMeteredModelCall\(\{/g).length,
    ).toBeGreaterThanOrEqual(4);
    expect(source).toContain(
      "invoke: (request) =>\n        _runReplMeteredModelCall({",
    );
    expect(source).toContain(
      "generateSuggestions: resolveReplPromptSuggestionGenerator(",
    );
    expect(source.match(/callWrapper: _directChatCallWrapper/g)).toHaveLength(
      5,
    );
    expect(source).toContain("const _directChatCallWrapper = (");
    expect(source).not.toContain("const rawChatFn = createChatFn(");
    expect(source).not.toContain(
      "generateSuggestions: options.generatePromptSuggestions",
    );
  });
});
