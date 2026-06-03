/**
 * `cc recommend` — CLI surface for Phase 48 Smart Content Recommendation.
 */

import { Command } from "commander";

import {
  CONTENT_TYPES,
  RECOMMENDATION_STATUS,
  FEEDBACK_VALUES,
  DEFAULT_CONFIG,
  ensureRecommendationTables,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  listProfiles,
  applyDecay,
  scoreContent,
  generateRecommendations,
  getRecommendation,
  listRecommendations,
  markViewed,
  provideFeedback,
  dismissRecommendation,
  getRecommendationStats,
  getTopInterests,
  suggestTopics,
  // V2 (Phase 48 V2)
  PROFILE_MATURITY_V2,
  FEED_LIFECYCLE_V2,
  REC_DEFAULT_MAX_ACTIVE_PROFILES_PER_SEGMENT,
  REC_DEFAULT_MAX_ACTIVE_FEEDS_PER_CURATOR,
  REC_DEFAULT_PROFILE_IDLE_MS,
  REC_DEFAULT_FEED_STALE_MS,
  getDefaultMaxActiveProfilesPerSegmentV2,
  getMaxActiveProfilesPerSegmentV2,
  setMaxActiveProfilesPerSegmentV2,
  getDefaultMaxActiveFeedsPerCuratorV2,
  getMaxActiveFeedsPerCuratorV2,
  setMaxActiveFeedsPerCuratorV2,
  getDefaultProfileIdleMsV2,
  getProfileIdleMsV2,
  setProfileIdleMsV2,
  getDefaultFeedStaleMsV2,
  getFeedStaleMsV2,
  setFeedStaleMsV2,
  registerProfileV2,
  getProfileV2,
  setProfileMaturityV2,
  activateProfile,
  dormantProfile,
  retireProfile,
  touchProfileActivity,
  registerFeedV2,
  getFeedV2,
  setFeedStatusV2,
  activateFeed,
  pauseFeed,
  archiveFeed,
  touchFeedPublish,
  getActiveProfileCount,
  getActiveFeedCount,
  autoDormantIdleProfiles,
  autoArchiveStaleFeeds,
  getRecommendationStatsV2,
} from "../lib/content-recommendation.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

export function registerRecommendCommand(program) {
  const rec = new Command("recommend")
    .description("Smart content recommendation (Phase 48)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureRecommendationTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  rec
    .command("content-types")
    .description("List supported content types")
    .option("--json", "JSON output")
    .action((opts) => {
      const types = Object.values(CONTENT_TYPES);
      if (opts.json) return console.log(JSON.stringify(types, null, 2));
      for (const t of types)
        console.log(`  ${t.id.padEnd(12)} ${t.name} — ${t.description}`);
    });

  rec
    .command("statuses")
    .description("List recommendation statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const statuses = Object.values(RECOMMENDATION_STATUS);
      if (opts.json) return console.log(JSON.stringify(statuses, null, 2));
      for (const s of statuses) console.log(`  ${s}`);
    });

  rec
    .command("feedback-values")
    .description("List feedback values")
    .option("--json", "JSON output")
    .action((opts) => {
      const vals = Object.values(FEEDBACK_VALUES);
      if (opts.json) return console.log(JSON.stringify(vals, null, 2));
      for (const v of vals) console.log(`  ${v}`);
    });

  /* ── Profile Management ──────────────────────────── */

  rec
    .command("profile <user-id>")
    .description("Show user interest profile")
    .option("--json", "JSON output")
    .action((userId, opts) => {
      const db = _dbFromCtx(rec);
      const p = getProfile(db, userId);
      if (!p) return console.log("Profile not found.");
      if (opts.json) return console.log(JSON.stringify(p, null, 2));
      console.log(`User:     ${p.user_id}`);
      console.log(`Updated:  ${new Date(p.last_updated).toISOString()}`);
      console.log(`Updates:  ${p.update_count}`);
      console.log(`Decay:    ${p.decay_factor}`);
      console.log(`Topics:`);
      for (const [t, w] of Object.entries(p.topics))
        console.log(`  ${t}: ${w}`);
    });

  rec
    .command("create-profile <user-id>")
    .description("Create interest profile for a user")
    .option("-t, --topics <json>", "Topic weights JSON")
    .option("-w, --weights <json>", "Interaction weights JSON")
    .option("--json", "JSON output")
    .action((userId, opts) => {
      const db = _dbFromCtx(rec);
      const topics = opts.topics ? JSON.parse(opts.topics) : {};
      const interactionWeights = opts.weights ? JSON.parse(opts.weights) : {};
      const result = createProfile(db, userId, { topics, interactionWeights });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.profileId) console.log(`Profile created: ${result.profileId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  rec
    .command("update-profile <user-id>")
    .description("Update interest profile")
    .option("-t, --topics <json>", "Topic weights JSON")
    .option("-w, --weights <json>", "Interaction weights JSON")
    .option("-d, --decay <factor>", "Decay factor", parseFloat)
    .option("--json", "JSON output")
    .action((userId, opts) => {
      const db = _dbFromCtx(rec);
      const params = {};
      if (opts.topics) params.topics = JSON.parse(opts.topics);
      if (opts.weights) params.interactionWeights = JSON.parse(opts.weights);
      if (opts.decay !== undefined) params.decayFactor = opts.decay;
      const result = updateProfile(db, userId, params);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.updated ? "Profile updated." : `Failed: ${result.reason}`,
      );
    });

  rec
    .command("delete-profile <user-id>")
    .description("Delete interest profile")
    .option("--json", "JSON output")
    .action((userId, opts) => {
      const db = _dbFromCtx(rec);
      const result = deleteProfile(db, userId);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.deleted ? "Profile deleted." : `Failed: ${result.reason}`,
      );
    });

  rec
    .command("profiles")
    .description("List all interest profiles")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(rec);
      const profiles = listProfiles(db, { limit: opts.limit });
      if (opts.json) return console.log(JSON.stringify(profiles, null, 2));
      if (profiles.length === 0) return console.log("No profiles.");
      for (const p of profiles) {
        const topicCount = Object.keys(p.topics).length;
        console.log(
          `  ${p.user_id.padEnd(20)} ${topicCount} topics  updated ${new Date(p.last_updated).toISOString()}`,
        );
      }
    });

  rec
    .command("decay <user-id>")
    .description("Apply time decay to profile topics")
    .option("--json", "JSON output")
    .action((userId, opts) => {
      const db = _dbFromCtx(rec);
      const result = applyDecay(db, userId);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.applied)
        console.log(`Decay applied. ${result.topicCount} topics remaining.`);
      else console.log(`Failed: ${result.reason}`);
    });

  /* ── Recommendation Generation ───────────────────── */

  rec
    .command("generate <user-id>")
    .description(
      "Generate recommendations from content pool (JSON stdin or --pool)",
    )
    .option("-p, --pool <json>", "Content pool as JSON array")
    .option("-l, --limit <n>", "Max recommendations", parseInt)
    .option("-m, --min-score <n>", "Minimum score", parseFloat)
    .option("--json", "JSON output")
    .action((userId, opts) => {
      const db = _dbFromCtx(rec);
      if (!opts.pool) {
        return console.log("Provide --pool as JSON array of content items.");
      }
      const pool = JSON.parse(opts.pool);
      const result = generateRecommendations(db, userId, pool, {
        limit: opts.limit,
        minScore: opts.minScore,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.reason) return console.log(`Failed: ${result.reason}`);
      console.log(`Generated ${result.generated} recommendations.`);
    });

  /* ── Recommendation CRUD ─────────────────────────── */

  rec
    .command("show <rec-id>")
    .description("Show recommendation details")
    .option("--json", "JSON output")
    .action((recId, opts) => {
      const db = _dbFromCtx(rec);
      const r = getRecommendation(db, recId);
      if (!r) return console.log("Recommendation not found.");
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`ID:       ${r.id}`);
      console.log(`User:     ${r.user_id}`);
      console.log(`Content:  ${r.content_id} (${r.content_type})`);
      console.log(`Title:    ${r.title}`);
      console.log(`Score:    ${r.score}`);
      console.log(`Reason:   ${r.reason}`);
      console.log(`Status:   ${r.status}`);
      if (r.feedback) console.log(`Feedback: ${r.feedback}`);
    });

  rec
    .command("list <user-id>")
    .description("List recommendations for a user")
    .option("-s, --status <status>", "Filter by status")
    .option("-t, --type <type>", "Filter by content type")
    .option("-m, --min-score <n>", "Minimum score", parseFloat)
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((userId, opts) => {
      const db = _dbFromCtx(rec);
      const recs = listRecommendations(db, userId, {
        status: opts.status,
        contentType: opts.type,
        limit: opts.limit,
        minScore: opts.minScore,
      });
      if (opts.json) return console.log(JSON.stringify(recs, null, 2));
      if (recs.length === 0) return console.log("No recommendations.");
      for (const r of recs) {
        const fb = r.feedback ? ` [${r.feedback}]` : "";
        console.log(
          `  ${r.score.toFixed(3)}  ${r.status.padEnd(10)} ${r.title || r.content_id}${fb}`,
        );
      }
    });

  rec
    .command("view <rec-id>")
    .description("Mark recommendation as viewed")
    .option("--json", "JSON output")
    .action((recId, opts) => {
      const db = _dbFromCtx(rec);
      const result = markViewed(db, recId);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.marked ? "Marked as viewed." : `Failed: ${result.reason}`,
      );
    });

  rec
    .command("feedback <rec-id> <value>")
    .description("Provide feedback (like / dislike / later)")
    .option("--json", "JSON output")
    .action((recId, value, opts) => {
      const db = _dbFromCtx(rec);
      const result = provideFeedback(db, recId, value);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.recorded ? "Feedback recorded." : `Failed: ${result.reason}`,
      );
    });

  rec
    .command("dismiss <rec-id>")
    .description("Dismiss a recommendation")
    .option("--json", "JSON output")
    .action((recId, opts) => {
      const db = _dbFromCtx(rec);
      const result = dismissRecommendation(db, recId);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(result.dismissed ? "Dismissed." : `Failed: ${result.reason}`);
    });

  /* ── Stats & Insights ────────────────────────────── */

  rec
    .command("stats <user-id>")
    .description("Recommendation statistics")
    .option("--json", "JSON output")
    .action((userId, opts) => {
      const db = _dbFromCtx(rec);
      const stats = getRecommendationStats(db, userId);
      if (opts.json) return console.log(JSON.stringify(stats, null, 2));
      console.log(`Total:         ${stats.total}`);
      console.log(`Pending:       ${stats.pending}`);
      console.log(`Viewed:        ${stats.viewed}`);
      console.log(`Dismissed:     ${stats.dismissed}`);
      console.log(
        `Feedback:      ${stats.feedbackCount} (${(stats.feedbackRate * 100).toFixed(1)}%)`,
      );
      console.log(`Avg score:     ${stats.avgScore}`);
    });

  rec
    .command("top-interests <user-id>")
    .description("Show top interests from profile")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((userId, opts) => {
      const db = _dbFromCtx(rec);
      const interests = getTopInterests(db, userId, { limit: opts.limit });
      if (opts.json) return console.log(JSON.stringify(interests, null, 2));
      if (interests.length === 0) return console.log("No interests found.");
      for (const i of interests)
        console.log(`  ${i.topic.padEnd(20)} ${i.weight}`);
    });

  rec
    .command("suggest <user-id>")
    .description("Suggest profile adjustments from feedback patterns")
    .option("--json", "JSON output")
    .action((userId, opts) => {
      const db = _dbFromCtx(rec);
      const suggestions = suggestTopics(db, userId);
      if (opts.json) return console.log(JSON.stringify(suggestions, null, 2));
      if (suggestions.length === 0)
        return console.log("No suggestions — need more feedback.");
      for (const s of suggestions)
        console.log(`  ${s.action.padEnd(8)} ${s.topic} by ${s.amount}`);
    });

  /* ── V2 (Phase 48 V2) ────────────────────────────── */

  function _parseJsonFlag(value, label) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`Invalid JSON for ${label}`);
    }
  }

  rec
    .command("profile-maturities-v2")
    .description("List V2 profile maturity states")
    .option("--json", "JSON output")
    .action((opts) => {
      const out = Object.values(PROFILE_MATURITY_V2);
      if (opts.json) return console.log(JSON.stringify(out, null, 2));
      for (const s of out) console.log(`  ${s}`);
    });

  rec
    .command("feed-lifecycles-v2")
    .description("List V2 feed lifecycle states")
    .option("--json", "JSON output")
    .action((opts) => {
      const out = Object.values(FEED_LIFECYCLE_V2);
      if (opts.json) return console.log(JSON.stringify(out, null, 2));
      for (const s of out) console.log(`  ${s}`);
    });

  rec
    .command("default-max-active-profiles-per-segment")
    .description("Show V2 default per-segment active-profile cap")
    .action(() =>
      console.log(String(getDefaultMaxActiveProfilesPerSegmentV2())),
    );

  rec
    .command("max-active-profiles-per-segment")
    .description("Show current V2 per-segment active-profile cap")
    .action(() => console.log(String(getMaxActiveProfilesPerSegmentV2())));

  rec
    .command("set-max-active-profiles-per-segment <n>")
    .description("Set V2 per-segment active-profile cap")
    .action((n) =>
      console.log(String(setMaxActiveProfilesPerSegmentV2(Number(n)))),
    );

  rec
    .command("default-max-active-feeds-per-curator")
    .description("Show V2 default per-curator active-feed cap")
    .action(() => console.log(String(getDefaultMaxActiveFeedsPerCuratorV2())));

  rec
    .command("max-active-feeds-per-curator")
    .description("Show current V2 per-curator active-feed cap")
    .action(() => console.log(String(getMaxActiveFeedsPerCuratorV2())));

  rec
    .command("set-max-active-feeds-per-curator <n>")
    .description("Set V2 per-curator active-feed cap")
    .action((n) =>
      console.log(String(setMaxActiveFeedsPerCuratorV2(Number(n)))),
    );

  rec
    .command("default-profile-idle-ms")
    .description("Show V2 default profile-idle window (ms)")
    .action(() => console.log(String(getDefaultProfileIdleMsV2())));

  rec
    .command("profile-idle-ms")
    .description("Show current V2 profile-idle window (ms)")
    .action(() => console.log(String(getProfileIdleMsV2())));

  rec
    .command("set-profile-idle-ms <ms>")
    .description("Set V2 profile-idle window (ms)")
    .action((ms) => console.log(String(setProfileIdleMsV2(Number(ms)))));

  rec
    .command("default-feed-stale-ms")
    .description("Show V2 default feed-stale window (ms)")
    .action(() => console.log(String(getDefaultFeedStaleMsV2())));

  rec
    .command("feed-stale-ms")
    .description("Show current V2 feed-stale window (ms)")
    .action(() => console.log(String(getFeedStaleMsV2())));

  rec
    .command("set-feed-stale-ms <ms>")
    .description("Set V2 feed-stale window (ms)")
    .action((ms) => console.log(String(setFeedStaleMsV2(Number(ms)))));

  rec
    .command("active-profile-count")
    .description("Count active V2 profiles (optionally scoped by segment)")
    .option("-s, --segment <segment>", "Scope by segment")
    .action((opts) => console.log(String(getActiveProfileCount(opts.segment))));

  rec
    .command("active-feed-count")
    .description("Count active V2 feeds (optionally scoped by curator)")
    .option("-c, --curator <curator>", "Scope by curator")
    .action((opts) => console.log(String(getActiveFeedCount(opts.curator))));

  rec
    .command("register-profile-v2 <profile-id>")
    .description("Register a V2 profile")
    .requiredOption("-s, --segment <segment>", "Segment bucket")
    .option("-u, --user-id <user-id>", "User id")
    .option("-i, --initial-status <status>", "Initial maturity status")
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((profileId, opts) => {
      const db = _dbFromCtx(rec);
      const metadata = _parseJsonFlag(opts.metadata, "--metadata");
      const out = registerProfileV2(db, {
        profileId,
        segment: opts.segment,
        userId: opts.userId,
        initialStatus: opts.initialStatus,
        metadata,
      });
      console.log(JSON.stringify(out, null, 2));
    });

  rec
    .command("profile-v2 <profile-id>")
    .description("Show a V2 profile")
    .action((profileId) => {
      const out = getProfileV2(profileId);
      console.log(out ? JSON.stringify(out, null, 2) : "null");
    });

  rec
    .command("set-profile-maturity-v2 <profile-id> <status>")
    .description("Set V2 profile maturity status")
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <json>", "Metadata JSON (merged)")
    .action((profileId, status, opts) => {
      const db = _dbFromCtx(rec);
      const metadata = _parseJsonFlag(opts.metadata, "--metadata");
      const out = setProfileMaturityV2(db, profileId, status, {
        reason: opts.reason,
        metadata,
      });
      console.log(JSON.stringify(out, null, 2));
    });

  rec
    .command("activate-profile <profile-id>")
    .description("Activate a V2 profile")
    .option("-r, --reason <reason>", "Reason")
    .action((profileId, opts) => {
      const db = _dbFromCtx(rec);
      console.log(
        JSON.stringify(activateProfile(db, profileId, opts.reason), null, 2),
      );
    });

  rec
    .command("dormant-profile <profile-id>")
    .description("Mark a V2 profile dormant")
    .option("-r, --reason <reason>", "Reason")
    .action((profileId, opts) => {
      const db = _dbFromCtx(rec);
      console.log(
        JSON.stringify(dormantProfile(db, profileId, opts.reason), null, 2),
      );
    });

  rec
    .command("retire-profile <profile-id>")
    .description("Retire a V2 profile")
    .option("-r, --reason <reason>", "Reason")
    .action((profileId, opts) => {
      const db = _dbFromCtx(rec);
      console.log(
        JSON.stringify(retireProfile(db, profileId, opts.reason), null, 2),
      );
    });

  rec
    .command("touch-profile-activity <profile-id>")
    .description("Bump lastActivityAt on a V2 profile")
    .action((profileId) => {
      console.log(JSON.stringify(touchProfileActivity(profileId), null, 2));
    });

  rec
    .command("register-feed-v2 <feed-id>")
    .description("Register a V2 feed")
    .requiredOption("-c, --curator-id <curator>", "Curator id")
    .option("-t, --topics <csv>", "Comma-separated topics")
    .option("-i, --initial-status <status>", "Initial lifecycle status")
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((feedId, opts) => {
      const db = _dbFromCtx(rec);
      const metadata = _parseJsonFlag(opts.metadata, "--metadata");
      const topics = opts.topics
        ? opts.topics
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const out = registerFeedV2(db, {
        feedId,
        curatorId: opts.curatorId,
        topics,
        initialStatus: opts.initialStatus,
        metadata,
      });
      console.log(JSON.stringify(out, null, 2));
    });

  rec
    .command("feed-v2 <feed-id>")
    .description("Show a V2 feed")
    .action((feedId) => {
      const out = getFeedV2(feedId);
      console.log(out ? JSON.stringify(out, null, 2) : "null");
    });

  rec
    .command("set-feed-status-v2 <feed-id> <status>")
    .description("Set V2 feed lifecycle status")
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <json>", "Metadata JSON (merged)")
    .action((feedId, status, opts) => {
      const db = _dbFromCtx(rec);
      const metadata = _parseJsonFlag(opts.metadata, "--metadata");
      const out = setFeedStatusV2(db, feedId, status, {
        reason: opts.reason,
        metadata,
      });
      console.log(JSON.stringify(out, null, 2));
    });

  rec
    .command("activate-feed <feed-id>")
    .description("Activate a V2 feed")
    .option("-r, --reason <reason>", "Reason")
    .action((feedId, opts) => {
      const db = _dbFromCtx(rec);
      console.log(
        JSON.stringify(activateFeed(db, feedId, opts.reason), null, 2),
      );
    });

  rec
    .command("pause-feed <feed-id>")
    .description("Pause a V2 feed")
    .option("-r, --reason <reason>", "Reason")
    .action((feedId, opts) => {
      const db = _dbFromCtx(rec);
      console.log(JSON.stringify(pauseFeed(db, feedId, opts.reason), null, 2));
    });

  rec
    .command("archive-feed <feed-id>")
    .description("Archive a V2 feed")
    .option("-r, --reason <reason>", "Reason")
    .action((feedId, opts) => {
      const db = _dbFromCtx(rec);
      console.log(
        JSON.stringify(archiveFeed(db, feedId, opts.reason), null, 2),
      );
    });

  rec
    .command("touch-feed-publish <feed-id>")
    .description("Bump lastPublishAt on a V2 feed")
    .action((feedId) => {
      console.log(JSON.stringify(touchFeedPublish(feedId), null, 2));
    });

  rec
    .command("auto-dormant-idle-profiles")
    .description("Auto-flip idle ACTIVE V2 profiles to DORMANT")
    .action(() => {
      const db = _dbFromCtx(rec);
      console.log(JSON.stringify(autoDormantIdleProfiles(db), null, 2));
    });

  rec
    .command("auto-archive-stale-feeds")
    .description("Auto-flip stale ACTIVE/PAUSED V2 feeds to ARCHIVED")
    .action(() => {
      const db = _dbFromCtx(rec);
      console.log(JSON.stringify(autoArchiveStaleFeeds(db), null, 2));
    });

  rec
    .command("stats-v2")
    .description("V2 recommendation stats (counts by state + config)")
    .action(() => {
      console.log(JSON.stringify(getRecommendationStatsV2(), null, 2));
    });

  program.addCommand(rec);

  _registerRecommendCrV2(rec);
}

import {
  RECOMMENDER_PROFILE_MATURITY_V2,
  RECOMMENDATION_JOB_LIFECYCLE_V2,
  setMaxActiveRecommenderProfilesPerOwnerV2,
  setMaxPendingRecommendationJobsPerProfileV2,
  setRecommenderProfileIdleMsV2,
  setRecommendationJobStuckMsV2,
  registerRecommenderProfileV2,
  activateRecommenderProfileV2,
  staleRecommenderProfileV2,
  archiveRecommenderProfileV2,
  touchRecommenderProfileV2,
  getRecommenderProfileV2,
  listRecommenderProfilesV2,
  createRecommendationJobV2,
  startRecommendationJobV2,
  completeRecommendationJobV2,
  failRecommendationJobV2,
  cancelRecommendationJobV2,
  getRecommendationJobV2,
  listRecommendationJobsV2,
  autoStaleIdleRecommenderProfilesV2,
  autoFailStuckRecommendationJobsV2,
  getContentRecommenderGovStatsV2,
} from "../lib/content-recommender.js";

function _registerRecommendCrV2(parent) {
  parent
    .command("cr-enums-v2")
    .description("List Content Recommender V2 enums")
    .option("--json", "JSON")
    .action((opts) => {
      const out = {
        profileMaturity: RECOMMENDER_PROFILE_MATURITY_V2,
        jobLifecycle: RECOMMENDATION_JOB_LIFECYCLE_V2,
      };
      if (opts.json) console.log(JSON.stringify(out, null, 2));
      else console.log(out);
    });
  parent
    .command("cr-config-set-v2")
    .description("Set Content Recommender V2 caps/thresholds")
    .option("--max-active <n>", "max active per owner")
    .option("--max-pending <n>", "max pending per profile")
    .option("--idle-ms <n>", "profile idle ms")
    .option("--stuck-ms <n>", "job stuck ms")
    .action((opts) => {
      if (opts.maxActive)
        setMaxActiveRecommenderProfilesPerOwnerV2(parseInt(opts.maxActive, 10));
      if (opts.maxPending)
        setMaxPendingRecommendationJobsPerProfileV2(
          parseInt(opts.maxPending, 10),
        );
      if (opts.idleMs) setRecommenderProfileIdleMsV2(parseInt(opts.idleMs, 10));
      if (opts.stuckMs)
        setRecommendationJobStuckMsV2(parseInt(opts.stuckMs, 10));
      console.log("ok");
    });
  parent
    .command("cr-register-profile-v2 <id>")
    .description("Register Recommender V2 profile")
    .requiredOption("--owner <owner>", "owner")
    .option("--strategy <s>", "strategy")
    .action((id, opts) => {
      console.log(
        registerRecommenderProfileV2({
          id,
          owner: opts.owner,
          strategy: opts.strategy,
        }),
      );
    });
  parent
    .command("cr-activate-profile-v2 <id>")
    .description("Activate Recommender V2 profile")
    .action((id) => {
      console.log(activateRecommenderProfileV2(id));
    });
  parent
    .command("cr-stale-profile-v2 <id>")
    .description("Mark Recommender V2 profile stale")
    .action((id) => {
      console.log(staleRecommenderProfileV2(id));
    });
  parent
    .command("cr-archive-profile-v2 <id>")
    .description("Archive Recommender V2 profile")
    .action((id) => {
      console.log(archiveRecommenderProfileV2(id));
    });
  parent
    .command("cr-touch-profile-v2 <id>")
    .description("Touch Recommender V2 profile")
    .action((id) => {
      console.log(touchRecommenderProfileV2(id));
    });
  parent
    .command("cr-get-profile-v2 <id>")
    .description("Get Recommender V2 profile")
    .action((id) => {
      console.log(getRecommenderProfileV2(id));
    });
  parent
    .command("cr-list-profiles-v2")
    .description("List Recommender V2 profiles")
    .action(() => {
      console.log(listRecommenderProfilesV2());
    });
  parent
    .command("cr-create-job-v2 <id>")
    .description("Create Recommendation V2 job")
    .requiredOption("--profile-id <pid>", "profile id")
    .option("--query <q>", "query")
    .action((id, opts) => {
      console.log(
        createRecommendationJobV2({
          id,
          profileId: opts.profileId,
          query: opts.query,
        }),
      );
    });
  parent
    .command("cr-start-job-v2 <id>")
    .description("Start Recommendation V2 job")
    .action((id) => {
      console.log(startRecommendationJobV2(id));
    });
  parent
    .command("cr-complete-job-v2 <id>")
    .description("Complete Recommendation V2 job")
    .action((id) => {
      console.log(completeRecommendationJobV2(id));
    });
  parent
    .command("cr-fail-job-v2 <id>")
    .description("Fail Recommendation V2 job")
    .option("--reason <r>", "reason")
    .action((id, opts) => {
      console.log(failRecommendationJobV2(id, opts.reason));
    });
  parent
    .command("cr-cancel-job-v2 <id>")
    .description("Cancel Recommendation V2 job")
    .option("--reason <r>", "reason")
    .action((id, opts) => {
      console.log(cancelRecommendationJobV2(id, opts.reason));
    });
  parent
    .command("cr-get-job-v2 <id>")
    .description("Get Recommendation V2 job")
    .action((id) => {
      console.log(getRecommendationJobV2(id));
    });
  parent
    .command("cr-list-jobs-v2")
    .description("List Recommendation V2 jobs")
    .action(() => {
      console.log(listRecommendationJobsV2());
    });
  parent
    .command("cr-auto-stale-profiles-v2")
    .description("Auto-stale idle Recommender V2 profiles")
    .action(() => {
      console.log(autoStaleIdleRecommenderProfilesV2());
    });
  parent
    .command("cr-auto-fail-jobs-v2")
    .description("Auto-fail stuck Recommendation V2 jobs")
    .action(() => {
      console.log(autoFailStuckRecommendationJobsV2());
    });
  parent
    .command("cr-gov-stats-v2")
    .description("Content Recommender V2 governance stats")
    .option("--json", "JSON")
    .action((opts) => {
      const s = getContentRecommenderGovStatsV2();
      if (opts.json) console.log(JSON.stringify(s, null, 2));
      else console.log(s);
    });
}

// === Iter24 V2 governance overlay ===
export function registerRcmdgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "recommend");
  if (!parent) return;
  const L = async () => await import("../lib/content-recommendation.js");
  parent
    .command("rcmdgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.RCMDGOV_PROFILE_MATURITY_V2,
            recommendationLifecycle: m.RCMDGOV_RECOMMENDATION_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("rcmdgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveRcmdgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingRcmdgovRecommendationsPerProfileV2(),
            idleMs: m.getRcmdgovProfileIdleMsV2(),
            stuckMs: m.getRcmdgovRecommendationStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("rcmdgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveRcmdgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("rcmdgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingRcmdgovRecommendationsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("rcmdgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setRcmdgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("rcmdgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setRcmdgovRecommendationStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("rcmdgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--channel <v>", "channel")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerRcmdgovProfileV2({ id, owner, channel: o.channel }),
          null,
          2,
        ),
      );
    });
  parent
    .command("rcmdgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateRcmdgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("rcmdgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleRcmdgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("rcmdgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveRcmdgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("rcmdgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchRcmdgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("rcmdgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getRcmdgovProfileV2(id), null, 2));
    });
  parent
    .command("rcmdgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listRcmdgovProfilesV2(), null, 2));
    });
  parent
    .command("rcmdgov-create-recommendation-v2 <id> <profileId>")
    .description("Create recommendation")
    .option("--user <v>", "user")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createRcmdgovRecommendationV2({ id, profileId, user: o.user }),
          null,
          2,
        ),
      );
    });
  parent
    .command("rcmdgov-scoring-recommendation-v2 <id>")
    .description("Mark recommendation as scoring")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).scoringRcmdgovRecommendationV2(id), null, 2),
      );
    });
  parent
    .command("rcmdgov-complete-recommendation-v2 <id>")
    .description("Complete recommendation")
    .action(async (id) => {
      console.log(
        JSON.stringify(
          (await L()).completeRecommendationRcmdgovV2(id),
          null,
          2,
        ),
      );
    });
  parent
    .command("rcmdgov-fail-recommendation-v2 <id> [reason]")
    .description("Fail recommendation")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify(
          (await L()).failRcmdgovRecommendationV2(id, reason),
          null,
          2,
        ),
      );
    });
  parent
    .command("rcmdgov-cancel-recommendation-v2 <id> [reason]")
    .description("Cancel recommendation")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify(
          (await L()).cancelRcmdgovRecommendationV2(id, reason),
          null,
          2,
        ),
      );
    });
  parent
    .command("rcmdgov-get-recommendation-v2 <id>")
    .description("Get recommendation")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getRcmdgovRecommendationV2(id), null, 2),
      );
    });
  parent
    .command("rcmdgov-list-recommendations-v2")
    .description("List recommendations")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listRcmdgovRecommendationsV2(), null, 2),
      );
    });
  parent
    .command("rcmdgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleRcmdgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("rcmdgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck recommendations")
    .action(async () => {
      console.log(
        JSON.stringify(
          (await L()).autoFailStuckRcmdgovRecommendationsV2(),
          null,
          2,
        ),
      );
    });
  parent
    .command("rcmdgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify(
          (await L()).getContentRecommendationGovStatsV2(),
          null,
          2,
        ),
      );
    });
}
