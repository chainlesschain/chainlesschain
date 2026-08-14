#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import { executionBroker } from "../src/lib/process-execution-broker/index.js";
import {
  createSystemClipboardImageBinding,
  detectClipboardImageMediaType,
} from "../src/repl/clipboard-image.js";
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
  PRIVATE_FILE_MODE,
} from "../src/lib/secure-fs.js";

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const WIDTH = 3;
const HEIGHT = 2;
const LINUX_OWNER_READY_TIMEOUT_MS = 5_000;
const LINUX_OWNER_EXIT_TIMEOUT_MS = 5_000;
const LINUX_OWNER_TERM_GRACE_MS = 1_000;
const LINUX_OWNER_KILL_GRACE_MS = 3_000;
const LINUX_OWNER_READY_MESSAGE = "Waiting for one selection request.";
const PROCESS_TIMEOUT = Object.freeze({ type: "timeout" });

const WINDOWS_SET_IMAGE_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$stage='load-winforms'",
  "  try {",
  "    Add-Type -AssemblyName System.Windows.Forms",
  "    $stage='load-drawing'",
  "    Add-Type -AssemblyName System.Drawing",
  "    $stage='fixture-missing'",
  "    if (!(Test-Path -LiteralPath $env:CC_CLIPBOARD_IMAGE_FIXTURE -PathType Leaf)) { throw [System.IO.FileNotFoundException]::new('clipboard fixture is missing') }",
  "    $stage='fixture-open'",
  "    $stream=[System.IO.File]::OpenRead($env:CC_CLIPBOARD_IMAGE_FIXTURE)",
  "    try {",
  "      $stage='fixture-decode'",
  "      $image=[System.Drawing.Image]::FromStream($stream)",
  "      try {",
  "        $stage='clipboard-set'",
  "        for ($attempt=0; $attempt -lt 3; $attempt+=1) {",
  "          try { [System.Windows.Forms.Clipboard]::SetImage($image); break }",
  "          catch [System.Runtime.InteropServices.ExternalException] {",
  "            if ($attempt -eq 2) { throw }",
  "            Start-Sleep -Milliseconds 50",
  "          }",
  "        }",
  "      } finally { $image.Dispose() }",
  "    } finally { $stream.Dispose() }",
  "  } catch {",
  "    [Console]::Error.WriteLine(('CC_CLIPBOARD_FIXTURE_STAGE={0} TYPE={1} MESSAGE={2}' -f $stage, $_.Exception.GetType().FullName, $_.Exception.Message))",
  "    exit 91",
  "  }",
].join("\n");

const MACOS_SET_IMAGE_SCRIPT = String.raw`
ObjC.import("AppKit");
ObjC.import("Foundation");

function isObjCNil(value) {
  return value == null ||
    (typeof value.isNil === "function" && value.isNil());
}

function run(argv) {
  const data = $.NSData.dataWithContentsOfFile($(String(argv[0])));
  if (isObjCNil(data)) throw new Error("PNG fixture read failed");
  const pasteboard = $.NSPasteboard.generalPasteboard;
  pasteboard.clearContents;
  if (!pasteboard.setDataForType(data, $.NSPasteboardTypePNG)) {
    throw new Error("PNG clipboard write failed");
  }
}`;

const MACOS_SET_TIFF_SCRIPT = String.raw`
ObjC.import("AppKit");
ObjC.import("Foundation");

function isObjCNil(value) {
  return value == null ||
    (typeof value.isNil === "function" && value.isNil());
}

function run(argv) {
  const data = $.NSData.dataWithContentsOfFile($(String(argv[0])));
  if (isObjCNil(data)) throw new Error("TIFF fixture read failed");
  const pasteboard = $.NSPasteboard.generalPasteboard;
  pasteboard.clearContents;
  if (!pasteboard.setDataForType(data, $.NSPasteboardTypeTIFF)) {
    throw new Error("TIFF clipboard write failed");
  }
}`;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

export function createFixturePng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    const row = [0];
    for (let x = 0; x < WIDTH; x += 1) {
      row.push(31 + x * 67, 47 + y * 83, 191 - x * 41, 255);
    }
    rows.push(Buffer.from(row));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function paethPredictor(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodePngScanlines(inflated, { width, height, bytesPerPixel }) {
  const rowBytes = width * bytesPerPixel;
  const expectedBytes = (rowBytes + 1) * height;
  if (inflated.length !== expectedBytes) {
    throw new Error("clipboard host smoke PNG scanline length is invalid");
  }
  const pixels = Buffer.alloc(rowBytes * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const rowOffset = y * rowBytes;
    const previousRowOffset = rowOffset - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[sourceOffset + x];
      const left =
        x >= bytesPerPixel ? pixels[rowOffset + x - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[previousRowOffset + x] : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? pixels[previousRowOffset + x - bytesPerPixel]
          : 0;
      let reconstructed;
      if (filter === 0) reconstructed = raw;
      else if (filter === 1) reconstructed = raw + left;
      else if (filter === 2) reconstructed = raw + above;
      else if (filter === 3) {
        reconstructed = raw + Math.floor((left + above) / 2);
      } else if (filter === 4) {
        reconstructed = raw + paethPredictor(left, above, upperLeft);
      } else {
        throw new Error("clipboard host smoke PNG uses an invalid row filter");
      }
      pixels[rowOffset + x] = reconstructed & 0xff;
    }
    sourceOffset += rowBytes;
  }
  return pixels;
}

/** Decode a bounded, non-interlaced 8-bit PNG to a canonical RGBA identity. */
export function pngPixelIdentity(data) {
  if (detectClipboardImageMediaType(data) !== "image/png") {
    throw new Error("clipboard host smoke did not read a PNG image");
  }
  const idatChunks = [];
  let offset = 8;
  let ihdr = null;
  let sawEnd = false;
  while (offset < data.length) {
    if (offset + 12 > data.length) {
      throw new Error("clipboard host smoke PNG is truncated");
    }
    const length = data.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > data.length) {
      throw new Error("clipboard host smoke PNG chunk is truncated");
    }
    const typeBytes = data.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    const chunkData = data.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = data.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([typeBytes, chunkData])) !== expectedCrc) {
      throw new Error("clipboard host smoke PNG chunk checksum is invalid");
    }
    if (!ihdr && type !== "IHDR") {
      throw new Error("clipboard host smoke PNG has no canonical IHDR");
    }
    if (type === "IHDR") {
      if (ihdr || length !== 13) {
        throw new Error("clipboard host smoke PNG IHDR is invalid");
      }
      ihdr = Buffer.from(chunkData);
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(chunkData));
    } else if (type === "IEND") {
      if (length !== 0 || chunkEnd !== data.length) {
        throw new Error("clipboard host smoke PNG IEND is invalid");
      }
      sawEnd = true;
    }
    offset = chunkEnd;
  }
  if (!ihdr || !sawEnd || idatChunks.length === 0) {
    throw new Error("clipboard host smoke PNG structure is incomplete");
  }
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const compression = ihdr[10];
  const filterMethod = ihdr[11];
  const interlace = ihdr[12];
  const channelCounts = new Map([
    [0, 1],
    [2, 3],
    [4, 2],
    [6, 4],
  ]);
  const bytesPerPixel = channelCounts.get(colorType);
  if (
    width <= 0 ||
    height <= 0 ||
    width > 4096 ||
    height > 4096 ||
    bitDepth !== 8 ||
    !bytesPerPixel ||
    compression !== 0 ||
    filterMethod !== 0 ||
    interlace !== 0
  ) {
    throw new Error("clipboard host smoke PNG encoding is unsupported");
  }
  const expectedInflatedBytes = (width * bytesPerPixel + 1) * height;
  let inflated;
  try {
    inflated = inflateSync(Buffer.concat(idatChunks), {
      maxOutputLength: expectedInflatedBytes,
    });
  } catch {
    throw new Error("clipboard host smoke PNG image data is invalid");
  }
  const nativePixels = decodePngScanlines(inflated, {
    width,
    height,
    bytesPerPixel,
  });
  const rgba = Buffer.alloc(width * height * 4);
  for (let source = 0, target = 0; source < nativePixels.length;) {
    if (colorType === 0) {
      const gray = nativePixels[source];
      rgba.set([gray, gray, gray, 255], target);
    } else if (colorType === 2) {
      rgba.set(
        [
          nativePixels[source],
          nativePixels[source + 1],
          nativePixels[source + 2],
          255,
        ],
        target,
      );
    } else if (colorType === 4) {
      const gray = nativePixels[source];
      rgba.set([gray, gray, gray, nativePixels[source + 1]], target);
    } else {
      rgba.set(nativePixels.subarray(source, source + 4), target);
    }
    source += bytesPerPixel;
    target += 4;
  }
  return Object.freeze({
    dimensions: Object.freeze({ width, height }),
    pixelSha256: createHash("sha256").update(rgba).digest("hex"),
  });
}

export function pngDimensions(data) {
  return pngPixelIdentity(data).dimensions;
}

function brokerSpawn(command, args, options = {}) {
  const result = executionBroker.spawnSync(command, args, {
    maxBuffer: 64 * 1024,
    timeout: 15_000,
    windowsHide: true,
    origin: "test:clipboard-image-host-smoke",
    policy: "allow",
    scope: "clipboard",
    shell: false,
    ...options,
  });
  if (!result || result.error || result.signal || result.status !== 0) {
    const diagnostic = boundedProcessDiagnostic(
      result?.stderr || result?.error?.message,
    );
    const outcome = [
      `status=${result?.status ?? "missing"}`,
      result?.signal ? `signal=${result.signal}` : null,
      result?.error?.code ? `error=${result.error.code}` : null,
      diagnostic ? `diagnostic=${diagnostic}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    throw new Error(`${command} clipboard host fixture failed (${outcome})`);
  }
  return result;
}

function boundedProcessDiagnostic(value, maximumBytes = 1_024) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximumBytes);
}

function waitForPromise(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(PROCESS_TIMEOUT), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function linuxClipboardOwnerArgs(filePath) {
  return [
    "-quiet",
    "-loops",
    "1",
    "-selection",
    "clipboard",
    "-t",
    "image/png",
    "-i",
    filePath,
  ];
}

export function trackLinuxClipboardOwner(child) {
  const state = {
    child,
    error: null,
    outcome: null,
    terminal: null,
    ready: false,
    stderr: "",
    writer: "xclip",
  };
  let resolveReady;
  let resolveFailure;
  let resolveDone;
  let resolveTerminal;
  state.readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });
  state.failurePromise = new Promise((resolve) => {
    resolveFailure = resolve;
  });
  state.done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  state.terminalPromise = new Promise((resolve) => {
    resolveTerminal = resolve;
  });
  child.stderr?.setEncoding?.("utf8");
  child.stderr?.on?.("data", (chunk) => {
    state.stderr = `${state.stderr}${String(chunk)}`.slice(-4_096);
    if (!state.ready && state.stderr.includes(LINUX_OWNER_READY_MESSAGE)) {
      state.ready = true;
      resolveReady({ type: "ready" });
    }
  });
  child.stderr?.on?.("error", (error) => {
    state.error = error;
    resolveFailure({ type: "stderr-error", error });
  });
  child.once("error", (error) => {
    state.error = error;
    resolveFailure({ type: "error", error });
  });
  child.once("exit", (code, signal) => {
    state.terminal = { type: "exit", code, signal };
    resolveTerminal(state.terminal);
  });
  child.once("close", (code, signal) => {
    if (!state.terminal) {
      state.terminal = { type: "exit", code, signal };
      resolveTerminal(state.terminal);
    }
    state.outcome = { type: "close", code, signal };
    resolveDone(state.outcome);
  });
  return state;
}

function linuxOwnerIsTerminal(owner) {
  return Boolean(
    owner?.error ||
    owner?.terminal ||
    owner?.outcome ||
    owner?.child?.exitCode != null ||
    owner?.child?.signalCode != null,
  );
}

function linuxOwnerDiagnostic(owner) {
  const terminal = owner.outcome || owner.terminal;
  return [
    owner.error?.code ? `error=${owner.error.code}` : null,
    terminal ? `code=${terminal.code}` : null,
    terminal?.signal ? `signal=${terminal.signal}` : null,
    boundedProcessDiagnostic(owner.stderr)
      ? `diagnostic=${boundedProcessDiagnostic(owner.stderr)}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function disposeLinuxClipboardOwner(
  owner,
  {
    termGraceMs = LINUX_OWNER_TERM_GRACE_MS,
    killGraceMs = LINUX_OWNER_KILL_GRACE_MS,
  } = {},
) {
  if (!owner?.child) return true;
  if (owner.outcome) return true;
  if (linuxOwnerIsTerminal(owner)) {
    return (await waitForPromise(owner.done, killGraceMs)) !== PROCESS_TIMEOUT;
  }
  let termSent = false;
  try {
    termSent = owner.child.kill("SIGTERM") !== false;
  } catch {
    // Continue to the observed close deadline.
  }
  if ((await waitForPromise(owner.done, termGraceMs)) !== PROCESS_TIMEOUT) {
    return true;
  }
  if (linuxOwnerIsTerminal(owner) || !termSent) {
    return (await waitForPromise(owner.done, killGraceMs)) !== PROCESS_TIMEOUT;
  }
  try {
    owner.child.kill("SIGKILL");
  } catch {
    // Continue to the observed close deadline.
  }
  return (await waitForPromise(owner.done, killGraceMs)) !== PROCESS_TIMEOUT;
}

export async function startLinuxClipboardOwner(
  filePath,
  {
    spawn = (...args) => executionBroker.spawn(...args),
    readyTimeoutMs = LINUX_OWNER_READY_TIMEOUT_MS,
  } = {},
) {
  const child = spawn("xclip", linuxClipboardOwnerArgs(filePath), {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
    origin: "test:clipboard-image-host-smoke",
    policy: "allow",
    scope: "clipboard",
    shell: false,
  });
  const owner = trackLinuxClipboardOwner(child);
  const readiness = await waitForPromise(
    Promise.race([
      owner.readyPromise,
      owner.failurePromise,
      owner.terminalPromise,
      owner.done,
    ]),
    readyTimeoutMs,
  );
  if (readiness?.type === "ready") {
    await new Promise((resolve) => setImmediate(resolve));
    if (!linuxOwnerIsTerminal(owner)) return owner;
  }
  const diagnostic = linuxOwnerDiagnostic(owner);
  const cleaned = await disposeLinuxClipboardOwner(owner);
  const startupError = new Error(
    `xclip clipboard owner did not become ready (${readiness?.type || "unknown"}${diagnostic ? ` ${diagnostic}` : ""})`,
  );
  if (!cleaned) {
    const cleanupError = new Error(
      "xclip clipboard owner cleanup could not be confirmed",
    );
    throw new AggregateError(
      [startupError, cleanupError],
      `${startupError.message}; ${cleanupError.message}`,
    );
  }
  throw startupError;
}

export async function requireClipboardWriterRetired(
  owner,
  timeoutMs = LINUX_OWNER_EXIT_TIMEOUT_MS,
) {
  if (!owner?.done) return null;
  const outcome = await waitForPromise(owner.done, timeoutMs);
  if (
    outcome === PROCESS_TIMEOUT ||
    owner.error ||
    outcome?.code !== 0 ||
    outcome?.signal != null
  ) {
    throw new Error(
      `xclip clipboard owner did not retire cleanly (${linuxOwnerDiagnostic(owner) || "exit-timeout"})`,
    );
  }
  return Object.freeze({
    mode: "foreground",
    loops: 1,
    exitCode: outcome.code,
    signal: outcome.signal,
    cleanupConfirmed: true,
  });
}

function currentCommit() {
  return String(
    executionBroker.execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      maxBuffer: 4 * 1024,
      origin: "test:clipboard-image-host-smoke",
      policy: "allow",
      scope: "repository-read",
      shell: false,
      timeout: 10_000,
    }),
  )
    .trim()
    .toLowerCase();
}

function windowsPowerShell(binding) {
  return binding?.platform === "win32"
    ? String(process.env.SystemRoot || "C:\\Windows").replace(/[\\/]+$/u, "") +
        "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
    : null;
}

async function setClipboardImage(filePath, binding) {
  if (process.platform === "win32") {
    const powershell = windowsPowerShell(binding);
    brokerSpawn(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Sta",
        "-Command",
        WINDOWS_SET_IMAGE_SCRIPT,
      ],
      {
        env: {
          ...process.env,
          CC_CLIPBOARD_IMAGE_FIXTURE: filePath,
        },
      },
    );
    return { writer: powershell };
  }
  if (process.platform === "darwin") {
    brokerSpawn("/usr/bin/osascript", [
      "-l",
      "JavaScript",
      "-e",
      MACOS_SET_IMAGE_SCRIPT,
      "--",
      filePath,
    ]);
    return { writer: "/usr/bin/osascript" };
  }
  if (process.platform === "linux") {
    return startLinuxClipboardOwner(filePath);
  }
  throw new Error(`unsupported clipboard host ${process.platform}`);
}

function setMacosTiffClipboard(filePath) {
  brokerSpawn("/usr/bin/osascript", [
    "-l",
    "JavaScript",
    "-e",
    MACOS_SET_TIFF_SCRIPT,
    "--",
    filePath,
  ]);
}

function validateClipboardImage(image, fixtureIdentity, label) {
  if (!image?.data?.length) {
    throw new Error(`${label} returned no image`);
  }
  const data = Buffer.from(image.data);
  const identity = pngPixelIdentity(data);
  const dimensions = identity.dimensions;
  if (dimensions.width !== WIDTH || dimensions.height !== HEIGHT) {
    throw new Error(`${label} dimensions do not match the fixture`);
  }
  if (identity.pixelSha256 !== fixtureIdentity.pixelSha256) {
    throw new Error(`${label} pixels do not match the fixture`);
  }
  return { data, dimensions, identity };
}

function clearClipboard(binding) {
  try {
    if (process.platform === "win32") {
      brokerSpawn(windowsPowerShell(binding), [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Sta",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()",
      ]);
    } else if (process.platform === "darwin") {
      brokerSpawn("/usr/bin/osascript", ["-e", 'set the clipboard to ""']);
    }
  } catch {
    // The evidence is already bound to an ephemeral CI host; cleanup is best effort.
  }
}

export async function runClipboardImageHostSmoke() {
  const expectedCommit = String(
    process.env.CC_CLIPBOARD_IMAGE_EXPECTED_SHA || "",
  )
    .trim()
    .toLowerCase();
  if (!FULL_SHA_PATTERN.test(expectedCommit)) {
    throw new Error("CC_CLIPBOARD_IMAGE_EXPECTED_SHA must be one full SHA");
  }
  const actualCommit = currentCommit();
  if (actualCommit !== expectedCommit) {
    throw new Error(
      "clipboard host smoke checkout does not match expected SHA",
    );
  }
  const outputPath = String(process.env.CC_CLIPBOARD_IMAGE_OUTPUT || "").trim();
  if (!outputPath) throw new Error("CC_CLIPBOARD_IMAGE_OUTPUT is required");

  const startedAt = new Date().toISOString();
  const directory = mkdtempSync(join(tmpdir(), "cc-clipboard-host-smoke-"));
  ensurePrivateDirectory(directory, {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
  const fixturePath = join(directory, "fixture.png");
  const fixture = createFixturePng();
  const fixtureIdentity = pngPixelIdentity(fixture);
  writeFileSync(fixturePath, fixture, { mode: PRIVATE_FILE_MODE });
  ensurePrivateFile(fixturePath, {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });

  let binding = null;
  let writerHandle = null;
  let primaryError = null;
  try {
    binding = createSystemClipboardImageBinding();
    if (!binding) {
      throw new Error(
        "production system clipboard image binding is unavailable",
      );
    }
    writerHandle = await setClipboardImage(fixturePath, binding);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const image = await binding.readImage();
    const {
      data,
      dimensions,
      identity: clipboardIdentity,
    } = validateClipboardImage(
      image,
      fixtureIdentity,
      "production clipboard image binding",
    );
    const writerLifecycle = await requireClipboardWriterRetired(writerHandle);
    let macosTiffFallback = null;
    if (process.platform === "darwin") {
      const tiffPath = join(directory, "fixture.tiff");
      brokerSpawn("/usr/bin/sips", [
        "-s",
        "format",
        "tiff",
        fixturePath,
        "--out",
        tiffPath,
      ]);
      ensurePrivateFile(tiffPath, {
        applyWindowsAcl: false,
        failIfUnavailable: true,
      });
      setMacosTiffClipboard(tiffPath);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const tiffImage = await binding.readImage();
      const tiffResult = validateClipboardImage(
        tiffImage,
        fixtureIdentity,
        "macOS TIFF clipboard fallback",
      );
      if (tiffImage.tool !== "osascript+jxa-tiff") {
        throw new Error("macOS TIFF clipboard fallback used the wrong reader");
      }
      macosTiffFallback = {
        status: "passed",
        mediaType: tiffImage.mediaType,
        bytes: tiffResult.data.length,
        pixelSha256: tiffResult.identity.pixelSha256,
        reader: tiffImage.tool,
      };
    }
    const evidence = {
      schemaVersion: 1,
      status: "passed",
      releaseCommit: expectedCommit,
      platform: process.platform,
      architecture: process.arch,
      mediaType: image.mediaType,
      bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      fixtureSha256: createHash("sha256").update(fixture).digest("hex"),
      pixelSha256: clipboardIdentity.pixelSha256,
      fixturePixelSha256: fixtureIdentity.pixelSha256,
      dimensions,
      macosTiffFallback,
      writer: writerHandle.writer,
      writerLifecycle,
      reader: image.tool || binding.mode,
      execution: {
        provider:
          process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
        repository: process.env.GITHUB_REPOSITORY || "local",
        runId: process.env.GITHUB_RUN_ID || "local",
        runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT || 1),
        workflowSha: process.env.GITHUB_WORKFLOW_SHA || expectedCommit,
      },
      startedAt,
      completedAt: new Date().toISOString(),
    };
    writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
      mode: PRIVATE_FILE_MODE,
    });
    console.log(
      JSON.stringify({ status: evidence.status, platform: evidence.platform }),
    );
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const writerCleanupConfirmed =
      await disposeLinuxClipboardOwner(writerHandle);
    clearClipboard(binding);
    rmSync(directory, { recursive: true, force: true });
    if (!writerCleanupConfirmed) {
      const cleanupError = new Error(
        "clipboard writer cleanup could not be confirmed",
      );
      if (primaryError) {
        throw new AggregateError(
          [primaryError, cleanupError],
          `${primaryError.message}; ${cleanupError.message}`,
        );
      }
      throw cleanupError;
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runClipboardImageHostSmoke().catch((error) => {
    console.error(`clipboard image host smoke failed: ${error.message}`);
    process.exitCode = 1;
  });
}
