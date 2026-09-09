import os from "node:os";
import path from "node:path";

const ENDPOINT_ID = /^[a-f0-9]{16,64}$/u;
const UNIX_SOCKET_MAX_BYTES = 100;
const UNIX_FALLBACK_DIRECTORY = "/tmp";

const DEFINITIONS = Object.freeze({
  external: Object.freeze({
    windowsPrefix: "cc-evolution-attestor-",
    unixPrefix: "cc-att-",
  }),
  "trust-operations": Object.freeze({
    windowsPrefix: "cc-evolution-attestor-trust-ops-",
    unixPrefix: "cc-ato-",
  }),
  "trust-approval": Object.freeze({
    windowsPrefix: "cc-evolution-attestor-trust-approval-",
    unixPrefix: "cc-atp-",
  }),
});

function definition(kind) {
  const selected = DEFINITIONS[kind];
  if (!selected) throw new TypeError("attestor IPC endpoint kind is invalid");
  return selected;
}

function validId(id) {
  if (!ENDPOINT_ID.test(id ?? "")) {
    throw new TypeError("attestor IPC endpoint id is invalid");
  }
  return id;
}

function unixSocketName(selected, id) {
  return `${selected.unixPrefix}${id}.sock`;
}

export function createGovernedSkillSynthesisAttestorIpcEndpoint({
  kind,
  id,
  platform = process.platform,
  temporaryDirectory = os.tmpdir(),
}) {
  const selected = definition(kind);
  const normalizedId = validId(id);
  if (platform === "win32") {
    return `\\\\.\\pipe\\${selected.windowsPrefix}${normalizedId}`;
  }
  const pathApi = path.posix;
  if (
    typeof temporaryDirectory !== "string" ||
    !pathApi.isAbsolute(temporaryDirectory) ||
    temporaryDirectory.includes("\0")
  ) {
    throw new TypeError("attestor IPC temporary directory is invalid");
  }
  const name = unixSocketName(selected, normalizedId);
  const preferred = pathApi.join(temporaryDirectory, name);
  if (Buffer.byteLength(preferred, "utf8") <= UNIX_SOCKET_MAX_BYTES) {
    return preferred;
  }
  const fallback = pathApi.join(UNIX_FALLBACK_DIRECTORY, name);
  if (Buffer.byteLength(fallback, "utf8") > UNIX_SOCKET_MAX_BYTES) {
    throw new TypeError("attestor IPC endpoint exceeds the Unix socket limit");
  }
  return fallback;
}

export function isGovernedSkillSynthesisAttestorIpcEndpoint(
  endpoint,
  { kind, platform = process.platform },
) {
  if (typeof endpoint !== "string" || endpoint.includes("\0")) return false;
  const selected = definition(kind);
  if (platform === "win32") {
    const prefix = `\\\\.\\pipe\\${selected.windowsPrefix}`;
    return (
      endpoint.startsWith(prefix) &&
      ENDPOINT_ID.test(endpoint.slice(prefix.length))
    );
  }
  return (
    path.posix.isAbsolute(endpoint) &&
    Buffer.byteLength(endpoint, "utf8") <= UNIX_SOCKET_MAX_BYTES &&
    new RegExp(`^${selected.unixPrefix}[a-f0-9]{16,64}\\.sock$`, "u").test(
      path.posix.basename(endpoint),
    )
  );
}

export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_UNIX_SOCKET_MAX_BYTES =
  UNIX_SOCKET_MAX_BYTES;
