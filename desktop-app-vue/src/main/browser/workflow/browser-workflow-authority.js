"use strict";

function browserWorkflowExperimentalEnabled(env = process.env) {
  return ["1", "true", "enabled"].includes(
    String(env.CHAINLESSCHAIN_BROWSER_WORKFLOW_EXPERIMENTAL || "")
      .trim()
      .toLowerCase(),
  );
}

function assertBrowserWorkflowEnabled(entrypoint, env = process.env) {
  if (browserWorkflowExperimentalEnabled(env)) return true;
  const error = new Error(
    `Browser workflow is non-durable and disabled by default; '${entrypoint}' requires CHAINLESSCHAIN_BROWSER_WORKFLOW_EXPERIMENTAL=1`,
  );
  error.name = "BrowserWorkflowAuthorityError";
  error.code = "CC_BROWSER_WORKFLOW_EXPERIMENTAL_DISABLED";
  error.entrypoint = String(entrypoint);
  error.originSurface = "browser";
  error.persistence = "non_durable";
  throw error;
}

function browserWorkflowRuntimeClaims(env = process.env) {
  return Object.freeze({
    originSurface: "browser",
    surface: "browser",
    authorityMode: "legacy",
    authoritySource: "legacy_runtime",
    execution: browserWorkflowExperimentalEnabled(env)
      ? "experimental"
      : "disabled",
    persistence: "non_durable",
    isolated: false,
    featureGated: true,
  });
}

module.exports = {
  assertBrowserWorkflowEnabled,
  browserWorkflowExperimentalEnabled,
  browserWorkflowRuntimeClaims,
};
