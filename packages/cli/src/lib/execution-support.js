import { permissionRulesProviderAuthority } from "./permission-authority.js";

/** Diagnostic projection only. Admission remains with the broker and authority. */
export function describeExecutionSupport({
  capabilityReport,
  permissionRulesProvider,
} = {}) {
  const report = capabilityReport;
  if (!report?.host || !report?.backend)
    throw new TypeError("sandbox capability report is required");
  let authority = "process-local",
    authorityAvailable = true;
  try {
    const bound = permissionRulesProviderAuthority(permissionRulesProvider);
    if (bound?.getSnapshot()?.durable) authority = "durable-controlled-host";
    else if (permissionRulesProvider && !bound) authority = "sampled-callback";
  } catch {
    authority = "unavailable";
    authorityAvailable = false;
  }
  const supportedHost =
    report.host.platform === "linux" &&
    ["x64", "arm64"].includes(report.host.arch);
  const domainRoute =
    report.backend.engine === "docker-egress" &&
    report.unsupported.length === 0;
  const durable =
    supportedHost && domainRoute && authority === "durable-controlled-host";
  return {
    schema: "chainlesschain.execution-support/v1",
    platform: report.host.platform,
    arch: report.host.arch,
    engine: report.backend.engine,
    entrypoint: "agent-shell",
    io: {
      stdin: "noninteractive",
      stdout: "captured",
      stderr: "captured",
      interactiveTerminal: false,
    },
    permissionSource: authority,
    permissionSourceAvailable: authorityAvailable,
    persistentNetworkRevocation: {
      status: durable ? "configured" : "unavailable",
      reason: !supportedHost
        ? "requires-linux-x64-or-arm64-controlled-host"
        : !domainRoute
          ? "requires-docker-egress-domain-policy"
          : authority !== "durable-controlled-host"
            ? "requires-explicit-durable-authority-binding"
            : null,
      executionObserved: durable && report.execution.started === true,
      backendAvailable: report.backend.available,
      modelRequestGovernance: "not-established-by-shell-capabilities",
    },
    nativeReleaseValidation: "not-established-by-this-probe",
  };
}
