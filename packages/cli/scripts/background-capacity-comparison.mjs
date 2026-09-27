import assert from "node:assert/strict";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { canonicalDigest } from "@chainlesschain/context-memory-kernel";
import {
  backgroundAgentsDir,
  listBackgroundAgents,
  listBackgroundAgentsPage,
} from "../src/lib/background-agent-supervisor.js";
import { BACKGROUND_AGENT_LIST_INDEX_FILE } from "../src/lib/background-agent-list-index.js";

export const BACKGROUND_COMPARISON_SCHEMA =
  "chainlesschain.background-capacity-comparison/v1";
export const BACKGROUND_COMPARISON_PAGE_LIMIT = 50;

/** Called within a process whose CC_BACKGROUND_AGENTS_DIR owns the fixture. */
export function readBackgroundCapacityPage(cursor = null) {
  let observation = null;
  const page = listBackgroundAgentsPage({
    all: true,
    persist: false,
    limit: BACKGROUND_COMPARISON_PAGE_LIMIT,
    cursor,
    indexObserver: (value) => {
      observation = value;
    },
  });
  return { page, observation };
}

function rowDigest(rows) {
  return canonicalDigest(rows, "cc.background-capacity-rows/v1");
}

export function backgroundPageEvidence(page, observation) {
  return {
    count: page.sessions.length,
    firstId: page.sessions[0]?.id ?? null,
    lastId: page.sessions.at(-1)?.id ?? null,
    rowsDigest: rowDigest(page.sessions),
    hasNextPage: page.nextCursor != null,
    observation,
  };
}

function peakRssBytes() {
  // Node reports maxRSS in KiB on all supported platforms, unlike getrusage(2).
  return process.resourceUsage().maxRSS * 1024;
}

function sameRows(actual, expected, label) {
  assert.equal(
    rowDigest(actual),
    rowDigest(expected),
    `${label}: page differs from full scan`,
  );
}

/**
 * Compare the existing production paths against one owned, stable fixture.
 * Every timing excludes setup/parity checks. Cold means a new Node process,
 * never a claim that the OS filesystem cache was flushed.
 */
export async function measureBackgroundPageComparison({
  directory,
  recordCount,
  samples,
  runWorker,
  summarizeDurations,
}) {
  assert.ok(
    Number.isSafeInteger(recordCount) && recordCount > 0,
    "invalid fixture count",
  );
  assert.ok(
    Number.isSafeInteger(samples) && samples > 0 && samples <= 100,
    "invalid sample count",
  );
  assert.equal(
    resolve(backgroundAgentsDir()),
    resolve(directory),
    "fixture directory is not selected",
  );
  const indexPath = join(directory, BACKGROUND_AGENT_LIST_INDEX_FILE);
  const baseline = listBackgroundAgents({ all: true, persist: false });
  assert.equal(
    baseline.length,
    recordCount,
    "background fixture count differs",
  );
  const expectedFirst = baseline.slice(0, BACKGROUND_COMPARISON_PAGE_LIMIT);
  const expectedDigest = rowDigest(expectedFirst);
  rmSync(indexPath, { force: true });
  const coldBuild = await runWorker("background-page", directory);
  const coldCached = await runWorker("background-page", directory);
  const coldCheck = (result, source) => ({
    ok:
      result.ok === true &&
      result.processExitCode === 0 &&
      result.page?.rowsDigest === expectedDigest &&
      result.page?.count === expectedFirst.length &&
      result.page?.hasNextPage === baseline.length > expectedFirst.length &&
      result.page?.observation?.source === source,
    expectedSource: source,
  });

  const phases = {
    warmFirstPage: [],
    warmNextPage: [],
    invalidationRebuild: [],
  };
  const sources = {
    warmFirstPage: {},
    warmNextPage: {},
    invalidationRebuild: {},
  };
  let parityChecks = 0;
  function measured(phase, cursor = null) {
    const began = performance.now();
    const result = readBackgroundCapacityPage(cursor);
    phases[phase].push(performance.now() - began);
    const source = result.observation?.source || "missing";
    sources[phase][source] = (sources[phase][source] || 0) + 1;
    return result.page;
  }
  for (let index = 0; index < samples; index += 1) {
    const page = measured("warmFirstPage");
    sameRows(page.sessions, expectedFirst, "warm first");
    assert.equal(
      page.nextCursor != null,
      baseline.length > expectedFirst.length,
    );
    parityChecks++;
    if (page.nextCursor != null) {
      const next = measured("warmNextPage", page.nextCursor);
      sameRows(
        next.sessions,
        baseline.slice(
          BACKGROUND_COMPARISON_PAGE_LIMIT,
          BACKGROUND_COMPARISON_PAGE_LIMIT * 2,
        ),
        "warm next",
      );
      parityChecks++;
    }
  }

  // Check traversal independently of timings; catch missing, duplicated, or
  // misordered pages instead of accepting matching first-page counts alone.
  let cursor = null;
  let visited = 0;
  let pageCount = 0;
  const seenCursors = new Set();
  do {
    const { page } = readBackgroundCapacityPage(cursor);
    sameRows(
      page.sessions,
      baseline.slice(visited, visited + BACKGROUND_COMPARISON_PAGE_LIMIT),
      "traversal",
    );
    assert.ok(
      page.sessions.length > 0 || baseline.length === 0,
      "empty intermediate page",
    );
    visited += page.sessions.length;
    pageCount++;
    cursor = page.nextCursor;
    assert.ok(cursor == null || !seenCursors.has(cursor), "cursor repeated");
    if (cursor != null) seenCursors.add(cursor);
    assert.ok(
      visited <= recordCount &&
        pageCount <= Math.ceil(recordCount / BACKGROUND_COMPARISON_PAGE_LIMIT),
      "unbounded traversal",
    );
    parityChecks++;
  } while (cursor != null);
  assert.equal(visited, recordCount, "traversal omitted records");

  const invalidated = baseline.at(-1);
  const authorityPath = join(directory, `${invalidated.id}.json`);
  const original = readFileSync(authorityPath, "utf8");
  const temporary = `${authorityPath}.capacity.tmp`;
  const writeReplacement = (text) => {
    writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, authorityPath);
  };
  try {
    for (let index = 0; index < samples; index += 1) {
      // Move the oldest row to the front and change content. A stale cache must
      // not pass simply because its previous first page has the same length.
      writeReplacement(
        `${JSON.stringify({
          ...JSON.parse(original),
          startedAt: recordCount + index + 10,
          title: `capacity invalidation ${index}`,
        })}\n`,
      );
      const page = measured("invalidationRebuild");
      const expected = listBackgroundAgents({ all: true, persist: false });
      sameRows(
        page.sessions,
        expected.slice(0, BACKGROUND_COMPARISON_PAGE_LIMIT),
        "invalidation",
      );
      assert.equal(page.sessions[0]?.id, invalidated.id);
      parityChecks++;
    }
  } finally {
    writeReplacement(original);
    rmSync(temporary, { force: true });
  }

  const restored = readBackgroundCapacityPage();
  sameRows(restored.page.sessions, expectedFirst, "restored fixture");
  parityChecks++;
  const coldBuildCheck = coldCheck(coldBuild, "rebuilt");
  const coldCachedCheck = coldCheck(coldCached, "index");
  const expectedWarmNext =
    recordCount > BACKGROUND_COMPARISON_PAGE_LIMIT ? samples : 0;
  const pathsVerified =
    coldBuildCheck.ok &&
    coldCachedCheck.ok &&
    sources.warmFirstPage.index === samples &&
    (sources.warmNextPage.index || 0) === expectedWarmNext &&
    sources.invalidationRebuild.rebuilt === samples;
  return {
    schema: BACKGROUND_COMPARISON_SCHEMA,
    pageLimit: BACKGROUND_COMPARISON_PAGE_LIMIT,
    datasetDigest: rowDigest(baseline),
    coldBuild: { ...coldBuild, validation: coldBuildCheck },
    coldCached: { ...coldCached, validation: coldCachedCheck },
    warmFirstPage: {
      ...summarizeDurations(phases.warmFirstPage),
      sources: sources.warmFirstPage,
    },
    warmNextPage: {
      ...summarizeDurations(phases.warmNextPage),
      sources: sources.warmNextPage,
    },
    invalidationRebuild: {
      ...summarizeDurations(phases.invalidationRebuild),
      sources: sources.invalidationRebuild,
    },
    traversal: {
      records: visited,
      pages: pageCount,
      parityChecks,
      exact: true,
    },
    pathsVerified,
    processPeakRssBytes: peakRssBytes(),
    lockWait: {
      applicable: false,
      reason: "page reads use an inventory fence, no store lock",
    },
    limitations: [
      "all:true terminal synthetic records; no running-process liveness probes",
      "warm indexed reads still enumerate/stat every authority file and sort summaries",
      "first-process timings may benefit from the host filesystem cache",
      "peak RSS is the process high-water mark, not an isolated page allocation delta",
      "synthetic fixtures and local measurements do not qualify a production SLO",
    ],
  };
}
