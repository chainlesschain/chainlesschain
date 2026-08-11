import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deliverBackgroundNeedsInputNotification,
  readBackgroundAgentState,
  writeBackgroundAgentState,
} from "../../src/lib/background-agent-supervisor.js";
import { createNeedsInputIncident } from "../../src/lib/background-needs-input-incident.js";

let stateDir;

function writePending(id = "bg-needs") {
  return writeBackgroundAgentState(
    {
      id,
      status: "running",
      startedAt: 1,
      phase: "needs_input",
      pendingQuestion: { requestId: "request-1", prompt: "Deploy?" },
      needsInputIncident: createNeedsInputIncident({
        runId: id,
        sessionId: "session-1",
        requestId: "request-1",
        now: 100,
      }),
    },
    { createIfMissing: true },
  );
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "cc-needs-input-"));
  process.env.CC_BACKGROUND_AGENTS_DIR = stateDir;
});

afterEach(() => {
  delete process.env.CC_BACKGROUND_AGENTS_DIR;
  rmSync(stateDir, { recursive: true, force: true });
});

describe("durable background needs-input notification", () => {
  it("persists the claim before delivery and settles exactly once", async () => {
    writePending();
    const observed = [];
    const notify = vi.fn(async (message) => {
      observed.push(readBackgroundAgentState("bg-needs").needsInputIncident);
      expect(message.body).toContain("cc attach bg-needs");
      expect(message.body).not.toContain("Deploy?");
      return {
        channels: 1,
        delivered: ["telegram"],
        failed: [],
      };
    });
    let time = 200;

    const result = await deliverBackgroundNeedsInputNotification("bg-needs", {
      notify,
      now: () => time++,
    });

    expect(result).toMatchObject({
      applied: true,
      settlementApplied: true,
      incident: {
        notification: { status: "delivered", attempts: 1 },
      },
    });
    expect(observed[0].notification.status).toBe("delivering");
    expect(readBackgroundAgentState("bg-needs")).toMatchObject({
      phase: "needs_input",
      needsInputIncident: {
        status: "needs_input",
        notification: { status: "delivered", attempts: 1 },
      },
    });

    await expect(
      deliverBackgroundNeedsInputNotification("bg-needs", { notify }),
    ).resolves.toMatchObject({
      applied: false,
      reason: "delivery_not_retryable",
    });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("allows an explicit retry after channels are configured", async () => {
    writePending();
    await deliverBackgroundNeedsInputNotification("bg-needs", {
      notify: async () => ({ channels: 0, delivered: [], failed: [] }),
    });
    expect(
      readBackgroundAgentState("bg-needs").needsInputIncident.notification
        .status,
    ).toBe("unconfigured");

    const retry = await deliverBackgroundNeedsInputNotification("bg-needs", {
      retry: true,
      notify: async () => ({
        channels: 1,
        delivered: ["wecom"],
        failed: [],
      }),
    });
    expect(retry.incident.notification).toMatchObject({
      status: "delivered",
      attempts: 2,
    });
  });

  it("requires force before replaying an ambiguous external outcome", async () => {
    writePending();
    await deliverBackgroundNeedsInputNotification("bg-needs", {
      notify: async () => {
        throw Object.assign(new Error("connection reset"), {
          code: "ECONNRESET",
        });
      },
    });
    expect(
      readBackgroundAgentState("bg-needs").needsInputIncident.notification,
    ).toMatchObject({
      status: "outcome_unknown",
      error: { code: "ECONNRESET", message: "connection reset" },
    });

    await expect(
      deliverBackgroundNeedsInputNotification("bg-needs", {
        retry: true,
        notify: vi.fn(),
      }),
    ).resolves.toMatchObject({
      applied: false,
      reason: "delivery_not_retryable",
    });

    const forced = await deliverBackgroundNeedsInputNotification("bg-needs", {
      retry: true,
      force: true,
      notify: async () => ({
        channels: 1,
        delivered: ["telegram"],
        failed: [],
      }),
    });
    expect(forced.incident.notification).toMatchObject({
      status: "delivered",
      attempts: 2,
    });
  });
});
