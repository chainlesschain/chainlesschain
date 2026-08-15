import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => process.cwd(),
}));

import {
  _sessionAntiRollbackFaultHooks,
  getSessionAntiRollbackDirectory,
  listSessionAntiRollbackIds,
  publishSessionAntiRollbackAnchor,
  readSessionAntiRollbackAnchor,
  SESSION_ANTI_ROLLBACK_DETECTED_CODE,
  SESSION_ANTI_ROLLBACK_UNAVAILABLE_CODE,
} from "../../src/lib/session-anti-rollback-anchor.js";

const roots = [];
const GENERATION_SCHEMA = "chainlesschain.session-generation-authority/v1";
const originalFaultInjection =
  process.env.CC_SESSION_ANTI_ROLLBACK_FAULT_INJECTION;

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
  for (const hookName of Object.keys(_sessionAntiRollbackFaultHooks)) {
    _sessionAntiRollbackFaultHooks[hookName] = null;
  }
  if (originalFaultInjection === undefined) {
    delete process.env.CC_SESSION_ANTI_ROLLBACK_FAULT_INJECTION;
  } else {
    process.env.CC_SESSION_ANTI_ROLLBACK_FAULT_INJECTION =
      originalFaultInjection;
  }
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

  it("does not advance readback when the appended record fsync fails", () => {
    const options = fixture();
    const sessionId = "session-record-fsync-failure";
    const first = publishSessionAntiRollbackAnchor(
      sessionId,
      live(sessionId, 1, "a"),
      options,
    );
    process.env.CC_SESSION_ANTI_ROLLBACK_FAULT_INJECTION = "1";
    _sessionAntiRollbackFaultHooks.beforeRecordFsync = ({ record }) => {
      if (record.revision !== "2") return;
      const error = new Error("injected anti-rollback record fsync failure");
      error.code = "EIO";
      throw error;
    };

    expect(() =>
      publishSessionAntiRollbackAnchor(sessionId, live(sessionId, 2, "b"), {
        ...options,
        provePrefix: () => true,
      }),
    ).toThrow(
      expect.objectContaining({
        code: SESSION_ANTI_ROLLBACK_UNAVAILABLE_CODE,
      }),
    );

    expect(readSessionAntiRollbackAnchor(sessionId, options)).toEqual(first);

    _sessionAntiRollbackFaultHooks.beforeRecordFsync = null;
    expect(
      publishSessionAntiRollbackAnchor(sessionId, live(sessionId, 2, "b"), {
        ...options,
        provePrefix: () => true,
      }),
    ).toMatchObject({ revision: "2", headHash: "b".repeat(64) });
  });

  it("removes a first record when failure is injected immediately after open", () => {
    const options = fixture();
    const sessionId = "session-first-open-failure";
    process.env.CC_SESSION_ANTI_ROLLBACK_FAULT_INJECTION = "1";
    _sessionAntiRollbackFaultHooks.afterRecordOpen = () => {
      const error = new Error("injected first-record post-open failure");
      error.code = "EIO";
      throw error;
    };

    expect(() =>
      publishSessionAntiRollbackAnchor(
        sessionId,
        live(sessionId, 1, "a"),
        options,
      ),
    ).toThrow(
      expect.objectContaining({
        code: SESSION_ANTI_ROLLBACK_UNAVAILABLE_CODE,
        commitState: "not-committed",
        rollbackState: "restored",
      }),
    );
    expect(readSessionAntiRollbackAnchor(sessionId, options)).toBeNull();

    _sessionAntiRollbackFaultHooks.afterRecordOpen = null;
    expect(
      publishSessionAntiRollbackAnchor(
        sessionId,
        live(sessionId, 1, "a"),
        options,
      ),
    ).toMatchObject({ revision: "1", headHash: "a".repeat(64) });
  });

  it.skipIf(process.platform === "win32")(
    "directory-fsyncs a zero-byte first-record crash residue on retry",
    () => {
      const options = fixture();
      const sessionId = "session-empty-first-record-retry";
      const directory = getSessionAntiRollbackDirectory(options);
      const digest = crypto
        .createHash("sha256")
        .update(sessionId)
        .digest("hex");
      const recordDirectory = path.join(
        directory,
        "records",
        digest.slice(0, 2),
      );
      const recordPath = path.join(recordDirectory, `${digest}.ndjson`);
      fs.mkdirSync(recordDirectory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(recordPath, "", { mode: 0o600 });
      process.env.CC_SESSION_ANTI_ROLLBACK_FAULT_INJECTION = "1";
      const observed = [];
      _sessionAntiRollbackFaultHooks.beforeRecordDirectoryFsync = (payload) =>
        observed.push(payload);

      expect(
        publishSessionAntiRollbackAnchor(
          sessionId,
          live(sessionId, 1, "a"),
          options,
        ),
      ).toMatchObject({ revision: "1", headHash: "a".repeat(64) });
      expect(observed).toEqual([
        expect.objectContaining({
          recordPath,
          createsRecord: false,
          recoveredEmptyRecord: true,
        }),
      ]);
    },
  );

  it("classifies a failed rollback as unknown and permits exact-new readback", () => {
    const options = fixture();
    const sessionId = "session-record-rollback-failure";
    publishSessionAntiRollbackAnchor(
      sessionId,
      live(sessionId, 1, "a"),
      options,
    );
    process.env.CC_SESSION_ANTI_ROLLBACK_FAULT_INJECTION = "1";
    _sessionAntiRollbackFaultHooks.beforeRecordFsync = ({ record }) => {
      if (record.revision === "2") throw new Error("injected fsync failure");
    };
    _sessionAntiRollbackFaultHooks.beforeRecordRollback = () => {
      const error = new Error("injected rollback failure");
      error.code = "EIO";
      throw error;
    };

    expect(() =>
      publishSessionAntiRollbackAnchor(sessionId, live(sessionId, 2, "b"), {
        ...options,
        provePrefix: () => true,
      }),
    ).toThrow(
      expect.objectContaining({
        code: SESSION_ANTI_ROLLBACK_UNAVAILABLE_CODE,
        commitState: "unknown",
        rollbackState: "failed",
        rollbackErrorCode: "EIO",
      }),
    );
    // The caller received outcome-unknown and must adjudicate instead of
    // blindly replaying. A complete hash-linked record is one allowed exact
    // outcome; torn/corrupt records remain rejected by the normal reader.
    expect(readSessionAntiRollbackAnchor(sessionId, options)).toMatchObject({
      revision: "2",
      headHash: "b".repeat(64),
    });

    _sessionAntiRollbackFaultHooks.beforeRecordRollback = null;
    const settled = [];
    _sessionAntiRollbackFaultHooks.beforeRecordFsync = (payload) =>
      settled.push(payload);
    expect(
      publishSessionAntiRollbackAnchor(sessionId, live(sessionId, 2, "b"), {
        ...options,
        provePrefix: () => true,
      }),
    ).toMatchObject({ revision: "2", headHash: "b".repeat(64) });
    expect(settled).toEqual([
      expect.objectContaining({
        record: expect.objectContaining({ revision: "2" }),
        createsRecord: false,
        unchanged: true,
      }),
    ]);
  });

  it("settles a complete first-record crash residue before exact retry success", () => {
    const options = fixture();
    const sessionId = "session-complete-first-record-retry";
    process.env.CC_SESSION_ANTI_ROLLBACK_FAULT_INJECTION = "1";
    _sessionAntiRollbackFaultHooks.beforeRecordFsync = ({ unchanged }) => {
      if (!unchanged) throw new Error("injected first-record fsync failure");
    };
    _sessionAntiRollbackFaultHooks.beforeRecordRollback = () => {
      const error = new Error("injected first-record rollback failure");
      error.code = "EIO";
      throw error;
    };

    expect(() =>
      publishSessionAntiRollbackAnchor(
        sessionId,
        live(sessionId, 1, "a"),
        options,
      ),
    ).toThrow(
      expect.objectContaining({
        code: SESSION_ANTI_ROLLBACK_UNAVAILABLE_CODE,
        commitState: "unknown",
        rollbackState: "failed",
      }),
    );
    expect(readSessionAntiRollbackAnchor(sessionId, options)).toMatchObject({
      revision: "1",
      headHash: "a".repeat(64),
    });

    _sessionAntiRollbackFaultHooks.beforeRecordRollback = null;
    const settled = [];
    _sessionAntiRollbackFaultHooks.beforeRecordFsync = (payload) =>
      settled.push({ boundary: "file", ...payload });
    _sessionAntiRollbackFaultHooks.beforeRecordDirectoryFsync = (payload) =>
      settled.push({ boundary: "directory", ...payload });
    expect(
      publishSessionAntiRollbackAnchor(
        sessionId,
        live(sessionId, 1, "a"),
        options,
      ),
    ).toMatchObject({ revision: "1", headHash: "a".repeat(64) });
    expect(settled).toEqual(
      process.platform === "win32"
        ? [
            expect.objectContaining({
              boundary: "file",
              unchanged: true,
            }),
          ]
        : [
            expect.objectContaining({
              boundary: "file",
              unchanged: true,
            }),
            expect.objectContaining({
              boundary: "directory",
              recoveredCompleteRecord: true,
            }),
          ],
    );
  });

  it("settles a complete first-record crash residue before advancing", () => {
    const options = fixture();
    const sessionId = "session-complete-first-record-advance";
    process.env.CC_SESSION_ANTI_ROLLBACK_FAULT_INJECTION = "1";
    _sessionAntiRollbackFaultHooks.beforeRecordFsync = ({ record }) => {
      if (record.revision === "1") {
        throw new Error("injected first-record fsync failure");
      }
    };
    _sessionAntiRollbackFaultHooks.beforeRecordRollback = () => {
      const error = new Error("injected first-record rollback failure");
      error.code = "EIO";
      throw error;
    };

    expect(() =>
      publishSessionAntiRollbackAnchor(
        sessionId,
        live(sessionId, 1, "a"),
        options,
      ),
    ).toThrow(
      expect.objectContaining({
        code: SESSION_ANTI_ROLLBACK_UNAVAILABLE_CODE,
        commitState: "unknown",
      }),
    );

    _sessionAntiRollbackFaultHooks.beforeRecordRollback = null;
    const settled = [];
    _sessionAntiRollbackFaultHooks.beforeRecordFsync = (payload) =>
      settled.push({ boundary: "file", ...payload });
    _sessionAntiRollbackFaultHooks.beforeRecordDirectoryFsync = (payload) =>
      settled.push({ boundary: "directory", ...payload });
    expect(
      publishSessionAntiRollbackAnchor(sessionId, live(sessionId, 2, "b"), {
        ...options,
        provePrefix: () => true,
      }),
    ).toMatchObject({ revision: "2", headHash: "b".repeat(64) });
    expect(settled).toEqual(
      process.platform === "win32"
        ? [
            expect.objectContaining({
              boundary: "file",
              record: expect.objectContaining({ revision: "1" }),
              unchanged: true,
            }),
            expect.objectContaining({
              boundary: "file",
              record: expect.objectContaining({ revision: "2" }),
            }),
          ]
        : [
            expect.objectContaining({
              boundary: "file",
              record: expect.objectContaining({ revision: "1" }),
              unchanged: true,
            }),
            expect.objectContaining({
              boundary: "directory",
              record: expect.objectContaining({ revision: "1" }),
              recoveredCompleteRecord: true,
            }),
            expect.objectContaining({
              boundary: "file",
              record: expect.objectContaining({ revision: "2" }),
            }),
          ],
    );
  });

  it.skipIf(process.platform === "win32")(
    "does not expose a first record when its directory fsync fails",
    () => {
      const options = fixture();
      const sessionId = "session-record-directory-fsync-failure";
      process.env.CC_SESSION_ANTI_ROLLBACK_FAULT_INJECTION = "1";
      _sessionAntiRollbackFaultHooks.beforeRecordDirectoryFsync = () => {
        const error = new Error(
          "injected anti-rollback record directory fsync failure",
        );
        error.code = "EIO";
        throw error;
      };

      expect(() =>
        publishSessionAntiRollbackAnchor(
          sessionId,
          live(sessionId, 1, "a"),
          options,
        ),
      ).toThrow(
        expect.objectContaining({
          code: SESSION_ANTI_ROLLBACK_UNAVAILABLE_CODE,
        }),
      );
      expect(readSessionAntiRollbackAnchor(sessionId, options)).toBeNull();

      _sessionAntiRollbackFaultHooks.beforeRecordDirectoryFsync = null;
      expect(
        publishSessionAntiRollbackAnchor(
          sessionId,
          live(sessionId, 1, "a"),
          options,
        ),
      ).toMatchObject({ revision: "1", headHash: "a".repeat(64) });
    },
  );

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
