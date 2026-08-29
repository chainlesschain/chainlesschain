import { describe, expect, it } from "vitest";
import {
  createRecordedSkillDraft,
  replayRecordedSkill,
  reviewRecordedSkillDraft,
} from "../../src/lib/record-replay/skill-recorder.js";
import { launchPlaywrightRecordedSkillDriver } from "../../src/lib/record-replay/playwright-ui-driver.js";

function fakePlaywright() {
  let routeHandler;
  let closed = false;
  const state = { heading: "no-project", typed: "", selected: "one" };
  const elements = {
    "[data-project='project-2']": { tag: "button", text: "Project 2" },
    "#network": { tag: "button", text: "Network" },
    "#name": { tag: "input", type: "text" },
    "#choice": { tag: "select" },
    h1: { tag: "h1" },
  };
  function locator(selector) {
    const element = elements[selector];
    return {
      count: async () => (element ? 1 : 0),
      waitFor: async () => {},
      evaluate: async (fn) =>
        fn({ tagName: String(element.tag || "div").toUpperCase() }),
      getAttribute: async (name) =>
        name === "type" ? element.type || null : null,
      isVisible: async () => true,
      inputValue: async () =>
        selector === "#choice" ? state.selected : state.typed,
      textContent: async () =>
        selector === "h1" ? state.heading : element.text || "",
      click: async () => {
        if (selector.includes("project-2")) state.heading = "project-2";
        if (selector === "#network") {
          await routeHandler({
            request: () => ({
              url: () => "https://example.invalid/probe",
              method: () => "GET",
            }),
            abort: async () => {},
            continue: async () => {},
          });
        }
      },
      fill: async (value) => {
        state.typed = value;
      },
      selectOption: async (value) => {
        state.selected = value;
      },
    };
  }
  const page = {
    setContent: async () => {},
    locator,
    waitForTimeout: async () => {},
    screenshot: async () => Buffer.from("screenshot"),
    content: async () => `<h1>${state.heading}</h1>`,
  };
  const context = {
    route: async (_pattern, handler) => {
      routeHandler = handler;
    },
    setOffline: async () => {},
    newPage: async () => page,
    close: async () => {
      closed = true;
    },
  };
  const browser = {
    newContext: async () => context,
    version: () => "fake-chromium-1",
    close: async () => {
      closed = true;
    },
  };
  return {
    chromium: { launch: async () => browser },
    wasClosed: () => closed,
  };
}

function approve(actions, capabilityManifest) {
  const draft = createRecordedSkillDraft({
    name: "ui-driver-test",
    actions,
    environment: { app: "fixture" },
    failureConditions: ["the fixture does not reach the reviewed state"],
  });
  return reviewRecordedSkillDraft(draft, {
    reviewerId: "reviewer",
    approvedCapabilities: capabilityManifest || draft.capabilityManifest,
    acceptedFailureConditions: true,
  });
}

describe("Playwright recorded-skill UI driver", () => {
  it("executes reviewed actions and emits content-free evidence", async () => {
    const runtime = fakePlaywright();
    const driver = await launchPlaywrightRecordedSkillDriver({
      html: "<main>fixture</main>",
      playwright: runtime,
      settleMs: 0,
    });
    const skill = approve([
      { kind: "click", target: "[data-project='project-2']" },
      { kind: "assert", target: "h1", value: "project-2" },
      { kind: "type", target: "#name", value: "private input" },
      { kind: "select", target: "#choice", value: "two" },
    ]);

    const report = await replayRecordedSkill(skill, {
      environment: skill.environment.requirements,
      executor: driver.executor,
    });
    const serialized = JSON.stringify(driver.summary());

    expect(report.status).toBe("succeeded");
    expect(driver.summary()).toMatchObject({
      actionCount: 4,
      deniedRequestCount: 0,
    });
    expect(serialized).not.toContain("project-2");
    expect(serialized).not.toContain("private input");
    await driver.close();
    expect(driver.summary().closed).toBe(true);
    expect(runtime.wasClosed()).toBe(true);
  });

  it("blocks and records a network attempt without retaining its URL", async () => {
    const driver = await launchPlaywrightRecordedSkillDriver({
      html: "<button id='network'>Network</button>",
      playwright: fakePlaywright(),
      settleMs: 0,
    });
    const skill = approve([{ kind: "click", target: "#network" }]);

    await expect(
      replayRecordedSkill(skill, {
        environment: skill.environment.requirements,
        executor: driver.executor,
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "CC_REPLAY_UI_NETWORK_ATTEMPT" }),
    );
    expect(driver.summary()).toMatchObject({
      actionCount: 0,
      deniedRequestCount: 1,
    });
    expect(JSON.stringify(driver.summary())).not.toContain("example.invalid");
    await driver.close();
  });
});
