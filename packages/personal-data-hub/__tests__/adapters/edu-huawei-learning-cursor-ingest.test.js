"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  HuaweiLearningAdapter,
} = require("../../lib/adapters/edu-huawei-learning");
const {
  HuaweiLearningApiClient,
} = require("../../lib/adapters/edu-huawei-learning/api-client");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/edu-huawei-learning/scan-cursor");
const { generateKeyHex } = require("../../lib/key-providers");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");

const COOKIE = "accountId=555; CASTGC=token";
const ACCOUNT_ID = "555";

async function collect(iterable) {
  const raws = [];
  for await (const raw of iterable) raws.push(raw);
  return raws;
}

let tmpDir;
let vault;

afterEach(() => {
  if (vault) {
    try {
      vault.close();
    } catch {
      // Best-effort test cleanup.
    }
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
});

function sourceEvents() {
  return [
    { kind: "profile", id: "profile-555", uid: "555", nickname: "learner" },
    {
      kind: "study",
      id: "study-1",
      course: "math",
      durationMs: 60_000,
      startAt: 1_700_000_000_000,
    },
    {
      kind: "study",
      id: "study-2",
      course: "physics",
      durationMs: 120_000,
      startAt: 1_700_000_100_000,
    },
  ];
}

function writeSnapshot(events = sourceEvents()) {
  if (!tmpDir) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-huawei-cursor-"));
  }
  const inputPath = path.join(tmpDir, "huawei-learning.json");
  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1_700_000_000_000,
      account: { uid: ACCOUNT_ID, displayName: "learner" },
      events,
    }),
    "utf8",
  );
  return inputPath;
}

describe("Huawei Learning explicit cursor", () => {
  it("lets Registry limits resume one snapshot in a stable private scope", async () => {
    const inputPath = writeSnapshot();
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();
    const adapter = new HuaweiLearningAdapter();
    adapter.rateLimits = {};
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(adapter.name, { inputPath, limit: 1 }),
      );
    }

    expect(reports.map((report) => report.status)).toEqual(["ok", "ok", "ok"]);
    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(reports[0].scope).toMatch(
      /^account:edu-huawei-learning:[0-9a-f]{32}$/u,
    );
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("paginates every study record beyond the former default 20-item page", async () => {
    const calls = [];
    let page = 0;
    const fetch = async (url) => {
      calls.push(url);
      page += 1;
      const body =
        page === 1
          ? {
              code: 0,
              data: {
                hasMore: true,
                records: Array.from({ length: 100 }, (_, index) => ({
                  recordId: index + 1,
                  courseName: `course-${index + 1}`,
                })),
              },
            }
          : {
              code: 0,
              data: {
                hasMore: false,
                records: [{ recordId: 101, courseName: "course-101" }],
              },
            };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      };
    };
    const client = new HuaweiLearningApiClient({ fetch });

    const result = await client.fetchSnapshot(COOKIE, {
      include: { profile: false },
    });

    expect(result.events).toHaveLength(101);
    expect(result.events.at(-1).id).toBe("study-101");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("offset=100");
  });

  it("freezes the complete live collection and resumes without truncation", async () => {
    const calls = [];
    const events = sourceEvents();
    const adapter = new HuaweiLearningAdapter({
      apiClientFactory: () => ({
        lastError: { code: 0, message: "" },
        async fetchSnapshot(cookie, options) {
          calls.push({ cookie, options });
          return {
            account: { uid: ACCOUNT_ID, displayName: "learner" },
            events,
          };
        },
      }),
    });
    adapter.rateLimits = {};
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-huawei-live-"));
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(adapter.name, {
          cookie: COOKIE,
          accountId: ACCOUNT_ID,
          limit: 1,
        }),
      );
    }

    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.cookie).toBe(COOKIE);
      expect(call.options).not.toHaveProperty("limit");
    }
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("fails closed if the live collection or fetch configuration changes", async () => {
    let events = sourceEvents();
    const adapter = new HuaweiLearningAdapter({
      apiClientFactory: () => ({
        lastError: { code: 0, message: "" },
        async fetchSnapshot() {
          return {
            account: { uid: ACCOUNT_ID, displayName: "learner" },
            events,
          };
        },
      }),
    });
    let watermark;
    await collect(
      adapter.sync({
        cookie: COOKIE,
        accountId: ACCOUNT_ID,
        limit: 1,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    await expect(
      collect(
        adapter.sync({
          cookie: COOKIE,
          accountId: ACCOUNT_ID,
          studyPageSize: 25,
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "HUAWEI_LEARNING_CURSOR_CONFIG_CHANGED",
      retryable: false,
    });

    events = [
      sourceEvents()[0],
      sourceEvents()[1],
      { ...sourceEvents()[2], id: "study-9" },
    ];
    await expect(
      collect(
        adapter.sync({
          cookie: COOKIE,
          accountId: ACCOUNT_ID,
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "HUAWEI_LEARNING_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });
});

describe("Huawei Learning cursor validation", () => {
  it("migrates legacy counts and rejects unsupported or completed cursors", () => {
    expect(parseCursor("3")).toMatchObject({
      kind: "legacy-reset",
      cursor: {
        v: 1,
        mode: null,
        source: null,
        config: null,
        after: null,
        upper: null,
      },
    });
    expect(() => parseCursor("edu-huawei-learning:v2:{}")).toThrowError(
      expect.objectContaining({ code: "HUAWEI_LEARNING_CURSOR_UNSUPPORTED" }),
    );
    expect(() =>
      serializeCursor({
        v: 1,
        mode: "snapshot",
        source: "a".repeat(64),
        config: "b".repeat(64),
        after: 3,
        upper: 3,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "HUAWEI_LEARNING_CURSOR_INVALID" }),
    );
  });
});
