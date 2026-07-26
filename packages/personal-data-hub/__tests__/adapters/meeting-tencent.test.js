"use strict";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const nodeFs = require("node:fs");
const { assertAdapter } = require("../../lib/adapter-spec");
const { EVENT_SUBTYPES, PERSON_SUBTYPES } = require("../../lib/constants");
const { validateEvent, validatePerson } = require("../../lib/schemas");
const {
  TencentMeetingAdapter,
  TENCENT_MEETING_NAME,
  TENCENT_MEETING_VERSION,
  DEFAULT_MAX_PARTICIPANTS,
  defaultTencentMeetingRoot,
  findTencentMeetingHistoryDb,
  MAX_MAX_PARTICIPANTS,
  MAX_PARTICIPANTS_JSON_BYTES,
  readTencentMeetingHistory,
  unixTimeToMs,
} = require("../../lib/adapters/meeting-tencent");

const MEETING_A_BEGIN_MS = 1_700_000_000_000;
const MEETING_B_BEGIN_MS = 1_700_001_000_000;
const SOURCE_MTIME_MS = 1_700_005_000_000;

let tempDir;
let rootDir;
let dbPath;

function buildFixture() {
  const databaseDir = join(rootDir, "Global", "Database");
  mkdirSync(databaseDir, { recursive: true });

  const unrelated = new Database(join(databaseDir, "unrelated.db"));
  unrelated.exec("CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT)");
  unrelated.close();

  dbPath = join(databaseDir, "7b767350-fixture.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE historical_meetings_cloud_cache(
      id INTEGER PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      period_id TEXT,
      meeting_subject TEXT,
      meeting_begin_time INTEGER NOT NULL,
      meeting_end_time INTEGER,
      creator_nickname TEXT,
      creator_app_uid TEXT,
      meeting_type INTEGER,
      media_set_type INTEGER,
      meeting_description TEXT,
      activity_name TEXT,
      activity_sponsor_name TEXT,
      meeting_remark TEXT,
      meeting_docs_name TEXT,
      meeting_docs_num INTEGER,
      record_num INTEGER,
      record_duration INTEGER,
      record_ai_summarize TEXT,
      chat_num INTEGER,
      participants_json TEXT,
      participants_count INTEGER,
      has_ai_summary INTEGER,
      ai_summary_num INTEGER,
      record_status INTEGER,
      record_permission INTEGER
    );
    CREATE TABLE historical_meetings_new(
      id INTEGER PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      period_id TEXT,
      meeting_subject TEXT,
      meeting_begin_time INTEGER NOT NULL,
      meeting_end_time INTEGER,
      meeting_join_time INTEGER,
      meeting_leave_time INTEGER,
      meeting_total_elapsed_time INTEGER,
      creator_nickname TEXT,
      creator_app_uid TEXT,
      participants_json TEXT,
      participants_count INTEGER
    );
  `);
  const insertCloud = db.prepare(`
    INSERT INTO historical_meetings_cloud_cache(
      id, meeting_id, period_id, meeting_subject, meeting_begin_time,
      meeting_end_time, creator_nickname, creator_app_uid, meeting_type,
      media_set_type, meeting_description, activity_name,
      activity_sponsor_name, meeting_remark, meeting_docs_name,
      meeting_docs_num, record_num, record_duration, record_ai_summarize,
      chat_num, participants_json, participants_count, has_ai_summary,
      ai_summary_num, record_status, record_permission
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  insertCloud.run(
    1,
    "secret-meeting-a",
    "period-a",
    "Architecture review",
    MEETING_A_BEGIN_MS / 1000,
    MEETING_A_BEGIN_MS / 1000 + 3600,
    "Host Alice",
    "creator-secret-id",
    2,
    1,
    "Review the data collection architecture.",
    "Engineering forum",
    "Architecture guild",
    "Follow up next week.",
    "Architecture notes",
    2,
    1,
    1200,
    "The team agreed on the incremental design.",
    8,
    JSON.stringify([
      {
        app_id: "1400187600",
        app_uid: "participant-secret-1",
        nick_name: "Alice",
      },
      {
        app_id: "1400187600",
        app_uid: "participant-secret-2",
        nick_name: "Bob",
      },
    ]),
    2,
    1,
    1,
    2,
    1,
  );
  insertCloud.run(
    2,
    "secret-meeting-b",
    "period-b",
    "Weekly sync",
    MEETING_B_BEGIN_MS / 1000,
    MEETING_B_BEGIN_MS / 1000 + 1800,
    "Bob",
    "creator-secret-2",
    1,
    0,
    "",
    "",
    "",
    "",
    "",
    0,
    0,
    0,
    "",
    0,
    "[]",
    0,
    0,
    0,
    0,
    0,
  );
  db.prepare(
    `INSERT INTO historical_meetings_new(
       id, meeting_id, period_id, meeting_subject, meeting_begin_time,
       meeting_end_time, meeting_join_time, meeting_leave_time,
       meeting_total_elapsed_time, creator_nickname, creator_app_uid,
       participants_json, participants_count
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    10,
    "secret-meeting-a",
    "period-a",
    "Architecture review (updated)",
    MEETING_A_BEGIN_MS / 1000,
    MEETING_A_BEGIN_MS / 1000 + 3600,
    MEETING_A_BEGIN_MS / 1000 + 60,
    MEETING_A_BEGIN_MS / 1000 + 3540,
    3480,
    "Host Alice",
    "creator-secret-id",
    "",
    0,
  );
  db.close();
  utimesSync(dbPath, SOURCE_MTIME_MS / 1000, SOURCE_MTIME_MS / 1000);
}

function replaceFixtureParticipants(participantsJson, participantCount = 1) {
  const db = new Database(dbPath);
  db.prepare(
    `UPDATE historical_meetings_cloud_cache
        SET participants_json = ?, participants_count = ?
      WHERE meeting_id = ?`,
  ).run(participantsJson, participantCount, "secret-meeting-a");
  db.close();
  utimesSync(dbPath, SOURCE_MTIME_MS / 1000, SOURCE_MTIME_MS / 1000);
}

async function collect(adapter, opts = {}) {
  const records = [];
  for await (const record of adapter.sync(opts)) records.push(record);
  return records;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "meeting-tencent-test-"));
  rootDir = join(tempDir, "Tencent", "WeMeet");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Tencent Meeting local history reader", () => {
  it("collects participants beyond the former 1,000-person default", () => {
    buildFixture();
    const participantCount = 1_001;
    const participants = Array.from(
      { length: participantCount },
      (_, index) => ({
        nick_name: `Participant ${index}`,
        app_uid: `participant-${index}`,
      }),
    );
    replaceFixtureParticipants(JSON.stringify(participants), participantCount);

    const result = readTencentMeetingHistory(dbPath, {
      sourceMtimeMs: SOURCE_MTIME_MS,
    });
    const meeting = result.meetings.find(
      (entry) => entry.meetingId === "secret-meeting-a",
    );

    expect(DEFAULT_MAX_PARTICIPANTS).toBe(MAX_MAX_PARTICIPANTS);
    expect(meeting.participants).toHaveLength(participantCount);
    expect(meeting.participantsTruncated).toBe(false);
    expect(result.complete).toBe(true);
  });

  it("resolves official Windows and macOS data roots", () => {
    expect(
      defaultTencentMeetingRoot({
        platform: "win32",
        appData: join(tempDir, "AppData"),
      }),
    ).toBe(join(tempDir, "AppData", "Tencent", "WeMeet"));
    expect(
      defaultTencentMeetingRoot({
        platform: "darwin",
        homedir: tempDir,
      }),
    ).toBe(
      join(
        tempDir,
        "Library",
        "Containers",
        "com.tencent.meeting",
        "Data",
        "Library",
      ),
    );
  });

  it("discovers a hash-named history database by schema", () => {
    buildFixture();
    const found = findTencentMeetingHistoryDb(rootDir);
    expect(found.dbPath).toBe(dbPath);
    expect(found.tables).toEqual([
      "historical_meetings_cloud_cache",
      "historical_meetings_new",
    ]);
    expect(found.scopePath).toBe(rootDir);
  });

  it("discovers a history database beyond the former 256-file probe limit", () => {
    buildFixture();
    const databaseDir = join(rootDir, "Global", "Database");
    for (let index = 0; index < 256; index += 1) {
      writeFileSync(
        join(
          databaseDir,
          `0000-unrelated-${String(index).padStart(3, "0")}.db`,
        ),
        "",
      );
    }

    const found = findTencentMeetingHistoryDb(rootDir);

    expect(found.dbPath).toBe(dbPath);
  });

  it("merges cloud and new history rows without losing participants", () => {
    buildFixture();
    const result = readTencentMeetingHistory(dbPath, {
      since: 0,
      limit: 10,
      sourceMtimeMs: SOURCE_MTIME_MS,
    });
    expect(result.complete).toBe(true);
    expect(result.meetings).toHaveLength(2);
    expect(result.meetings[0]).toMatchObject({
      meetingId: "secret-meeting-a",
      subject: "Architecture review (updated)",
      beginTimeMs: MEETING_A_BEGIN_MS,
      joinTimeMs: MEETING_A_BEGIN_MS + 60_000,
      leaveTimeMs: MEETING_A_BEGIN_MS + 3_540_000,
      elapsedSeconds: 3480,
      participantCount: 2,
      participantsTruncated: false,
      recordCount: 1,
      hasAiSummary: true,
      capturedAt: SOURCE_MTIME_MS,
    });
    expect(result.meetings[0].participants).toEqual([
      {
        appId: "1400187600",
        appUid: "participant-secret-1",
        displayName: "Alice",
      },
      {
        appId: "1400187600",
        appUid: "participant-secret-2",
        displayName: "Bob",
      },
    ]);
  });

  it("does not read participant or artifact columns when their streams are excluded", () => {
    buildFixture();
    const result = readTencentMeetingHistory(dbPath, {
      includeParticipants: false,
      includeArtifacts: false,
      sourceMtimeMs: SOURCE_MTIME_MS,
    });
    expect(result.complete).toBe(true);
    expect(result.meetings).toHaveLength(2);
    expect(result.meetings[0]).not.toHaveProperty("creatorNickname");
    expect(result.meetings[0]).not.toHaveProperty("participants");
    expect(result.meetings[0]).not.toHaveProperty("participantCount");
    expect(result.meetings[0]).not.toHaveProperty("documentName");
    expect(result.meetings[0]).not.toHaveProperty("recordAiSummary");
    expect(result.meetings[0]).not.toHaveProperty("chatCount");
  });

  it("marks count, field, malformed, and byte-budget participant loss incomplete", () => {
    buildFixture();
    const boundary = readTencentMeetingHistory(dbPath, {
      maxParticipants: 2,
      sourceMtimeMs: SOURCE_MTIME_MS,
    });
    expect(boundary.complete).toBe(true);
    expect(boundary.meetings[0].participantsTruncated).toBe(false);

    const countTruncated = readTencentMeetingHistory(dbPath, {
      maxParticipants: 1,
      sourceMtimeMs: SOURCE_MTIME_MS,
    });
    expect(countTruncated.complete).toBe(false);
    expect(countTruncated.meetings[0].participants).toHaveLength(1);
    expect(countTruncated.meetings[0].participantsTruncated).toBe(true);

    replaceFixtureParticipants(
      JSON.stringify([{ app_uid: "partial-id", nick_name: "Partial" }]),
      2,
    );
    const sourceTruncated = readTencentMeetingHistory(dbPath, {
      sourceMtimeMs: SOURCE_MTIME_MS,
    });
    expect(sourceTruncated.complete).toBe(false);
    expect(sourceTruncated.meetings[0].participantsTruncated).toBe(true);

    replaceFixtureParticipants(
      JSON.stringify([{ app_uid: "bounded-id", nick_name: "N".repeat(501) }]),
    );
    const fieldTruncated = readTencentMeetingHistory(dbPath, {
      sourceMtimeMs: SOURCE_MTIME_MS,
    });
    expect(fieldTruncated.complete).toBe(false);
    expect(fieldTruncated.meetings[0].participants[0].displayName).toHaveLength(
      500,
    );
    expect(fieldTruncated.meetings[0].participantsTruncated).toBe(true);

    replaceFixtureParticipants("{not-json");
    expect(
      readTencentMeetingHistory(dbPath, {
        sourceMtimeMs: SOURCE_MTIME_MS,
      }).complete,
    ).toBe(false);

    replaceFixtureParticipants(
      JSON.stringify([
        {
          app_uid: "over-budget-id",
          nick_name: "B".repeat(MAX_PARTICIPANTS_JSON_BYTES),
        },
      ]),
    );
    const overBudget = readTencentMeetingHistory(dbPath, {
      sourceMtimeMs: SOURCE_MTIME_MS,
    });
    expect(overBudget.complete).toBe(false);
    expect(overBudget.meetings[0].participants).toEqual([]);
    expect(overBudget.meetings[0].participantsTruncated).toBe(true);
  });

  it("normalizes seconds, milliseconds, and microseconds", () => {
    expect(unixTimeToMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(unixTimeToMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(unixTimeToMs(1_700_000_000_000_000)).toBe(1_700_000_000_000);
    expect(unixTimeToMs("bad")).toBeNull();
  });
});

describe("TencentMeetingAdapter collection, privacy, and normalization", () => {
  it("publishes a lazy bounded local adapter contract", async () => {
    let discoveryCalls = 0;
    const adapter = new TencentMeetingAdapter({
      defaultRoot: () => {
        discoveryCalls += 1;
        return null;
      },
    });
    expect(assertAdapter(adapter)).toEqual({ ok: true });
    expect(adapter.name).toBe(TENCENT_MEETING_NAME);
    expect(adapter.name).toBe("meeting-tencent");
    expect(adapter.version).toBe(TENCENT_MEETING_VERSION);
    expect(adapter.version).toBe("0.1.0");
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining([
        "sync:tencent-meeting-sqlite",
        "sync:meeting-history",
        "sync:profile-directory",
      ]),
    );
    expect(adapter.watermarkRequiresCompleteScan).toBe(true);
    expect(adapter.dataDisclosure.legalGate).toBe(true);
    expect(adapter.fileCheckpointMode({ inputPath: "history.db" })).toBe(
      "shared",
    );
    expect(adapter.fileCheckpointMode({ csvPath: "export.csv" })).toBe(
      "preserve",
    );
    expect(discoveryCalls).toBe(0);
    await expect(adapter.authenticate()).resolves.toMatchObject({
      ok: false,
      reason: "MEETING_DATA_NOT_FOUND",
    });
    expect(discoveryCalls).toBe(1);
  });

  it("collects meetings with hashed identities and valid unified entities", async () => {
    buildFixture();
    const adapter = new TencentMeetingAdapter({ profilePath: rootDir });
    let complete = false;
    const records = await collect(adapter, {
      markWatermarkComplete: () => {
        complete = true;
      },
    });
    expect(records).toHaveLength(2);
    expect(complete).toBe(true);
    expect(records[0].originalId).toMatch(
      /^tencent-meeting:[a-f0-9]{24}:[a-f0-9]{24}$/u,
    );
    expect(records[0].payload).toMatchObject({
      subject: "Architecture review (updated)",
      participantCount: 2,
      participants: [{ displayName: "Alice" }, { displayName: "Bob" }],
    });
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(rootDir);
    expect(serialized).not.toContain("secret-meeting-a");
    expect(serialized).not.toContain("participant-secret-1");
    expect(serialized).not.toContain("creator-secret-id");

    const normalized = adapter.normalize(records[0]);
    expect(normalized.events).toHaveLength(1);
    expect(normalized.persons).toHaveLength(3);
    expect(normalized.events[0]).toMatchObject({
      subtype: EVENT_SUBTYPES.MEETING,
      occurredAt: MEETING_A_BEGIN_MS,
      durationMs: 3_480_000,
      content: {
        title: "Architecture review (updated)",
      },
      extra: {
        platform: "tencent-meeting",
        identityRedacted: true,
        participantCount: 2,
        chatCount: 8,
      },
    });
    expect(normalized.persons[0].subtype).toBe(PERSON_SUBTYPES.CONTACT);
    expect(validateEvent(normalized.events[0])).toEqual({
      valid: true,
      errors: [],
    });
    for (const person of normalized.persons) {
      expect(validatePerson(person)).toEqual({ valid: true, errors: [] });
    }
    expect(JSON.stringify(normalized)).not.toContain(rootDir);
    expect(JSON.stringify(normalized)).not.toContain("participant-secret");
  });

  it("replays database changes and defers completion when limited", async () => {
    buildFixture();
    const adapter = new TencentMeetingAdapter({ profilePath: rootDir });
    let complete = false;
    const replay = await collect(adapter, {
      sinceWatermark: String(SOURCE_MTIME_MS),
      markWatermarkComplete: () => {
        complete = true;
      },
    });
    expect(replay).toHaveLength(2);
    expect(complete).toBe(true);

    complete = false;
    const limited = await collect(adapter, {
      limit: 1,
      markWatermarkComplete: () => {
        complete = true;
      },
    });
    expect(limited).toHaveLength(1);
    expect(complete).toBe(false);
  });

  it("skips all discovery and completion when meeting history is excluded", async () => {
    let defaultRootCalls = 0;
    let discoveryCalls = 0;
    let completionCalls = 0;
    const adapter = new TencentMeetingAdapter({
      defaultRoot: () => {
        defaultRootCalls += 1;
        return rootDir;
      },
      findHistoryDb: () => {
        discoveryCalls += 1;
        throw new Error("discovery must not run");
      },
    });
    await expect(
      adapter.healthCheck({ include: { history: false } }),
    ).resolves.toMatchObject({ ok: true, skipped: true });
    const records = await collect(adapter, {
      include: { history: false },
      sinceWatermark: "not-a-watermark",
      markWatermarkComplete: () => {
        completionCalls += 1;
      },
    });
    expect(records).toEqual([]);
    expect(defaultRootCalls).toBe(0);
    expect(discoveryCalls).toBe(0);
    expect(completionCalls).toBe(0);
  });

  it("supports disclosure and legacy participant/artifact opt-outs", async () => {
    buildFixture();
    const adapter = new TencentMeetingAdapter({ profilePath: rootDir });
    const records = await collect(adapter, {
      include: { participants: false, artifacts: false },
      maxParticipants: Number.MAX_SAFE_INTEGER,
    });
    const meeting = records.find(
      (record) => record.payload.subject === "Architecture review (updated)",
    );
    expect(meeting.payload).not.toHaveProperty("creator");
    expect(meeting.payload).not.toHaveProperty("participants");
    expect(meeting.payload).not.toHaveProperty("participantCount");
    expect(meeting.payload).not.toHaveProperty("documentName");
    expect(meeting.payload).not.toHaveProperty("recordAiSummary");
    expect(meeting.payload).not.toHaveProperty("chatCount");
    const normalized = adapter.normalize(meeting);
    expect(normalized.events[0].participants).toBeUndefined();
    expect(normalized.persons).toHaveLength(0);
    expect(normalized.events[0].extra).not.toHaveProperty("participantCount");
    expect(normalized.events[0].extra).not.toHaveProperty("documents");
    expect(normalized.events[0].extra).not.toHaveProperty("recording");
    expect(normalized.events[0].extra).not.toHaveProperty("chatCount");
    expect(JSON.stringify(normalized)).not.toContain("Alice");
    expect(JSON.stringify(normalized)).not.toContain("Bob");
    expect(JSON.stringify(records)).not.toContain("Architecture notes");
    expect(JSON.stringify(records)).not.toContain(
      "The team agreed on the incremental design.",
    );

    const legacyRecords = await collect(adapter, {
      includeParticipants: false,
    });
    const legacyMeeting = legacyRecords.find(
      (record) => record.payload.subject === "Architecture review (updated)",
    );
    expect(legacyMeeting.payload).not.toHaveProperty("creator");
    expect(legacyMeeting.payload).not.toHaveProperty("participants");
    expect(JSON.stringify(legacyRecords)).not.toContain("Alice");
    expect(JSON.stringify(legacyRecords)).not.toContain("Bob");
  });

  it("does not advance the watermark after participant truncation", async () => {
    buildFixture();
    const adapter = new TencentMeetingAdapter({ profilePath: rootDir });
    let completionCalls = 0;
    const boundaryRecords = await collect(adapter, {
      maxParticipants: 2,
      markWatermarkComplete: () => {
        completionCalls += 1;
      },
    });
    expect(boundaryRecords).toHaveLength(2);
    expect(completionCalls).toBe(1);

    const truncatedRecords = await collect(adapter, {
      maxParticipants: 1,
      markWatermarkComplete: () => {
        completionCalls += 1;
      },
    });
    expect(truncatedRecords).toHaveLength(2);
    expect(truncatedRecords[0].payload.participantsTruncated).toBe(true);
    expect(completionCalls).toBe(1);

    replaceFixtureParticipants(
      JSON.stringify([
        {
          app_uid: "over-budget-id",
          nick_name: "B".repeat(MAX_PARTICIPANTS_JSON_BYTES),
        },
      ]),
    );
    await collect(adapter, {
      markWatermarkComplete: () => {
        completionCalls += 1;
      },
    });
    expect(completionCalls).toBe(1);
  });

  it("returns path-free missing, schema, and permission failures", async () => {
    const missing = new TencentMeetingAdapter({ profilePath: rootDir });
    const missingResult = await missing.authenticate();
    expect(missingResult).toMatchObject({
      ok: false,
      reason: "MEETING_DATA_NOT_FOUND",
    });
    expect(JSON.stringify(missingResult)).not.toContain(rootDir);

    mkdirSync(rootDir, { recursive: true });
    const wrongDbPath = join(rootDir, "wrong.db");
    const wrong = new Database(wrongDbPath);
    wrong.exec("CREATE TABLE unrelated(id INTEGER PRIMARY KEY)");
    wrong.close();
    const schema = new TencentMeetingAdapter({ dbPath: wrongDbPath });
    const schemaResult = await schema.authenticate();
    expect(schemaResult).toMatchObject({
      ok: false,
      reason: "MEETING_SCHEMA_MISMATCH",
    });
    expect(JSON.stringify(schemaResult)).not.toContain(wrongDbPath);

    const deniedFs = {
      ...nodeFs,
      statSync() {
        const error = new Error(`denied: ${rootDir}`);
        error.code = "EACCES";
        throw error;
      },
    };
    const denied = new TencentMeetingAdapter({
      profilePath: rootDir,
      fs: deniedFs,
    });
    const deniedResult = await denied.authenticate();
    expect(deniedResult).toMatchObject({
      ok: false,
      reason: "MEETING_PERMISSION_DENIED",
    });
    expect(JSON.stringify(deniedResult)).not.toContain(rootDir);
  });
});
