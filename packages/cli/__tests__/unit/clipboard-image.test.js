import { existsSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  createSystemClipboardImageBinding,
  detectClipboardImageCapability,
  detectClipboardImageMediaType,
  MAX_CLIPBOARD_IMAGE_BYTES,
  readClipboardImageChip,
  readSystemClipboardImage,
  resolveSystemClipboardImageTools,
  systemClipboardImageCommands,
} from "../../src/repl/clipboard-image.js";

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("clipboard-image-test"),
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

const MACOS_JXA_LIMITS = Object.freeze({
  maximumBytes: 20 * 1024 * 1024,
  maximumSourceBytes: 80 * 1024 * 1024,
  maximumPixels: 25_000_000,
  maximumDimension: 16_384,
  maximumDecodedBytes: 256 * 1024 * 1024,
});

function captureMacosClipboardJxaScript() {
  let jxaScript;
  const spawnSync = vi.fn((_command, args) => {
    jxaScript = args[3];
    writeFileSync(args[5], PNG_BYTES);
    return {
      status: 0,
      signal: null,
      stdout: "tiff-png\n",
      stderr: "",
    };
  });
  readSystemClipboardImage({
    platform: "darwin",
    executables: { osascript: "/usr/bin/osascript" },
    deps: { spawnSync },
  });
  return jxaScript;
}

function createMacosTiffJxaHarness(jxaScript, overrides = {}) {
  const values = {
    sourceBytes: 128,
    imageCount: 1,
    cgImage: { isNil: () => false },
    isMask: false,
    width: 3,
    height: 2,
    bitsPerComponent: 8,
    bitsPerPixel: 32,
    bytesPerRow: 12,
    colorSpace: { isNil: () => false },
    colorModel: 1,
    encodedBytes: PNG_BYTES.length,
    throwAt: null,
    ...overrides,
  };
  const calls = [];
  const invoke = (name, getValue) => {
    calls.push(name);
    if (values.throwAt === name) {
      throw new Error(`private ${name} detail`);
    }
    return getValue();
  };
  const write = vi.fn(() => true);
  const encode = vi.fn(() => ({
    isNil: () => false,
    get length() {
      return values.encodedBytes;
    },
    writeToFileAtomically: write,
  }));
  const bitmap = {
    isNil: () => false,
    representationUsingTypeProperties: encode,
  };
  const bitmapInit = vi.fn(() => invoke("initWithCGImage", () => bitmap));
  const wrappedNil = { isNil: () => true };
  const tiffData = {
    isNil: () => false,
    get length() {
      return values.sourceBytes;
    },
  };
  const imageSource = { isNil: () => false };
  const pasteboard = {
    dataForType: (type) => (type === "public.png" ? wrappedNil : tiffData),
  };
  const bridge = (value) => value;
  Object.assign(bridge, {
    NSPasteboard: { generalPasteboard: pasteboard },
    NSPasteboardTypePNG: "public.png",
    NSPasteboardTypeTIFF: "public.tiff",
    kCGColorSpaceModelMonochrome: 0,
    kCGColorSpaceModelRGB: 1,
    CGImageSourceCreateWithData: () =>
      invoke("CGImageSourceCreateWithData", () => imageSource),
    CGImageSourceGetCount: () =>
      invoke("CGImageSourceGetCount", () => values.imageCount),
    CGImageSourceCreateImageAtIndex: () =>
      invoke("CGImageSourceCreateImageAtIndex", () => values.cgImage),
    CGImageIsMask: () => invoke("CGImageIsMask", () => values.isMask),
    CGImageGetWidth: () => invoke("CGImageGetWidth", () => values.width),
    CGImageGetHeight: () => invoke("CGImageGetHeight", () => values.height),
    CGImageGetBitsPerComponent: () =>
      invoke("CGImageGetBitsPerComponent", () => values.bitsPerComponent),
    CGImageGetBitsPerPixel: () =>
      invoke("CGImageGetBitsPerPixel", () => values.bitsPerPixel),
    CGImageGetBytesPerRow: () =>
      invoke("CGImageGetBytesPerRow", () => values.bytesPerRow),
    CGImageGetColorSpace: () =>
      invoke("CGImageGetColorSpace", () => values.colorSpace),
    CGColorSpaceGetModel: () =>
      invoke("CGColorSpaceGetModel", () => values.colorModel),
    NSBitmapImageRep: { alloc: { initWithCGImage: bitmapInit } },
  });
  const run = (limitOverrides = {}) => {
    const limits = { ...MACOS_JXA_LIMITS, ...limitOverrides };
    const argv = [
      "/tmp/image.png",
      limits.maximumBytes,
      limits.maximumSourceBytes,
      limits.maximumPixels,
      limits.maximumDimension,
      limits.maximumDecodedBytes,
    ].map(String);
    return runInNewContext(`${jxaScript}\nrun(${JSON.stringify(argv)});`, {
      ObjC: { import: () => {} },
      $: bridge,
    });
  };
  return { bitmapInit, calls, encode, run, values, write };
}

function expectNoMacosRenderOrWrite(harness) {
  expect(harness.bitmapInit).not.toHaveBeenCalled();
  expect(harness.encode).not.toHaveBeenCalled();
  expect(harness.write).not.toHaveBeenCalled();
}

describe("clipboard image capability", () => {
  it("keeps a truthful path fallback when no production binding is available", () => {
    expect(detectClipboardImageCapability(null)).toEqual({
      supported: false,
      mode: "path-fallback",
      reason:
        "This terminal exposes pasted text only, not clipboard image bytes. Save the image and paste its png/jpg/gif/webp path to attach it.",
    });
    expect(
      createSystemClipboardImageBinding({
        platform: "linux",
        env: { PATH: "/usr/bin" },
        deps: { accessSync: vi.fn() },
      }),
    ).toBeNull();
  });

  it("requires a display and a real Linux clipboard reader before advertising support", () => {
    const available = new Set(["/usr/bin/xclip"]);
    const deps = {
      accessSync: vi.fn((filePath) => {
        if (!available.has(filePath))
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }),
    };
    expect(
      resolveSystemClipboardImageTools({
        platform: "linux",
        env: { PATH: "/usr/bin", DISPLAY: ":99" },
        deps,
      }),
    ).toEqual({
      supported: true,
      executables: { wlPaste: null, xclip: "/usr/bin/xclip" },
    });
    expect(
      resolveSystemClipboardImageTools({
        platform: "linux",
        env: { PATH: "/usr/bin" },
        deps,
      }),
    ).toMatchObject({ supported: false });
  });

  it("accepts a declared host binding and creates an internal image chip", async () => {
    const binding = {
      supportsImagePaste: true,
      readImage: vi.fn(async () => ({
        mediaType: "image/png",
        data: PNG_BYTES,
      })),
    };
    const result = await readClipboardImageChip(binding);
    expect(result).toMatchObject({
      ok: true,
      mode: "host-binding",
      mediaType: "image/png",
      bytes: PNG_BYTES.length,
      chip: { type: "image_url" },
    });
    expect(result.chip.image_url.url).toBe(
      `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
    );
  });

  it("recognizes only supported image magic and rejects MIME confusion", async () => {
    expect(detectClipboardImageMediaType(PNG_BYTES)).toBe("image/png");
    expect(detectClipboardImageMediaType(JPEG_BYTES)).toBe("image/jpeg");
    expect(detectClipboardImageMediaType(Buffer.from("GIF89a"))).toBe(
      "image/gif",
    );
    expect(
      detectClipboardImageMediaType(
        Buffer.concat([
          Buffer.from("RIFF"),
          Buffer.alloc(4),
          Buffer.from("WEBP"),
        ]),
      ),
    ).toBe("image/webp");
    expect(
      detectClipboardImageMediaType(Buffer.from("not-an-image")),
    ).toBeNull();

    await expect(
      readClipboardImageChip({
        supportsImagePaste: true,
        readImage: async () => ({ mediaType: "image/png", data: JPEG_BYTES }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("image/jpeg"),
    });
  });

  it("rejects undeclared, unsupported, empty, invalid, and oversized payloads", async () => {
    await expect(
      readClipboardImageChip({ readImage: async () => ({}) }),
    ).resolves.toMatchObject({ ok: false, mode: "path-fallback" });
    await expect(
      readClipboardImageChip({
        supportsImagePaste: true,
        readImage: async () => ({ mediaType: "image/tiff", data: "eA==" }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("type"),
    });
    await expect(
      readClipboardImageChip({
        supportsImagePaste: true,
        readImage: async () => null,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("does not"),
    });
    await expect(
      readClipboardImageChip({
        supportsImagePaste: true,
        readImage: async () => ({ mediaType: "image/png", data: "bad***" }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("invalid"),
    });
    await expect(
      readClipboardImageChip(
        {
          supportsImagePaste: true,
          readImage: async () => ({ mediaType: "image/png", data: PNG_BYTES }),
        },
        { maxBytes: PNG_BYTES.length - 1 },
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("exceeds"),
    });
    const oversized = Buffer.alloc(MAX_CLIPBOARD_IMAGE_BYTES + 1);
    PNG_BYTES.subarray(0, 8).copy(oversized);
    await expect(
      readClipboardImageChip(
        {
          supportsImagePaste: true,
          readImage: async () => ({ mediaType: "image/png", data: oversized }),
        },
        { maxBytes: Number.POSITIVE_INFINITY },
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("exceeds"),
    });
  });
});

describe("system clipboard image readers", () => {
  it("uses Windows STA PowerShell, raw stdout, and the broker policy boundary", async () => {
    const spawnSync = vi.fn(() => ({
      status: 0,
      signal: null,
      stdout: PNG_BYTES,
      stderr: Buffer.alloc(0),
    }));
    const binding = createSystemClipboardImageBinding({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows", PATH: "" },
      deps: { accessSync: vi.fn(), spawnSync },
    });
    expect(detectClipboardImageCapability(binding)).toMatchObject({
      supported: true,
      mode: "system-clipboard",
    });
    await expect(readClipboardImageChip(binding)).resolves.toMatchObject({
      ok: true,
      mode: "system-clipboard",
      mediaType: "image/png",
    });
    const [command, args, options] = spawnSync.mock.calls[0];
    expect(command).toMatch(/powershell\.exe$/iu);
    expect(args).toContain("-Sta");
    expect(args.join(" ")).toContain("OpenStandardOutput");
    const script = args.at(-1);
    expect(script).toContain("}\n  catch");
    expect(script).toContain("} finally {");
    expect(script).not.toMatch(/\};\s*(?:catch|finally)/u);
    expect(options).toMatchObject({
      encoding: null,
      origin: "repl:clipboard-image",
      policy: "allow",
      scope: "clipboard",
      shell: false,
    });
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.maxBuffer).toBeGreaterThan(PNG_BYTES.length);
  });

  it("maps the Windows no-image status to a bounded empty result", async () => {
    expect(
      readSystemClipboardImage({
        platform: "win32",
        executables: { powershell: "powershell.exe" },
        deps: {
          spawnSync: vi.fn(() => ({ status: 3, stdout: Buffer.alloc(0) })),
        },
      }),
    ).toBeNull();
  });

  it("does not misreport a Windows helper failure as an empty clipboard", () => {
    expect(() =>
      readSystemClipboardImage({
        platform: "win32",
        executables: { powershell: "powershell.exe" },
        deps: {
          spawnSync: vi.fn(() => ({
            status: 1,
            signal: null,
            stdout: Buffer.alloc(0),
            stderr: Buffer.from("private failure detail"),
          })),
        },
      }),
    ).toThrow("exited with status 1");
  });

  it("falls back across guarded Linux readers and MIME types", async () => {
    const spawnSync = vi.fn((command) => {
      if (command === "/usr/bin/wl-paste") {
        return {
          error: Object.assign(new Error("missing"), { code: "ENOENT" }),
        };
      }
      return {
        status: 0,
        signal: null,
        stdout: PNG_BYTES,
        stderr: Buffer.alloc(0),
      };
    });
    expect(
      readSystemClipboardImage({
        platform: "linux",
        executables: {
          wlPaste: "/usr/bin/wl-paste",
          xclip: "/usr/bin/xclip",
        },
        deps: { spawnSync },
      }),
    ).toMatchObject({
      mediaType: "image/png",
      data: PNG_BYTES,
      tool: "/usr/bin/xclip",
    });
    expect(
      systemClipboardImageCommands("linux", {
        wlPaste: "/usr/bin/wl-paste",
        xclip: "/usr/bin/xclip",
      })[0],
    ).toMatchObject({
      args: ["--no-newline", "--type", "image/png"],
    });
    expect(spawnSync).toHaveBeenCalledTimes(6);
    expect(
      spawnSync.mock.calls
        .slice(0, 5)
        .every(([command]) => command === "/usr/bin/wl-paste"),
    ).toBe(true);
    expect(spawnSync.mock.calls[5][0]).toBe("/usr/bin/xclip");
    for (const call of spawnSync.mock.calls) {
      expect(call[2]).toMatchObject({ shell: false, policy: "allow" });
    }
  });

  it("fails closed when a native reader exceeds the output budget", async () => {
    expect(() =>
      readSystemClipboardImage({
        platform: "linux",
        executables: { wlPaste: "/usr/bin/wl-paste", xclip: null },
        deps: {
          spawnSync: vi.fn(() => ({
            error: Object.assign(new Error("stdout maxBuffer exceeded"), {
              code: "ENOBUFS",
            }),
          })),
        },
      }),
    ).toThrow("exceeds");
  });

  it("shares one absolute deadline across Linux MIME and backend candidates", () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10_001);
    const spawnSync = vi.fn(() => ({
      status: 1,
      signal: null,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from("private host detail"),
    }));
    try {
      expect(() =>
        readSystemClipboardImage({
          platform: "linux",
          timeoutMs: 10_000,
          executables: {
            wlPaste: "/usr/bin/wl-paste",
            xclip: "/usr/bin/xclip",
          },
          deps: { spawnSync },
        }),
      ).toThrow("timed out");
      expect(spawnSync).toHaveBeenCalledTimes(1);
      expect(spawnSync.mock.calls[0][2].timeout).toBe(10_000);
    } finally {
      now.mockRestore();
    }
  });

  it("reads native macOS PNG bytes and removes the private temporary directory", async () => {
    let temporaryFile;
    const spawnSync = vi.fn((command, args) => {
      expect(command).toBe("/usr/bin/osascript");
      expect(args.slice(0, 3)).toEqual(["-l", "JavaScript", "-e"]);
      temporaryFile = args[5];
      writeFileSync(temporaryFile, PNG_BYTES);
      return { status: 0, signal: null, stdout: "png\n", stderr: "" };
    });
    expect(
      readSystemClipboardImage({
        platform: "darwin",
        executables: { osascript: "/usr/bin/osascript" },
        deps: { spawnSync },
      }),
    ).toMatchObject({ mediaType: "image/png", data: PNG_BYTES });
    expect(temporaryFile).toBeTruthy();
    expect(existsSync(dirname(temporaryFile))).toBe(false);
  });

  it("converts a macOS TIFF clipboard to PNG and cleans up", async () => {
    let temporaryFile;
    const spawnSync = vi.fn((command, args) => {
      expect(command).toBe("/usr/bin/osascript");
      temporaryFile = args[5];
      expect(args[3]).toContain("tiffBytes > maximumSourceBytes");
      expect(args[3]).toContain("isObjCNil(imageData)");
      expect(args[3]).toContain("isObjCNil(tiffData)");
      expect(args[3]).toContain("CGImageSourceCreateWithData(tiffData, $())");
      expect(args[3]).toContain('ObjC.import("CoreGraphics")');
      expect(args[3]).toContain("width > Math.floor(maximumPixels / height)");
      expect(args[3]).toContain(
        "CGImageSourceCreateImageAtIndex(imageSource, 0, $())",
      );
      expect(args[3]).toContain("CGImageGetBitsPerComponent");
      expect(args[3]).toContain("CGImageGetBitsPerPixel");
      expect(args[3]).toContain("CGImageGetBytesPerRow");
      expect(args[3]).toContain("CGImageGetColorSpace");
      expect(args[3]).toContain("CGColorSpaceGetModel");
      expect(args[3]).toContain("CGImageIsMask");
      expect(args[3]).not.toMatch(
        /metadata|thumbnail|CGImageSourceCopyProperties|CGImageProperty|CFDictionary|NSDictionary|allKeys/iu,
      );
      expect(args[3]).not.toContain('"PixelWidth"');
      expect(args[3]).not.toContain('"PixelHeight"');
      expect(args[3]).not.toContain('"Depth"');
      expect(args[3]).not.toContain('"ColorModel"');
      expect(args[3]).not.toContain("imageRepWithData");
      expect(args[3].indexOf("CGImageSourceCreateImageAtIndex")).toBeLessThan(
        args[3].indexOf("CGImageGetWidth"),
      );
      expect(args[3].indexOf("CGImageGetBytesPerRow")).toBeLessThan(
        args[3].indexOf("initWithCGImage"),
      );
      expect(args[3].indexOf("maximumDecodedBytes / height")).toBeLessThan(
        args[3].indexOf("initWithCGImage"),
      );
      expect(args[3]).toContain("imageBytes > maximumBytes");
      expect(args[3].indexOf("imageBytes > maximumBytes")).toBeLessThan(
        args[3].indexOf("writeToFileAtomically"),
      );
      writeFileSync(temporaryFile, PNG_BYTES);
      return { status: 0, signal: null, stdout: "tiff-png\n", stderr: "" };
    });
    expect(
      readSystemClipboardImage({
        platform: "darwin",
        executables: { osascript: "/usr/bin/osascript" },
        deps: { spawnSync },
      }),
    ).toMatchObject({
      mediaType: "image/png",
      data: PNG_BYTES,
      tool: "osascript+jxa-tiff",
    });
    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(existsSync(dirname(temporaryFile))).toBe(false);
  });

  it("cleans up macOS temporary state when conversion fails", async () => {
    let temporaryFile;
    const spawnSync = vi.fn((command, args) => {
      expect(command).toBe("/usr/bin/osascript");
      temporaryFile = args[5];
      return { status: 1, signal: null, stdout: "", stderr: "failed" };
    });
    expect(() =>
      readSystemClipboardImage({
        platform: "darwin",
        executables: { osascript: "/usr/bin/osascript" },
        deps: { spawnSync },
      }),
    ).toThrow("osascript clipboard image helper exited with status 1");
    expect(existsSync(dirname(temporaryFile))).toBe(false);
  });

  it.each([
    ["RGB", { colorModel: 1, bitsPerPixel: 32, bytesPerRow: 12 }],
    ["Monochrome", { colorModel: 0, bitsPerPixel: 8, bytesPerRow: 3 }],
  ])(
    "validates and converts a lazy macOS %s CGImage before rendering",
    (_label, overrides) => {
      const harness = createMacosTiffJxaHarness(
        captureMacosClipboardJxaScript(),
        overrides,
      );
      expect(harness.run()).toBe("tiff-png");
      expect(harness.bitmapInit).toHaveBeenCalledTimes(1);
      expect(harness.encode).toHaveBeenCalledTimes(1);
      expect(harness.write).toHaveBeenCalledWith("/tmp/image.png", true);
      expect(harness.calls.indexOf("CGImageGetBytesPerRow")).toBeLessThan(
        harness.calls.indexOf("initWithCGImage"),
      );
      expect(harness.calls.indexOf("CGColorSpaceGetModel")).toBeLessThan(
        harness.calls.indexOf("initWithCGImage"),
      );
    },
  );

  it.each([
    ["CGImage", { cgImage: null }, "invalid:tiff-image-create"],
    ["color space", { colorSpace: null }, "invalid:tiff-color-space"],
  ])("fails closed for a nil macOS %s", (_label, overrides, expected) => {
    const harness = createMacosTiffJxaHarness(
      captureMacosClipboardJxaScript(),
      overrides,
    );
    expect(harness.run()).toBe(expected);
    expectNoMacosRenderOrWrite(harness);
  });

  it.each([
    ["CGImageSourceCreateImageAtIndex", "error:tiff-image-create"],
    ["CGImageIsMask", "error:tiff-image-layout"],
    ["CGImageGetWidth", "error:tiff-image-layout"],
    ["CGImageGetHeight", "error:tiff-image-layout"],
    ["CGImageGetBitsPerComponent", "error:tiff-image-layout"],
    ["CGImageGetBitsPerPixel", "error:tiff-image-layout"],
    ["CGImageGetBytesPerRow", "error:tiff-image-layout"],
    ["CGImageGetColorSpace", "error:tiff-color-space"],
    ["CGColorSpaceGetModel", "error:tiff-color-model"],
  ])(
    "contains a throwing macOS %s getter at a stable stage",
    (name, expected) => {
      const harness = createMacosTiffJxaHarness(
        captureMacosClipboardJxaScript(),
        { throwAt: name },
      );
      expect(harness.run()).toBe(expected);
      expectNoMacosRenderOrWrite(harness);
    },
  );

  it.each([
    ["width", 0],
    ["width", Number.MAX_SAFE_INTEGER + 1],
    ["height", 0],
    ["height", Number.MAX_SAFE_INTEGER + 1],
    ["bitsPerComponent", 0],
    ["bitsPerComponent", Number.MAX_SAFE_INTEGER + 1],
    ["bitsPerPixel", 0],
    ["bitsPerPixel", Number.MAX_SAFE_INTEGER + 1],
    ["bytesPerRow", 0],
    ["bytesPerRow", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects a non-positive or unsafe macOS %s scalar", (field, value) => {
    const harness = createMacosTiffJxaHarness(
      captureMacosClipboardJxaScript(),
      { [field]: value },
    );
    expect(harness.run()).toBe("invalid:tiff-image-layout");
    expectNoMacosRenderOrWrite(harness);
  });

  it("rejects an unsafe macOS mask flag before rendering", () => {
    const harness = createMacosTiffJxaHarness(
      captureMacosClipboardJxaScript(),
      { isMask: "not-a-number" },
    );
    expect(harness.run()).toBe("invalid:tiff-image-layout");
    expectNoMacosRenderOrWrite(harness);
  });

  it.each([
    {
      name: "source byte maximum",
      overrides: { sourceBytes: 80 * 1024 * 1024 },
      expected: "tiff-png",
    },
    {
      name: "source byte overflow",
      overrides: { sourceBytes: 80 * 1024 * 1024 + 1 },
      expected: "too-large:tiff-source",
    },
    {
      name: "width maximum",
      overrides: { width: 16_384, height: 1, bytesPerRow: 65_536 },
      expected: "tiff-png",
    },
    {
      name: "width overflow",
      overrides: { width: 16_385, height: 1, bytesPerRow: 65_540 },
      expected: "too-large:tiff-image-layout",
    },
    {
      name: "height maximum",
      overrides: { width: 1, height: 16_384, bytesPerRow: 4 },
      expected: "tiff-png",
    },
    {
      name: "height overflow",
      overrides: { width: 1, height: 16_385, bytesPerRow: 4 },
      expected: "too-large:tiff-image-layout",
    },
    {
      name: "pixel maximum",
      overrides: { width: 5_000, height: 5_000, bytesPerRow: 20_000 },
      expected: "tiff-png",
    },
    {
      name: "pixel overflow",
      overrides: { width: 5_001, height: 5_000, bytesPerRow: 20_004 },
      expected: "too-large:tiff-image-layout",
    },
    {
      name: "component depth maximum",
      overrides: { bitsPerComponent: 16, bitsPerPixel: 64, bytesPerRow: 24 },
      expected: "tiff-png",
    },
    {
      name: "component depth overflow",
      overrides: { bitsPerComponent: 17, bitsPerPixel: 64, bytesPerRow: 24 },
      expected: "too-large:tiff-image-layout",
    },
    {
      name: "pixel depth maximum",
      overrides: { bitsPerPixel: 64, bytesPerRow: 24 },
      expected: "tiff-png",
    },
    {
      name: "pixel depth overflow",
      overrides: { bitsPerPixel: 65, bytesPerRow: 25 },
      expected: "too-large:tiff-image-layout",
    },
    {
      name: "decoded row budget maximum",
      overrides: { bytesPerRow: 128 * 1024 * 1024 },
      expected: "tiff-png",
    },
    {
      name: "decoded row budget overflow",
      overrides: { bytesPerRow: 128 * 1024 * 1024 + 1 },
      expected: "too-large:tiff-image-layout",
    },
    {
      name: "normalized bitmap budget maximum",
      overrides: {
        width: 16_384,
        height: 2_048,
        bitsPerComponent: 16,
        bitsPerPixel: 48,
        bytesPerRow: 98_304,
      },
      limits: { maximumPixels: 100_000_000 },
      expected: "tiff-png",
    },
    {
      name: "normalized bitmap budget overflow",
      overrides: {
        width: 16_384,
        height: 2_049,
        bitsPerComponent: 16,
        bitsPerPixel: 48,
        bytesPerRow: 98_304,
      },
      limits: { maximumPixels: 100_000_000 },
      expected: "too-large:tiff-image-layout",
    },
    {
      name: "minimum row layout",
      overrides: { bytesPerRow: 12 },
      expected: "tiff-png",
    },
    {
      name: "inconsistent component layout",
      overrides: {
        bitsPerComponent: 16,
        bitsPerPixel: 32,
        bytesPerRow: 12,
      },
      expected: "invalid:tiff-image-layout",
    },
    {
      name: "short row layout",
      overrides: { bytesPerRow: 11 },
      expected: "invalid:tiff-image-layout",
    },
  ])(
    "enforces the macOS $name boundary before rendering",
    ({ expected, limits, overrides }) => {
      const harness = createMacosTiffJxaHarness(
        captureMacosClipboardJxaScript(),
        overrides,
      );
      expect(harness.run(limits)).toBe(expected);
      if (expected === "tiff-png") {
        expect(harness.bitmapInit).toHaveBeenCalledTimes(1);
        expect(harness.write).toHaveBeenCalledTimes(1);
      } else {
        expectNoMacosRenderOrWrite(harness);
      }
    },
  );

  it.each([
    ["image mask", { isMask: true }, "invalid:tiff-image-mask"],
    [
      "unsupported color model",
      { colorModel: 2 },
      "invalid:unsupported-color-model",
    ],
  ])("rejects a macOS %s before rendering", (_label, overrides, expected) => {
    const harness = createMacosTiffJxaHarness(
      captureMacosClipboardJxaScript(),
      overrides,
    );
    expect(harness.run()).toBe(expected);
    expectNoMacosRenderOrWrite(harness);
  });

  it("rejects invalid macOS helper limits before native clipboard access", () => {
    const harness = createMacosTiffJxaHarness(captureMacosClipboardJxaScript());
    expect(harness.run({ maximumPixels: 0 })).toBe("invalid:arguments");
    expect(harness.calls).toEqual([]);
    expectNoMacosRenderOrWrite(harness);
  });

  it("reports only a stable macOS helper validation stage", () => {
    expect(() =>
      readSystemClipboardImage({
        platform: "darwin",
        executables: { osascript: "/usr/bin/osascript" },
        deps: {
          spawnSync: vi.fn(() => ({
            status: 0,
            signal: null,
            stdout: "invalid:tiff-source\n",
            stderr: "",
          })),
        },
      }),
    ).toThrow("invalid image data (tiff-source)");
  });

  it("reports a stable lazy CGImage layout exception stage", () => {
    expect(() =>
      readSystemClipboardImage({
        platform: "darwin",
        executables: { osascript: "/usr/bin/osascript" },
        deps: {
          spawnSync: vi.fn(() => ({
            status: 0,
            signal: null,
            stdout: "error:tiff-image-layout\n",
            stderr: "private native detail",
          })),
        },
      }),
    ).toThrow("macOS clipboard helper failed (tiff-image-layout)");
  });

  it("converts JXA bridge exceptions to a stable macOS helper stage", () => {
    let jxaScript;
    const spawnSync = vi.fn((command, args) => {
      jxaScript = args[3];
      return {
        status: 0,
        signal: null,
        stdout: "error:image-write\n",
        stderr: "private bridge detail",
      };
    });
    expect(() =>
      readSystemClipboardImage({
        platform: "darwin",
        executables: { osascript: "/usr/bin/osascript" },
        deps: { spawnSync },
      }),
    ).toThrow("macOS clipboard helper failed (image-write)");
    expect(jxaScript).toContain('stage = "png-read"');
    expect(jxaScript).toContain('return "error:" + stage');

    const bridge = (value) => value;
    bridge.NSPasteboard = {
      generalPasteboard: {
        dataForType: () => {
          throw new Error("private pasteboard detail");
        },
      },
    };
    bridge.NSPasteboardTypePNG = "public.png";
    expect(
      runInNewContext(
        `${jxaScript}\nrun(["/tmp/image.png", "1024", "1024", "100", "100", "4096"]);`,
        { ObjC: { import: () => {} }, $: bridge },
      ),
    ).toBe("error:png-read");
  });

  it("does not echo an unrecognized macOS helper error stage", () => {
    expect(() =>
      readSystemClipboardImage({
        platform: "darwin",
        executables: { osascript: "/usr/bin/osascript" },
        deps: {
          spawnSync: vi.fn(() => ({
            status: 0,
            signal: null,
            stdout: "error:private-clipboard-detail\n",
            stderr: "",
          })),
        },
      }),
    ).toThrow(/^macOS clipboard helper failed\.$/u);
  });
});
