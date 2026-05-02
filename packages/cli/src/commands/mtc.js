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
import { getHomeDir } from "../lib/paths.js";
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
  // Phase 3.2: federation path takes precedence when --federation is set.
  if (opts.federation) {
    return buildFederatedBatch(rawLeaves, opts);
  }

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

/**
 * Federation-mode batch: loads all members of the named federation from
 * the local registry, signs the tree_head with each member's key, and
 * assembles an M-of-N landmark via assembleBatchFederated.
 *
 * @param {Array<object>} rawLeaves
 * @param {{
 *   federation: string,           // federation id from `cc mtc federation join <id>`
 *   threshold?: number,            // M (default = N = all members)
 *   namespace: string,
 *   issuer: string,                // federation-level issuer (overrides individual member issuers in tree_head only)
 *   issuedAt?: string,
 *   expiresAt?: string,
 * }} opts
 */
function buildFederatedBatch(rawLeaves, opts) {
  const registry = loadFederationRegistry();
  const fed = registry.federations[opts.federation];
  if (!fed) {
    throw new Error(
      `unknown federation "${opts.federation}" — run \`cc mtc federation join ${opts.federation} --member-id <m>\` first`,
    );
  }
  const members = Object.values(fed.members || {});
  if (members.length === 0) {
    throw new Error(`federation "${opts.federation}" has no members`);
  }

  const threshold = Number.isInteger(opts.threshold)
    ? opts.threshold
    : members.length;

  // Load each member's signing key from disk
  const signers = members.map((m) => {
    if (!m.key_file || !fs.existsSync(m.key_file)) {
      throw new Error(
        `member "${m.member_id}" key file missing: ${m.key_file}`,
      );
    }
    // Match alg from registry, not from --alg flag (each member is fixed)
    let sigInfo;
    if (m.alg === "Ed25519") {
      sigInfo = resolveSigner("ed25519");
    } else if (m.alg === "SLH-DSA-SHA2-128F") {
      sigInfo = resolveSigner("slh-dsa-128f");
    } else {
      throw new Error(`member "${m.member_id}" has unknown alg: ${m.alg}`);
    }
    const keys = loadOrGenerateKeyPair(m.key_file, sigInfo);
    return {
      secretKey: keys.secretKey,
      publicKey: keys.publicKey,
      signer: sigInfo.signer,
      issuer: m.issuer,
    };
  });

  const fedSignerInfo = {
    name: "federation",
    threshold,
    members: members.length,
    member_ids: members.map((m) => m.member_id),
    banner: chalk.cyan(
      `✓ Federated tree-head — ${threshold}-of-${members.length} multi-signature (federation: ${opts.federation})`,
    ),
  };

  const { landmark, envelopes, treeHeadId } = mtcLib.assembleBatchFederated(
    rawLeaves,
    signers,
    {
      namespace: opts.namespace,
      issuer: opts.issuer,
      threshold,
      issuedAt: opts.issuedAt,
      expiresAt: opts.expiresAt,
    },
  );

  return {
    landmark,
    envelopes,
    treeHeadId,
    keys: signers[0], // first member's key (publish-skills tries to persist; harmless to surface)
    signerInfo: fedSignerInfo,
  };
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
    .option(
      "--federation <id>",
      "Use federation M-of-N multi-sig (overrides --alg / --secret-key-file; signers come from `cc mtc federation join` registry)",
    )
    .option(
      "--threshold <n>",
      "Federation threshold M (default: N = all members)",
      (v) => parseInt(v, 10),
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
            federation: options.federation,
            threshold: options.threshold,
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
    .option(
      "--federation <id>",
      "Use federation M-of-N multi-sig (overrides --alg / --secret-key-file; signers come from `cc mtc federation join` registry)",
    )
    .option(
      "--threshold <n>",
      "Federation threshold M (default: N = all members)",
      (v) => parseInt(v, 10),
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
            federation: options.federation,
            threshold: options.threshold,
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
    .option(
      "--federation <id>",
      "Use federation M-of-N multi-sig (overrides --alg / --secret-key-file; signers come from `cc mtc federation join` registry)",
    )
    .option(
      "--threshold <n>",
      "Federation threshold M (default: N = all members)",
      (v) => parseInt(v, 10),
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
            federation: options.federation,
            threshold: options.threshold,
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
      "--federation <id>",
      "Use federation M-of-N multi-sig (overrides --alg / --secret-key-file; signers come from `cc mtc federation join` registry)",
    )
    .option(
      "--threshold <n>",
      "Federation threshold M (default: N = all members)",
      (v) => parseInt(v, 10),
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

  // ─────────────────────────────────────────────────────────────────────
  // Phase 3 federation MTCA commands
  // M-of-N multi-sig is implemented in core-mtc/lib/batch.js;
  // federation member tracking lives in ~/.chainlesschain/federation/
  // members.json (one entry per joined federation, keyed by federation id).
  // ─────────────────────────────────────────────────────────────────────
  registerFederationCommands(mtc);
}

// ─────────────────────────────────────────────────────────────────────────
// Federation member registry helpers (Phase 3.1)
// ─────────────────────────────────────────────────────────────────────────

const FEDERATION_REGISTRY_SCHEMA = "mtc-federation-registry/v1";

function getFederationDir() {
  const home = getHomeDir();
  return path.join(home, "federation");
}

function getFederationRegistryPath() {
  return path.join(getFederationDir(), "members.json");
}

function loadFederationRegistry() {
  const file = getFederationRegistryPath();
  if (!fs.existsSync(file)) {
    return { schema: FEDERATION_REGISTRY_SCHEMA, federations: {} };
  }
  const obj = readJsonFile(file);
  if (obj.schema !== FEDERATION_REGISTRY_SCHEMA) {
    throw new Error(
      `federation registry has unknown schema: ${obj.schema} (expected ${FEDERATION_REGISTRY_SCHEMA})`,
    );
  }
  if (!obj.federations || typeof obj.federations !== "object") {
    obj.federations = {};
  }
  return obj;
}

function saveFederationRegistry(registry) {
  const file = getFederationRegistryPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Atomic write to survive crash mid-write
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

function registerFederationCommands(mtc) {
  const fed = mtc
    .command("federation")
    .description("Phase 3 federation MTCA — manage M-of-N member registry");

  // mtc federation join <federation-id>
  fed
    .command("join <federation-id>")
    .description(
      "Join a federation: generate a member keypair (or reuse existing) and register it locally",
    )
    .requiredOption(
      "--member-id <id>",
      "Local member identifier within the federation",
    )
    .option(
      "--alg <name>",
      "Signing algorithm: ed25519 (default) | slh-dsa-128f",
      "ed25519",
    )
    .option(
      "--issuer <issuer>",
      "Member-level issuer string (default: mtca:cc:<federation-id>:<member-id>)",
    )
    .option("--key-file <path>", "Reuse existing secret key from hex file")
    .option("--json", "Print JSON summary")
    .action((federationId, options) => {
      try {
        const sig = resolveSigner(options.alg);
        const issuer =
          options.issuer || `mtca:cc:${federationId}:${options.memberId}`;
        const registry = loadFederationRegistry();
        const fedEntry = registry.federations[federationId] || {
          federation_id: federationId,
          members: {},
          joined_at: new Date().toISOString(),
        };
        if (fedEntry.members[options.memberId]) {
          throw new Error(
            `member "${options.memberId}" already registered in federation "${federationId}" — leave first to rejoin`,
          );
        }

        // Generate or load the keypair
        let keys;
        if (options.keyFile && fs.existsSync(options.keyFile)) {
          keys = loadOrGenerateKeyPair(options.keyFile, sig);
        } else {
          keys = sig.signer.generateKeyPair();
        }

        // Persist the member's secret key under federation/keys/.
        // Race-safe: 'wx' fails if another concurrent join already won, in
        // which case we stick with that file rather than overwrite. Member
        // re-join is blocked at the registry level above, so this only
        // guards against simultaneous-join racing the same path.
        const keysDir = path.join(getFederationDir(), "keys");
        fs.mkdirSync(keysDir, { recursive: true });
        const keyPath = path.join(
          keysDir,
          `${federationId}.${options.memberId}.hex`,
        );
        try {
          fs.writeFileSync(keyPath, keys.secretKey.toString("hex"), {
            mode: 0o600,
            flag: "wx",
          });
        } catch (err) {
          if (err.code !== "EEXIST") throw err;
          // Concurrent join wrote the file first — re-load from disk and
          // align our keys so registry + key file match.
          keys = loadOrGenerateKeyPair(keyPath, sig);
        }

        const trustAnchor = sig.signer.trustAnchorEntry(keys.publicKey, issuer);
        fedEntry.members[options.memberId] = {
          member_id: options.memberId,
          issuer,
          alg: sig.signer.ALG,
          pubkey_id: trustAnchor.pubkey_id,
          pubkey_jwk: trustAnchor.pubkey_jwk,
          key_file: keyPath,
          joined_at: new Date().toISOString(),
        };
        registry.federations[federationId] = fedEntry;
        saveFederationRegistry(registry);

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                federation_id: federationId,
                member_id: options.memberId,
                issuer,
                alg: sig.signer.ALG,
                pubkey_id: trustAnchor.pubkey_id,
                key_file: keyPath,
              },
              null,
              2,
            ),
          );
        } else {
          logger.success(
            `joined federation "${federationId}" as "${options.memberId}"`,
          );
          logger.log(`  ${chalk.bold("Issuer:")}     ${issuer}`);
          logger.log(`  ${chalk.bold("Algorithm:")}  ${sig.signer.ALG}`);
          logger.log(`  ${chalk.bold("Pubkey id:")}  ${trustAnchor.pubkey_id}`);
          logger.log(`  ${chalk.bold("Key file:")}   ${chalk.cyan(keyPath)}`);
        }
      } catch (err) {
        logger.error(`mtc federation join failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc federation leave <federation-id> --member-id <id>
  fed
    .command("leave <federation-id>")
    .description(
      "Leave a federation: remove the member entry from the local registry",
    )
    .requiredOption("--member-id <id>", "Member id to remove")
    .option(
      "--keep-key",
      "Keep the secret key file on disk (default: removes the key file as well)",
    )
    .option("--json", "Print JSON summary")
    .action((federationId, options) => {
      try {
        const registry = loadFederationRegistry();
        const fedEntry = registry.federations[federationId];
        if (!fedEntry || !fedEntry.members[options.memberId]) {
          throw new Error(
            `member "${options.memberId}" not found in federation "${federationId}"`,
          );
        }
        const member = fedEntry.members[options.memberId];
        delete fedEntry.members[options.memberId];
        if (Object.keys(fedEntry.members).length === 0) {
          delete registry.federations[federationId];
        }
        saveFederationRegistry(registry);

        if (
          !options.keepKey &&
          member.key_file &&
          fs.existsSync(member.key_file)
        ) {
          try {
            fs.unlinkSync(member.key_file);
          } catch (_err) {
            /* non-fatal */
          }
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                federation_id: federationId,
                member_id: options.memberId,
                key_file_removed: !options.keepKey,
              },
              null,
              2,
            ),
          );
        } else {
          logger.success(
            `left federation "${federationId}" — member "${options.memberId}" removed${
              options.keepKey ? "" : " (key file deleted)"
            }`,
          );
        }
      } catch (err) {
        logger.error(`mtc federation leave failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc federation status [federation-id]
  fed
    .command("status [federation-id]")
    .description("Show registered federations and their members")
    .option("--json", "Output JSON")
    .action((federationId, options) => {
      try {
        const registry = loadFederationRegistry();
        const data = federationId
          ? { [federationId]: registry.federations[federationId] || null }
          : registry.federations;

        if (options.json) {
          console.log(JSON.stringify({ ok: true, federations: data }, null, 2));
          return;
        }

        const ids = Object.keys(data).filter((k) => data[k]);
        if (ids.length === 0) {
          logger.info(
            "no federations registered (run `cc mtc federation join <id> --member-id <m>`)",
          );
          return;
        }

        for (const id of ids) {
          const f = data[id];
          const memberCount = Object.keys(f.members || {}).length;
          logger.log(chalk.bold(`Federation: ${chalk.cyan(id)}`));
          logger.log(`  ${chalk.bold("Joined at:")} ${f.joined_at || "—"}`);
          logger.log(`  ${chalk.bold("Members:")}   ${memberCount}`);
          for (const m of Object.values(f.members || {})) {
            logger.log(
              `    · ${chalk.green(m.member_id)} (${m.alg})  ${chalk.gray(m.pubkey_id.slice(0, 18) + "…")}`,
            );
            logger.log(`        issuer: ${m.issuer}`);
            logger.log(`        key:    ${chalk.gray(m.key_file)}`);
          }
        }
      } catch (err) {
        logger.error(`mtc federation status failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────────────
  // Phase 3.3 — federation discovery via filesystem drop-zone.
  // Each member periodically writes a self-signed announce to a shared
  // directory (NFS / SMB / Syncthing / USB stick). Other nodes scan the
  // dir + ingest valid announces into a TTL-evicting roster cache.
  //
  // Production note: real libp2p gossipsub-based discovery (auto-announce
  // on a pubsub topic) is the natural next layer — the announce schema +
  // verify + cache are transport-agnostic, so wiring gossipsub is purely
  // a delivery question. Filesystem mode covers LAN / shared-fs / offline
  // use cases without any p2p network code.
  // ─────────────────────────────────────────────────────────────────────
  fed
    .command("discover <federation-id>")
    .description(
      "Subscribe to federation announces via filesystem drop-zone or libp2p gossipsub",
    )
    .option(
      "--transport <kind>",
      "Transport: filesystem (default, --drop-zone required) | libp2p (--listen + --connect)",
      "filesystem",
    )
    .option(
      "--drop-zone <dir>",
      "[filesystem] Shared directory all federation members read+write to (NFS / Syncthing / SMB)",
    )
    .option(
      "--listen <multiaddr>",
      "[libp2p] Listen address (default: /ip4/127.0.0.1/tcp/0)",
    )
    .option(
      "--connect <multiaddr>",
      "[libp2p] Dial this peer on startup (repeatable)",
      (v, prev) => [...(prev || []), v],
    )
    .option(
      "--member-id <id>",
      "If joined as this member, also publish a self-announce (omit = listen-only mode)",
    )
    .option(
      "--ttl <seconds>",
      "Announce TTL (default 600 = 10 min); a re-announce fires at TTL/3",
      (v) => parseInt(v, 10),
      600,
    )
    .option("--once", "Announce once + scan once + exit (test/CI use)")
    .option(
      "--cache-dir <dir>",
      "Persist accepted announces to this dir for restart resume",
    )
    .option(
      "--scan-interval <seconds>",
      "[filesystem] Drop-zone poll interval (default 30)",
      (v) => parseInt(v, 10),
      30,
    )
    .option(
      "--mesh-wait-ms <n>",
      "[libp2p] Mesh formation wait before announce (default 1500)",
      (v) => parseInt(v, 10),
      1500,
    )
    .option("--json", "Print JSON status snapshot (used with --once)")
    .action(async (federationId, options) => {
      try {
        await runFederationDiscover(federationId, options);
      } catch (err) {
        logger.error(`mtc federation discover failed: ${err.message}`);
        process.exit(1);
      }
    });

  registerFederationGovernanceCommands(fed);
}

// ─────────────────────────────────────────────────────────────────────────
// Federation governance log (MTC_联邦治理_v1.md §9.1) — 8 subcommands
// ─────────────────────────────────────────────────────────────────────────

function getGovernanceLogPath(federationId) {
  return path.join(getFederationDir(), "governance", `${federationId}.jsonl`);
}

function loadGovernanceLog(federationId) {
  const file = getGovernanceLogPath(federationId);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf-8");
  const events = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch (_err) {
      /* skip corrupt line — replay-from-source-of-truth, don't crash */
    }
  }
  return events;
}

function appendGovernanceEvent(federationId, event) {
  const file = getGovernanceLogPath(federationId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(event) + "\n", "utf-8");
}

/**
 * Look up a member's keys + alg for signing a governance event as that
 * member. Throws if not joined.
 */
function loadMemberSigner(federationId, memberId) {
  const registry = loadFederationRegistry();
  const fedEntry = registry.federations[federationId];
  if (!fedEntry || !fedEntry.members[memberId]) {
    throw new Error(
      `not joined as "${memberId}" in federation "${federationId}" — \`cc mtc federation join ${federationId} --member-id ${memberId}\` first`,
    );
  }
  const member = fedEntry.members[memberId];
  if (!member.key_file || !fs.existsSync(member.key_file)) {
    throw new Error(`member key file missing: ${member.key_file}`);
  }
  let signerInfo;
  if (member.alg === "Ed25519") signerInfo = resolveSigner("ed25519");
  else if (member.alg === "SLH-DSA-SHA2-128F")
    signerInfo = resolveSigner("slh-dsa-128f");
  else throw new Error(`unknown member alg: ${member.alg}`);
  const keys = loadOrGenerateKeyPair(member.key_file, signerInfo);
  return { member, keys, alg: member.alg };
}

function emitAndPersist(federationId, params) {
  const event = mtcLib.createGovernanceEvent({
    federationId,
    ...params,
  });
  appendGovernanceEvent(federationId, event);
  return event;
}

/**
 * Pre-flight check that a confirm-* event has its matching propose-*.
 * Reads the local governance log + checks for an unresolved proposal.
 * Throws on missing — caller decides whether to log a warning or hard-fail.
 *
 * @param {string} federationId
 * @param {string} proposalType — "propose-revoke" | "propose-threshold"
 * @param {(payload: object) => boolean} matcher — returns true when payload matches
 */
function requireOpenProposal(federationId, proposalType, matcher) {
  const events = loadGovernanceLog(federationId);
  // Walk forward; an open proposal is one not yet matched by a confirm of
  // the same target. v0.1 quorum gating only checks "is there at least one
  // proposal event with a matching target" — full quorum cooldown logic
  // lives in lib replay, this is a CLI-side guardrail.
  // Matcher signature: (payload, event) => boolean
  const open = events.some(
    (e) =>
      e && e.event_type === proposalType && e.payload && matcher(e.payload, e),
  );
  if (!open) {
    throw new Error(
      `no open ${proposalType} proposal matches — emit ${proposalType} first`,
    );
  }
}

/**
 * Internal helper used by both the `governance-publish` CLI handler and
 * the `governance-sync-serve` daemon. Pure side-effect free aside from
 * filesystem writes to <drop-zone>/federation-governance/<fed>/.
 *
 * @returns {{ federation_id, drop_zone, local_total, published, skipped }}
 */
function runGovernancePublish(federationId, dropZone) {
  const events = loadGovernanceLog(federationId);
  const targetDir = path.join(dropZone, "federation-governance", federationId);
  fs.mkdirSync(targetDir, { recursive: true });
  let published = 0;
  let skipped = 0;
  for (const ev of events) {
    if (!ev || typeof ev.event_id !== "string") continue;
    const target = path.join(targetDir, `${ev.event_id}.json`);
    if (fs.existsSync(target)) {
      skipped++;
      continue;
    }
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(ev, null, 2), "utf-8");
    fs.renameSync(tmp, target);
    published++;
  }
  return {
    federation_id: federationId,
    drop_zone: targetDir,
    local_total: events.length,
    published,
    skipped,
  };
}

/**
 * Internal helper for governance-pull + governance-sync-serve.
 * Reads remote events from drop-zone, optionally signature-verifies them,
 * dedupes by event_id against local log, sorts chronologically, and appends
 * new events to the local jsonl.
 *
 * @returns {{
 *   federation_id, drop_zone, remote_total, local_total_before,
 *   appended, duplicates, invalid_signature, unknown_signer
 * }}
 */
function statsPath(federationId) {
  return path.join(
    getFederationDir(),
    "governance",
    `${federationId}.sync-stats.json`,
  );
}

function loadStats(federationId) {
  const file = statsPath(federationId);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (_err) {
    return {};
  }
}

function saveStats(federationId, stats) {
  const file = statsPath(federationId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Atomic write so polling readers never see partial JSON
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stats, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

function runGovernancePull(federationId, dropZone, opts = {}) {
  const sourceDir = path.join(dropZone, "federation-governance", federationId);
  if (!fs.existsSync(sourceDir)) {
    // Daemon-friendly: empty drop-zone is "nothing to pull yet", not an error.
    return {
      federation_id: federationId,
      drop_zone: sourceDir,
      remote_total: 0,
      local_total_before: loadGovernanceLog(federationId).length,
      appended: 0,
      duplicates: 0,
      invalid_signature: 0,
      unknown_signer: 0,
    };
  }

  const remote = [];
  for (const name of fs.readdirSync(sourceDir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const ev = JSON.parse(
        fs.readFileSync(path.join(sourceDir, name), "utf-8"),
      );
      if (ev && typeof ev.event_id === "string") remote.push(ev);
    } catch (_err) {
      /* skip malformed */
    }
  }

  let invalid = 0;
  let unknown = 0;
  let candidates = remote;
  if (opts.verify) {
    const registry = loadFederationRegistry();
    const fedEntry = registry.federations[federationId] || { members: {} };
    const lookup = (actor /* , keyId */) => {
      const m = fedEntry.members[actor];
      if (!m || !m.pubkey_jwk) return null;
      try {
        return Buffer.from(m.pubkey_jwk.x, "base64url");
      } catch (_err) {
        return null;
      }
    };
    const result = mtcLib.verifyGovernanceLog(remote, lookup);
    invalid = result.invalid.length;
    unknown = result.unknown.length;
    candidates = result.valid;
  }

  const localEvents = loadGovernanceLog(federationId);
  const localIds = new Set(
    localEvents.filter((e) => e && e.event_id).map((e) => e.event_id),
  );
  const newEvents = candidates.filter((e) => !localIds.has(e.event_id));
  const sorted = mtcLib.sortGovernanceEventsChronologically(newEvents);
  for (const ev of sorted) appendGovernanceEvent(federationId, ev);

  return {
    federation_id: federationId,
    drop_zone: sourceDir,
    remote_total: remote.length,
    local_total_before: localEvents.length,
    appended: sorted.length,
    duplicates: candidates.length - newEvents.length,
    invalid_signature: invalid,
    unknown_signer: unknown,
  };
}

function registerFederationGovernanceCommands(fed) {
  // mtc federation invite — propose adding a candidate member
  fed
    .command("invite <federation-id> <candidate-member-id>")
    .description("Propose adding a candidate member (governance.log event)")
    .requiredOption("--actor <member-id>", "Existing member casting the invite")
    .requiredOption("--candidate-pubkey-id <id>", "Candidate's pubkey_id")
    .option("--candidate-alg <alg>", "ed25519 | slh-dsa-128f", "ed25519")
    .option("--json", "JSON output")
    .action((federationId, candidateMemberId, options) => {
      try {
        const { keys, alg } = loadMemberSigner(federationId, options.actor);
        const event = emitAndPersist(federationId, {
          eventType: "invite",
          actorMemberId: options.actor,
          secretKey: keys.secretKey,
          publicKey: keys.publicKey,
          alg,
          payload: {
            candidate_member_id: candidateMemberId,
            candidate_pubkey_id: options.candidatePubkeyId,
            candidate_alg: options.candidateAlg,
          },
        });
        if (options.json) return console.log(JSON.stringify(event, null, 2));
        logger.success(
          `Invited ${candidateMemberId} into ${federationId} (event ${event.event_id})`,
        );
      } catch (err) {
        logger.error(`mtc federation invite failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc federation vote — vote on an outstanding invite
  fed
    .command("vote <federation-id> <candidate-member-id>")
    .description("Vote on an outstanding invite")
    .requiredOption("--actor <member-id>", "Voting member")
    .requiredOption("--decision <approve|reject>", "Vote decision")
    .option("--json", "JSON output")
    .action((federationId, candidateMemberId, options) => {
      try {
        if (!["approve", "reject"].includes(options.decision)) {
          throw new Error("--decision must be approve or reject");
        }
        const { keys, alg } = loadMemberSigner(federationId, options.actor);
        const event = emitAndPersist(federationId, {
          eventType: "vote",
          actorMemberId: options.actor,
          secretKey: keys.secretKey,
          publicKey: keys.publicKey,
          alg,
          payload: {
            invite_target_member_id: candidateMemberId,
            decision: options.decision,
          },
        });
        if (options.json) return console.log(JSON.stringify(event, null, 2));
        logger.success(
          `${options.actor} voted ${options.decision} on ${candidateMemberId} (event ${event.event_id})`,
        );
      } catch (err) {
        logger.error(`mtc federation vote failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc federation propose-revoke
  fed
    .command("propose-revoke <federation-id> <target-member-id>")
    .description("Propose revoking a member (7-day grace period)")
    .requiredOption("--actor <member-id>", "Proposing member")
    .requiredOption("--reason <text>", "Reason (e.g. inactive, key-compromise)")
    .option("--json", "JSON output")
    .action((federationId, targetMemberId, options) => {
      try {
        const { keys, alg } = loadMemberSigner(federationId, options.actor);
        const event = emitAndPersist(federationId, {
          eventType: "propose-revoke",
          actorMemberId: options.actor,
          secretKey: keys.secretKey,
          publicKey: keys.publicKey,
          alg,
          payload: { target_member_id: targetMemberId, reason: options.reason },
        });
        if (options.json) return console.log(JSON.stringify(event, null, 2));
        logger.success(
          `Proposed revoke of ${targetMemberId} (reason: ${options.reason}, event ${event.event_id})`,
        );
      } catch (err) {
        logger.error(`mtc federation propose-revoke failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc federation confirm-revoke
  fed
    .command("confirm-revoke <federation-id> <target-member-id>")
    .description("Confirm a previously-proposed revoke (after grace period)")
    .requiredOption("--actor <member-id>", "Confirming member")
    .option(
      "--reason <text>",
      "Confirmation reason (key-compromise → mark key compromised)",
    )
    .option(
      "--no-quorum-check",
      "Skip the pre-flight check that a matching propose-revoke exists (caller assumes responsibility)",
    )
    .option("--json", "JSON output")
    .action((federationId, targetMemberId, options) => {
      try {
        if (options.quorumCheck !== false) {
          requireOpenProposal(
            federationId,
            "propose-revoke",
            (p) => p.target_member_id === targetMemberId,
          );
        }
        const { keys, alg } = loadMemberSigner(federationId, options.actor);
        const event = emitAndPersist(federationId, {
          eventType: "confirm-revoke",
          actorMemberId: options.actor,
          secretKey: keys.secretKey,
          publicKey: keys.publicKey,
          alg,
          payload: { target_member_id: targetMemberId, reason: options.reason },
        });
        if (options.json) return console.log(JSON.stringify(event, null, 2));
        logger.success(
          `Confirmed revoke of ${targetMemberId} (event ${event.event_id})`,
        );
      } catch (err) {
        logger.error(`mtc federation confirm-revoke failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc federation rotate-key
  fed
    .command("rotate-key <federation-id>")
    .description("Rotate the actor's signing key to a new pubkey")
    .requiredOption("--actor <member-id>", "Member rotating their key")
    .requiredOption("--new-pubkey-id <id>", "New public-key id")
    .option("--new-alg <alg>", "ed25519 | slh-dsa-128f")
    .option("--json", "JSON output")
    .action((federationId, options) => {
      try {
        const { keys, alg } = loadMemberSigner(federationId, options.actor);
        const event = emitAndPersist(federationId, {
          eventType: "rotate-key",
          actorMemberId: options.actor,
          secretKey: keys.secretKey,
          publicKey: keys.publicKey,
          alg,
          payload: {
            new_pubkey_id: options.newPubkeyId,
            new_alg: options.newAlg,
          },
        });
        if (options.json) return console.log(JSON.stringify(event, null, 2));
        logger.success(
          `${options.actor} rotated key to ${options.newPubkeyId} (event ${event.event_id})`,
        );
      } catch (err) {
        logger.error(`mtc federation rotate-key failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc federation propose-threshold
  fed
    .command("propose-threshold <federation-id> <new-threshold>")
    .description("Propose a new M-of-N threshold (30-day cooldown)")
    .requiredOption("--actor <member-id>", "Proposing member")
    .option("--json", "JSON output")
    .action((federationId, newThreshold, options) => {
      try {
        const target = parseInt(newThreshold, 10);
        if (!Number.isInteger(target) || target < 1) {
          throw new Error("new-threshold must be a positive integer");
        }
        const { keys, alg } = loadMemberSigner(federationId, options.actor);
        const event = emitAndPersist(federationId, {
          eventType: "propose-threshold",
          actorMemberId: options.actor,
          secretKey: keys.secretKey,
          publicKey: keys.publicKey,
          alg,
          payload: { proposed_threshold: target },
        });
        if (options.json) return console.log(JSON.stringify(event, null, 2));
        logger.success(
          `Proposed threshold ${target} (event ${event.event_id}, 30-day cooldown)`,
        );
      } catch (err) {
        logger.error(`mtc federation propose-threshold failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc federation confirm-threshold — apply a specific (or most recent) propose-threshold
  fed
    .command("confirm-threshold <federation-id>")
    .description(
      "Confirm a propose-threshold (default: most recent; --proposal-event-id picks a specific one)",
    )
    .requiredOption("--actor <member-id>", "Confirming member")
    .option(
      "--proposal-event-id <id>",
      "Specific propose-threshold event_id (CRDT-style explicit selection when multiple proposals are open)",
    )
    .option(
      "--no-quorum-check",
      "Skip the pre-flight check that an open propose-threshold exists",
    )
    .option("--json", "JSON output")
    .action((federationId, options) => {
      try {
        if (options.quorumCheck !== false) {
          requireOpenProposal(federationId, "propose-threshold", (p, ev) => {
            if (!Number.isInteger(p.proposed_threshold)) return false;
            if (
              options.proposalEventId &&
              ev &&
              ev.event_id !== options.proposalEventId
            ) {
              return false;
            }
            return true;
          });
        }
        const { keys, alg } = loadMemberSigner(federationId, options.actor);
        const payload = options.proposalEventId
          ? { proposal_event_id: options.proposalEventId }
          : {};
        const event = emitAndPersist(federationId, {
          eventType: "confirm-threshold",
          actorMemberId: options.actor,
          secretKey: keys.secretKey,
          publicKey: keys.publicKey,
          alg,
          payload,
        });
        if (options.json) return console.log(JSON.stringify(event, null, 2));
        logger.success(
          `Confirmed${options.proposalEventId ? " specific" : ""} threshold proposal (event ${event.event_id})`,
        );
      } catch (err) {
        logger.error(`mtc federation confirm-threshold failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc federation fork
  fed
    .command("fork <federation-id> <new-federation-id>")
    .description(
      "Spawn a new federation with a subset of current members (members leave the original)",
    )
    .requiredOption("--actor <member-id>", "Forking member")
    .requiredOption(
      "--members <ids>",
      "Comma-separated list of member-ids leaving for the new federation",
    )
    .option("--json", "JSON output")
    .action((federationId, newFedId, options) => {
      try {
        const memberIds = options.members
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const { keys, alg } = loadMemberSigner(federationId, options.actor);
        const event = emitAndPersist(federationId, {
          eventType: "fork",
          actorMemberId: options.actor,
          secretKey: keys.secretKey,
          publicKey: keys.publicKey,
          alg,
          payload: {
            new_federation_id: newFedId,
            member_ids: memberIds,
          },
        });
        if (options.json) return console.log(JSON.stringify(event, null, 2));
        logger.success(
          `Forked ${federationId} → ${newFedId} (members: ${memberIds.join(", ")}; event ${event.event_id})`,
        );
      } catch (err) {
        logger.error(`mtc federation fork failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc federation merge
  fed
    .command("merge <federation-id> <other-federation-id> <new-federation-id>")
    .description(
      "Mark this federation as winding down into a new merged federation",
    )
    .requiredOption("--actor <member-id>", "Merging member")
    .option("--json", "JSON output")
    .action((federationId, otherFedId, newFedId, options) => {
      try {
        const { keys, alg } = loadMemberSigner(federationId, options.actor);
        const event = emitAndPersist(federationId, {
          eventType: "merge",
          actorMemberId: options.actor,
          secretKey: keys.secretKey,
          publicKey: keys.publicKey,
          alg,
          payload: {
            other_federation_id: otherFedId,
            new_federation_id: newFedId,
          },
        });
        if (options.json) return console.log(JSON.stringify(event, null, 2));
        logger.success(
          `Merged ${federationId} + ${otherFedId} → ${newFedId} (event ${event.event_id})`,
        );
      } catch (err) {
        logger.error(`mtc federation merge failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc federation governance-sync-libp2p — pubsub gossipsub variant
  fed
    .command("governance-sync-libp2p <federation-id>")
    .description(
      "Sync governance events over libp2p gossipsub (topic mtc-federation-governance/v1/<fed>)",
    )
    .option("--listen <maddr>", "libp2p listen multiaddr", "/ip4/0.0.0.0/tcp/0")
    .option(
      "--connect <maddr>",
      "Seed peer multiaddr (repeatable)",
      (v, prev) => (prev ? [...prev, v] : [v]),
      [],
    )
    .option(
      "--interval <seconds>",
      "Publish-new-events interval (default: 10)",
      (v) => parseInt(v, 10),
      10,
    )
    .option("--verify", "Verify signatures before appending received events")
    .option(
      "--once",
      "Subscribe + publish-once + wait <interval> seconds, then exit (test/cron)",
    )
    .option("--json", "Per-tick JSON output")
    .action(async (federationId, options) => {
      try {
        await runGovernanceSyncLibp2p(federationId, options);
      } catch (err) {
        logger.error(
          `mtc federation governance-sync-libp2p failed: ${err.message}`,
        );
        process.exit(1);
      }
    });

  // mtc federation governance-sync-stats — read live tick stats written by sync daemons
  fed
    .command("governance-sync-stats <federation-id>")
    .description(
      "Read live sync stats (last tick + cumulative counters) written by governance-sync-serve / governance-sync-libp2p",
    )
    .option("--json", "JSON output")
    .action((federationId, options) => {
      try {
        const file = path.join(
          getFederationDir(),
          "governance",
          `${federationId}.sync-stats.json`,
        );
        if (!fs.existsSync(file)) {
          const empty = {
            federation_id: federationId,
            stats_file: file,
            available: false,
            note: "No sync daemon has written stats yet — start governance-sync-serve or governance-sync-libp2p first.",
          };
          if (options.json) return console.log(JSON.stringify(empty, null, 2));
          logger.warn(empty.note);
          return;
        }
        const data = JSON.parse(fs.readFileSync(file, "utf-8"));
        if (options.json) return console.log(JSON.stringify(data, null, 2));
        logger.log(`Federation: ${federationId}`);
        logger.log(`Last tick:  ${data.last_tick_at || "—"}`);
        logger.log(`Mode:       ${data.mode || "—"}`);
        if (data.publish) {
          logger.log(
            `Publish:    last=${data.publish.last_published || 0} new (${data.publish.last_skipped || 0} skipped); total=${data.publish.total_published || 0}`,
          );
        }
        if (data.pull) {
          logger.log(
            `Pull:       last=${data.pull.last_appended || 0} new (dedup=${data.pull.last_duplicates || 0}); total=${data.pull.total_appended || 0}`,
          );
        }
        if (data.libp2p) {
          logger.log(
            `Libp2p:     wire received=${data.libp2p.wire_received || 0} appended=${data.libp2p.wire_appended || 0} invalid=${data.libp2p.wire_invalid || 0} unknown=${data.libp2p.wire_unknown || 0}`,
          );
        }
      } catch (err) {
        logger.error(
          `mtc federation governance-sync-stats failed: ${err.message}`,
        );
        process.exit(1);
      }
    });

  // mtc federation cross-trust-create — emit a cross-federation trust anchor record (v0.3)
  fed
    .command("cross-trust-create <host-fed> <trusted-fed>")
    .description(
      "Build a cross-federation trust anchor record (host accepts landmarks from trusted)",
    )
    .requiredOption(
      "--threshold <m>",
      "Trusted federation's threshold at snapshot time",
      (v) => parseInt(v, 10),
    )
    .requiredOption(
      "--member <id:pubkey>",
      "Trusted member entry, id:pubkey_id (repeatable)",
      (v, prev) => (prev ? [...prev, v] : [v]),
      [],
    )
    .option(
      "--accepted-kinds <kinds>",
      "Comma-separated landmark kinds to accept (default: did,skill,bridge,audit)",
    )
    .option("--expires-at <iso>", "ISO 8601 expiry (default: 90 days)")
    .option(
      "--out <path>",
      "Write the anchor JSON to a file (otherwise stdout)",
    )
    .option("--json", "JSON output (default unless --out given)")
    .action((hostFed, trustedFed, options) => {
      try {
        const roster = (options.member || []).map((entry) => {
          const [member_id, pubkey_id] = entry.split(":", 2);
          if (!member_id || !pubkey_id) {
            throw new Error(
              `bad --member entry "${entry}", expected id:pubkey_id`,
            );
          }
          return { member_id, pubkey_id, alg: "ed25519" };
        });
        const anchor = mtcLib.createCrossFederationTrustAnchor({
          host_federation_id: hostFed,
          trusted_federation_id: trustedFed,
          member_roster_snapshot: roster,
          threshold: options.threshold,
          accepted_kinds: options.acceptedKinds
            ? options.acceptedKinds.split(",").map((s) => s.trim())
            : undefined,
          expires_at: options.expiresAt,
        });
        const json = JSON.stringify(anchor, null, 2);
        if (options.out) {
          fs.mkdirSync(path.dirname(options.out), { recursive: true });
          fs.writeFileSync(options.out, json, "utf-8");
          if (options.json) console.log(json);
          else
            logger.success(
              `Cross-fed trust anchor written: ${options.out} (expires ${anchor.expires_at})`,
            );
        } else {
          console.log(json);
        }
      } catch (err) {
        logger.error(
          `mtc federation cross-trust-create failed: ${err.message}`,
        );
        process.exit(1);
      }
    });

  // mtc federation cross-trust-validate — validate an anchor's structure + freshness
  fed
    .command("cross-trust-validate <anchor-path>")
    .description("Validate a cross-federation trust anchor JSON file")
    .option("--json", "JSON output")
    .action((anchorPath, options) => {
      try {
        const anchor = JSON.parse(fs.readFileSync(anchorPath, "utf-8"));
        const result = mtcLib.validateCrossFederationTrustAnchor(anchor);
        if (options.json) {
          console.log(
            JSON.stringify({ ...result, anchor_path: anchorPath }, null, 2),
          );
          if (!result.ok) process.exit(2);
          return;
        }
        if (result.ok) {
          logger.success(
            `✓ Anchor valid: ${anchor.host_federation_id} → ${anchor.trusted_federation_id} (expires ${anchor.expires_at})`,
          );
        } else {
          logger.error(`✗ Anchor invalid: ${result.code}`);
          process.exit(2);
        }
      } catch (err) {
        logger.error(
          `mtc federation cross-trust-validate failed: ${err.message}`,
        );
        process.exit(1);
      }
    });

  // mtc federation audit — independent third-party auditor of governance.log (v0.3)
  fed
    .command("audit <federation-id>")
    .description(
      "Offline audit: replay governance.log + verify each event signature against the rolling roster",
    )
    .option("--json", "JSON output (full report incl. final_state)")
    .option("--summary", "Show only the finding counts + ok/fail")
    .action((federationId, options) => {
      try {
        const events = loadGovernanceLog(federationId);
        const report = mtcLib.auditGovernanceLog(events, federationId);
        if (options.json) return console.log(JSON.stringify(report, null, 2));
        const errorCount = report.findings.filter(
          (f) => f.severity === "error",
        ).length;
        const warnCount = report.findings.filter(
          (f) => f.severity === "warn",
        ).length;
        if (options.summary) {
          logger.log(
            `${report.ok ? "✓" : "✗"} ${federationId}: ${report.events_count} events, ${errorCount} errors, ${warnCount} warnings`,
          );
          if (!report.ok) process.exit(2);
          return;
        }
        logger.log(`Federation: ${federationId}`);
        logger.log(`Events:     ${report.events_count}`);
        logger.log(
          `Audit:      ${report.ok ? "✓ PASS" : "✗ FAIL"} (errors=${errorCount}, warnings=${warnCount})`,
        );
        if (report.findings.length > 0) {
          logger.log(`\nFindings:`);
          for (const f of report.findings) {
            const sev = f.severity === "error" ? "ERROR" : "WARN ";
            logger.log(`  [${sev}] ${f.code}: ${f.message}`);
            logger.log(`           event_id=${f.event_id}`);
          }
        }
        if (!report.ok) process.exit(2);
      } catch (err) {
        logger.error(`mtc federation audit failed: ${err.message}`);
        process.exit(1);
      }
    });

  // v0.3 #2 — On-chain governance anchor (Q-COMP-3 unlocked 2026-05-03)
  // The CLI ships filesystem-backed mock chain client; production wires
  // a real ConsortiumChainClient via --chain-impl <module> (future).

  fed
    .command("governance-anchor <federation-id>")
    .description(
      "Compute snapshot hash of governance.log + publish to a chain-anchor store (Q-COMP-3 v0.3 #2)",
    )
    .requiredOption("--actor <member-id>", "Anchoring member")
    .requiredOption(
      "--chain-store <dir>",
      "Filesystem dir simulating the chain anchor store (production: --chain-impl swap-in)",
    )
    .option("--chain-name <name>", "Chain name label", "consortium-mock")
    .option("--json", "JSON output")
    .action(async (federationId, options) => {
      try {
        const events = loadGovernanceLog(federationId);
        const record = mtcLib.buildGovernanceAnchorRecord(
          events,
          federationId,
          options.actor,
        );
        const client = new mtcLib.FilesystemChainAnchorClient({
          rootDir: options.chainStore,
          chainName: options.chainName,
        });
        const receipt = await client.publish(record);
        const out = {
          federation_id: federationId,
          anchored: true,
          snapshot_hash: record.snapshot_hash,
          events_count: record.events_count,
          last_event_id: record.last_event_id,
          tx_hash: receipt.tx_hash,
          block_height: receipt.block_height,
          chain_name: options.chainName,
          anchored_at: receipt.anchored_at,
        };
        if (options.json) return console.log(JSON.stringify(out, null, 2));
        logger.success(
          `Anchored ${federationId} snapshot (${record.events_count} events, hash=${record.snapshot_hash}) → tx=${receipt.tx_hash} @ block=${receipt.block_height}`,
        );
      } catch (err) {
        logger.error(`mtc federation governance-anchor failed: ${err.message}`);
        process.exit(1);
      }
    });

  fed
    .command("governance-verify-anchor <federation-id>")
    .description(
      "Fetch latest chain anchor + compare against local governance.log snapshot hash",
    )
    .requiredOption(
      "--chain-store <dir>",
      "Filesystem dir simulating the chain anchor store",
    )
    .option("--json", "JSON output")
    .action(async (federationId, options) => {
      try {
        const client = new mtcLib.FilesystemChainAnchorClient({
          rootDir: options.chainStore,
        });
        const latest = await client.fetchLatest(federationId);
        if (!latest) {
          const out = {
            federation_id: federationId,
            ok: false,
            code: "NO_ANCHOR_ON_CHAIN",
            message:
              "No anchor record found for this federation in the chain store",
          };
          if (options.json) {
            console.log(JSON.stringify(out, null, 2));
            process.exit(2);
            return;
          }
          logger.error(out.message);
          process.exit(2);
        }
        const events = loadGovernanceLog(federationId);
        const result = mtcLib.verifyGovernanceAnchor(latest, events);
        const out = {
          federation_id: federationId,
          ...result,
          anchor_block_height: latest.block_height,
          anchor_tx_hash: latest.tx_hash,
          anchor_anchored_at: latest.anchored_at,
        };
        if (options.json) {
          console.log(JSON.stringify(out, null, 2));
          if (!result.ok) process.exit(2);
          return;
        }
        if (result.ok) {
          logger.success(
            `✓ Anchor matches: ${result.expected_hash} (block=${latest.block_height}, anchored=${latest.anchored_at})`,
          );
        } else {
          logger.error(
            `✗ Anchor mismatch: ${result.code}\n  expected: ${result.expected_hash}\n  actual:   ${result.actual_hash}`,
          );
          if (result.drift) {
            logger.log(
              `  drift: events_count_diff=${result.drift.events_count_diff}`,
            );
          }
          process.exit(2);
        }
      } catch (err) {
        logger.error(
          `mtc federation governance-verify-anchor failed: ${err.message}`,
        );
        process.exit(1);
      }
    });

  // mtc federation governance-sync-serve — daemon: periodically publish + pull
  fed
    .command("governance-sync-serve <federation-id>")
    .description(
      "Daemon: periodically publish local governance events + pull remote ones from a shared drop-zone",
    )
    .requiredOption("--drop-zone <dir>", "Shared filesystem directory")
    .option(
      "--interval <seconds>",
      "Sync interval (default: 60)",
      (v) => parseInt(v, 10),
      60,
    )
    .option(
      "--verify",
      "Verify signatures against local registry on pull (default: trust schema only)",
    )
    .option("--once", "Sync once and exit (no daemon loop)")
    .option("--json", "Emit per-tick JSON results to stdout")
    .action(async (federationId, options) => {
      const tick = () => {
        const stamp = new Date().toISOString();
        try {
          const pubResult = runGovernancePublish(
            federationId,
            options.dropZone,
          );
          const pullResult = runGovernancePull(federationId, options.dropZone, {
            verify: !!options.verify,
          });
          // Persist live stats so governance-sync-stats / web GUI can poll
          const stats = loadStats(federationId);
          stats.federation_id = federationId;
          stats.mode = "filesystem";
          stats.last_tick_at = stamp;
          stats.publish = stats.publish || { total_published: 0 };
          stats.publish.last_published = pubResult.published;
          stats.publish.last_skipped = pubResult.skipped;
          stats.publish.total_published =
            (stats.publish.total_published || 0) + pubResult.published;
          stats.pull = stats.pull || { total_appended: 0 };
          stats.pull.last_appended = pullResult.appended;
          stats.pull.last_duplicates = pullResult.duplicates;
          stats.pull.last_invalid = pullResult.invalid_signature;
          stats.pull.last_unknown = pullResult.unknown_signer;
          stats.pull.total_appended =
            (stats.pull.total_appended || 0) + pullResult.appended;
          saveStats(federationId, stats);

          if (options.json) {
            console.log(
              JSON.stringify(
                {
                  tick_at: stamp,
                  publish: pubResult,
                  pull: pullResult,
                },
                null,
                2,
              ),
            );
          } else {
            console.log(
              `[${stamp}] publish: ${pubResult.published} new (${pubResult.skipped} skipped) | pull: ${pullResult.appended} new (dedup ${pullResult.duplicates}, invalid ${pullResult.invalid_signature}, unknown ${pullResult.unknown_signer})`,
            );
          }
        } catch (err) {
          console.error(`[${stamp}] tick error: ${err.message}`);
        }
      };

      tick();
      if (options.once) return;

      console.log(
        `governance-sync-serve: federation=${federationId} interval=${options.interval}s drop-zone=${options.dropZone}. Ctrl-C to stop.`,
      );
      const handle = setInterval(tick, options.interval * 1000);
      const stop = () => {
        clearInterval(handle);
        console.log("governance-sync-serve: stopped.");
        process.exit(0);
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      await new Promise(() => {});
    });

  // mtc federation governance-publish — push local events to a shared drop-zone
  fed
    .command("governance-publish <federation-id>")
    .description(
      "Publish local governance events to a shared drop-zone (filesystem path / NFS / Syncthing)",
    )
    .requiredOption("--drop-zone <dir>", "Shared filesystem directory")
    .option("--json", "JSON output")
    .action((federationId, options) => {
      try {
        const result = runGovernancePublish(federationId, options.dropZone);
        if (options.json) return console.log(JSON.stringify(result, null, 2));
        logger.success(
          `Published ${result.published} new event(s) (${result.skipped} already in drop-zone) to ${result.drop_zone}`,
        );
      } catch (err) {
        logger.error(
          `mtc federation governance-publish failed: ${err.message}`,
        );
        process.exit(1);
      }
    });

  // mtc federation governance-pull — pull events from a shared drop-zone, dedupe + verify, append locally
  fed
    .command("governance-pull <federation-id>")
    .description(
      "Pull governance events from a shared drop-zone, dedupe by event_id, append new ones to the local log (with optional signature verify)",
    )
    .requiredOption("--drop-zone <dir>", "Shared filesystem directory")
    .option(
      "--verify",
      "Verify signatures against local registry before appending (default: trust schema only)",
    )
    .option("--json", "JSON output")
    .action((federationId, options) => {
      try {
        // CLI surface keeps the strict "must exist" contract; the daemon
        // helper treats absent drop-zone as "nothing yet" and returns zeros.
        const sourceDir = path.join(
          options.dropZone,
          "federation-governance",
          federationId,
        );
        if (!fs.existsSync(sourceDir)) {
          throw new Error(
            `drop-zone has no events for ${federationId}: ${sourceDir}`,
          );
        }
        const result = runGovernancePull(federationId, options.dropZone, {
          verify: !!options.verify,
        });
        if (options.json) return console.log(JSON.stringify(result, null, 2));
        logger.success(
          `Pulled ${result.appended} new event(s) (dedup: ${result.duplicates}, invalid: ${result.invalid_signature}, unknown: ${result.unknown_signer})`,
        );
      } catch (err) {
        logger.error(`mtc federation governance-pull failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc federation governance-log — show all events + replayed state
  fed
    .command("governance-log <federation-id>")
    .description("Show governance.log events + current replayed state")
    .option("--json", "JSON output")
    .option("--events-only", "Only print events, skip replay state")
    .action((federationId, options) => {
      try {
        const events = loadGovernanceLog(federationId);
        if (options.eventsOnly) {
          if (options.json) return console.log(JSON.stringify(events, null, 2));
          for (const e of events) {
            logger.log(
              `${e.issued_at}  ${e.event_type.padEnd(20)} actor=${e.actor_member_id}  event_id=${e.event_id}`,
            );
          }
          return;
        }
        const state = mtcLib.replayGovernanceLog(events, federationId);
        if (options.json) {
          return console.log(JSON.stringify({ events, state }, null, 2));
        }
        logger.log(
          `Federation: ${state.federation_id}  status=${state.status}  threshold=${state.threshold}`,
        );
        logger.log(`Members (${state.members.length}):`);
        for (const m of state.members) {
          logger.log(
            `  ${m.member_id.padEnd(20)} weight=${m.weight} status=${m.status} alg=${m.alg}`,
          );
        }
        if (state.pending_invites.length) {
          logger.log(`Pending invites (${state.pending_invites.length}):`);
          for (const i of state.pending_invites) {
            logger.log(
              `  ${i.member_id}  approve=${i.votes.approve.length}/${i.required}  reject=${i.votes.reject.length}`,
            );
          }
        }
        if (state.pending_threshold) {
          logger.log(
            `Pending threshold: ${state.pending_threshold.target} (activates ${state.pending_threshold.activates_at})`,
          );
        }
        if (state.archived_keys.length || state.compromised_keys.length) {
          logger.log(
            `Archived keys: ${state.archived_keys.length}, compromised: ${state.compromised_keys.length}`,
          );
        }
      } catch (err) {
        logger.error(`mtc federation governance-log failed: ${err.message}`);
        process.exit(1);
      }
    });
}

// ─────────────────────────────────────────────────────────────────────────
// Federation discover daemon (Phase 3.3)
// ─────────────────────────────────────────────────────────────────────────

function getDiscoverAnnouncesDir(dropZone, federationId) {
  return path.join(dropZone, "federation-announces", federationId);
}

function getDiscoverFilename(announce) {
  // pubkey_id is "sha256:base64url" — replace : for cross-platform safety
  const safe = announce.pubkey_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safe}.json`;
}

function publishAnnounce(dropZone, announce) {
  const dir = getDiscoverAnnouncesDir(dropZone, announce.federation_id);
  fs.mkdirSync(dir, { recursive: true });
  const filename = getDiscoverFilename(announce);
  const target = path.join(dir, filename);
  // Atomic write: tmp + rename
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(announce, null, 2), "utf-8");
  fs.renameSync(tmp, target);
  return target;
}

function scanDropZone(dropZone, federationId) {
  const dir = getDiscoverAnnouncesDir(dropZone, federationId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => {
      const file = path.join(dir, n);
      try {
        return { file, announce: JSON.parse(fs.readFileSync(file, "utf-8")) };
      } catch (err) {
        return { file, error: err.message };
      }
    });
}

/**
 * Helper: load member key + return {announceBuilder, member} for self-announce.
 * Used by both filesystem and libp2p paths.
 */
function loadFederationMemberForAnnounce(federationId, memberId, ttlSeconds) {
  const registry = loadFederationRegistry();
  const fedEntry = registry.federations[federationId];
  if (!fedEntry || !fedEntry.members[memberId]) {
    throw new Error(
      `not joined as "${memberId}" in federation "${federationId}" — run \`cc mtc federation join ${federationId} --member-id ${memberId}\` first`,
    );
  }
  const member = fedEntry.members[memberId];
  if (!member.key_file || !fs.existsSync(member.key_file)) {
    throw new Error(`member key file missing: ${member.key_file}`);
  }
  let signerInfo;
  if (member.alg === "Ed25519") signerInfo = resolveSigner("ed25519");
  else if (member.alg === "SLH-DSA-SHA2-128F")
    signerInfo = resolveSigner("slh-dsa-128f");
  else throw new Error(`unknown member alg: ${member.alg}`);
  const keys = loadOrGenerateKeyPair(member.key_file, signerInfo);

  return {
    member,
    buildAnnounce: () =>
      mtcLib.createMemberAnnounce({
        federationId,
        memberId,
        issuer: member.issuer,
        secretKey: keys.secretKey,
        publicKey: keys.publicKey,
        signer: signerInfo.signer,
        ttlSeconds,
      }),
  };
}

async function runFederationDiscover(federationId, options) {
  const transport = (options.transport || "filesystem").toLowerCase();
  if (transport === "libp2p") {
    return runFederationDiscoverLibp2p(federationId, options);
  }
  if (transport !== "filesystem") {
    throw new Error(
      `Unknown --transport: ${options.transport} (supported: filesystem, libp2p)`,
    );
  }
  if (!options.dropZone) {
    throw new Error("--drop-zone is required when --transport=filesystem");
  }
  return runFederationDiscoverFilesystem(federationId, options);
}

async function runFederationDiscoverFilesystem(federationId, options) {
  const FederationAnnounceCache = mtcLib.FederationAnnounceCache;

  const cache = new FederationAnnounceCache({
    persistDir: options.cacheDir,
  });

  // Build self-announce iff --member-id provided
  let selfAnnounceFn = null;
  if (options.memberId) {
    const { buildAnnounce } = loadFederationMemberForAnnounce(
      federationId,
      options.memberId,
      options.ttl,
    );

    selfAnnounceFn = () => {
      const ann = buildAnnounce();
      const written = publishAnnounce(options.dropZone, ann);
      return { announce: ann, file: written };
    };
  }

  function scanAndIngest() {
    const entries = scanDropZone(options.dropZone, federationId);
    let accepted = 0;
    let rejected = 0;
    const failures = [];
    for (const e of entries) {
      if (e.error) {
        rejected++;
        failures.push({ file: e.file, code: "PARSE_ERROR" });
        continue;
      }
      const r = cache.ingest(e.announce);
      if (r.accepted) accepted++;
      else {
        rejected++;
        failures.push({ file: e.file, code: r.reason });
      }
    }
    return { scanned: entries.length, accepted, rejected, failures };
  }

  function snapshot() {
    return {
      federation_id: federationId,
      drop_zone: options.dropZone,
      members: cache.listMembers(federationId).map((m) => ({
        member_id: m.member_id,
        issuer: m.issuer,
        alg: m.alg,
        pubkey_id: m.pubkey_id,
        announced_at: m.announced_at,
        ttl_seconds: m.ttl_seconds,
      })),
    };
  }

  // First pass: announce self + scan
  let selfFile = null;
  if (selfAnnounceFn) {
    const r = selfAnnounceFn();
    selfFile = r.file;
  }
  const firstScan = scanAndIngest();

  if (options.once) {
    const out = {
      ok: true,
      federation_id: federationId,
      self_announce_file: selfFile,
      scan: firstScan,
      ...snapshot(),
    };
    if (options.json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      logger.success(
        `discovered ${out.members.length} member(s) in federation ${federationId}`,
      );
      for (const m of out.members) {
        logger.log(
          `  · ${chalk.green(m.member_id)} (${m.alg})  ${chalk.gray(m.pubkey_id.slice(0, 18) + "…")}`,
        );
      }
    }
    return;
  }

  // Daemon: re-announce + re-scan on intervals
  const reannounceMs = Math.max(60, Math.floor(options.ttl / 3)) * 1000;
  const scanMs = Math.max(1, options.scanInterval) * 1000;

  let scanTimer = null;
  let announceTimer = null;
  function cleanup() {
    if (scanTimer) clearInterval(scanTimer);
    if (announceTimer) clearInterval(announceTimer);
    process.exit(0);
  }
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);

  // Re-entrancy guard: if a scan tick takes longer than scanInterval (large
  // drop-zone, slow disk), don't let setInterval stack up overlapping ticks.
  let scanInProgress = false;
  scanTimer = setInterval(() => {
    if (scanInProgress) return;
    scanInProgress = true;
    try {
      const r = scanAndIngest();
      if (options.json) {
        console.log(
          JSON.stringify({ tick: "scan", ...r, ...snapshot() }, null, 2),
        );
      } else {
        logger.log(
          `[${new Date().toISOString()}] scan: ${r.accepted}+/${r.scanned} accepted, ${cache.listMembers(federationId).length} live`,
        );
      }
    } catch (err) {
      logger.error(`scan failed: ${err.message}`);
    } finally {
      scanInProgress = false;
    }
  }, scanMs);

  if (selfAnnounceFn) {
    announceTimer = setInterval(() => {
      try {
        selfAnnounceFn();
        if (!options.json) {
          logger.log(
            `[${new Date().toISOString()}] re-announced self in federation ${federationId}`,
          );
        }
      } catch (err) {
        logger.error(`self-announce failed: ${err.message}`);
      }
    }, reannounceMs);
  }

  logger.success(
    `federation discover daemon running (drop-zone: ${options.dropZone}, scan: ${options.scanInterval}s, ttl: ${options.ttl}s)${
      selfAnnounceFn ? `, announcing as ${options.memberId}` : ", listen-only"
    }`,
  );
  await new Promise(() => {});
}

const FEDERATION_TOPIC_PREFIX = "mtc-federation/v1";

function federationTopic(federationId) {
  return `${FEDERATION_TOPIC_PREFIX}/${federationId}`;
}

function governanceTopic(federationId) {
  return `mtc-federation-governance/v1/${federationId}`;
}

/**
 * libp2p gossipsub-based governance sync (Phase 2 of v0.9 sync work).
 *
 * Each peer subscribes to mtc-federation-governance/v1/<fed>; on each tick
 * the peer publishes any local events that haven't been published yet
 * (tracked in <governance-dir>/<fed>.libp2p-pos.json — a tiny offset file
 * mapping event_id → already-published flag). Receivers dedupe + optionally
 * verify each event before appending to their local jsonl.
 *
 * --once mode subscribes, publishes one batch, waits one interval to drain
 * inbox, then exits — suitable for cron / tests.
 */
async function runGovernanceSyncLibp2p(federationId, options) {
  const { Libp2pTransport } =
    await import("@chainlesschain/core-mtc/transports/libp2p");

  const node = await Libp2pTransport.create({
    listen: options.listen,
    mode: "gossipsub",
  });

  const closeOnError = async (err) => {
    try {
      await node.close();
    } catch (_e) {
      /* ignore */
    }
    throw err;
  };

  try {
    return await runGovernanceSyncLibp2pInner(federationId, options, node);
  } catch (err) {
    return closeOnError(err);
  }
}

function loadLibp2pPubMarkers(federationId) {
  const file = path.join(
    getFederationDir(),
    "governance",
    `${federationId}.libp2p-pos.json`,
  );
  if (!fs.existsSync(file)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(file, "utf-8")));
  } catch (_err) {
    return new Set();
  }
}

function saveLibp2pPubMarkers(federationId, ids) {
  const file = path.join(
    getFederationDir(),
    "governance",
    `${federationId}.libp2p-pos.json`,
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([...ids]), "utf-8");
}

async function runGovernanceSyncLibp2pInner(federationId, options, node) {
  const topic = governanceTopic(federationId);
  let received = 0;
  let appendedFromWire = 0;
  let invalidFromWire = 0;
  let unknownFromWire = 0;

  // verify lookup (built once from local registry)
  let verifyLookup = null;
  if (options.verify) {
    const registry = loadFederationRegistry();
    const fedEntry = registry.federations[federationId] || { members: {} };
    verifyLookup = (actor) => {
      const m = fedEntry.members[actor];
      if (!m || !m.pubkey_jwk) return null;
      try {
        return Buffer.from(m.pubkey_jwk.x, "base64url");
      } catch (_err) {
        return null;
      }
    };
  }

  // Subscribe + dispatch
  node.subscribeRaw(topic, (bytes) => {
    received++;
    let ev;
    try {
      ev = JSON.parse(new TextDecoder().decode(bytes));
    } catch (_err) {
      return;
    }
    if (!ev || typeof ev.event_id !== "string") return;

    if (verifyLookup) {
      const result = mtcLib.verifyGovernanceLog([ev], verifyLookup);
      if (result.invalid.length) {
        invalidFromWire++;
        return;
      }
      if (result.unknown.length) {
        unknownFromWire++;
        return;
      }
    }

    // Dedupe vs local log
    const local = loadGovernanceLog(federationId);
    if (local.some((e) => e && e.event_id === ev.event_id)) return;
    appendGovernanceEvent(federationId, ev);
    appendedFromWire++;
  });

  // Dial seed peers
  for (const peer of options.connect || []) {
    try {
      await node.dial(peer);
    } catch (err) {
      console.warn(`[libp2p] dial ${peer} failed: ${err.message}`);
    }
  }

  const publishTick = async () => {
    const stamp = new Date().toISOString();
    const local = loadGovernanceLog(federationId);
    const published = loadLibp2pPubMarkers(federationId);
    let publishedThisTick = 0;
    for (const ev of local) {
      if (!ev || typeof ev.event_id !== "string") continue;
      if (published.has(ev.event_id)) continue;
      try {
        await node.publishRaw(topic, JSON.stringify(ev));
        published.add(ev.event_id);
        publishedThisTick++;
      } catch (err) {
        console.warn(`[libp2p] publish ${ev.event_id} failed: ${err.message}`);
      }
    }
    if (publishedThisTick > 0) saveLibp2pPubMarkers(federationId, published);

    // Persist live stats so governance-sync-stats / web GUI can poll
    const stats = loadStats(federationId);
    stats.federation_id = federationId;
    stats.mode = "libp2p";
    stats.last_tick_at = stamp;
    stats.publish = stats.publish || { total_published: 0 };
    stats.publish.last_published = publishedThisTick;
    stats.publish.total_published =
      (stats.publish.total_published || 0) + publishedThisTick;
    stats.libp2p = stats.libp2p || {};
    stats.libp2p.wire_received = received;
    stats.libp2p.wire_appended = appendedFromWire;
    stats.libp2p.wire_invalid = invalidFromWire;
    stats.libp2p.wire_unknown = unknownFromWire;
    stats.libp2p.topic = topic;
    saveStats(federationId, stats);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            tick_at: stamp,
            published: publishedThisTick,
            wire_received: received,
            wire_appended: appendedFromWire,
            wire_invalid: invalidFromWire,
            wire_unknown: unknownFromWire,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(
        `[${stamp}] published ${publishedThisTick} new event(s); wire received=${received} appended=${appendedFromWire} invalid=${invalidFromWire} unknown=${unknownFromWire}`,
      );
    }
  };

  await publishTick();

  if (options.once) {
    // Wait one interval to drain inbox, then exit cleanly
    await new Promise((r) => setTimeout(r, options.interval * 1000));
    await publishTick();
    await node.close();
    return;
  }

  console.log(
    `governance-sync-libp2p: federation=${federationId} topic=${topic} interval=${options.interval}s. Ctrl-C to stop.`,
  );
  const handle = setInterval(publishTick, options.interval * 1000);
  const stop = async () => {
    clearInterval(handle);
    try {
      await node.close();
    } catch (_e) {
      /* ignore */
    }
    console.log("governance-sync-libp2p: stopped.");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => {});
}

async function runFederationDiscoverLibp2p(federationId, options) {
  const FederationAnnounceCache = mtcLib.FederationAnnounceCache;
  const { Libp2pTransport } =
    await import("@chainlesschain/core-mtc/transports/libp2p");

  const cache = new FederationAnnounceCache({
    persistDir: options.cacheDir,
  });

  let selfBuildAnnounce = null;
  let selfMember = null;
  if (options.memberId) {
    const { member, buildAnnounce } = loadFederationMemberForAnnounce(
      federationId,
      options.memberId,
      options.ttl,
    );
    selfBuildAnnounce = buildAnnounce;
    selfMember = member;
  }

  // Spin up gossipsub libp2p node
  const node = await Libp2pTransport.create({
    listen: options.listen,
    mode: "gossipsub",
  });

  // Helper: tear down the node on any error path so we don't leak the
  // libp2p host when initialization throws after node creation.
  const closeNodeOnError = async (err) => {
    try {
      await node.close();
    } catch (_e) {
      /* ignore close errors during error cleanup */
    }
    throw err;
  };

  try {
    return await runFederationDiscoverLibp2pInner(
      federationId,
      options,
      node,
      cache,
      selfBuildAnnounce,
      selfMember,
    );
  } catch (err) {
    return closeNodeOnError(err);
  }
}

async function runFederationDiscoverLibp2pInner(
  federationId,
  options,
  node,
  cache,
  selfBuildAnnounce,
  selfMember,
) {
  const topic = federationTopic(federationId);

  // Subscribe + dispatch into cache
  let bytesReceived = 0;
  node.subscribeRaw(topic, (bytes) => {
    bytesReceived++;
    try {
      cache.ingest(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (_err) {
      /* malformed announce — drop */
    }
  });

  // Dial seed peers
  for (const peer of options.connect || []) {
    try {
      await node.connect(peer);
    } catch (err) {
      logger.warn(`connect to ${peer} failed: ${err.message}`);
    }
  }

  // Mesh formation wait
  const meshWaitMs = Math.max(0, options.meshWaitMs ?? 1500);
  if (meshWaitMs > 0) await new Promise((r) => setTimeout(r, meshWaitMs));

  async function publishSelf() {
    if (!selfBuildAnnounce) return null;
    const ann = selfBuildAnnounce();
    const result = await node.publishRaw(topic, JSON.stringify(ann));
    return { announce: ann, recipients: result.recipients };
  }

  function snapshot() {
    return {
      federation_id: federationId,
      transport: "libp2p",
      multiaddrs: node.multiaddrs(),
      peer_id: node.peerIdString(),
      members: cache.listMembers(federationId).map((m) => ({
        member_id: m.member_id,
        issuer: m.issuer,
        alg: m.alg,
        pubkey_id: m.pubkey_id,
        announced_at: m.announced_at,
        ttl_seconds: m.ttl_seconds,
      })),
    };
  }

  // First pass: announce self
  let firstPublish = null;
  if (selfBuildAnnounce) {
    firstPublish = await publishSelf();
  }

  if (options.once) {
    // Wait briefly for any incoming announces from peers we just dialed
    if ((options.connect || []).length > 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    const out = {
      ok: true,
      ...snapshot(),
      self_announce: firstPublish
        ? {
            member_id: options.memberId,
            issuer: selfMember?.issuer,
            recipients: firstPublish.recipients,
          }
        : null,
      bytes_received: bytesReceived,
    };
    if (options.json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      logger.success(
        `libp2p discover: peer_id=${out.peer_id}, ${out.members.length} member(s) cached`,
      );
      for (const a of out.multiaddrs) logger.log(`  listen: ${a}`);
      for (const m of out.members) {
        logger.log(
          `  · ${chalk.green(m.member_id)} (${m.alg})  ${chalk.gray(m.pubkey_id.slice(0, 18) + "…")}`,
        );
      }
    }
    await node.close();
    return;
  }

  // Daemon: re-announce on TTL/3
  const reannounceMs = Math.max(60, Math.floor(options.ttl / 3)) * 1000;
  let announceTimer = null;
  if (selfBuildAnnounce) {
    announceTimer = setInterval(async () => {
      try {
        await publishSelf();
        if (!options.json) {
          logger.log(
            `[${new Date().toISOString()}] re-announced via libp2p in federation ${federationId}`,
          );
        }
      } catch (err) {
        logger.error(`self-announce failed: ${err.message}`);
      }
    }, reannounceMs);
  }

  const cleanup = async () => {
    if (announceTimer) clearInterval(announceTimer);
    try {
      await node.close();
    } catch (_err) {
      /* ignore */
    }
    process.exit(0);
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);

  logger.success(
    `federation discover daemon running (libp2p, peer_id: ${node.peerIdString()})${
      selfBuildAnnounce
        ? `, announcing as ${options.memberId} (TTL ${options.ttl}s)`
        : ", listen-only"
    }`,
  );
  for (const a of node.multiaddrs()) {
    logger.log(`  listen: ${a}`);
  }
  await new Promise(() => {});
}

// Internals exported for tests
export const _federationInternals = {
  FEDERATION_REGISTRY_SCHEMA,
  loadFederationRegistry,
  saveFederationRegistry,
  getFederationDir,
  getFederationRegistryPath,
  publishAnnounce,
  scanDropZone,
  getDiscoverAnnouncesDir,
};
