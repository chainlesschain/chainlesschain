import crypto from "node:crypto";

/**
 * Materialized MCP capsules are JavaScript-only products. They do not admit
 * package-provided native addons: esbuild emits one CJS file, retains only
 * Node builtins as externals, and the immutable capsule prelude replaces
 * process.dlopen before package code runs. Platform runtime libraries and V8's
 * own executable memory remain part of the trusted Node/OS runtime base and are
 * deliberately not represented as an arbitrary shared-library closure.
 */
export const MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY = Object.freeze({
  schema: "chainlesschain.mcp-stdio-native-code-policy/v1",
  contractVersion: 1,
  mode: "deny-package-native-addons",
  capsuleFormat: "single-bundled-cjs",
  nativeAddonLoading: "denied",
  nativeAddonDenialMechanism:
    "immutable-process-dlopen-guard-plus-bundled-js-only-v1",
  hostRuntimeSharedLibraries: "platform-runtime-tcb",
  anonymousExecutableMemory: "node-runtime-tcb",
  sharedLibraryClosure: false,
});

const POLICY_KEYS = Object.freeze(
  Object.keys(MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY).sort(),
);

function canonicalPolicy(value) {
  return JSON.stringify(
    Object.fromEntries(POLICY_KEYS.map((key) => [key, value[key]])),
  );
}

export const MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY_DIGEST = crypto
  .createHash("sha256")
  .update(canonicalPolicy(MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY))
  .digest("hex");

export function isMcpStdioCapsuleNativeCodePolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === POLICY_KEYS.length &&
    keys.every((key, index) => key === POLICY_KEYS[index]) &&
    POLICY_KEYS.every(
      (key) => value[key] === MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY[key],
    )
  );
}

export function mcpStdioCapsuleNativeCodePolicyDigest(value) {
  if (!isMcpStdioCapsuleNativeCodePolicy(value)) {
    throw new TypeError("MCP capsule native-code policy is invalid");
  }
  return crypto
    .createHash("sha256")
    .update(canonicalPolicy(value))
    .digest("hex");
}

export function mcpStdioCapsuleNativeCodeEvidence(value) {
  const digest = mcpStdioCapsuleNativeCodePolicyDigest(value);
  return Object.freeze({
    nativeCodePolicyBound: true,
    nativeCodePolicySchema: value.schema,
    nativeCodePolicyDigest: digest,
    nativeCodePolicyMode: value.mode,
    capsuleNativeCodeFormat: value.capsuleFormat,
    nativeAddonLoading: value.nativeAddonLoading,
    nativeAddonDenialMechanism: value.nativeAddonDenialMechanism,
    hostRuntimeSharedLibraries: value.hostRuntimeSharedLibraries,
    anonymousExecutableMemory: value.anonymousExecutableMemory,
  });
}
