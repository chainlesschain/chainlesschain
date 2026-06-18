#!/usr/bin/env node
/**
 * One-shot: ingest 3 plaintext-app data classes into the user's REAL PDH vault
 * (the personal-AI knowledge base), running the full canonical pipeline
 * (partition → putBatch → KG sink → RAG sink) so the data is both stored AND
 * retrievable.
 *
 *   1. 抖音观看记录  — video_record.db `record_*`        → BROWSE events
 *   2. 抖音使用画像  — 1128_feature_engineering.db        → app-usage-profile event
 *   3. 头条浏览文章  — news_article.db `article`          → BROWSE (kind=article) events
 *
 * Uses getHub() from the CLI wiring → the SAME vault the Electron app + `cc hub`
 * use (getElectronUserDataDir()/.chainlesschain/hub/vault.db), via the WORKSPACE
 * pdh source (so the just-landed readers/fixes are live without an npm publish).
 *
 * Re-runnable: every event has a stable source.originalId → re-ingest UPDATES,
 * never duplicates.
 *
 * Usage:
 *   node scripts/pdh/ingest-douyin-toutiao-local.mjs \
 *     [--douyin-dir <dir>] [--toutiao-dir <dir>] [--dry-run]
 * Defaults to the ASCII working copies under C:/tmp/dbprobe (the user's exported
 * plaintext libs). Authorization: the user's own device/account/data only.
 */
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── args ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const DRY = argv.includes("--dry-run");
const douyinDir = arg("--douyin-dir", "C:/tmp/dbprobe/dy");
const toutiaoDir = arg("--toutiao-dir", "C:/tmp/dbprobe/tt");

const VIDEO_RECORD = join(douyinDir, "video_record.db");
const FEATURE_ENG = join(douyinDir, "1128_feature_engineering.db");
const NEWS_ARTICLE = join(toutiaoDir, "news_article.db");

// ── workspace pdh + cli wiring ────────────────────────────────────────
const PDH = join(REPO_ROOT, "packages", "personal-data-hub");
const { buildWatchHistoryEvents } = require(
  `${PDH}/lib/adapters/social-douyin-adb/watch-history-reader`,
);
const { readDouyinUsageProfile, buildUsageProfileEvents, summarizeUsageProfile } =
  require(`${PDH}/lib/adapters/social-douyin-adb/usage-profile-reader`);
const { readToutiaoArticles, buildArticleEvents } = require(
  `${PDH}/lib/adapters/social-toutiao-adb/article-reader`,
);
const { partitionBatch } = require(`${PDH}/lib/batch`);
const { deriveBatchTriples } = require(`${PDH}/lib/kg-derive`);
const { deriveBatchDocs } = require(`${PDH}/lib/rag-derive`);

function gather() {
  const events = [];
  const summary = {};

  if (existsSync(VIDEO_RECORD)) {
    const wh = buildWatchHistoryEvents(VIDEO_RECORD, {});
    events.push(...wh.events);
    summary.watchHistory = { events: wh.events.length, records: wh.records, uid: wh.uid };
  } else {
    summary.watchHistory = { skipped: `not found: ${VIDEO_RECORD}` };
  }

  if (existsSync(FEATURE_ENG)) {
    const profile = readDouyinUsageProfile(FEATURE_ENG, {});
    const { events: ue } = buildUsageProfileEvents(profile, {});
    events.push(...ue);
    summary.usageProfile = { events: ue.length, text: summarizeUsageProfile(profile) };
  } else {
    summary.usageProfile = { skipped: `not found: ${FEATURE_ENG}` };
  }

  if (existsSync(NEWS_ARTICLE)) {
    const { articles } = readToutiaoArticles(NEWS_ARTICLE, {});
    const { events: ae } = buildArticleEvents(articles, {});
    events.push(...ae);
    summary.articles = {
      events: ae.length,
      articles: articles.length,
      digg: articles.filter((a) => a.digg).length,
    };
  } else {
    summary.articles = { skipped: `not found: ${NEWS_ARTICLE}` };
  }

  return { events, summary };
}

async function main() {
  const { events, summary } = gather();
  console.log("── 待 ingest 事件 ──");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`总事件数: ${events.length}`);

  if (events.length === 0) {
    console.log("无事件可 ingest（检查 DB 路径）。");
    process.exit(1);
  }
  if (DRY) {
    console.log("--dry-run：不写 vault。");
    return;
  }

  // partition gates schema validity (same as the registry sync path)
  const { valid, invalidReasons } = partitionBatch({ events });
  if (invalidReasons.length) {
    console.warn(`⚠️ ${invalidReasons.length} 个事件未过 schema 校验:`,
      JSON.stringify(invalidReasons.slice(0, 5)));
  }

  // open the REAL hub vault (workspace source)
  process.env.CC_HUB_DISABLE_EMBEDDINGS = process.env.CC_HUB_DISABLE_EMBEDDINGS || "1";
  const wiringUrl = pathToFileURL(
    join(REPO_ROOT, "packages", "cli", "src", "lib", "personal-data-hub-wiring.js"),
  ).href;
  const { getHub } = await import(wiringUrl);
  const hub = await getHub();
  try {
    console.log(`\nvault: ${hub.hubDir}`);
    const before = hub.vault.stats();

    const counts = hub.vault.putBatch(valid);
    console.log(`putBatch → events:${counts.events} items:${counts.items} persons:${counts.persons}`);

    // hub exposes sinks as CcKgSink/CcRagSink instances (.write) — also accept
    // a bare callback for forward-compat.
    const callSink = (sink, payload) => {
      if (typeof sink === "function") return sink(payload);
      if (sink && typeof sink.write === "function") return sink.write(payload);
      return undefined;
    };
    if (hub.kgSink) {
      const triples = deriveBatchTriples(valid);
      await callSink(hub.kgSink, triples);
      console.log(`kgSink ← ${triples.length} triples`);
    }
    if (hub.ragSink) {
      const docs = deriveBatchDocs(valid);
      await callSink(hub.ragSink, docs);
      console.log(`ragSink ← ${docs.length} docs`);
    }

    const after = hub.vault.stats();
    console.log(`\nvault events: ${before.events ?? "?"} → ${after.events ?? "?"}`);
    console.log("✓ ingest 完成。");
  } finally {
    try { hub.vault.close(); } catch { /* best-effort */ }
  }
}

main().catch((e) => {
  console.error("ingest 失败:", e && e.message ? e.message : e);
  process.exit(1);
});
