import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { parsePluginManifest } from "../../src/lib/plugin-runtime/manifest.js";
import {
  cliGoalExtensionHost,
  CLI_GOAL_CAPABILITIES,
} from "../../src/lib/plugin-runtime/cli-goal-capabilities.js";
import {
  _deps,
  collectGoalExtensions,
  projectGoalExtensionEvent,
  projectGoalExtensionPanel,
  proposeGoalExtensionAction,
} from "../../src/lib/plugin-runtime/goal-extensions.js";

const sample = fileURLToPath(
  new URL(
    "../../src/lib/plugin-runtime/examples/project-delivery-assistant",
    import.meta.url,
  ),
);
const goalRef = {
  id: "goal-1",
  storeId: "project-store",
  revision: 2,
  controlGeneration: 1,
};
let plugin, ref, options;
const event = () =>
  projectGoalExtensionEvent(
    ref,
    { type: "risk.review.completed", goalRef },
    options,
  );
const panel = () =>
  projectGoalExtensionPanel(
    ref,
    { panelId: "delivery-evidence", goalRef },
    options,
  );
const proposal = (type = "task.description.update") =>
  proposeGoalExtensionAction(
    ref,
    {
      type,
      goalRef,
      sourceRef: "risk-1",
      requestId: "request-1",
      title: "Follow delivery",
      description: "User-selected draft",
    },
    options,
  );
beforeEach(() => {
  const manifest = parsePluginManifest(sample);
  plugin = {
    name: manifest.metadata.name,
    version: manifest.metadata.version,
    scope: "project",
    enabled: true,
    manifest,
  };
  ref = { name: plugin.name, version: plugin.version, scope: plugin.scope };
  vi.spyOn(_deps, "discoverPlugins").mockImplementation(() => [plugin]);
  vi.spyOn(_deps, "loadManagedPluginPolicy").mockReturnValue(null);
  vi.spyOn(_deps, "filterByManagedPolicy").mockImplementation((plugins) => ({
    kept: plugins,
  }));
  vi.spyOn(_deps, "isPluginTrusted").mockReturnValue(true);
  vi.spyOn(_deps, "isPluginCapabilityConsented").mockReturnValue(true);
  options = {
    host: cliGoalExtensionHost(CLI_GOAL_CAPABILITIES),
    authorize: vi.fn(async () => true),
    readEvent: vi.fn(async () => ({
      summary: "Historical risk",
      occurredAt: "2026-11-04T12:00:00.000Z",
    })),
    readPanel: vi.fn(async () => ({
      objective: "Delivery",
      status: "active",
      riskSummary: "Risk",
      receiptSummary: "No receipt",
    })),
    enqueueProposal: vi.fn(async () => ({
      proposalId: "pending-1",
      state: "pending-confirmation",
    })),
  };
});
afterEach(() => vi.restoreAllMocks());
describe("combined CLI goal surfaces", () => {
  it.each([
    "event:risk.review.completed",
    "panel:goal.evidence",
    "proposal:task.description.update",
  ])(
    "admits the full assistant while activating only %s",
    async (capability) => {
      options.host = cliGoalExtensionHost([capability]);
      expect(collectGoalExtensions(options).extensions).toHaveLength(1);
      if (capability.startsWith("event:"))
        expect((await event()).type).toBe("risk.review.completed");
      if (capability.startsWith("panel:"))
        expect((await panel()).format).toBe("text");
      if (capability.startsWith("proposal:"))
        expect((await proposal()).state).toBe("pending-confirmation");
    },
  );
  it.each(["event", "panel", "proposal"])(
    "denies inactive %s before authorization or source callbacks",
    async (operation) => {
      options.host = cliGoalExtensionHost([]);
      await expect({ event, panel, proposal }[operation]()).rejects.toThrow(
        "inactive",
      );
      expect(options.authorize).not.toHaveBeenCalled();
      expect(options.readEvent).not.toHaveBeenCalled();
      expect(options.readPanel).not.toHaveBeenCalled();
      expect(options.enqueueProposal).not.toHaveBeenCalled();
    },
  );
  it("does not use another surface's full admission to bypass per-call activation", async () => {
    options.host = cliGoalExtensionHost(["event:risk.review.completed"]);
    await expect(panel()).rejects.toThrow("inactive");
    await expect(proposal()).rejects.toThrow("inactive");
    expect(options.enqueueProposal).not.toHaveBeenCalled();
    expect(options.readPanel).not.toHaveBeenCalled();
  });
  it("still requires consent for the complete declared set", () => {
    options.host = cliGoalExtensionHost(["event:risk.review.completed"]);
    _deps.isPluginCapabilityConsented.mockImplementation(
      (_plugin, capabilities) =>
        !capabilities.goalExtension.includes(
          "proposal:task.description.update",
        ),
    );
    expect(collectGoalExtensions(options)).toMatchObject({
      extensions: [],
      dropped: [{ reason: "consent_required" }],
    });
  });
  it("keeps unsupported task creation and executable components out of the deployable assistant", async () => {
    expect(plugin.manifest.components.hooks).toBeNull();
    expect(plugin.manifest.components.bin).toEqual([]);
    expect(plugin.manifest.goalExtension.proposals).toEqual([
      "task.description.update",
    ]);
    await expect(proposal("task.create")).rejects.toThrow("undeclared");
    expect(options.enqueueProposal).not.toHaveBeenCalled();
    expect(() => cliGoalExtensionHost(["proposal:task.create"])).toThrow(
      "CAPABILITIES_INVALID",
    );
  });
  it("does not admit unsupported capabilities elsewhere in a declaration", () => {
    plugin.manifest.goalExtension.proposals.push("task.create");
    expect(collectGoalExtensions(options)).toMatchObject({
      extensions: [],
      dropped: [{ reason: "unsupported_capabilities" }],
    });
  });
  it("captures active capabilities before asynchronous I/O", async () => {
    const active = ["event:risk.review.completed"];
    options.host = {
      ...cliGoalExtensionHost(active),
      activeCapabilities: active,
    };
    options.readEvent.mockImplementation(async () => {
      active.length = 0;
      return {
        summary: "Captured selection",
        occurredAt: "2026-11-04T12:00:00.000Z",
      };
    });
    expect((await event()).summary).toBe("Captured selection");
    await expect(event()).rejects.toThrow("inactive");
  });
});
