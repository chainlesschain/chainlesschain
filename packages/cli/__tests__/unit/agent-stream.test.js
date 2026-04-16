import { describe, it, expect } from "vitest";
import { streamAgentResponse, EVENT } from "../../src/lib/agent-stream.js";

describe("streamAgentResponse", () => {
  it("fake-streams a plain string into start → message → end events", async () => {
    const events = [];
    const chunks = [];
    const result = await streamAgentResponse("hello world", {
      onEvent: (ev) => events.push(ev.type),
      writer: (c) => chunks.push(c),
    });
    expect(events[0]).toBe(EVENT.START);
    expect(events[events.length - 1]).toBe(EVENT.END);
    expect(events).toContain(EVENT.MESSAGE);
    expect(result.text).toBe("hello world");
    expect(chunks.join("")).toBe("hello world");
  });

  it("honours noStream — writer not invoked; text still returned", async () => {
    const chunks = [];
    const result = await streamAgentResponse("payload", {
      noStream: true,
      writer: (c) => chunks.push(c),
    });
    expect(chunks).toEqual([]);
    expect(result.text).toBe("payload");
    expect(result.errored).toBe(false);
  });

  it("concatenates TOKEN events via writer", async () => {
    async function* src() {
      yield "foo ";
      yield "bar";
    }
    const chunks = [];
    const result = await streamAgentResponse(src(), {
      writer: (c) => chunks.push(c),
    });
    expect(chunks).toEqual(["foo ", "bar"]);
    expect(result.text).toBe("foo bar");
  });

  it("surfaces errors without throwing", async () => {
    const result = await streamAgentResponse(new Error("boom"), {});
    expect(result.errored).toBe(true);
    expect(result.error).toBe("boom");
  });

  it("swallows onEvent callback errors", async () => {
    const result = await streamAgentResponse("ok", {
      onEvent: () => {
        throw new Error("listener blew up");
      },
    });
    expect(result.text).toBe("ok");
  });

  it("falls back to MESSAGE text when noStream=true and source is TOKEN stream", async () => {
    async function* src() {
      yield "a";
      yield "b";
    }
    const chunks = [];
    const result = await streamAgentResponse(src(), {
      noStream: true,
      writer: (c) => chunks.push(c),
    });
    expect(chunks).toEqual([]);
    expect(result.text).toBe("ab");
  });
});
