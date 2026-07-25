"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ZuoyebangAdapter } = require("../../lib/adapters/edu-zuoyebang");
const {
  ZuoyebangApiClient,
} = require("../../lib/adapters/edu-zuoyebang/api-client");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/edu-zuoyebang/scan-cursor");
const { generateKeyHex } = require("../../lib/key-providers");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");

const COOKIE = "ZYBUSS=session-token; uid=12345";
const ACCOUNT_ID = "12345";

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
    {
      kind: "profile",
      id: "profile-12345",
      uid: "12345",
      nickname: "student",
      grade: "grade-8",
    },
    {
      kind: "study",
      id: "study-1",
      subject: "math",
      durationMs: 60_000,
      startAt: 1_700_000_000_000,
    },
    {
      kind: "study",
      id: "study-2",
      subject: "physics",
      durationMs: 120_000,
      startAt: 1_700_000_100_000,
    },
  ];
}

function writeSnapshot(events = sourceEvents()) {
  if (!tmpDir) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-zyb-cursor-"));
  }
  const inputPath = path.join(tmpDir, "zuoyebang.json");
  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1_700_000_000_000,
      account: { uid: ACCOUNT_ID, displayName: "student" },
      events,
    }),
    "utf8",
  );
  return inputPath;
}

describe("Zuoyebang explicit cursor", () => {
  it("lets Registry limits resume one snapshot in a stable private scope", async () => {
    const inputPath = writeSnapshot();
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();
    const adapter = new ZuoyebangAdapter();
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
    expect(reports[0].scope).toMatch(/^account:edu-zuoyebang:[0-9a-f]{32}$/u);
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
              errNo: 0,
              data: {
                hasMore: true,
                list: Array.from({ length: 100 }, (_, index) => ({
                  recordId: index + 1,
                  subjectName: `subject-${index + 1}`,
                })),
              },
            }
          : {
              errNo: 0,
              data: {
                hasMore: false,
                list: [{ recordId: 101, subjectName: "subject-101" }],
              },
            };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      };
    };
    const client = new ZuoyebangApiClient({ fetch });

    const result = await client.fetchSnapshot(COOKIE, {
      include: { profile: false },
    });

    expect(result.events).toHaveLength(101);
    expect(result.events.at(-1).id).toBe("study-101");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("pn=0");
    expect(calls[1]).toContain("pn=1");
  });

  it("freezes the complete live collection and resumes without truncation", async () => {
    const calls = [];
    const events = sourceEvents();
    const adapter = new ZuoyebangAdapter({
      apiClientFactory: () => ({
        lastError: { code: 0, message: "" },
        async fetchSnapshot(cookie, options) {
          calls.push({ cookie, options });
          return {
            account: { uid: ACCOUNT_ID, displayName: "student" },
            events,
          };
        },
      }),
    });
    adapter.rateLimits = {};
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-zyb-live-"));
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
    const adapter = new ZuoyebangAdapter({
      apiClientFactory: () => ({
        lastError: { code: 0, message: "" },
        async fetchSnapshot() {
          return {
            account: { uid: ACCOUNT_ID, displayName: "student" },
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
      code: "ZUOYEBANG_CURSOR_CONFIG_CHANGED",
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
      code: "ZUOYEBANG_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });
});

describe("Zuoyebang cursor validation", () => {
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
    expect(() => parseCursor("edu-zuoyebang:v2:{}")).toThrowError(
      expect.objectContaining({ code: "ZUOYEBANG_CURSOR_UNSUPPORTED" }),
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
      expect.objectContaining({ code: "ZUOYEBANG_CURSOR_INVALID" }),
    );
  });
});
