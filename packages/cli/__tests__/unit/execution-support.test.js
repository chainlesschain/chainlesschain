import { describe, expect, it } from "vitest";
import { describeExecutionSupport } from "../../src/lib/execution-support.js";
import { assessAgentSandboxCapabilities } from "../../src/lib/agent-sandbox.js";

describe("execution support diagnostics", () => {
  it.each(["win32", "darwin", "linux"])(
    "never advertises persistent revocation from OS=%s alone",
    (platform) => {
      const report = assessAgentSandboxCapabilities(null, {
        host: { platform, arch: "x64", release: "test" },
      });
      const support = describeExecutionSupport({ capabilityReport: report });
      expect(support.persistentNetworkRevocation.status).toBe("unavailable");
      expect(support.nativeReleaseValidation).toBe(
        "not-established-by-this-probe",
      );
      expect(support.io.interactiveTerminal).toBe(false);
      expect(support.permissionSource).toBe("process-local");
    },
  );
  it("ignores copied authority properties on an unregistered provider", () => {
    const provider = () => ({});
    provider.getSnapshot = () => ({ durable: {} });
    const support = describeExecutionSupport({
      permissionRulesProvider: provider,
      capabilityReport: {
        host: { platform: "linux", arch: "x64" },
        backend: { engine: "docker-egress", available: true },
        unsupported: [],
        execution: { started: true },
      },
    });
    expect(support.permissionSource).toBe("sampled-callback");
    expect(support.persistentNetworkRevocation.status).toBe("unavailable");
    expect(support.persistentNetworkRevocation.executionObserved).toBe(false);
  });
});
