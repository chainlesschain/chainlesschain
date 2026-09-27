import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bounded,
  isolatedEnvironment,
  officialValidators,
  ProbeClient,
} from "../../scripts/codex-app-server-turn-probe.mjs";

afterEach(() => vi.useRealTimers());

function childProcess() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn((signal) => {
    child.emit("close", null, signal);
    return true;
  });
  return child;
}

describe("pinned Codex real-turn probe boundaries", () => {
  it("does not forward user credentials, proxy, config, or Node injection variables", () => {
    const env = isolatedEnvironment("/isolated", {
      PATH: "/usr/bin",
      SystemRoot: "C:/Windows",
      OPENAI_API_KEY: "sentinel",
      CODEX_HOME: "/user/codex",
      HOME: "/user",
      HTTPS_PROXY: "http://proxy",
      NODE_OPTIONS: "--require malicious.cjs",
      CODEX_AUTH_TOKEN: "sentinel",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.SystemRoot).toBe("C:/Windows");
    expect(env.HOME).toContain("isolated");
    expect(env.CODEX_HOME).toContain("isolated");
    for (const key of [
      "OPENAI_API_KEY",
      "HTTPS_PROXY",
      "NODE_OPTIONS",
      "CODEX_AUTH_TOKEN",
    ])
      expect(env).not.toHaveProperty(key);
  });

  it("rejects unknown methods and invalid real notifications against the official schema", () => {
    const validators = officialValidators();
    expect(() =>
      validators.check("notification", { method: "invented", params: {} }),
    ).toThrow(/unknown official/);
    expect(() =>
      validators.check("notification", {
        method: "item/agentMessage/delta",
        params: { delta: "incomplete" },
      }),
    ).toThrow(/invalid official/);
    expect(validators.counts).toEqual({});
  });

  it("preserves split UTF-8 and multiple JSONL frames", async () => {
    const child = childProcess(),
      validators = officialValidators();
    const client = new ProbeClient(child, validators);
    const notification = {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-a",
        turnId: "turn-a",
        itemId: "item-a",
        delta: "中文🙂",
      },
    };
    const frames = Buffer.from(
      `${JSON.stringify(notification)}\n${JSON.stringify(notification)}\n`,
    );
    const split = frames.indexOf(Buffer.from("中")) + 1;
    child.stdout.write(frames.subarray(0, split));
    child.stdout.write(frames.subarray(split));
    expect(client.notifications).toEqual([notification, notification]);
    child.emit("close", 0, null);
    await expect(client.closed.promise).resolves.toEqual({
      code: 0,
      signal: null,
    });
  });

  it("rejects outstanding calls on process death and removes their timers", async () => {
    vi.useFakeTimers();
    const child = childProcess(),
      client = new ProbeClient(child, officialValidators());
    const request = client.request("thread/list", { limit: 1 });
    const rejected = expect(request).rejects.toThrow(/process closed/);
    child.emit("close", 1, null);
    await rejected;
    expect(client.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails malformed JSON and excessive stdout instead of hanging until a turn deadline", async () => {
    for (const bytes of [
      Buffer.from("not-json\n"),
      Buffer.alloc(4 * 1024 * 1024 + 1),
    ]) {
      const child = childProcess(),
        client = new ProbeClient(child, officialValidators());
      const request = client.request("thread/list", { limit: 1 });
      const rejected = expect(request).rejects.toThrow();
      child.stdout.write(bytes);
      await rejected;
      expect(client.pending.size).toBe(0);
      child.emit("close", 1, null);
    }
  });

  it("bounds missing RPC responses and shutdown, observing actual close after termination", async () => {
    vi.useFakeTimers();
    const child = childProcess(),
      client = new ProbeClient(child, officialValidators());
    const request = client.request("thread/list", { limit: 1 });
    const rejected = expect(request).rejects.toThrow(
      /RPC thread\/list timed out/,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(client.pending.size).toBe(0);
    const stopped = client.stop();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(stopped).resolves.toEqual({ code: null, signal: "SIGTERM" });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears bounded-wait timers when the observed operation resolves", async () => {
    vi.useFakeTimers();
    await expect(bounded(Promise.resolve("done"), 1000, "probe")).resolves.toBe(
      "done",
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
