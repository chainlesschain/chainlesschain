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

  program.addCommand(rec);
}
