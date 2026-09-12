"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createMemoryCandidate,
  applyMemoryCommand,
  lexicalRelevance,
  rankMemoryRecords,
} = require("../lib/index.js");
const { AT, CLOCK, proposal } = require("./helpers.js");

function textRecord(content, overrides = {}) {
  return { category: "fixture", tags: [], content, ...overrides };
}

const cases = [
  ["偏好使用确定性测试", "偏好使用确定性测试", 1],
  ["确定性测试", "偏好使用确定性测试", 1],
  ["确定性测试", "偏好使用确定性方法验证结果", 0],
  ["数据库", "数据处理", 0],
  ["测试", "偏好使用确定性测试", 1],
  ["测", "偏好使用确定性测试", 0],
  ["测", "测", 1],
  ["𠀀𠀁", "采用𠀀𠀁作为名称", 1],
  ["𠀀", "采用𠀀𠀁作为名称", 0],
  ["𠀀", "𠀀", 1],
  ["𠀀", "a𠀀b", 1],
  ["Vue", "偏好Vue组件测试", 1],
  ["vue开发", "使用Vue开发工具", 1],
  ["Vue开发", "Vue部署", 0],
  ["Vue开发", "Python开发", 0],
  ["Vue开发", "Vue3开发", 0],
  ["Vue开发", "使用Vue开发工具和Vue组件", 1],
  ["Vue 开发", "Vue部署", 0.5],
  ["get_user_id", "使用get_user_id读取用户", 1],
  ["get_user", "使用get_user_id读取用户", 0],
  ["foo-bar", "中文foobar说明", 0],
  ["foo_bar", "foo_bar_extra", 0],
  ["gpt-5", "gpt-50", 0],
  // Dot-separated words retain their old behavior; this is not model parsing.
  ["gpt-5", "gpt-5.4", 1],
  ["v1", "v10", 0],
  ["art", "partial", 0],
  ["CAFÉ", "café开发", 1],
  ["cafe", "café开发", 0],
  ["确定性测试", "偏好可复现的检查", 0],
  ["请说明确定性测试的方法", "偏好使用确定性测试", 0],
  ["***", "测试", 0],
  [" * ", "测试", 0],
  ["", "测试", 0],
  ["*", "测试", 1],
];

for (const [query, content, expected] of cases) {
  test(`lexical ${JSON.stringify(query)} against ${JSON.stringify(content)} = ${expected}`, () => {
    assert.equal(lexicalRelevance(query, textRecord(content)), expected);
  });
}

test("mixed-token parts may match searchable fields but contribute only one point", () => {
  const record = textRecord("开发工具", { tags: ["Vue"] });
  assert.equal(lexicalRelevance("Vue开发", record), 1);
  assert.equal(lexicalRelevance("Vue开发 missing", record), 0.5);
  assert.equal(lexicalRelevance("Vue开发 Vue开发", record), 1);
  assert.equal(
    lexicalRelevance(
      "关键词",
      textRecord("irrelevant", { summary: "保留中文关键词说明" }),
    ),
    1,
  );
});

test("non-Han lexical scores retain the former exact-token behavior", () => {
  function oldTokens(value) {
    return new Set(
      String(value || "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter(Boolean)
        .slice(0, 2048),
    );
  }
  const contents = [
    "Partial art v10",
    "foo_bar foo-bar",
    "CAFÉ cafe i\u0307",
    "GPT-5.4 release",
    "alpha/beta gamma",
    "Пример кода",
  ];
  const queries = [
    "art",
    "v1",
    "foo",
    "foo_bar",
    "gpt-5",
    "alpha missing",
    "café",
    "пример",
    "alpha alpha beta",
    "---",
    "???",
  ];
  for (const content of contents) {
    const record = textRecord(content);
    const memory = oldTokens(`${record.category} ${record.content}`);
    for (const query of queries) {
      const wanted = oldTokens(query);
      const expected =
        wanted.size === 0
          ? 0
          : [...wanted].filter((word) => memory.has(word)).length / wanted.size;
      assert.equal(
        lexicalRelevance(query, record),
        expected,
        `${query} / ${content}`,
      );
    }
  }
});

test("the existing first-2048-token boundary counts repeated occurrences", () => {
  const included = textRecord(`${"noise ".repeat(2046)}偏好使用确定性测试`);
  const excluded = textRecord(`${"noise ".repeat(2047)}偏好使用确定性测试`);
  // category consumes one token, matching the pre-existing field order.
  assert.equal(lexicalRelevance("确定性测试", included), 1);
  assert.equal(lexicalRelevance("确定性测试", excluded), 0);
  assert.equal(
    lexicalRelevance(`${"missing ".repeat(2047)}确定性测试`, included),
    0.5,
  );
  assert.equal(
    lexicalRelevance(`${"missing ".repeat(2048)}确定性测试`, included),
    0,
  );
});

test("a long single Han run is searchable at its end without character ngram expansion", () => {
  // The contract uses UTF-16 code units, not a 4 MiB UTF-8 byte limit.
  const suffix = "确定性测试";
  const content = "中".repeat(4 * 1024 * 1024 - suffix.length) + suffix;
  assert.equal(lexicalRelevance(suffix, textRecord(content)), 1);
  const absent = Array.from(
    { length: 128 },
    (_, index) => `${String.fromCodePoint(0x4e00 + index)}查找`,
  ).join(" ");
  assert.equal(lexicalRelevance(absent, textRecord(content)), 0);
});

test("long alternating scripts reuse segment comparisons without hiding later matches", () => {
  const suffix = "确定性测试";
  const prefix = "中a".repeat(
    Math.floor((4 * 1024 * 1024 - suffix.length) / 2),
  );
  const record = textRecord(prefix + suffix);
  assert.equal(lexicalRelevance(suffix, record), 1);
  const absent = Array.from(
    { length: 2048 },
    (_, index) => `${String.fromCodePoint(0x4e00 + index)}查找`,
  ).join(" ");
  assert.equal(lexicalRelevance(absent, record), 0);
  assert.equal(
    lexicalRelevance("查询", textRecord("中文a".repeat(100_000))),
    0,
  );
});

test("a full segment comparison cache never becomes a recall cutoff", () => {
  const uniqueRuns = Array.from(
    { length: 2100 },
    (_, index) => `${String.fromCodePoint(0x4e00 + index)}x`,
  ).join("");
  assert.equal(
    lexicalRelevance("确定性测试", textRecord(uniqueRuns + "确定性测试")),
    1,
  );
  const absent = Array.from(
    { length: 128 },
    (_, index) => `${String.fromCodePoint(0x4e00 + index)}查`,
  ).join(" ");
  assert.equal(
    lexicalRelevance(absent, textRecord(uniqueRuns + "中文a".repeat(100_000))),
    0,
  );
});

function memory(memoryId, overrides = {}) {
  return createMemoryCandidate(
    proposal({
      memoryId,
      scope: "project",
      scopeId: "project-1",
      category: "fixture",
      content: "偏好使用确定性测试",
      tags: [],
      ...overrides,
    }),
    { clock: CLOCK },
  );
}

function recall(records, overrides = {}) {
  return rankMemoryRecords(records, {
    query: "确定性测试",
    sink: "provider.local",
    scopeAdmissions: [{ scope: "project", scopeId: "project-1" }],
    now: AT,
    limit: 10,
    tokenBudget: 1000,
    ...overrides,
  });
}

test("Chinese matching does not weaken scope, sink, lifecycle, expiry or deletion fences", () => {
  const source = memory("deleted");
  const deleted = applyMemoryCommand(
    source,
    {
      type: "delete",
      expectedRevision: source.revision,
      deletionFence: "fence-1",
    },
    { clock: CLOCK },
  ).record;
  const archivedSource = memory("archived");
  const archived = applyMemoryCommand(
    archivedSource,
    {
      type: "archive",
      expectedRevision: archivedSource.revision,
    },
    { clock: CLOCK },
  ).record;
  const reinforcedSource = memory("reinforced");
  const reinforced = applyMemoryCommand(
    reinforcedSource,
    {
      type: "reinforce",
      expectedRevision: reinforcedSource.revision,
    },
    { clock: CLOCK },
  ).record;
  const result = recall([
    memory("active"),
    reinforced,
    deleted,
    archived,
    memory("candidate", { activate: false }),
    memory("wrong-project", { scopeId: "project-2" }),
    memory("wrong-scope", { scope: "user", scopeId: "project-1" }),
    memory("wrong-sink", { allowedSinks: ["provider.external"] }),
    memory("expired", {
      retentionPolicy: { mode: "until_expired", expiresAt: AT },
    }),
  ]);
  assert.deepEqual(
    result.results.map((entry) => entry.memoryId),
    ["reinforced", "active"],
  );
  assert.equal(result.totalCandidates, 2);
  assert.equal(deleted.content, "");
});

test("ranking, recall digests and memory digests are deterministic without record mutation", () => {
  const records = [memory("z"), memory("a")];
  const before = JSON.stringify(records);
  const result = recall(records);
  assert.deepEqual(
    result.results.map((entry) => entry.memoryId),
    ["a", "z"],
  );
  assert.deepEqual(result, recall([...records].reverse()));
  assert.deepEqual(result, recall(records));
  assert.equal(JSON.stringify(records), before);
  assert.equal(result.results[0].relevance, 0.95);
  assert.equal(result.results[0].record.digest, records[1].digest);
});

test("token budgets skip whole records and preserve category diversity", () => {
  const long = memory("a-long", { content: "确定性测试".repeat(100) });
  const short = memory("b-short", { content: "确定性测试" });
  const budget = Math.ceil(Buffer.byteLength(short.content, "utf8") / 4);
  const limited = recall([long, short], { tokenBudget: budget });
  assert.deepEqual(
    limited.results.map((entry) => entry.memoryId),
    ["b-short"],
  );
  assert.equal(limited.usedTokens, budget);
  assert.equal(limited.results[0].truncated, false);

  const varied = recall(
    [memory("a"), memory("b"), memory("c"), memory("d", { category: "other" })],
    { limit: 3 },
  );
  assert.deepEqual(
    varied.results.map((entry) => entry.memoryId),
    ["a", "b", "d"],
  );
});
