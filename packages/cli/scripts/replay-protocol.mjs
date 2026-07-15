#!/usr/bin/env node
/**
 * Offline protocol replay tool (P1-9 "离线协议回放" of
 * docs/CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md).
 *
 * Replays a recorded stream-json session (NDJSON, one JSON frame per line — or a
 * JSON array) against a negotiation context, WITHOUT any live peer:
 *
 *   node scripts/replay-protocol.mjs <session.ndjson> [--replay]
 *       print the frames as they'd appear on the wire under the negotiation
 *       (gated-off fields stripped) + a deterministic digest.
 *
 *   node scripts/replay-protocol.mjs <session.ndjson> --audit
 *       report any frame carrying a negotiable wire field the negotiation gated
 *       OFF (a forward-compat violation); exit 1 if any are found.
 *
 * Negotiation context flags (all optional; default = full server, legacy client):
 *   --server-version N        server max protocol version
 *   --server-min N            server min protocol version
 *   --server-features a,b     server-advertised wire features
 *   --client-version N        client max protocol version (presence = non-legacy)
 *   --client-min N            client min protocol version
 *   --client-features a,b     client-accepted wire features (omit = accept all)
 *
 * Pure offline tool: reads a file, prints JSON, sets an exit code. No network.
 */
import { readFileSync } from "node:fs";
import {
  replaySession,
  auditRecordedSession,
} from "../src/lib/protocol-replay.js";
import {
  PROTOCOL_VERSION,
  PROTOCOL_FEATURES,
} from "../src/lib/capability-negotiation.js";

function flag(args, name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
}
function intFlag(args, name, fallback) {
  const v = flag(args, name);
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
function listFlag(args, name) {
  const v = flag(args, name);
  return v === undefined
    ? undefined
    : v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

function parseFrames(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  return trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (err) {
        throw new Error(`line ${i + 1} is not valid JSON: ${err.message}`);
      }
    });
}

function buildCtx(args) {
  const server = {
    protocolVersion: intFlag(args, "--server-version", PROTOCOL_VERSION),
    minProtocolVersion: intFlag(args, "--server-min", 1),
    features: listFlag(args, "--server-features") ?? [...PROTOCOL_FEATURES],
  };
  // A client offer exists only if any --client-* flag was given.
  const hasClient =
    args.includes("--client-version") ||
    args.includes("--client-min") ||
    args.includes("--client-features");
  const client = hasClient
    ? {
        protocolVersion: intFlag(args, "--client-version", PROTOCOL_VERSION),
        minProtocolVersion: intFlag(args, "--client-min", 1),
        ...(listFlag(args, "--client-features") !== undefined
          ? { features: listFlag(args, "--client-features") }
          : {}),
      }
    : null;
  return { server, client };
}

function main(argv) {
  const args = argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    process.stderr.write(
      "usage: replay-protocol.mjs <session.ndjson> [--replay|--audit] [negotiation flags]\n",
    );
    process.exit(2);
  }

  let frames;
  try {
    frames = parseFrames(readFileSync(file, "utf-8"));
  } catch (err) {
    process.stderr.write(`Cannot read ${file}: ${err.message}\n`);
    process.exit(2);
  }

  const ctx = buildCtx(args);

  if (args.includes("--audit")) {
    const audit = auditRecordedSession(frames, ctx);
    if (audit.ok) {
      process.stdout.write(
        `No compat violations: ${frames.length} frames obey the negotiation ` +
          `(gated off: ${audit.gatedFields.join(", ") || "none"}).\n`,
      );
      process.exit(0);
    }
    process.stderr.write(
      `Protocol compat violations (${audit.violations.length}):\n`,
    );
    for (const v of audit.violations) {
      process.stderr.write(
        `  frame #${v.index} (${v.type ?? "?"}) carries gated-off field \`${v.field}\`\n`,
      );
    }
    process.exit(1);
  }

  // Default: replay to the wire.
  const result = replaySession(frames, ctx);
  const out = {
    negotiation: result.negotiation,
    enabledFields: result.enabledFields,
    gatedFields: result.gatedFields,
    digest: result.digest,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  for (const f of result.frames) process.stdout.write(JSON.stringify(f) + "\n");
}

main(process.argv);
