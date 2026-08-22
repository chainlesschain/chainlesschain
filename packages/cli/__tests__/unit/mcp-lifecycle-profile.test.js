import { describe, expect, it } from "vitest";
import { runMcpLifecycleProfile } from "../../scripts/mcp-lifecycle-profile.mjs";

describe("MCP lifecycle required profile", () => {
  it("runs real loopback reconnect/restart/OAuth/TLS boundaries", async () => {
    const profile = await runMcpLifecycleProfile();
    expect(profile.profileVersion).toMatch(/mcp-lifecycle\/v2$/u);
    expect(profile.measurements).toMatchObject({
      disabledOutboundCount: 0,
      rpcOrderExact: true,
      authenticationRefreshesPerRejection: 1,
      reconnectFlightsPerServer: 1,
      duplicateCallbacksAccepted: 0,
      staleCallbacksAccepted: 0,
      lostCallbacks: 0,
      crossProcessRestartTakeovers: 1,
      revokedTokenResurrections: 0,
      idpRevokedRefreshRequests: 1,
      invalidTlsOutboundCount: 0,
      invalidTlsLifecycleFailed: 1,
      mtlsAuthorizedConnections: 2,
      protocolBoundaryFailures: 2,
      invalidProtocolPostInitializeRequests: 0,
      logSecretHits: 0,
    });
    expect(profile.measurements.rpcRegistered).toBe(
      profile.measurements.rpcSettled,
    );
    expect(profile.measurements.rpcRecoveredAfterRestart).toBeGreaterThan(0);
    expect(profile.measurements.maxRecoveryLatencyMs).toBeLessThanOrEqual(
      profile.thresholds.maxRecoveryLatencyMs,
    );
    expect(profile.testIds.length).toBeGreaterThan(0);
  }, 20_000);
});
