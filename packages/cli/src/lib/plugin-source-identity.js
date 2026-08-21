import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const CONTROL_GLOBAL_RE = /[\u0000-\u001f\u007f]/gu;
const OWNER_RE = /^[a-z0-9](?:[a-z0-9._-]{0,99})$/iu;
const SUPPORTED_GIT_SCHEMES = new Set([
  "http:",
  "https:",
  "git:",
  "ssh:",
  "file:",
]);
const SOURCE_KINDS = new Set([
  "github",
  "git",
  "url",
  "registry",
  "file",
  "directory",
]);
const SCP_RE = /^(?:([^@\s/:]+)@)?(\[[^\]]+\]|[^\s/:]+):(.+)$/u;

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizeSshPrincipal(raw, { decodePercent = true } = {}) {
  if (raw == null || raw === "") return null;
  let decoded;
  try {
    decoded = decodePercent ? decodeURIComponent(String(raw)) : String(raw);
  } catch {
    throw invalid("SSH principal has invalid percent encoding");
  }
  if (
    decoded !== decoded.trim() ||
    /\s/u.test(decoded) ||
    /[@:/\\]/u.test(decoded)
  ) {
    throw invalid("SSH principal contains whitespace or ambiguous separators");
  }
  const principal = clean(decoded, "SSH principal", 256);
  return principal;
}

function invalid(message) {
  const error = new Error(
    `managed plugin source policy is invalid: ${message}`,
  );
  error.code = "PLUGIN_SOURCE_POLICY_INVALID";
  return error;
}

function clean(value, label = "source", max = 4096) {
  if (typeof value !== "string") throw invalid(`${label} must be a string`);
  const result = value.trim();
  if (!result || result.length > max || CONTROL_RE.test(result)) {
    throw invalid(`${label} is empty, too long, or contains control bytes`);
  }
  return result;
}

function splitRef(raw) {
  const source = clean(raw);
  const index = source.indexOf("#");
  if (index < 0) return { locator: source, ref: null };
  if (source.indexOf("#", index + 1) >= 0) {
    throw invalid("source contains more than one unescaped ref separator");
  }
  const locator = clean(source.slice(0, index), "source locator");
  const rawRef = source.slice(index + 1);
  return {
    locator,
    ref: rawRef ? clean(rawRef, "source ref", 256) : null,
  };
}

function isExplicitPath(locator) {
  return /^(?:\.{0,2}[\\/]|[a-z]:|\\\\)/iu.test(locator);
}

function normalizeHost(raw) {
  const host = clean(raw, "repository host", 253)
    .replace(/^\[|\]$/gu, "")
    .toLowerCase();
  const withoutRootDot = host.replace(/\.+$/u, "");
  if (!withoutRootDot) throw invalid("repository host is invalid");
  try {
    const authority = withoutRootDot.includes(":")
      ? `[${withoutRootDot}]`
      : withoutRootDot;
    const normalized = new URL(`http://${authority}/`).hostname
      .replace(/^\[|\]$/gu, "")
      .replace(/\.+$/u, "")
      .toLowerCase();
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/iu.exec(
      normalized,
    );
    if (mapped) {
      const high = Number.parseInt(mapped[1], 16);
      const low = Number.parseInt(mapped[2], 16);
      return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join(".");
    }
    return normalized;
  } catch {
    throw invalid("repository host is invalid");
  }
}

function normalizePort(scheme, port) {
  const value = String(port || "");
  const defaults = { http: "80", https: "443", ssh: "22", git: "9418" };
  return defaults[scheme] === value ? "" : value;
}

function formatAuthority(host, port = "") {
  const renderedHost = host.includes(":") ? `[${host}]` : host;
  return port ? `${renderedHost}:${port}` : renderedHost;
}

function normalizeUrlPathSegment(segment) {
  return String(segment).replace(/%([0-9a-f]{2})/giu, (_match, hex) => {
    const character = String.fromCharCode(Number.parseInt(hex, 16));
    return /[a-z0-9._~-]/iu.test(character)
      ? character
      : `%${hex.toUpperCase()}`;
  });
}

function normalizeUrlPathname(pathname) {
  return String(pathname)
    .split("/")
    .map((segment) => normalizeUrlPathSegment(segment))
    .join("/");
}

function decodeRepoSegments(
  host,
  rawPath,
  { decodePercent = true, normalizeUrlPercent = false } = {},
) {
  const hosted = host === "github.com" || host === "gitlab.com";
  const segments = String(rawPath || "")
    .replace(/^\/+|\/+$/gu, "")
    .split("/")
    .map((segment) => {
      let decoded;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        throw invalid("repository path has invalid percent encoding");
      }
      if (
        !decoded ||
        decoded === "." ||
        decoded === ".." ||
        /[\\/]/u.test(decoded) ||
        CONTROL_RE.test(decoded)
      ) {
        throw invalid("repository path is ambiguous");
      }
      const identitySegment = decodePercent
        ? decoded
        : normalizeUrlPercent
          ? normalizeUrlPathSegment(segment)
          : segment;
      return hosted ? identitySegment.toLowerCase() : identitySegment;
    });
  if (hosted && segments.length > 0) {
    segments[segments.length - 1] = segments[segments.length - 1].replace(
      /\.git$/iu,
      "",
    );
  }
  if (!segments.at(-1) || segments.at(-1) === "." || segments.at(-1) === "..") {
    throw invalid("repository path is invalid");
  }
  if (host === "github.com" && segments.length !== 2) {
    throw invalid("GitHub repository identity must be owner/repo");
  }
  if (host === "gitlab.com" && segments.length < 2) {
    throw invalid("GitLab repository identity must include namespace/repo");
  }
  if (segments.length < 1) throw invalid("repository path is invalid");
  return segments;
}

function repositoryIdentity({
  scheme,
  host,
  port = "",
  rawPath,
  query = "",
  principal = null,
  pathMode = "absolute",
  decodePercent = true,
  normalizeUrlPercent = false,
  ref = null,
  subpath = null,
}) {
  const normalizedHost = normalizeHost(host);
  const normalizedPort = normalizePort(scheme, port);
  const authority = formatAuthority(normalizedHost, normalizedPort);
  const segments = decodeRepoSegments(normalizedHost, rawPath, {
    decodePercent,
    normalizeUrlPercent,
  });
  const kind =
    normalizedHost === "github.com"
      ? "github"
      : normalizedHost === "gitlab.com"
        ? "gitlab"
        : "git";
  const repoPath = segments.join("/");
  const principalDigest = principal ? sha256(principal) : null;
  const principalLabel = principalDigest
    ? `[principal:${principalDigest}]@`
    : "";
  const canonicalPathMode =
    normalizedHost === "github.com" || normalizedHost === "gitlab.com"
      ? "absolute"
      : pathMode;
  const canonical = JSON.stringify({
    kind: "git",
    scheme,
    authority,
    principal,
    pathMode: canonicalPathMode,
    repoPath,
    query,
  });
  return {
    kind,
    key: `${kind}:${scheme}://${principalLabel}${authority}/${canonicalPathMode === "relative" ? "[relative]/" : ""}${repoPath.replace(/\?.*$/u, "?[REDACTED]")}${query ? "?[REDACTED]" : ""}`,
    identityDigest: sha256(canonical),
    scheme,
    authority,
    host: normalizedHost,
    port: normalizedPort || null,
    owner: kind === "github" ? segments[0] : null,
    principalDigest,
    pathMode: canonicalPathMode,
    ref,
    path: subpath,
  };
}

function ownerWildcard(raw, { ref = null, path: subpath = null } = {}) {
  if (ref != null || subpath != null) {
    throw invalid("GitHub owner wildcards cannot include ref or path");
  }
  const match = /^([^/]+)\/\*$/u.exec(raw);
  if (!match || !OWNER_RE.test(match[1])) {
    throw invalid(`invalid GitHub owner wildcard ${JSON.stringify(raw)}`);
  }
  const owner = match[1].toLowerCase();
  return {
    kind: "github-owner",
    key: `github-owner:${owner}/*`,
    scheme: null,
    authority: "github.com",
    host: "github.com",
    port: null,
    owner,
    ref: null,
    path: null,
  };
}

function parsedUrl(raw, { stripCredentials = true } = {}) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw invalid("source URL is invalid");
  }
  if (stripCredentials) {
    url.username = "";
    url.password = "";
  }
  url.hash = "";
  return url;
}

function assertRawUrlPathUnambiguous(raw) {
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(\/[^?#]*)?/iu.exec(raw);
  const rawPath = match?.[1] || "/";
  for (const segment of rawPath.split("/")) {
    if (!segment) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw invalid("repository path has invalid percent encoding");
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      /[\\/]/u.test(decoded) ||
      CONTROL_RE.test(decoded)
    ) {
      throw invalid("repository path is ambiguous");
    }
  }
}

function urlAuthority(url) {
  const host = normalizeHost(url.hostname);
  return {
    host,
    port: url.port || "",
    authority: formatAuthority(host, url.port || ""),
  };
}

function exactUrl(raw, subpath = null) {
  assertRawUrlPathUnambiguous(raw);
  const url = parsedUrl(raw, { stripCredentials: false });
  if (!url.hostname || !["http:", "https:"].includes(url.protocol)) {
    throw invalid("URL marketplace source must use http(s)");
  }
  if (url.username || url.password) {
    throw invalid("URL marketplace credentials are not supported");
  }
  const { host, port, authority } = urlAuthority(url);
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  const pathname = normalizeUrlPathname(url.pathname);
  const canonical = `url:${scheme}://${authority}${pathname}${url.search}`;
  return {
    kind: "url",
    key: `url:${scheme}://${authority}${pathname}${url.search ? "?[REDACTED]" : ""}`,
    identityDigest: createHash("sha256").update(canonical).digest("hex"),
    scheme,
    authority,
    host,
    port: port || null,
    owner: null,
    ref: null,
    path: subpath,
  };
}

function fileUrlIdentity(url, ref, subpath) {
  if (url.search) throw invalid("file URL query parameters are not supported");
  const host = url.hostname ? normalizeHost(url.hostname) : "";
  const authority = host ? formatAuthority(host, url.port || "") : "";
  let localPath;
  try {
    localPath = fileURLToPath(url);
  } catch {
    throw invalid("file URL path is invalid");
  }
  const normalizedPath = normalizeLocalIdentityPath(localPath);
  const canonical = `file://${authority}${normalizedPath}`;
  return {
    kind: "file-url",
    key: `file://${authority}${normalizedPath.replace(/\\/gu, "/")}`,
    identityDigest: createHash("sha256").update(canonical).digest("hex"),
    scheme: "file",
    authority,
    host: host || null,
    port: url.port || null,
    owner: null,
    ref,
    path: subpath,
  };
}

function fromGitLocation(raw, ref, subpath) {
  const scp = SCP_RE.exec(raw);
  if (scp && !raw.includes("://") && !/^[a-z]:[\\/]/iu.test(raw)) {
    if (!scp[1]) {
      throw invalid("SSH Git sources require an explicit principal");
    }
    const host = normalizeHost(scp[2]);
    return repositoryIdentity({
      scheme: "ssh",
      host,
      rawPath: scp[3],
      principal: normalizeSshPrincipal(scp[1], { decodePercent: false }),
      pathMode: scp[3].startsWith("/") ? "absolute" : "relative",
      decodePercent: false,
      ref,
      subpath,
    });
  }
  assertRawUrlPathUnambiguous(raw);
  const url = parsedUrl(raw, { stripCredentials: false });
  if (!SUPPORTED_GIT_SCHEMES.has(url.protocol)) {
    throw invalid("git source URL uses an unsupported protocol");
  }
  if (url.protocol === "file:") {
    return fileUrlIdentity(url, ref, subpath);
  }
  if (!url.hostname) throw invalid("source URL has no host");
  if (url.protocol === "ssh:" && !url.username) {
    throw invalid("SSH Git sources require an explicit principal");
  }
  const { host, port } = urlAuthority(url);
  return repositoryIdentity({
    scheme: url.protocol.slice(0, -1).toLowerCase(),
    host,
    port,
    rawPath: url.pathname,
    query: url.search,
    pathMode: "absolute",
    // Git transports percent-decode URL path segments before handing the
    // repository path to upload-pack. Decode every validated segment here so
    // reserved spellings such as `%3A` cannot bypass an exact source rule.
    decodePercent: true,
    principal:
      url.protocol === "ssh:" ? normalizeSshPrincipal(url.username) : null,
    ref,
    subpath,
  });
}

function fromPath(raw, ref, subpath, cwd = process.cwd()) {
  const absolute = path.resolve(cwd, normalizePluginLocalSourcePath(raw));
  const normalized = normalizeLocalIdentityPath(absolute);
  return {
    kind: "path",
    key: `path:${normalized.replace(/\\/gu, "/")}`,
    scheme: null,
    authority: null,
    host: null,
    port: null,
    owner: null,
    ref,
    path: subpath,
  };
}

function expandWindowsShortNameAncestors(value) {
  let ancestor = path.normalize(value);
  const suffix = [];
  while (true) {
    try {
      return path.join(fs.realpathSync.native(ancestor), ...suffix);
    } catch {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        throw invalid(
          "Windows short-name and trailing-dot/space path aliases are not supported",
        );
      }
      suffix.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

function normalizeLocalIdentityPath(value) {
  const raw = String(value);
  if (
    process.platform === "win32" &&
    (/^\\\\\?\\/u.test(raw) || /^\\\?\?\\/u.test(raw))
  ) {
    throw invalid("Windows extended namespace paths are not supported");
  }
  let identityPath = raw;
  if (process.platform === "win32") {
    const segments = raw.replace(/^[a-z]:/iu, "").split(/[\\/]/u);
    if (segments.some((segment) => /[ .]$/u.test(segment))) {
      throw invalid(
        "Windows short-name and trailing-dot/space path aliases are not supported",
      );
    }
    if (segments.some((segment) => /~[0-9]+(?:\.[^.]*)?$/iu.test(segment))) {
      // Hosted Windows runners and some managed profiles expose TEMP through
      // a legitimate 8.3 parent (for example RUNNER~1). Resolve the longest
      // existing ancestor and rebuild any not-yet-created safe suffix from its
      // long spelling. An alias in a nonexistent suffix remains visible below
      // and fails closed, while real aliases cannot mint a second authority.
      identityPath = expandWindowsShortNameAncestors(raw);
      const resolvedSegments = identityPath
        .replace(/^[a-z]:/iu, "")
        .split(/[\\/]/u);
      if (
        resolvedSegments.some(
          (segment) =>
            /~[0-9]+(?:\.[^.]*)?$/iu.test(segment) || /[ .]$/u.test(segment),
        )
      ) {
        throw invalid(
          "Windows short-name and trailing-dot/space path aliases are not supported",
        );
      }
    }
  }
  const normalized = path.normalize(identityPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** Exact local-path spelling shared by policy identity and materialization. */
export function normalizePluginLocalSourcePath(raw) {
  if (typeof raw !== "string") throw invalid("source path must be a string");
  if (raw !== raw.trim()) {
    throw invalid("source path cannot have leading or trailing whitespace");
  }
  return clean(raw, "source path");
}

function fromString(
  raw,
  { policyEntry = false, cwd, ref, path: subpath, kindHint = null } = {},
) {
  if (kindHint === "url" || kindHint === "registry") {
    return exactUrl(clean(raw), subpath ?? null);
  }
  if (kindHint === "directory" || kindHint === "file") {
    return fromPath(raw, ref ?? null, subpath ?? null, cwd);
  }
  const cleaned = clean(raw);
  if (cleaned.includes("*")) {
    if (policyEntry && /^[^/]+\/\*$/u.test(cleaned)) {
      return ownerWildcard(cleaned, { ref, path: subpath });
    }
    throw invalid("only a GitHub owner/* source wildcard is supported");
  }
  const git = parsePluginGitSource(cleaned);
  if (git) {
    if (ref != null && git.ref != null && ref !== git.ref) {
      throw invalid("git source ref conflicts with its URL fragment");
    }
    return fromGitLocation(git.url, ref ?? git.ref, subpath ?? null);
  }
  if (kindHint === "git") throw invalid("git source locator is invalid");
  if (isExplicitPath(cleaned)) {
    return fromPath(cleaned, ref ?? null, subpath ?? null, cwd);
  }
  return {
    kind: "name",
    // Opaque legacy marketplace identifiers keep exact-string semantics.
    key: `name:${cleaned}`,
    scheme: null,
    authority: null,
    host: null,
    port: null,
    owner: null,
    ref: ref ?? null,
    path: subpath ?? null,
  };
}

/** The one parser used by both install materialization and managed policy. */
export function parsePluginGitSource(raw) {
  if (raw == null) return null;
  if (typeof raw !== "string") throw invalid("source must be a string");
  if (!raw.trim()) return null;
  if (isExplicitPath(raw.trim())) return null;
  const { locator, ref } = splitRef(raw);
  if (/^(?:https?|git|ssh|file):\/\//iu.test(locator)) {
    return { url: locator, ref };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(locator)) {
    throw invalid("git source URL uses an unsupported protocol");
  }
  if (
    SCP_RE.test(locator) &&
    !locator.includes("://") &&
    !/^[a-z]:[\\/]/iu.test(locator)
  ) {
    return { url: locator, ref };
  }
  const hosted = /^(github\.com|gitlab\.com)\/(.+)$/iu.exec(locator);
  if (hosted) {
    const segments = hosted[2].split("/");
    if (segments.length < 2) return null;
    if (hosted[1].toLowerCase() === "github.com" && segments.length !== 2) {
      return null;
    }
    return {
      url: `https://${hosted[1].toLowerCase()}/${hosted[2].replace(/\.git$/iu, "")}.git`,
      ref,
    };
  }
  if (/^[\w.-]+\/[\w.-]+$/u.test(locator)) {
    return { url: `https://github.com/${locator}.git`, ref };
  }
  if (locator.endsWith(".git")) return { url: locator, ref };
  return null;
}

/**
 * Reject Git locators whose eventual transport cannot be bound to the policy
 * identity. Query credentials and HTTP userinfo would otherwise be exposed in
 * argv/process listings, while a bare `repo.git` can be reinterpreted as a
 * cwd-relative repository by Git. Registry entries additionally forbid file
 * URLs because a remote catalog must not grant access to local bytes.
 */
export function assertPluginGitTransportSafe(
  git,
  { allowFile = true, requireRemote = false } = {},
) {
  if (!git || typeof git.url !== "string") {
    throw invalid("git source locator is invalid");
  }
  const locator = clean(git.url, "git source locator");
  if (locator.includes("?")) {
    throw invalid("git source query credentials are not supported");
  }
  if (locator.includes("://")) {
    const url = parsedUrl(locator, { stripCredentials: false });
    if (!SUPPORTED_GIT_SCHEMES.has(url.protocol)) {
      throw invalid("git source URL uses an unsupported protocol");
    }
    if (url.protocol === "file:" && !allowFile) {
      throw invalid("registry git sources cannot use file URLs");
    }
    if (
      url.protocol !== "ssh:" &&
      (url.username !== "" || url.password !== "")
    ) {
      throw invalid("git source URL credentials are not supported");
    }
    if (url.password !== "") {
      throw invalid("git source URL passwords are not supported");
    }
    if (requireRemote && url.protocol === "file:") {
      throw invalid("registry git sources must be remote repositories");
    }
    return git;
  }
  if (
    SCP_RE.test(locator) &&
    !/^[a-z]:[\\/]/iu.test(locator) &&
    !locator.includes("#")
  ) {
    return git;
  }
  if (requireRemote) {
    throw invalid("registry git sources must use a remote repository locator");
  }
  return git;
}

/** Safe diagnostic projection: never prints URL credentials, query, or ref. */
export function redactPluginSourceForDisplay(raw) {
  const value = String(raw ?? "")
    .replace(CONTROL_GLOBAL_RE, "")
    .trim();
  try {
    const url = new URL(value);
    const { authority } = urlAuthority(url);
    return `${url.protocol}//${authority}${url.pathname}${url.search ? "?[REDACTED]" : ""}`;
  } catch {
    const hash = value.indexOf("#");
    const query = value.indexOf("?");
    const cut = [hash, query]
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    const locator = (cut == null ? value : value.slice(0, cut)).replace(
      /^([a-z][a-z0-9+.-]*:\/\/)(?:[^/@\s]+@)/iu,
      "$1[REDACTED]@",
    );
    const redactedLocator = locator.replace(
      /^(?:[^@\s/:]+@)(\[[^\]]+\]|[^\s/:]+):/u,
      "[REDACTED]@$1:",
    );
    if (cut == null) return redactedLocator;
    return `${redactedLocator}${cut === query ? "?[REDACTED]" : "#[REDACTED]"}`;
  }
}

export function canonicalizePluginSource(source, options = {}) {
  if (typeof source === "string") return fromString(source, options);
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw invalid("source entry must be a string or object");
  }
  if (source.source && typeof source.source === "object") {
    if (Object.keys(source).some((key) => key !== "source")) {
      throw invalid("nested source wrappers cannot add outer constraints");
    }
    return canonicalizePluginSource(source.source, options);
  }
  const knownFields = new Set([
    "source",
    "type",
    "url",
    "registry",
    "repo",
    "name",
    "ref",
    "path",
    "hostPattern",
    "pathPattern",
  ]);
  const unknownField = Object.keys(source).find(
    (field) => !knownFields.has(field),
  );
  if (unknownField) {
    throw invalid(`unsupported marketplace source field ${unknownField}`);
  }
  if (source.hostPattern != null || source.pathPattern != null) {
    throw invalid("unsupported marketplace source pattern");
  }
  if (source.type != null && !SOURCE_KINDS.has(source.type)) {
    throw invalid(`unsupported marketplace source kind ${source.type}`);
  }
  const kind = SOURCE_KINDS.has(source.type)
    ? source.type
    : SOURCE_KINDS.has(source.source)
      ? source.source
      : null;
  if (
    SOURCE_KINDS.has(source.type) &&
    SOURCE_KINDS.has(source.source) &&
    source.type !== source.source
  ) {
    throw invalid("marketplace source kind declarations conflict");
  }
  const locatorFields = ["url", "registry", "repo", "name"].filter(
    (field) => source[field] != null,
  );
  if (locatorFields.length > 1) {
    throw invalid("marketplace source has conflicting locator fields");
  }
  if (
    ["directory", "file"].includes(kind) &&
    source.path != null &&
    source.url != null
  ) {
    throw invalid("local marketplace source has conflicting path fields");
  }
  if (
    !kind &&
    typeof source.source === "string" &&
    ["url", "repo", "path", "registry", "package"].some((field) =>
      Object.prototype.hasOwnProperty.call(source, field),
    )
  ) {
    throw invalid(`unsupported marketplace source kind ${source.source}`);
  }
  const constraints = {
    ...options,
    ref: source.ref == null ? undefined : clean(source.ref, "ref", 256),
    path: source.path == null ? undefined : clean(source.path, "subpath", 1024),
  };
  if (kind === "github") {
    const value = clean(source.repo, "GitHub repo");
    if (value.includes("*")) {
      if (options.policyEntry && /^[^/]+\/\*$/u.test(value)) {
        return ownerWildcard(value, constraints);
      }
      throw invalid("GitHub source wildcards must use owner/*");
    }
    return repositoryIdentity({
      scheme: "https",
      host: "github.com",
      rawPath: value,
      ref: constraints.ref ?? null,
      subpath: constraints.path ?? null,
    });
  }
  if (["directory", "file"].includes(kind)) {
    return fromPath(
      source.path ?? source.url,
      constraints.ref,
      null,
      options.cwd,
    );
  }
  const locator =
    source.url ??
    source.registry ??
    (source.source !== kind ? source.source : undefined) ??
    source.repo ??
    source.name;
  if (kind === "url" || kind === "registry") {
    if (constraints.ref != null) {
      throw invalid("URL marketplace sources cannot include a git ref");
    }
    return exactUrl(locator, constraints.path ?? null);
  }
  return fromString(locator, {
    ...constraints,
    kindHint: kind === "git" ? "git" : constraints.kindHint,
  });
}
