import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  createHeadlessOutputBackpressure,
  createWritableBackpressureGate,
} from "../../src/runtime/output-backpressure.js";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";

class ManualWritable extends Writable {
  constructor() {
    super({ highWaterMark: 1 });
    this.chunks = [];
    this.callbacks = [];
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(chunk.toString());
    this.callbacks.push(callback);
  }

  releaseOne() {
    this.callbacks.shift()?.();
  }
}

const immediateWritable = () =>
  new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function releaseUntil(stream, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out draining output");
    stream.releaseOne();
    await tick();
  }
}

function headlessDeps(stdout, agentLoop, extra = {}) {
  return {
    stdout,
    stderr: immediateWritable(),
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    resolveAgentMcp: async () => null,
    agentLoop,
    ...extra,
  };
}

describe("output backpressure", () => {
  it("stops native writes after false and resumes queued chunks on drain", async () => {
    const stream = new ManualWritable();
    const gate = createWritableBackpressureGate(stream, {
      maxQueuedBytes: 32,
    });

    expect(gate.write("a")).toBe(false);
    expect(gate.write("b")).toBe(false);
    expect(stream.chunks).toEqual(["a"]);
    expect(gate.snapshot()).toMatchObject({
      blocked: true,
      queuedBytes: 1,
      queuedChunks: 1,
      backpressureCount: 1,
    });

    const drained = gate.wait();
    stream.releaseOne();
    await new Promise((resolve) => setImmediate(resolve));
    expect(stream.chunks).toEqual(["a", "b"]);
    stream.releaseOne();
    await drained;
    expect(gate.snapshot()).toMatchObject({
      blocked: false,
      queuedBytes: 0,
      queuedChunks: 0,
      backpressureCount: 2,
    });
    gate.dispose();
  });

  it("fails closed at the host queue byte ceiling", async () => {
    const stream = new ManualWritable();
    const onFailure = vi.fn();
    const gate = createWritableBackpressureGate(stream, {
      maxQueuedBytes: 2,
      onFailure,
    });

    gate.write("a");
    gate.write("bc");
    expect(gate.write("d")).toBe(false);
    await expect(gate.wait()).rejects.toMatchObject({
      code: "CC_OUTPUT_BACKPRESSURE_OVERFLOW",
      maxQueuedBytes: 2,
    });
    expect(onFailure).toHaveBeenCalledOnce();
    gate.dispose();
  });

  it("rejects waiters on asynchronous stream errors", async () => {
    const stream = new ManualWritable();
    const gate = createWritableBackpressureGate(stream);
    gate.write("a");
    const waiting = gate.wait();
    stream.emit(
      "error",
      Object.assign(new Error("consumer gone"), { code: "EPIPE" }),
    );
    await expect(waiting).rejects.toMatchObject({ code: "EPIPE" });
    gate.dispose();
  });

  it("preserves synchronous EPIPE as a clean-pipe signal", async () => {
    const cause = Object.assign(new Error("consumer gone"), { code: "EPIPE" });
    const stream = {
      write() {
        throw cause;
      },
      on() {},
      removeListener() {},
    };
    const gate = createWritableBackpressureGate(stream);

    expect(gate.write("a")).toBe(false);
    await expect(gate.wait()).rejects.toMatchObject({ code: "EPIPE", cause });
    gate.dispose();
  });

  it("keeps injected writers byte-compatible and immediately settled", async () => {
    const stdout = [];
    const stderr = [];
    const flow = createHeadlessOutputBackpressure({
      writeOut: (chunk) => stdout.push(chunk),
      writeErr: (chunk) => stderr.push(chunk),
    });
    flow.writeOut("out");
    flow.writeErr("err");
    await flow.wait();
    expect(stdout).toEqual(["out"]);
    expect(stderr).toEqual(["err"]);
    expect(flow.snapshot()).toEqual({ stdout: null, stderr: null });
    flow.dispose();
  });

  it("pauses the single-turn agent loop at a real stdout drain boundary", async () => {
    const stdout = new ManualWritable();
    let produced = 0;
    const agentLoop = async function* () {
      produced += 1;
      yield { type: "iteration-warning", message: "first" };
      produced += 1;
      yield { type: "iteration-warning", message: "second" };
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };

    let settled = false;
    const running = runAgentHeadless(
      {
        prompt: "test backpressure",
        outputFormat: "stream-json",
        expandFileRefs: false,
      },
      headlessDeps(stdout, agentLoop),
    ).finally(() => {
      settled = true;
    });

    await releaseUntil(stdout, () => produced === 1);
    await tick();
    expect(produced).toBe(1);

    await releaseUntil(stdout, () => settled);
    await expect(running).resolves.toMatchObject({
      exitCode: 0,
      isError: false,
    });
    expect(produced).toBe(2);
  }, 30_000);

  it("pauses stream-json turn events at a real stdout drain boundary", async () => {
    const stdout = new ManualWritable();
    let produced = 0;
    const agentLoop = async function* () {
      produced += 1;
      yield { type: "iteration-warning", message: "first" };
      produced += 1;
      yield { type: "iteration-warning", message: "second" };
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };
    const input = async function* () {
      yield `${JSON.stringify({ type: "user", text: "hello" })}\n`;
    };

    let settled = false;
    const running = runAgentHeadlessStream(
      { expandFileRefs: false },
      headlessDeps(stdout, agentLoop, { input: input() }),
    ).finally(() => {
      settled = true;
    });

    await releaseUntil(stdout, () => produced === 1);
    await tick();
    expect(produced).toBe(1);

    await releaseUntil(stdout, () => settled);
    await expect(running).resolves.toMatchObject({ exitCode: 0, turns: 1 });
    expect(produced).toBe(2);
  }, 30_000);
});
