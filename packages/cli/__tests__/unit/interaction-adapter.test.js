import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  InteractionAdapter,
  TerminalInteractionAdapter,
  WebSocketInteractionAdapter,
} from "../../src/lib/interaction-adapter.js";

describe("InteractionAdapter (base class)", () => {
  it("askInput throws not implemented", async () => {
    const adapter = new InteractionAdapter();
    await expect(adapter.askInput("What?")).rejects.toThrow(
      "askInput not implemented",
    );
  });

  it("askSelect throws not implemented", async () => {
    const adapter = new InteractionAdapter();
    await expect(adapter.askSelect("Pick one", [])).rejects.toThrow(
      "askSelect not implemented",
    );
  });

  it("askConfirm throws not implemented", async () => {
    const adapter = new InteractionAdapter();
    await expect(adapter.askConfirm("Sure?")).rejects.toThrow(
      "askConfirm not implemented",
    );
  });

  it("emit is a no-op and does not throw", () => {
    const adapter = new InteractionAdapter();
    expect(() => adapter.emit("event", { foo: 1 })).not.toThrow();
  });
});

describe("TerminalInteractionAdapter", () => {
  let adapter;
  let mockPrompts;

  beforeEach(() => {
    adapter = new TerminalInteractionAdapter();
    mockPrompts = {
      askInput: vi.fn().mockResolvedValue("user input"),
      askSelect: vi.fn().mockResolvedValue("option-a"),
      askConfirm: vi.fn().mockResolvedValue(true),
    };
    // Inject mock prompts to skip dynamic import
    adapter._prompts = mockPrompts;
  });

  it("loads prompts lazily on first call", async () => {
    const fresh = new TerminalInteractionAdapter();
    expect(fresh._prompts).toBeNull();
    // After injecting, _loadPrompts returns the existing value
    fresh._prompts = mockPrompts;
    const loaded = await fresh._loadPrompts();
    expect(loaded).toBe(mockPrompts);
  });

  it("askInput delegates to prompts.askInput", async () => {
    const result = await adapter.askInput("Name?", { default: "Alice" });
    expect(mockPrompts.askInput).toHaveBeenCalledWith("Name?", "Alice");
    expect(result).toBe("user input");
  });

  it("askInput passes empty default when none provided", async () => {
    await adapter.askInput("Name?");
    expect(mockPrompts.askInput).toHaveBeenCalledWith("Name?", "");
  });

  it("askSelect delegates to prompts.askSelect", async () => {
    const choices = [
      { name: "A", value: "a" },
      { name: "B", value: "b" },
    ];
    const result = await adapter.askSelect("Pick:", choices);
    expect(mockPrompts.askSelect).toHaveBeenCalledWith("Pick:", choices);
    expect(result).toBe("option-a");
  });

  it("askConfirm delegates to prompts.askConfirm", async () => {
    const result = await adapter.askConfirm("Sure?", false);
    expect(mockPrompts.askConfirm).toHaveBeenCalledWith("Sure?", false);
    expect(result).toBe(true);
  });

  it("emit is a no-op", () => {
    expect(() => adapter.emit("some-event", { data: 1 })).not.toThrow();
  });
});

describe("WebSocketInteractionAdapter", () => {
  let ws;
  let adapter;

  beforeEach(() => {
    ws = {
      readyState: 1,
      OPEN: 1,
      send: vi.fn(),
    };
    adapter = new WebSocketInteractionAdapter(ws, "session-123");
  });

  afterEach(() => {
    // Clear any pending timeouts
    adapter._pending.clear();
  });

  it("constructor sets ws and sessionId", () => {
    expect(adapter.ws).toBe(ws);
    expect(adapter.sessionId).toBe("session-123");
    expect(adapter._pending).toBeInstanceOf(Map);
    expect(adapter._pending.size).toBe(0);
  });

  it("askInput sends question message and waits for answer", async () => {
    const promise = adapter.askInput("Your name?", { default: "Bob" });

    // ws.send should have been called with a JSON question message
    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe("question");
    expect(sent.sessionId).toBe("session-123");
    expect(sent.questionType).toBe("input");
    expect(sent.question).toBe("Your name?");
    expect(sent.default).toBe("Bob");

    // Resolve the pending question
    const requestId = sent.requestId;
    adapter.resolveAnswer(requestId, "Alice");

    const result = await promise;
    expect(result).toBe("Alice");
  });

  it("askSelect sends question with choices", async () => {
    const choices = [
      { name: "Red", value: "red" },
      { name: "Blue", value: "blue" },
    ];
    const promise = adapter.askSelect("Color?", choices);

    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.questionType).toBe("select");
    expect(sent.choices).toEqual(choices);

    adapter.resolveAnswer(sent.requestId, "red");
    const result = await promise;
    expect(result).toBe("red");
  });

  it("askConfirm normalizes string 'true' to boolean true", async () => {
    const promise = adapter.askConfirm("Proceed?");

    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.questionType).toBe("confirm");

    adapter.resolveAnswer(sent.requestId, "true");
    const result = await promise;
    expect(result).toBe(true);
  });

  it("askConfirm normalizes string 'yes' to boolean true", async () => {
    const promise = adapter.askConfirm("Proceed?");
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    adapter.resolveAnswer(sent.requestId, "yes");
    expect(await promise).toBe(true);
  });

  it("askConfirm normalizes string 'y' to boolean true", async () => {
    const promise = adapter.askConfirm("Proceed?");
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    adapter.resolveAnswer(sent.requestId, "y");
    expect(await promise).toBe(true);
  });

  it("askConfirm returns false for non-truthy string", async () => {
    const promise = adapter.askConfirm("Proceed?");
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    adapter.resolveAnswer(sent.requestId, "no");
    expect(await promise).toBe(false);
  });

  it("askConfirm passes through boolean value directly", async () => {
    const promise = adapter.askConfirm("Proceed?");
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    adapter.resolveAnswer(sent.requestId, false);
    expect(await promise).toBe(false);
  });

  it("resolveAnswer resolves pending promise", async () => {
    const promise = adapter.askInput("Q?");
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(adapter._pending.size).toBe(1);

    adapter.resolveAnswer(sent.requestId, "answer");
    await promise;
    expect(adapter._pending.size).toBe(0);
  });

  it("resolveAnswer ignores unknown requestId", () => {
    // Should not throw
    adapter.resolveAnswer("unknown-request-id", "answer");
    expect(adapter._pending.size).toBe(0);
  });

  it("emit sends via ws", () => {
    adapter.emit("progress", { percent: 50 });

    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe("progress");
    expect(sent.sessionId).toBe("session-123");
    expect(sent.percent).toBe(50);
  });

  it("_sendWs handles closed connection by not sending", () => {
    ws.readyState = 3; // CLOSED
    adapter._sendWs({ type: "test" });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("_sendWs handles send throwing without propagating", () => {
    ws.send.mockImplementation(() => {
      throw new Error("Connection reset");
    });
    // Should not throw
    expect(() => adapter._sendWs({ type: "test" })).not.toThrow();
  });

  it("question times out after 5 minutes", async () => {
    vi.useFakeTimers();

    const promise = adapter.askInput("Q?");

    // Advance time past 5 minute timeout
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    await expect(promise).rejects.toThrow("Question timed out");
    expect(adapter._pending.size).toBe(0);

    vi.useRealTimers();
  });
});
