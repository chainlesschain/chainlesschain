"use strict";

/**
 * Bounded, metadata-only workspace index used by @-mention completion.
 *
 * The index deliberately accepts paths and symbol metadata only. It has no
 * filesystem/content reader, which keeps completion rendering from opening a
 * file. Every returned value is revalidated as a workspace-relative path.
 */
const MAX_PATHS = 100_000;
const MAX_CANDIDATES = 200;
const DENIED_SEGMENTS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
]);
const IDE_MENTIONS = ["selection", "diagnostics", "terminal", "context"];

function canonicalPath(value) {
  const normalized = String(value == null ? "" : value)
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
  return normalized.length > 1 && normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

function comparablePath(value) {
  const normalized = canonicalPath(value);
  return /^[A-Za-z]:\//.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
}

function isDeniedRelativePath(value) {
  const normalized = canonicalPath(value);
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return true;
  }
  const segments = normalized.split("/");
  return segments.some(
    (segment) =>
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.includes("\0") ||
      DENIED_SEGMENTS.has(segment.toLowerCase()),
  );
}

function relativeToRoots(absolutePath, roots) {
  const raw = canonicalPath(absolutePath);
  const comparable = comparablePath(raw);
  for (const root of roots) {
    const canonicalRoot = canonicalPath(root);
    const rootComparable = comparablePath(root);
    const prefix = rootComparable === "/" ? "/" : rootComparable + "/";
    if (comparable.startsWith(prefix)) {
      const relative = raw.slice(
        canonicalRoot === "/" ? 1 : canonicalRoot.length + 1,
      );
      return isDeniedRelativePath(relative) ? null : relative;
    }
  }
  return null;
}

function rankEntries(entries, prefix, limit) {
  const max = Math.min(
    MAX_CANDIDATES,
    Number.isInteger(limit) && limit > 0 ? limit : MAX_CANDIDATES,
  );
  const query = String(prefix == null ? "" : prefix)
    .toLowerCase()
    .replace(/\\/g, "/");
  if (!query) {
    const head = [];
    for (const entry of entries) {
      head.push(entry);
      if (head.length >= max) break;
    }
    return head;
  }
  const basename = [];
  const pathname = [];
  const substring = [];
  for (const entry of entries) {
    const lower = entry.search;
    const stripped = lower.endsWith("/") ? lower.slice(0, -1) : lower;
    const base = stripped.slice(stripped.lastIndexOf("/") + 1);
    if (base.startsWith(query)) {
      if (basename.length < max) basename.push(entry);
    } else if (lower.startsWith(query)) {
      if (pathname.length < max) pathname.push(entry);
    } else if (lower.includes(query) && substring.length < max) {
      substring.push(entry);
    }
    // Basename hits are the highest rank. Once they alone fill the bounded
    // result, no later path/substring item can affect the returned first 200.
    if (basename.length >= max) break;
  }
  return basename.concat(pathname, substring).slice(0, max);
}

class WorkspaceMentionIndex {
  constructor({ roots = [], trusted = false, maxPaths = MAX_PATHS } = {}) {
    this.roots = roots.map(canonicalPath).filter(Boolean);
    this.trusted = trusted === true;
    this.maxPaths = Math.min(
      MAX_PATHS,
      Math.max(1, Number(maxPaths) || MAX_PATHS),
    );
    this.workspaceRevision = 0;
    this.queryGeneration = 0;
    this._activeTicket = null;
    this._files = new Map();
    this._folderRefs = new Map();
    this._symbols = new Map();
    this.metrics = {
      cancellationCount: 0,
      discardedQueryCount: 0,
      staleCommitCount: 0,
      leakCount: 0,
      deniedPathCount: 0,
      contentReadCount: 0,
    };
  }

  setWorkspace({ roots = this.roots, trusted = this.trusted } = {}) {
    const nextRoots = roots.map(canonicalPath).filter(Boolean);
    const changed =
      (trusted === true) !== this.trusted ||
      JSON.stringify(nextRoots) !== JSON.stringify(this.roots);
    if (!changed) return false;
    this.trusted = trusted === true;
    this.roots = nextRoots;
    this._files.clear();
    this._folderRefs.clear();
    this._symbols.clear();
    this.workspaceRevision += 1;
    this.cancelActive();
    return true;
  }

  _relative(absolutePath) {
    if (!this.trusted) {
      this.metrics.deniedPathCount += 1;
      return null;
    }
    const relative = relativeToRoots(absolutePath, this.roots);
    if (!relative) this.metrics.deniedPathCount += 1;
    return relative;
  }

  _addFolders(relativePath) {
    let slash = relativePath.lastIndexOf("/");
    while (slash > 0) {
      const folder = relativePath.slice(0, slash + 1);
      this._folderRefs.set(folder, (this._folderRefs.get(folder) || 0) + 1);
      slash = relativePath.lastIndexOf("/", slash - 1);
    }
  }

  _removeFolders(relativePath) {
    let slash = relativePath.lastIndexOf("/");
    while (slash > 0) {
      const folder = relativePath.slice(0, slash + 1);
      const refs = (this._folderRefs.get(folder) || 1) - 1;
      if (refs <= 0) this._folderRefs.delete(folder);
      else this._folderRefs.set(folder, refs);
      slash = relativePath.lastIndexOf("/", slash - 1);
    }
  }

  upsertPath(absolutePath) {
    const relative = this._relative(absolutePath);
    if (!relative || this._files.has(relative)) return false;
    if (this._files.size >= this.maxPaths) return false;
    this._files.set(relative, {
      value: relative,
      search: relative.toLowerCase(),
    });
    this._addFolders(relative);
    this.workspaceRevision += 1;
    return true;
  }

  removePath(absolutePath) {
    const relative = relativeToRoots(absolutePath, this.roots);
    if (!relative || !this._files.delete(relative)) return false;
    this._removeFolders(relative);
    this.workspaceRevision += 1;
    return true;
  }

  touchWorkspace() {
    this.workspaceRevision += 1;
    return this.workspaceRevision;
  }

  replacePaths(absolutePaths) {
    const next = new Map();
    if (this.trusted) {
      for (const absolutePath of Array.isArray(absolutePaths)
        ? absolutePaths
        : []) {
        const relative = relativeToRoots(absolutePath, this.roots);
        if (!relative) {
          this.metrics.deniedPathCount += 1;
          continue;
        }
        if (!next.has(relative) && next.size < this.maxPaths) {
          next.set(relative, {
            value: relative,
            search: relative.toLowerCase(),
          });
        }
      }
    }
    this._files = next;
    this._folderRefs.clear();
    for (const relative of next.keys()) this._addFolders(relative);
    this.workspaceRevision += 1;
    return this._files.size;
  }

  beginQuery() {
    this.cancelActive();
    const ticket = {
      generation: ++this.queryGeneration,
      workspaceRevision: this.workspaceRevision,
      cancelled: false,
      completed: false,
    };
    this._activeTicket = ticket;
    return ticket;
  }

  cancelActive() {
    if (
      this._activeTicket &&
      !this._activeTicket.cancelled &&
      !this._activeTicket.completed
    ) {
      this._activeTicket.cancelled = true;
      this.metrics.cancellationCount += 1;
    }
  }

  isCurrent(ticket) {
    return Boolean(
      ticket &&
        !ticket.cancelled &&
        this._activeTicket === ticket &&
        ticket.generation === this.queryGeneration,
    );
  }

  refreshTicket(ticket) {
    if (this.isCurrent(ticket))
      ticket.workspaceRevision = this.workspaceRevision;
    return ticket;
  }

  replaceSymbols(ticket, symbols) {
    if (
      !this.isCurrent(ticket) ||
      ticket.workspaceRevision !== this.workspaceRevision
    ) {
      this.metrics.discardedQueryCount += 1;
      return false;
    }
    const next = new Map();
    if (this.trusted) {
      for (const symbol of Array.isArray(symbols) ? symbols : []) {
        const absolutePath =
          symbol?.location?.uri?.fsPath || symbol?.fsPath || symbol?.path || "";
        const relative = relativeToRoots(absolutePath, this.roots);
        const name = String(symbol?.name || "").trim();
        if (!relative || !name) {
          if (absolutePath) this.metrics.deniedPathCount += 1;
          continue;
        }
        const kind = String(symbol?.kindLabel || symbol?.kind || "symbol");
        const value = {
          label: `${kind} ${name} · ${relative}`,
          value: relative,
        };
        const key = `${name.toLowerCase()}\0${relative}`;
        if (!next.has(key) && next.size < this.maxPaths) {
          next.set(key, {
            value,
            search: `${name} ${relative}`.toLowerCase(),
          });
        }
      }
    }
    this._symbols = next;
    this.workspaceRevision += 1;
    this.refreshTicket(ticket);
    return true;
  }

  queryFiles(prefix, limit = 20) {
    if (!this.trusted) return [];
    const self = this;
    function* entries() {
      for (const value of self._folderRefs.keys()) {
        yield { value, search: value.toLowerCase() };
      }
      yield* self._files.values();
    }
    return rankEntries(entries(), prefix, limit).map((entry) => entry.value);
  }

  query(ticket, prefix, limit = MAX_CANDIDATES) {
    if (!this.isCurrent(ticket)) {
      this.metrics.discardedQueryCount += 1;
      return {
        cancelled: true,
        items: [],
        generation: ticket?.generation || 0,
      };
    }
    const self = this;
    function* entries() {
      for (const mention of IDE_MENTIONS) {
        yield { value: mention, search: mention };
      }
      if (!self.trusted) return;
      for (const folder of self._folderRefs.keys()) {
        yield { value: folder, search: folder.toLowerCase() };
      }
      yield* self._files.values();
      yield* self._symbols.values();
    }
    const seen = new Set();
    const items = [];
    for (const entry of rankEntries(entries(), prefix, limit)) {
      const value =
        entry.value && typeof entry.value === "object"
          ? String(entry.value.value || "")
          : String(entry.value || "");
      if (!IDE_MENTIONS.includes(value) && isDeniedRelativePath(value)) {
        this.metrics.leakCount += 1;
        continue;
      }
      if (!value || seen.has(value)) continue;
      seen.add(value);
      items.push(entry.value);
      if (items.length >= Math.min(MAX_CANDIDATES, limit)) break;
    }
    return {
      cancelled: false,
      generation: ticket.generation,
      workspaceRevision: ticket.workspaceRevision,
      items,
    };
  }

  commit(ticket, result) {
    if (
      !this.isCurrent(ticket) ||
      ticket.workspaceRevision !== this.workspaceRevision ||
      result?.generation !== ticket.generation
    ) {
      this.metrics.discardedQueryCount += 1;
      return false;
    }
    ticket.completed = true;
    return true;
  }

  snapshot() {
    return {
      pathCount: this._files.size,
      symbolCount: this._symbols.size,
      workspaceRevision: this.workspaceRevision,
      queryGeneration: this.queryGeneration,
      ...this.metrics,
    };
  }
}

module.exports = {
  DENIED_SEGMENTS,
  MAX_CANDIDATES,
  MAX_PATHS,
  WorkspaceMentionIndex,
  canonicalPath,
  isDeniedRelativePath,
  rankEntries,
  relativeToRoots,
};
