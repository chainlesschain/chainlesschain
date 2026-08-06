import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => process.cwd(),
}));

import {
  getSessionAntiRollbackDirectory,
  listSessionAntiRollbackIds,
  publishSessionAntiRollbackAnchor,
  readSessionAntiRollbackAnchor,
  SESSION_ANTI_ROLLBACK_DETECTED_CODE,
  SESSION_ANTI_ROLLBACK_UNAVAILABLE_CODE,
} from "../../src/lib/session-anti-rollback-anchor.js";

const roots = [];
const GENERATION_SCHEMA = "chainlesschain.session-generation-authority/v1";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-session-anchor-"));
  roots.push(root);
  return {
    root,
    homeDir: path.join(root, "configured-home"),
    anchorBase: path.join(root, "independent-machine-state"),
  };
}

function generation(sessionId, ordinal = 1, predecessor = null) {
  return {
    schema: GENERATION_SCHEMA,
    sessionId,
    generationId: `generation-${String(ordinal).padStart(32, "0")}`,
    ordinal,
    predecessor,
  };
}

function live(sessionId, eventCount, digit, authority = generation(sessionId)) {
  return {
    status: "live",
    generation: authority,
    headHash: digit.repeat(64),
    eventCount,
    deletedAtMs: null,
  };
}

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe("session anti-rollback anchor", () => {
  it("advances a proven prefix and exposes the session namespace", () => {
    const options = fixture();
    const sessionId = "session-forward";
    const first = publishSessionAntiRollbackAnchor(
      sessionId,
      live(sessionId, 1, "a"),
      options,
    );
    const second = publishSessionAntiRollbackAnchor(
      sessionId,
      live(sessionId, 2, "b"),
      {
        ...options,
        provePrefix: (current) => current.recordHash === first.recordHash,
      },
    );

    expect(second.revision).toBe("2");
    expect(second.previousRecordHash).toBe(first.recordHash);
    expect(readSessionAntiRollbackAnchor(sessionId, options)).toEqual(second);
    expect(listSessionAntiRollbackIds(options)).toEqual([sessionId]);
  });

  it("rejects an older or equal-count forked live head", () => {
    const options = fixture();
    const sessionId = "session-rollback";
    publishSessionAntiRollbackAnchor(
      sessionId,
      live(sessionId, 2, "b"),
      options,
    );

    for (const candidate of [
      live(sessionId, 1, "a"),
      live(sessionId, 2, "c"),
    ]) {
      expect(() =>
        publishSessionAntiRollbackAnchor(sessionId, candidate, options),
      ).toThrow(
        expect.objectContaining({
          code: SESSION_ANTI_ROLLBACK_DETECTED_CODE,
          sessionId,
        }),
      );
    }
  });

  it("requires a new live generation to bind the exact anchored tombstone", () => {
    const options = fixture();
    const sessionId = "session-successor";
    const firstGeneration = generation(sessionId);
    publishSessionAntiRollbackAnchor(
      sessionId,
      live(sessionId, 3, "a", firstGeneration),
      options,
    );
    publishSessionAntiRollbackAnchor(
      sessionId,
      {
        status: "deleted",
        generation: firstGeneration,
        headHash: "a".repeat(64),
        eventCount: 3,
        deletedAtMs: 1234,
      },
      options,
    );
    const successor = generation(sessionId, 2, {
      kind: "tombstone",
      generationId: firstGeneration.generationId,
      headHash: "a".repeat(64),
      eventCount: 3,
      tombstonedAtMs: 1234,
    });

    expect(
      publishSessionAntiRollbackAnchor(
        sessionId,
        live(sessionId, 1, "b", successor),
        options,
      ),
    ).toMatchObject({ status: "live", generation: { ordinal: 2 } });
  });

  it("discards only an unterminated crash tail before the next append", () => {
    const options = fixture();
    const sessionId = "session-partial-tail";
    publishSessionAntiRollbackAnchor(
      sessionId,
      live(sessionId, 1, "a"),
      options,
    );
    const directory = getSessionAntiRollbackDirectory(options);
    const digest = crypto.createHash("sha256").update(sessionId).digest("hex");
    const recordPath = path.join(
      directory,
      "records",
      digest.slice(0, 2),
      `${digest}.ndjson`,
    );
    fs.appendFileSync(recordPath, '{"crash":', "utf8");

    expect(
      publishSessionAntiRollbackAnchor(sessionId, live(sessionId, 2, "b"), {
        ...options,
        provePrefix: () => true,
      }),
    ).toMatchObject({ revision: "2", headHash: "b".repeat(64) });
  });

  it("fails closed on a terminated corrupt witness record", () => {
    const options = fixture();
    const sessionId = "session-corrupt";
    publishSessionAntiRollbackAnchor(
      sessionId,
      live(sessionId, 1, "a"),
      options,
    );
    const directory = getSessionAntiRollbackDirectory(options);
    const digest = crypto.createHash("sha256").update(sessionId).digest("hex");
    const recordPath = path.join(
      directory,
      "records",
      digest.slice(0, 2),
      `${digest}.ndjson`,
    );
    fs.appendFileSync(recordPath, "corrupt\n", "utf8");

    expect(() => readSessionAntiRollbackAnchor(sessionId, options)).toThrow(
      expect.objectContaining({
        code: SESSION_ANTI_ROLLBACK_UNAVAILABLE_CODE,
      }),
    );
  });
});
