const dns = require("node:dns");
const net = require("node:net");

function isForbiddenAddress(address) {
  const normalized = String(address || "")
    .toLowerCase()
    .split("%")[0];
  if (net.isIPv4(normalized)) {
    const parts = normalized.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(normalized)) {
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isForbiddenAddress(mapped[1]) : false;
  }
  return true;
}

function domainAllowed(hostname, allowedDomains) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/\.$/, "");
  return (allowedDomains || []).some((entry) => {
    const allowed = String(entry || "")
      .toLowerCase()
      .replace(/\.$/, "");
    if (allowed.startsWith("*.")) {
      const suffix = allowed.slice(1);
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === allowed;
  });
}

function createValidatedLookup({
  allowedDomains,
  allowPrivateNetwork,
  lookup,
}) {
  const resolve = lookup || dns.lookup;
  return (hostname, options, callback) => {
    const requestedOptions = typeof options === "object" ? options : {};
    const wantsAll = requestedOptions.all === true;
    const queryOptions = { ...requestedOptions, all: true };
    resolve(hostname, queryOptions, (error, records) => {
      if (error) return callback(error);
      const list = Array.isArray(records) ? records : [records];
      const approved = list.filter(
        (record) => allowPrivateNetwork || !isForbiddenAddress(record.address),
      );
      if (approved.length !== list.length || approved.length === 0) {
        const denied = new Error(`MCP egress address denied for ${hostname}`);
        denied.code = "MCP_EGRESS_ADDRESS_DENIED";
        return callback(denied);
      }
      const first = approved[0];
      if (wantsAll) return callback(null, approved);
      return callback(null, first.address, first.family);
    });
  };
}

async function validateMcpEgress(serverConfig, deps = {}) {
  let url;
  try {
    url = new URL(serverConfig?.baseURL || serverConfig?.url);
  } catch {
    const error = new Error("MCP HTTP transport requires a valid URL");
    error.code = "MCP_EGRESS_URL_INVALID";
    throw error;
  }
  if (
    url.protocol !== "https:" &&
    serverConfig?.permissions?.allowInsecureHttp !== true
  ) {
    const error = new Error("MCP HTTP egress requires HTTPS");
    error.code = "MCP_EGRESS_HTTPS_REQUIRED";
    throw error;
  }
  const allowedDomains = serverConfig?.permissions?.allowedDomains || [];
  if (!domainAllowed(url.hostname, allowedDomains)) {
    const error = new Error(
      `MCP egress domain is not allowlisted: ${url.hostname}`,
    );
    error.code = "MCP_EGRESS_DOMAIN_DENIED";
    throw error;
  }
  const allowPrivateNetwork =
    serverConfig?.permissions?.allowPrivateNetwork === true;
  const validatedLookup = createValidatedLookup({
    allowedDomains,
    allowPrivateNetwork,
    lookup: deps.lookup,
  });
  await new Promise((resolve, reject) => {
    validatedLookup(url.hostname, { all: true }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
  return { url, lookup: validatedLookup };
}

module.exports = {
  createValidatedLookup,
  domainAllowed,
  isForbiddenAddress,
  validateMcpEgress,
};
