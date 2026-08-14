import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import automationCenter from "../../../vscode-extension/src/automation-center.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(here, "../../../vscode-extension");

function sample() {
  const revision = "sha256:" + "a".repeat(64);
  const flowRevision = "sha256:" + "b".repeat(64);
  const routineRevision = "sha256:" + "c".repeat(64);
  const catalogRevision = "sha256:" + "d".repeat(64);
  const flowAction = (id, available) => ({
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
            flowRevision,
            "--json",
          ],
          mutates: true,
        }
      : null,
  });
  const routineAction = (id, available) => ({
    id,
    available,
    reason: available ? null : "unavailable",
    preview: available
      ? {
          executor: "cli",
          argv:
            id === "edit"
              ? [
                  "automation",
                  "center-routine-edit",
                  "rt-1",
                  "--expected-revision",
                  routineRevision,
                  "--json-stdin",
                  "--json",
                ]
              : [
                  "automation",
                  "center-routine-action",
                  "rt-1",
                  id,
                  "--expected-revision",
                  routineRevision,
                  "--json",
                ],
          ...(id === "edit" ? { stdin: "json" } : {}),
          mutates: true,
        }
      : null,
  });
  return {
    schema: "chainlesschain.automation-center/v3",
    schemaVersion: 3,
    authority: "cli",
    connected: true,
    revision,
    routineCatalogRevision: catalogRevision,
    summary: {
      total: 2,
      flows: 1,
      routines: 1,
      active: 2,
      paused: 0,
      needsAttention: 0,
      runtimeRunning: 0,
      runtimePauseRequested: 0,
      runtimePaused: 0,
    },
    mutations: {
      createRoutine: {
        available: true,
        reason: null,
        preview: {
          executor: "cli",
          argv: [
            "automation",
            "center-routine-create",
            "--expected-revision",
            catalogRevision,
            "--json-stdin",
            "--json",
          ],
          stdin: "json",
          mutates: true,
        },
      },
    },
    items: [
      {
        kind: "flow",
        id: "flow-1",
        revision: flowRevision,
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
        incidents: [],
        actions: [
          flowAction("run_now", true),
          flowAction("retry_failed", false),
          flowAction("pause", true),
          flowAction("resume", false),
          flowAction("disable", true),
          flowAction("delete", false),
        ],
      },
      {
        kind: "routine",
        id: "rt-1",
        revision: routineRevision,
        name: "GitHub watch",
        description: "Routine · github",
        status: "active",
        schedule: "acme/app · PushEvent",
        definition: {
          name: "GitHub watch",
          prompt: "Summarize pushes",
          trigger: {
            kind: "github",
            repo: "acme/app",
            events: ["PushEvent"],
          },
        },
        security: {
          state: "snapshot_bound",
          ready: true,
          principalId: "routine:rt-1",
          connectors: [],
          permissions: [{ permission: "agent.execute", allowed: true }],
          budget: null,
          issue: null,
        },
        triggers: [
          {
            id: "routine:rt-1:github",
            type: "github",
            enabled: true,
            scope: { repo: "acme/app", events: ["PushEvent"] },
          },
        ],
        history: [],
        actions: [
          routineAction("run_now", true),
          routineAction("retry_failed", false),
          routineAction("pause", true),
          routineAction("resume", false),
          routineAction("disable", true),
          routineAction("delete", false),
          routineAction("edit", true),
        ],
      },
    ],
    runtime: {
      schema: "chainlesschain.automation-center-runtime/v1",
      schemaVersion: 1,
      items: [],
    },
  };
}

describe("VS Code Automation Center", () => {
  it("parses flow/Routine items and exposes only exact CLI previews", () => {
    const parsed = automationCenter.parseAutomationCenter(sample());
    expect(parsed.connected).toBe(true);
    expect(parsed.summary).toMatchObject({ flows: 1, routines: 1 });
    const routine = parsed.items.find((item) => item.kind === "routine");
    expect(routine).toMatchObject({
      id: "rt-1",
      definition: { trigger: { kind: "github", repo: "acme/app" } },
    });
    const preview = automationCenter.previewAutomationAction(parsed, {
      kind: "routine",
      id: "rt-1",
      action: "edit",
      revision: parsed.revision,
      itemRevision: routine.revision,
    });
    expect(preview).toMatchObject({ stdin: "json" });
    expect(preview.argv[1]).toBe("center-routine-edit");
  });

  it("fails closed on arbitrary argv, stale item or stale Routine catalog", () => {
    const invalid = sample();
    invalid.items[1].actions[6].preview.argv = ["agent", "--dangerous"];
    expect(automationCenter.parseAutomationCenter(invalid)).toMatchObject({
      connected: false,
      items: [],
    });

    const rendered = automationCenter.parseAutomationCenter(sample());
    const currentInput = sample();
    currentInput.routineCatalogRevision = "sha256:" + "e".repeat(64);
    currentInput.mutations.createRoutine.preview.argv[3] =
      currentInput.routineCatalogRevision;
    const current = automationCenter.parseAutomationCenter(currentInput);
    expect(automationCenter.recheckCreateRoutine(rendered, current)).toBeNull();
  });

  it("filters and escapes both item kinds", () => {
    const parsed = automationCenter.parseAutomationCenter(sample());
    expect(
      automationCenter.filterAutomationFlows(parsed.items, "github"),
    ).toHaveLength(1);
    expect(
      automationCenter.filterAutomationFlows(parsed.items, "deploy"),
    ).toHaveLength(1);
    const html = automationCenter.renderAutomationRows(parsed.items);
    expect(html).toContain("&lt;deploy &amp; notify&gt;");
    expect(html).toContain("acme/app");
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
    const extension = fs.readFileSync(
      path.join(extensionRoot, "src", "extension.js"),
      "utf8",
    );
    expect(extension).toContain('"chainlesschain.automation.center"');
  });
});
