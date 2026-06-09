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
        { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,A" } }] },
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
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
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
