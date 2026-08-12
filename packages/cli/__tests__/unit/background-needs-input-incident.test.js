import { describe, expect, it } from "vitest";
import {
  buildNeedsInputNotification,
  claimNeedsInputNotification,
  closeNeedsInputIncident,
  createNeedsInputIncident,
  settleNeedsInputNotification,
} from "../../src/lib/background-needs-input-incident.js";

function incident() {
  return createNeedsInputIncident({
    runId: "bg-123",
    sessionId: "session-1",
    requestId: "request-1",
    now: 100,
  });
}

describe("background needs-input incident", () => {
  it("binds a deterministic content-free incident to the original run and request", () => {
    const first = incident();
    const second = incident();

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 1,
      runId: "bg-123",
      sessionId: "session-1",
      requestId: "request-1",
      status: "needs_input",
      notification: { status: "pending", attempts: 0 },
    });
    expect(first.incidentId).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(first)).not.toContain("question");
  });

  it("builds a bounded recovery notification without copying prompt content", () => {
    expect(buildNeedsInputNotification(incident())).toEqual({
      title: "Background agent needs input",
      body: expect.stringContaining("cc attach bg-123"),
      level: "info",
      taskId: "bg-123",
    });
  });

  it("claims once and records a successful or partially failed delivery", () => {
    const claim = claimNeedsInputNotification(incident(), { now: 200 });
    expect(claim).toMatchObject({ applied: true, attempt: 1 });
    expect(
      claimNeedsInputNotification(claim.incident, { now: 201 }),
    ).toMatchObject({ applied: false, reason: "delivery_in_progress" });
    expect(
      claimNeedsInputNotification(claim.incident, {
        force: true,
        now: 60_199,
      }),
    ).toMatchObject({ applied: false, reason: "delivery_in_progress" });
    expect(
      claimNeedsInputNotification(claim.incident, {
        force: true,
        now: 60_200,
      }),
    ).toMatchObject({ applied: true, attempt: 2 });

    const settled = settleNeedsInputNotification(claim.incident, {
      attempt: 1,
      result: {
        channels: 2,
        delivered: ["telegram"],
        failed: ["wecom"],
      },
      now: 300,
    });
    expect(settled.incident.notification).toMatchObject({
      status: "partial",
      attempts: 1,
      delivered: ["telegram"],
      failed: ["wecom"],
    });
    expect(
      claimNeedsInputNotification(settled.incident, {
        retry: true,
        now: 400,
      }),
    ).toMatchObject({ applied: false, reason: "delivery_not_retryable" });
    expect(
      claimNeedsInputNotification(settled.incident, {
        force: true,
        now: 400,
      }),
    ).toMatchObject({ applied: true, attempt: 2 });
  });

  it("keeps unconfigured delivery retryable and thrown outcomes fail closed", () => {
    const first = claimNeedsInputNotification(incident(), { now: 200 });
    const unconfigured = settleNeedsInputNotification(first.incident, {
      attempt: 1,
      result: { channels: 0, delivered: [], failed: [] },
      now: 300,
    }).incident;
    expect(unconfigured.notification.status).toBe("unconfigured");

    const retry = claimNeedsInputNotification(unconfigured, {
      retry: true,
      now: 400,
    });
    expect(retry).toMatchObject({ applied: true, attempt: 2 });
    const unknown = settleNeedsInputNotification(retry.incident, {
      attempt: 2,
      error: Object.assign(new Error("socket closed"), { code: "EPIPE" }),
      now: 500,
    }).incident;
    expect(unknown.notification).toMatchObject({
      status: "outcome_unknown",
      error: { code: "EPIPE", message: "socket closed" },
    });
    expect(
      claimNeedsInputNotification(unknown, { retry: true, now: 600 }),
    ).toMatchObject({ applied: false, reason: "delivery_not_retryable" });
    expect(
      claimNeedsInputNotification(unknown, { force: true, now: 600 }),
    ).toMatchObject({ applied: true, attempt: 3 });
  });

  it("closes the incident and prevents later delivery claims", () => {
    const closed = closeNeedsInputIncident(incident(), {
      status: "resolved",
      now: 700,
    });
    expect(closed).toMatchObject({
      status: "resolved",
      closedAt: 700,
      notification: { status: "pending" },
    });
    expect(claimNeedsInputNotification(closed)).toMatchObject({
      applied: false,
      reason: "incident_not_pending",
    });
  });
});
