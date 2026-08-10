"use strict";

const { webcrypto } = require("node:crypto");
const path = require("node:path");
const vm = require("node:vm");
const { parentPort, workerData } = require("node:worker_threads");

const WORKER_SCHEMA = "chainlesschain.mcp-stdio-capsule-builder-worker/v1";
const NONCE = /^[a-f0-9]{64}$/;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_METAFILE_BYTES = 16 * 1024 * 1024;
const MAX_AUDIT_BYTES = 16 * 1024 * 1024;
const activeTimers = new Map();
let nextTimerId = 1;
let terminalSent = false;

function setTimerBridge(callback, delay, args) {
  const id = nextTimerId++;
  const timer = setTimeout(
    () => {
      activeTimers.delete(id);
      callback(...args);
    },
    Math.max(0, Number(delay) || 0),
  );
  activeTimers.set(id, timer);
  return id;
}

function clearTimerBridge(id) {
  const timer = activeTimers.get(id);
  if (timer) clearTimeout(timer);
  activeTimers.delete(id);
}

function encodeBridge(value) {
  return Array.from(new TextEncoder().encode(String(value)));
}

function decodeBridge(bytes) {
  return new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
}

function randomFillBridge(view) {
  webcrypto.getRandomValues(view);
}

function sendTerminal(message, transferList = []) {
  if (terminalSent) {
    throw new Error("MCP capsule builder Worker emitted two terminal messages");
  }
  terminalSent = true;
  parentPort.postMessage(message, transferList);
}

function loadPinnedCommonJs(source, filename) {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError(`Pinned CommonJS source is empty: ${filename}`);
  }
  const loaded = { exports: {} };
  const factory = vm.runInThisContext(
    `(function(exports,require,module,__filename,__dirname){${source}\n})`,
    { filename },
  );
  factory(loaded.exports, require, loaded, filename, path.dirname(filename));
  return loaded.exports;
}

function assertHardenedBrowserContext(context) {
  const probe = new vm.Script(
    `(() => {
      const hidden = [
        "process", "require", "Buffer", "fetch", "Worker", "Blob", "URL", "location"
      ];
      const visibility = Object.fromEntries(
        hidden.map((name) => [name, typeof globalThis[name]])
      );
      const probes = {
        TextEncoder: () => TextEncoder.constructor("return typeof process")(),
        TextDecoder: () => TextDecoder.constructor("return typeof process")(),
        setTimeout: () => setTimeout.constructor("return typeof process")(),
        clearTimeout: () => clearTimeout.constructor("return typeof process")(),
        WebAssembly: () => WebAssembly.instantiate.constructor("return typeof process")(),
        wasmModule: () => __chainlessWasmModule.constructor.constructor("return typeof process")(),
        crypto: () => crypto.getRandomValues.constructor("return typeof process")(),
        performance: () => performance.now.constructor("return typeof process")(),
        console: () => console.log.constructor("return typeof process")(),
        contextFunction: () => Function("return typeof process")(),
      };
      const escapes = {};
      for (const [name, attempt] of Object.entries(probes)) {
        try {
          escapes[name] = { blocked: false, result: attempt() };
        } catch (error) {
          escapes[name] = { blocked: true, result: error && error.name };
        }
      }
      return { visibility, escapes };
    })()`,
    { filename: "/chainlesschain/browser-context-security-probe.js" },
  ).runInContext(context, { timeout: 1_000 });
  if (
    Object.values(probe.visibility).some((value) => value !== "undefined") ||
    Object.values(probe.escapes).some(
      (result) => result.blocked !== true || result.result !== "EvalError",
    )
  ) {
    throw new Error("Pinned esbuild-wasm browser context is not isolated");
  }
}

async function loadPinnedBrowserApi(source, filename, wasmBytes) {
  // esbuild-wasm's browser host intentionally installs its own process/fs/path
  // shims. Node 22 exposes some of those names as globals, so forwarding the
  // Worker global would silently select the host filesystem instead of the
  // in-memory service transport. Host bridge functions only enter lexical
  // closures created in this realm. They are never properties of globalThis.
  if (!(wasmBytes instanceof Uint8Array) || wasmBytes.byteLength === 0) {
    throw new TypeError("Pinned esbuild-wasm bytes are invalid");
  }
  const sandbox = Object.create(null);
  sandbox.__chainlessWasmBytesHost = wasmBytes;
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: true },
    name: "chainlesschain-esbuild-wasm",
  });
  new vm.Script(
    `"use strict";
      Object.defineProperties(globalThis, {
        self: { value: globalThis },
        module: { value: { exports: {} } },
      });
      Object.defineProperty(globalThis, "exports", {
        value: globalThis.module.exports,
      });`,
    { filename: "/chainlesschain/browser-context-bootstrap.js" },
  ).runInContext(context, { timeout: 1_000 });
  const installGlobals = vm.compileFunction(
    `class ChainlessTextEncoder {
       encode(value = "") {
         return Uint8Array.from(encodeBridge(String(value)));
       }
     }
     class ChainlessTextDecoder {
       decode(input = new Uint8Array()) {
         let view;
         if (ArrayBuffer.isView(input)) {
           view = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
         } else if (input instanceof ArrayBuffer) {
           view = new Uint8Array(input);
         } else {
           throw new TypeError("Expected an ArrayBuffer view");
         }
         return decodeBridge(Array.from(view));
       }
     }
     function safeSetTimeout(callback, delay, ...args) {
       if (typeof callback !== "function") {
         throw new TypeError("callback must be a function");
       }
       return setTimerBridge(callback, delay, args);
     }
     function safeClearTimeout(id) {
       clearTimerBridge(id);
     }
     const safeCrypto = Object.freeze({
       getRandomValues(view) {
         if (!ArrayBuffer.isView(view)) {
           throw new TypeError("Expected an integer typed array");
         }
         randomFillBridge(view);
         return view;
       },
     });
     const safePerformance = Object.freeze({ now() { return Date.now(); } });
     Object.defineProperties(globalThis, {
       TextEncoder: { value: ChainlessTextEncoder },
       TextDecoder: { value: ChainlessTextDecoder },
       setTimeout: { value: safeSetTimeout },
       clearTimeout: { value: safeClearTimeout },
       crypto: { value: safeCrypto },
       performance: { value: safePerformance },
     });`,
    [
      "encodeBridge",
      "decodeBridge",
      "setTimerBridge",
      "clearTimerBridge",
      "randomFillBridge",
    ],
    {
      filename: "/chainlesschain/browser-context-primitives.js",
      parsingContext: context,
    },
  );
  installGlobals(
    encodeBridge,
    decodeBridge,
    setTimerBridge,
    clearTimerBridge,
    randomFillBridge,
  );
  await new vm.Script(
    `(async () => {
       const localBytes = Uint8Array.from(__chainlessWasmBytesHost);
       delete globalThis.__chainlessWasmBytesHost;
       globalThis.__chainlessWasmModule = await WebAssembly.compile(localBytes);
     })()`,
    { filename: "/chainlesschain/compile-pinned-wasm.js" },
  ).runInContext(context, { timeout: 1_000 });
  assertHardenedBrowserContext(context);
  const script = new vm.Script(
    `(function(exports,module){${source}\n})(exports,module);`,
    { filename },
  );
  script.runInContext(context, { timeout: 5_000 });
  assertHardenedBrowserContext(context);
  return Object.freeze({
    api: context.module.exports,
    RegExp: vm.runInContext("RegExp", context),
    Uint8Array: vm.runInContext("Uint8Array", context),
    wasmModule: vm.runInContext("__chainlessWasmModule", context),
  });
}

function adaptPluginToBrowserRealm(plugin, browserRealm) {
  if (
    !plugin ||
    typeof plugin.name !== "string" ||
    typeof plugin.setup !== "function" ||
    typeof browserRealm?.RegExp !== "function" ||
    typeof browserRealm?.Uint8Array !== "function"
  ) {
    throw new TypeError("MCP capsule immutable VFS plugin is invalid");
  }
  const cloneFilter = (options) => {
    if (
      !options ||
      typeof options !== "object" ||
      !(options.filter instanceof RegExp)
    ) {
      throw new TypeError("MCP capsule immutable VFS filter is invalid");
    }
    return {
      ...options,
      filter: new browserRealm.RegExp(
        options.filter.source,
        options.filter.flags,
      ),
    };
  };
  const cloneContents = (result) => {
    if (
      !result ||
      typeof result !== "object" ||
      result.contents === undefined
    ) {
      return result;
    }
    if (!(result.contents instanceof Uint8Array)) {
      throw new TypeError("MCP capsule immutable VFS contents are invalid");
    }
    const contents = new browserRealm.Uint8Array(result.contents.byteLength);
    contents.set(result.contents);
    return { ...result, contents };
  };
  return Object.freeze({
    name: plugin.name,
    setup(build) {
      const bridge = Object.create(null);
      bridge.onResolve = (options, callback) =>
        build.onResolve(cloneFilter(options), callback);
      bridge.onLoad = (options, callback) =>
        build.onLoad(cloneFilter(options), async (args) =>
          cloneContents(await callback(args)),
        );
      return plugin.setup(Object.freeze(bridge));
    },
  });
}

function assertWorkerInput(input) {
  if (
    !input ||
    input.schema !== WORKER_SCHEMA ||
    !NONCE.test(input.nonce) ||
    typeof input.browserApiSource !== "string" ||
    typeof input.resolverSource !== "string" ||
    !(input.wasmBytes instanceof Uint8Array) ||
    !Array.isArray(input.files) ||
    typeof input.entryPath !== "string" ||
    typeof input.banner !== "string" ||
    !Number.isSafeInteger(input.fileCount) ||
    input.fileCount < 1 ||
    !Number.isSafeInteger(input.totalBytes) ||
    input.totalBytes < 1 ||
    !Number.isSafeInteger(input.maxOutputBytes) ||
    input.maxOutputBytes < 1 ||
    input.maxOutputBytes > MAX_OUTPUT_BYTES ||
    !Number.isSafeInteger(input.maxMetafileBytes) ||
    input.maxMetafileBytes < 1 ||
    input.maxMetafileBytes > MAX_METAFILE_BYTES
  ) {
    throw new TypeError("MCP capsule builder Worker input is invalid");
  }
}

function serializeError(error) {
  return {
    name: typeof error?.name === "string" ? error.name : "Error",
    code: typeof error?.code === "string" ? error.code : null,
    message: String(error?.message || error || "Unknown builder failure").slice(
      0,
      8_000,
    ),
    stack:
      typeof error?.stack === "string" ? error.stack.slice(0, 32_000) : null,
  };
}

async function main() {
  assertWorkerInput(workerData);
  const { ImmutableVfsResolver } = loadPinnedCommonJs(
    workerData.resolverSource,
    "/chainlesschain/immutable-vfs-resolver.cjs",
  );
  if (typeof ImmutableVfsResolver !== "function") {
    throw new TypeError("Pinned immutable VFS resolver export is invalid");
  }
  const browserRealm = await loadPinnedBrowserApi(
    workerData.browserApiSource,
    "/chainlesschain/esbuild-wasm-browser.js",
    workerData.wasmBytes,
  );
  workerData.wasmBytes = null;
  const esbuild = browserRealm.api;
  if (
    esbuild?.version !== workerData.builderVersion ||
    typeof esbuild.initialize !== "function" ||
    typeof esbuild.build !== "function" ||
    typeof esbuild.stop !== "function"
  ) {
    throw new TypeError("Pinned esbuild-wasm browser API is invalid");
  }

  const files = new Map();
  let totalBytes = 0;
  for (const record of workerData.files) {
    if (
      !Array.isArray(record) ||
      record.length !== 2 ||
      typeof record[0] !== "string" ||
      !(record[1] instanceof Uint8Array) ||
      files.has(record[0])
    ) {
      throw new TypeError("MCP capsule immutable VFS record is invalid");
    }
    files.set(record[0], record[1]);
    totalBytes += record[1].byteLength;
  }
  if (
    files.size !== workerData.fileCount ||
    totalBytes !== workerData.totalBytes
  ) {
    throw new TypeError("MCP capsule immutable VFS budget changed in transit");
  }
  const resolver = new ImmutableVfsResolver(files, {
    root: workerData.vfsRoot,
  });
  // Drop the structured-clone container before the WASM build. The resolver
  // owns private copies and no callback outside this Worker can mutate them.
  workerData.files.length = 0;

  await esbuild.initialize({
    wasmModule: browserRealm.wasmModule,
    worker: false,
  });
  let terminal;
  try {
    const result = await esbuild.build({
      absWorkingDir: "/",
      banner: { js: workerData.banner },
      bundle: true,
      charset: "utf8",
      entryPoints: [workerData.entryPath],
      format: "cjs",
      legalComments: "none",
      logLevel: "silent",
      metafile: true,
      outfile: "/chainlesschain-output/server.cjs",
      packages: "bundle",
      platform: "node",
      plugins: [
        adaptPluginToBrowserRealm(
          resolver.createEsbuildPlugin(workerData.entryPath),
          browserRealm,
        ),
      ],
      supported: { "dynamic-import": false },
      target: "node22",
      treeShaking: false,
      write: false,
    });
    if (
      !result ||
      !Array.isArray(result.outputFiles) ||
      result.outputFiles.length !== 1 ||
      !(result.outputFiles[0]?.contents instanceof browserRealm.Uint8Array) ||
      result.outputFiles[0].contents.byteLength > workerData.maxOutputBytes ||
      !result.metafile ||
      typeof result.metafile !== "object" ||
      !Array.isArray(result.warnings)
    ) {
      throw new Error("MCP capsule esbuild-wasm output is invalid");
    }
    const metafileBytes = Buffer.byteLength(JSON.stringify(result.metafile));
    if (metafileBytes > workerData.maxMetafileBytes) {
      throw new Error("MCP capsule esbuild-wasm metafile exceeds its limit");
    }
    const browserOutput = result.outputFiles[0].contents;
    const output = new Uint8Array(browserOutput.byteLength);
    output.set(browserOutput);
    const audit = resolver.audit();
    if (Buffer.byteLength(JSON.stringify(audit)) > MAX_AUDIT_BYTES) {
      throw new Error("MCP capsule immutable VFS audit exceeds its limit");
    }
    terminal = {
      ok: true,
      nonce: workerData.nonce,
      output,
      metafile: result.metafile,
      warnings: result.warnings,
      audit,
    };
  } finally {
    await esbuild.stop();
  }
  sendTerminal(terminal, [terminal.output.buffer]);
}

main()
  .catch((error) => {
    sendTerminal({
      ok: false,
      nonce: workerData?.nonce,
      error: serializeError(error),
    });
  })
  .finally(() => {
    for (const timer of activeTimers.values()) clearTimeout(timer);
    activeTimers.clear();
  });
