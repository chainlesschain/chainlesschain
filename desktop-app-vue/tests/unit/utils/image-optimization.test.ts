/**
 * image-optimization 测试 — src/renderer/utils/image-optimization.ts
 *
 * ResponsiveImageGenerator srcset/sizes/element (pure via SmartImageLoader.
 * buildOptimizedUrl; webp:false + networkAware:false keep the URL deterministic)
 * and the static ImagePlaceholderGenerator (canvas-backed → string, '' when
 * jsdom has no 2d context). logger mocked.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  ResponsiveImageGenerator,
  SmartImageLoader,
  ImagePlaceholderGenerator,
} from "@/utils/image-optimization";

function cdnGenerator(breakpoints: number[]) {
  const loader = new SmartImageLoader({
    cdnBase: "https://cdn/",
    webp: false,
    networkAware: false,
  });
  return new ResponsiveImageGenerator({ breakpoints, loader });
}

describe("image-optimization — ResponsiveImageGenerator", () => {
  it("generateSrcSet emits one CDN URL + width descriptor per breakpoint", () => {
    const srcset = cdnGenerator([320, 640]).generateSrcSet("img.jpg", {
      quality: 80,
    });
    expect(srcset).toContain("https://cdn/img.jpg?w=320&q=80 320w");
    expect(srcset).toContain("640w");
    expect(srcset.split(", ")).toHaveLength(2);
  });

  it("generateSizes passes through a string config or returns a responsive default", () => {
    const gen = new ResponsiveImageGenerator();
    expect(gen.generateSizes("100vw")).toBe("100vw");
    expect(gen.generateSizes()).toContain("vw");
    expect(gen.generateSizes(null)).toContain("max-width");
  });

  it("createResponsiveImage builds an <img> with srcset/sizes/attrs", () => {
    const gen = new ResponsiveImageGenerator({ breakpoints: [320] });
    const img = gen.createResponsiveImage("x.jpg", {
      alt: "A",
      className: "c",
      loading: "lazy",
    });
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("x.jpg");
    expect(img.alt).toBe("A");
    expect(img.className).toBe("c");
    expect(img.loading).toBe("lazy");
    expect(img.srcset).toContain("320w");
    expect(img.sizes).toContain("vw");
  });
});

describe("image-optimization — ImagePlaceholderGenerator", () => {
  it("generateColorPlaceholder / generateGradientPlaceholder return strings", () => {
    expect(typeof ImagePlaceholderGenerator.generateColorPlaceholder("#fff")).toBe(
      "string",
    );
    expect(
      typeof ImagePlaceholderGenerator.generateGradientPlaceholder([
        "#aaa",
        "#bbb",
      ]),
    ).toBe("string");
  });
});
