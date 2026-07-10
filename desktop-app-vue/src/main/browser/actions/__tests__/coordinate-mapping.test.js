/**
 * coordinate-mapping — pure transforms, no native modules. This is the
 * unit-testable heart of the computer-use coordinate-space fix: the desktop
 * screenshot ↔ physical screen and page screenshot ↔ viewport CSS mappings.
 */
import { describe, it, expect } from "vitest";

const {
  scalePoint,
  displayPhysicalSize,
  imageToScreen,
  imageToViewport,
} = require("../coordinate-mapping.js");

describe("scalePoint", () => {
  it("is the identity when source and target match", () => {
    expect(
      scalePoint({
        x: 100,
        y: 200,
        sourceWidth: 1280,
        sourceHeight: 720,
        targetWidth: 1280,
        targetHeight: 720,
      }),
    ).toEqual({ x: 100, y: 200 });
  });

  it("scales X and Y independently (non-uniform aspect)", () => {
    // 1920×1080 image mapped onto a 2560×1440 target: uniform 4:3 scale here.
    expect(
      scalePoint({
        x: 960,
        y: 540,
        sourceWidth: 1920,
        sourceHeight: 1080,
        targetWidth: 2560,
        targetHeight: 1440,
      }),
    ).toEqual({ x: 1280, y: 720 });

    // Deliberately mismatched aspect — X and Y scales differ, and using one
    // for both would skew the off-axis coordinate.
    expect(
      scalePoint({
        x: 100,
        y: 100,
        sourceWidth: 1000,
        sourceHeight: 500,
        targetWidth: 2000,
        targetHeight: 2500,
      }),
    ).toEqual({ x: 200, y: 500 });
  });

  it("rejects non-positive dimensions (avoids NaN/Infinity clicks)", () => {
    expect(() =>
      scalePoint({
        x: 1,
        y: 1,
        sourceWidth: 0,
        sourceHeight: 10,
        targetWidth: 10,
        targetHeight: 10,
      }),
    ).toThrow(/sourceWidth/);
    expect(() =>
      scalePoint({
        x: 1,
        y: 1,
        sourceWidth: 10,
        sourceHeight: 10,
        targetWidth: 10,
        targetHeight: NaN,
      }),
    ).toThrow(/targetHeight/);
  });
});

describe("displayPhysicalSize", () => {
  it("multiplies logical size by scaleFactor", () => {
    expect(
      displayPhysicalSize({
        size: { width: 1280, height: 800 },
        scaleFactor: 2,
      }),
    ).toEqual({ width: 2560, height: 1600, scaleFactor: 2 });
  });

  it("defaults scaleFactor to 1", () => {
    expect(
      displayPhysicalSize({ size: { width: 1920, height: 1080 } }),
    ).toEqual({ width: 1920, height: 1080, scaleFactor: 1 });
  });
});

describe("imageToScreen", () => {
  const display1080 = { size: { width: 1920, height: 1080 }, scaleFactor: 1 };

  it("is the identity when the thumbnail already matches the screen (dsf=1)", () => {
    expect(
      imageToScreen({
        imageX: 960,
        imageY: 540,
        imageWidth: 1920,
        imageHeight: 1080,
        display: display1080,
      }),
    ).toEqual({ x: 960, y: 540, space: "physical" });
  });

  it("maps a 1920-wide thumbnail onto a 2560×1440 physical screen", () => {
    // A vision model picked the centre of a 1920×1080 thumbnail; the real
    // screen is 2560×1440 at scaleFactor 1 → click must land at (1280,720).
    expect(
      imageToScreen({
        imageX: 960,
        imageY: 540,
        imageWidth: 1920,
        imageHeight: 1080,
        display: { size: { width: 2560, height: 1440 }, scaleFactor: 1 },
      }),
    ).toEqual({ x: 1280, y: 720, space: "physical" });
  });

  it("accounts for DPI scaleFactor when targeting physical pixels", () => {
    // 1920×1080 thumbnail, logical screen 1920×1080 but scaleFactor 2 →
    // physical 3840×2160. Centre of the thumbnail → physical (1920,1080).
    expect(
      imageToScreen({
        imageX: 960,
        imageY: 540,
        imageWidth: 1920,
        imageHeight: 1080,
        display: { size: { width: 1920, height: 1080 }, scaleFactor: 2 },
      }),
    ).toEqual({ x: 1920, y: 1080, space: "physical" });
  });

  it("space:'logical' targets DIP pixels (pre-scaleFactor)", () => {
    expect(
      imageToScreen({
        imageX: 960,
        imageY: 540,
        imageWidth: 1920,
        imageHeight: 1080,
        display: { size: { width: 1920, height: 1080 }, scaleFactor: 2 },
        space: "logical",
      }),
    ).toEqual({ x: 960, y: 540, space: "logical" });
  });

  it("rounds to whole pixels", () => {
    const r = imageToScreen({
      imageX: 100,
      imageY: 100,
      imageWidth: 1000,
      imageHeight: 1000,
      display: { size: { width: 1333, height: 1333 }, scaleFactor: 1 },
    });
    expect(Number.isInteger(r.x)).toBe(true);
    expect(r.x).toBe(133);
  });
});

describe("imageToViewport", () => {
  it("is the identity at dsf=1, non-fullPage (preserves the common case)", () => {
    expect(imageToViewport({ imageX: 125, imageY: 215 })).toEqual({
      x: 125,
      y: 215,
      pageX: 125,
      pageY: 215,
      needsScroll: false,
    });
  });

  it("divides out the devicePixelRatio for a retina viewport shot", () => {
    // A dsf=2 viewport screenshot is 2× the CSS viewport; the model's 250,430
    // image pixels are CSS (125,215).
    expect(
      imageToViewport({ imageX: 250, imageY: 430, deviceScaleFactor: 2 }),
    ).toEqual({ x: 125, y: 215, pageX: 125, pageY: 215, needsScroll: false });
  });

  it("returns a page coordinate + needsScroll for a fullPage shot", () => {
    // fullPage image at dsf=1: 400,3000 is a PAGE coordinate 3000px down —
    // page.mouse.click is viewport-relative, so the caller must scroll first.
    expect(
      imageToViewport({ imageX: 400, imageY: 3000, fullPage: true }),
    ).toEqual({ pageX: 400, pageY: 3000, needsScroll: true });
  });

  it("combines dsf and fullPage", () => {
    expect(
      imageToViewport({
        imageX: 800,
        imageY: 6000,
        deviceScaleFactor: 2,
        fullPage: true,
      }),
    ).toEqual({ pageX: 400, pageY: 3000, needsScroll: true });
  });

  it("rejects a non-positive deviceScaleFactor", () => {
    expect(() =>
      imageToViewport({ imageX: 1, imageY: 1, deviceScaleFactor: 0 }),
    ).toThrow(/deviceScaleFactor/);
  });
});
