import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({ chat: vi.fn(), source: vi.fn() }));
vi.mock("../../src/lib/chat-core.js", () => ({
  chatWithStreaming: ports.chat,
}));
vi.mock("../../src/lib/provider-stream.js", () => ({
  buildProviderSource: ports.source,
}));
vi.unmock("../../src/lib/evolution/governed-model-turn.js");

import { WSChatHandler } from "../../src/lib/ws-chat-handler.js";
import { SESSION_CORE_STREAMING_HANDLERS } from "../../src/gateways/ws/session-core-protocol.js";
import {
  prepareConfiguredUiModelTurn,
  prepareServerUiModelTurn,
} from "../../src/lib/evolution/optional-ui-model-turn.js";
import { setConfigValue } from "../../src/lib/config-manager.js";
import { handleSessionCreate } from "../../src/gateways/ws/session-protocol.js";

const roots = [];
afterEach(() => {
  vi.resetAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cc-ui-session-opt-in-"));
  roots.push(root);
  const options = {
    env: {
      CHAINLESSCHAIN_HOME: root,
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: "missing",
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: "missing",
    },
  };
  setConfigValue("evolution.enabled", false, options);
  const staleFactory = vi
    .fn()
    .mockRejectedValue(new Error("stale certificate"));
  const server = {
    evolutionCompositionFactory: staleFactory,
    prepareUiModelTurn: (context) =>
      prepareConfiguredUiModelTurn(context, options),
  };
  return { root, options, staleFactory, server };
}

describe("resident UI sessions follow the current Evolution switch", () => {
  it("passes the current UI policy through the actual Chat session creation path", async () => {
    const f = fixture();
    const session = {
      id: "chat-created",
      type: "chat",
      provider: "custom",
      model: "local-alias",
      baseUrl: "http://localhost:1234/v1",
      messages: [],
    };
    const server = {
      ...f.server,
      sessionManager: {
        config: {},
        createSession: vi.fn(() => ({ sessionId: session.id })),
        getSession: vi.fn(() => session),
      },
      sessionHandlers: new Map(),
      _send: vi.fn(),
      emit: vi.fn(),
    };
    const ws = Object.assign(new EventEmitter(), {
      send: vi.fn(),
      readyState: 1,
      OPEN: 1,
    });
    await handleSessionCreate(server, "create", ws, {
      sessionType: "chat",
      provider: session.provider,
      model: session.model,
      baseUrl: session.baseUrl,
    });
    const handler = server.sessionHandlers.get(session.id);
    expect(handler).toBeInstanceOf(WSChatHandler);
    ports.chat.mockResolvedValue("hello");
    await handler.handleMessage("hi", "message");
    expect(ports.chat).toHaveBeenCalledOnce();
    expect(session.messages.at(-1)).toEqual({
      role: "assistant",
      content: "hello",
    });
    expect(f.staleFactory).not.toHaveBeenCalled();
  });
  it("ordinary Chat ignores stale certificates while off and checks policy again on the next message", async () => {
    const f = fixture();
    const interaction = { emit: vi.fn() };
    const handler = new WSChatHandler({
      session: {
        id: "chat-1",
        provider: "custom",
        baseUrl: "http://localhost:1234/v1",
        model: "local-alias",
        messages: [],
      },
      interaction,
      evolutionCompositionFactory: f.staleFactory,
      prepareUiModelTurn: (context) =>
        prepareServerUiModelTurn(f.server, context),
    });
    ports.chat.mockResolvedValue("hello");
    await handler.handleMessage("hi", "one");
    expect(interaction.emit).toHaveBeenCalledWith("response-complete", {
      requestId: "one",
      content: "hello",
    });
    expect(f.staleFactory).not.toHaveBeenCalled();
    expect(existsSync(join(f.root, "evolution"))).toBe(false);
    setConfigValue("evolution.enabled", true, f.options);
    await handler.handleMessage("hi again", "two");
    expect(ports.chat).toHaveBeenCalledOnce();
    expect(interaction.emit).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ requestId: "two", code: "CHAT_ERROR" }),
    );
  });

  it("stream.run uses the host switch and rejects an invalid opted-in deployment", async () => {
    const f = fixture();
    ports.source.mockImplementation(async function* () {
      yield "hello";
    });
    const run = () =>
      SESSION_CORE_STREAMING_HANDLERS["stream.run"](
        {
          prompt: "hi",
          provider: "custom",
          baseUrl: "http://localhost:1234/v1",
          model: "local-alias",
          evolutionDisabled: true,
        },
        vi.fn(),
        new AbortController().signal,
        { server: f.server },
      );
    expect(await run()).toMatchObject({ ok: true, text: "hello" });
    expect(f.staleFactory).not.toHaveBeenCalled();
    setConfigValue("evolution.enabled", true, f.options);
    await expect(run()).rejects.toThrow();
    expect(ports.source).toHaveBeenCalledOnce();
  });

  it("does not accept a client switch as host policy", async () => {
    await expect(
      SESSION_CORE_STREAMING_HANDLERS["stream.run"](
        { prompt: "hi", evolutionDisabled: true },
        vi.fn(),
        new AbortController().signal,
        { server: {} },
      ),
    ).rejects.toThrow("authenticated evolution composition factory");
    expect(ports.source).not.toHaveBeenCalled();
  });
});
