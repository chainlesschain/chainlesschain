/**
 * 腾讯文档采集器。
 *
 * 个人版没有可核验的公开 OAuth 文件列表契约。在线开放 API 属于腾讯文档
 * 企业版/私有化集成，接口与授权由企业合同决定，因此本适配器不依赖网页内部
 * dop-api 或登录 Cookie。
 *
 * 稳定采集路径：
 *   1. schemaVersion 1 JSON 快照（复用 document-base）。
 *   2. 用户从腾讯文档导出后，递归扫描本地导出目录。
 *
 * 本地目录的绝对路径和账号标识只参与哈希作用域，不写入原始事件。文件实体仅
 * 保存相对于导出根目录的路径、格式、大小和文件时间。
 */

"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const {
  createDocumentAdapter,
  parseTime,
  SNAPSHOT_SCHEMA_VERSION,
  KIND_DOCUMENT,
} = require("../_document-base");
const { CAPTURED_BY } = require("../../constants");

const NAME = "doc-tencent-docs";
const VERSION = "0.2.0";
const DEFAULT_MAX_FILES = Number.POSITIVE_INFINITY;

const EXPORT_TYPE_BY_EXTENSION = Object.freeze({
  ".csv": "sheet",
  ".doc": "doc",
  ".docx": "doc",
  ".jpeg": "image",
  ".jpg": "image",
  ".md": "doc",
  ".odp": "slide",
  ".ods": "sheet",
  ".odt": "doc",
  ".pdf": "pdf",
  ".png": "image",
  ".pos": "form",
  ".ppt": "slide",
  ".pptx": "slide",
  ".rtf": "doc",
  ".text": "doc",
  ".txt": "doc",
  ".xls": "sheet",
  ".xlsx": "sheet",
  ".xmind": "mind",
});

const SUPPORTED_EXPORT_EXTENSIONS = Object.freeze(
  Object.keys(EXPORT_TYPE_BY_EXTENSION),
);

// Retained for schemaVersion 1 snapshots and backwards-compatible mapper use.
const TYPE_MAP = Object.freeze({
  doc: "doc",
  document: "doc",
  form: "form",
  image: "image",
  mind: "mind",
  pdf: "pdf",
  presentation: "slide",
  sheet: "sheet",
  slide: "slide",
  spreadsheet: "sheet",
  1: "doc",
  2: "sheet",
  3: "slide",
});

function mapTencentType(d) {
  const raw =
    d.type != null ? d.type : d.docType != null ? d.docType : d.fileType;
  const key = String(raw == null ? "" : raw).toLowerCase();
  return TYPE_MAP[key] || TYPE_MAP[raw] || "doc";
}

function mapDoc(d) {
  if (!d || typeof d !== "object") return null;
  const docId = d.id || d.fileId || d.file_id || d.docId || d.url;
  if (!docId) return null;
  return {
    docId: String(docId),
    title: d.title || d.name || d.fileName || "(无标题)",
    docType: mapTencentType(d),
    url: d.url || (d.id ? `https://docs.qq.com/doc/${d.id}` : null),
    createdMs: parseTime(d.createTime || d.create_time || d.gmtCreate),
    updatedMs: parseTime(
      d.lastModifyTime || d.modifyTime || d.updateTime || d.gmtModify,
    ),
    extra: {
      ownerName: d.ownerName || d.creatorName || null,
      starred: d.isStar != null ? d.isStar : undefined,
    },
  };
}

function createExportDocumentId(relativePath) {
  return crypto.createHash("sha256").update(relativePath, "utf8").digest("hex");
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function mapExportFile({ relativePath, stat }) {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const extension = path.extname(normalizedRelativePath).toLowerCase();
  const docType = EXPORT_TYPE_BY_EXTENSION[extension];
  if (!docType) return null;

  const createdMs =
    Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0
      ? Math.floor(stat.birthtimeMs)
      : null;
  const updatedMs =
    Number.isFinite(stat.mtimeMs) && stat.mtimeMs > 0
      ? Math.floor(stat.mtimeMs)
      : null;
  return {
    docId: createExportDocumentId(normalizedRelativePath),
    title: path.basename(normalizedRelativePath),
    docType,
    url: null,
    createdMs,
    updatedMs,
    extra: {
      relativePath: normalizedRelativePath,
      sourceFormat: extension.slice(1),
      sizeBytes:
        Number.isSafeInteger(stat.size) && stat.size >= 0 ? stat.size : null,
      exportedFile: true,
    },
  };
}

const BaseTencentDocsAdapter = createDocumentAdapter({
  NAME,
  VERSION,
  platform: "tencent-docs",
  defaultListUrl: "",
  extractDocs: () => [],
  mapDoc,
});

class TencentDocsAdapter extends BaseTencentDocsAdapter {
  constructor(opts = {}) {
    // This adapter has no cookie mode. Keep only the stable identity field so
    // accidental website credentials never linger on the adapter instance.
    const account =
      opts.account && opts.account.userId != null
        ? { userId: opts.account.userId }
        : null;
    super({ ...opts, account });
    this.runtimeCredentialOption = "exportDir";
    this.runtimeScopeIdentityKey = "userId";
    this.runtimeScopeDiscriminatorKeys = ["exportDir", "recursive"];
    this.runtimeScopeDiscriminatorDefaults = { recursive: true };
    this.capabilities = [
      "sync:snapshot",
      "sync:export-directory",
      "parse:tencent-documents",
    ];
    this.extractMode = "file-import";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "tencent-docs:document (title / relative path / format / timestamps / size)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { document: true },
    };
  }

  async authenticate(ctx = {}) {
    if (hasInputPath(ctx)) return super.authenticate(ctx);
    if (!readExportDir(ctx.exportDir)) {
      return unhealthy(
        "NO_EXPORT_DIR",
        `${NAME}.authenticate: needs opts.exportDir for a local Tencent Docs export`,
      );
    }
    if (!readAccountId(ctx)) {
      return unhealthy(
        "NO_ACCOUNT_ID",
        `${NAME}.authenticate: needs opts.accountId to isolate the export cursor`,
      );
    }
    try {
      const { root } = canonicalizeExportRoot(this._deps.fs, ctx.exportDir);
      this._deps.fs.accessSync(root, this._deps.fs.constants.R_OK);
    } catch (error) {
      if (error?.code === "TENCENT_DOCS_EXPORT_ROOT_REPARSE") {
        return unhealthy(
          "EXPORT_DIR_SYMBOLIC_LINK",
          "Tencent Docs export input cannot be a symbolic link",
        );
      }
      if (error?.code === "TENCENT_DOCS_EXPORT_ROOT_NOT_DIRECTORY") {
        return unhealthy(
          "EXPORT_DIR_NOT_DIRECTORY",
          "Tencent Docs export input is not a directory",
        );
      }
      return unhealthy(
        "EXPORT_DIR_UNREADABLE",
        "Tencent Docs export directory is not readable",
      );
    }
    return { ok: true, mode: "export-directory" };
  }

  async healthCheck(ctx = {}) {
    const result = await this.authenticate(ctx);
    return result.ok
      ? { ok: true, lastChecked: Date.now(), mode: result.mode }
      : {
          ok: false,
          reason: result.reason,
          error: result.message || result.error,
        };
  }

  async *sync(opts = {}) {
    if (hasInputPath(opts)) {
      yield* super.sync(opts);
      return;
    }
    const readiness = await this.authenticate(opts);
    if (!readiness.ok) {
      throw new Error(readiness.message || readiness.reason);
    }
    yield* this._syncExportDirectory(opts);
  }

  async *_syncExportDirectory(opts) {
    const include = opts.include || {};
    if (include[KIND_DOCUMENT] === false) {
      if (typeof opts.markWatermarkComplete === "function") {
        opts.markWatermarkComplete();
      }
      return;
    }

    let rootState;
    try {
      rootState = canonicalizeExportRoot(this._deps.fs, opts.exportDir);
    } catch {
      throw exportScanError(
        "TENCENT_DOCS_EXPORT_CHANGED",
        "Tencent Docs export root changed before it could be scanned",
      );
    }
    const { root } = rootState;
    const recursive = opts.recursive !== false;
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const maxFiles = normalizeMaxFiles(opts.maxFiles);
    const sinceMs =
      opts.sinceWatermark != null
        ? Number.parseInt(String(opts.sinceWatermark), 10) || 0
        : 0;

    let emitted = 0;
    let inspected = 0;
    let scanComplete = true;
    const pending = [
      {
        directory: root,
        expectedIdentity: rootState.identity,
      },
    ];
    while (pending.length > 0) {
      const { directory, expectedIdentity } = pending.shift();
      const before = inspectStableExportPath(
        this._deps.fs,
        root,
        directory,
        "directory",
        expectedIdentity,
      );
      if (!before.ok) {
        scanComplete = false;
        continue;
      }

      let entries;
      try {
        entries = this._deps.fs.readdirSync(directory, {
          withFileTypes: true,
        });
      } catch {
        throw exportScanError(
          "TENCENT_DOCS_EXPORT_UNREADABLE",
          "Tencent Docs export directory could not be scanned",
        );
      }
      const afterListing = inspectStableExportPath(
        this._deps.fs,
        root,
        directory,
        "directory",
        before.identity,
      );
      if (!afterListing.ok) {
        scanComplete = false;
        continue;
      }
      entries.sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
      );

      for (const entry of entries) {
        if (!isSafeEntryName(entry?.name)) {
          scanComplete = false;
          continue;
        }
        const absolutePath = path.resolve(directory, entry.name);
        if (!isWithinRoot(root, absolutePath) || entry.isSymbolicLink()) {
          scanComplete = false;
          continue;
        }

        const entryKind = direntKind(entry);
        const firstInspection = inspectStableExportPath(
          this._deps.fs,
          root,
          absolutePath,
          entryKind,
        );
        if (!firstInspection.ok) {
          scanComplete = false;
          continue;
        }
        const stat = firstInspection.stat;
        if (stat.isDirectory()) {
          if (recursive) {
            pending.push({
              directory: absolutePath,
              expectedIdentity: firstInspection.identity,
            });
          }
          continue;
        }
        if (!stat.isFile()) continue;
        if (inspected >= maxFiles) return;
        inspected += 1;

        const relativePath = path.relative(root, absolutePath);
        const record = mapExportFile({ relativePath, stat });
        if (!record) continue;
        const finalInspection = inspectStableExportPath(
          this._deps.fs,
          root,
          absolutePath,
          "file",
          firstInspection.identity,
        );
        if (!finalInspection.ok) {
          scanComplete = false;
          continue;
        }
        const capturedAt = record.updatedMs || record.createdMs || Date.now();
        if (sinceMs && capturedAt < sinceMs) continue;
        if (emitted >= limit) return;

        yield {
          adapter: NAME,
          kind: KIND_DOCUMENT,
          originalId: `tencent-docs:document:${record.docId}`,
          capturedAt,
          payload: { record },
        };
        emitted += 1;
      }
    }

    if (scanComplete && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
  }

  normalize(raw) {
    const batch = super.normalize(raw);
    for (const entity of [...batch.events, ...batch.items]) {
      entity.source.capturedBy = CAPTURED_BY.EXPORT;
    }
    return batch;
  }
}

function hasInputPath(opts) {
  return (
    opts &&
    typeof opts.inputPath === "string" &&
    opts.inputPath.trim().length > 0
  );
}

function readExportDir(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readAccountId(opts) {
  const value = opts.userId != null ? opts.userId : opts.accountId;
  return value != null && String(value).trim().length > 0
    ? String(value).trim()
    : null;
}

function normalizeMaxFiles(value) {
  if (value == null || value === "") return DEFAULT_MAX_FILES;
  const normalized = typeof value === "number" ? value : Number(String(value));
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw exportScanError(
      "TENCENT_DOCS_INVALID_MAX_FILES",
      "Tencent Docs maxFiles must be a positive integer",
    );
  }
  return normalized;
}

function canonicalizeExportRoot(fsMod, exportDir) {
  const lexicalRoot = path.resolve(exportDir);
  const before = fsMod.lstatSync(lexicalRoot);
  if (before.isSymbolicLink()) {
    throw exportScanError(
      "TENCENT_DOCS_EXPORT_ROOT_REPARSE",
      "Tencent Docs export root cannot be a symbolic link",
    );
  }
  if (!before.isDirectory()) {
    throw exportScanError(
      "TENCENT_DOCS_EXPORT_ROOT_NOT_DIRECTORY",
      "Tencent Docs export root must be a directory",
    );
  }
  const realBefore = resolveRealPath(fsMod, lexicalRoot);
  const after = fsMod.lstatSync(lexicalRoot);
  const realAfter = resolveRealPath(fsMod, lexicalRoot);
  if (
    after.isSymbolicLink() ||
    !after.isDirectory() ||
    !samePath(realBefore, realAfter) ||
    statFingerprint(before) !== statFingerprint(after)
  ) {
    throw exportScanError(
      "TENCENT_DOCS_EXPORT_ROOT_CHANGED",
      "Tencent Docs export root changed while it was being inspected",
    );
  }
  return {
    root: realAfter,
    identity: createPathIdentity(realAfter, after),
  };
}

function inspectStableExportPath(
  fsMod,
  root,
  candidate,
  expectedKind,
  expectedIdentity = null,
) {
  try {
    const before = fsMod.lstatSync(candidate);
    if (before.isSymbolicLink()) {
      return { ok: false, reason: "SYMBOLIC_LINK" };
    }
    const realBefore = resolveRealPath(fsMod, candidate);
    if (
      !samePath(candidate, realBefore) ||
      !isWithinOrEqual(root, realBefore) ||
      (expectedKind && pathKind(before) !== expectedKind)
    ) {
      return { ok: false, reason: "PATH_ESCAPE" };
    }

    const after = fsMod.lstatSync(candidate);
    if (after.isSymbolicLink()) {
      return { ok: false, reason: "PATH_CHANGED" };
    }
    const realAfter = resolveRealPath(fsMod, candidate);
    const identity = createPathIdentity(realAfter, after);
    if (
      !samePath(realBefore, realAfter) ||
      !samePath(candidate, realAfter) ||
      !isWithinOrEqual(root, realAfter) ||
      pathKind(before) !== pathKind(after) ||
      statFingerprint(before) !== statFingerprint(after) ||
      (expectedKind && pathKind(after) !== expectedKind) ||
      (expectedIdentity && !samePathIdentity(expectedIdentity, identity))
    ) {
      return { ok: false, reason: "PATH_CHANGED" };
    }
    return { ok: true, stat: after, realPath: realAfter, identity };
  } catch {
    return { ok: false, reason: "PATH_UNREADABLE" };
  }
}

function resolveRealPath(fsMod, value) {
  const candidate = path.resolve(value);
  if (!fsMod.realpathSync) {
    throw exportScanError(
      "TENCENT_DOCS_REALPATH_UNAVAILABLE",
      "Tencent Docs export paths cannot be verified",
    );
  }
  const resolved =
    typeof fsMod.realpathSync.native === "function"
      ? fsMod.realpathSync.native(candidate)
      : fsMod.realpathSync(candidate);
  return path.resolve(resolved);
}

function normalizedPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return normalizedPath(left) === normalizedPath(right);
}

function isWithinOrEqual(root, candidate) {
  if (samePath(root, candidate)) return true;
  return isWithinRoot(root, candidate);
}

function pathKind(stat) {
  if (stat?.isSymbolicLink()) return "symlink";
  if (stat?.isDirectory()) return "directory";
  if (stat?.isFile()) return "file";
  return "other";
}

function statFingerprint(stat) {
  return [
    Number.isFinite(stat?.dev) ? stat.dev : "",
    Number.isFinite(stat?.ino) ? stat.ino : "",
    Number.isFinite(stat?.size) ? stat.size : "",
    Number.isFinite(stat?.mtimeMs) ? stat.mtimeMs : "",
    Number.isFinite(stat?.ctimeMs) ? stat.ctimeMs : "",
  ].join(":");
}

function createPathIdentity(realPath, stat) {
  return {
    realPath: normalizedPath(realPath),
    kind: pathKind(stat),
    fingerprint: statFingerprint(stat),
  };
}

function samePathIdentity(left, right) {
  return (
    left.realPath === right.realPath &&
    left.kind === right.kind &&
    left.fingerprint === right.fingerprint
  );
}

function direntKind(entry) {
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  return null;
}

function isSafeEntryName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("\0") &&
    path.basename(name) === name
  );
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function unhealthy(reason, message) {
  return { ok: false, reason, message, error: message };
}

function exportScanError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  TencentDocsAdapter,
  mapDoc,
  mapExportFile,
  createExportDocumentId,
  normalizeMaxFiles,
  SUPPORTED_EXPORT_EXTENSIONS,
  EXPORT_TYPE_BY_EXTENSION,
  TYPE_MAP,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  DEFAULT_MAX_FILES,
};
