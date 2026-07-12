/**
 * Remote URI ↔ filesystem path mapping for the IDE bridge.
 *
 * A local IDE (VS Code / JetBrains) can report a file in a representation that
 * does not exist on the host `cc` runs on, so inlining it into the prompt makes
 * the agent's read_file/edit_file target a path the CLI host can't see:
 *   - a URI:  file:///c:/code/my%20proj/文件.ts
 *             vscode-remote://wsl+Ubuntu/home/u/x
 *             vscode-remote://ssh-remote+host/home/u/x
 *             vscode-remote://dev-container+<hex>/workspaces/x
 *   - a WSL UNC path from a Windows host: \\wsl.localhost\Ubuntu\home\u\x
 *     (older Windows builds: \\wsl$\Ubuntu\home\u\x)
 *   - a Windows drive path while cc runs INSIDE WSL: C:\code\x  ==  /mnt/c/code/x
 *
 * normalizeIdePathForCli() folds these foreign forms into the CLI's native fs
 * path; anything already native (or unrecognized) passes through byte-for-byte.
 * cliPathToIdeUri() is the reverse, for surfaces that must hand a URI back to
 * the editor.
 *
 * Pure: string transforms only (no fs / process). Percent-decoding preserves
 * spaces and non-ASCII (中文) exactly, so round-trips are lossless.
 */

/** decodeURIComponent that never throws on a malformed % sequence. */
function decodeSafe(s) {
  if (typeof s !== "string") return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // leave a malformed sequence as-is rather than lose the value
  }
}

/** Has a `scheme://` prefix (a URI, not a bare path). */
export function looksLikeUri(value) {
  return typeof value === "string" && /^[a-z][a-z0-9.+-]*:\/\//i.test(value);
}

/** `C:\…` or `C:/…` — a Windows drive-absolute path. */
export function looksLikeWindowsPath(value) {
  return typeof value === "string" && /^[a-zA-Z]:[\\/]/.test(value);
}

/** `\\host\…` or `//host/…` — a UNC path. */
function looksLikeUnc(value) {
  return typeof value === "string" && /^(\\\\|\/\/)[^\\/]/.test(value);
}

const WSL_UNC_RE =
  /^(?:\\\\|\/\/)(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)[\\/]?(.*)$/i;

/**
 * `\\wsl.localhost\Ubuntu\home\u\x` (or `\\wsl$\…`, forward-slash variants) →
 * `{ distro:"Ubuntu", posix:"/home/u/x" }`, or null when not a WSL UNC path.
 */
export function wslUncToPosix(value) {
  if (typeof value !== "string") return null;
  const m = value.match(WSL_UNC_RE);
  if (!m) return null;
  const distro = m[1];
  const rest = (m[2] || "").replace(/\\/g, "/");
  return { distro, posix: "/" + rest.replace(/^\/+/, "") };
}

/** `/home/u/x` + distro → `\\wsl.localhost\Ubuntu\home\u\x` (host overridable). */
export function posixToWslUnc(posix, distro, { host = "wsl.localhost" } = {}) {
  if (typeof posix !== "string" || !distro) return null;
  const win = posix.replace(/^\/+/, "").replace(/\//g, "\\");
  return `\\\\${host}\\${distro}\\${win}`;
}

/** `C:\code\x` → `/mnt/c/code/x`, or null when not a drive path. */
export function winDriveToWslMount(value) {
  if (!looksLikeWindowsPath(value)) return null;
  const drive = value[0].toLowerCase();
  const rest = value.slice(2).replace(/\\/g, "/").replace(/^\/+/, "");
  return `/mnt/${drive}${rest ? "/" + rest : ""}`;
}

const WSL_MOUNT_RE = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/;

/** `/mnt/c/code/x` → `C:\code\x`, or null when not a /mnt/<drive> path. */
export function wslMountToWinDrive(value) {
  if (typeof value !== "string") return null;
  const m = value.match(WSL_MOUNT_RE);
  if (!m) return null;
  const drive = m[1].toUpperCase();
  const rest = (m[2] || "").replace(/\//g, "\\");
  return `${drive}:\\${rest}`;
}

/**
 * Parse an IDE URI into its parts. Returns null for a non-URI or an unknown
 * scheme (so the caller leaves it untouched).
 *   { scheme, remoteKind, remoteParam, fsPath }
 * `fsPath` is the decoded on-host path: a Windows drive path for a `file://`
 * drive URI, else POSIX. `remoteKind`/`remoteParam` are set for vscode-remote.
 */
export function parseRemoteUri(uri) {
  if (!looksLikeUri(uri)) return null;
  const m = uri.match(/^([a-z][a-z0-9.+-]*):\/\/([^/]*)((?:\/[^?#]*)?)/i);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const authority = m[2] || "";
  const rawPath = m[3] || "";

  if (scheme === "file") {
    if (authority) {
      // file://server/share/… → UNC \\server\share\…
      const unc = "\\\\" + authority + rawPath.replace(/\//g, "\\");
      return {
        scheme,
        remoteKind: null,
        remoteParam: null,
        fsPath: decodeSafe(unc),
      };
    }
    const decoded = decodeSafe(rawPath);
    // /c:/code/x → c:\code\x  (Windows drive URI); else a POSIX path.
    if (/^\/[a-zA-Z]:/.test(decoded)) {
      return {
        scheme,
        remoteKind: null,
        remoteParam: null,
        fsPath: decoded.slice(1).replace(/\//g, "\\"),
      };
    }
    return {
      scheme,
      remoteKind: null,
      remoteParam: null,
      fsPath: decoded || "/",
    };
  }

  if (scheme === "vscode-remote" || scheme === "vscode-vfs") {
    // authority = "<kind>+<param>", where `+` may be percent-encoded (%2B).
    const auth = decodeSafe(authority);
    const plus = auth.indexOf("+");
    const remoteKind = plus >= 0 ? auth.slice(0, plus) : auth;
    const remoteParam = plus >= 0 ? auth.slice(plus + 1) : null;
    return {
      scheme,
      remoteKind: remoteKind || null,
      remoteParam: remoteParam || null,
      fsPath: decodeSafe(rawPath) || "/",
    };
  }

  return null; // unknown scheme — don't guess
}

/**
 * Detect the running CLI's WSL context from env (best-effort). Returns
 * `{ isWsl, distro }`. Injected in tests; ide-context passes process.env.
 */
export function detectWsl(env = {}) {
  const distro = env.WSL_DISTRO_NAME || null;
  const isWsl = Boolean(distro || env.WSL_INTEROP);
  return { isWsl, distro };
}

/**
 * Fold an IDE-reported file value into the path `cc` can actually open on THIS
 * host. Only recognized foreign forms are rewritten; a native or unrecognized
 * value is returned unchanged (byte-for-byte).
 *
 * @param {string} value  URI or path as the IDE reported it
 * @param {object} [opts]
 * @param {string} [opts.platform=process.platform]  the CLI host platform
 * @param {{isWsl?:boolean, distro?:string}} [opts.wsl]  WSL context (see detectWsl)
 * @returns {string}
 */
export function normalizeIdePathForCli(value, opts = {}) {
  if (typeof value !== "string" || value.length === 0) return value;
  const platform = opts.platform || process.platform;
  const wsl = opts.wsl || {};
  const onWindows = platform === "win32";

  // 1) Resolve a URI down to its on-host fsPath first.
  let base = value;
  let remoteKind = null;
  let remoteParam = null;
  if (looksLikeUri(value)) {
    const parsed = parseRemoteUri(value);
    if (!parsed) return value; // unknown scheme → leave untouched
    base = parsed.fsPath;
    remoteKind = parsed.remoteKind;
    remoteParam = parsed.remoteParam;
  }

  if (onWindows) {
    // Native form is a Windows path. A POSIX path from a wsl-remote URI is
    // reachable from Windows as a \\wsl.localhost\<distro>\… UNC.
    if (remoteKind === "wsl" && remoteParam && base.startsWith("/")) {
      return posixToWslUnc(base, remoteParam) || base;
    }
    return base;
  }

  // Native form is POSIX (Linux remote-host or inside WSL).
  const wslUnc = wslUncToPosix(base);
  if (wslUnc) return wslUnc.posix;
  if (looksLikeWindowsPath(base) && wsl.isWsl) {
    return winDriveToWslMount(base) || base;
  }
  return base;
}

/**
 * Reverse: a CLI-native fs path → a URI the editor can open. `remoteAuthority`
 * (e.g. "wsl+Ubuntu", "ssh-remote+host") produces a vscode-remote URI; without
 * it, a `file://` URI. Percent-encodes spaces / non-ASCII per component.
 */
export function cliPathToIdeUri(fsPath, { remoteAuthority } = {}) {
  if (typeof fsPath !== "string" || fsPath.length === 0) return fsPath;
  const isWinDrive = looksLikeWindowsPath(fsPath);
  const posixish = fsPath.replace(/\\/g, "/");
  const encoded = posixish
    .split("/")
    .map((seg) => (/^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join("/");
  if (remoteAuthority) {
    const path = encoded.startsWith("/") ? encoded : "/" + encoded;
    return `vscode-remote://${remoteAuthority}${path}`;
  }
  const path = isWinDrive ? "/" + encoded : encoded;
  return `file://${path.startsWith("/") ? "" : "/"}${path}`;
}
