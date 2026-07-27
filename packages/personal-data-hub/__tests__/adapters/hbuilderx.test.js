"use strict";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as nodeFs from "node:fs";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const {
  HBuilderXAdapter,
  HBUILDERX_NAME,
  HBUILDERX_VERSION,
  HBUILDERX_WATERMARK_LOOKBACK_MS,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_LINE_CHARS,
  DEFAULT_MAX_RECORDS,
  DEFAULT_MAX_ROOTS,
  DEFAULT_MAX_SECTIONS,
  DEFAULT_MAX_TOTAL_BYTES,
  HARD_MAX_FILE_BYTES,
  HARD_MAX_FILES,
  HARD_MAX_LINE_CHARS,
  HARD_MAX_RECORDS,
  HARD_MAX_ROOTS,
  HARD_MAX_SECTIONS,
  HARD_MAX_TOTAL_BYTES,
  defaultHBuilderXHomes,
  inspectHBuilderXLocalData,
  parseHBuilderXDateTime,
  readHBuilderXFileActivity,
} = require("../../lib/adapters/hbuilderx");
const { assertAdapter } = require("../../lib/adapter-spec");
const { ENTITY_TYPES, EVENT_SUBTYPES } = require("../../lib/constants");
const { validate } = require("../../lib/schemas");

let tempRoot;
let hbuilderxHome;

function canonicalPath(value) {
  const realPath =
    typeof realpathSync.native === "function"
      ? realpathSync.native(value)
      : realpathSync(value);
  return resolve(realPath);
}

const PRIVATE_PROJECT = "private-project-name";
const PRIVATE_BASENAME = "secret-source-file.vue";
const PRIVATE_COMMAND = "private-command --with-secret";
const PRIVATE_BODY = "private source body";
const ACTIVITY_TIME = "2026-01-24 12:34:5678";
const EXPECTED_UTC_PLUS_8 = Date.UTC(2026, 0, 24, 4, 34, 56, 780);

function activitySection(
  index,
  {
    home = hbuilderxHome,
    datetime = ACTIVITY_TIME,
    encoding = "UTF-8",
    file = PRIVATE_BASENAME,
    filepath,
  } = {},
) {
  const privatePath =
    filepath || join(home, PRIVATE_PROJECT, `${index}-${file}`);
  return [
    `[record-${index}]`,
    `filepath=${privatePath}`,
    `datetime=${datetime}`,
    `encoding=${encoding}`,
  ].join("\n");
}

function writeActivityFile(
  home = hbuilderxHome,
  sections = [activitySection(1, { home })],
  file = "activity-fixture.ini",
) {
  mkdirSync(home, { recursive: true });
  const filePath = join(home, file);
  writeFileSync(filePath, `${sections.join("\n")}\n`, "utf8");
  return filePath;
}

async function collect(adapter, options = {}) {
  const records = [];
  for await (const record of adapter.sync(options)) records.push(record);
  return records;
}

beforeEach(() => {
  // Windows runners can expose TEMP through an 8.3 alias. Mirror the
  // adapter's canonical-root semantics before constructing path-sensitive mocks.
  tempRoot = canonicalPath(
    mkdtempSync(join(tmpdir(), "hbuilderx-adapter-test-")),
  );
  hbuilderxHome = join(tempRoot, "HBuilder X");
  mkdirSync(hbuilderxHome, { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("HBuilderX local metadata discovery", () => {
  it("uses the audited hard ceilings as complete-scan defaults", () => {
    expect(DEFAULT_MAX_ROOTS).toBe(HARD_MAX_ROOTS);
    expect(DEFAULT_MAX_FILE_BYTES).toBe(HARD_MAX_FILE_BYTES);
    expect(DEFAULT_MAX_TOTAL_BYTES).toBe(HARD_MAX_TOTAL_BYTES);
    expect(DEFAULT_MAX_SECTIONS).toBe(HARD_MAX_SECTIONS);
    expect(DEFAULT_MAX_LINE_CHARS).toBe(HARD_MAX_LINE_CHARS);
    expect(DEFAULT_MAX_RECORDS).toBe(HARD_MAX_RECORDS);
  });

  it("discovers activity beyond the former 256-file default boundary", () => {
    const fileCount = 257;
    for (let index = 0; index < fileCount; index++) {
      writeActivityFile(
        hbuilderxHome,
        [activitySection(index)],
        `activity-${String(index).padStart(3, "0")}.ini`,
      );
    }

    const result = readHBuilderXFileActivity([hbuilderxHome], {
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:large-file-set",
    });

    expect(result.records).toHaveLength(fileCount);
    expect(result.inspectedFiles).toBe(fileCount);
    expect(result.complete).toBe(true);
  });

  it("discovers the two audited Windows standard roots without probing other platforms", () => {
    const homes = defaultHBuilderXHomes(
      {
        APPDATA: join(tempRoot, "roaming"),
        LOCALAPPDATA: join(tempRoot, "local"),
      },
      "win32",
    );

    expect(homes).toHaveLength(2);
    expect(homes.every((home) => basename(home) === "HBuilder X")).toBe(true);
    expect(defaultHBuilderXHomes({}, "linux")).toEqual([]);
  });

  it("reports only aggregate authentication metadata and never a selected path", async () => {
    writeActivityFile();
    const adapter = new HBuilderXAdapter({
      profilePath: hbuilderxHome,
      sourceTimezone: "+08:00",
    });
    const auth = await adapter.authenticate();
    const health = await adapter.healthCheck();
    const serialized = JSON.stringify({ auth, health });

    expect(auth).toEqual({
      ok: true,
      mode: "file-import",
      rootCount: 1,
      activityFileCount: 1,
      hasFileActivity: true,
    });
    expect(health.ok).toBe(true);
    expect(serialized).not.toContain(PRIVATE_PROJECT);
    expect(serialized).not.toContain(PRIVATE_BASENAME);
    expect(serialized).not.toContain(hbuilderxHome);
  });

  it("distinguishes unresolved, readable-empty, and activity-bearing roots generically", async () => {
    const unresolved = new HBuilderXAdapter({
      defaultHBuilderXHomes: () => [],
    });
    expect(await unresolved.authenticate()).toMatchObject({
      ok: false,
      reason: "HBUILDERX_ROOT_UNRESOLVED",
    });

    const empty = new HBuilderXAdapter({ roots: [hbuilderxHome] });
    expect(await empty.authenticate()).toMatchObject({
      ok: false,
      reason: "HBUILDERX_FILE_ACTIVITY_NOT_FOUND",
    });

    writeActivityFile();
    expect(inspectHBuilderXLocalData([hbuilderxHome])).toMatchObject({
      rootCount: 1,
      readableRootCount: 1,
      activityFileCount: 1,
      hasFileActivity: true,
      complete: true,
    });
  });
});

describe("HBuilderX timestamp parsing", () => {
  it("parses the audited yyyy-MM-dd HH:mm:ssff format with deterministic offsets", () => {
    expect(
      parseHBuilderXDateTime(ACTIVITY_TIME, {
        sourceTimezoneOffsetMinutes: 480,
      }),
    ).toBe(EXPECTED_UTC_PLUS_8);
    expect(
      parseHBuilderXDateTime(ACTIVITY_TIME, {
        sourceTimezone: "+08:00",
      }),
    ).toBe(EXPECTED_UTC_PLUS_8);
    expect(
      parseHBuilderXDateTime(ACTIVITY_TIME, {
        sourceTimezone: "UTC",
      }),
    ).toBe(Date.UTC(2026, 0, 24, 12, 34, 56, 780));
    expect(
      parseHBuilderXDateTime(ACTIVITY_TIME, {
        sourceTimezone: "Asia/Shanghai",
      }),
    ).toBe(EXPECTED_UTC_PLUS_8);
  });

  it("rejects imprecise, impossible, or invalid-timezone timestamps", () => {
    expect(
      parseHBuilderXDateTime("2026-01-24 12:34:56", {
        sourceTimezone: "UTC",
      }),
    ).toBeNull();
    expect(
      parseHBuilderXDateTime("2025-02-29 12:34:5678", {
        sourceTimezone: "UTC",
      }),
    ).toBeNull();
    expect(() =>
      parseHBuilderXDateTime(ACTIVITY_TIME, {
        sourceTimezone: "Private/invalid-timezone",
      }),
    ).toThrow(/source timezone is invalid/u);
  });
});

describe("HBuilderX file-activity reader", () => {
  it("reads only direct INI activity metadata and excludes every unaudited body source", () => {
    writeActivityFile();
    writeFileSync(
      join(hbuilderxHome, "language-index-cache"),
      JSON.stringify({
        projectUri: join(hbuilderxHome, PRIVATE_PROJECT),
        lineText: PRIVATE_BODY,
        context: PRIVATE_BODY,
      }),
      "utf8",
    );
    writeFileSync(
      join(hbuilderxHome, "diagnostic.log"),
      `${PRIVATE_BODY} ${join(hbuilderxHome, PRIVATE_PROJECT)}\n`,
      "utf8",
    );
    writeFileSync(
      join(hbuilderxHome, "external-commands.json"),
      JSON.stringify({ command: PRIVATE_COMMAND }),
      "utf8",
    );
    mkdirSync(join(hbuilderxHome, "nested"), { recursive: true });
    writeActivityFile(
      join(hbuilderxHome, "nested"),
      [activitySection(9, { home: join(hbuilderxHome, "nested") })],
      "nested.ini",
    );

    const result = readHBuilderXFileActivity([hbuilderxHome], {
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:fixture-scope",
    });
    const serialized = JSON.stringify(result);

    expect(result.complete).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      capturedAt: EXPECTED_UTC_PLUS_8,
      payload: {
        extension: ".vue",
        fileType: "code",
        encoding: "UTF-8",
        timestampSource: "hbuilderx-ini-local-datetime",
        occurredAt: EXPECTED_UTC_PLUS_8,
      },
    });
    expect(result.records[0].payload.pathHash).toMatch(/^[0-9a-f]{64}$/u);
    for (const forbidden of [
      PRIVATE_PROJECT,
      PRIVATE_BASENAME,
      PRIVATE_COMMAND,
      PRIVATE_BODY,
      hbuilderxHome,
      "projectUri",
      "lineText",
      "context",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("keeps duplicate occurrences distinct and stable while preserving safe metadata", () => {
    const duplicate = activitySection(1);
    writeActivityFile(hbuilderxHome, [duplicate, duplicate]);
    const options = {
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:stable-fixture-scope",
    };

    const first = readHBuilderXFileActivity([hbuilderxHome], options);
    const second = readHBuilderXFileActivity([hbuilderxHome], options);

    expect(first.records).toHaveLength(2);
    expect(new Set(first.records.map((record) => record.recordId)).size).toBe(
      2,
    );
    expect(first.records.map((record) => record.recordId)).toEqual(
      second.records.map((record) => record.recordId),
    );
    expect(first.records[0].payload.pathHash).toBe(
      first.records[1].payload.pathHash,
    );
  });

  it("defers completion on malformed sections, file and section budgets, and long lines", () => {
    writeActivityFile(hbuilderxHome, [
      activitySection(1),
      activitySection(2, { datetime: "not-a-datetime" }),
    ]);
    const malformed = readHBuilderXFileActivity([hbuilderxHome], {
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:budget-scope",
    });
    expect(malformed.records).toHaveLength(1);
    expect(malformed.complete).toBe(false);

    const sectionLimited = readHBuilderXFileActivity([hbuilderxHome], {
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:budget-scope",
      maxSections: 1,
    });
    expect(sectionLimited.records).toHaveLength(1);
    expect(sectionLimited.complete).toBe(false);

    const recordLimited = readHBuilderXFileActivity([hbuilderxHome], {
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:budget-scope",
      maxRecords: 1,
    });
    expect(recordLimited.records).toHaveLength(1);
    expect(recordLimited.complete).toBe(false);

    const byteLimited = readHBuilderXFileActivity([hbuilderxHome], {
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:budget-scope",
      maxFileBytes: 16,
    });
    expect(byteLimited.records).toEqual([]);
    expect(byteLimited.complete).toBe(false);

    const lineLimited = readHBuilderXFileActivity([hbuilderxHome], {
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:budget-scope",
      maxLineChars: 8,
    });
    expect(lineLimited.complete).toBe(false);
  });

  it("treats partial activity sections and empty INI snapshots as incomplete", () => {
    writeFileSync(
      join(hbuilderxHome, "partial.ini"),
      [
        "[partial-record]",
        `filepath=${join(hbuilderxHome, PRIVATE_PROJECT, PRIVATE_BASENAME)}`,
        `datetime=${ACTIVITY_TIME}`,
      ].join("\n"),
      "utf8",
    );
    const partial = readHBuilderXFileActivity([hbuilderxHome], {
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:partial-scope",
    });
    expect(partial.records).toEqual([]);
    expect(partial.complete).toBe(false);

    rmSync(join(hbuilderxHome, "partial.ini"));
    writeFileSync(join(hbuilderxHome, "empty.ini"), "", "utf8");
    const empty = readHBuilderXFileActivity([hbuilderxHome], {
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:empty-scope",
    });
    expect(empty.records).toEqual([]);
    expect(empty.complete).toBe(false);
  });

  it("defers completion when maxFiles truncates discovery", () => {
    writeActivityFile(hbuilderxHome, [activitySection(1)], "one.ini");
    writeActivityFile(hbuilderxHome, [activitySection(2)], "two.ini");
    const result = readHBuilderXFileActivity([hbuilderxHome], {
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:file-budget-scope",
      maxFiles: 1,
    });

    expect(result.records).toHaveLength(1);
    expect(result.complete).toBe(false);
  });

  it("rejects an unsafe encoding label instead of emitting a partial record", () => {
    writeActivityFile(hbuilderxHome, [
      activitySection(1, { encoding: "unsafe encoding value" }),
    ]);

    const result = readHBuilderXFileActivity([hbuilderxHome], {
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:encoding-scope",
    });

    expect(result.records).toEqual([]);
    expect(result.complete).toBe(false);
  });

  it("accepts HBuilderX's bounded UTF-8 without-BOM encoding label", () => {
    writeActivityFile(hbuilderxHome, [
      activitySection(1, { encoding: "UTF-8(WithoutBOM)" }),
    ]);

    const result = readHBuilderXFileActivity([hbuilderxHome], {
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:encoding-scope",
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].payload.encoding).toBe("UTF-8(WithoutBOM)");
    const normalized = new HBuilderXAdapter({
      defaultHBuilderXHomes: () => [],
    }).normalize({
      kind: "hbuilderx-file-activity",
      originalId: `hbuilderx-file-activity:${"a".repeat(48)}`,
      capturedAt: result.records[0].capturedAt,
      payload: result.records[0].payload,
    });
    expect(normalized.events[0].extra.encoding).toBe("UTF-8(WithoutBOM)");
    expect(result.complete).toBe(true);
  });

  it("hashes referenced activity paths lexically without probing them", () => {
    const privateActivityPath = String.raw`\\private-server\workspace\secret.vue`;
    writeActivityFile(hbuilderxHome, [
      activitySection(1, { filepath: privateActivityPath }),
    ]);
    const probed = [];
    const metadataOnlyFs = new Proxy(nodeFs, {
      get(target, property) {
        if (property !== "realpathSync") return target[property];
        const wrapped = (value) => {
          probed.push(String(value));
          if (String(value).includes("private-server")) {
            throw new Error("referenced activity paths must not be probed");
          }
          return target.realpathSync(value);
        };
        wrapped.native = wrapped;
        return wrapped;
      },
    });

    const result = readHBuilderXFileActivity([hbuilderxHome], {
      fs: metadataOnlyFs,
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:lexical-path-scope",
    });

    expect(result.records).toHaveLength(1);
    expect(probed.some((value) => value.includes("private-server"))).toBe(
      false,
    );
    expect(JSON.stringify(result)).not.toContain(privateActivityPath);
  });

  it("distinguishes optional missing defaults from explicit or inaccessible roots", () => {
    const missing = join(tempRoot, "missing-hbuilderx-root");
    expect(readHBuilderXFileActivity([missing])).toMatchObject({
      records: [],
      complete: false,
    });
    expect(
      readHBuilderXFileActivity([missing], { optionalMissingRoots: true }),
    ).toMatchObject({
      records: [],
      complete: true,
    });

    const inaccessibleFs = new Proxy(nodeFs, {
      get(target, property) {
        if (property !== "statSync") return target[property];
        return (value, ...args) => {
          if (value === missing) {
            const error = new Error("permission denied");
            error.code = "EACCES";
            throw error;
          }
          return target.statSync(value, ...args);
        };
      },
    });
    expect(
      readHBuilderXFileActivity([missing], {
        fs: inaccessibleFs,
        optionalMissingRoots: true,
      }),
    ).toMatchObject({
      records: [],
      complete: false,
    });
  });

  it("normalizes HBuilderX's Qt ByteArray encoding wrapper", () => {
    writeActivityFile(hbuilderxHome, [
      activitySection(1, { encoding: "@ByteArray(UTF-8)" }),
    ]);

    const result = readHBuilderXFileActivity([hbuilderxHome], {
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:encoding-scope",
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].payload.encoding).toBe("UTF-8");
    expect(result.complete).toBe(true);
  });

  it("discards a file and defers completion when stat changes during the read", () => {
    const activityFile = writeActivityFile();
    let activityStatCalls = 0;
    const inconsistentFs = {
      existsSync: (value) => require("node:fs").existsSync(value),
      readdirSync,
      readFileSync,
      realpathSync,
      statSync(value) {
        const actual = statSync(value);
        if (value === activityFile) {
          activityStatCalls += 1;
          return {
            size: actual.size,
            mtimeMs: actual.mtimeMs + (activityStatCalls >= 2 ? 10 : 0),
            isFile: () => actual.isFile(),
          };
        }
        return actual;
      },
    };
    const result = readHBuilderXFileActivity([hbuilderxHome], {
      fs: inconsistentFs,
      sourceTimezone: "+08:00",
      scope: "account:hbuilderx:stat-scope",
    });

    expect(result.records).toEqual([]);
    expect(result.complete).toBe(false);
  });
});

describe("HBuilderXAdapter contract, scope, and incremental semantics", () => {
  it("declares the local high-sensitivity complete-scan contract", () => {
    const adapter = new HBuilderXAdapter({
      defaultHBuilderXHomes: () => [],
    });

    expect(assertAdapter(adapter)).toEqual({ ok: true });
    expect(adapter.name).toBe(HBUILDERX_NAME);
    expect(adapter.name).toBe("hbuilderx");
    expect(adapter.version).toBe(HBUILDERX_VERSION);
    expect(adapter.version).toBe("0.1.0");
    expect(adapter.extractMode).toBe("file-import");
    expect(adapter.watermarkStrategy).toBe("max-captured-at");
    expect(adapter.watermarkRequiresCompleteScan).toBe(true);
    expect(adapter.watermarkLookbackMs).toBe(HBUILDERX_WATERMARK_LOOKBACK_MS);
    expect(adapter.watermarkLookbackMs).toBe(1000);
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining([
        "sync:hbuilderx-file-activity-ini",
        "sync:profile-directory",
      ]),
    );
    expect(adapter.dataDisclosure.sensitivity).toBe("high");
    expect(adapter.dataDisclosure.excludedFields).toEqual(
      expect.arrayContaining([
        "absolute filepath values and file basenames",
        "project and workspace names or paths",
        "language-index projectUri,lineText,context,value and source bodies",
        "diagnostic log lines and process information",
        "external-command command,name,workingDir,url and output",
        "account identifiers,tokens,cookies,passwords,secrets and credentials",
      ]),
    );
  });

  it("supports hbuilderxHomes, roots, and profilePath aliases", async () => {
    writeActivityFile();
    const adapter = new HBuilderXAdapter({
      defaultHBuilderXHomes: () => [],
      sourceTimezone: "+08:00",
    });

    expect(
      await collect(adapter, { hbuilderxHomes: [hbuilderxHome] }),
    ).toHaveLength(1);
    expect(await collect(adapter, { roots: [hbuilderxHome] })).toHaveLength(1);
    expect(await collect(adapter, { profilePath: hbuilderxHome })).toHaveLength(
      1,
    );

    const defaults = new HBuilderXAdapter({
      profilePath: undefined,
      defaultHBuilderXHomes: () => [hbuilderxHome],
      sourceTimezone: "+08:00",
    });
    expect(
      await collect(defaults, {
        hbuilderxHomes: undefined,
        profilePath: undefined,
      }),
    ).toHaveLength(1);
  });

  it("binds scope, path hashes, and stable original ids to the selected profile root", async () => {
    const otherHome = join(tempRoot, "other-profile");
    writeActivityFile(hbuilderxHome, [activitySection(1)]);
    writeActivityFile(otherHome, [
      activitySection(1, {
        home: hbuilderxHome,
      }),
    ]);
    const adapter = new HBuilderXAdapter({
      hbuilderxHomes: [hbuilderxHome],
      sourceTimezone: "+08:00",
    });

    const first = await collect(adapter);
    const repeated = await collect(adapter);
    const other = await collect(adapter, { profilePath: otherHome });

    expect(first[0].originalId).toBe(repeated[0].originalId);
    expect(first[0].payload.pathHash).toBe(repeated[0].payload.pathHash);
    expect(first[0].scope).toBe(adapter.resolveDefaultScope());
    expect(adapter.resolveDefaultScope({ profilePath: otherHome })).not.toBe(
      adapter.resolveDefaultScope(),
    );
    expect(other[0].scope).not.toBe(first[0].scope);
    expect(other[0].payload.pathHash).not.toBe(first[0].payload.pathHash);
    expect(other[0].originalId).not.toBe(first[0].originalId);
  });

  it("isolates watermarks when the source timezone interpretation changes", () => {
    const utc = new HBuilderXAdapter({
      profilePath: hbuilderxHome,
      sourceTimezone: "UTC",
    });
    const shanghai = new HBuilderXAdapter({
      profilePath: hbuilderxHome,
      sourceTimezone: "Asia/Shanghai",
    });
    const fixed = new HBuilderXAdapter({
      profilePath: hbuilderxHome,
      sourceTimezoneOffsetMinutes: 480,
    });

    expect(utc.defaultScope).not.toBe(shanghai.defaultScope);
    expect(shanghai.defaultScope).not.toBe(fixed.defaultScope);
    expect(
      JSON.stringify([utc.defaultScope, shanghai.defaultScope]),
    ).not.toContain(hbuilderxHome);
  });

  it("uses record time for capturedAt, honors since, and marks only complete scans", async () => {
    writeActivityFile(hbuilderxHome, [
      activitySection(1, { datetime: "2026-01-24 12:34:5678" }),
      activitySection(2, { datetime: "2026-01-24 12:35:0078" }),
    ]);
    const adapter = new HBuilderXAdapter({
      roots: [hbuilderxHome],
      sourceTimezone: "+08:00",
    });
    let completions = 0;
    const all = await collect(adapter, {
      markWatermarkComplete: () => {
        completions += 1;
      },
    });
    expect(all).toHaveLength(2);
    expect(all[0].capturedAt).toBe(all[0].payload.occurredAt);
    expect(all[0].capturedAt).toBe(EXPECTED_UTC_PLUS_8);
    expect(completions).toBe(1);

    const incremental = await collect(adapter, {
      since: all[1].capturedAt,
      markWatermarkComplete: () => {
        completions += 1;
      },
    });
    expect(incremental).toHaveLength(1);
    expect(incremental[0].capturedAt).toBe(all[1].capturedAt);
    expect(completions).toBe(2);
  });

  it("does not complete a page-truncated or malformed scan", async () => {
    writeActivityFile(hbuilderxHome, [
      activitySection(1),
      activitySection(2, { datetime: "2026-01-24 12:35:0078" }),
    ]);
    const adapter = new HBuilderXAdapter({
      roots: [hbuilderxHome],
      sourceTimezone: "+08:00",
    });
    let completions = 0;
    const limited = await collect(adapter, {
      pageSize: 1,
      maxPages: 1,
      markWatermarkComplete: () => {
        completions += 1;
      },
    });
    expect(limited).toHaveLength(1);
    expect(completions).toBe(0);

    writeActivityFile(hbuilderxHome, [
      activitySection(1),
      activitySection(2, { datetime: "malformed" }),
    ]);
    const malformed = await collect(adapter, {
      markWatermarkComplete: () => {
        completions += 1;
      },
    });
    expect(malformed).toHaveLength(1);
    expect(completions).toBe(0);
  });

  it("performs no discovery or completion handshake when file activity is excluded", async () => {
    let discoveryCalls = 0;
    let completionCalls = 0;
    const adapter = new HBuilderXAdapter({
      defaultHBuilderXHomes: () => {
        discoveryCalls += 1;
        return [hbuilderxHome];
      },
    });
    discoveryCalls = 0;

    const records = await collect(adapter, {
      include: { fileActivity: false },
      markWatermarkComplete: () => {
        completionCalls += 1;
      },
    });

    expect(records).toEqual([]);
    expect(discoveryCalls).toBe(0);
    expect(completionCalls).toBe(0);
  });

  it("rejects configured reader limits above their hard cap", () => {
    expect(() =>
      readHBuilderXFileActivity([hbuilderxHome], {
        maxFiles: HARD_MAX_FILES + 1,
        sourceTimezone: "UTC",
      }),
    ).toThrow(/not exceeding/u);
  });

  it("sanitizes timezone/read errors and never reflects configured private text", async () => {
    writeActivityFile();
    const adapter = new HBuilderXAdapter({
      profilePath: hbuilderxHome,
      sourceTimezone: `${PRIVATE_PROJECT}/invalid`,
    });

    let thrown;
    try {
      await collect(adapter);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.code).toBe("HBUILDERX_READ_FAILED");
    expect(thrown.sourceCode).toBe("HBUILDERX_TIMEZONE_INVALID");
    const serialized = `${thrown.message}|${thrown.code}|${thrown.sourceCode}`;
    expect(serialized).not.toContain(PRIVATE_PROJECT);
    expect(serialized).not.toContain(hbuilderxHome);
  });

  it("normalizes to a schema-valid generic Event(OTHER) with no path or name", async () => {
    writeActivityFile();
    const adapter = new HBuilderXAdapter({
      profilePath: hbuilderxHome,
      sourceTimezone: "+08:00",
    });
    const [raw] = await collect(adapter);
    const batch = adapter.normalize(raw);
    const [event] = batch.events;
    const serialized = JSON.stringify({ raw, batch });

    expect(event.type).toBe(ENTITY_TYPES.EVENT);
    expect(event.subtype).toBe(EVENT_SUBTYPES.OTHER);
    expect(event.content).toEqual({
      title: "HBuilderX file activity",
      text: "",
    });
    expect(event.occurredAt).toBe(EXPECTED_UTC_PLUS_8);
    expect(event.source.capturedAt).toBe(EXPECTED_UTC_PLUS_8);
    expect(event.extra).toMatchObject({
      kind: "hbuilderx-file-activity",
      editor: "hbuilderx",
      extension: ".vue",
      fileType: "code",
      encoding: "UTF-8",
      timestampSource: "hbuilderx-ini-local-datetime",
    });
    expect(validate(event)).toEqual({ valid: true, errors: [] });
    expect(batch.persons).toEqual([]);
    expect(batch.places).toEqual([]);
    expect(batch.items).toEqual([]);
    expect(batch.topics).toEqual([]);
    for (const forbidden of [
      PRIVATE_PROJECT,
      PRIVATE_BASENAME,
      hbuilderxHome,
      "filepath",
      "projectUri",
      "lineText",
      PRIVATE_COMMAND,
      PRIVATE_BODY,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("rehashes crafted legacy identifiers instead of reflecting private paths", () => {
    const adapter = new HBuilderXAdapter({
      defaultHBuilderXHomes: () => [],
      sourceTimezone: "UTC",
    });
    const crafted = `${hbuilderxHome}\\${PRIVATE_PROJECT}\\${PRIVATE_BASENAME}`;
    const event = adapter.normalize({
      kind: "hbuilderx-file-activity",
      originalId: crafted,
      scope: crafted,
      capturedAt: EXPECTED_UTC_PLUS_8,
      payload: {
        pathHash: crafted,
        extension: crafted,
        fileType: crafted,
        encoding: crafted,
        occurredAt: EXPECTED_UTC_PLUS_8,
        timestampSource: crafted,
      },
    }).events[0];

    expect(JSON.stringify(event)).not.toContain(crafted);
    expect(event.extra.pathHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(validate(event)).toEqual({ valid: true, errors: [] });
  });
});
