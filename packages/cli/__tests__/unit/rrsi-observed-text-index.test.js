import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openLedgerV2Fixture } from "../fixtures/evolution-ledger-v2-store.js";
import {
  rrsiCampaignInput,
  rrsiFixtureDigest,
} from "../fixtures/rrsi-shadow-fixture.js";
import { buildRrsiCampaign } from "../../src/lib/evolution/rrsi-contracts.js";
import { createRrsiRegistryStorePolicy } from "../../src/lib/evolution/rrsi-registry-store-policy.js";
import {
  createRrsiHistoryLedgerAdapter,
  captureRrsiHistoryLedgerAdapter,
} from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import {
  createRrsiObservedTextIndex,
  captureRrsiObservedTextIndex,
  encodeRrsiObservedSkillText,
  RRSI_OBSERVED_TEXT_EVENT_TYPE,
  RRSI_OBSERVED_TEXT_HOLD_CODE as HOLD,
} from "../../src/lib/evolution/rrsi-observed-text-index.js";

const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const parent = fs.realpathSync.native(os.tmpdir());
const roots = [];
const text = "\uFEFF# Skill\r\n保留原文😀e\u0301\r\n";
const largeText = "界😀".repeat(12_000);
const scope = {
  tenantId: "synthetic-tenant",
  artifactTenantId: "observed-text-artifacts",
  audience: "rrsi-runtime",
};
function open(root, options = {}) {
  const store = openLedgerV2Fixture(path.join(root, "store"), {
    ...scope,
    ...options,
  });
  const policy = createRrsiRegistryStorePolicy({
    backend: store.backend,
    artifactPorts: store.artifactPorts,
    ledgerArtifactResolver: store.resolver,
    descriptor: { ...scope, purpose: "evolution-ledger" },
  });
  return { root, store, policy };
}
function composition(value) {
  return {
    storePolicy: value.policy,
    backend: value.store.backend,
    artifactPorts: value.store.artifactPorts,
    ledgerArtifactResolver: value.store.resolver,
  };
}
function history(value, goalId = "pm-task-change-export") {
  const campaign = buildRrsiCampaign({ ...rrsiCampaignInput(), goalId });
  const adapter = createRrsiHistoryLedgerAdapter({
    backend: value.store.backend,
    artifactPorts: value.store.artifactPorts,
    ledgerArtifactResolver: value.store.resolver,
    descriptor: { ...scope, goalId, purpose: "evolution-ledger" },
    settlementVerifier: null,
    now: value.store.clock,
  });
  return { adapter, campaign };
}
function prepareRoot(value) {
  value.adapter.registerCampaign(value.campaign);
  value.adapter.registerPreparationPlan({
    campaignDigest: value.campaign.campaignDigest,
    maxAttempts: 4,
    planDigest: rrsiFixtureDigest("plan"),
    manifestDigest: rrsiFixtureDigest("manifest"),
    trainingMappingDigest: rrsiFixtureDigest("mapping"),
    pmTrainingPartitionDigest: rrsiFixtureDigest("partition"),
  });
}
function prepare(value, phase = "candidate-proposal") {
  return value.adapter.reservePreparation({
    campaignDigest: value.campaign.campaignDigest,
    phase,
    sourceTaskIds: ["train-task-0"],
    inputs: {
      instructionDigest: rrsiFixtureDigest("instruction"),
      memoryDigest: rrsiFixtureDigest("memory"),
      artifactDigests: [],
    },
    roundId: "round-1",
    branchId: "branch-1",
    slotId: "slot-1",
    executionId: "prep-1",
    budget: {
      maxTokens: 10_000,
      maxToolCalls: 100,
      maxWallClockMs: 10_000,
      maxCostMicrounits: 100_000,
      maxExecutions: 1,
    },
  });
}
function root() {
  const value = fs.mkdtempSync(path.join(parent, "cc-rrsi-text-index-"));
  roots.push(value);
  return value;
}
function events(value) {
  return value.store.journal
    .read()
    .filter((event) => event.type === RRSI_OBSERVED_TEXT_EVENT_TYPE);
}
function request(adapter, value = text, codes = []) {
  return {
    text: value,
    historyAdapter: adapter,
    preparationExecutionId: "prep-1",
    restrictionCodes: codes,
  };
}
function hold(operation) {
  expect(operation).toThrow(expect.objectContaining({ code: HOLD }));
}
afterAll(() => {
  for (const value of roots) {
    if (
      path.dirname(path.resolve(value)) !== parent ||
      !path.basename(value).startsWith("cc-rrsi-text-index-")
    )
      throw new Error("unsafe text index cleanup");
    fs.rmSync(value, { recursive: true, force: true });
  }
}, 60_000);

describe("exact UTF-8 Skill text encoding", () => {
  it("rejects oversized code units and UTF-8 bytes before allocating a Buffer", () => {
    const inputs = [
      "x".repeat(1024 * 1024 + 1),
      "界".repeat(Math.floor((1024 * 1024) / 3) + 1),
    ];
    const allocation = vi.spyOn(Buffer, "from");
    try {
      for (const input of inputs) {
        hold(() => encodeRrsiObservedSkillText(input));
        expect(allocation.mock.calls.some(([value]) => value === input)).toBe(
          false,
        );
      }
    } finally {
      allocation.mockRestore();
    }
  });
  it("preserves BOM, CRLF, combining characters and supplementary Unicode", () => {
    expect(encodeRrsiObservedSkillText(text)).toEqual(Buffer.from(text));
    expect(digest(encodeRrsiObservedSkillText(text))).not.toBe(
      digest(Buffer.from(text.normalize("NFC").replaceAll("\r\n", "\n"))),
    );
  });
  it.each(["", "\uD800", "\uDC00", "x\uD800y", "x".repeat(1024 * 1024 + 1)])(
    "rejects invalid or oversized text %#",
    (input) => hold(() => encodeRrsiObservedSkillText(input)),
  );
  it("accepts the exact 1 MiB bound without applying the envelope string bound", () => {
    expect(encodeRrsiObservedSkillText("x".repeat(1024 * 1024))).toHaveLength(
      1024 * 1024,
    );
  });
});

describe.sequential(
  "real retained observed text and permanent graph-local restrictions",
  () => {
    let value, first, second, other, otherIndex, index, initial, reopened;
    beforeAll(() => {
      value = open(root());
      first = history(value);
    }, 60_000);
    beforeAll(() => prepareRoot(first), 60_000);
    beforeAll(() => prepare(first), 60_000);
    beforeAll(() => {
      index = createRrsiObservedTextIndex(composition(value));
      initial = index.registerObservedSkillText(request(first.adapter));
    }, 60_000);
    beforeAll(() => {
      second = history(value, "another-goal");
      prepareRoot(second);
    }, 60_000);
    beforeAll(() => prepare(second), 60_000);
    beforeAll(() => {
      other = open(root());
      otherIndex = createRrsiObservedTextIndex(composition(other));
    }, 60_000);
    it("authenticates exact retained bytes and a real declaration without claiming generation, dispatch or tenant-wide authority", () => {
      expect(initial).toMatchObject({
        skillTextDigest: digest(Buffer.from(text)),
        observedBytesAuthenticated: true,
        observationBoundary: "authenticated-retained-readback",
        generationProvenanceVerified: false,
        sourceDerivationVerified: false,
        tenantWideIndexAuthorityVerified: false,
        decision: "HOLD",
        readyForExecution: false,
        qualifiesForPromotion: false,
      });
      expect(initial.restrictions).toEqual([
        "generation-unverified",
        "rrsi-evidence-required",
      ]);
      expect(index.readObservedText(initial.skillTextDigest)).toBe(text);
      expect(
        captureRrsiHistoryLedgerAdapter(first.adapter).resolvePreparation(
          "prep-1",
        ),
      ).toMatchObject({
        reservation: { bindings: { phase: "candidate-proposal" } },
        status: "reserved",
        dispatched: false,
        sourceDerivationVerified: false,
      });
    }, 60_000);
    it("does not append or publish again for the same exact observation", () => {
      const before = value.store.journal.verify();
      const files = fs.readdirSync(
        path.join(value.root, "store", "artifacts", "files"),
      );
      index.registerObservedSkillText(request(first.adapter));
      expect(value.store.journal.verify()).toEqual(before);
      expect(
        fs.readdirSync(path.join(value.root, "store", "artifacts", "files")),
      ).toEqual(files);
      expect(events(value)).toHaveLength(1);
    }, 60_000);
    it("unions restrictions for the same text across genuinely registered goals", () => {
      const stricter = index.registerObservedSkillText(
        request(second.adapter, text, ["cross-pool-exposure"]),
      );
      expect(stricter.restrictions).toEqual([
        "cross-pool-exposure",
        "generation-unverified",
        "rrsi-evidence-required",
      ]);
      expect(stricter.associations.map((entry) => entry.goalId)).toEqual([
        first.campaign.goalId,
        second.campaign.goalId,
      ]);
      expect(stricter.manifestRef).toEqual(initial.manifestRef);
      expect(
        index.registerObservedSkillText(request(first.adapter)).restrictions,
      ).toEqual(stricter.restrictions);
      expect(events(value)).toHaveLength(2);
    }, 60_000);
    it("rejects getters, proxies, copied handles and caller origin exemptions before publishing", () => {
      const touched = vi.fn();
      const accessor = request(first.adapter);
      Object.defineProperty(accessor, "text", {
        enumerable: true,
        get: touched,
      });
      hold(() => index.registerObservedSkillText(accessor));
      hold(() =>
        index.registerObservedSkillText(
          new Proxy(request(first.adapter), { get: touched }),
        ),
      );
      hold(() =>
        index.registerObservedSkillText(request({ ...first.adapter })),
      );
      hold(() => captureRrsiObservedTextIndex({ ...index }));
      hold(() =>
        index.registerObservedSkillText({
          ...request(first.adapter),
          originClass: "ordinary",
        }),
      );
      hold(() =>
        index.registerObservedSkillText(request(first.adapter, text, ["off"])),
      );
      expect(touched).not.toHaveBeenCalled();
      expect(events(value)).toHaveLength(2);
    }, 60_000);
    it("cannot use another genuine graph or an absent preparation as content authority", () => {
      hold(() =>
        createRrsiObservedTextIndex({
          ...composition(value),
          backend: other.store.backend,
        }),
      );
      hold(() => otherIndex.registerObservedSkillText(request(first.adapter)));
      hold(() =>
        index.registerObservedSkillText({
          ...request(first.adapter),
          preparationExecutionId: "absent",
        }),
      );
      hold(() => otherIndex.inspectRestrictions(initial.skillTextDigest));
      hold(() =>
        index.inspectRestrictions(digest(Buffer.from("unknown text"))),
      );
      expect(events(other)).toHaveLength(0);
      expect(events(value)).toHaveLength(2);
    }, 60_000);
    it("retains multiple bounded chunks even when raw text exceeds 8192 code units", () => {
      const result = index.registerObservedSkillText(
        request(first.adapter, largeText),
      );
      expect(result.skillTextDigest).toBe(digest(Buffer.from(largeText)));
      expect(index.readObservedText(result.skillTextDigest)).toBe(largeText);
      expect(result.generationProvenanceVerified).toBe(false);
    }, 120_000);
    it("reopens the original authenticated journal and retains cumulative restrictions", () => {
      reopened = open(value.root);
      const restored = createRrsiObservedTextIndex(composition(reopened));
      expect(restored.readObservedText(initial.skillTextDigest)).toBe(text);
      expect(
        restored.inspectRestrictions(initial.skillTextDigest).restrictions,
      ).toContain("cross-pool-exposure");
      expect(restored.readObservedText(digest(Buffer.from(largeText)))).toBe(
        largeText,
      );
    }, 60_000);
    it("holds when a referenced retained chunk is missing and preserves all existing declarations", () => {
      const manifest = JSON.parse(
        value.store
          .resolver({
            ledgerId: value.store.journal.verify().ledgerId,
            epoch: value.store.journal.verify().epoch,
            tenantId: scope.artifactTenantId,
            ref: initial.manifestRef,
          })
          .bytes.toString(),
      ).value;
      const chunkId = manifest.chunks[0].ref.ref.split(":").at(-1);
      const filesDir = path.join(value.root, "store", "artifacts", "files");
      const chunkPath = path.join(filesDir, `${chunkId}.json`);
      const saved = path.join(value.root, "saved-chunk.json");
      expect(fs.existsSync(chunkPath)).toBe(true);
      fs.renameSync(chunkPath, saved);
      try {
        hold(() => index.readObservedText(initial.skillTextDigest));
        hold(() => createRrsiObservedTextIndex(composition(reopened)));
        expect(fs.existsSync(chunkPath)).toBe(false);
        expect(fs.existsSync(saved)).toBe(true);
      } finally {
        fs.renameSync(saved, chunkPath);
      }
    }, 60_000);
  },
);
