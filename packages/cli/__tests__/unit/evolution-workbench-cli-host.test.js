import { createHash } from "node:crypto";

import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

import { registerEvolutionWorkbenchCommands } from "../../src/commands/evolution-workbench.js";
import { createEvolutionWorkbenchCliHost } from "../../src/lib/evolution/evolution-workbench-cli-host.js";
import { EVOLUTION_WORKBENCH_PROJECTION_SCHEMA } from "../../src/lib/evolution/evolution-workbench-projection.js";

const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const D = (domain, value = domain) =>
  `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;

function candidate(name, { active = false, status = "approved" } = {}) {
  return {
    packetDigest: D(`packet:${name}`),
    candidateId: D(`candidate:${name}`),
    candidateContentDigest: D(`content:${name}`),
    status,
    decision: status === "pending" ? null : { decision: status },
    why: { evidence: [], parentContentDigest: D(`parent:${name}`) },
    changes: {
      unifiedDiff: `+${name}`,
      candidateDiffDigest: D(`diff:${name}`),
      capabilities: {
        added: [],
        removed: [],
        highRiskAdded: [],
      },
      contentRisk: {
        detected: false,
        findingIds: [],
        contentRiskDigest: D(`risk:${name}`),
      },
    },
    validation: {
      matrixReceiptDigest: D(`matrix:${name}`),
      targetRuntimes: ["cli"],
    },
    actualUsage: {
      active,
      receiptCount: 1,
      completed: 1,
      failedOrBlocked: 0,
      totalCostUsd: 0.1,
    },
  };
}

function fixture(overrides = {}) {
  const current = candidate("current", { active: true });
  const previous = candidate("previous");
  const pending = candidate("pending", { status: "pending" });
  const core = {
    schema: EVOLUTION_WORKBENCH_PROJECTION_SCHEMA,
    tenantId: "tenant:a",
    runId: "run:1",
    skillName: "repair-tests",
    candidates: [current, previous, pending],
  };
  const projection = {
    ...core,
    projectionDigest: D(EVOLUTION_WORKBENCH_PROJECTION_SCHEMA, core),
  };
  const calls = [];
  const ports = {
    projectionLoader: { load: vi.fn(async () => projection) },
    projectionAuthority: {
      retain: vi.fn(async ({ projection: value }) => {
        calls.push("retain");
        return {
          authenticated: true,
          durable: true,
          projectionDigest: value.projectionDigest,
        };
      }),
    },
    identityProvider: {
      current: vi.fn(async () => ({
        authenticated: true,
        durable: true,
        automated: false,
        tenantId: "tenant:a",
        subjectId: "human:alice",
        receiptDigest: D("identity"),
      })),
    },
    activeStateReader: {
      read: vi.fn(async () => ({
        authenticated: true,
        durable: true,
        tenantId: "tenant:a",
        skillName: "repair-tests",
        contentDigest: current.candidateContentDigest,
        stateDigest: D("active-state"),
      })),
    },
    batchExecutor: {
      execute: vi.fn(async (plan) => {
        calls.push("batch");
        return { planDigest: plan.planDigest };
      }),
    },
    rollbackExecutor: {
      execute: vi.fn(async (plan) => {
        calls.push("rollback");
        return { planDigest: plan.planDigest };
      }),
    },
    ...overrides,
  };
  return {
    current,
    previous,
    pending,
    projection,
    ports,
    calls,
    host: createEvolutionWorkbenchCliHost({ tenantId: "tenant:a", ...ports }),
  };
}

describe("Evolution Workbench CLI host", () => {
  it("lists and compares only a verified tenant projection", async () => {
    const h = fixture();
    const listed = await h.host.list({ status: "pending" });
    expect(listed.candidates).toHaveLength(1);
    const compared = await h.host.compare(
      h.current.packetDigest,
      h.previous.packetDigest,
    );
    expect(compared.left.contentDigest).toBe(h.current.candidateContentDigest);
    expect(compared.right.contentDigest).toBe(
      h.previous.candidateContentDigest,
    );
  });

  it("uses deployment identity and retains the projection before batch review", async () => {
    const h = fixture();
    const result = await h.host.review({
      packetDigests: [h.pending.packetDigest],
      decision: "approve",
      reason: "Evidence and target matrix reviewed.",
    });
    expect(result.planDigest).toMatch(/^sha256:/u);
    expect(h.ports.batchExecutor.execute.mock.calls[0][0].requestedBy).toBe(
      "human:alice",
    );
    expect(h.calls).toEqual(["retain", "batch"]);
  });

  it("reads the durable active state before an approved rollback", async () => {
    const h = fixture();
    const result = await h.host.rollback({
      fromPacketDigest: h.current.packetDigest,
      toPacketDigest: h.previous.packetDigest,
      reason: "Canary regression.",
    });
    expect(result.planDigest).toMatch(/^sha256:/u);
    expect(h.ports.rollbackExecutor.execute.mock.calls[0][0]).toMatchObject({
      requestedBy: "human:alice",
      expectedActiveStateDigest: D("active-state"),
    });
    expect(h.calls).toEqual(["retain", "rollback"]);
  });

  it("fails closed for an automated identity before retaining or mutation", async () => {
    const h = fixture({
      identityProvider: {
        current: vi.fn(async () => ({
          authenticated: true,
          durable: true,
          automated: true,
          tenantId: "tenant:a",
          subjectId: "bot:1",
          receiptDigest: D("bot"),
        })),
      },
    });
    await expect(
      h.host.review({
        packetDigests: [h.pending.packetDigest],
        decision: "reject",
        reason: "Automated decision must not pass.",
      }),
    ).rejects.toThrow("durable human identity");
    expect(h.ports.projectionAuthority.retain).not.toHaveBeenCalled();
    expect(h.ports.batchExecutor.execute).not.toHaveBeenCalled();
  });

  it("fails closed when the mutation projection is not durable", async () => {
    const h = fixture({
      projectionAuthority: {
        retain: vi.fn(async () => ({ authenticated: true, durable: false })),
      },
    });
    await expect(
      h.host.rollback({
        fromPacketDigest: h.current.packetDigest,
        toPacketDigest: h.previous.packetDigest,
        reason: "Durability is mandatory.",
      }),
    ).rejects.toThrow("not durably retained");
    expect(h.ports.rollbackExecutor.execute).not.toHaveBeenCalled();
  });

  it("registers the final CLI surface and rejects an unbranded deployment host", async () => {
    const root = new Command().exitOverride();
    const evolution = root.command("evolution");
    registerEvolutionWorkbenchCommands(evolution, { workbenchHost: {} });
    expect(
      evolution.commands.find((command) => command.name() === "workbench"),
    ).toBeDefined();
    await expect(
      root.parseAsync(["node", "cc", "evolution", "workbench", "list"]),
    ).rejects.toThrow("trusted deployment host");
  });

  it("routes the real Commander surface through the branded host", async () => {
    const h = fixture();
    const root = new Command().exitOverride();
    const evolution = root.command("evolution");
    registerEvolutionWorkbenchCommands(evolution, {
      workbenchHost: h.host,
    });
    const printed = vi.spyOn(console, "log").mockImplementation(() => {});
    await root.parseAsync([
      "node",
      "cc",
      "evolution",
      "workbench",
      "list",
      "--status",
      "pending",
    ]);
    expect(JSON.parse(printed.mock.calls[0][0]).candidates).toHaveLength(1);
    printed.mockRestore();
  });
});
