import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import automationCenter from "../../../vscode-extension/src/automation-center.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(here, "../../../vscode-extension");

function sample() {
  const revision = "sha256:" + "a".repeat(64);
  const itemRevision = "sha256:" + "b".repeat(64);
  const action = (id, available) => ({
    id,
    available,
    reason: available ? null : "unavailable",
    preview: available
      ? {
          executor: "cli",
          argv: [
            "automation",
            "center-action",
            "flow-1",
            id,
            "--expected-revision",
            itemRevision,
            "--json",
          ],
          mutates: true,
        }
      : null,
  });
  return {
    schema: "chainlesschain.automation-center/v1",
    schemaVersion: 1,
    authority: "cli",
    connected: true,
    revision,
    summary: { total: 1, active: 1, paused: 0, needsAttention: 0 },
    flows: [
      {
        id: "flow-1",
        revision: itemRevision,
        name: "<deploy & notify>",
        description: "scope",
        status: "active",
        schedule: "*/5 * * * *",
        security: {
          state: "ready",
          ready: true,
          principalId: "alice",
          connectors: ["slack"],
          permissions: [{ permission: "automation:execute", allowed: true }],
          budget: { remainingRuns: 2, remainingActionSteps: 2 },
          issue: null,
        },
        triggers: [
          {
            id: "trigger-1",
            type: "event",
            enabled: true,
            scope: { origins: ["telegram"], senders: ["ops"] },
          },
        ],
        history: [],
        actions: [
          action("run_now", true),
          action("pause", true),
          action("resume", false),
        ],
      },
    ],
  };
}

describe("VS Code Automation Center", () => {
  it("parses the CLI projection and exposes only exact signed previews", () => {
    const parsed = automationCenter.parseAutomationCenter(sample());
    expect(parsed.connected).toBe(true);
    expect(parsed.flows[0]).toMatchObject({
      id: "flow-1",
      status: "active",
      security: { state: "ready", ready: true },
    });
    const preview = automationCenter.previewAutomationAction(parsed, {
      id: "flow-1",
      action: "run_now",
      revision: parsed.revision,
      itemRevision: parsed.flows[0].revision,
    });
    expect(preview.argv).toEqual([
      "automation",
      "center-action",
      "flow-1",
      "run_now",
      "--expected-revision",
      parsed.flows[0].revision,
      "--json",
    ]);
  });

  it("fails closed on malformed previews and stale target revisions", () => {
    const invalid = sample();
    invalid.flows[0].actions[0].preview.argv = ["agent", "--dangerous"];
    expect(automationCenter.parseAutomationCenter(invalid)).toMatchObject({
      connected: false,
      flows: [],
    });

    const rendered = automationCenter.parseAutomationCenter(sample());
    const currentInput = sample();
    currentInput.flows[0].revision = "sha256:" + "c".repeat(64);
    for (const action of currentInput.flows[0].actions) {
      if (action.preview)
        action.preview.argv[5] = currentInput.flows[0].revision;
    }
    const current = automationCenter.parseAutomationCenter(currentInput);
    expect(
      automationCenter.recheckAutomationAction(rendered, current, {
        id: "flow-1",
        action: "pause",
        revision: rendered.revision,
        itemRevision: rendered.flows[0].revision,
      }),
    ).toBeNull();
  });

  it("filters and escapes flow content in rendered rows", () => {
    const parsed = automationCenter.parseAutomationCenter(sample());
    expect(
      automationCenter.filterAutomationFlows(parsed.flows, "telegram"),
    ).toHaveLength(0);
    expect(
      automationCenter.filterAutomationFlows(parsed.flows, "deploy"),
    ).toHaveLength(1);
    const html = automationCenter.renderAutomationRows(parsed.flows);
    expect(html).toContain("&lt;deploy &amp; notify&gt;");
    expect(html).not.toContain("<deploy & notify>");
  });

  it("declares and wires the command with localized titles", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"),
    );
    const command = pkg.contributes.commands.find(
      (entry) => entry.command === "chainlesschain.automation.center",
    );
    expect(command.title).toBe("%cmd.automation.center.title%");
    const en = JSON.parse(
      fs.readFileSync(path.join(extensionRoot, "package.nls.json"), "utf8"),
    );
    const zh = JSON.parse(
      fs.readFileSync(
        path.join(extensionRoot, "package.nls.zh-cn.json"),
        "utf8",
      ),
    );
    expect(en["cmd.automation.center.title"]).toContain("Automation Center");
    expect(zh["cmd.automation.center.title"]).toContain("自动化中心");
    const extension = fs.readFileSync(
      path.join(extensionRoot, "src", "extension.js"),
      "utf8",
    );
    expect(extension).toContain('"chainlesschain.automation.center"');
  });
});
