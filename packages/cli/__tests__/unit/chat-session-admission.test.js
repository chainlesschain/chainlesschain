import { describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerChatCommand } from "../../src/commands/chat.js";
import {
  assertChatSessionUsageAdmission,
  CHAT_CALL_LEDGER_UNSUPPORTED,
  CHAT_SESSION_NOT_FOUND,
  CHAT_SESSION_UNAVAILABLE,
} from "../../src/lib/chat-session-admission.js";

function projection(data = {}) {
  return vi.fn((_sessionId, createProjection) => {
    const reducer = createProjection();
    reducer.accept({ type: "session_start", data });
    return reducer.finish({ headHash: "verified-head", eventCount: 1 });
  });
}

describe("interactive chat session usage admission", () => {
  it("admits only a readable verified legacy session and resolves its id", () => {
    expect(
      assertChatSessionUsageAdmission("legacy-prefix", {
        resolveAuthority: () => ({ id: "legacy-full-id", readable: true }),
        readProjection: projection({ provider: "ollama" }),
      }),
    ).toBe("legacy-full-id");
  });

  it.each([
    [CHAT_SESSION_NOT_FOUND, () => null],
    [CHAT_SESSION_UNAVAILABLE, () => ({ id: "damaged", readable: false })],
  ])("fails closed with %s before transcript projection", (code, resolver) => {
    const readProjection = vi.fn();
    expect(() =>
      assertChatSessionUsageAdmission("explicit-id", {
        resolveAuthority: resolver,
        readProjection,
      }),
    ).toThrow(expect.objectContaining({ code }));
    expect(readProjection).not.toHaveBeenCalled();
  });

  it("rejects a verified session carrying any scoped usage marker", () => {
    expect(() =>
      assertChatSessionUsageAdmission("scoped", {
        resolveAuthority: () => ({ id: "scoped", readable: true }),
        readProjection: projection({
          observabilityScope: { workspaceId: "workspace-1" },
          usageTelemetryProtocol: "call-ledger",
          usageTelemetryVersion: 1,
        }),
      }),
    ).toThrow(expect.objectContaining({ code: CHAT_CALL_LEDGER_UNSUPPORTED }));
  });

  it("runs chat command admission before constructing its runtime", async () => {
    const admissionError = Object.assign(new Error("blocked"), {
      code: CHAT_CALL_LEDGER_UNSUPPORTED,
    });
    const assertUsageAdmission = vi.fn(() => {
      throw admissionError;
    });
    const createRuntimeFactory = vi.fn();
    const evolutionCompositionFactory = vi.fn();
    const program = new Command();
    registerChatCommand(program, {
      assertChatSessionUsageAdmission: assertUsageAdmission,
      createAgentRuntimeFactory: createRuntimeFactory,
      evolutionCompositionFactory,
    });

    await expect(
      program.parseAsync(["node", "cc", "chat", "--session", "scoped"]),
    ).rejects.toBe(admissionError);
    expect(assertUsageAdmission).toHaveBeenCalledWith("scoped");
    expect(evolutionCompositionFactory).not.toHaveBeenCalled();
    expect(createRuntimeFactory).not.toHaveBeenCalled();
  });

  it("keeps the unconfigured chat command on its legacy runtime path", async () => {
    const startChatSession = vi.fn().mockResolvedValue(undefined);
    const createChatRuntime = vi.fn(() => ({ startChatSession }));
    const createRuntimeFactory = vi.fn(() => ({ createChatRuntime }));
    const program = new Command();
    registerChatCommand(program, {
      createAgentRuntimeFactory: createRuntimeFactory,
    });

    await program.parseAsync(["node", "cc", "chat", "--model", "local"]);

    expect(createRuntimeFactory).toHaveBeenCalledWith();
    expect(createChatRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ model: "local" }),
    );
    expect(startChatSession).toHaveBeenCalledOnce();
  });

  it("rejects accessor or proxied evolution factories during registration", () => {
    const program = new Command();
    expect(() =>
      registerChatCommand(program, {
        get evolutionCompositionFactory() {
          return vi.fn();
        },
      }),
    ).toThrow(/function data property/u);
    expect(() =>
      registerChatCommand(
        new Command(),
        new Proxy({ evolutionCompositionFactory: vi.fn() }, {}),
      ),
    ).toThrow(/plain object/u);
  });
});
