/**
 * "Diagnose Bridge" report — pure arg builders + the markdown the
 * chainlesschain.ide.doctor command renders (`cc ide status` + `cc ide
 * doctor` surfaced in-IDE). Headless.
 */
import { describe, it, expect } from "vitest";
import {
  IDE_STATUS_ARGS,
  IDE_DOCTOR_ARGS,
  CLI_VERSION_ARGS,
  formatBridgeReport,
} from "../../../vscode-extension/src/ide-doctor.js";
import { MIN_CLI_VERSION } from "../../../vscode-extension/src/version-check.js";

describe("ide-doctor args", () => {
  it("targets the CLI's ide status / doctor subcommands", () => {
    expect(IDE_STATUS_ARGS).toEqual(["ide", "status"]);
    expect(IDE_DOCTOR_ARGS).toEqual(["ide", "doctor"]);
    expect(CLI_VERSION_ARGS).toEqual(["--version"]);
  });
});

describe("formatBridgeReport", () => {
  it("shows this window's port and passes the CLI sections through verbatim", () => {
    const md = formatBridgeReport({
      port: 51234,
      statusText: "connect vscode:51234",
      doctorText: "live locks: 1\nreason: workspace-match",
      cliVersionText: MIN_CLI_VERSION,
      workspaceTrusted: true,
      runtimeEnvironment: {
        node: {
          status: "ready",
          version: "22.12.0",
          minimumVersion: "22.12.0",
        },
        java: { status: "ready", version: "21.0.3" },
        caches: {
          managedCli: { status: "ready", version: "0.200.0" },
          pluginRegistry: { status: "ready", entries: 3 },
        },
      },
    });
    expect(md).toContain("running on 127.0.0.1:51234");
    expect(md).toContain("connect vscode:51234");
    expect(md).toContain("reason: workspace-match");
    expect(md).toContain("## cc ide status");
    expect(md).toContain("## cc ide doctor");
    expect(md).toContain("DEGRADED (可降级运行)");
    expect(md).toContain(
      "agent capabilities have not been confirmed for a running session",
    );
    expect(md).toContain("Agent session: not observed");
    expect(md).toContain("Input acceptance receipts: not observed");
    expect(md).toContain(`CLI: ${MIN_CLI_VERSION}`);
    expect(md).toContain("## Development runtimes and offline recovery");
    expect(md).toContain("Node.js: 22.12.0");
    expect(md).toContain("Managed CLI offline copy: ready (0.200.0)");
    expect(md).toContain("Plugin registry offline cache: ready (3 entries)");
  });

  it("reports ready when the running session confirms receipts and its effective approval mode", () => {
    const md = formatBridgeReport({
      port: 51234,
      cliVersionText: MIN_CLI_VERSION,
      workspaceTrusted: true,
      agentRuntime: {
        state: "running",
        inputReceipts: true,
        permissionMode: {
          requested: "default",
          effective: "default",
          status: "effective",
        },
      },
    });
    expect(md).toContain("READY (可运行)");
    expect(md).toContain("Agent session: running");
    expect(md).toContain("Input acceptance receipts: supported");
    expect(md).toContain(
      "Approval mode: requested default, effective default (effective)",
    );
  });

  it.each([
    {
      inputReceipts: false,
      permissionMode: {
        requested: "default",
        effective: "default",
        status: "effective",
      },
      reason: "input acceptance receipts are unavailable",
    },
    {
      inputReceipts: true,
      permissionMode: {
        requested: "bypassPermissions",
        effective: "default",
        status: "pending",
      },
      reason: "effective approval mode is unconfirmed",
    },
  ])("keeps incomplete running capabilities degraded: $reason", (entry) => {
    const md = formatBridgeReport({
      port: 51234,
      cliVersionText: MIN_CLI_VERSION,
      workspaceTrusted: true,
      agentRuntime: {
        state: "running",
        inputReceipts: entry.inputReceipts,
        permissionMode: entry.permissionMode,
      },
    });
    expect(md).toContain("DEGRADED (可降级运行)");
    expect(md).toContain(entry.reason);
  });

  it("says STOPPED (with the recovery action) when the bridge is down", () => {
    const md = formatBridgeReport({
      port: -1,
      statusText: "",
      doctorText: "",
      cliVersionText: MIN_CLI_VERSION,
      workspaceTrusted: true,
    });
    expect(md).toContain("STOPPED");
    expect(md).toContain("Restart Bridge");
    expect(md).toContain("DEGRADED (可降级运行)");
  });

  it("renders a visible placeholder when the CLI produced no output", () => {
    const md = formatBridgeReport({
      port: 1,
      statusText: "",
      doctorText: null,
      cliVersionText: "",
    });
    expect(md).toMatch(
      /## cc ide status[\s\S]*?no output — is the `cc` CLI installed/,
    );
    expect(md).toMatch(
      /## cc ide doctor[\s\S]*?no output — is the `cc` CLI installed/,
    );
    expect(md).toContain("NEEDS REPAIR (需要修复)");
  });
});
