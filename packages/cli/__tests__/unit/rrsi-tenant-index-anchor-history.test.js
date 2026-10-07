import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  inspectRrsiTenantIndexHistory,
  verifyRrsiTenantIndexAnchorHistory,
  RRSI_TENANT_INDEX_ANCHOR_HISTORY_HOLD_CODE as HOLD,
} from "../../src/lib/evolution/rrsi-tenant-index-anchor-history.js";
import { captureRrsiObservedTextIndex } from "../../src/lib/evolution/rrsi-observed-text-index.js";
import { rrsiHash } from "../../src/lib/evolution/rrsi-data.js";
import { rrsiFixtureDigest } from "../fixtures/rrsi-shadow-fixture.js";
import {
  openObservedTextFixture,
  openObservedTextIndex,
  registerPreparationPlan,
  reservePreparation,
  observationRequest,
} from "../fixtures/rrsi-observed-text.js";
import { v2FixtureDomainEvent } from "../fixtures/evolution-ledger-v2-store.js";
import {
  historyAnchorInput,
  signHistoryAnchor,
} from "../fixtures/rrsi-anchor-history.js";

const temp = fs.realpathSync.native(os.tmpdir()),
  roots = [];
const text = "\uFEFF# Skill\r\n真实前缀😀e\u0301\r\n",
  otherText = "# Another exact Skill\n";
const clone = (value) => JSON.parse(JSON.stringify(value));
const required = ["generation-unverified", "rrsi-evidence-required"];
const held = (operation, details = {}) =>
  expect(operation).toThrow(
    expect.objectContaining({ code: HOLD, ...details }),
  );
function root() {
  const value = fs.mkdtempSync(path.join(temp, "cc-rrsi-anchor-history-"));
  roots.push(value);
  return value;
}
afterAll(() => {
  vi.restoreAllMocks();
  for (const value of roots) {
    const target = path.resolve(value);
    if (
      path.dirname(target) !== temp ||
      !path.basename(target).startsWith("cc-rrsi-anchor-history-")
    )
      throw new Error("unsafe anchor history fixture cleanup");
    fs.rmSync(target, { recursive: true, force: true });
  }
}, 60_000);

describe.sequential(
  "real captured observed-text history and signed anchor prefixes",
  () => {
    let fixture,
      index,
      another,
      otherIndex,
      keys,
      initial,
      first,
      middle,
      latest,
      firstObservation,
      lastObservation;
    beforeAll(() => {
      fixture = openObservedTextFixture(root());
      index = openObservedTextIndex(fixture);
      keys = generateKeyPairSync("ed25519");
      initial = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    }, 60_000);
    beforeAll(() => {
      registerPreparationPlan(fixture);
      reservePreparation(fixture);
    }, 60_000);
    beforeAll(() => {
      firstObservation = index.registerObservedSkillText(
        observationRequest(fixture, text),
      );
      first = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    }, 60_000);
    beforeAll(() => {
      fixture.store.journal.appendDomainEvent(
        v2FixtureDomainEvent(fixture.store, "between-restrictions"),
      );
      middle = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    }, 60_000);
    beforeAll(() => {
      index.registerObservedSkillText(
        observationRequest(fixture, text, ["source-conflict"]),
      );
    }, 60_000);
    beforeAll(() => {
      lastObservation = index.registerObservedSkillText(
        observationRequest(fixture, otherText, ["publication-incomplete"]),
      );
      latest = inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    }, 60_000);
    beforeAll(() => {
      another = openObservedTextFixture(root());
      otherIndex = openObservedTextIndex(another);
    }, 60_000);
    function pair(from = first.current, to = latest.current) {
      const previousInput = historyAnchorInput(index, from, keys);
      const previous = signHistoryAnchor(previousInput, keys);
      const currentInput = historyAnchorInput(
        index,
        to,
        keys,
        2,
        previous.anchor.anchorDigest,
      );
      return {
        previous,
        current: signHistoryAnchor(currentInput, keys),
        previousInput,
        currentInput,
      };
    }
    function verify(value = pair(), observedTextIndex = index) {
      return verifyRrsiTenantIndexAnchorHistory({
        observedTextIndex,
        previous: value.previous,
        current: value.current,
      });
    }
    it("includes real migration events in an empty restriction prefix without inventing genesis digests", () => {
      const current = initial.current;
      expect(current.checkpoint.sequence).toBeGreaterThanOrEqual(2);
      const prefix = fixture.store.journal
        .read()
        .slice(0, current.checkpoint.sequence);
      expect(prefix.at(-1).eventDigest).toBe(current.checkpoint.headDigest);
      expect(prefix.some((event) => event.type.includes("migration"))).toBe(
        true,
      );
      expect(current.restrictionHistory).toEqual({
        recordCount: 0,
        tailRecordDigest: null,
        restrictionsDigest: rrsiHash(
          "chainlesschain.rrsi-observed-text-restriction-set/v1",
          [],
        ),
      });
      expect(verify(pair(current))).toMatchObject({
        localJournalPrefixVerified: true,
        localRestrictionPrefixVerified: true,
        historyTransferVerified: false,
        originCutoverAuthenticated: false,
      });
    }, 60_000);
    it("authenticates both prefixes from real retained readback while all external authority stays HOLD", () => {
      const result = verify();
      expect(result).toMatchObject({
        localJournalPrefixVerified: true,
        localRestrictionPrefixVerified: true,
        localRetainedHistoryReplayed: true,
        selectedContextOnly: true,
        storageGraphDigestVerified: false,
        rootAuthorityVerified: false,
        installationBindingSignatureVerified: false,
        routingPinVerified: false,
        crossProcessRollbackProtectionVerified: false,
        historyTransferVerified: false,
        originCutoverAuthenticated: false,
        tenantWideIndexAuthorityVerified: false,
        generationProvenanceVerified: false,
        grantsMutationOrPromotionAuthority: false,
        authenticated: false,
        readyForExecution: false,
        qualifiesForPromotion: false,
        decision: "HOLD",
        previous: first.current,
        current: latest.current,
      });
      expect(Object.isFrozen(result.previous.restrictionHistory)).toBe(true);
      expect(result.localCompositionDigest).toBe(latest.localCompositionDigest);
      expect(result).not.toHaveProperty("storageGraphDigest");
    }, 60_000);
    it("keeps non-restriction events in the journal without changing restriction count or union", () => {
      expect(middle.current.checkpoint.sequence).toBe(
        first.current.checkpoint.sequence + 1,
      );
      expect(middle.current.restrictionHistory).toEqual(
        first.current.restrictionHistory,
      );
      expect(verify(pair(middle.current)).previous).toEqual(middle.current);
    }, 60_000);
    it("counts three actual restriction records while unioning two exact text keys deterministically", () => {
      const entries = [
        {
          skillTextDigest: firstObservation.skillTextDigest,
          restrictions: [...required, "source-conflict"].sort(),
        },
        {
          skillTextDigest: lastObservation.skillTextDigest,
          restrictions: [...required, "publication-incomplete"].sort(),
        },
      ].sort((a, b) => (a.skillTextDigest < b.skillTextDigest ? -1 : 1));
      expect(latest.current.restrictionHistory).toEqual({
        recordCount: 3,
        tailRecordDigest: lastObservation.recordDigest,
        restrictionsDigest: rrsiHash(
          "chainlesschain.rrsi-observed-text-restriction-set/v1",
          entries,
        ),
      });
    });
    it("accepts exact signed anchor idempotence only at the actual current head", () => {
      const previous = signHistoryAnchor(
        historyAnchorInput(index, latest.current, keys),
        keys,
      );
      expect(
        verify({ previous, current: clone(previous) })
          .localJournalPrefixVerified,
      ).toBe(true);
      const old = signHistoryAnchor(
        historyAnchorInput(index, first.current, keys),
        keys,
      );
      held(() => verify({ previous: old, current: old }), {
        message: "current anchor is not the actual captured journal head",
      });
    }, 60_000);
    it.each([
      "previous-count",
      "previous-tail",
      "previous-set",
      "current-count",
      "current-tail",
      "current-set",
    ])(
      "rejects genuinely re-signed false %s",
      (mode) => {
        const value = pair();
        const selected = mode.startsWith("previous")
          ? value.previousInput
          : value.currentInput;
        const changed = clone(selected);
        if (mode.endsWith("count")) {
          changed.restrictionHistory.recordCount = 0;
          changed.restrictionHistory.tailRecordDigest = null;
        } else if (mode.endsWith("tail"))
          changed.restrictionHistory.tailRecordDigest =
            rrsiFixtureDigest("wrong-tail");
        else
          changed.restrictionHistory.restrictionsDigest =
            rrsiFixtureDigest("wrong-set");
        if (mode.startsWith("previous")) {
          value.previous = signHistoryAnchor(changed, keys);
          value.current = signHistoryAnchor(
            {
              ...value.currentInput,
              previousAnchorDigest: value.previous.anchor.anchorDigest,
            },
            keys,
          );
        } else value.current = signHistoryAnchor(changed, keys);
        held(() => verify(value), {
          message:
            "anchor restriction declaration differs from retained prefix history",
        });
      },
      60_000,
    );
    it.each([
      "wrong-sequence",
      "other-event-digest",
      "record-digest",
      "zero",
      "stale-current",
    ])(
      "rejects a real signature over %s checkpoint",
      (mode) => {
        const value = pair(),
          changed = clone(value.previousInput);
        if (mode === "stale-current") {
          value.current = signHistoryAnchor(
            { ...value.currentInput, ...middle.current },
            keys,
          );
        } else {
          if (mode === "wrong-sequence") changed.checkpoint.sequence--;
          else if (mode === "other-event-digest")
            changed.checkpoint.headDigest =
              middle.current.checkpoint.headDigest;
          else if (mode === "record-digest")
            changed.checkpoint.headDigest =
              first.current.restrictionHistory.tailRecordDigest;
          else {
            Object.assign(
              changed,
              clone(historyAnchorInput(index, initial.current, keys)),
            );
            changed.checkpoint.sequence = 0;
          }
          value.previous = signHistoryAnchor(changed, keys);
          value.current = signHistoryAnchor(
            {
              ...value.currentInput,
              previousAnchorDigest: value.previous.anchor.anchorDigest,
            },
            keys,
          );
        }
        if (mode === "stale-current") {
          held(() => verify(value), {
            message: "current anchor is not the actual captured journal head",
          });
        } else if (mode === "zero") {
          held(() => verify(value), {
            cause: expect.objectContaining({
              code: "CC_RRSI_CONTENT_PROVENANCE_HOLD",
              cause: expect.objectContaining({
                code: "CC_RRSI_INVALID",
                message:
                  "observed history sequence is outside its allowed range",
              }),
            }),
          });
        } else {
          held(() => verify(value), {
            cause: expect.objectContaining({
              code: "CC_RRSI_CONTENT_PROVENANCE_HOLD",
              message:
                "observed history checkpoint is not the original journal prefix",
            }),
          });
        }
      },
      60_000,
    );
    it.each([
      "jump",
      "wrong-predecessor",
      "same-revision-conflict",
      "backward-checkpoint",
      "changed-graph",
      "changed-deployment",
      "shared-scope",
    ])("rejects signed continuation %s", (mode) => {
      const value = pair(),
        changed = clone(value.currentInput);
      if (mode === "jump") changed.revision = 3;
      else if (mode === "wrong-predecessor")
        changed.previousAnchorDigest = rrsiFixtureDigest("other-anchor");
      else if (mode === "same-revision-conflict") {
        changed.revision = 1;
        changed.previousAnchorDigest = null;
      } else if (mode === "backward-checkpoint")
        Object.assign(changed, clone(initial.current));
      else if (mode === "changed-graph")
        changed.storageGraphDigest = rrsiFixtureDigest("other-graph");
      else if (mode === "changed-deployment")
        changed.deploymentId = "other-deployment";
      else {
        changed.routingScope = "shared-tenant-authority";
        const prev = {
          ...value.previousInput,
          routingScope: changed.routingScope,
        };
        value.previous = signHistoryAnchor(prev, keys);
        changed.previousAnchorDigest = value.previous.anchor.anchorDigest;
      }
      value.current = signHistoryAnchor(changed, keys);
      const messages = {
        jump: "local history anchor must be the exact declared successor",
        "wrong-predecessor":
          "local history anchor must be the exact declared successor",
        "same-revision-conflict":
          "same revision has a different history anchor",
        "backward-checkpoint":
          "local history anchor cannot move its checkpoint backward",
        "changed-graph":
          "local anchor history cannot change storageGraphDigest",
        "changed-deployment": "local anchor history cannot change deploymentId",
        "shared-scope":
          "local history verification requires installation scope",
      };
      held(() => verify(value), { message: messages[mode] });
    });
    it("does not authenticate a caller graph digest even when both signed anchors repeat it", () => {
      const value = pair();
      value.previous = signHistoryAnchor(
        {
          ...value.previousInput,
          storageGraphDigest: rrsiFixtureDigest("arbitrary-graph"),
        },
        keys,
      );
      value.current = signHistoryAnchor(
        {
          ...value.currentInput,
          storageGraphDigest: rrsiFixtureDigest("arbitrary-graph"),
          previousAnchorDigest: value.previous.anchor.anchorDigest,
        },
        keys,
      );
      expect(verify(value)).toMatchObject({
        localJournalPrefixVerified: true,
        storageGraphDigestVerified: false,
        decision: "HOLD",
      });
    }, 60_000);
    it("refuses another genuine backend and index rather than treating tenant equality as global authority", () => {
      expect(otherIndex.descriptor.tenantId).toBe(index.descriptor.tenantId);
      expect(otherIndex.descriptor.ledgerIdentity).not.toEqual(
        index.descriptor.ledgerIdentity,
      );
      held(() => verify(pair(), otherIndex), {
        message:
          "history anchor differs from the original observed index scope",
      });
    }, 60_000);
    it.each(["tenant", "journal", "artifact-scope"])(
      "rejects two consistent signatures that both claim the wrong %s",
      (mode) => {
        const value = pair(),
          before = clone(value.previousInput),
          after = clone(value.currentInput);
        for (const changed of [before, after]) {
          if (mode === "tenant") {
            changed.tenantId = "other-tenant";
            changed.indexId = `rrsi-text.${rrsiHash("chainlesschain.rrsi-observed-text-index/v1", changed.tenantId).slice(7)}`;
          } else if (mode === "journal") {
            changed.ledgerIdentity.identityDigest =
              rrsiFixtureDigest("other-identity");
            changed.checkpoint.identityDigest =
              changed.ledgerIdentity.identityDigest;
          } else changed.artifactScope.audience = "other-audience";
        }
        value.previous = signHistoryAnchor(before, keys);
        value.current = signHistoryAnchor(
          {
            ...after,
            previousAnchorDigest: value.previous.anchor.anchorDigest,
          },
          keys,
        );
        held(() => verify(value), {
          message:
            "history anchor differs from the original observed index scope",
        });
      },
    );
    it("rejects a genuine signature from another root key rather than adopting a replacement root", () => {
      const value = pair(),
        replacement = generateKeyPairSync("ed25519");
      const changed = {
        ...value.currentInput,
        rootPublicKeyDigest: historyAnchorInput(
          index,
          latest.current,
          replacement,
        ).rootPublicKeyDigest,
      };
      value.current = signHistoryAnchor(changed, replacement);
      held(() => verify(value), {
        message: "local anchor history cannot change root key",
      });
    });
    it("does not accept caller prefix results, excess checkpoints or accessor callbacks in the internal capture", () => {
      const captured = captureRrsiObservedTextIndex(index),
        touched = vi.fn();
      expect(() =>
        captured.captureHistoryCheckpoints({
          checkpoints: Array(3).fill(first.current.checkpoint),
        }),
      ).toThrow();
      expect(() =>
        captured.captureHistoryCheckpoints({
          checkpoints: [],
          prefixVerifier: touched,
        }),
      ).toThrow();
      expect(() =>
        captured.captureHistoryCheckpoints(
          new Proxy({ checkpoints: [] }, { get: touched }),
        ),
      ).toThrow();
      expect(touched).not.toHaveBeenCalled();
    });
    it("rejects forged index handles, getters, proxies and supplied prefix callbacks without invoking them", () => {
      const value = pair(),
        touched = vi.fn();
      held(() => verify(value, { ...index }));
      held(() => verify(value, new Proxy(index, { get: touched })));
      const input = {
        observedTextIndex: index,
        previous: value.previous,
        current: value.current,
      };
      Object.defineProperty(input, "previous", {
        enumerable: true,
        get: touched,
      });
      held(() => verifyRrsiTenantIndexAnchorHistory(input));
      held(() =>
        verifyRrsiTenantIndexAnchorHistory({
          observedTextIndex: index,
          previous: value.previous,
          current: value.current,
          prefixVerifier: touched,
        }),
      );
      expect(touched).not.toHaveBeenCalled();
    });
    it("authenticates the entire current suffix even when the requested previous prefix has no text records", () => {
      const manifest = JSON.parse(
        fixture.store
          .resolver({
            ledgerId: index.descriptor.ledgerIdentity.ledgerId,
            epoch: index.descriptor.ledgerIdentity.epoch,
            ref: lastObservation.manifestRef,
            tenantId: index.descriptor.artifactTenantId,
          })
          .bytes.toString("utf8"),
      ).value;
      const chunk = path.join(
        fixture.root,
        "store",
        "artifacts",
        "files",
        `${manifest.chunks[0].ref.ref.split(":").at(-1)}.json`,
      );
      const saved = path.join(fixture.root, "saved-prefix-chunk.json"),
        before = fixture.store.journal.verify();
      fs.renameSync(chunk, saved);
      try {
        held(() => verify(pair(initial.current)));
        expect(fs.existsSync(chunk)).toBe(false);
        expect(fixture.store.journal.verify()).toEqual(before);
      } finally {
        fs.renameSync(saved, chunk);
      }
    }, 60_000);
    it("rechecks a captured head instead of caching success after a new authentic event", () => {
      const capture = captureRrsiObservedTextIndex(
        index,
      ).captureHistoryCheckpoints({
        checkpoints: [first.current.checkpoint, latest.current.checkpoint],
      });
      const before = capture.snapshot.current;
      fixture.store.journal.appendDomainEvent(
        v2FixtureDomainEvent(fixture.store, "after-prefix-capture"),
      );
      expect(() => capture.recheck()).toThrow(
        /head changed after prefix capture/,
      );
      const current = inspectRrsiTenantIndexHistory({
        observedTextIndex: index,
      });
      expect(current.current.checkpoint.sequence).toBe(
        before.checkpoint.sequence + 1,
      );
      expect(current.current.restrictionHistory).toEqual(
        before.restrictionHistory,
      );
      expect(
        verify(pair(before, current.current)).localJournalPrefixVerified,
      ).toBe(true);
    }, 60_000);
  },
);
