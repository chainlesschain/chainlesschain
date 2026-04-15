/**
 * Unit tests for Volcengine Seedance text-to-video provider.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const provider = require("../../../src/main/video/providers/volcengine-video.js");

function makeFetchMock(responses) {
  const calls = [];
  const fn = vi.fn(async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) {
      throw new Error(`no mock response for ${url}`);
    }
    if (r.error) {
      throw r.error;
    }
    return {
      ok: r.ok !== false,
      status: r.status || 200,
      async json() {
        return r.body;
      },
      async text() {
        return typeof r.body === "string" ? r.body : JSON.stringify(r.body);
      },
      async arrayBuffer() {
        return r.bytes instanceof Buffer
          ? r.bytes.buffer.slice(
              r.bytes.byteOffset,
              r.bytes.byteOffset + r.bytes.byteLength,
            )
          : new ArrayBuffer(0);
      },
    };
  });
  fn.calls = calls;
  return fn;
}

describe("volcengine-video provider", () => {
  let tmpDir;
  let origFetch;
  let origSleep;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vcv-"));
    origFetch = provider._deps.fetch;
    origSleep = provider._deps.sleep;
    provider._deps.sleep = () => Promise.resolve();
  });

  afterEach(() => {
    provider._deps.fetch = origFetch;
    provider._deps.sleep = origSleep;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a task, polls until succeeded, downloads to outputPath", async () => {
    const videoBytes = Buffer.from("FAKE_MP4_BYTES".repeat(100));
    provider._deps.fetch = makeFetchMock([
      { body: { id: "task-123" } }, // createTask
      { body: { status: "queued" } }, // poll 1
      { body: { status: "running" } }, // poll 2
      {
        body: {
          status: "succeeded",
          content: { video_url: "https://cdn.example/video.mp4" },
        },
      }, // poll 3
      { bytes: videoBytes }, // download
    ]);

    const out = path.join(tmpDir, "out.mp4");
    const progress = [];
    const result = await provider.generateVideo({
      apiKey: "test-key",
      prompt: "a cat surfing on a wave",
      ratio: "16:9",
      duration: 5,
      outputPath: out,
      pollIntervalMs: 1,
      onProgress: (p) => progress.push(p.stage),
    });

    expect(result.taskId).toBe("task-123");
    expect(result.size).toBe(videoBytes.length);
    expect(fs.existsSync(out)).toBe(true);
    expect(progress).toContain("task-created");
    expect(progress).toContain("complete");

    const createCall = provider._deps.fetch.calls[0];
    expect(createCall.init.method).toBe("POST");
    expect(createCall.init.headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(createCall.init.body);
    expect(body.content[0].text).toMatch(/--ratio 16:9/);
    expect(body.content[0].text).toMatch(/--duration 5/);
  });

  it("throws when task fails", async () => {
    provider._deps.fetch = makeFetchMock([
      { body: { id: "t2" } },
      {
        body: {
          status: "failed",
          error: { code: "Sensitive", message: "blocked" },
        },
      },
    ]);
    await expect(
      provider.generateVideo({
        apiKey: "k",
        prompt: "x",
        outputPath: path.join(tmpDir, "o.mp4"),
        pollIntervalMs: 1,
      }),
    ).rejects.toThrow(/failed.*blocked/);
  });

  it("throws on missing apiKey", async () => {
    await expect(
      provider.generateVideo({
        prompt: "x",
        outputPath: path.join(tmpDir, "o.mp4"),
      }),
    ).rejects.toThrow(/apiKey/);
  });

  it("throws on missing prompt", async () => {
    await expect(
      provider.generateVideo({
        apiKey: "k",
        outputPath: path.join(tmpDir, "o.mp4"),
      }),
    ).rejects.toThrow(/prompt/);
  });

  it("surfaces non-2xx createTask errors", async () => {
    provider._deps.fetch = makeFetchMock([
      { ok: false, status: 401, body: "unauthorized" },
    ]);
    await expect(
      provider.generateVideo({
        apiKey: "bad",
        prompt: "x",
        outputPath: path.join(tmpDir, "o.mp4"),
      }),
    ).rejects.toThrow(/401/);
  });

  it("includes image_url part when imageUrl is provided (first-frame mode)", async () => {
    provider._deps.fetch = makeFetchMock([
      { body: { id: "t3" } },
      {
        body: {
          status: "succeeded",
          content: { video_url: "https://cdn.example/v.mp4" },
        },
      },
      { bytes: Buffer.from("x") },
    ]);
    await provider.generateVideo({
      apiKey: "k",
      prompt: "animate",
      imageUrl: "https://img.example/a.png",
      outputPath: path.join(tmpDir, "o.mp4"),
      pollIntervalMs: 1,
    });
    const body = JSON.parse(provider._deps.fetch.calls[0].init.body);
    expect(body.content).toHaveLength(2);
    expect(body.content[1].type).toBe("image_url");
    expect(body.content[1].role).toBe("first_frame");
  });
});

describe("video-generator router", () => {
  const generator = require("../../../src/main/video/video-generator.js");

  beforeEach(() => {
    generator._deps.getLLMConfig = () => ({
      volcengine: {
        apiKey: "routed-key",
        baseURL: "https://ark.example/api/v3",
        videoModel: "doubao-seedance-1.0-lite",
      },
    });
    generator._deps.volcengine = {
      generateVideo: vi.fn(async (opts) => ({
        path: opts.outputPath,
        size: 42,
        taskId: "t",
        model: opts.model,
      })),
    };
  });

  it("routes to volcengine by default and forwards config", async () => {
    const r = await generator.generateVideo({
      prompt: "sunset",
      outputPath: "/tmp/x.mp4",
    });
    expect(r.size).toBe(42);
    const call = generator._deps.volcengine.generateVideo.mock.calls[0][0];
    expect(call.apiKey).toBe("routed-key");
    expect(call.baseURL).toBe("https://ark.example/api/v3");
    expect(call.model).toBe("doubao-seedance-1.0-lite");
  });

  it("rejects when apiKey missing", async () => {
    generator._deps.getLLMConfig = () => ({ volcengine: { apiKey: "" } });
    await expect(
      generator.generateVideo({ prompt: "x", outputPath: "/tmp/x.mp4" }),
    ).rejects.toThrow(/apiKey/);
  });

  it("rejects unknown provider", async () => {
    await expect(
      generator.generateVideo({
        provider: "runway",
        prompt: "x",
        outputPath: "/tmp/x.mp4",
      }),
    ).rejects.toThrow(/unsupported/);
  });
});
