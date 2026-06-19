/**
 * Stream-mode vision input (chat-panel image paste parity with `--image`):
 * {"type":"user","text":…,"images":["/abs/img.png"]} — paths resolve through
 * the same image-input pipeline (data URLs → OpenAI-style multimodal content);
 * a bad attachment errors THAT turn only, the session keeps serving.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  runAgentHeadlessStream,
  parseInputEvent,
} from "../../src/runtime/headless-stream.js";

// 1×1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function harness({ inputObjs, runOptions }) {
  const lines = [];
  const seenTurns = [];
  const seenOpts = [];
  async function* loop(messages, opts) {
    seenTurns.push(messages.map((m) => ({ role: m.role, content: m.content })));
    seenOpts.push(opts || {});
    yield { type: "response-complete", content: "reply" };
    yield { type: "run-ended", reason: "complete" };
  }
  async function* input() {
    for (const o of inputObjs) yield JSON.stringify(o) + "\n";
  }
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    writeOut: (s) => lines.push(s),
    writeErr: () => {},
    agentLoop: loop,
    input: input(),
  };
  return {
    run: () =>
      runAgentHeadlessStream({ expandFileRefs: false, ...runOptions }, deps),
    events: () =>
      lines
        .join("")
        .trimEnd()
        .split("\n")
        .map((l) => JSON.parse(l)),
    seenTurns,
    seenOpts,
  };
}

describe("parseInputEvent — images", () => {
  it("carries a valid images array alongside the text", () => {
    expect(
      parseInputEvent('{"type":"user","text":"look","images":["/a.png"]}'),
    ).toEqual({ text: "look", images: ["/a.png"] });
  });

  it("filters junk entries and caps at 8", () => {
    const imgs = Array.from({ length: 12 }, (_, i) => `/img${i}.png`);
    const parsed = parseInputEvent(
      JSON.stringify({
        type: "user",
        text: "x",
        images: [1, "", null, ...imgs],
      }),
    );
    expect(parsed.images).toHaveLength(8);
    expect(parsed.images[0]).toBe("/img0.png");
  });

  it("accepts an image-only turn with a default instruction", () => {
    const parsed = parseInputEvent('{"type":"user","images":["/a.png"]}');
    expect(parsed.images).toEqual(["/a.png"]);
    expect(parsed.text).toMatch(/attached image/);
  });

  it("text-only events stay shape-identical (no images key)", () => {
    expect(parseInputEvent('{"type":"user","text":"hi"}')).toEqual({
      text: "hi",
    });
    expect(parseInputEvent('{"type":"user","images":[]}')).toBe(null);
  });
});

describe("parseInputEvent — auto image-path detection (Claude-Code style)", () => {
  let imgPath;
  beforeEach(() => {
    imgPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "cc-autoimg-")),
      "shot.png",
    );
    fs.writeFileSync(imgPath, Buffer.from(PNG_BASE64, "base64"));
  });
  afterEach(() => {
    try {
      fs.rmSync(path.dirname(imgPath), { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("attaches a real image path typed in the text and strips it", () => {
    const parsed = parseInputEvent(
      JSON.stringify({ type: "user", text: `describe ${imgPath} for me` }),
    );
    expect(parsed.images).toEqual([imgPath]);
    expect(parsed.text).toBe("describe for me");
  });

  it("a path-only message becomes a valid image-only turn", () => {
    const parsed = parseInputEvent(
      JSON.stringify({ type: "user", text: imgPath }),
    );
    expect(parsed.images).toEqual([imgPath]);
    expect(parsed.text).toMatch(/attached image/);
  });

  it("does not attach a path that does not exist", () => {
    const parsed = parseInputEvent(
      JSON.stringify({ type: "user", text: "see C:/nope/missing.png" }),
    );
    expect(parsed).toEqual({ text: "see C:/nope/missing.png" });
  });

  it("CC_AUTO_IMAGE=0 disables auto-detection", () => {
    const prev = process.env.CC_AUTO_IMAGE;
    process.env.CC_AUTO_IMAGE = "0";
    try {
      const parsed = parseInputEvent(
        JSON.stringify({ type: "user", text: `look ${imgPath}` }),
      );
      expect(parsed).toEqual({ text: `look ${imgPath}` });
    } finally {
      if (prev === undefined) delete process.env.CC_AUTO_IMAGE;
      else process.env.CC_AUTO_IMAGE = prev;
    }
  });
});

describe("stream turn with images", () => {
  let tmpDir;
  let pngPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-stream-img-"));
    pngPath = path.join(tmpDir, "shot.png");
    fs.writeFileSync(pngPath, Buffer.from(PNG_BASE64, "base64"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds multimodal content from the image path", async () => {
    const h = harness({
      inputObjs: [{ type: "user", text: "what is this", images: [pngPath] }],
    });
    await h.run();
    expect(h.seenTurns).toHaveLength(1);
    const user = h.seenTurns[0].find((m) => m.role === "user");
    expect(Array.isArray(user.content)).toBe(true);
    expect(user.content[0]).toEqual({ type: "text", text: "what is this" });
    expect(user.content[1].type).toBe("image_url");
    expect(user.content[1].image_url.url).toBe(
      `data:image/png;base64,${PNG_BASE64}`,
    );
  });

  it("an image turn switches THIS turn to the vision model (text default unchanged)", async () => {
    const h = harness({
      runOptions: {
        provider: "volcengine",
        model: "doubao-seed-1-6-251015", // text model
        baseUrl: "https://ark/api",
        apiKey: "K",
        visionModel: "doubao-vlm",
      },
      inputObjs: [
        { type: "user", text: "plain question" }, // text turn → text model
        { type: "user", text: "look", images: [pngPath] }, // image → vision model
      ],
    });
    await h.run();
    expect(h.seenOpts).toHaveLength(2);
    // text turn keeps the session's text model
    expect(h.seenOpts[0].model).toBe("doubao-seed-1-6-251015");
    // image turn switches model → vision (same provider/baseUrl/apiKey)
    expect(h.seenOpts[1].model).toBe("doubao-vlm");
    expect(h.seenOpts[1].provider).toBe("volcengine");
    expect(h.seenOpts[1].baseUrl).toBe("https://ark/api");
    expect(h.seenOpts[1].apiKey).toBe("K");
  });

  it("a text follow-up AFTER an image turn stays on the vision model (history holds the image)", async () => {
    const h = harness({
      runOptions: {
        provider: "volcengine",
        model: "doubao-seed-1-6-251015", // text-only default model
        baseUrl: "https://ark/api",
        apiKey: "K",
        visionModel: "doubao-vlm",
      },
      inputObjs: [
        { type: "user", text: "what shape", images: [pngPath] }, // image → vision
        { type: "user", text: "what colour is it" }, // follow-up → still vision
      ],
    });
    await h.run();
    expect(h.seenOpts).toHaveLength(2);
    // image turn uses the vision model
    expect(h.seenOpts[0].model).toBe("doubao-vlm");
    // the text follow-up MUST stay on the vision model — the image is still in
    // history and a text-only model can't read it.
    expect(h.seenOpts[1].model).toBe("doubao-vlm");
    expect(h.seenOpts[1].provider).toBe("volcengine");
    expect(h.seenOpts[1].apiKey).toBe("K");
  });

  it("a text turn BEFORE any image stays on the text model", async () => {
    const h = harness({
      runOptions: {
        provider: "volcengine",
        model: "doubao-seed-1-6-251015",
        visionModel: "doubao-vlm",
      },
      inputObjs: [{ type: "user", text: "plain question, no image" }],
    });
    await h.run();
    expect(h.seenOpts).toHaveLength(1);
    expect(h.seenOpts[0].model).toBe("doubao-seed-1-6-251015");
  });

  it("a bad attachment errors the turn, not the session", async () => {
    const h = harness({
      inputObjs: [
        {
          type: "user",
          text: "broken",
          images: [path.join(tmpDir, "nope.png")],
        },
        { type: "user", text: "still alive" },
      ],
    });
    await h.run();
    // First turn never reached the loop; second did.
    expect(h.seenTurns).toHaveLength(1);
    expect(h.seenTurns[0].find((m) => m.role === "user").content).toBe(
      "still alive",
    );
    const errors = h
      .events()
      .filter((e) => e.type === "result" && e.subtype === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].result).toMatch(/image attach failed/);
  });

  it("unsupported extension fails loudly per turn", async () => {
    const bmp = path.join(tmpDir, "x.bmp");
    fs.writeFileSync(bmp, "not an image");
    const h = harness({
      inputObjs: [{ type: "user", text: "x", images: [bmp] }],
    });
    await h.run();
    const errors = h
      .events()
      .filter((e) => e.type === "result" && e.subtype === "error");
    expect(errors[0].result).toMatch(/Unsupported image type/);
  });

  it("text-only turns remain plain strings end-to-end", async () => {
    const h = harness({ inputObjs: [{ type: "user", text: "plain" }] });
    await h.run();
    expect(h.seenTurns[0].find((m) => m.role === "user").content).toBe("plain");
  });
});
