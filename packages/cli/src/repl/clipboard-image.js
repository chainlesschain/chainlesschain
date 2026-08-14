/**
 * Clipboard-image capability boundary for terminal REPL hosts.
 *
 * Plain Node readline receives pasted text only, so standard terminals need a
 * guarded OS adapter to obtain image bytes. Embedded hosts may still inject the
 * same narrow `readImage()` binding used by the production adapter.
 */
import {
  accessSync,
  constants as fsConstants,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, posix as posixPath, win32 as win32Path } from "node:path";
import { executionBroker } from "../lib/process-execution-broker/index.js";
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
  PRIVATE_FILE_MODE,
} from "../lib/secure-fs.js";

export const CLIPBOARD_IMAGE_MEDIA_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
export const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_CLIPBOARD_IMAGE_ATTACHMENTS = 4;
export const MAX_CLIPBOARD_IMAGE_TOTAL_BYTES = 40 * 1024 * 1024;
export const CLIPBOARD_IMAGE_READ_TIMEOUT_MS = 10_000;

const MAX_MACOS_SOURCE_BYTES = 80 * 1024 * 1024;
const MAX_MACOS_IMAGE_PIXELS = 25_000_000;
const MAX_MACOS_IMAGE_DIMENSION = 16_384;
const MAX_MACOS_DECODED_IMAGE_BYTES = 256 * 1024 * 1024;
const MACOS_CLIPBOARD_HELPER_ERROR_STAGES = new Set([
  "arguments",
  "pasteboard",
  "png-read",
  "png-check",
  "tiff-read",
  "tiff-check",
  "tiff-length",
  "tiff-source",
  "tiff-count",
  "tiff-properties",
  "tiff-properties-bridge",
  "tiff-width",
  "tiff-height",
  "tiff-depth",
  "tiff-color-read",
  "tiff-color-model",
  "tiff-decode",
  "tiff-decoded-metadata",
  "tiff-bitmap",
  "tiff-encode",
  "image-length",
  "image-write",
]);

const WINDOWS_CLIPBOARD_IMAGE_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "Add-Type -AssemblyName System.Windows.Forms",
  "Add-Type -AssemblyName System.Drawing",
  "$image=$null",
  "for ($attempt=0; $attempt -lt 3; $attempt+=1) {",
  "  try { $image=[System.Windows.Forms.Clipboard]::GetImage(); break }",
  "  catch [System.Runtime.InteropServices.ExternalException] {",
  "    if ($attempt -eq 2) { throw }",
  "    Start-Sleep -Milliseconds 50",
  "  }",
  "}",
  "if ($null -eq $image) { exit 3 }",
  "$stream=New-Object System.IO.MemoryStream",
  "try {",
  "  $image.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)",
  "  $bytes=$stream.ToArray()",
  "  [Console]::OpenStandardOutput().Write($bytes,0,$bytes.Length)",
  "} finally {",
  "  $stream.Dispose()",
  "  $image.Dispose()",
  "}",
].join("\n");

const MACOS_CLIPBOARD_IMAGE_SCRIPT = String.raw`
ObjC.import("AppKit");
ObjC.import("Foundation");
ObjC.import("ImageIO");

var propertyLookupStatus = "not-read";

function isObjCNil(value) {
  return value == null ||
    (typeof value.isNil === "function" && value.isNil());
}

function propertyValue(properties, key, publicName) {
  propertyLookupStatus = "direct-missing";
  try {
    const directValue = properties.objectForKey(key);
    if (!isObjCNil(directValue)) {
      propertyLookupStatus = "direct";
      return directValue;
    }
  } catch {
    // Fall through to a shallow lookup with the dictionary-owned keys.
  }

  // ImageIO can expose CFString dictionary keys through JXA wrappers that do
  // not compare equal to the separately imported global constant. Walk only
  // the shallow, bounded top-level key list and then query with the exact key
  // object returned by the dictionary. Never recursively unwrap metadata.
  const propertyCount = Number(properties.count);
  if (
    !Number.isSafeInteger(propertyCount) ||
    propertyCount < 1 ||
    propertyCount > 256
  ) {
    propertyLookupStatus = "count-invalid";
    return null;
  }
  const keys = properties.allKeys;
  if (isObjCNil(keys)) {
    propertyLookupStatus = "keys-missing";
    return null;
  }
  const keyCount = Number(keys.count);
  if (keyCount !== propertyCount) {
    propertyLookupStatus = "keys-count-mismatch";
    return null;
  }
  for (let index = 0; index < keyCount; index += 1) {
    const candidate = keys.objectAtIndex(index);
    if (propertyStringEquals(candidate, publicName)) {
      const candidateValue = properties.objectForKey(candidate);
      propertyLookupStatus = isObjCNil(candidateValue)
        ? "candidate-missing"
        : "candidate";
      return candidateValue;
    }
  }
  propertyLookupStatus = "name-missing";
  return null;
}

function propertyNumber(properties, key, publicName) {
  const value = propertyValue(properties, key, publicName);
  if (isObjCNil(value)) return null;
  if (typeof value === "number" || typeof value === "string") {
    return Number(value);
  }
  try {
    const unwrapped = Number(ObjC.unwrap(value));
    if (Number.isSafeInteger(unwrapped) && unwrapped > 0) return unwrapped;
  } catch {}
  // ImageIO declares these dictionary values as CFNumber. CFNumber and
  // NSNumber are toll-free bridged, so use the zero-argument scalar selector
  // when JXA's generic unwrap does not produce a JavaScript number.
  try {
    return Number(value.doubleValue);
  } catch {
    return Number.NaN;
  }
}

function propertyStringEquals(value, expected) {
  if (typeof value === "string") return value === expected;
  return (
    !isObjCNil(value) &&
    typeof value.isEqualToString === "function" &&
    Boolean(value.isEqualToString($(expected)))
  );
}

function run(argv) {
  let stage = "arguments";
  try {
    const outputPath = String(argv[0]);
    const maximumBytes = Number(argv[1]);
    const maximumSourceBytes = Number(argv[2]);
    const maximumPixels = Number(argv[3]);
    const maximumDimension = Number(argv[4]);
    const maximumDecodedBytes = Number(argv[5]);
    stage = "pasteboard";
    const pasteboard = $.NSPasteboard.generalPasteboard;
    stage = "png-read";
    let imageData = pasteboard.dataForType($.NSPasteboardTypePNG);
    let imageKind = "png";
    stage = "png-check";
    if (isObjCNil(imageData)) {
      stage = "tiff-read";
      const tiffData = pasteboard.dataForType($.NSPasteboardTypeTIFF);
      stage = "tiff-check";
      if (isObjCNil(tiffData)) return "none";
      stage = "tiff-length";
      const tiffBytes = Number(tiffData.length);
      if (!Number.isSafeInteger(tiffBytes) || tiffBytes <= 0) {
        return "invalid:tiff-length";
      }
      if (tiffBytes > maximumSourceBytes) return "too-large:tiff-source";
      stage = "tiff-source";
      const imageSource = $.CGImageSourceCreateWithData(tiffData, $());
      stage = "tiff-count";
      const imageCount = isObjCNil(imageSource)
        ? 0
        : Number($.CGImageSourceGetCount(imageSource));
      if (
        isObjCNil(imageSource) ||
        !Number.isSafeInteger(imageCount) ||
        imageCount < 1
      ) {
        return "invalid:tiff-source";
      }
      stage = "tiff-properties";
      const rawProperties = $.CGImageSourceCopyPropertiesAtIndex(
        imageSource,
        0,
        $(),
      );
      if (isObjCNil(rawProperties)) return "invalid:tiff-properties";
      // The C API returns a CFDictionary proxy. Re-bridge it explicitly so
      // JXA exposes NSDictionary selectors without recursively unwrapping the
      // potentially nested metadata tree.
      stage = "tiff-properties-bridge";
      const properties = $.NSDictionary.dictionaryWithDictionary(rawProperties);
      if (isObjCNil(properties)) return "invalid:tiff-properties";
      stage = "tiff-width";
      const width = propertyNumber(
        properties,
        $.kCGImagePropertyPixelWidth,
        "PixelWidth",
      );
      if (width === null) return "invalid:tiff-width-" + propertyLookupStatus;
      if (!Number.isSafeInteger(width) || width <= 0) {
        return "invalid:tiff-width-value";
      }
      stage = "tiff-height";
      const height = propertyNumber(
        properties,
        $.kCGImagePropertyPixelHeight,
        "PixelHeight",
      );
      if (height === null) {
        return "invalid:tiff-height-" + propertyLookupStatus;
      }
      if (!Number.isSafeInteger(height) || height <= 0) {
        return "invalid:tiff-height-value";
      }
      stage = "tiff-depth";
      const depth = propertyNumber(
        properties,
        $.kCGImagePropertyDepth,
        "Depth",
      );
      if (depth === null) return "invalid:tiff-depth-" + propertyLookupStatus;
      if (!Number.isSafeInteger(depth) || depth <= 0) {
        return "invalid:tiff-depth-value";
      }
      stage = "tiff-color-read";
      const colorModel = propertyValue(
        properties,
        $.kCGImagePropertyColorModel,
        "ColorModel",
      );
      if (isObjCNil(colorModel)) return "invalid:tiff-color-model";
      stage = "tiff-color-model";
      const isRgb = propertyStringEquals(colorModel, "RGB");
      const isGray = propertyStringEquals(colorModel, "Gray");
      if (!isRgb && !isGray) return "invalid:unsupported-color-model";
      if (
        depth > 16 ||
        width > maximumDimension ||
        height > maximumDimension ||
        width > Math.floor(maximumPixels / height) ||
        width >
          Math.floor(
            maximumDecodedBytes /
              (height * (isRgb ? 4 : 2) * Math.ceil(depth / 8)),
          )
      ) {
        return "too-large:tiff-metadata";
      }
      stage = "tiff-decode";
      const cgImage = $.CGImageSourceCreateImageAtIndex(imageSource, 0, $());
      if (isObjCNil(cgImage)) return "invalid:tiff-decode";
      stage = "tiff-decoded-metadata";
      const decodedWidth = Number($.CGImageGetWidth(cgImage));
      const decodedHeight = Number($.CGImageGetHeight(cgImage));
      const bitsPerPixel = Number($.CGImageGetBitsPerPixel(cgImage));
      const bytesPerRow = Number($.CGImageGetBytesPerRow(cgImage));
      if (
        decodedWidth !== width ||
        decodedHeight !== height ||
        !Number.isSafeInteger(bitsPerPixel) ||
        !Number.isSafeInteger(bytesPerRow) ||
        bitsPerPixel <= 0 ||
        bytesPerRow <= 0
      ) {
        return "invalid:tiff-decoded";
      }
      if (
        bitsPerPixel > 64 ||
        bytesPerRow > Math.floor(maximumDecodedBytes / decodedHeight)
      ) {
        return "too-large:tiff-decoded";
      }
      stage = "tiff-bitmap";
      const bitmap = $.NSBitmapImageRep.alloc.initWithCGImage(cgImage);
      if (isObjCNil(bitmap)) return "invalid:tiff-bitmap";
      stage = "tiff-encode";
      imageData = bitmap.representationUsingTypeProperties(4, $({}));
      if (isObjCNil(imageData)) return "invalid:tiff-encode";
      imageKind = "tiff-png";
    }
    stage = "image-length";
    const imageBytes = Number(imageData.length);
    if (!Number.isSafeInteger(imageBytes) || imageBytes <= 0) {
      return "invalid:image-length";
    }
    if (imageBytes > maximumBytes) return "too-large:image-bytes";
    stage = "image-write";
    if (!imageData.writeToFileAtomically($(outputPath), true)) {
      return "invalid:image-write";
    }
    return imageKind;
  } catch (error) {
    return "error:" + stage;
  }
}`;

const defaultSystemDeps = {
  accessSync,
  ensurePrivateDirectory,
  ensurePrivateFile,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  spawnSync: (...args) => executionBroker.spawnSync(...args),
  statSync,
  tmpdir,
  writeFileSync,
};

function canExecute(filePath, deps) {
  if (!filePath) return false;
  try {
    deps.accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableFromPath(name, { env, platform, deps }) {
  const pathValue = String(env.PATH || env.Path || "");
  if (!pathValue) return null;
  const separator = platform === "win32" ? ";" : ":";
  const pathJoin = platform === "win32" ? win32Path.join : posixPath.join;
  const extensions =
    platform === "win32"
      ? String(env.PATHEXT || ".EXE;.CMD;.BAT")
          .split(";")
          .filter(Boolean)
      : [""];
  for (const rawDirectory of pathValue.split(separator)) {
    const directory = rawDirectory.trim().replace(/^"|"$/gu, "");
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = pathJoin(directory, `${name}${extension}`);
      if (canExecute(candidate, deps)) return candidate;
    }
  }
  return null;
}

/** Resolve the guarded native tools without spawning an untrusted probe. */
export function resolveSystemClipboardImageTools(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const deps = { ...defaultSystemDeps, ...(options.deps || {}) };
  if (platform === "darwin") {
    const osascript = "/usr/bin/osascript";
    return canExecute(osascript, deps)
      ? { supported: true, executables: { osascript } }
      : {
          supported: false,
          reason: "macOS clipboard image helper is unavailable.",
        };
  }
  if (platform === "win32") {
    const systemRootValue = String(env.SystemRoot || env.WINDIR || "");
    const systemRoot = /^[A-Za-z]:\\[^\r\n<>"|?*]+$/u.test(systemRootValue)
      ? systemRootValue
      : "C:\\Windows";
    const windowsPowerShell = win32Path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const powershell = canExecute(windowsPowerShell, deps)
      ? windowsPowerShell
      : executableFromPath("pwsh", { env, platform, deps });
    return powershell
      ? { supported: true, executables: { powershell } }
      : {
          supported: false,
          reason: "Windows PowerShell clipboard image support is unavailable.",
        };
  }
  if (platform === "linux") {
    if (!env.WAYLAND_DISPLAY && !env.DISPLAY) {
      return {
        supported: false,
        reason: "No Wayland or X11 clipboard display is available.",
      };
    }
    const wlPaste = env.WAYLAND_DISPLAY
      ? executableFromPath("wl-paste", { env, platform, deps })
      : null;
    const xclip = env.DISPLAY
      ? executableFromPath("xclip", { env, platform, deps })
      : null;
    return wlPaste || xclip
      ? { supported: true, executables: { wlPaste, xclip } }
      : {
          supported: false,
          reason: "No Wayland or X11 clipboard image reader is available.",
        };
  }
  return {
    supported: false,
    reason: `System clipboard image reading is unsupported on ${platform}.`,
  };
}

function boundedPositiveInteger(
  value,
  fallback,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function commandFailure(result, tool) {
  if (result?.error?.code === "ENOENT") return `${tool} is unavailable.`;
  if (result?.error?.code === "ETIMEDOUT") {
    return "System clipboard image read timed out.";
  }
  if (result?.signal) return `${tool} clipboard image helper was terminated.`;
  return `${tool} clipboard image helper exited with status ${String(result?.status)}.`;
}

function isOutputLimitError(error) {
  return (
    error?.code === "ENOBUFS" ||
    /maxbuffer/iu.test(String(error?.message || ""))
  );
}

function normalizeStdout(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "binary");
  return Buffer.alloc(0);
}

/** Return the media type identified by image magic bytes, or `null`. */
export function detectClipboardImageMediaType(value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (
    data.length >= 8 &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    data.length >= 6 &&
    (data.subarray(0, 6).equals(Buffer.from("GIF87a", "ascii")) ||
      data.subarray(0, 6).equals(Buffer.from("GIF89a", "ascii")))
  ) {
    return "image/gif";
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).equals(Buffer.from("RIFF", "ascii")) &&
    data.subarray(8, 12).equals(Buffer.from("WEBP", "ascii"))
  ) {
    return "image/webp";
  }
  return null;
}

/** Ordered binary clipboard readers for platforms that expose stdout bytes. */
export function systemClipboardImageCommands(
  platform = process.platform,
  executables = {},
) {
  if (platform === "win32") {
    return executables.powershell
      ? [
          {
            cmd: executables.powershell,
            args: [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-Sta",
              "-Command",
              WINDOWS_CLIPBOARD_IMAGE_SCRIPT,
            ],
            mediaType: "image/png",
            noImageStatus: 3,
          },
        ]
      : [];
  }
  if (platform === "linux") {
    const requestedTypes = [
      ["image/png", "image/png"],
      ["image/jpeg", "image/jpeg"],
      ["image/jpg", "image/jpeg"],
      ["image/gif", "image/gif"],
      ["image/webp", "image/webp"],
    ];
    const readers = [];
    if (executables.wlPaste) {
      readers.push(
        ...requestedTypes.map(([requestedType, mediaType]) => ({
          cmd: executables.wlPaste,
          args: ["--no-newline", "--type", requestedType],
          mediaType,
        })),
      );
    }
    if (executables.xclip) {
      readers.push(
        ...requestedTypes.map(([requestedType, mediaType]) => ({
          cmd: executables.xclip,
          args: ["-selection", "clipboard", "-t", requestedType, "-o"],
          mediaType,
        })),
      );
    }
    return readers;
  }
  return [];
}

function spawnClipboardReader(deps, candidate, { maxBytes, timeoutMs }) {
  return deps.spawnSync(candidate.cmd, candidate.args, {
    encoding: null,
    maxBuffer: maxBytes + 64 * 1024,
    timeout: timeoutMs,
    windowsHide: true,
    origin: "repl:clipboard-image",
    policy: "allow",
    scope: "clipboard",
    shell: false,
  });
}

function readCommandClipboardImage(platform, deps, options) {
  const candidates = systemClipboardImageCommands(
    platform,
    options.executables,
  );
  let commandStarted = false;
  let lastFailure = "No supported system clipboard image tool is available.";
  const deadline = Date.now() + options.timeoutMs;
  for (const candidate of candidates) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error("System clipboard image read timed out.");
    }
    let result;
    try {
      result = spawnClipboardReader(deps, candidate, {
        ...options,
        timeoutMs: remainingMs,
      });
    } catch (error) {
      if (isOutputLimitError(error)) {
        throw new Error(`Clipboard image exceeds ${options.maxBytes} bytes.`);
      }
      if (error?.code === "ETIMEDOUT") {
        throw new Error("System clipboard image read timed out.");
      }
      lastFailure = `${candidate.cmd} clipboard image helper could not start.`;
      continue;
    }
    if (result?.error) {
      if (isOutputLimitError(result.error)) {
        throw new Error(`Clipboard image exceeds ${options.maxBytes} bytes.`);
      }
      if (result.error.code !== "ENOENT") commandStarted = true;
      lastFailure = commandFailure(result, candidate.cmd);
      if (result.error.code === "ETIMEDOUT") throw new Error(lastFailure);
      continue;
    }
    commandStarted = true;
    if (result?.status === candidate.noImageStatus) return null;
    if (result?.status !== 0 || result?.signal) {
      lastFailure = commandFailure(result, candidate.cmd);
      continue;
    }
    const data = normalizeStdout(result.stdout);
    if (!data.length) continue;
    if (data.length > options.maxBytes) {
      throw new Error(`Clipboard image exceeds ${options.maxBytes} bytes.`);
    }
    return { mediaType: candidate.mediaType, data, tool: candidate.cmd };
  }
  if (!commandStarted) throw new Error(lastFailure);
  if (platform === "win32") throw new Error(lastFailure);
  return null;
}

function requirePrivateRegularFile(filePath, deps) {
  const fileStat = deps.lstatSync(filePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error("Clipboard helper did not produce a regular private file.");
  }
  deps.ensurePrivateFile(filePath, {
    applyWindowsAcl: false,
    failIfUnavailable: true,
  });
  return deps.statSync(filePath);
}

function readMacosClipboardImage(deps, options) {
  let directory = null;
  try {
    directory = deps.mkdtempSync(join(deps.tmpdir(), "cc-clipboard-image-"));
    deps.ensurePrivateDirectory(directory, {
      applyWindowsAcl: false,
      failIfUnavailable: true,
    });
    const pngPath = join(directory, "clipboard.png");
    deps.writeFileSync(pngPath, Buffer.alloc(0), {
      mode: PRIVATE_FILE_MODE,
    });
    deps.ensurePrivateFile(pngPath, {
      applyWindowsAcl: false,
      failIfUnavailable: true,
    });

    const readResult = deps.spawnSync(
      options.executables.osascript,
      [
        "-l",
        "JavaScript",
        "-e",
        MACOS_CLIPBOARD_IMAGE_SCRIPT,
        "--",
        pngPath,
        String(options.maxBytes),
        String(MAX_MACOS_SOURCE_BYTES),
        String(MAX_MACOS_IMAGE_PIXELS),
        String(MAX_MACOS_IMAGE_DIMENSION),
        String(MAX_MACOS_DECODED_IMAGE_BYTES),
      ],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        timeout: options.timeoutMs,
        windowsHide: true,
        origin: "repl:clipboard-image",
        policy: "allow",
        scope: "clipboard",
        shell: false,
      },
    );
    if (readResult?.error || readResult?.signal || readResult?.status !== 0) {
      throw new Error(commandFailure(readResult, "osascript"));
    }
    const imageKind = String(readResult.stdout || "")
      .trim()
      .toLowerCase();
    if (imageKind === "none") return null;
    if (imageKind === "too-large" || imageKind.startsWith("too-large:")) {
      throw new Error(`Clipboard image exceeds ${options.maxBytes} bytes.`);
    }
    if (imageKind === "invalid" || imageKind.startsWith("invalid:")) {
      const stageValue = imageKind.includes(":")
        ? imageKind.slice(imageKind.indexOf(":") + 1)
        : "";
      const stage = /^[a-z][a-z-]{0,63}$/u.test(stageValue)
        ? ` (${stageValue})`
        : "";
      throw new Error(
        `macOS clipboard helper returned invalid image data${stage}.`,
      );
    }
    if (imageKind.startsWith("error:")) {
      const stageValue = imageKind.slice("error:".length);
      const stage = MACOS_CLIPBOARD_HELPER_ERROR_STAGES.has(stageValue)
        ? ` (${stageValue})`
        : "";
      throw new Error(`macOS clipboard helper failed${stage}.`);
    }
    if (imageKind !== "png" && imageKind !== "tiff-png") {
      throw new Error("macOS clipboard helper returned an invalid image kind.");
    }
    const finalStat = requirePrivateRegularFile(pngPath, deps);
    if (finalStat.size <= 0)
      throw new Error("The clipboard image payload is empty.");
    if (finalStat.size > options.maxBytes) {
      throw new Error(`Clipboard image exceeds ${options.maxBytes} bytes.`);
    }
    return {
      mediaType: "image/png",
      data: deps.readFileSync(pngPath),
      tool: imageKind === "png" ? "osascript" : "osascript+jxa-tiff",
    };
  } finally {
    if (directory) {
      try {
        deps.rmSync(directory, { recursive: true, force: true });
      } catch {
        // The directory is owner-private; cleanup remains best effort.
      }
    }
  }
}

/** Read one bounded image from the current user's system clipboard. */
export function readSystemClipboardImage(options = {}) {
  const platform = options.platform || process.platform;
  const maxBytes = boundedPositiveInteger(
    options.maxBytes,
    MAX_CLIPBOARD_IMAGE_BYTES,
    MAX_CLIPBOARD_IMAGE_BYTES,
  );
  const timeoutMs = boundedPositiveInteger(
    options.timeoutMs,
    CLIPBOARD_IMAGE_READ_TIMEOUT_MS,
    30_000,
  );
  const deps = { ...defaultSystemDeps, ...(options.deps || {}) };
  const resolution = options.executables
    ? { supported: true, executables: options.executables }
    : resolveSystemClipboardImageTools({
        platform,
        env: options.env || process.env,
        deps,
      });
  if (!resolution.supported) {
    throw new Error(resolution.reason);
  }
  const executionOptions = {
    maxBytes,
    timeoutMs,
    executables: resolution.executables,
  };
  if (platform === "darwin") {
    return readMacosClipboardImage(deps, executionOptions);
  }
  if (platform === "win32" || platform === "linux") {
    return readCommandClipboardImage(platform, deps, executionOptions);
  }
  throw new Error(
    `System clipboard image reading is unsupported on ${platform}.`,
  );
}

/** Create the production binding injected into a standard terminal REPL. */
export function createSystemClipboardImageBinding(options = {}) {
  const platform = options.platform || process.platform;
  const deps = { ...defaultSystemDeps, ...(options.deps || {}) };
  const resolution = resolveSystemClipboardImageTools({
    platform,
    env: options.env || process.env,
    deps,
  });
  if (!resolution.supported) return null;
  return Object.freeze({
    supportsImagePaste: true,
    mode: "system-clipboard",
    platform,
    readImage: async () =>
      readSystemClipboardImage({
        ...options,
        platform,
        deps,
        executables: resolution.executables,
      }),
  });
}

export function detectClipboardImageCapability(binding) {
  if (
    binding?.supportsImagePaste === true &&
    typeof binding.readImage === "function"
  ) {
    const systemClipboard = binding.mode === "system-clipboard";
    return {
      supported: true,
      mode: systemClipboard ? "system-clipboard" : "host-binding",
      reason: systemClipboard
        ? "The CLI can read clipboard image bytes through guarded platform tools."
        : "The terminal host exposes clipboard image bytes.",
    };
  }
  return {
    supported: false,
    mode: "path-fallback",
    reason:
      "This terminal exposes pasted text only, not clipboard image bytes. Save the image and paste its png/jpg/gif/webp path to attach it.",
  };
}

function decodeImageData(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value !== "string") return null;
  const base64 = value.replace(/^data:[^;,]+;base64,/i, "").trim();
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return null;
  try {
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

/**
 * Read one image from a trusted host binding and return an OpenAI-shaped image
 * content part (the CLI's provider-neutral internal multimodal shape).
 */
export async function readClipboardImageChip(binding, options = {}) {
  const capability = detectClipboardImageCapability(binding);
  if (!capability.supported) return { ok: false, ...capability };
  let image;
  try {
    image = await binding.readImage();
  } catch (error) {
    return {
      ok: false,
      supported: true,
      mode: capability.mode,
      reason: `Clipboard image read failed: ${error?.message || String(error)}`,
    };
  }
  if (!image) {
    return {
      ok: false,
      supported: true,
      mode: capability.mode,
      reason: "The clipboard does not currently contain an image.",
    };
  }
  const mediaType = String(image.mediaType || image.type || "").toLowerCase();
  if (!CLIPBOARD_IMAGE_MEDIA_TYPES.includes(mediaType)) {
    return {
      ok: false,
      supported: true,
      mode: capability.mode,
      reason: `Unsupported clipboard image type: ${mediaType || "unknown"}.`,
    };
  }
  const data = decodeImageData(image.data);
  if (!data?.length) {
    return {
      ok: false,
      supported: true,
      mode: capability.mode,
      reason: "The clipboard image payload is empty or invalid.",
    };
  }
  const maxBytes = boundedPositiveInteger(
    options.maxBytes,
    MAX_CLIPBOARD_IMAGE_BYTES,
    MAX_CLIPBOARD_IMAGE_BYTES,
  );
  if (data.length > maxBytes) {
    return {
      ok: false,
      supported: true,
      mode: capability.mode,
      reason: `Clipboard image exceeds ${maxBytes} bytes.`,
    };
  }
  const detectedMediaType = detectClipboardImageMediaType(data);
  if (detectedMediaType !== mediaType) {
    return {
      ok: false,
      supported: true,
      mode: capability.mode,
      reason: detectedMediaType
        ? `Clipboard image signature is ${detectedMediaType}, not ${mediaType}.`
        : "Clipboard image signature is invalid or unsupported.",
    };
  }
  return {
    ok: true,
    supported: true,
    mode: capability.mode,
    bytes: data.length,
    mediaType,
    chip: {
      type: "image_url",
      image_url: {
        url: `data:${mediaType};base64,${data.toString("base64")}`,
      },
    },
  };
}
