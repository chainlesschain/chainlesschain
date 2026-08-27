"use strict";

const DESKTOP_GRAPH_MODES = Object.freeze(["legacy", "shadow", "canonical"]);

function desktopGraphAuthorityMode(env = process.env) {
  const mode = String(env.CHAINLESSCHAIN_GRAPH_DESKTOP || "legacy")
    .trim()
    .toLowerCase();
  if (!DESKTOP_GRAPH_MODES.includes(mode)) {
    const error = new Error(
      "CHAINLESSCHAIN_GRAPH_DESKTOP must be legacy, shadow, or canonical",
    );
    error.code = "CC_GRAPH_AUTHORITY_MODE_INVALID";
    throw error;
  }
  return mode;
}

function desktopLegacyRuntimeReadOnly(env = process.env) {
  return (
    desktopGraphAuthorityMode(env) === "canonical" ||
    String(env.CHAINLESSCHAIN_DESKTOP_LEGACY_READ_ONLY || "") === "1"
  );
}

function assertDesktopLegacyMutationAllowed(entrypoint, env = process.env) {
  const mode = desktopGraphAuthorityMode(env);
  if (!desktopLegacyRuntimeReadOnly(env)) {
    return Object.freeze({
      authorityMode: mode,
      authoritySource:
        mode === "shadow" ? "graph_kernel_shadow" : "legacy_runtime",
      legacyReadOnly: false,
    });
  }
  const error = new Error(
    `Desktop legacy runtime is read-only; '${entrypoint}' must use the fixed Graph App Server adapter`,
  );
  error.name = "DesktopRuntimeAuthorityError";
  error.code = "CC_DESKTOP_LEGACY_RUNTIME_READ_ONLY";
  error.entrypoint = String(entrypoint);
  error.authorityMode = "canonical";
  error.authoritySource = "graph_kernel";
  throw error;
}

function desktopLegacyRuntimeClaims(env = process.env) {
  const mode = desktopGraphAuthorityMode(env);
  const readOnly = desktopLegacyRuntimeReadOnly(env);
  return Object.freeze({
    surface: "desktop",
    originSurface: "desktop",
    authorityMode: mode,
    authoritySource:
      mode === "canonical"
        ? "graph_kernel"
        : mode === "shadow"
          ? "graph_kernel_shadow"
          : "legacy_runtime",
    execution: readOnly ? "designer-only" : "legacy",
    persistence: "legacy",
    legacyReadOnly: readOnly,
  });
}

module.exports = {
  DESKTOP_GRAPH_MODES,
  assertDesktopLegacyMutationAllowed,
  desktopGraphAuthorityMode,
  desktopLegacyRuntimeClaims,
  desktopLegacyRuntimeReadOnly,
};
