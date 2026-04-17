/**
 * `cc fusion` — CLI surface for Phase 72-73 Protocol Fusion & AI Social.
 */

import { Command } from "commander";

import {
  PROTOCOL,
  QUALITY_LEVEL,
  ensureProtocolFusionTables,
  sendMessage,
  getMessage,
  listMessages,
  mapIdentity,
  getIdentityMap,
  getIdentityById,
  listIdentities,
  verifyIdentity,
  assessQuality,
  getQualityScore,
  listQualityScores,
  getQualityReport,
  translateMessage,
  detectLanguage,
  getTranslationStats,
  getProtocolFusionStats,
} from "../lib/protocol-fusion.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

export function registerFusionCommand(program) {
  const fu = new Command("fusion")
    .description("Protocol fusion & AI social (Phase 72-73)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureProtocolFusionTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  fu.command("protocols")
    .description("List supported protocols")
    .option("--json", "JSON output")
    .action((opts) => {
      const protocols = Object.values(PROTOCOL);
      if (opts.json) return console.log(JSON.stringify(protocols, null, 2));
      for (const p of protocols) console.log(`  ${p}`);
    });

  fu.command("quality-levels")
    .description("List quality levels")
    .option("--json", "JSON output")
    .action((opts) => {
      const levels = Object.values(QUALITY_LEVEL);
      if (opts.json) return console.log(JSON.stringify(levels, null, 2));
      for (const l of levels) console.log(`  ${l}`);
    });

  /* ── Protocol Fusion (Phase 72) ──────────────────── */

  fu.command("send")
    .description("Send cross-protocol message")
    .requiredOption("-s, --source <protocol>", "Source protocol")
    .option("-t, --target <protocol>", "Target protocol")
    .option("-f, --from <id>", "Sender ID")
    .requiredOption("-c, --content <text>", "Message content")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(fu);
      const result = sendMessage(db, {
        sourceProtocol: opts.source,
        targetProtocol: opts.target,
        senderId: opts.from,
        content: opts.content,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.messageId) {
        console.log(`Message: ${result.messageId}`);
        console.log(`Converted: ${result.converted ? "YES" : "NO"}`);
        console.log(`Routed:    ${result.routed ? "YES" : "NO"}`);
      } else console.log(`Failed: ${result.reason}`);
    });

  fu.command("msg-show <id>")
    .description("Show message details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(fu);
      const m = getMessage(db, id);
      if (!m) return console.log("Message not found.");
      if (opts.json) return console.log(JSON.stringify(m, null, 2));
      console.log(`ID:       ${m.id}`);
      console.log(`Source:   ${m.source_protocol}`);
      if (m.target_protocol) console.log(`Target:   ${m.target_protocol}`);
      if (m.sender_id) console.log(`Sender:   ${m.sender_id}`);
      console.log(`Content:  ${m.content}`);
      console.log(`Converted: ${m.converted ? "YES" : "NO"}`);
      console.log(`Routed:    ${m.routed ? "YES" : "NO"}`);
    });

  fu.command("messages")
    .description("List unified messages")
    .option("-p, --protocol <name>", "Filter by protocol")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(fu);
      const msgs = listMessages(db, {
        protocol: opts.protocol,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(msgs, null, 2));
      if (msgs.length === 0) return console.log("No messages.");
      for (const m of msgs) {
        const target = m.target_protocol ? ` → ${m.target_protocol}` : "";
        console.log(
          `  ${m.source_protocol.padEnd(14)}${target.padEnd(16)} ${(m.content || "").slice(0, 40).padEnd(42)} ${m.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Identity Mapping ────────────────────────────── */

  fu.command("map-identity")
    .description("Create identity mapping")
    .option("-d, --did <id>", "DID identifier")
    .option("-a, --activitypub <id>", "ActivityPub identifier")
    .option("-n, --nostr <pubkey>", "Nostr public key")
    .option("-m, --matrix <id>", "Matrix identifier")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(fu);
      const result = mapIdentity(db, {
        didId: opts.did,
        activitypubId: opts.activitypub,
        nostrPubkey: opts.nostr,
        matrixId: opts.matrix,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.mappingId) console.log(`Mapping: ${result.mappingId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  fu.command("identity <did>")
    .description("Look up identity mapping by DID")
    .option("--json", "JSON output")
    .action((did, opts) => {
      const db = _dbFromCtx(fu);
      const m = getIdentityMap(db, did);
      if (!m) return console.log("Identity mapping not found.");
      if (opts.json) return console.log(JSON.stringify(m, null, 2));
      console.log(`ID:          ${m.id}`);
      if (m.did_id) console.log(`DID:         ${m.did_id}`);
      if (m.activitypub_id) console.log(`ActivityPub: ${m.activitypub_id}`);
      if (m.nostr_pubkey) console.log(`Nostr:       ${m.nostr_pubkey}`);
      if (m.matrix_id) console.log(`Matrix:      ${m.matrix_id}`);
      console.log(`Verified:    ${m.verified ? "YES" : "NO"}`);
    });

  fu.command("identities")
    .description("List identity mappings")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(fu);
      const ids = listIdentities(db, { limit: opts.limit });
      if (opts.json) return console.log(JSON.stringify(ids, null, 2));
      if (ids.length === 0) return console.log("No identity mappings.");
      for (const m of ids) {
        const parts = [];
        if (m.did_id) parts.push(`did:${m.did_id.slice(0, 12)}`);
        if (m.activitypub_id) parts.push(`ap:${m.activitypub_id.slice(0, 12)}`);
        if (m.nostr_pubkey) parts.push(`nostr:${m.nostr_pubkey.slice(0, 12)}`);
        if (m.matrix_id) parts.push(`mx:${m.matrix_id.slice(0, 12)}`);
        console.log(
          `  ${m.verified ? "✓" : " "} ${parts.join(" | ").padEnd(50)} ${m.id.slice(0, 8)}`,
        );
      }
    });

  fu.command("verify-identity <id>")
    .description("Verify an identity mapping")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(fu);
      const result = verifyIdentity(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.verified ? "Identity verified." : `Failed: ${result.reason}`,
      );
    });

  /* ── Content Quality (Phase 73) ──────────────────── */

  fu.command("assess <content>")
    .description("Assess content quality")
    .option("-i, --content-id <id>", "Content identifier")
    .option("--json", "JSON output")
    .action((content, opts) => {
      const db = _dbFromCtx(fu);
      const result = assessQuality(db, opts.contentId, content);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.scoreId) {
        console.log(`Score:   ${result.score}`);
        console.log(`Level:   ${result.level}`);
        console.log(`Harmful: ${result.harmful ? "YES" : "NO"}`);
      } else console.log(`Failed: ${result.reason}`);
    });

  fu.command("quality-show <id>")
    .description("Show quality score details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(fu);
      const s = getQualityScore(db, id);
      if (!s) return console.log("Quality score not found.");
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`ID:       ${s.id}`);
      console.log(`Content:  ${s.content_id}`);
      console.log(`Level:    ${s.quality_level}`);
      console.log(`Score:    ${s.quality_score}`);
      console.log(`Harmful:  ${s.harmful_detected ? "YES" : "NO"}`);
    });

  fu.command("quality-scores")
    .description("List quality scores")
    .option("-l, --level <level>", "Filter by quality level")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(fu);
      const scores = listQualityScores(db, {
        level: opts.level,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(scores, null, 2));
      if (scores.length === 0) return console.log("No quality scores.");
      for (const s of scores) {
        console.log(
          `  ${s.quality_level.padEnd(10)} ${String(s.quality_score).padEnd(6)} ${s.harmful_detected ? "HARMFUL" : "       "}  ${s.id.slice(0, 8)}`,
        );
      }
    });

  fu.command("quality-report")
    .description("Content quality report")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(fu);
      const r = getQualityReport(db);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`Total:   ${r.total}`);
      console.log(`Avg:     ${r.avgScore}`);
      console.log(`Harmful: ${r.harmful}`);
      for (const [level, count] of Object.entries(r.byLevel)) {
        console.log(`  ${level.padEnd(10)} ${count}`);
      }
    });

  /* ── Translation (Phase 73) ──────────────────────── */

  fu.command("translate <text>")
    .description("Translate text (simulated)")
    .option("-s, --source-lang <lang>", "Source language")
    .requiredOption("-t, --target-lang <lang>", "Target language")
    .option("--json", "JSON output")
    .action((text, opts) => {
      const db = _dbFromCtx(fu);
      const result = translateMessage(db, {
        text,
        sourceLang: opts.sourceLang,
        targetLang: opts.targetLang,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.translatedText) {
        console.log(`Translation: ${result.translatedText}`);
        console.log(`Cached:      ${result.cached ? "YES" : "NO"}`);
      } else console.log(`Failed: ${result.reason}`);
    });

  fu.command("detect-lang <text>")
    .description("Detect language of text")
    .option("--json", "JSON output")
    .action((text, opts) => {
      const result = detectLanguage(text);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.lang) {
        console.log(`Language:   ${result.lang}`);
        console.log(`Confidence: ${result.confidence}`);
      } else console.log(`Failed: ${result.reason}`);
    });

  fu.command("translation-stats")
    .description("Translation cache statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(fu);
      const s = getTranslationStats(db);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`Total:     ${s.total}`);
      console.log(`Cache:     ${s.cacheSize}`);
      console.log(`Languages: ${s.languages.join(", ") || "none"}`);
    });

  /* ── Stats ───────────────────────────────────────── */

  fu.command("stats")
    .description("Protocol fusion & AI social statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(fu);
      const s = getProtocolFusionStats(db);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(
        `Messages:    ${s.messages.total}  (${s.messages.converted} converted, ${s.messages.routed} routed)`,
      );
      console.log(
        `Identities:  ${s.identities.total}  (${s.identities.verified} verified)`,
      );
      console.log(
        `Quality:     ${s.quality.total}  (avg ${s.quality.avgScore}, ${s.quality.harmful} harmful)`,
      );
      console.log(
        `Translations: ${s.translations.total}  (cache: ${s.translations.cacheSize})`,
      );
    });

  program.addCommand(fu);
}
