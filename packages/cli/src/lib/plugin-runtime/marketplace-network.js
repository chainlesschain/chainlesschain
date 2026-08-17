import crypto from "node:crypto";
import fs from "node:fs";
import tls from "node:tls";
import { Worker } from "node:worker_threads";
import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";

export const MAX_MARKETPLACE_CA_BUNDLE_BYTES = 1024 * 1024;
export const MAX_MARKETPLACE_PROXY_URL_LENGTH = 4096;
export const MAX_MARKETPLACE_PAC_BYTES = 256 * 1024;
export const DEFAULT_MARKETPLACE_PAC_TIMEOUT_MS = 2_000;

/**
 * Build a request-scoped Undici dispatcher for an explicit Marketplace proxy,
 * bounded local PAC file, and/or custom CA bundle. Ambient proxy variables are
 * deliberately ignored: callers pass CLI flags or CC_PLUGIN_REGISTRY_* values.
 */
export function createMarketplaceNetworkTransport(options = {}) {
  const proxy = normalizeProxyUrl(options.proxyUrl);
  const pac = options.pacFile ? readMarketplacePacFile(options.pacFile) : null;
  if (proxy && pac) {
    throw new Error(
      "Marketplace proxy URL and PAC file are mutually exclusive",
    );
  }
  const customCa = options.caFile
    ? readMarketplaceCaBundle(options.caFile)
    : null;
  if (!proxy && !pac && !customCa) return null;

  const ca = customCa ? [...tls.rootCertificates, customCa.pem] : undefined;
  const tlsOptions = ca ? { ca } : undefined;
  const dispatchers = new Map();
  const dispatcherFor = (route) => {
    const key = route?.url || "DIRECT";
    if (dispatchers.has(key)) return dispatchers.get(key);
    const dispatcher = route
      ? new ProxyAgent({
          uri: route.url,
          ...(route.authorization ? { token: route.authorization } : {}),
          ...(tlsOptions
            ? { requestTls: tlsOptions, proxyTls: tlsOptions }
            : {}),
        })
      : new Agent(tlsOptions ? { connect: tlsOptions } : {});
    dispatchers.set(key, dispatcher);
    return dispatcher;
  };
  if (!pac) dispatcherFor(proxy);

  return {
    fetch: async (url, fetchOptions = {}) => {
      const route = pac
        ? parsePacResult(
            await resolveMarketplacePac(pac.script, url, {
              timeoutMs: options.pacTimeoutMs,
            }),
          )
        : proxy;
      return undiciFetch(url, {
        ...fetchOptions,
        dispatcher: dispatcherFor(route),
      });
    },
    authority: {
      mode: pac ? "pac" : proxy ? "explicit-proxy" : "direct-custom-ca",
      ...(proxy ? { proxyOrigin: proxy.origin } : {}),
      ...(pac ? { pacSha256: pac.sha256 } : {}),
      ...(customCa ? { customCaSha256: customCa.sha256 } : {}),
    },
    close: async () => {
      await Promise.all(
        [...dispatchers.values()].map((dispatcher) => dispatcher.close()),
      );
    },
  };
}

export function readMarketplacePacFile(file) {
  const bytes = readSingleLinkFile(file, {
    maxBytes: MAX_MARKETPLACE_PAC_BYTES,
    label: "Marketplace PAC file",
  });
  let script;
  try {
    script = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(
      "Marketplace PAC file rejected: content is not valid UTF-8",
    );
  }
  if (!/\bFindProxyForURL\s*\(/u.test(script)) {
    throw new Error(
      "Marketplace PAC file rejected: FindProxyForURL is missing",
    );
  }
  return {
    script,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

export function resolveMarketplacePac(
  script,
  url,
  { timeoutMs = DEFAULT_MARKETPLACE_PAC_TIMEOUT_MS } = {},
) {
  const timeout = Number(timeoutMs);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 10_000) {
    throw new Error("Marketplace PAC timeout must be between 100 and 10000 ms");
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./marketplace-pac-worker.js", import.meta.url),
      {
        workerData: { script, url: String(url) },
        resourceLimits: {
          maxOldGenerationSizeMb: 32,
          maxYoungGenerationSizeMb: 8,
          stackSizeMb: 2,
        },
      },
    );
    let settled = false;
    let timer;
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    timer = setTimeout(() => {
      settle(() => {
        void worker.terminate();
        reject(new Error(`Marketplace PAC resolution exceeded ${timeout} ms`));
      });
    }, timeout);
    worker.once("message", (message) => {
      settle(() => {
        void worker.terminate();
        if (message?.ok && typeof message.result === "string") {
          resolve(message.result);
        } else {
          reject(
            new Error(
              `Marketplace PAC resolution failed: ${String(message?.error || "invalid worker response").slice(0, 2048)}`,
            ),
          );
        }
      });
    });
    worker.once("error", (error) => {
      settle(() =>
        reject(new Error(`Marketplace PAC worker failed: ${error.message}`)),
      );
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        settle(() =>
          reject(new Error(`Marketplace PAC worker exited with code ${code}`)),
        );
      }
    });
  });
}

export function parsePacResult(value) {
  for (const raw of String(value || "").split(";")) {
    const directive = raw.trim();
    if (!directive) continue;
    if (directive.toUpperCase() === "DIRECT") return null;
    const match = /^(PROXY|HTTP|HTTPS)\s+([^\s]+)$/iu.exec(directive);
    if (!match) continue;
    const protocol = match[1].toUpperCase() === "HTTPS" ? "https" : "http";
    return normalizeProxyUrl(`${protocol}://${match[2]}`);
  }
  throw new Error(
    "Marketplace PAC returned no supported PROXY/HTTPS/DIRECT route",
  );
}

export function normalizeMarketplaceNetworkAuthority(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Marketplace network authority must be an object");
  }
  const mode = value.mode;
  if (!["explicit-proxy", "pac", "direct-custom-ca"].includes(mode)) {
    throw new Error("Marketplace network authority mode is invalid");
  }
  const proxy = value.proxyOrigin ? normalizeProxyUrl(value.proxyOrigin) : null;
  if (proxy?.authorization) {
    throw new Error(
      "Marketplace network authority must not retain credentials",
    );
  }
  const pacSha256 = normalizeAuthoritySha256(value.pacSha256, "PAC");
  const customCaSha256 = normalizeAuthoritySha256(
    value.customCaSha256,
    "custom CA",
  );
  if (mode === "explicit-proxy" && (!proxy || pacSha256)) {
    throw new Error("Marketplace explicit proxy authority is inconsistent");
  }
  if (mode === "pac" && (!pacSha256 || proxy)) {
    throw new Error("Marketplace PAC authority is inconsistent");
  }
  if (mode === "direct-custom-ca" && (!customCaSha256 || proxy || pacSha256)) {
    throw new Error("Marketplace custom CA authority is inconsistent");
  }
  const normalized = {
    mode,
    ...(proxy ? { proxyOrigin: proxy.origin } : {}),
    ...(pacSha256 ? { pacSha256 } : {}),
    ...(customCaSha256 ? { customCaSha256 } : {}),
  };
  if (
    Object.keys(value).sort().join("\0") !==
    Object.keys(normalized).sort().join("\0")
  ) {
    throw new Error("Marketplace network authority contains unknown fields");
  }
  return normalized;
}

function normalizeAuthoritySha256(value, label) {
  if (value == null || value === "") return null;
  const digest = String(value);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`Marketplace ${label} authority digest is invalid`);
  }
  return digest;
}

export function readMarketplaceCaBundle(file) {
  try {
    const bytes = readSingleLinkFile(file, {
      maxBytes: MAX_MARKETPLACE_CA_BUNDLE_BYTES,
      label: "Marketplace CA bundle",
    });
    const pem = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    tls.createSecureContext({ ca: [...tls.rootCertificates, pem] });
    return {
      pem,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    throw new Error(`Marketplace CA bundle rejected: ${error.message}`);
  }
}

function readSingleLinkFile(file, { maxBytes, label }) {
  const filePath = String(file || "");
  let descriptor = null;
  try {
    const linkStat = fs.lstatSync(filePath);
    if (
      !linkStat.isFile() ||
      linkStat.isSymbolicLink() ||
      linkStat.nlink !== 1 ||
      linkStat.size <= 0 ||
      linkStat.size > maxBytes
    ) {
      throw new Error(
        `${label} must be a non-empty single-link regular file under ${maxBytes} bytes`,
      );
    }
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const fileStat = fs.fstatSync(descriptor);
    if (
      !fileStat.isFile() ||
      fileStat.nlink !== 1 ||
      fileStat.size !== linkStat.size ||
      fileStat.size > maxBytes
    ) {
      throw new Error(`${label} changed during inspection`);
    }
    return fs.readFileSync(descriptor);
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
  }
}

export function normalizeProxyUrl(value) {
  if (value == null || value === "") return null;
  const raw = String(value);
  if (raw.length > MAX_MARKETPLACE_PROXY_URL_LENGTH) {
    throw new Error("Marketplace proxy URL is too long");
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Marketplace proxy URL is invalid");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Marketplace proxy URL must use HTTP or HTTPS");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Marketplace proxy URL must contain only an origin");
  }
  let authorization = null;
  if (parsed.username || parsed.password) {
    authorization = `Basic ${Buffer.from(
      `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`,
    ).toString("base64")}`;
    parsed.username = "";
    parsed.password = "";
  }
  return {
    url: parsed.origin,
    origin: parsed.origin,
    authorization,
  };
}
