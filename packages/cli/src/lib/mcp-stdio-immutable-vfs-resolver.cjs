"use strict";

const path = require("node:path");
const { isBuiltin } = require("node:module");

const posix = path.posix;
const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const NO_MATCH = Symbol("no-match");
const BLOCKED = Symbol("blocked");
const DEFAULT_EXTENSIONS = Object.freeze([".js", ".json", ".mjs", ".cjs"]);
const SAFE_LOADERS = Object.freeze(
  new Map([
    ["", "js"],
    [".js", "js"],
    [".cjs", "js"],
    [".mjs", "js"],
    [".json", "json"],
  ]),
);

class VfsResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VfsResolutionError";
    this.code = code;
  }
}

class InvalidPackageTargetError extends VfsResolutionError {
  constructor(message) {
    super("ERR_INVALID_PACKAGE_TARGET", message);
  }
}

function fail(code, message) {
  throw new VfsResolutionError(code, message);
}

function assertPortableAbsolute(value, label) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.includes("?") ||
    value.includes("#") ||
    (value !== "/" && value.endsWith("/")) ||
    posix.normalize(value) !== value
  ) {
    fail(
      "ERR_INVALID_VFS_PATH",
      `${label} is not a canonical POSIX absolute path: ${String(value)}`,
    );
  }
  return value;
}

function isWithin(root, candidate) {
  return (
    candidate === root ||
    (root === "/"
      ? candidate.startsWith("/")
      : candidate.startsWith(`${root}/`))
  );
}

function assertWithin(root, candidate, label) {
  if (!isWithin(root, candidate)) {
    fail(
      "ERR_VFS_ESCAPE",
      `${label} escapes immutable VFS root ${root}: ${candidate}`,
    );
  }
  return candidate;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validatePackageJson(json, packageJsonPath) {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    fail(
      "ERR_INVALID_PACKAGE_CONFIG",
      `${packageJsonPath} must contain a JSON object`,
    );
  }
  if (OWN(json, "name") && typeof json.name !== "string") {
    fail(
      "ERR_INVALID_PACKAGE_CONFIG",
      `${packageJsonPath} has a non-string name`,
    );
  }
  if (OWN(json, "main") && typeof json.main !== "string") {
    fail(
      "ERR_INVALID_PACKAGE_CONFIG",
      `${packageJsonPath} has a non-string main`,
    );
  }
  if (OWN(json, "type") && json.type !== "module" && json.type !== "commonjs") {
    fail(
      "ERR_INVALID_PACKAGE_CONFIG",
      `${packageJsonPath} has an unsupported type`,
    );
  }
  return deepFreeze(json);
}

function validateSpecifier(specifier) {
  if (
    typeof specifier !== "string" ||
    specifier.length === 0 ||
    specifier.includes("\0") ||
    specifier.includes("\\") ||
    specifier.includes("?") ||
    specifier.indexOf("#", 1) !== -1 ||
    /%2f|%5c/i.test(specifier)
  ) {
    fail(
      "ERR_INVALID_MODULE_SPECIFIER",
      `invalid module specifier: ${String(specifier)}`,
    );
  }
  if (
    /^[A-Za-z][A-Za-z+.-]*:/.test(specifier) &&
    !specifier.startsWith("node:")
  ) {
    fail("ERR_UNSUPPORTED_SCHEME", `unsupported module scheme: ${specifier}`);
  }
}

function parsePackageSpecifier(specifier) {
  const parts = specifier.split("/");
  let packageName;
  let remainder;
  if (specifier.startsWith("@")) {
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      fail(
        "ERR_INVALID_MODULE_SPECIFIER",
        `invalid scoped package specifier: ${specifier}`,
      );
    }
    packageName = `${parts[0]}/${parts[1]}`;
    remainder = parts.slice(2);
  } else {
    packageName = parts[0];
    remainder = parts.slice(1);
  }
  if (
    !packageName ||
    packageName === "." ||
    packageName === ".." ||
    packageName.includes("%") ||
    remainder.some((part) => !part || part === "." || part === "..")
  ) {
    fail(
      "ERR_INVALID_MODULE_SPECIFIER",
      `invalid package specifier: ${specifier}`,
    );
  }
  return Object.freeze({
    packageName,
    subpath: remainder.length ? `./${remainder.join("/")}` : ".",
  });
}

function conditionForKind(kind) {
  if (kind === "require-call" || kind === "require-resolve") return "require";
  return "import";
}

function patternCompare(left, right) {
  const leftBase = left.indexOf("*");
  const rightBase = right.indexOf("*");
  if (leftBase !== rightBase) return rightBase - leftBase;
  return right.length - left.length;
}

class ImmutableVfsResolver {
  #root;
  #files;
  #directories;
  #packageCache = new Map();
  #extensions;
  #customConditions;
  #loaded = new Set();
  #resolved = [];

  constructor(input, options = {}) {
    this.#root = assertPortableAbsolute(options.root || "/tree", "VFS root");
    this.#extensions = Object.freeze([
      ...(options.extensions || DEFAULT_EXTENSIONS),
    ]);
    if (
      this.#extensions.some(
        (extension) =>
          typeof extension !== "string" ||
          !extension.startsWith(".") ||
          extension === ".node" ||
          !SAFE_LOADERS.has(extension),
      )
    ) {
      fail(
        "ERR_INVALID_VFS_OPTIONS",
        "extensions must contain only safe JavaScript/JSON extensions",
      );
    }
    this.#customConditions = Object.freeze([...(options.conditions || [])]);
    if (
      this.#customConditions.some(
        (condition) =>
          typeof condition !== "string" ||
          !condition ||
          condition === "import" ||
          condition === "require" ||
          condition === "default",
      )
    ) {
      fail(
        "ERR_INVALID_VFS_OPTIONS",
        "custom conditions contain a reserved or invalid condition",
      );
    }

    const entries =
      input instanceof Map ? input.entries() : Object.entries(input || {});
    const files = new Map();
    for (const [rawPath, rawContents] of entries) {
      const filePath = assertPortableAbsolute(rawPath, "VFS file");
      assertWithin(this.#root, filePath, "VFS file");
      if (filePath === this.#root || files.has(filePath)) {
        fail("ERR_INVALID_VFS_PATH", `duplicate or root VFS file: ${filePath}`);
      }
      if (
        typeof rawContents !== "string" &&
        !Buffer.isBuffer(rawContents) &&
        !(rawContents instanceof Uint8Array)
      ) {
        fail(
          "ERR_INVALID_VFS_CONTENT",
          `VFS contents must be bytes or string: ${filePath}`,
        );
      }
      files.set(filePath, Buffer.from(rawContents));
    }
    if (files.size === 0)
      fail("ERR_EMPTY_VFS", "immutable VFS cannot be empty");
    this.#files = files;
    this.#directories = new Set([this.#root]);
    for (const filePath of files.keys()) {
      let directory = posix.dirname(filePath);
      while (isWithin(this.#root, directory)) {
        this.#directories.add(directory);
        if (directory === this.#root) break;
        directory = posix.dirname(directory);
      }
    }
  }

  resolveEntry(entryPoint) {
    const candidate = assertPortableAbsolute(entryPoint, "entry point");
    assertWithin(this.#root, candidate, "entry point");
    const result = this.#resolveFileOrDirectory(candidate, new Set());
    if (!result)
      fail(
        "ERR_MODULE_NOT_FOUND",
        `entry point is absent from immutable VFS: ${candidate}`,
      );
    this.#record("entry-point", "", entryPoint, result);
    return result;
  }

  resolve(specifier, importer, kind = "import-statement") {
    validateSpecifier(specifier);
    const importerPath = assertPortableAbsolute(importer, "importer");
    assertWithin(this.#root, importerPath, "importer");
    if (!this.#files.has(importerPath)) {
      fail(
        "ERR_UNKNOWN_IMPORTER",
        `importer is absent from immutable VFS: ${importerPath}`,
      );
    }

    let result;
    if (isBuiltin(specifier)) {
      result = Object.freeze({
        external: true,
        path: specifier,
        builtin: true,
      });
    } else if (specifier.startsWith("node:")) {
      fail("ERR_UNKNOWN_BUILTIN_MODULE", `unknown Node builtin: ${specifier}`);
    } else if (specifier.startsWith("#")) {
      result = this.#resolveImports(specifier, importerPath, kind, new Set());
    } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const candidate = assertWithin(
        this.#root,
        posix.resolve(posix.dirname(importerPath), specifier),
        `relative import ${specifier}`,
      );
      result = this.#resolveFileOrDirectory(candidate, new Set());
    } else if (specifier.startsWith("/")) {
      const candidate = assertPortableAbsolute(
        posix.normalize(specifier),
        "absolute import",
      );
      assertWithin(this.#root, candidate, `absolute import ${specifier}`);
      result = this.#resolveFileOrDirectory(candidate, new Set());
    } else {
      result = this.#resolveBare(specifier, importerPath, kind, new Set());
    }
    if (!result) {
      fail(
        "ERR_MODULE_NOT_FOUND",
        `cannot resolve ${specifier} from immutable VFS importer ${importerPath}`,
      );
    }
    this.#record(kind, importerPath, specifier, result);
    return result;
  }

  load(resolvedPath) {
    const candidate = assertPortableAbsolute(resolvedPath, "load path");
    assertWithin(this.#root, candidate, "load path");
    const contents = this.#files.get(candidate);
    if (!contents)
      fail(
        "ERR_MODULE_NOT_FOUND",
        `load path is absent from immutable VFS: ${candidate}`,
      );
    const loader = this.#loaderFor(candidate);
    this.#loaded.add(candidate);
    return Object.freeze({
      contents: Buffer.from(contents),
      loader,
      resolveDir: posix.dirname(candidate),
      packageType: this.#packageType(candidate),
    });
  }

  audit() {
    return Object.freeze({
      root: this.#root,
      fileCount: this.#files.size,
      loaded: Object.freeze([...this.#loaded].sort()),
      resolutions: Object.freeze(
        this.#resolved.map((item) => Object.freeze({ ...item })),
      ),
    });
  }

  createEsbuildPlugin(entryPoint) {
    const resolver = this;
    return Object.freeze({
      name: "chainlesschain-immutable-vfs",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          try {
            const result =
              args.kind === "entry-point"
                ? resolver.resolveEntry(entryPoint || args.path)
                : resolver.resolve(args.path, args.importer, args.kind);
            if (result.external) return { path: result.path, external: true };
            return { path: result.path, namespace: "cc-immutable-vfs" };
          } catch (error) {
            return {
              errors: [
                {
                  text: `${error.code || "ERR_VFS_RESOLUTION"}: ${error.message}`,
                },
              ],
            };
          }
        });
        build.onLoad(
          { filter: /.*/, namespace: "cc-immutable-vfs" },
          (args) => {
            try {
              const loaded = resolver.load(args.path);
              return {
                contents: loaded.contents,
                loader: loaded.loader,
                resolveDir: loaded.resolveDir,
                pluginData: { packageType: loaded.packageType },
              };
            } catch (error) {
              return {
                errors: [
                  { text: `${error.code || "ERR_VFS_LOAD"}: ${error.message}` },
                ],
              };
            }
          },
        );
      },
    });
  }

  #record(kind, importer, specifier, result) {
    this.#resolved.push({
      kind,
      importer,
      specifier,
      path: result.path,
      external: result.external === true,
    });
  }

  #loaderFor(filePath) {
    const extension = posix.extname(filePath).toLowerCase();
    if (extension === ".node") {
      fail(
        "ERR_NATIVE_ADDON_BLOCKED",
        `native addon is forbidden in a capsule: ${filePath}`,
      );
    }
    const loader = SAFE_LOADERS.get(extension);
    if (!loader)
      fail(
        "ERR_UNSUPPORTED_MODULE_TYPE",
        `unsupported module type in immutable VFS: ${filePath}`,
      );
    return loader;
  }

  #file(filePath) {
    if (!this.#files.has(filePath)) return undefined;
    this.#loaderFor(filePath);
    return Object.freeze({ path: filePath, external: false });
  }

  #resolveFile(base) {
    let result = this.#file(base);
    if (result) return result;
    for (const extension of this.#extensions) {
      result = this.#file(`${base}${extension}`);
      if (result) return result;
    }
    if (this.#files.has(`${base}.node`)) {
      fail(
        "ERR_NATIVE_ADDON_BLOCKED",
        `native addon is forbidden in a capsule: ${base}.node`,
      );
    }
    return undefined;
  }

  #resolveFileOrDirectory(candidate, seen) {
    assertWithin(this.#root, candidate, "module path");
    const file = this.#resolveFile(candidate);
    if (file) return file;
    if (!this.#directories.has(candidate) || seen.has(candidate))
      return undefined;
    seen.add(candidate);
    const packageRecord = this.#readPackage(candidate);
    if (packageRecord && packageRecord.json.main) {
      const mainTarget = this.#packageRelative(
        candidate,
        packageRecord.json.main,
        "package main",
      );
      const mainResult =
        this.#resolveFile(mainTarget) ||
        this.#resolveFileOrDirectory(mainTarget, seen);
      if (mainResult) return mainResult;
    }
    return this.#resolveFile(posix.join(candidate, "index"));
  }

  #readPackage(packageRoot) {
    if (this.#packageCache.has(packageRoot))
      return this.#packageCache.get(packageRoot);
    const packageJsonPath = posix.join(packageRoot, "package.json");
    const bytes = this.#files.get(packageJsonPath);
    if (!bytes) {
      this.#packageCache.set(packageRoot, undefined);
      return undefined;
    }
    let json;
    try {
      json = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      fail(
        "ERR_INVALID_PACKAGE_CONFIG",
        `cannot parse ${packageJsonPath}: ${error.message}`,
      );
    }
    const record = Object.freeze({
      root: packageRoot,
      path: packageJsonPath,
      json: validatePackageJson(json, packageJsonPath),
    });
    this.#packageCache.set(packageRoot, record);
    return record;
  }

  #findPackageScope(startDirectory) {
    let directory = startDirectory;
    while (isWithin(this.#root, directory)) {
      const record = this.#readPackage(directory);
      if (record) return record;
      if (directory === this.#root) break;
      directory = posix.dirname(directory);
    }
    return undefined;
  }

  #packageType(filePath) {
    if (posix.extname(filePath).toLowerCase() !== ".js") return undefined;
    return (
      this.#findPackageScope(posix.dirname(filePath))?.json.type || "commonjs"
    );
  }

  #packageRelative(packageRoot, target, label) {
    if (
      typeof target !== "string" ||
      !target ||
      target.includes("\\") ||
      target.includes("\0") ||
      target.includes("?") ||
      target.includes("#") ||
      target.includes("%") ||
      posix.isAbsolute(target)
    ) {
      fail(
        "ERR_INVALID_PACKAGE_CONFIG",
        `${label} is not a safe relative path: ${String(target)}`,
      );
    }
    const resolved = posix.resolve(packageRoot, target);
    if (resolved !== packageRoot && !isWithin(packageRoot, resolved)) {
      fail(
        "ERR_INVALID_PACKAGE_CONFIG",
        `${label} escapes package root: ${target}`,
      );
    }
    return resolved;
  }

  #resolveBare(specifier, importerPath, kind, seen) {
    const cycleKey = `${kind}:${posix.dirname(importerPath)}:${specifier}`;
    if (seen.has(cycleKey))
      fail("ERR_PACKAGE_IMPORT_CYCLE", `package map cycle: ${specifier}`);
    seen.add(cycleKey);
    const parsed = parsePackageSpecifier(specifier);
    const scope = this.#findPackageScope(posix.dirname(importerPath));
    if (scope?.json.name === parsed.packageName && OWN(scope.json, "exports")) {
      return this.#resolvePackageAt(scope.root, parsed, kind, seen);
    }

    let directory = posix.dirname(importerPath);
    while (isWithin(this.#root, directory)) {
      if (posix.basename(directory) !== "node_modules") {
        const packageRoot = posix.join(
          directory,
          "node_modules",
          ...parsed.packageName.split("/"),
        );
        if (this.#directories.has(packageRoot)) {
          return this.#resolvePackageAt(packageRoot, parsed, kind, seen);
        }
      }
      if (directory === this.#root) break;
      directory = posix.dirname(directory);
    }
    return undefined;
  }

  #resolvePackageAt(packageRoot, parsed, kind, seen) {
    const record = this.#readPackage(packageRoot);
    if (record && OWN(record.json, "exports")) {
      const mapped = this.#resolvePackageMap({
        field: record.json.exports,
        request: parsed.subpath,
        packageRecord: record,
        kind,
        imports: false,
      });
      if (mapped === BLOCKED || mapped === NO_MATCH) {
        fail(
          "ERR_PACKAGE_PATH_NOT_EXPORTED",
          `${parsed.subpath} is not exported by ${parsed.packageName}`,
        );
      }
      const exact = this.#file(mapped);
      if (!exact)
        fail(
          "ERR_MODULE_NOT_FOUND",
          `export target is absent from immutable VFS: ${mapped}`,
        );
      return exact;
    }
    if (parsed.subpath === ".")
      return this.#resolveFileOrDirectory(packageRoot, new Set());
    const target = this.#packageRelative(
      packageRoot,
      parsed.subpath.slice(2),
      "legacy package subpath",
    );
    return this.#resolveFileOrDirectory(target, new Set());
  }

  #resolveImports(specifier, importerPath, kind, seen) {
    if (specifier === "#" || specifier.startsWith("#/")) {
      fail(
        "ERR_INVALID_MODULE_SPECIFIER",
        `invalid package import specifier: ${specifier}`,
      );
    }
    const scope = this.#findPackageScope(posix.dirname(importerPath));
    if (!scope || !OWN(scope.json, "imports")) {
      fail(
        "ERR_PACKAGE_IMPORT_NOT_DEFINED",
        `package import is not defined: ${specifier}`,
      );
    }
    const mapped = this.#resolvePackageMap({
      field: scope.json.imports,
      request: specifier,
      packageRecord: scope,
      kind,
      imports: true,
    });
    if (mapped === BLOCKED || mapped === NO_MATCH) {
      fail(
        "ERR_PACKAGE_IMPORT_NOT_DEFINED",
        `package import is not defined: ${specifier}`,
      );
    }
    if (typeof mapped === "object" && mapped.externalSpecifier) {
      if (isBuiltin(mapped.externalSpecifier)) {
        return Object.freeze({
          external: true,
          path: mapped.externalSpecifier,
          builtin: true,
        });
      }
      return this.#resolveBare(
        mapped.externalSpecifier,
        scope.path,
        kind,
        seen,
      );
    }
    const exact = this.#file(mapped);
    if (!exact)
      fail(
        "ERR_MODULE_NOT_FOUND",
        `imports target is absent from immutable VFS: ${mapped}`,
      );
    return exact;
  }

  #resolvePackageMap({ field, request, packageRecord, kind, imports }) {
    let map = field;
    if (
      !imports &&
      (typeof map === "string" || map === null || Array.isArray(map))
    ) {
      map = { ".": map };
    } else if (
      !imports &&
      map &&
      typeof map === "object" &&
      !Array.isArray(map)
    ) {
      const keys = Object.keys(map);
      const subpathKeys = keys.filter((key) => key.startsWith("."));
      if (subpathKeys.length && subpathKeys.length !== keys.length) {
        fail(
          "ERR_INVALID_PACKAGE_CONFIG",
          `${packageRecord.path} mixes exports conditions and subpaths`,
        );
      }
      if (!subpathKeys.length) {
        if (request !== ".") return NO_MATCH;
        return this.#resolveTarget(
          map,
          undefined,
          packageRecord,
          kind,
          imports,
        );
      }
    }
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      fail(
        "ERR_INVALID_PACKAGE_CONFIG",
        `${packageRecord.path} has an invalid ${imports ? "imports" : "exports"} map`,
      );
    }
    const keys = Object.keys(map);
    for (const key of keys) {
      if (imports ? !key.startsWith("#") : !key.startsWith(".")) {
        fail(
          "ERR_INVALID_PACKAGE_CONFIG",
          `${packageRecord.path} has an invalid package map key: ${key}`,
        );
      }
      if ((key.match(/\*/g) || []).length > 1 || key.endsWith("/")) {
        fail(
          "ERR_INVALID_PACKAGE_CONFIG",
          `${packageRecord.path} has an unsupported package map pattern: ${key}`,
        );
      }
    }
    let key = OWN(map, request) ? request : undefined;
    let match;
    if (!key) {
      for (const candidate of keys
        .filter((item) => item.includes("*"))
        .sort(patternCompare)) {
        const star = candidate.indexOf("*");
        const prefix = candidate.slice(0, star);
        const suffix = candidate.slice(star + 1);
        if (
          request.startsWith(prefix) &&
          request.endsWith(suffix) &&
          request.length >= prefix.length + suffix.length
        ) {
          key = candidate;
          match = request.slice(prefix.length, request.length - suffix.length);
          break;
        }
      }
    }
    if (!key) return NO_MATCH;
    return this.#resolveTarget(map[key], match, packageRecord, kind, imports);
  }

  #resolveTarget(target, match, packageRecord, kind, imports) {
    if (target === null) return BLOCKED;
    if (typeof target === "string") {
      const substituted =
        match === undefined ? target : target.replaceAll("*", match);
      if (substituted.startsWith("./")) {
        const tail = substituted.slice(2);
        if (
          !tail ||
          tail.includes("\\") ||
          tail.includes("%") ||
          tail
            .split("/")
            .some(
              (part) =>
                !part ||
                part === "." ||
                part === ".." ||
                part === "node_modules",
            )
        ) {
          throw new InvalidPackageTargetError(
            `invalid local package target in ${packageRecord.path}: ${target}`,
          );
        }
        return posix.join(packageRecord.root, tail);
      }
      if (
        imports &&
        !substituted.startsWith("../") &&
        !substituted.startsWith("/")
      ) {
        validateSpecifier(substituted);
        return Object.freeze({ externalSpecifier: substituted });
      }
      throw new InvalidPackageTargetError(
        `invalid package target in ${packageRecord.path}: ${target}`,
      );
    }
    if (Array.isArray(target)) {
      if (target.length === 0) return BLOCKED;
      let lastInvalid;
      for (const alternative of target) {
        try {
          const result = this.#resolveTarget(
            alternative,
            match,
            packageRecord,
            kind,
            imports,
          );
          if (result !== NO_MATCH) return result;
        } catch (error) {
          if (!(error instanceof InvalidPackageTargetError)) throw error;
          lastInvalid = error;
        }
      }
      if (lastInvalid) throw lastInvalid;
      return NO_MATCH;
    }
    if (target && typeof target === "object") {
      for (const condition of Object.keys(target)) {
        if (/^(0|[1-9][0-9]*)$/.test(condition)) {
          fail(
            "ERR_INVALID_PACKAGE_CONFIG",
            `${packageRecord.path} uses an integer condition key`,
          );
        }
        const active = new Set([
          "node",
          conditionForKind(kind),
          ...this.#customConditions,
        ]);
        if (condition === "default" || active.has(condition)) {
          const result = this.#resolveTarget(
            target[condition],
            match,
            packageRecord,
            kind,
            imports,
          );
          if (result !== NO_MATCH) return result;
        }
      }
      return NO_MATCH;
    }
    throw new InvalidPackageTargetError(
      `invalid package target type in ${packageRecord.path}`,
    );
  }
}

module.exports = {
  ImmutableVfsResolver,
  VfsResolutionError,
};
