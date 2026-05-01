/**
 * Merkle Tree Certificate (MTC) commands
 * chainlesschain mtc batch | verify | landmark inspect
 *
 * Phase 1 Week 3+4 — file-IO only; libp2p / IPFS distribution is future work.
 * Tree-head signature uses real Ed25519 (via @noble/curves) as a stop-gap;
 * SLH-DSA-128f remains the protocol target — module will be swapped when
 * @noble/post-quantum lands without touching CLI / cache.
 */

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { ed25519 as nobleEd25519 } from "@noble/curves/ed25519";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import { getAllIdentities, getIdentity } from "../lib/did-manager.js";
import { CLISkillLoader } from "../lib/skill-loader.js";
import mtcLib from "@chainlesschain/core-mtc";

const {
  encodeHashStr,
  sha256,
  jcs,
  LandmarkCache,
  verify,
  SCHEMA_LANDMARK,
  ed25519,
  slhDsa,
  assembleBatch,
} = mtcLib;

const STOPGAP_BANNER = chalk.yellow(
  "⚠ Tree-head signed with Ed25519 (classical default). Pass --alg slh-dsa-128f for FIPS 205 post-quantum signatures.",
);
const PQC_BANNER = chalk.green(
  "✓ Tree-head signed with SLH-DSA-SHA2-128F (FIPS 205 post-quantum).",
);

/**
 * Resolve --alg flag to a signer module + key sizes for read-back.
 * ed25519 (classical, 32-byte sk) is the default; slh-dsa-128f is opt-in.
 */
/**
 * Build a verifier that handles either Ed25519 or SLH-DSA tree-head signatures
 * based on the landmark's trust_anchors. Each per-algorithm verifier rejects
 * signatures of the wrong alg via `signatureObj.alg !== ALG`, so chaining
 * them is safe — at most one will accept.
 */
function makeMultiAlgVerifier(landmark) {
  const ed = ed25519.makeVerifierFromLandmark(landmark);
  const slh = slhDsa.makeVerifierFromLandmark(landmark);
  return (signingInput, signatureObj) =>
    ed(signingInput, signatureObj) || slh(signingInput, signatureObj);
}

function resolveSigner(algFlag) {
  const alg = (algFlag || "ed25519").toLowerCase();
  if (alg === "ed25519") {
    return {
      name: "ed25519",
      signer: ed25519,
      secretKeyLen: 32,
      banner: STOPGAP_BANNER,
    };
  }
  if (alg === "slh-dsa-128f" || alg === "slh-dsa-sha2-128f") {
    return {
      name: "slh-dsa-128f",
      signer: slhDsa,
      secretKeyLen: 64,
      banner: PQC_BANNER,
    };
  }
  throw new Error(
    `Unknown --alg: ${algFlag} (supported: ed25519, slh-dsa-128f)`,
  );
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${filePath}: ${err.message}`);
  }
}

function writeJsonFile(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf-8");
}

function loadOrGenerateKeyPair(secretKeyPath, signerInfo) {
  const sig = signerInfo || resolveSigner(null);
  if (secretKeyPath && fs.existsSync(secretKeyPath)) {
    const secretKey = Buffer.from(
      fs.readFileSync(secretKeyPath, "utf-8").trim(),
      "hex",
    );
    if (secretKey.length !== sig.secretKeyLen) {
      throw new Error(
        `Secret key file ${secretKeyPath} must contain ${sig.secretKeyLen} bytes for ${sig.name}`,
      );
    }
    let publicKey;
    if (sig.name === "ed25519") {
      publicKey = Buffer.from(nobleEd25519.getPublicKey(secretKey));
    } else {
      publicKey = sig.signer.getPublicKey(secretKey);
    }
    return {
      secretKey,
      publicKey,
      pubkeyId: sig.signer.pubkeyId(publicKey),
    };
  }
  return sig.signer.generateKeyPair();
}

function buildBatch(rawLeaves, opts) {
  const sig = resolveSigner(opts.alg);
  const keys = loadOrGenerateKeyPair(opts.secretKeyFile, sig);
  const { landmark, envelopes, treeHeadId } = assembleBatch(
    rawLeaves,
    keys,
    {
      namespace: opts.namespace,
      issuer: opts.issuer,
      issuedAt: opts.issuedAt,
      expiresAt: opts.expiresAt,
    },
    sig.signer,
  );
  return { landmark, envelopes, treeHeadId, keys, signerInfo: sig };
}

// ─────────────────────────────────────────────────────────────────────
// Marketplace publisher daemon (Phase 2 marketplace path)
// ─────────────────────────────────────────────────────────────────────

const PUBLISH_STATE_SCHEMA = "mtc-skill-publish-state/v1";

function canonicalSkillsFingerprint(skills) {
  // Sort by id for deterministic fingerprint, then JCS-canonicalize a tuple
  // of (id, version, content_hash). This matches what batch-skills hashes
  // into each leaf, so changing only metadata doesn't trigger churn but
  // bumping a skill's version or body does.
  const sorted = [...skills].sort((a, b) => a.id.localeCompare(b.id));
  const tuples = sorted.map((s) => ({
    id: s.id,
    version: s.version,
    category: s.category,
    activation: s.activation,
    description: s.description,
  }));
  return encodeHashStr(sha256(jcs(tuples)));
}

function loadPublishState(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      schema: PUBLISH_STATE_SCHEMA,
      last_seq: 0,
      last_fingerprint: null,
      last_published_at: null,
      history: [],
    };
  }
  const obj = readJsonFile(filePath);
  if (obj.schema !== PUBLISH_STATE_SCHEMA) {
    throw new Error(`state file ${filePath} has unknown schema: ${obj.schema}`);
  }
  return obj;
}

function savePublishState(filePath, state) {
  // Atomic write: tmp + rename. Avoids the next run reading a truncated state
  // file if the process crashes mid-write (which would silently reset last_seq
  // and start re-publishing batches at 000001).
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

/**
 * One iteration: load skills, compare fingerprint, optionally build a batch
 * and persist state. Returns a structured result regardless of whether a
 * batch was produced (for json output + tests).
 */
function publishSkillsOnce(options) {
  const loader = new CLISkillLoader();
  const allSkills = loader.loadAll();

  let skills;
  if (options.skill && options.skill.length > 0) {
    const want = new Set(options.skill);
    skills = allSkills.filter((s) => want.has(s.id));
  } else {
    skills = allSkills;
  }

  const state = loadPublishState(options.stateFile);
  if (skills.length === 0) {
    return {
      iteration: "skipped",
      reason: "no skills discovered",
      skills_count: 0,
      last_seq: state.last_seq,
    };
  }

  const fingerprint = canonicalSkillsFingerprint(skills);
  if (state.last_fingerprint === fingerprint) {
    return {
      iteration: "skipped",
      reason: "fingerprint unchanged",
      skills_count: skills.length,
      last_seq: state.last_seq,
      fingerprint,
    };
  }

  const nextSeq = state.last_seq + 1;
  const seqStr = String(nextSeq).padStart(6, "0");
  const namespace = `${options.namespacePrefix}/${seqStr}`;
  const batchDir = path.resolve(options.out, seqStr);

  const rawLeaves = skills.map((s) => ({
    kind: "skill-manifest",
    content_hash: encodeHashStr(
      sha256(
        jcs({
          id: s.id,
          displayName: s.displayName,
          description: s.description,
          version: s.version,
          category: s.category,
          activation: s.activation,
          tags: s.tags,
        }),
      ),
    ),
    issued_at: new Date().toISOString(),
    subject: `skill:cc:${s.id}@${s.version}`,
    metadata: {
      publisher: options.issuer,
      skill_id: s.id,
      version: s.version,
      category: s.category,
    },
  }));

  const { landmark, envelopes, treeHeadId, keys } = buildBatch(rawLeaves, {
    namespace,
    issuer: options.issuer,
    secretKeyFile: options.secretKeyFile,
    alg: options.alg,
  });

  fs.mkdirSync(batchDir, { recursive: true });
  const landmarkPath = path.join(batchDir, "landmark.json");
  writeJsonFile(landmarkPath, landmark);
  if (options.secretKeyFile && !fs.existsSync(options.secretKeyFile)) {
    fs.mkdirSync(path.dirname(options.secretKeyFile), { recursive: true });
    fs.writeFileSync(options.secretKeyFile, keys.secretKey.toString("hex"), {
      mode: 0o600,
    });
  }
  const envelopePaths = [];
  for (let i = 0; i < envelopes.length; i++) {
    const p = path.join(
      batchDir,
      `envelope-${String(i).padStart(6, "0")}.json`,
    );
    writeJsonFile(p, envelopes[i]);
    envelopePaths.push(p);
  }

  const publishedAt = new Date().toISOString();
  state.last_seq = nextSeq;
  state.last_fingerprint = fingerprint;
  state.last_published_at = publishedAt;
  state.history.push({
    seq: seqStr,
    namespace,
    tree_head_id: treeHeadId,
    root_hash: landmark.snapshots[0].tree_head.root_hash,
    tree_size: skills.length,
    fingerprint,
    published_at: publishedAt,
    batch_dir: batchDir,
  });
  savePublishState(options.stateFile, state);

  return {
    iteration: "published",
    seq: seqStr,
    namespace,
    tree_head_id: treeHeadId,
    tree_size: skills.length,
    batch_dir: batchDir,
    landmark_path: landmarkPath,
    envelope_paths: envelopePaths,
    fingerprint,
  };
}

async function publishSkillsLoop(options) {
  const tick = () => {
    try {
      const result = publishSkillsOnce(options);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.iteration === "published") {
        logger.success(
          `[seq ${result.seq}] published ${result.tree_size} skill(s) → ${result.batch_dir}`,
        );
        logger.log(`  ${chalk.bold("Tree head ID:")} ${result.tree_head_id}`);
      } else {
        logger.info(`skipped: ${result.reason}`);
      }
    } catch (err) {
      logger.error(`iteration failed: ${err.message}`);
      if (options.once) throw err;
    }
  };

  if (options.once) {
    tick();
    return;
  }

  tick();
  const ms = Math.max(1, options.interval) * 1000;
  const timer = setInterval(tick, ms);
  const cleanup = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  // Daemon: never resolve.
  await new Promise(() => {});
}

// Export internals for unit tests
export const _publishInternals = {
  publishSkillsOnce,
  loadPublishState,
  savePublishState,
  canonicalSkillsFingerprint,
  PUBLISH_STATE_SCHEMA,
};

export function registerMtcCommand(program) {
  const mtc = program
    .command("mtc")
    .description("Merkle Tree Certificates — batch issuance & verification");

  // mtc batch
  mtc
    .command("batch")
    .description("Build a tree + landmark + envelopes from a list of leaves")
    .argument("<input>", "JSON file containing an array of leaf objects")
    .requiredOption("--namespace <ns>", "Namespace, e.g. mtc/v1/did/000142")
    .requiredOption(
      "--issuer <issuer>",
      "MTCA issuer string, e.g. mtca:cc:zQ3sh...",
    )
    .option("--out <dir>", "Output directory (default: ./mtc-out)", "./mtc-out")
    .option("--issued-at <iso>", "Override issued_at timestamp")
    .option("--expires-at <iso>", "Override expires_at timestamp")
    .option(
      "--secret-key-file <path>",
      "Reuse secret key from hex file (creates one if missing); 32 B for ed25519, 64 B for slh-dsa-128f",
    )
    .option(
      "--alg <name>",
      "Signing algorithm: ed25519 (default, classical) | slh-dsa-128f (FIPS 205 post-quantum)",
      "ed25519",
    )
    .option("--json", "Print JSON summary instead of human output")
    .action(async (inputPath, options) => {
      try {
        const rawLeaves = readJsonFile(inputPath);
        if (!Array.isArray(rawLeaves) || rawLeaves.length === 0) {
          throw new Error("Input must be a non-empty JSON array of leaves");
        }

        const { landmark, envelopes, treeHeadId, keys, signerInfo } =
          buildBatch(rawLeaves, {
            namespace: options.namespace,
            issuer: options.issuer,
            issuedAt: options.issuedAt,
            expiresAt: options.expiresAt,
            secretKeyFile: options.secretKeyFile,
            alg: options.alg,
          });

        const outDir = path.resolve(options.out);
        const landmarkPath = path.join(outDir, "landmark.json");
        writeJsonFile(landmarkPath, landmark);

        // If a secret-key-file path was given but didn't exist, save the new key for reuse
        if (options.secretKeyFile && !fs.existsSync(options.secretKeyFile)) {
          fs.mkdirSync(path.dirname(options.secretKeyFile), {
            recursive: true,
          });
          fs.writeFileSync(
            options.secretKeyFile,
            keys.secretKey.toString("hex"),
            { mode: 0o600 },
          );
        }

        const envelopePaths = [];
        for (let i = 0; i < envelopes.length; i++) {
          const p = path.join(
            outDir,
            `envelope-${String(i).padStart(6, "0")}.json`,
          );
          writeJsonFile(p, envelopes[i]);
          envelopePaths.push(p);
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                tree_head_id: treeHeadId,
                tree_size: landmark.snapshots[0].tree_head.tree_size,
                root_hash: landmark.snapshots[0].tree_head.root_hash,
                landmark_path: landmarkPath,
                envelope_paths: envelopePaths,
              },
              null,
              2,
            ),
          );
        } else {
          logger.log(signerInfo ? signerInfo.banner : STOPGAP_BANNER);
          logger.success("Batch built");
          logger.log(`  ${chalk.bold("Namespace:")}    ${options.namespace}`);
          logger.log(`  ${chalk.bold("Tree size:")}    ${rawLeaves.length}`);
          logger.log(
            `  ${chalk.bold("Root hash:")}    ${landmark.snapshots[0].tree_head.root_hash}`,
          );
          logger.log(`  ${chalk.bold("Tree head ID:")} ${treeHeadId}`);
          logger.log(
            `  ${chalk.bold("Landmark:")}     ${chalk.cyan(landmarkPath)}`,
          );
          logger.log(
            `  ${chalk.bold("Envelopes:")}    ${envelopePaths.length} files in ${outDir}`,
          );
        }
      } catch (err) {
        logger.error(`mtc batch failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc verify
  mtc
    .command("verify")
    .description("Verify an MTC envelope against a landmark")
    .argument("<envelope>", "Path to envelope JSON file")
    .requiredOption("--landmark <path>", "Path to landmark JSON file")
    .option("--now <iso>", "Override current time for expiry check (ISO 8601)")
    .option("--json", "Output structured JSON")
    .action(async (envelopePath, options) => {
      try {
        const envelope = readJsonFile(envelopePath);
        const landmark = readJsonFile(options.landmark);

        const cache = new LandmarkCache({
          signatureVerifier: makeMultiAlgVerifier(landmark),
        });
        cache.ingest(landmark);

        const now = options.now ? Date.parse(options.now) : Date.now();
        const result = verify(envelope, cache, { now });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          if (!result.ok) process.exit(2);
          return;
        }
        if (result.ok) {
          logger.log(signerInfo ? signerInfo.banner : STOPGAP_BANNER);
          logger.success(`Envelope verified`);
          logger.log(
            `  ${chalk.bold("Subject:")}   ${result.leaf.subject || "(no subject)"}`,
          );
          logger.log(
            `  ${chalk.bold("Kind:")}      ${result.leaf.kind || "(unknown)"}`,
          );
          logger.log(
            `  ${chalk.bold("Tree size:")} ${result.treeHead.tree_size}`,
          );
          logger.log(`  ${chalk.bold("Issuer:")}    ${result.treeHead.issuer}`);
        } else {
          logger.error(`Verification failed: ${result.code}`);
          if (result.recoverable) {
            logger.log(
              chalk.yellow(
                "  This error is recoverable — try fetching a fresher landmark.",
              ),
            );
          }
          process.exit(2);
        }
      } catch (err) {
        logger.error(`mtc verify failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc landmark inspect
  const landmarkCmd = mtc.command("landmark").description("Landmark utilities");

  landmarkCmd
    .command("inspect")
    .description("Pretty-print a landmark file's structure")
    .argument("<landmark>", "Path to landmark JSON file")
    .option("--json", "Output structured JSON")
    .action(async (landmarkPath, options) => {
      try {
        const landmark = readJsonFile(landmarkPath);
        if (landmark.schema !== SCHEMA_LANDMARK) {
          throw new Error(`Not a landmark file (schema = ${landmark.schema})`);
        }

        const summary = {
          namespace_prefix: landmark.namespace,
          published_at: landmark.published_at,
          snapshot_count: (landmark.snapshots || []).length,
          trust_anchor_count: (landmark.trust_anchors || []).length,
          snapshots: (landmark.snapshots || []).map((s) => ({
            namespace: s.tree_head.namespace,
            tree_size: s.tree_head.tree_size,
            root_hash: s.tree_head.root_hash,
            tree_head_id: s.tree_head_id,
            issued_at: s.tree_head.issued_at,
            expires_at: s.tree_head.expires_at,
            issuer: s.tree_head.issuer,
            signature_alg: s.signature && s.signature.alg,
          })),
        };

        if (options.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          logger.log(`${chalk.bold("Landmark:")}        ${landmarkPath}`);
          logger.log(
            `${chalk.bold("Namespace prefix:")} ${summary.namespace_prefix}`,
          );
          logger.log(
            `${chalk.bold("Published at:")}     ${summary.published_at}`,
          );
          logger.log(
            `${chalk.bold("Snapshots:")}        ${summary.snapshot_count}`,
          );
          logger.log(
            `${chalk.bold("Trust anchors:")}    ${summary.trust_anchor_count}`,
          );
          for (const s of summary.snapshots) {
            logger.log("");
            logger.log(`  ${chalk.cyan(s.namespace)}`);
            logger.log(`    tree_size:  ${s.tree_size}`);
            logger.log(`    root_hash:  ${s.root_hash}`);
            logger.log(`    issuer:     ${s.issuer}`);
            logger.log(`    expires_at: ${s.expires_at}`);
            logger.log(`    sig_alg:    ${s.signature_alg}`);
          }
        }
      } catch (err) {
        logger.error(`mtc landmark inspect failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc batch-dids — read DIDs from local DB and produce a batch
  mtc
    .command("batch-dids")
    .description("Build a batch from DIDs in the local DB (all by default)")
    .requiredOption("--namespace <ns>", "Namespace, e.g. mtc/v1/did/000007")
    .requiredOption("--issuer <issuer>", "MTCA issuer string")
    .option(
      "--did <did>",
      "Include only this DID (repeatable)",
      (val, prev) => [...(prev || []), val],
    )
    .option("--out <dir>", "Output directory (default: ./mtc-out)", "./mtc-out")
    .option("--issued-at <iso>", "Override issued_at timestamp")
    .option("--expires-at <iso>", "Override expires_at timestamp")
    .option(
      "--secret-key-file <path>",
      "Reuse secret key from hex file (creates one if missing); 32 B for ed25519, 64 B for slh-dsa-128f",
    )
    .option(
      "--alg <name>",
      "Signing algorithm: ed25519 (default, classical) | slh-dsa-128f (FIPS 205 post-quantum)",
      "ed25519",
    )
    .option("--json", "Print JSON summary instead of human output")
    .action(async (options) => {
      let ctx;
      try {
        ctx = await bootstrap({});
        if (!ctx.db) throw new Error("Database not available");
        const db = ctx.db.getDatabase();

        let rows;
        if (options.did && options.did.length > 0) {
          rows = options.did
            .map((d) => getIdentity(db, d))
            .filter((r) => r != null);
          if (rows.length === 0)
            throw new Error("No matching DIDs found in local DB");
        } else {
          rows = getAllIdentities(db);
          if (rows.length === 0) {
            throw new Error(
              "No DIDs in local DB. Run `cc did create` first or pass --did <did>.",
            );
          }
        }

        const rawLeaves = rows.map((row) => {
          let didDoc;
          try {
            didDoc = JSON.parse(row.did_document);
          } catch (_err) {
            throw new Error(`DID ${row.did} has malformed did_document in DB`);
          }
          return {
            kind: "did-document",
            content_hash: encodeHashStr(sha256(jcs(didDoc))),
            issued_at: row.created_at || new Date().toISOString(),
            subject: row.did,
            metadata: { version: "1.0.0", supersedes: null },
          };
        });

        const { landmark, envelopes, treeHeadId, keys, signerInfo } =
          buildBatch(rawLeaves, {
            namespace: options.namespace,
            issuer: options.issuer,
            issuedAt: options.issuedAt,
            expiresAt: options.expiresAt,
            secretKeyFile: options.secretKeyFile,
            alg: options.alg,
          });

        const outDir = path.resolve(options.out);
        const landmarkPath = path.join(outDir, "landmark.json");
        writeJsonFile(landmarkPath, landmark);

        if (options.secretKeyFile && !fs.existsSync(options.secretKeyFile)) {
          fs.mkdirSync(path.dirname(options.secretKeyFile), {
            recursive: true,
          });
          fs.writeFileSync(
            options.secretKeyFile,
            keys.secretKey.toString("hex"),
            { mode: 0o600 },
          );
        }

        const envelopePaths = [];
        for (let i = 0; i < envelopes.length; i++) {
          const p = path.join(
            outDir,
            `envelope-${String(i).padStart(6, "0")}.json`,
          );
          writeJsonFile(p, envelopes[i]);
          envelopePaths.push(p);
        }

        const subjects = rawLeaves.map((l) => l.subject);

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                tree_head_id: treeHeadId,
                tree_size: rawLeaves.length,
                root_hash: landmark.snapshots[0].tree_head.root_hash,
                landmark_path: landmarkPath,
                envelope_paths: envelopePaths,
                subjects,
              },
              null,
              2,
            ),
          );
        } else {
          logger.log(signerInfo ? signerInfo.banner : STOPGAP_BANNER);
          logger.success(`Batched ${rawLeaves.length} DID(s)`);
          logger.log(`  ${chalk.bold("Namespace:")}    ${options.namespace}`);
          logger.log(`  ${chalk.bold("Tree size:")}    ${rawLeaves.length}`);
          logger.log(
            `  ${chalk.bold("Root hash:")}    ${landmark.snapshots[0].tree_head.root_hash}`,
          );
          logger.log(`  ${chalk.bold("Tree head ID:")} ${treeHeadId}`);
          logger.log(
            `  ${chalk.bold("Landmark:")}     ${chalk.cyan(landmarkPath)}`,
          );
          logger.log(
            `  ${chalk.bold("Envelopes:")}    ${envelopePaths.length} files in ${outDir}`,
          );
          logger.log(`  ${chalk.bold("Subjects:")}`);
          for (const s of subjects) logger.log(`    ${chalk.gray(s)}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`mtc batch-dids failed: ${err.message}`);
        if (ctx) await shutdown().catch(() => {});
        process.exit(1);
      }
    });

  // mtc batch-skills — read local skills and produce a batch
  mtc
    .command("batch-skills")
    .description("Build a batch from local CLI skills (all by default)")
    .requiredOption("--namespace <ns>", "Namespace, e.g. mtc/v1/skill/000001")
    .requiredOption("--issuer <issuer>", "MTCA issuer string")
    .option(
      "--skill <id>",
      "Include only this skill id (repeatable)",
      (v, prev) => [...(prev || []), v],
    )
    .option("--out <dir>", "Output directory (default: ./mtc-out)", "./mtc-out")
    .option("--issued-at <iso>", "Override issued_at timestamp")
    .option("--expires-at <iso>", "Override expires_at timestamp")
    .option(
      "--secret-key-file <path>",
      "Reuse secret key from hex file (creates one if missing); 32 B for ed25519, 64 B for slh-dsa-128f",
    )
    .option(
      "--alg <name>",
      "Signing algorithm: ed25519 (default, classical) | slh-dsa-128f (FIPS 205 post-quantum)",
      "ed25519",
    )
    .option("--json", "Print JSON summary instead of human output")
    .action(async (options) => {
      try {
        const loader = new CLISkillLoader();
        const allSkills = loader.loadAll();
        if (allSkills.length === 0) {
          throw new Error(
            "No skills found in any layer. Set up skill packs first.",
          );
        }

        let skills;
        if (options.skill && options.skill.length > 0) {
          const want = new Set(options.skill);
          skills = allSkills.filter((s) => want.has(s.id));
          if (skills.length === 0) {
            throw new Error("No skills matched --skill filters");
          }
        } else {
          skills = allSkills;
        }

        const rawLeaves = skills.map((s) => {
          // Hash a canonical view of the skill (id+version+category+description+body fingerprint)
          const canonicalSkill = {
            id: s.id,
            displayName: s.displayName,
            description: s.description,
            version: s.version,
            category: s.category,
            activation: s.activation,
            tags: s.tags,
          };
          return {
            kind: "skill-manifest",
            content_hash: encodeHashStr(sha256(jcs(canonicalSkill))),
            issued_at: new Date().toISOString(),
            subject: `skill:cc:${s.id}@${s.version}`,
            metadata: {
              publisher: options.issuer,
              skill_id: s.id,
              version: s.version,
              category: s.category,
            },
          };
        });

        const { landmark, envelopes, treeHeadId, keys, signerInfo } =
          buildBatch(rawLeaves, {
            namespace: options.namespace,
            issuer: options.issuer,
            issuedAt: options.issuedAt,
            expiresAt: options.expiresAt,
            secretKeyFile: options.secretKeyFile,
            alg: options.alg,
          });

        const outDir = path.resolve(options.out);
        const landmarkPath = path.join(outDir, "landmark.json");
        writeJsonFile(landmarkPath, landmark);

        if (options.secretKeyFile && !fs.existsSync(options.secretKeyFile)) {
          fs.mkdirSync(path.dirname(options.secretKeyFile), {
            recursive: true,
          });
          fs.writeFileSync(
            options.secretKeyFile,
            keys.secretKey.toString("hex"),
            { mode: 0o600 },
          );
        }

        const envelopePaths = [];
        for (let i = 0; i < envelopes.length; i++) {
          const p = path.join(
            outDir,
            `envelope-${String(i).padStart(6, "0")}.json`,
          );
          writeJsonFile(p, envelopes[i]);
          envelopePaths.push(p);
        }

        const subjects = rawLeaves.map((l) => l.subject);

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                tree_head_id: treeHeadId,
                tree_size: rawLeaves.length,
                root_hash: landmark.snapshots[0].tree_head.root_hash,
                landmark_path: landmarkPath,
                envelope_paths: envelopePaths,
                subjects,
              },
              null,
              2,
            ),
          );
        } else {
          logger.log(signerInfo ? signerInfo.banner : STOPGAP_BANNER);
          logger.success(`Batched ${rawLeaves.length} skill(s)`);
          logger.log(`  ${chalk.bold("Namespace:")}    ${options.namespace}`);
          logger.log(`  ${chalk.bold("Tree size:")}    ${rawLeaves.length}`);
          logger.log(
            `  ${chalk.bold("Root hash:")}    ${landmark.snapshots[0].tree_head.root_hash}`,
          );
          logger.log(`  ${chalk.bold("Tree head ID:")} ${treeHeadId}`);
          logger.log(
            `  ${chalk.bold("Landmark:")}     ${chalk.cyan(landmarkPath)}`,
          );
          logger.log(
            `  ${chalk.bold("Envelopes:")}    ${envelopePaths.length} files in ${outDir}`,
          );
          logger.log(`  ${chalk.bold("Subjects:")}`);
          for (const s of subjects) logger.log(`    ${chalk.gray(s)}`);
        }
      } catch (err) {
        logger.error(`mtc batch-skills failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc publish-skills — marketplace publisher daemon
  // Periodically scans CLISkillLoader, detects deltas via a fingerprint, and
  // when the skill set changes auto-closes a new batch (assembleBatch) into
  // <out>/<seq>/. Stateful via a JSON state file so re-runs skip unchanged sets.
  //
  // Phase 2 marketplace path — does NOT depend on the audit Q-COMP blockers.
  mtc
    .command("publish-skills")
    .description(
      "Marketplace publisher daemon: detect skill deltas + auto-close batches",
    )
    .requiredOption(
      "--namespace-prefix <prefix>",
      "Namespace prefix; seq is auto-appended (e.g. mtc/v1/skill)",
    )
    .requiredOption("--issuer <issuer>", "MTCA issuer string")
    .requiredOption(
      "--out <dir>",
      "Output root directory (each batch lands in <out>/<seq>/)",
    )
    .requiredOption(
      "--state-file <path>",
      "State JSON file tracking last_seq + fingerprint",
    )
    .option(
      "--secret-key-file <path>",
      "Reuse secret key from hex file (creates one if missing); 32 B for ed25519, 64 B for slh-dsa-128f",
    )
    .option(
      "--alg <name>",
      "Signing algorithm: ed25519 (default, classical) | slh-dsa-128f (FIPS 205 post-quantum)",
      "ed25519",
    )
    .option(
      "--interval <seconds>",
      "Loop interval (default: 600 = 10min, ignored if --once)",
      (v) => parseInt(v, 10),
      600,
    )
    .option("--once", "Run a single iteration and exit (test/CI use)")
    .option(
      "--skill <id>",
      "Restrict to specific skill ids (repeatable)",
      (v, prev) => [...(prev || []), v],
    )
    .option("--json", "Print JSON summary on each iteration")
    .action(async (options) => {
      try {
        await publishSkillsLoop(options);
      } catch (err) {
        logger.error(`mtc publish-skills failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc publish-status — read-only inspector for publish-skills state file.
  // Used by web-panel (browser can't read the filesystem directly; this gives
  // it a CLI-bridge-friendly query path without exposing the daemon machinery).
  mtc
    .command("publish-status <state-file>")
    .description(
      "Read a publish-skills state file and print its current state + recent history",
    )
    .option(
      "--limit <n>",
      "Limit history entries (default: 20, latest first)",
      (v) => parseInt(v, 10),
      20,
    )
    .option("--json", "Output JSON (default: human)")
    .action((stateFile, options) => {
      try {
        if (!fs.existsSync(stateFile)) {
          if (options.json) {
            console.log(
              JSON.stringify(
                { ok: true, exists: false, state_file: stateFile },
                null,
                2,
              ),
            );
          } else {
            logger.warn(`state file not found: ${stateFile}`);
          }
          return;
        }
        const state = loadPublishState(stateFile);
        const history = Array.isArray(state.history) ? state.history : [];
        const limited = history.slice().reverse().slice(0, options.limit);
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                exists: true,
                state_file: stateFile,
                last_seq: state.last_seq,
                last_fingerprint: state.last_fingerprint,
                last_published_at: state.last_published_at,
                history_count: history.length,
                history: limited,
              },
              null,
              2,
            ),
          );
          return;
        }
        logger.log(chalk.bold(`Publish state: ${stateFile}`));
        logger.log(`  ${chalk.bold("Last seq:")}         ${state.last_seq}`);
        logger.log(
          `  ${chalk.bold("Last published:")}   ${state.last_published_at || "(never)"}`,
        );
        logger.log(`  ${chalk.bold("History entries:")}  ${history.length}`);
        if (limited.length > 0) {
          logger.log("");
          logger.log(chalk.bold(`Recent history (latest ${limited.length}):`));
          for (const h of limited) {
            logger.log(
              `  ${chalk.cyan(h.seq)}  ${h.namespace}  size=${h.tree_size}  ${chalk.gray(h.published_at)}`,
            );
          }
        }
      } catch (err) {
        if (options.json) {
          console.log(
            JSON.stringify(
              { ok: false, error: err.message, state_file: stateFile },
              null,
              2,
            ),
          );
        } else {
          logger.error(`mtc publish-status failed: ${err.message}`);
        }
        process.exit(1);
      }
    });

  // mtc serve — verifier daemon: subscribe to a transport, persist + verify
  mtc
    .command("serve")
    .description(
      "Run a verifier daemon: subscribe to landmarks, persist to disk, ingest",
    )
    .option(
      "--transport <kind>",
      "libp2p | filesystem (default: libp2p)",
      "libp2p",
    )
    .option(
      "--listen <multiaddr>",
      "[libp2p] listen address (default /ip4/127.0.0.1/tcp/0)",
    )
    .option(
      "--connect <multiaddr>",
      "[libp2p] dial this peer on startup (repeatable)",
      (v, prev) => [...(prev || []), v],
    )
    .option(
      "--mode <kind>",
      "[libp2p] direct | gossipsub (default: direct)",
      "direct",
    )
    .option("--drop-zone <dir>", "[filesystem] shared directory to watch")
    .option(
      "--prefix <ns>",
      "namespace prefix to subscribe to (repeatable, default: mtc/v1/did)",
      (v, prev) => [...(prev || []), v],
    )
    .option(
      "--cache-dir <dir>",
      "LandmarkCache persistDir for ingested snapshots",
    )
    .option(
      "--exit-after <n>",
      "exit after receiving N landmarks (test/CI use)",
      (v) => parseInt(v, 10),
    )
    .action(async (options) => {
      let transport;
      try {
        const prefixes =
          options.prefix && options.prefix.length > 0
            ? options.prefix
            : ["mtc/v1/did"];

        // Build transport
        const kind = options.transport;
        if (kind === "libp2p") {
          const { Libp2pTransport } =
            await import("@chainlesschain/core-mtc/transports/libp2p");
          transport = await Libp2pTransport.create({
            listen: options.listen,
            mode: options.mode,
          });
          for (const peer of options.connect || []) {
            await transport
              .connect(peer)
              .catch((err) =>
                logger.warn(`connect to ${peer} failed: ${err.message}`),
              );
          }
          logger.success(
            `libp2p node listening on:\n  ${transport.multiaddrs().join("\n  ")}`,
          );
        } else if (kind === "filesystem") {
          if (!options.dropZone) {
            throw new Error(
              "--drop-zone is required when --transport=filesystem",
            );
          }
          const { FilesystemTransport } =
            await import("@chainlesschain/core-mtc/transports/filesystem");
          transport = new FilesystemTransport({ dropZone: options.dropZone });
          logger.success(`filesystem transport watching ${options.dropZone}`);
        } else {
          throw new Error(`Unknown --transport: ${kind}`);
        }

        // Build cache (no signature verifier yet — fed when first landmark arrives)
        let cache = null;
        let received = 0;

        for (const prefix of prefixes) {
          transport.subscribe(prefix, async (ann) => {
            try {
              const landmark = await transport.fetch(ann.cid);

              // Lazy-init cache from first landmark's trust_anchors
              if (!cache) {
                cache = new LandmarkCache({
                  signatureVerifier: makeMultiAlgVerifier(landmark),
                  persistDir: options.cacheDir,
                });
                if (options.cacheDir) {
                  const r = cache.loadFromDisk();
                  logger.log(
                    `cache: loaded ${r.loaded} prior snapshots, ${r.failed.length} failed`,
                  );
                }
              }

              cache.ingest(landmark);
              received++;
              logger.success(
                `[${received}] ${ann.namespace} tree_size=${ann.tree_size} cid=${ann.cid}`,
              );

              if (options.exitAfter && received >= options.exitAfter) {
                logger.log(
                  `reached --exit-after ${options.exitAfter}, shutting down`,
                );
                if (transport.close) await transport.close();
                process.exit(0);
              }
            } catch (err) {
              logger.error(`ingest failed: ${err.message}`);
            }
          });
          logger.log(`subscribed: ${prefix}`);
        }

        // Keep running. Ctrl+C cleanup.
        const cleanup = async () => {
          logger.log("shutting down…");
          if (transport && transport.close) await transport.close();
          process.exit(0);
        };
        process.once("SIGINT", cleanup);
        process.once("SIGTERM", cleanup);

        // Daemon: never resolve unless --exit-after triggers
        await new Promise(() => {});
      } catch (err) {
        logger.error(`mtc serve failed: ${err.message}`);
        if (transport && transport.close)
          await transport.close().catch(() => {});
        process.exit(1);
      }
    });
}
