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
      expect(args[3]).toContain("CGImageSourceCopyPropertiesAtIndex");
      expect(args[3]).toContain("width > Math.floor(maximumPixels / height)");
      expect(args[3]).toContain("CGImageSourceCreateImageAtIndex");
      expect(
        args[3].indexOf("CGImageSourceCopyPropertiesAtIndex"),
      ).toBeLessThan(args[3].indexOf("CGImageSourceCreateImageAtIndex"));
      expect(args[3]).not.toContain("imageRepWithData");
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

  it("accepts primitive and wrapped JXA TIFF metadata", () => {
    let jxaScript;
    const spawnSync = vi.fn((command, args) => {
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

    const wrappedNil = { isNil: () => true };
    const tiffData = { isNil: () => false, length: "128" };
    const encodedPng = {
      isNil: () => false,
      length: String(PNG_BYTES.length),
      writeToFileAtomically: () => true,
    };
    const colorModel = {
      isNil: () => false,
      value: "RGB",
      isEqualToString: (expected) => (expected?.value ?? expected) === "RGB",
    };
    let primitiveColorModel = false;
    let primitiveNumberMetadata = true;
    let omittedMetadataKey = null;
    const wrappedNumber = (value) => ({ isNil: () => false, value });
    const rawProperties = { isNil: () => false };
    const properties = {
      isNil: () => false,
      objectForKey: (key) => {
        if (key === omittedMetadataKey) return undefined;
        const value = {
          PixelWidth: 3,
          PixelHeight: 2,
          Depth: 8,
          ColorModel: primitiveColorModel ? "RGB" : colorModel,
        }[key];
        return key === "ColorModel" || primitiveNumberMetadata
          ? value
          : wrappedNumber(value);
      },
    };
    const pasteboard = {
      dataForType: (type) => (type === "public.png" ? wrappedNil : tiffData),
    };
    const bridge = (value) => value;
    Object.assign(bridge, {
      NSPasteboard: { generalPasteboard: pasteboard },
      NSPasteboardTypePNG: "public.png",
      NSPasteboardTypeTIFF: "public.tiff",
      NSDictionary: {
        dictionaryWithDictionary: (value) => {
          if (value !== rawProperties) {
            throw new Error("unexpected metadata dictionary");
          }
          return properties;
        },
      },
      CGImageSourceCreateWithData: () => ({ isNil: () => false }),
      CGImageSourceGetCount: () => "1",
      CGImageSourceCopyPropertiesAtIndex: () => rawProperties,
      CGImageSourceCreateImageAtIndex: () => ({ isNil: () => false }),
      CGImageGetWidth: () => "3",
      CGImageGetHeight: () => "2",
      CGImageGetBitsPerPixel: () => "32",
      CGImageGetBytesPerRow: () => "12",
      NSBitmapImageRep: {
        alloc: {
          initWithCGImage: () => ({
            isNil: () => false,
            representationUsingTypeProperties: () => encodedPng,
          }),
        },
      },
    });
    const unwrap = vi.fn((value) => {
      if (typeof value?.value !== "number") {
        throw new Error("only wrapped numeric metadata may be unwrapped");
      }
      return value.value;
    });
    const context = {
      ObjC: {
        import: () => {},
        unwrap,
      },
      $: bridge,
    };
    const runTiffFallback = () =>
      runInNewContext(
        `${jxaScript}\nrun(["/tmp/image.png", "1024", "1024", "100", "100", "4096"]);`,
        context,
      );
    expect(runTiffFallback()).toBe("tiff-png");
    expect(unwrap).not.toHaveBeenCalled();
    primitiveNumberMetadata = false;
    primitiveColorModel = true;
    expect(runTiffFallback()).toBe("tiff-png");
    expect(unwrap).toHaveBeenCalledTimes(3);
    omittedMetadataKey = "Depth";
    expect(runTiffFallback()).toBe("invalid:tiff-depth");
    expect(unwrap).toHaveBeenCalledTimes(5);
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
