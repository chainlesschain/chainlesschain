/**
 * The REPL live-streaming gate. The safety invariant: never stream live when an
 * AssistantResponse hook could rewrite/suppress the answer.
 */
import { describe, it, expect } from "vitest";
import { shouldStreamLive } from "../../src/repl/stream-decision.js";

describe("shouldStreamLive", () => {
  it("streams when there are no AssistantResponse hooks", () => {
    expect(shouldStreamLive({ streamEnv: undefined, arHookCount: 0 })).toBe(true);
    expect(shouldStreamLive({})).toBe(true);
  });

  it("never streams when an AssistantResponse hook is registered (rewrite/suppress risk)", () => {
    expect(shouldStreamLive({ arHookCount: 1 })).toBe(false);
    expect(shouldStreamLive({ arHookCount: 3 })).toBe(false);
  });

  it("stays safe (no streaming) when the hook count is unknown (query error → -1)", () => {
    expect(shouldStreamLive({ arHookCount: -1 })).toBe(false);
  });

  it("CC_REPL_STREAM=0 forces the replay even with no hooks", () => {
    expect(shouldStreamLive({ streamEnv: "0", arHookCount: 0 })).toBe(false);
  });
});
