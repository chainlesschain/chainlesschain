/**
 * REPL `@` file-reference tab-completion (Claude-Code @-mention parity).
 *
 * Typing `@src/fo<TAB>` in the agent REPL completes file/dir paths the same
 * way the @-token will later be expanded by file-ref-expander. Two candidate
 * sources, merged:
 *   1. the filesystem under cwd (dirs get a trailing `/` so TAB can descend)
 *   2. the connected IDE's OPEN EDITOR TABS (when the IDE bridge is up) —
 *      the files you are working on rank first, before any fs listing.
 *
 * IDE tabs come from an injected async `getIdeOpenFiles()`; the completer
 * caches the last list (TTL) and refreshes in the background, so completion
 * stays synchronous-fast and a slow/dead IDE costs nothing (first TAB simply
 * has no IDE entries yet).
 */
import fs from "fs";
import path from "path";

/** Refresh the IDE open-editors list at most this often. */
const IDE_CACHE_TTL_MS = 5000;
/** Hard cap on candidates shown per TAB. */
const MAX_CANDIDATES = 30;

/**
 * Find a trailing `@token` being typed at the end of the line. Returns
 * `{ prefix }` (token without `@`, may be "") or null when the cursor is not
 * on an @-token. An @ must start the line or follow whitespace, mirroring
 * file-ref-expander's token rules.
 */
export function extractAtPrefix(line) {
  const m = /(^|\s)@([^\s@]*)$/.exec(line || "");
  return m ? { prefix: m[2] } : null;
}

/** Normalize to forward slashes (what @refs use on every platform). */
function fwd(p) {
  return String(p).replace(/\\/g, "/");
}

/**
 * Filesystem candidates for an @-prefix, relative to cwd. Directories get a
 * trailing `/`. Missing dirs / unreadable entries → empty (best-effort).
 */
export function fileCandidates(prefix, { cwd = process.cwd(), deps } = {}) {
  const readdir = deps?.readdir || ((d) => fs.readdirSync(d));
  const isDir =
    deps?.isDir ||
    ((p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
  const norm = fwd(prefix);
  const slash = norm.lastIndexOf("/");
  const dirPart = slash >= 0 ? norm.slice(0, slash + 1) : "";
  const basePart = slash >= 0 ? norm.slice(slash + 1) : norm;
  const absDir = path.resolve(cwd, dirPart || ".");
  let names;
  try {
    names = readdir(absDir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (basePart && !name.toLowerCase().startsWith(basePart.toLowerCase())) {
      continue;
    }
    if (name === "node_modules" || name === ".git") continue;
    const rel = dirPart + name;
    out.push(isDir(path.join(absDir, name)) ? `${rel}/` : rel);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/**
 * Build a readline completer. Returns `completer(line)` → `[hits, replaced]`
 * per the readline contract. Completes `@path` tokens anywhere in the line
 * and `/command` names at line start (while the command token is still being
 * typed); everything else completes to nothing.
 *
 * @param {object} opts { cwd?, getIdeOpenFiles?: () => Promise<string[]>,
 *                        slashCommands?: string[], deps? }
 */
export function makeAtCompleter(opts = {}) {
  // Lazy when not pinned: `/cd` mid-session moves process.cwd() and the
  // completer must follow (explicit opts.cwd stays static for tests).
  const baseCwd = opts.cwd || null;
  const getCwd = () => baseCwd || process.cwd();
  const getIde = opts.getIdeOpenFiles || null;
  const now = opts.deps?.now || Date.now;
  let ideFiles = [];
  let ideFetchedAt = -Infinity; // "never" — the first @ must always fetch
  let ideInFlight = false;

  const refreshIde = () => {
    if (!getIde || ideInFlight || now() - ideFetchedAt < IDE_CACHE_TTL_MS) {
      return;
    }
    ideInFlight = true;
    Promise.resolve()
      .then(() => getIde())
      .then((files) => {
        ideFiles = Array.isArray(files)
          ? files
              .filter((f) => typeof f === "string" && f.length > 0)
              .map((f) => {
                const rel = path.relative(getCwd(), f);
                // Keep workspace files relative (the natural @ref form);
                // out-of-workspace files keep their absolute path. On
                // Windows a cross-drive relative() returns an *absolute*
                // path (no ".." prefix), so isAbsolute must also gate it.
                return rel && !rel.startsWith("..") && !path.isAbsolute(rel)
                  ? fwd(rel)
                  : fwd(f);
              })
          : [];
        ideFetchedAt = now();
      })
      .catch(() => {
        ideFetchedAt = now(); // don't hammer a dead IDE
      })
      .finally(() => {
        ideInFlight = false;
      });
  };

  // De-duplicate before sorting so a drifted/aliased entry in the hand-
  // maintained command list never shows twice in the autocomplete (mirrors the
  // @-path's `new Set` merge below; Claude-Code 2.1.183 fixed the same class of
  // duplicate-in-slash-autocomplete bug).
  const slashCommands = Array.isArray(opts.slashCommands)
    ? [...new Set(opts.slashCommands)].sort()
    : [];

  const completer = (line) => {
    // `/command` completion (Claude-Code parity): only while typing the
    // command token itself — once a space follows, args are the user's.
    const slash = /^\/([A-Za-z_-]*)$/.exec(line);
    if (slash && slashCommands.length) {
      const pref = `/${slash[1].toLowerCase()}`;
      const hits = slashCommands.filter((c) =>
        c.toLowerCase().startsWith(pref),
      );
      return [hits, line];
    }
    const at = extractAtPrefix(line);
    if (!at) return [[], line];
    refreshIde(); // async top-up for the NEXT tab; this one uses the cache
    const norm = fwd(at.prefix).toLowerCase();
    const fromIde = ideFiles.filter((f) => f.toLowerCase().startsWith(norm));
    const fromFs = fileCandidates(at.prefix, { cwd: getCwd(), deps: opts.deps });
    const merged = [...new Set([...fromIde, ...fromFs])].slice(
      0,
      MAX_CANDIDATES,
    );
    // readline replaces `replaced` with the chosen hit — keep the `@`.
    return [merged.map((m) => `@${m}`), `@${at.prefix}`];
  };
  // test seam: expose the cache refresher state
  completer._refreshIde = refreshIde;
  completer._ideState = () => ({ ideFiles, ideFetchedAt });
  return completer;
}
