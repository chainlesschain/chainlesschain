/**
 * Multimodal (vision) input helpers for `cc agent --image`. Pure-shape unit
 * tests; the live path is exercised against a vision-capable provider (e.g.
 * volcengine doubao) in an E2E.
 */
import { describe, it, expect } from "vitest";
import {
  resolveImages,
  buildUserContent,
  parseDataUrl,
  hasImageContent,
  toOllamaMessages,
  imageUrlBlockToAnthropic,
  resolveVisionLlm,
  detectImagePaths,
  prepareVisionTurn,
  DEFAULT_VISION_MODEL,
} from "../../src/lib/image-input.js";

const fakeFs = {
  readFileSync: (p) => Buffer.from(`bytes-of-${p}`),
};

describe("resolveImages", () => {
  it("returns [] for no paths", () => {
    expect(resolveImages(undefined)).toEqual([]);
    expect(resolveImages([])).toEqual([]);
  });

  it("reads files → {mediaType, base64 data} with media type from extension", () => {
    const out = resolveImages(["a.png", "b.JPG", "c.webp"], { fs: fakeFs });
    expect(out.map((x) => x.mediaType)).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
    expect(out[0].data).toBe(Buffer.from("bytes-of-a.png").toString("base64"));
  });

  it("throws on an unsupported extension", () => {
    expect(() => resolveImages(["doc.pdf"], { fs: fakeFs })).toThrow(
      /Unsupported image type/,
    );
  });
});

describe("buildUserContent", () => {
  it("returns the plain string when there are no images", () => {
    expect(buildUserContent("hello", [])).toBe("hello");
    expect(buildUserContent("hello", undefined)).toBe("hello");
  });

  it("builds an OpenAI multimodal array (text first, then image_url)", () => {
    const out = buildUserContent("what is this", [
      { mediaType: "image/png", data: "AAAA" },
    ]);
    expect(out).toEqual([
      { type: "text", text: "what is this" },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,AAAA" },
      },
    ]);
  });
});

describe("parseDataUrl", () => {
  it("parses a valid data URL", () => {
    expect(parseDataUrl("data:image/jpeg;base64,ZZ==")).toEqual({
      mediaType: "image/jpeg",
      data: "ZZ==",
    });
  });
  it("returns null on a non-data URL", () => {
    expect(parseDataUrl("https://x/y.png")).toBeNull();
    expect(parseDataUrl("")).toBeNull();
  });
});

describe("hasImageContent", () => {
  it("detects image_url parts", () => {
    expect(
      hasImageContent([
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,A" },
            },
          ],
        },
      ]),
    ).toBe(true);
    expect(hasImageContent([{ role: "user", content: "plain" }])).toBe(false);
  });
});

describe("toOllamaMessages", () => {
  it("converts multimodal content to {content, images[base64]}", () => {
    const out = toOllamaMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,AAAA" },
          },
        ],
      },
    ]);
    expect(out[0]).toEqual({
      role: "user",
      content: "look",
      images: ["AAAA"],
    });
  });
  it("passes string-content messages through untouched", () => {
    const msgs = [{ role: "assistant", content: "hi", tool_calls: [] }];
    expect(toOllamaMessages(msgs)).toEqual(msgs);
  });
});

describe("imageUrlBlockToAnthropic", () => {
  it("converts an image_url block to an Anthropic image block", () => {
    expect(
      imageUrlBlockToAnthropic({
        type: "image_url",
        image_url: { url: "data:image/png;base64,AAAA" },
      }),
    ).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "AAAA" },
    });
  });
  it("returns null for non-image blocks", () => {
    expect(imageUrlBlockToAnthropic({ type: "text", text: "x" })).toBeNull();
  });
});

describe("resolveVisionLlm", () => {
  const llm = {
    provider: "volcengine",
    model: "doubao-text",
    baseUrl: "https://ark/api",
    apiKey: "K",
    visionModel: "doubao-1-5-vision-pro-32k-250115",
  };

  it("with no image: ignores vision config (provider/model undefined unless flagged)", () => {
    expect(resolveVisionLlm({ hasImage: false, flags: {}, llm })).toEqual({
      provider: undefined,
      model: undefined,
      baseUrl: undefined,
      apiKey: undefined,
    });
  });

  it("with an image: switches to configured vision provider/model/baseUrl/apiKey", () => {
    expect(resolveVisionLlm({ hasImage: true, flags: {}, llm })).toEqual({
      provider: "volcengine",
      model: "doubao-1-5-vision-pro-32k-250115",
      baseUrl: "https://ark/api",
      apiKey: "K",
    });
  });

  it("explicit flags always win over vision config", () => {
    const out = resolveVisionLlm({
      hasImage: true,
      flags: {
        provider: "openai",
        model: "gpt-4o",
        baseUrl: "u",
        apiKey: "k2",
      },
      llm,
    });
    expect(out).toEqual({
      provider: "openai",
      model: "gpt-4o",
      baseUrl: "u",
      apiKey: "k2",
    });
  });

  it("--vision-model overrides the configured vision model", () => {
    expect(
      resolveVisionLlm({
        hasImage: true,
        flags: { visionModel: "my-vlm" },
        llm,
      }).model,
    ).toBe("my-vlm");
  });

  it("falls back to DEFAULT_VISION_MODEL when none configured", () => {
    expect(
      resolveVisionLlm({
        hasImage: true,
        flags: {},
        llm: { provider: "volcengine" },
      }).model,
    ).toBe(DEFAULT_VISION_MODEL);
  });
});

describe("detectImagePaths (Claude-Code-style path auto-detect)", () => {
  // existsSync stub: only these paths "exist".
  const mk = (existing) => ({
    existsSync: (p) => existing.includes(p),
  });

  it("attaches an existing local image path and strips it from the text", () => {
    const r = detectImagePaths(
      "describe ./shot.png please",
      mk(["./shot.png"]),
    );
    expect(r.images).toEqual(["./shot.png"]);
    expect(r.text).toBe("describe please");
  });

  it("handles a bare Windows path and an all-path message", () => {
    const win = String.raw`C:\tmp\a.png`;
    const r = detectImagePaths(win, mk([win]));
    expect(r.images).toEqual([win]);
    expect(r.text).toBe(""); // image-only → caller synthesizes a prompt
  });

  it("supports quoted paths with spaces + multiple images, deduped", () => {
    const spaced = String.raw`C:\my pics\a.png`;
    const r = detectImagePaths(
      `compare "${spaced}" and b.jpg and a.png again "${spaced}"`,
      mk([spaced, "b.jpg", "a.png"]),
    );
    expect(r.images).toEqual([spaced, "b.jpg", "a.png"]);
  });

  it("ignores non-existent paths, unsupported extensions, and URLs", () => {
    expect(detectImagePaths("see missing.png", mk([])).images).toEqual([]);
    expect(
      detectImagePaths("a report.pdf here", mk(["report.pdf"])).images,
    ).toEqual([]);
    expect(
      detectImagePaths("https://x.com/p.png", mk(["https://x.com/p.png"]))
        .images,
    ).toEqual([]);
  });

  it("returns text unchanged when nothing matches; tolerates non-strings", () => {
    expect(detectImagePaths("just words", mk([]))).toEqual({
      images: [],
      text: "just words",
    });
    expect(detectImagePaths("", mk([]))).toEqual({ images: [], text: "" });
    expect(detectImagePaths(null, mk([]))).toEqual({ images: [], text: "" });
  });
});

describe("prepareVisionTurn (REPL interactive composition)", () => {
  const deps = (existing) => ({
    existsSync: (p) => existing.includes(p),
    fs: { readFileSync: (p) => Buffer.from(`bytes-of-${p}`) },
  });
  const llm = {
    provider: "volcengine",
    baseUrl: "https://ark/api",
    apiKey: "K",
    visionModel: "doubao-vlm",
  };

  it("no image path → plain text content, no vision override", () => {
    const r = prepareVisionTurn("just a question", llm, deps([]));
    expect(r.content).toBe("just a question");
    expect(r.images).toEqual([]);
    expect(r.visionLlm).toBeNull();
  });

  it("image path → multimodal content + vision LLM override (model switched)", () => {
    const r = prepareVisionTurn("describe a.png now", llm, deps(["a.png"]));
    expect(r.images).toEqual(["a.png"]);
    expect(Array.isArray(r.content)).toBe(true);
    expect(r.content[0]).toEqual({ type: "text", text: "describe now" });
    expect(r.content[1].type).toBe("image_url");
    // same provider/baseUrl/apiKey, model switched to the configured vision model
    expect(r.visionLlm).toEqual({
      provider: "volcengine",
      model: "doubao-vlm",
      baseUrl: "https://ark/api",
      apiKey: "K",
    });
  });

  it("path-only message → synthesized instruction + attachment", () => {
    const r = prepareVisionTurn("a.png", llm, deps(["a.png"]));
    expect(r.content[0].text).toMatch(/attached image/);
    expect(r.visionLlm.model).toBe("doubao-vlm");
  });

  it("falls back to the default vision model when none configured", () => {
    const r = prepareVisionTurn(
      "see a.png",
      { provider: "volcengine" },
      deps(["a.png"]),
    );
    expect(r.visionLlm.model).toBe(DEFAULT_VISION_MODEL);
  });
});
