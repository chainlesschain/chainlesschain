import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "vitest";

const require = createRequire(import.meta.url);
const {
  ImmutableVfsResolver,
} = require("../../src/lib/mcp-stdio-immutable-vfs-resolver.cjs");

function json(value) {
  return Buffer.from(JSON.stringify(value));
}

function fixture(overrides = []) {
  const mutableLocal = Buffer.from("module.exports = 'original'");
  const files = new Map([
    [
      "/tree/app/package.json",
      json({
        name: "fixture-app",
        type: "module",
        exports: {
          ".": { import: "./self-esm.js", require: "./self-cjs.cjs" },
          "./feature/*": "./self/*.js",
        },
        imports: {
          "#exact": "./internal.js",
          "#utils/*": { node: "./utils/*.js", default: "./fallback.js" },
          "#dependency": "plain",
          "#builtin": "node:fs",
          "#invalid-then-valid": ["../escape.js", "./internal.js"],
          "#blocked": null,
        },
      }),
    ],
    ["/tree/app/index.js", Buffer.from("export {}")],
    ["/tree/app/local.js", mutableLocal],
    ["/tree/app/absolute.json", Buffer.from('{"ok":true}')],
    ["/tree/app/internal.js", Buffer.from("export const internal = true")],
    ["/tree/app/utils/a.js", Buffer.from("export const a = true")],
    ["/tree/app/fallback.js", Buffer.from("export const fallback = true")],
    ["/tree/app/self-esm.js", Buffer.from("export default 'esm'")],
    ["/tree/app/self-cjs.cjs", Buffer.from("module.exports = 'cjs'")],
    ["/tree/app/self/a.js", Buffer.from("export const self = true")],
    ["/tree/app/by-index/index.cjs", Buffer.from("module.exports = 1")],
    [
      "/tree/app/by-main/package.json",
      json({ main: "lib/start", type: "commonjs" }),
    ],
    ["/tree/app/by-main/lib/start.js", Buffer.from("module.exports = 2")],
    ["/tree/app/native.node", Buffer.from("not really native")],
    [
      "/tree/node_modules/plain/package.json",
      json({ name: "plain", main: "lib/main" }),
    ],
    [
      "/tree/node_modules/plain/lib/main.js",
      Buffer.from("module.exports = 'plain'"),
    ],
    [
      "/tree/node_modules/no-manifest/index.js",
      Buffer.from("module.exports = 'index'"),
    ],
    [
      "/tree/node_modules/@scope/pkg/package.json",
      json({
        name: "@scope/pkg",
        type: "module",
        exports: {
          ".": {
            import: "./esm.js",
            require: "./cjs.cjs",
            default: "./fallback.js",
          },
          "./feature/exact": "./exact.js",
          "./feature/*": { node: "./src/*.js", default: "./fallback/*.js" },
          "./invalid-first": ["../invalid.js", "./exact.js"],
          "./missing-first": ["./missing.js", "./exact.js"],
          "./no-extension-fallback": "./exact",
          "./blocked": null,
        },
      }),
    ],
    [
      "/tree/node_modules/@scope/pkg/esm.js",
      Buffer.from("export default 'esm'"),
    ],
    [
      "/tree/node_modules/@scope/pkg/cjs.cjs",
      Buffer.from("module.exports = 'cjs'"),
    ],
    [
      "/tree/node_modules/@scope/pkg/fallback.js",
      Buffer.from("export default 'fallback'"),
    ],
    [
      "/tree/node_modules/@scope/pkg/exact.js",
      Buffer.from("export default 'exact'"),
    ],
    [
      "/tree/node_modules/@scope/pkg/src/a.js",
      Buffer.from("export default 'a'"),
    ],
    ...overrides,
  ]);
  return {
    files,
    mutableLocal,
    resolver: new ImmutableVfsResolver(files, { root: "/tree" }),
  };
}

function codeOf(action) {
  assert.throws(action, (error) => typeof error.code === "string");
  try {
    action();
  } catch (error) {
    return error.code;
  }
  throw new Error("expected failure");
}

test("clones caller buffers and never exposes its private buffer", () => {
  const { resolver, mutableLocal } = fixture();
  mutableLocal.fill(0x78);
  const first = resolver.load("/tree/app/local.js");
  assert.equal(first.contents.toString(), "module.exports = 'original'");
  first.contents.fill(0x79);
  assert.equal(
    resolver.load("/tree/app/local.js").contents.toString(),
    "module.exports = 'original'",
  );
});

test("resolves relative, absolute, extension, index, and package main paths", () => {
  const { resolver } = fixture();
  assert.equal(
    resolver.resolve("./local", "/tree/app/index.js").path,
    "/tree/app/local.js",
  );
  assert.equal(
    resolver.resolve("/tree/app/absolute.json", "/tree/app/index.js").path,
    "/tree/app/absolute.json",
  );
  assert.equal(
    resolver.resolve("./by-index", "/tree/app/index.js").path,
    "/tree/app/by-index/index.cjs",
  );
  assert.equal(
    resolver.resolve("./by-main", "/tree/app/index.js").path,
    "/tree/app/by-main/lib/start.js",
  );
  assert.equal(resolver.load("/tree/app/internal.js").packageType, "module");
  assert.equal(
    resolver.load("/tree/app/by-main/lib/start.js").packageType,
    "commonjs",
  );
});

test("allows only known Node builtins to remain external", () => {
  const { resolver } = fixture();
  assert.deepEqual(resolver.resolve("fs", "/tree/app/index.js"), {
    external: true,
    path: "fs",
    builtin: true,
  });
  assert.deepEqual(resolver.resolve("node:fs", "/tree/app/index.js"), {
    external: true,
    path: "node:fs",
    builtin: true,
  });
  assert.equal(
    codeOf(() => resolver.resolve("node:not-real", "/tree/app/index.js")),
    "ERR_UNKNOWN_BUILTIN_MODULE",
  );
  assert.equal(
    codeOf(() => resolver.resolve("https://host/x.js", "/tree/app/index.js")),
    "ERR_UNSUPPORTED_SCHEME",
  );
});

test("resolves bare, scoped, nested, and manifest-free node_modules packages", () => {
  const { resolver } = fixture();
  assert.equal(
    resolver.resolve("plain", "/tree/app/index.js", "require-call").path,
    "/tree/node_modules/plain/lib/main.js",
  );
  assert.equal(
    resolver.resolve("no-manifest", "/tree/app/index.js", "require-call").path,
    "/tree/node_modules/no-manifest/index.js",
  );
  assert.equal(
    resolver.resolve("@scope/pkg", "/tree/app/index.js", "import-statement")
      .path,
    "/tree/node_modules/@scope/pkg/esm.js",
  );
  assert.equal(
    resolver.resolve("@scope/pkg", "/tree/app/index.js", "require-call").path,
    "/tree/node_modules/@scope/pkg/cjs.cjs",
  );
});

test("implements exact exports, wildcard specificity, conditions, arrays, and blocks", () => {
  const { resolver } = fixture();
  assert.equal(
    resolver.resolve("@scope/pkg/feature/exact", "/tree/app/index.js").path,
    "/tree/node_modules/@scope/pkg/exact.js",
  );
  assert.equal(
    resolver.resolve("@scope/pkg/feature/a", "/tree/app/index.js").path,
    "/tree/node_modules/@scope/pkg/src/a.js",
  );
  assert.equal(
    resolver.resolve("@scope/pkg/invalid-first", "/tree/app/index.js").path,
    "/tree/node_modules/@scope/pkg/exact.js",
  );
  assert.equal(
    codeOf(() =>
      resolver.resolve("@scope/pkg/missing-first", "/tree/app/index.js"),
    ),
    "ERR_MODULE_NOT_FOUND",
  );
  assert.equal(
    codeOf(() =>
      resolver.resolve(
        "@scope/pkg/no-extension-fallback",
        "/tree/app/index.js",
      ),
    ),
    "ERR_MODULE_NOT_FOUND",
  );
  assert.equal(
    codeOf(() => resolver.resolve("@scope/pkg/blocked", "/tree/app/index.js")),
    "ERR_PACKAGE_PATH_NOT_EXPORTED",
  );
  assert.equal(
    codeOf(() => resolver.resolve("@scope/pkg/private", "/tree/app/index.js")),
    "ERR_PACKAGE_PATH_NOT_EXPORTED",
  );
});

test("implements package imports including patterns, external package targets, and builtins", () => {
  const { resolver } = fixture();
  assert.equal(
    resolver.resolve("#exact", "/tree/app/index.js").path,
    "/tree/app/internal.js",
  );
  assert.equal(
    resolver.resolve("#utils/a", "/tree/app/index.js").path,
    "/tree/app/utils/a.js",
  );
  assert.equal(
    resolver.resolve("#dependency", "/tree/app/index.js", "require-call").path,
    "/tree/node_modules/plain/lib/main.js",
  );
  assert.deepEqual(resolver.resolve("#builtin", "/tree/app/index.js"), {
    external: true,
    path: "node:fs",
    builtin: true,
  });
  assert.equal(
    resolver.resolve("#invalid-then-valid", "/tree/app/index.js").path,
    "/tree/app/internal.js",
  );
  assert.equal(
    codeOf(() => resolver.resolve("#blocked", "/tree/app/index.js")),
    "ERR_PACKAGE_IMPORT_NOT_DEFINED",
  );
  assert.equal(
    codeOf(() => resolver.resolve("#unknown", "/tree/app/index.js")),
    "ERR_PACKAGE_IMPORT_NOT_DEFINED",
  );
});

test("resolves package self references through exports", () => {
  const { resolver } = fixture();
  assert.equal(
    resolver.resolve("fixture-app", "/tree/app/index.js", "import-statement")
      .path,
    "/tree/app/self-esm.js",
  );
  assert.equal(
    resolver.resolve("fixture-app", "/tree/app/index.js", "require-call").path,
    "/tree/app/self-cjs.cjs",
  );
  assert.equal(
    resolver.resolve("fixture-app/feature/a", "/tree/app/index.js").path,
    "/tree/app/self/a.js",
  );
});

test("rejects map escapes, missing files, native addons, and unsupported loaders", () => {
  const { resolver } = fixture([["/tree/app/data.txt", Buffer.from("text")]]);
  assert.equal(
    codeOf(() => resolver.resolve("../../host.js", "/tree/app/index.js")),
    "ERR_VFS_ESCAPE",
  );
  assert.equal(
    codeOf(() => resolver.resolve("/etc/passwd", "/tree/app/index.js")),
    "ERR_VFS_ESCAPE",
  );
  assert.equal(
    codeOf(() => resolver.resolve("./missing", "/tree/app/index.js")),
    "ERR_MODULE_NOT_FOUND",
  );
  assert.equal(
    codeOf(() => resolver.resolve("./native.node", "/tree/app/index.js")),
    "ERR_NATIVE_ADDON_BLOCKED",
  );
  assert.equal(
    codeOf(() => resolver.resolve("./data.txt", "/tree/app/index.js")),
    "ERR_UNSUPPORTED_MODULE_TYPE",
  );
  assert.equal(
    codeOf(() => resolver.resolve("./local%2fescape", "/tree/app/index.js")),
    "ERR_INVALID_MODULE_SPECIFIER",
  );
  assert.equal(
    codeOf(() => resolver.resolve("./local%5cescape", "/tree/app/index.js")),
    "ERR_INVALID_MODULE_SPECIFIER",
  );
  assert.equal(
    codeOf(() =>
      resolver.resolve("file:///tree/app/local.js", "/tree/app/index.js"),
    ),
    "ERR_UNSUPPORTED_SCHEME",
  );
});

test("esbuild catch-all callbacks fail closed without falling through", async () => {
  const { resolver } = fixture();
  let onResolve;
  let onLoad;
  resolver.createEsbuildPlugin("/tree/app/index.js").setup({
    onResolve(options, callback) {
      assert.equal(options.filter.test("anything"), true);
      onResolve = callback;
    },
    onLoad(options, callback) {
      assert.equal(options.namespace, "cc-immutable-vfs");
      assert.equal(options.filter.test("anything"), true);
      onLoad = callback;
    },
  });
  const missing = await onResolve({
    kind: "import-statement",
    importer: "/tree/app/index.js",
    path: "./missing",
  });
  assert.equal(Array.isArray(missing.errors), true);
  assert.match(missing.errors[0].text, /ERR_MODULE_NOT_FOUND/);
  const scheme = await onResolve({
    kind: "import-statement",
    importer: "/tree/app/index.js",
    path: "https://host/module.js",
  });
  assert.equal(Array.isArray(scheme.errors), true);
  assert.match(scheme.errors[0].text, /ERR_UNSUPPORTED_SCHEME/);
  const missingLoad = await onLoad({ path: "/tree/app/missing.js" });
  assert.equal(Array.isArray(missingLoad.errors), true);
  assert.match(missingLoad.errors[0].text, /ERR_MODULE_NOT_FOUND/);
});

test("rejects noncanonical map keys and invalid package map shapes", () => {
  assert.equal(
    codeOf(
      () =>
        new ImmutableVfsResolver(
          new Map([["/tree/a/../b.js", Buffer.from("")]]),
          { root: "/tree" },
        ),
    ),
    "ERR_INVALID_VFS_PATH",
  );
  const { resolver } = fixture([
    [
      "/tree/node_modules/bad/package.json",
      json({
        name: "bad",
        exports: { ".": "./ok.js", node: "./other.js" },
      }),
    ],
    ["/tree/node_modules/bad/ok.js", Buffer.from("")],
  ]);
  assert.equal(
    codeOf(() => resolver.resolve("bad", "/tree/app/index.js")),
    "ERR_INVALID_PACKAGE_CONFIG",
  );
});

test("audit is a detached immutable summary", () => {
  const { resolver } = fixture();
  resolver.resolve("./local", "/tree/app/index.js");
  resolver.load("/tree/app/local.js");
  const audit = resolver.audit();
  assert.equal(audit.fileCount > 10, true);
  assert.deepEqual(audit.loaded, ["/tree/app/local.js"]);
  assert.equal(Object.isFrozen(audit.resolutions), true);
});
