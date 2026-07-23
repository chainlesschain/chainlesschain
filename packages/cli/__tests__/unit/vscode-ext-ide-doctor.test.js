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
      cliVersionText: "0.162.176",
      workspaceTrusted: true,
    });
    expect(md).toContain("running on 127.0.0.1:51234");
    expect(md).toContain("connect vscode:51234");
    expect(md).toContain("reason: workspace-match");
    expect(md).toContain("## cc ide status");
    expect(md).toContain("## cc ide doctor");
    expect(md).toContain("READY (可运行)");
    expect(md).toContain("CLI: 0.162.176");
  });

  it("says STOPPED (with the recovery action) when the bridge is down", () => {
    const md = formatBridgeReport({
      port: -1,
      statusText: "",
      doctorText: "",
      cliVersionText: "0.162.176",
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
