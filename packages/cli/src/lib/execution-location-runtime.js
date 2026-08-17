import fs from "node:fs";
import path from "node:path";
import { VERSION } from "../constants.js";
import { createExecutionLocationBinding } from "./execution-location-contract.js";
import { detectAmbientLocation } from "./execution-location.js";

const LOCATION_SIGNAL_NAMES = Object.freeze([
  "CODESPACES",
  "GITHUB_CODESPACE_TOKEN",
  "SSH_CONNECTION",
  "SSH_CLIENT",
  "SSH_TTY",
  "container",
  "KUBERNETES_SERVICE_HOST",
  "WSL_DISTRO_NAME",
  "WSL_INTEROP",
]);

function readSmallUtf8(runtimeFs, filePath, maxBytes = 4096) {
  try {
    const stat = runtimeFs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
      return null;
    }
    return runtimeFs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function resolveGitDirectory(runtimeFs, markerPath) {
  try {
    const stat = runtimeFs.lstatSync(markerPath);
    if (stat.isSymbolicLink()) return null;
    if (stat.isDirectory()) return markerPath;
    if (!stat.isFile() || stat.size > 4096) return null;
    const marker = runtimeFs.readFileSync(markerPath, "utf8").trim();
    const match = /^gitdir:\s*(.+)$/iu.exec(marker);
    return match ? path.resolve(path.dirname(markerPath), match[1]) : null;
  } catch {
    return null;
  }
}

function discoverGit(runtimeFs, cwd) {
  let cursor = path.resolve(cwd);
  while (true) {
    const marker = path.join(cursor, ".git");
    const gitDirectory = resolveGitDirectory(runtimeFs, marker);
    if (gitDirectory) {
      const rawHead = readSmallUtf8(
        runtimeFs,
        path.join(gitDirectory, "HEAD"),
        1024,
      )?.trim();
      let head = null;
      let commit = null;
      if (rawHead && /^[a-f0-9]{40,64}$/iu.test(rawHead)) {
        head = "detached";
        commit = rawHead.toLowerCase();
      } else {
        const match = /^ref:\s*(refs\/[A-Za-z0-9._/-]+)$/u.exec(rawHead || "");
        if (match && !match[1].includes("..")) {
          head = match[1];
          const loose = readSmallUtf8(
            runtimeFs,
            path.join(gitDirectory, ...match[1].split("/")),
            256,
          )?.trim();
          if (loose && /^[a-f0-9]{40,64}$/iu.test(loose)) {
            commit = loose.toLowerCase();
          }
        }
      }
      return { root: cursor, head, commit };
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return { root: null, head: null, commit: null };
    cursor = parent;
  }
}

export function captureAmbientExecutionLocation(options = {}, deps = {}) {
  const runtimeFs = deps.fs || fs;
  const env = deps.env || process.env;
  const cwd = path.resolve(deps.cwd ? deps.cwd() : process.cwd());
  const dockerEnvFileExists = (() => {
    try {
      return runtimeFs.existsSync("/.dockerenv");
    } catch {
      return false;
    }
  })();
  const location = detectAmbientLocation({ env, dockerEnvFileExists });
  const git = discoverGit(runtimeFs, cwd);
  const signals = LOCATION_SIGNAL_NAMES.filter(
    (name) => typeof env[name] === "string" && env[name].trim() !== "",
  );
  const observedAt = deps.now ? deps.now() : new Date().toISOString();
  return createExecutionLocationBinding({
    location,
    observedAt,
    observed: true,
    signals,
    source: { cwd, git },
    runtime: {
      platform: deps.platform || process.platform,
      arch: deps.arch || process.arch,
      nodeVersion: deps.nodeVersion || process.version,
      cliVersion: deps.cliVersion || VERSION,
      tools: ["chainlesschain-cli", "node"],
    },
    model: {
      provider: options.provider,
      name: options.model,
      credentialSource: options.credentialSource || "not-observed",
    },
    credentials: options.credentials,
    permissions: {
      status: options.permissions ? "declared" : "not-observed",
      ...(options.permissions || {}),
    },
    policy: {
      network: options.networkPolicy || "unknown",
      sandbox: options.sandboxStrength || "unknown",
      dataBoundary: {
        kind: git.root ? "repository" : "working-directory",
        root: git.root || cwd,
      },
    },
  });
}
