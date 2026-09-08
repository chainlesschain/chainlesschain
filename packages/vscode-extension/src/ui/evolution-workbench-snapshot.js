"use strict";

const {
  validateEvolutionWorkbenchProjection,
} = require("./evolution-workbench-view");

// Match the canonical Workbench projection bound. Each transport page remains
// at most 500 items; the UI must not silently treat that page as the full set.
const MAX_ITEMS = 10_000;
const PAGE_SIZE = 500;

async function loadEvolutionWorkbenchSnapshot(
  pilot,
  { signal, onProgress } = {},
) {
  let first = null;
  const candidates = [];
  const seen = new Set();
  do {
    signal?.throwIfAborted();
    const page = validateEvolutionWorkbenchProjection(
      await pilot.evolutionWorkbenchList({
        offset: candidates.length,
        limit: PAGE_SIZE,
      }),
    );
    signal?.throwIfAborted();
    if (
      !Number.isSafeInteger(page.total) ||
      page.total < 0 ||
      page.total > MAX_ITEMS ||
      page.offset !== candidates.length ||
      page.limit !== PAGE_SIZE ||
      page.candidates.length !==
        Math.min(PAGE_SIZE, page.total - page.offset) ||
      page.hasMore !== page.offset + page.candidates.length < page.total
    )
      throw new Error("工作台分页不完整或超出上限，请检查 CLI 版本与部署。");
    if (
      first &&
      (page.projectionDigest !== first.projectionDigest ||
        page.total !== first.total ||
        JSON.stringify(page.governance) !== JSON.stringify(first.governance))
    )
      throw new Error("读取期间版本状态发生变化，请刷新后重试。");
    first ??= page;
    for (const candidate of page.candidates) {
      if (seen.has(candidate.packetDigest))
        throw new Error("工作台返回了重复版本，请刷新后重试。");
      seen.add(candidate.packetDigest);
      candidates.push(candidate);
    }
    onProgress?.(candidates.length, page.total);
    if (!page.hasMore) break;
  } while (candidates.length < MAX_ITEMS);
  return {
    projectionDigest: first.projectionDigest,
    governance: first.governance,
    candidates,
  };
}

module.exports = { loadEvolutionWorkbenchSnapshot };
