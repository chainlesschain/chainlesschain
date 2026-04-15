import { describe, it, expect, vi } from "vitest";
import {
  StreamRouter,
  STREAM_EVENT,
  normalize,
  isAsyncIterable,
} from "../lib/stream-router.js";

async function drain(iter) {
  const out = [];
  for await (const x of iter) out.push(x);
  return out;
}

async function* genTokens(...tokens) {
  for (const t of tokens) yield t;
}

describe("isAsyncIterable", () => {
  it("detects async iterables", () => {
    expect(isAsyncIterable(genTokens("a"))).toBe(true);
    expect(isAsyncIterable("abc")).toBe(false);
    expect(isAsyncIterable(null)).toBe(false);
    expect(isAsyncIterable({})).toBe(false);
  });
});

describe("normalize", () => {
  it("wraps string in start/message/end", async () => {
    const events = await drain(normalize("hello"));
    expect(events.map((e) => e.type)).toEqual([
      STREAM_EVENT.START,
      STREAM_EVENT.MESSAGE,
      STREAM_EVENT.END,
    ]);
    expect(events[1].content).toBe("hello");
  });

  it("wraps Error into error event", async () => {
    const events = await drain(normalize(new Error("bad")));
    expect(events[1].type).toBe(STREAM_EVENT.ERROR);
    expect(events[1].error).toBe("bad");
  });

  it("passes through async iterable strings as tokens", async () => {
    const events = await drain(normalize(genTokens("a", "b", "c")));
    const tokens = events.filter((e) => e.type === STREAM_EVENT.TOKEN);
    expect(tokens.map((t) => t.text)).toEqual(["a", "b", "c"]);
  });

  it("passes through typed stream events unchanged", async () => {
    const evts = [
      { type: STREAM_EVENT.TOKEN, text: "hi" },
      { type: STREAM_EVENT.TOOL_CALL, name: "read_file" },
    ];
    async function* gen() {
      for (const e of evts) yield e;
    }
    const out = await drain(normalize(gen()));
    expect(out).toContainEqual(
      expect.objectContaining({ type: STREAM_EVENT.TOOL_CALL, name: "read_file" })
    );
  });

  it("awaits promise sources", async () => {
    const events = await drain(normalize(Promise.resolve("deferred")));
    expect(events.find((e) => e.type === STREAM_EVENT.MESSAGE).content).toBe(
      "deferred"
    );
  });

  it("handles { message } objects", async () => {
    const events = await drain(normalize({ message: "msg" }));
    expect(events[1]).toMatchObject({ type: STREAM_EVENT.MESSAGE, content: "msg" });
  });

  it("handles { error } objects", async () => {
    const events = await drain(normalize({ error: "oops" }));
    expect(events[1]).toMatchObject({ type: STREAM_EVENT.ERROR, error: "oops" });
  });

  it("catches iterator errors as error event", async () => {
    async function* bad() {
      yield "ok";
      throw new Error("boom");
    }
    const events = await drain(normalize(bad()));
    const err = events.find((e) => e.type === STREAM_EVENT.ERROR);
    expect(err).toBeTruthy();
    expect(err.error).toBe("boom");
    expect(events[events.length - 1].type).toBe(STREAM_EVENT.END);
  });

  it("null source yields only start+end", async () => {
    const events = await drain(normalize(null));
    expect(events.map((e) => e.type)).toEqual([
      STREAM_EVENT.START,
      STREAM_EVENT.END,
    ]);
  });

  it("handles chunk.text in async iterable objects", async () => {
    async function* gen() {
      yield { text: "x" };
      yield { text: "y" };
    }
    const events = await drain(normalize(gen()));
    const tokens = events.filter((e) => e.type === STREAM_EVENT.TOKEN);
    expect(tokens.map((t) => t.text)).toEqual(["x", "y"]);
  });
});

describe("StreamRouter.stream", () => {
  it("forwards events to onToken and onEvent callbacks", async () => {
    const onToken = vi.fn();
    const onEvent = vi.fn();
    const r = new StreamRouter({ onToken, onEvent });
    await drain(r.stream(genTokens("a", "b")));
    expect(onToken).toHaveBeenCalledWith("a");
    expect(onToken).toHaveBeenCalledWith("b");
    expect(onEvent).toHaveBeenCalled();
  });

  it("emits typed events via EventEmitter", async () => {
    const r = new StreamRouter();
    const tokenSpy = vi.fn();
    const endSpy = vi.fn();
    r.on("token", tokenSpy);
    r.on("end", endSpy);
    await drain(r.stream(genTokens("x")));
    expect(tokenSpy).toHaveBeenCalledOnce();
    expect(endSpy).toHaveBeenCalledOnce();
  });

  it("callback exceptions don't break stream", async () => {
    const r = new StreamRouter({
      onToken: () => {
        throw new Error("bad cb");
      },
    });
    const events = await drain(r.stream(genTokens("a")));
    expect(events.length).toBeGreaterThan(0);
  });
});

describe("StreamRouter.collect", () => {
  it("concatenates tokens into text", async () => {
    const r = new StreamRouter();
    const out = await r.collect(genTokens("hel", "lo"));
    expect(out.text).toBe("hello");
    expect(out.errored).toBe(false);
  });

  it("message content overrides token concat", async () => {
    const r = new StreamRouter();
    const out = await r.collect("complete answer");
    expect(out.text).toBe("complete answer");
  });

  it("records errored=true on error events", async () => {
    const r = new StreamRouter();
    const out = await r.collect({ error: "nope" });
    expect(out.errored).toBe(true);
    expect(out.error).toBe("nope");
  });

  it("events array contains the full sequence", async () => {
    const r = new StreamRouter();
    const out = await r.collect(genTokens("a", "b"));
    expect(out.events[0].type).toBe(STREAM_EVENT.START);
    expect(out.events[out.events.length - 1].type).toBe(STREAM_EVENT.END);
    const tokens = out.events.filter((e) => e.type === STREAM_EVENT.TOKEN);
    expect(tokens).toHaveLength(2);
  });

  it("empty source yields empty text, not errored", async () => {
    const r = new StreamRouter();
    const out = await r.collect(null);
    expect(out.text).toBe("");
    expect(out.errored).toBe(false);
  });
});
