import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cli-stream-"));
  vi.resetModules();
  vi.doMock("../../src/lib/paths.js", () => ({
    getHomeDir: () => tmpHome,
    getBinDir: () => path.join(tmpHome, "bin"),
    getConfigPath: () => path.join(tmpHome, "config.json"),
    getStatePath: () => path.join(tmpHome, "state"),
    getPidFilePath: () => path.join(tmpHome, "state", "app.pid"),
    getServicesDir: () => path.join(tmpHome, "services"),
  }));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.doUnmock("../../src/lib/paths.js");
});

describe("cc stream — StreamRouter NDJSON end-to-end", () => {
  it("emits start, token, end events for a token stream", async () => {
    const mod = await import("../../src/lib/session-core-singletons.js");
    const router = mod.createStreamRouter();
    async function* src() {
      yield "foo ";
      yield "bar";
    }
    const events = [];
    for await (const ev of router.stream(src())) events.push(ev);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("start");
    expect(types[types.length - 1]).toBe("end");
    const tokens = events.filter((e) => e.type === "token").map((e) => e.text);
    expect(tokens.join("")).toBe("foo bar");
  });

  it("collect() concatenates tokens into final text", async () => {
    const mod = await import("../../src/lib/session-core-singletons.js");
    const router = mod.createStreamRouter();
    async function* src() {
      yield "hello";
      yield " ";
      yield "stream";
    }
    const out = await router.collect(src());
    expect(out.text).toBe("hello stream");
    expect(out.errored).toBe(false);
  });

  it("surfaces provider errors as a terminal error event", async () => {
    const mod = await import("../../src/lib/session-core-singletons.js");
    const router = mod.createStreamRouter();
    async function* src() {
      yield "partial";
      throw new Error("provider 500");
    }
    const events = [];
    for await (const ev of router.stream(src())) events.push(ev);
    const err = events.find((e) => e.type === "error");
    expect(err).toBeTruthy();
    expect(err.error).toMatch(/provider 500/);
  });
});
