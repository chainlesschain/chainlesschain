import { fork, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildRrsiCandidate } from "../../src/lib/evolution/rrsi-contracts.js";
import { openRrsiHistoryStore } from "../fixtures/rrsi-history-store.js";
import { rrsiCandidateInput } from "../fixtures/rrsi-shadow-fixture.js";
import { openLedgerV2Fixture } from "../fixtures/evolution-ledger-v2-store.js";
import { isEvolutionLedgerV2Journal } from "../../src/lib/evolution/evolution-ledger-v2-journal.js";
import { createRrsiHistoryLedgerAdapter } from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";

const worker = fileURLToPath(
  new URL("../fixtures/rrsi-history-process.mjs", import.meta.url),
);
const roots = [];
const children = new Set();
function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "rrsi-history-process-"));
  roots.push(root);
  return {
    root,
    ...openRrsiHistoryStore(root, { initialize: true, ...options }),
  };
}
const invoke = (root, mode, inputFile) =>
  spawnSync(
    process.execPath,
    [worker, root, mode, ...(inputFile ? [inputFile] : [])],
    { encoding: "utf8", timeout: 20_000 },
  );
async function race(root, requests) {
  const controls = requests.map((request, index) => {
    const file = path.join(root, `request-${index}.json`);
    fs.writeFileSync(file, JSON.stringify(request));
    const child = fork(worker, [root, "race-reserve", file], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    children.add(child);
    let readyResolve, resultResolve, rejectReady, rejectResult;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      rejectReady = reject;
    });
    const result = new Promise((resolve, reject) => {
      resultResolve = resolve;
      rejectResult = reject;
    });
    const timer = setTimeout(() => {
      child.kill();
      rejectReady(new Error("worker readiness timeout"));
      rejectResult(new Error("worker result timeout"));
    }, 20_000);
    let received = false;
    child.on("message", (message) => {
      if (message.ready) readyResolve();
      else {
        received = true;
        resultResolve(message);
      }
    });
    child.on("error", (error) => {
      rejectReady(error);
      rejectResult(error);
    });
    const exited = new Promise((resolve) =>
      child.once("exit", (code) => {
        clearTimeout(timer);
        children.delete(child);
        if (!received) {
          const error = new Error(`worker exited ${code}`);
          rejectReady(error);
          rejectResult(error);
        }
        resolve(code);
      }),
    );
    return { child, ready, result, exited };
  });
  await Promise.all(controls.map((entry) => entry.ready));
  controls.forEach(({ child }) => child.send({ go: true }));
  const results = await Promise.all(controls.map((entry) => entry.result));
  await Promise.all(controls.map((entry) => entry.exited));
  return results;
}
afterEach(() => {
  for (const child of children) child.kill();
  children.clear();
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (
      !resolved.startsWith(
        path.resolve(tmpdir()) + path.sep + "rrsi-history-process-",
      )
    )
      throw new Error("unsafe test cleanup target");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe("RRSI actual file and process recovery", () => {
  it("preserves a real migrated v2 journal through registration and reopen", () => {
    const value = fixture();
    const root = path.join(value.root, "v2-store");
    const open = () => {
      const store = openLedgerV2Fixture(root, {
        tenantId: "synthetic-tenant",
        artifactTenantId: "rrsi-artifacts",
        audience: "rrsi-runtime",
      });
      const adapter = createRrsiHistoryLedgerAdapter({
        backend: store.backend,
        artifactPorts: store.artifactPorts,
        ledgerArtifactResolver: store.resolver,
        descriptor: {
          tenantId: "synthetic-tenant",
          artifactTenantId: "rrsi-artifacts",
          goalId: "pm-task-change-export",
          audience: "rrsi-runtime",
          purpose: "evolution-ledger",
        },
        settlementVerifier: value.settlementVerifier,
        now: store.clock,
      });
      return { store, adapter };
    };
    const first = open();
    expect(isEvolutionLedgerV2Journal(first.store.backend.ledger)).toBe(true);
    first.adapter.registerCampaign(value.campaign);
    first.adapter.reserve(value.request());
    const reopened = open();
    expect(isEvolutionLedgerV2Journal(reopened.store.backend.ledger)).toBe(
      true,
    );
    expect(reopened.adapter.reserve(value.request()).newlyCommitted).toBe(
      false,
    );
    expect(reopened.adapter.inspect()).toMatchObject({
      selectionQueries: 1,
      chargedResources: { maxCostMicrounits: "100000" },
    });
  });
  it("preserves a reserved budget when the first process exits normally", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const first = invoke(value.root, "reserve");
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).newlyCommitted).toBe(true);
    const repeated = invoke(value.root, "reserve");
    expect(repeated.status).toBe(0);
    expect(JSON.parse(repeated.stdout).newlyCommitted).toBe(false);
    const recovered = JSON.parse(invoke(value.root, "inspect").stdout);
    expect(recovered).toMatchObject({
      selectionQueries: 1,
      chargedResources: { maxCostMicrounits: "100000" },
      executions: [{ status: "reserved" }],
    });
  });

  it("recovers a committed reservation after hard exit before returning the receipt", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const crashed = invoke(value.root, "crash-reserve");
    expect(crashed.status).toBe(71);
    const recovered = invoke(value.root, "reserve");
    expect(recovered.status).toBe(0);
    expect(JSON.parse(recovered.stdout).newlyCommitted).toBe(false);
    expect(
      openRrsiHistoryStore(value.root).adapter.inspect().selectionQueries,
    ).toBe(1);
  });

  it("permits exactly one of two real processes to claim the same slot", async () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const second = buildRrsiCandidate(
      value.campaign,
      rrsiCandidateInput(value.campaign, "candidate-2"),
    );
    const results = await race(value.root, [
      value.request(),
      value.request({ candidate: second, executionId: "execution-2" }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok).code).toBe("CC_RRSI_SLOT_USED");
    expect(value.adapter.inspect()).toMatchObject({
      selectionQueries: 1,
      candidateCount: 1,
      chargedResources: { maxCostMicrounits: "100000" },
    });
  });

  it("deduplicates the same execution across two competing processes", async () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const results = await race(value.root, [value.request(), value.request()]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      results.map((result) => result.result.newlyCommitted).sort(),
    ).toEqual([false, true]);
    expect(value.adapter.inspect().selectionQueries).toBe(1);
  });

  it("does not hide an uncertain append outcome by issuing another reservation", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const failing = openRrsiHistoryStore(value.root, {
      crashHook: (phase) => {
        if (phase === "after-head")
          throw new Error("TEST response lost after durable head");
      },
    });
    expect(() => failing.adapter.reserve(failing.request())).toThrow(
      /requires readback/,
    );
    const reopened = openRrsiHistoryStore(value.root);
    const recovered = reopened.adapter.reserve(reopened.request());
    expect(recovered.newlyCommitted).toBe(false);
    expect(() => reopened.adapter.recordDispatch(recovered)).toThrow(
      /fresh reservation/,
    );
    expect(reopened.adapter.inspect().selectionQueries).toBe(1);
  });
});
