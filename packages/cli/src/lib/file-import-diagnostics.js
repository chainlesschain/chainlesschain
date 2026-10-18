import fs from "node:fs";
import path from "node:path";
import { parse } from "acorn";

export const FILE_IMPORT_LIMITS = Object.freeze({
  contentBytes: 256 * 1024,
  references: 64,
  specifierChars: 512,
});

const JS_EXTENSION = /\.(?:js|mjs|cjs)$/;

function inside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

// Inspect each component before descending. Never stat/realpath a link, read
// target contents, enumerate directories, or include OS errors in feedback.
// As with other path-based Node APIs, this is not atomic against directory
// replacement by another process. The caller supplies its authorized root.
function inspectPath(root, target) {
  if (!inside(root, target)) return "outside-workspace";
  const components = path
    .relative(root, target)
    .split(path.sep)
    .filter(Boolean);
  let current = root;
  for (let index = -1; index < components.length; index++) {
    if (index >= 0) current = path.join(current, components[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      return error?.code === "ENOENT" ? "missing" : "unavailable";
    }
    if (stat.isSymbolicLink()) return "symbolic-link";
    if (index < components.length - 1 && !stat.isDirectory()) {
      return "missing";
    }
    if (index === components.length - 1) {
      return stat.isFile() ? "file" : "not-file";
    }
  }
  return "not-file";
}

function inspectReference(root, target, kind) {
  const state = inspectPath(root, target);
  if (kind !== "require") return state;
  // CommonJS can load directories and append extensions even when a request
  // already has a suffix. Do not claim those uncertain cases are unresolved.
  if (state === "not-file") return "commonjs-resolution";
  if (state === "missing") {
    for (const extension of [".js", ".json", ".node"]) {
      const fallback = inspectPath(root, target + extension);
      if (fallback !== "missing" && fallback !== "not-file") {
        return "commonjs-resolution";
      }
    }
  }
  return state;
}

function parseSource(content, extension) {
  const options = { ecmaVersion: "latest", locations: true };
  if (extension === ".cjs") {
    return parse(content, {
      ...options,
      sourceType: "script",
      allowReturnOutsideFunction: true,
    });
  }
  try {
    return parse(content, { ...options, sourceType: "module" });
  } catch (error) {
    if (extension === ".mjs") throw error;
    return parse(content, {
      ...options,
      sourceType: "script",
      allowReturnOutsideFunction: true,
    });
  }
}

function collectReferences(ast) {
  const references = [];
  const pending = [{ node: ast, parent: null }];
  let uncertainRequire = false;
  let truncated = false;
  while (pending.length) {
    const { node, parent } = pending.pop();
    // Conservative across the whole file: local bindings, assignments, and
    // indirect uses make require's meaning uncertain. Imports remain useful.
    if (
      (node.type === "Identifier" &&
        node.name === "require" &&
        !(parent?.type === "CallExpression" && parent.callee === node)) ||
      node.type === "WithStatement" ||
      (node.type === "CallExpression" && node.callee?.name === "eval")
    ) {
      uncertainRequire = true;
    }
    let source;
    let kind;
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration" ||
      node.type === "ImportExpression"
    ) {
      source = node.source;
      kind = "import";
    } else if (
      node.type === "CallExpression" &&
      !node.optional &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "require" &&
      node.arguments.length === 1
    ) {
      source = node.arguments[0];
      kind = "require";
    }
    if (
      source?.type === "Literal" &&
      typeof source.value === "string" &&
      /^\.{1,2}\//.test(source.value) &&
      JS_EXTENSION.test(source.value) &&
      !/[\\%?#:\u0000-\u001f\u007f]/.test(source.value)
    ) {
      if (references.length < FILE_IMPORT_LIMITS.references) {
        references.push({ source, kind });
      } else {
        truncated = true;
      }
    }
    const children = [];
    for (const value of Object.values(node)) {
      if (value?.type) children.push(value);
      else if (Array.isArray(value)) {
        for (const child of value) if (child?.type) children.push(child);
      }
    }
    for (let index = children.length - 1; index >= 0; index--) {
      pending.push({ node: children[index], parent: node });
    }
  }
  return { references, uncertainRequire, truncated };
}

/**
 * Best-effort feedback after an authorized write. Only explicit JS relative
 * runtime references are checked, using supplied content and metadata inside
 * workspaceRoot. This does not run code, resolve packages, or prove tests pass.
 * Missing/inaccessible inputs and unsupported syntax never throw to the writer.
 * line/column are one-based. uncheckedReferences never disclose resolved paths.
 */
export function collectFileImportDiagnostics(input) {
  const result = {
    status: "skipped",
    diagnostics: [],
    checkedReferences: 0,
    uncheckedReferences: [],
    truncated: false,
  };
  const skip = (reason) => ({ ...result, reason });
  try {
    const { filePath, content, workspaceRoot } = input ?? {};
    if (
      typeof filePath !== "string" ||
      !filePath ||
      filePath.length > 4096 ||
      typeof workspaceRoot !== "string" ||
      !workspaceRoot ||
      workspaceRoot.length > 4096 ||
      !path.isAbsolute(workspaceRoot) ||
      typeof content !== "string"
    ) {
      return skip("invalid-input");
    }
    if (!JS_EXTENSION.test(filePath)) return skip("unsupported-file");
    if (
      content.length > FILE_IMPORT_LIMITS.contentBytes ||
      Buffer.byteLength(content, "utf8") > FILE_IMPORT_LIMITS.contentBytes
    ) {
      return skip("content-limit");
    }
    const root = path.resolve(workspaceRoot);
    const file = path.resolve(root, filePath);
    if (!inside(root, file)) return skip("outside-workspace");
    const fileState = inspectPath(root, file);
    if (fileState !== "file") return skip(fileState);
    let ast;
    try {
      ast = parseSource(content, path.extname(file));
    } catch {
      return skip("unsupported-syntax");
    }
    const { references, uncertainRequire, truncated } = collectReferences(ast);
    result.status = "checked";
    result.truncated = truncated;
    for (const { source, kind } of references) {
      const location = {
        specifier: source.value.slice(0, FILE_IMPORT_LIMITS.specifierChars),
        line: source.loc.start.line,
        column: source.loc.start.column + 1,
      };
      let state;
      if (source.value.length > FILE_IMPORT_LIMITS.specifierChars) {
        state = "specifier-limit";
      } else if (kind === "require" && uncertainRequire) {
        state = "uncertain-require";
      } else {
        state = inspectReference(
          root,
          path.resolve(path.dirname(file), source.value),
          kind,
        );
      }
      if (state === "file" || state === "missing" || state === "not-file") {
        result.checkedReferences++;
        if (state !== "file") {
          result.diagnostics.push({
            source: "relative-import",
            code: "UNRESOLVED_RELATIVE_IMPORT",
            severity: "error",
            filePath: file,
            ...location,
            message: `Relative import ${JSON.stringify(location.specifier)} does not point to an existing file from this file's directory. Verify the importing file's location before running tests.`,
          });
        }
      } else {
        result.uncheckedReferences.push({ ...location, reason: state });
      }
    }
    return result;
  } catch {
    // Do not allow optional feedback to turn a completed mutation into failure.
    return skip("unavailable");
  }
}
